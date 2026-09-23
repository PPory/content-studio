import { sourceFromRow } from './intelligence-quality.mjs';
import { processingHash, REVIEW_RULE_VERSION } from '../acquisition/relevance.mjs';
import { processReview, processingFor, processLocalSource } from '../acquisition/review.mjs';
import { sourcePermission } from '../acquisition/compatibility.mjs';
import { saveStep, stepState, updateRun, intelligenceRun } from './intelligence.mjs';
import { generateDailyBriefs } from './intelligence-editor.mjs';
import { inIntelligencePool, sourceIsFresh, poolChannelSql, RECOMMEND_WINDOW_MS } from './intelligence-pool.mjs';

const now=()=>new Date().toISOString();
export const unifiedAvailable=w=>Boolean(w.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='intel_unified_sources'").get());
// 在这些状态里的资料还没被真正整理过；过期或不在情报池的直接收口，不再占用模型预算。
const OPEN_STATES=new Set(['pending','retry','permission_required','semantic_pending','processing']);
function channelIndex(w){return new Map(w.db.prepare('SELECT id,source_group,platform FROM intel_channels').all().map(c=>[c.id,c]));}
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
export function unifiedAcquisitionPending(w,runId){
 const step=stepState(w,runId,'acquire');if(!step.batchId)return false;
 return Boolean(w.db.prepare("SELECT r.id FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id WHERE (r.batch_id=? OR r.kind='fulltext') AND j.status IN ('queued','retry','running') LIMIT 1").get(step.batchId));
}
// 每次「更新情报」的模型预算。超出的资料留到下次；过了 7 天自然转为 stale，不会无限积压。
export const UNIFIED_BUDGET=Object.freeze({semantic:60,brief:40,quota:{t2_media:25,community:25},contextComments:5});
const publishedOrder="COALESCE(json_extract(s.data_json,'$.publishedAt'),s.created_at) DESC,s.id";
const isRedditComment=source=>source.sourceKind==='comment'&&(source.platform||source.provider)==='reddit';
function sourceGroupOf(w,channels,row){const c=channels.get(row.channel_id);if(c)return c.source_group;return w.db.prepare("SELECT c.source_group FROM source_discoveries d JOIN intel_channels c ON c.id=d.channel_id WHERE d.source_id=? ORDER BY d.first_seen_at LIMIT 1").get(row.id)?.source_group||'legacy';}
/** 按发布时间从新到旧挑语义判断的候选，并守住类别配额；社区里 Reddit 优先，HN 补足。 */
function pickSemantic(w,channels,budget,limit){
 const left=Math.min(limit,UNIFIED_BUDGET.semantic-budget.semantic);if(left<=0)return [];
 const rows=w.db.prepare(`SELECT s.* FROM intel_unified_sources u JOIN intel_sources s ON s.id=u.source_id WHERE u.status='semantic_pending' AND u.attempts<2 AND s.deleted_at IS NULL ORDER BY u.attempts,${publishedOrder}`).all();
 const hn=row=>channels.get(row.channel_id)?.platform==='hacker_news'?1:0;
 rows.sort((a,b)=>hn(a)-hn(b));
 const used={...budget.quota},picked=[];
 for(const row of rows){if(picked.length>=left)break;const group=sourceGroupOf(w,channels,row),cap=UNIFIED_BUDGET.quota[group];if(cap!==undefined&&(used[group]||0)>=cap)continue;used[group]=(used[group]||0)+1;picked.push({row,group});}
 return picked;
}
function pickBrief(w,budget,limit){
 const left=Math.min(limit,UNIFIED_BUDGET.brief-budget.brief);if(left<=0)return [];
 return w.db.prepare(`SELECT s.* FROM intel_unified_sources u JOIN intel_sources s ON s.id=u.source_id WHERE u.status='processing' AND u.attempts<2 AND s.deleted_at IS NULL ORDER BY ${publishedOrder} LIMIT ?`).all(left).map(sourceFromRow);
}
export async function executeUnifiedBriefs(w,env,runId,deps={}) {
 const previous=stepState(w,runId,'unified');
 if(!previous.intakeReady){
  reconcileUnifiedSources(w);
  saveStep(w,runId,'unified','running',{...previous,intakeReady:true});
 }
 const budget={semantic:previous.budget?.semantic||0,brief:previous.budget?.brief||0,quota:{...(previous.budget?.quota||{})}};
 const channels=channelIndex(w);
 // A retained processing row is queued for composition; exhausted rows are never retried implicitly.
 w.db.prepare("UPDATE intel_unified_sources SET status='failed' WHERE status IN ('processing','semantic_pending','retry') AND attempts>=2").run();
 const localRows=w.db.prepare("SELECT s.* FROM intel_unified_sources u JOIN intel_sources s ON s.id=u.source_id WHERE u.status IN ('pending','retry') AND u.attempts<2 AND s.deleted_at IS NULL ORDER BY u.updated_at,s.created_at,s.id").all();
 const setStatus=w.db.prepare("UPDATE intel_unified_sources SET status=?,last_error='',updated_at=? WHERE source_id=?");
 w.db.transaction(()=>{
  for(const row of localRows){
   const source=sourceFromRow(row);
   let status;
   if(!sourceInPool(channels,row))status='out_of_scope';
   else if(!sourceIsFresh(source))status='stale';
   else if(!sourcePermission(source,'ai'))status='permission_required';
   else {
    const p=processLocalSource(w,source,{refreshRules:true}),sourceGroup=sourceGroupOf(w,channels,row);
    status='semantic_pending';
    if(!p.readable)status='filtered';
    // 评论不单独成卡，也不单独花一次模型判断：随主帖进入卡片生成，作为讨论上下文。
    else if(isRedditComment(source))status='context';
    else if(p.semanticState==='complete')status=p.relevance==='ai_relevant'?'processing':p.relevance==='not_ai'?'filtered':'needs_context';
    else if(p.relevance==='not_ai')status='filtered';
    else if(['aihot','follow_builders'].includes(sourceGroup)&&p.relevance==='ai_relevant')status='processing';
   }
   setStatus.run(status,now(),source.id);
  }
 })();
 const picked=pickSemantic(w,channels,budget,8);
 if(picked.length){
  const semanticRows=picked.map(p=>sourceFromRow(p.row));
  updateRun(w,runId,'running','筛选相关内容、整理中文导读');
  await processReview(w,env,{confirmed:true,semantic:true,sourceIds:semanticRows.map(s=>s.id),skipReplay:true,skipGrouping:true},deps);
  deps.assertCurrent?.();
  budget.semantic+=picked.length;for(const p of picked)budget.quota[p.group]=(budget.quota[p.group]||0)+1;
  for(const source of semanticRows){
   const p=processingFor(w,source);
   const ignored=w.db.prepare("SELECT 1 FROM acquisition_review_members m JOIN acquisition_cluster_reviews r ON r.cluster_id=m.cluster_id WHERE m.source_id=? AND r.status='ignored'").get(source.id);
   const status=ignored?'filtered':p.semanticState==='permission_required'?'permission_required':p.semanticState==='failed'?'retry':p.semanticState==='needs_context'||p.relevance==='needs_context'?'needs_context':p.semanticState==='complete'&&p.relevance==='ai_relevant'?'processing':'filtered';
   w.db.prepare("UPDATE intel_unified_sources SET status=?,attempts=attempts+?,last_error=?,updated_at=? WHERE source_id=?").run(status,status==='retry'?1:0,status==='retry'?'语义处理失败或引文未通过校验':'',now(),source.id);
  }
 }
 const eligible=pickBrief(w,budget,8);
 const saved=[];let rejected=0,unchanged=0;
 if(eligible.length){
  budget.brief+=eligible.length;
  const contextIds=new Set(),context=[];
  for(const post of eligible.filter(s=>(s.platform||s.provider)==='reddit'&&s.sourceKind!=='comment')){
   for(const row of w.db.prepare("SELECT s.* FROM intel_sources s JOIN intel_unified_sources u ON u.source_id=s.id WHERE s.root_item_id=? AND u.status='context' AND s.deleted_at IS NULL ORDER BY length(json_extract(s.data_json,'$.body')) DESC LIMIT ?").all(post.id,UNIFIED_BUDGET.contextComments)){
    const comment=sourceFromRow(row);if(!sourcePermission(comment,'ai'))continue;contextIds.add(comment.id);context.push(comment);
   }
  }
  for(const source of [...eligible,...context])w.db.prepare('INSERT OR IGNORE INTO intel_run_sources(run_id,source_id) VALUES(?,?)').run(runId,source.id);
  for(const source of eligible)w.db.prepare("UPDATE intel_unified_sources SET attempts=attempts+1,updated_at=? WHERE source_id=?").run(now(),source.id);
  const wiki=w.db.prepare("SELECT p.id,p.title,substr(p.body_markdown,1,1200) body FROM wiki_pages p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL ORDER BY e.updated_at DESC LIMIT 30").all();
  try {
   const result=await generateDailyBriefs(w,env,intelligenceRun(w,runId),[...eligible,...context],wiki,{...deps,unified:true,contextIds});
   deps.assertCurrent?.();
   saved.push(...result.saved);rejected=result.rejected;unchanged=result.unchanged;
   for(const source of eligible){
    const brief=w.db.prepare("SELECT b.id,b.editorial_state FROM intel_briefs b,json_each(b.data_json,'$.evidence') e WHERE json_extract(e.value,'$.sourceId')=? ORDER BY b.updated_at DESC LIMIT 1").get(source.id);
    w.db.prepare("UPDATE intel_unified_sources SET status=?,brief_id=COALESCE(?,brief_id),last_error='',updated_at=? WHERE source_id=?").run(brief?brief.editorial_state==='ready'?'done':'retry':rejected?'retry':'filtered',brief?.id||null,now(),source.id);
   }
  } catch(error){
   if(error.cancelled||error.leaseLost)throw error;
   for(const source of eligible)w.db.prepare("UPDATE intel_unified_sources SET status='retry',last_error='解读或依据复核未完成',updated_at=? WHERE source_id=?").run(now(),source.id);
  }
 }
 w.db.prepare("UPDATE intel_unified_sources SET status='failed' WHERE status='retry' AND attempts>=2").run();
 const prior=stepState(w,runId,'unified');
 const summary={...unifiedSummary(w),intakeReady:true,budget,newCount:(prior.newCount||0)+saved.filter(b=>b.version===1).length,updatedCount:(prior.updatedCount||0)+saved.filter(b=>b.version>1).length,unchanged:(prior.unchanged||0)+unchanged,rejected:(prior.rejected||0)+rejected};
 saveStep(w,runId,'unified','running',summary);
 // 只有预算内还能推进的资料才值得再排一轮；否则留到下次更新，不空转。
 const retryable=w.db.prepare("SELECT count(*) n FROM intel_unified_sources WHERE status IN ('pending','retry') AND attempts<2").get().n;
 const workLeft=retryable>0||pickSemantic(w,channels,budget,1).length>0||pickBrief(w,budget,1).length>0;
 if(workLeft)return deferUnifiedRun(w,runId,'正在整理情报，还有 '+summary.pending+' 份资料');
 const acquisition=stepState(w,runId,'acquire');
 const acquisitionFailures=acquisition.batchId?w.db.prepare("SELECT count(*) n FROM acquisition_runs WHERE batch_id=? AND status IN ('failed','blocked')").get(acquisition.batchId).n:0;
 const deferred=summary.pending;
 saveStep(w,runId,'unified','done',{...summary,acquisitionFailures,deferred});
 updateRun(w,runId,summary.failures||acquisitionFailures?'partial':'done','情报更新完成：新增 '+summary.newCount+' 条，更新 '+summary.updatedCount+' 条'+(deferred?'；另有 '+deferred+' 份资料留到下次整理':'')+(summary.failures||acquisitionFailures?'；部分来源或资料待复核':''));
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
