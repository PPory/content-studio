import { sourceFromRow } from './intelligence-quality.mjs';
import { processingHash, REVIEW_RULE_VERSION } from '../acquisition/relevance.mjs';
import { sourcePermission } from '../acquisition/compatibility.mjs';
import { saveStep, stepState, updateRun, intelligenceRun } from './intelligence.mjs';
import { admitSources, clusterEvents, judgeEvents, upsertEventCards } from './intelligence-events.mjs';
import { inIntelligencePool, sourceIsFresh, poolChannelSql, RECOMMEND_WINDOW_MS } from './intelligence-pool.mjs';

const now=()=>new Date().toISOString();
export const unifiedAvailable=w=>Boolean(w.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='intel_unified_sources'").get());
// 在这些状态里的资料还没被真正整理过；过期或不在情报池的直接收口，不再占用模型预算。
const OPEN_STATES=new Set(['pending','retry','permission_required','semantic_pending','processing']);
function channelIndex(w){return new Map(w.db.prepare('SELECT id,source_group,platform,stable_key FROM intel_channels').all().map(c=>[c.id,c]));}
/** 资料是否属于情报池。旧管线遗留资料没有频道，交给新鲜度判断处理。 */
function sourceInPool(channels,row){return !row.channel_id||inIntelligencePool(channels.get(row.channel_id));}
export function reconcileUnifiedSources(w,{now=Date.now()}={}) {
 if(!unifiedAvailable(w))return;
 const rows=w.db.prepare("SELECT * FROM intel_sources WHERE deleted_at IS NULL AND origin_kind='external' ORDER BY created_at,id").all();
 const channels=channelIndex(w);
 const put=w.db.prepare("INSERT INTO intel_unified_sources(source_id,content_hash,updated_at) VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET content_hash=excluded.content_hash,status='pending',attempts=0,last_error='',updated_at=excluded.updated_at WHERE intel_unified_sources.content_hash<>excluded.content_hash");
 const setStatus=w.db.prepare('UPDATE intel_unified_sources SET status=?,updated_at=? WHERE source_id=?');
 w.db.transaction(()=>{for(const row of rows){
  const old=w.db.prepare('SELECT * FROM intel_unified_sources WHERE source_id=?').get(row.id),source=sourceFromRow(row);put.run(row.id,`${REVIEW_RULE_VERSION}:${processingHash(source)}`,new Date(now).toISOString());
  if(!old){const brief=w.db.prepare("SELECT b.id,b.editorial_state FROM intel_briefs b,json_each(b.data_json,'$.evidence') e WHERE json_extract(e.value,'$.sourceId')=? ORDER BY b.created_at LIMIT 1").get(row.id);if(brief)w.db.prepare("UPDATE intel_unified_sources SET status='done',brief_id=? WHERE source_id=?").run(brief.id,row.id);}
  const current=w.db.prepare('SELECT status FROM intel_unified_sources WHERE source_id=?').get(row.id)?.status;
  if(!OPEN_STATES.has(current))continue;
  if(!sourceInPool(channels,row))setStatus.run('out_of_scope',new Date(now).toISOString(),row.id);
  else if(!sourceIsFresh(source,{now}))setStatus.run('stale',new Date(now).toISOString(),row.id);
  else if(current==='permission_required'&&sourcePermission(source,'ai'))w.db.prepare("UPDATE intel_unified_sources SET status='pending',attempts=0 WHERE source_id=?").run(row.id);
 }} )();
}
export function unifiedSummary(w) {
 if(!unifiedAvailable(w))return {pending:0,failures:0,newCount:0,updatedCount:0};
 const counts=Object.fromEntries(w.db.prepare('SELECT status,count(*) n FROM intel_unified_sources GROUP BY status').all().map(r=>[r.status,r.n]));
 // 「还没授权」只数最近 7 天、情报池里的资料：更早的和池外的授权了也不会整理，数进来只会吓人。
 const gap=w.db.prepare(`SELECT count(*) n FROM intel_unified_sources u JOIN intel_sources s ON s.id=u.source_id LEFT JOIN intel_channels c ON c.id=s.channel_id WHERE u.status='permission_required' AND s.deleted_at IS NULL AND COALESCE(json_extract(s.data_json,'$.publishedAt'),'')>=? AND (s.channel_id IS NULL OR ${poolChannelSql('c')})`).get(new Date(Date.now()-RECOMMEND_WINDOW_MS).toISOString()).n;
 return {pending:(counts.pending||0)+(counts.retry||0)+(counts.semantic_pending||0)+(counts.processing||0),failures:counts.failed||0,needsContext:counts.needs_context||0,permissionRequired:gap,filtered:counts.filtered||0,processed:counts.done||0,stale:counts.stale||0,outOfScope:counts.out_of_scope||0};
}
export function briefReviewMeta(w,evidence=[]) {
 if(!unifiedAvailable(w))return {sourceGroups:[],reviewClusterId:null};
 const ids=evidence.map(e=>e.sourceId),groups=new Set();let reviewClusterId=null;
 for(const id of ids){for(const row of w.db.prepare('SELECT c.source_group FROM source_discoveries d JOIN intel_channels c ON c.id=d.channel_id WHERE d.source_id=?').all(id))groups.add(row.source_group);reviewClusterId ||= w.db.prepare('SELECT cluster_id FROM acquisition_review_members WHERE source_id=?').get(id)?.cluster_id;}
 return {sourceGroups:[...groups],reviewClusterId};
}
// A persisted continuation releases the worker so acquisition and body enrichment can finish.
export function deferUnifiedRun(w,runId,stage) {
 const step=stepState(w,runId,'unified-wait'),sequence=(step.sequence||0)+1;
 saveStep(w,runId,'unified-wait','running',{sequence});
 const {job}=w.jobs.enqueue({kind:'intelligence.research',idempotencyKey:`intel-unified:${runId}:${sequence}`,payload:{runId},dueAt:new Date(Date.now()+15000).toISOString(),maxAttempts:2});
 w.db.prepare('UPDATE intel_runs SET job_id=? WHERE id=?').run(job.id,runId);updateRun(w,runId,'queued',stage);return intelligenceRun(w,runId);
}
// 只等快的信源和补全文；Reddit 慢（每个社区要等几分钟快照），到了之后由 scheduleRedditArrival 再补整理一轮。
export function unifiedAcquisitionPending(w,runId){
 const step=stepState(w,runId,'acquire');if(!step.batchId)return false;
 return Boolean(w.db.prepare("SELECT r.id FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id JOIN intel_channels c ON c.id=r.channel_id WHERE ((r.batch_id=? AND c.platform<>'reddit') OR r.kind='fulltext') AND j.status IN ('queued','retry','running') LIMIT 1").get(step.batchId));
}
/**
 * 热点事件雷达的一次整理（2026-09-23）：准入 → 本地归并 → 一两次批量判断 → 写卡。
 * 不再逐份调用模型，也不在更新时写长文；深度解读在点开时按需生成（intelligence-deepen.mjs）。
 */
export async function executeUnifiedBriefs(w,env,runId,deps={}) {
 const previous=stepState(w,runId,'unified');
 if(!previous.intakeReady){
  reconcileUnifiedSources(w);
  saveStep(w,runId,'unified','running',{...previous,intakeReady:true});
 }
 const channels=channelIndex(w);
 // 旧流程留下的中间状态一并按新规则重新准入。
 const rows=w.db.prepare("SELECT s.* FROM intel_unified_sources u JOIN intel_sources s ON s.id=u.source_id WHERE u.status IN ('pending','retry','semantic_pending','processing','needs_context','failed') AND s.deleted_at IS NULL").all();
 const setStatus=w.db.prepare('UPDATE intel_unified_sources SET status=?,updated_at=? WHERE source_id=?'),ready=[];
 w.db.transaction(()=>{for(const row of rows){const source=sourceFromRow(row);
  if(!sourceInPool(channels,row))setStatus.run('out_of_scope',now(),row.id);
  else if(!sourceIsFresh(source))setStatus.run('stale',now(),row.id);
  else if(!sourcePermission(source,'ai'))setStatus.run('permission_required',now(),row.id);
  else ready.push(row);}})();
 const admitted=admitSources(w,ready,channels);
 updateRun(w,runId,'running','正在归并事件');
 const events=clusterEvents(w,{channels});
 updateRun(w,runId,'running','正在判断价值');
 const judged=await judgeEvents(w,env,events,deps);
 deps.assertCurrent?.();
 const cards=upsertEventCards(w,runId,events,{mergeBriefIdentities});
 const summary={...unifiedSummary(w),intakeReady:true,admitted,events:events.length,judge:judged,newCount:cards.created,updatedCount:cards.updated,withheld:cards.withheld};
 const acquisition=stepState(w,runId,'acquire');
 const acquisitionFailures=acquisition.batchId?w.db.prepare("SELECT count(*) n FROM acquisition_runs WHERE batch_id=? AND status IN ('failed','blocked')").get(acquisition.batchId).n:0;
 saveStep(w,runId,'unified','done',{...summary,acquisitionFailures});
 const problems=[judged.failures?'部分事件暂未判断，下次更新再试':'',acquisitionFailures?'部分来源本次未完成':''].filter(Boolean);
 updateRun(w,runId,problems.length?'partial':'done',`完成：${cards.events} 个事件，新增 ${cards.created} 个${cards.updated?`，更新 ${cards.updated} 个`:''}${problems.length?'；'+problems.join('；'):''}`);
 return intelligenceRun(w,runId);
}
export function canonicalBriefId(w,id) {
 if(!w.db.prepare("SELECT name FROM sqlite_master WHERE name='intel_brief_aliases'").get())return id;
 const visited=new Set();while(!visited.has(id)){visited.add(id);const row=w.db.prepare('SELECT canonical_id FROM intel_brief_aliases WHERE alias_id=?').get(id);if(!row)return id;id=row.canonical_id;}throw new Error('情报关联出现循环，需检查历史映射');
}
export function mergeBriefIdentities(w,canonicalId,otherIds) {
 canonicalId=canonicalBriefId(w,canonicalId);
 if(!w.db.prepare("SELECT name FROM sqlite_master WHERE name='intel_brief_aliases'").get())return canonicalId;
 for(let id of otherIds){id=canonicalBriefId(w,id);if(id===canonicalId)continue;
  const source=w.db.prepare('SELECT * FROM intel_briefs WHERE id=?').get(id);if(!source)continue;
  w.db.prepare('UPDATE intel_briefs SET saved=max(saved,?),helpful=max(helpful,?),dismissed=max(dismissed,?),read_version=CASE WHEN ?>= ? THEN version ELSE read_version END WHERE id=?').run(source.saved,source.helpful,source.dismissed,source.read_version,source.version,canonicalId);
  w.db.prepare('INSERT OR IGNORE INTO intel_brief_researches(brief_id,research_id,created_at) SELECT ?,research_id,created_at FROM intel_brief_researches WHERE brief_id=?').run(canonicalId,id);
  w.db.prepare('INSERT INTO intel_brief_aliases(alias_id,canonical_id,created_at) VALUES(?,?,?) ON CONFLICT(alias_id) DO UPDATE SET canonical_id=excluded.canonical_id').run(id,canonicalId,now());
  w.db.prepare('UPDATE intel_brief_aliases SET canonical_id=? WHERE canonical_id=?').run(canonicalId,id);
  w.db.prepare('UPDATE intel_unified_sources SET brief_id=? WHERE brief_id=?').run(canonicalId,id);
 }
 return canonicalId;
}

export function briefIdentityIds(w,id){
 const canonical=canonicalBriefId(w,id);
 if(!w.db.prepare("SELECT name FROM sqlite_master WHERE name='intel_brief_aliases'").get())return [canonical];
 return [canonical,...w.db.prepare('SELECT alias_id FROM intel_brief_aliases WHERE canonical_id=?').all(canonical).map(r=>r.alias_id)];
}
