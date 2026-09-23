import { sourceFromRow } from './intelligence-quality.mjs';
import { processingHash, REVIEW_RULE_VERSION } from '../acquisition/relevance.mjs';
import { processReview, processingFor, processLocalSource, semanticMaterial } from '../acquisition/review.mjs';
import { sourcePermission } from '../acquisition/compatibility.mjs';
import { saveStep, stepState, updateRun, intelligenceRun } from './intelligence.mjs';
import { generateDailyBriefs } from './intelligence-editor.mjs';

const now=()=>new Date().toISOString();
export const unifiedAvailable=w=>Boolean(w.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='intel_unified_sources'").get());
export function reconcileUnifiedSources(w) {
 if(!unifiedAvailable(w))return;
 const rows=w.db.prepare("SELECT * FROM intel_sources WHERE deleted_at IS NULL AND origin_kind='external' ORDER BY created_at,id").all();
 const put=w.db.prepare("INSERT INTO intel_unified_sources(source_id,content_hash,updated_at) VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET content_hash=excluded.content_hash,status='pending',attempts=0,last_error='',updated_at=excluded.updated_at WHERE intel_unified_sources.content_hash<>excluded.content_hash");
 w.db.transaction(()=>{for(const row of rows){
  const old=w.db.prepare('SELECT * FROM intel_unified_sources WHERE source_id=?').get(row.id),source=sourceFromRow(row);put.run(row.id,`${REVIEW_RULE_VERSION}:${processingHash(source)}`,now());
  if(!old){const brief=w.db.prepare("SELECT b.id,b.editorial_state FROM intel_briefs b,json_each(b.data_json,'$.evidence') e WHERE json_extract(e.value,'$.sourceId')=? ORDER BY b.created_at LIMIT 1").get(row.id);if(brief)w.db.prepare("UPDATE intel_unified_sources SET status='done',brief_id=? WHERE source_id=?").run(brief.id,row.id);}
  if(old?.status==='permission_required'&&sourcePermission(source,'ai'))w.db.prepare("UPDATE intel_unified_sources SET status='pending',attempts=0 WHERE source_id=?").run(row.id);
 }} )();
}
export function unifiedSummary(w) {
 if(!unifiedAvailable(w))return {pending:0,failures:0,newCount:0,updatedCount:0};
 const counts=Object.fromEntries(w.db.prepare('SELECT status,count(*) n FROM intel_unified_sources GROUP BY status').all().map(r=>[r.status,r.n]));
 return {pending:(counts.pending||0)+(counts.retry||0)+(counts.semantic_pending||0)+(counts.processing||0),failures:counts.failed||0,needsContext:counts.needs_context||0,permissionRequired:counts.permission_required||0,filtered:counts.filtered||0,processed:counts.done||0};
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
export async function executeUnifiedBriefs(w,env,runId,deps={}) {
 const previous=stepState(w,runId,'unified');
 if(!previous.intakeReady){
  reconcileUnifiedSources(w);
  saveStep(w,runId,'unified','running',{...previous,intakeReady:true});
 }
 // A retained processing row is queued for composition; exhausted rows are never retried implicitly.
 w.db.prepare("UPDATE intel_unified_sources SET status='failed' WHERE status IN ('processing','semantic_pending','retry') AND attempts>=2").run();
 const localRows=w.db.prepare("SELECT s.* FROM intel_unified_sources u JOIN intel_sources s ON s.id=u.source_id WHERE u.status IN ('pending','retry') AND u.attempts<2 AND s.deleted_at IS NULL ORDER BY u.updated_at,s.created_at,s.id").all();
 const group=w.db.prepare("SELECT c.source_group FROM source_discoveries d JOIN intel_channels c ON c.id=d.channel_id WHERE d.source_id=? ORDER BY d.first_seen_at LIMIT 1");
 const setStatus=w.db.prepare("UPDATE intel_unified_sources SET status=?,last_error='',updated_at=? WHERE source_id=?");
 w.db.transaction(()=>{
  for(const row of localRows){
   const source=sourceFromRow(row),p=processLocalSource(w,source,{refreshRules:true});
   const sourceGroup=group.get(source.id)?.source_group;
   let status='semantic_pending';
   if(!sourcePermission(source,'ai'))status='permission_required';
   else if(!p.readable)status='filtered';
   else if(source.sourceKind==='comment'&&(source.platform||source.provider)==='reddit'&&semanticMaterial(w,source)===null)status='needs_context';
   else if(p.semanticState==='complete')status=p.relevance==='ai_relevant'?'processing':p.relevance==='not_ai'?'filtered':'needs_context';
   else if(p.relevance==='not_ai'&&source.sourceKind!=='comment')status='filtered';
   else if(['aihot','follow_builders'].includes(sourceGroup)&&p.relevance==='ai_relevant'&&source.sourceKind!=='comment')status='processing';
   setStatus.run(status,now(),source.id);
  }
 })();
 const semanticRows=w.db.prepare("SELECT s.* FROM intel_unified_sources u JOIN intel_sources s ON s.id=u.source_id WHERE u.status='semantic_pending' AND u.attempts<2 AND s.deleted_at IS NULL ORDER BY u.attempts,u.updated_at,s.created_at,s.id LIMIT 8").all().map(sourceFromRow);
 if(semanticRows.length){
  updateRun(w,runId,'running','筛选相关内容、整理中文导读');
  await processReview(w,env,{confirmed:true,semantic:true,sourceIds:semanticRows.map(s=>s.id),skipReplay:true,skipGrouping:true},deps);
  deps.assertCurrent?.();
  for(const source of semanticRows){
   const p=processingFor(w,source);
   const ignored=w.db.prepare("SELECT 1 FROM acquisition_review_members m JOIN acquisition_cluster_reviews r ON r.cluster_id=m.cluster_id WHERE m.source_id=? AND r.status='ignored'").get(source.id);
   const status=ignored?'filtered':p.semanticState==='permission_required'?'permission_required':p.semanticState==='failed'?'retry':p.semanticState==='needs_context'||p.relevance==='needs_context'?'needs_context':p.semanticState==='complete'&&p.relevance==='ai_relevant'?'processing':'filtered';
   w.db.prepare("UPDATE intel_unified_sources SET status=?,attempts=attempts+?,last_error=?,updated_at=? WHERE source_id=?").run(status,status==='retry'?1:0,status==='retry'?'语义处理失败或引文未通过校验':'',now(),source.id);
  }
 }
 const eligible=w.db.prepare("SELECT s.* FROM intel_unified_sources u JOIN intel_sources s ON s.id=u.source_id WHERE u.status='processing' AND u.attempts<2 AND s.deleted_at IS NULL ORDER BY u.updated_at,s.created_at,s.id LIMIT 8").all().map(sourceFromRow);
 const saved=[];let rejected=0,unchanged=0;
 if(eligible.length){
  for(const source of eligible){
   w.db.prepare('INSERT OR IGNORE INTO intel_run_sources(run_id,source_id) VALUES(?,?)').run(runId,source.id);
   w.db.prepare("UPDATE intel_unified_sources SET attempts=attempts+1,updated_at=? WHERE source_id=?").run(now(),source.id);
  }
  const wiki=w.db.prepare("SELECT p.id,p.title,substr(p.body_markdown,1,1200) body FROM wiki_pages p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL ORDER BY e.updated_at DESC LIMIT 30").all();
  try {
   const result=await generateDailyBriefs(w,env,intelligenceRun(w,runId),eligible,wiki,{...deps,unified:true});
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
 const summary={...unifiedSummary(w),intakeReady:true,newCount:(prior.newCount||0)+saved.filter(b=>b.version===1).length,updatedCount:(prior.updatedCount||0)+saved.filter(b=>b.version>1).length,unchanged:(prior.unchanged||0)+unchanged,rejected:(prior.rejected||0)+rejected};
 saveStep(w,runId,'unified','running',summary);
 if(summary.pending)return deferUnifiedRun(w,runId,'正在整理情报，剩余 '+summary.pending+' 份资料');
 const acquisition=stepState(w,runId,'acquire');
 const acquisitionFailures=acquisition.batchId?w.db.prepare("SELECT count(*) n FROM acquisition_runs WHERE batch_id=? AND status IN ('failed','blocked')").get(acquisition.batchId).n:0;
 saveStep(w,runId,'unified','done',{...summary,acquisitionFailures});
 updateRun(w,runId,summary.failures||acquisitionFailures?'partial':'done','情报更新完成：新增 '+summary.newCount+' 条，更新 '+summary.updatedCount+' 条'+(summary.failures||acquisitionFailures?'；部分来源或资料待复核':''));
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
