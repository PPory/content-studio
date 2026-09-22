import { canonicalBriefId } from './intelligence-unified.mjs';
import { assertSourcePermission, visibleDerived } from '../acquisition/compatibility.mjs';
import { createUlid } from '../storage/ids.mjs';
import { sha256Json, sourceContainsVerbatim } from './integrity.mjs';
import { sourceFromRow } from './intelligence-quality.mjs';
import { intelligenceBrief } from './intelligence-feed.mjs';
import { createResearch, getResearch, saveResearch, researchReference, researchConversation } from './research.mjs';
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(value,max=20000)=>{if(typeof value!=='string'||value.length>max)throw bad('选题文字格式或长度无效');return value.trim();};
function source(w,id){
 const row=w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(id);
 if(!row||row.deleted_at||(row.expires_at&&Date.parse(row.expires_at)<=Date.now()))throw bad('引用资料已过期或移除，请重新选择',409);
 const item=sourceFromRow(row);assertSourcePermission(item,'export');return item;
}
function attachSource(w,researchId,item){
 let id=w.db.prepare('SELECT capture_id FROM intel_sources WHERE id=?').get(item.id).capture_id;
 if(id){const e=w.repository.getEntity(id);if(!e||e.deleted_at||e.deletedAt)throw bad('来源资料已移除，请先恢复资料',409);}
 else {id=w.domain.createCapture({kind:item.url?'web':'excerpt',title:item.title,bodyMarkdown:item.body||'',sourceUrl:item.url||'',actor:'user',confirmed:true});w.db.prepare('UPDATE intel_sources SET capture_id=? WHERE id=?').run(id,item.id);}
 researchReference(w,researchId,{kind:'capture',id});
}
function normalizeAngle(input,sources){
 if(input==null)return null;
 if(typeof input==='string')return text(input);
 if(!input||Array.isArray(input)||typeof input!=='object')throw bad('选题角度无效');
 const angle=Object.fromEntries(['question','audience','connection','gap'].map(k=>[k,text(input[k]??'',4000)]));
 if(!Array.isArray(input.evidence)||input.evidence.length>20)throw bad('角度引用格式无效');
 angle.evidence=input.evidence.map(e=>{const s=sources.get(e?.sourceId);const quote=text(e?.quote,10000);if(!s||!quote||!sourceContainsVerbatim(s.body,quote))throw bad('角度引用未通过原文校验');return {sourceId:s.id,quote,title:s.title};});
 return angle;
}
export function createIntelligenceTopicIntent(w,input){
 if(input?.confirmed!==true)throw bad('请确认将情报加入选题');
 const operationId=text(input.operationId,160);if(!operationId)throw bad('缺少本次操作标识');
 if(!Array.isArray(input.briefIds)||!input.briefIds.length||input.briefIds.length>8||input.briefIds.some(x=>typeof x!=='string'))throw bad('请选择1至8条情报');
 const ids=[...new Set(input.briefIds.map(id=>canonicalBriefId(w,id)))];
 // Re-read stored evidence instead of trusting a redacted client projection.
 const sourceIds=[...new Set(ids.flatMap(id=>{const r=w.db.prepare('SELECT data_json FROM intel_briefs WHERE id=?').get(id);if(!r)throw bad('情报不存在',404);return (JSON.parse(r.data_json).evidence||[]).map(e=>e.sourceId);} ))];
 if(!sourceIds.length)throw bad('情报缺少可核对的来源',409);
 const sources=new Map(sourceIds.map(id=>[id,source(w,id)]));
 for(const id of ids){const d=JSON.parse(w.db.prepare('SELECT data_json FROM intel_briefs WHERE id=?').get(id).data_json);for(const e of d.evidence||[])if(!sources.get(e.sourceId)||!sourceContainsVerbatim(sources.get(e.sourceId).body,e.quote))throw bad('情报引用的原文已经变化，请重新核查',409);}
 const briefs=ids.map(id=>intelligenceBrief(w,id));
 const angle=normalizeAngle(input.angle,sources),notes=text(input.notes??''),question=text(input.question??((typeof angle==='object'&&angle?.question)||briefs[0].title),1000);
 const payload={briefIds:ids,angle,notes,question,researchId:input.researchId?text(input.researchId,160):null};
 const hash=sha256Json({...payload,briefIds:[...new Set(input.briefIds)],question:input.question??null,angle:angle&&typeof angle==='object'?{...angle,evidence:angle.evidence.map(({title,...e})=>e)}:angle});
 return w.repository.transaction(()=>{
  const old=w.db.prepare('SELECT * FROM intelligence_topic_intents WHERE operation_id=?').get(operationId);
  if(old){if(old.payload_hash!==hash)throw bad('操作标识已用于其他选题，请重新提交',409);return {research:getResearch(w,old.research_id),reused:true};}
  let research=payload.researchId?getResearch(w,payload.researchId):createResearch(w,{question,notes});
  if(payload.researchId&&notes)research=saveResearch(w,research.id,{expectedVersion:research.version,notes:[research.notes,notes].filter(Boolean).join('\n\n')});
  const at=new Date().toISOString();
  for(const item of sources.values())attachSource(w,research.id,item);
  for(const b of briefs){
   w.db.prepare('INSERT OR IGNORE INTO intel_brief_researches(brief_id,research_id,created_at) VALUES(?,?,?)').run(b.id,research.id,at);
   w.db.prepare('INSERT INTO intel_feedback(id,brief_id,version,action,value,created_at) VALUES(?,?,?,?,1,?)').run(createUlid(),b.id,b.version,'topic_saved',at);
   for(const c of b.conversations||[])researchConversation(w,research.id,{conversationId:c.id});
  }
  const data={...payload,sourceIds,briefVersions:Object.fromEntries(briefs.map(b=>[b.id,b.version])),evidence:briefs.flatMap(b=>b.evidence||[]),nonClaims:[...new Set([...briefs.flatMap(b=>b.uncertainties||[]),'来源作者的经历不等于我的个人经历；情报解读与选题角度仍需核对'])]};
  w.db.prepare('INSERT INTO intelligence_topic_intents(operation_id,payload_hash,research_id,data_json,created_at) VALUES(?,?,?,?,?)').run(operationId,hash,research.id,JSON.stringify(data),at);
  w.domain.audit('intelligence.topic_intent',research.id,{operationId,briefIds:ids,sourceIds});
  return {research:getResearch(w,research.id),reused:false};
 });
}
export function researchIntelligenceIntents(w,id){
 if(!w.db.prepare("SELECT name FROM sqlite_master WHERE name='intelligence_topic_intents'").get())return [];
 return w.db.prepare('SELECT operation_id,data_json,created_at FROM intelligence_topic_intents WHERE research_id=? ORDER BY created_at').all(id).map(r=>({operationId:r.operation_id,...visibleIntent(w,JSON.parse(r.data_json)),createdAt:r.created_at}));
}
export function researchIntelligenceRestricted(w,id,purpose="export"){
 if(!w.db.prepare("SELECT name FROM sqlite_master WHERE name='intel_brief_researches'").get())return false;
 const ids=new Set();
 for(const r of w.db.prepare('SELECT data_json FROM intel_cards WHERE research_id=?').all(id))for(const e of JSON.parse(r.data_json).evidence||[])ids.add(e.sourceId);
 for(const r of w.db.prepare('SELECT b.data_json FROM intel_briefs b JOIN intel_brief_researches l ON l.brief_id=b.id WHERE l.research_id=?').all(id))for(const e of JSON.parse(r.data_json).evidence||[])ids.add(e.sourceId);
 for(const r of w.db.prepare("SELECT s.id FROM intel_sources s JOIN research_references f ON f.entity_id=s.capture_id AND f.kind='capture' WHERE f.research_id=?").all(id))ids.add(r.id);
 for(const sourceId of ids){try{assertSourcePermission(source(w,sourceId),purpose);}catch{return true;}}
 return false;
}
function visibleIntent(w,data){
 const unavailable=(data.sourceIds||[]).some(id=>{try{source(w,id);return false;}catch{return true;}});
 return unavailable?{briefIds:data.briefIds,sourceIds:data.sourceIds,angle:null,notes:'引用权限已变化或资料已过期，请重新核查',evidence:[],nonClaims:['引用权限已变化或资料已过期，请重新核查'],unavailable:true}:visibleDerived(w,data);
}
export function legacyResearchTopics(w){
 if(!w.db.prepare("SELECT name FROM sqlite_master WHERE name='intelligence_legacy_topics'").get())return [];
 const linked=new Set(w.db.prepare('SELECT kind,legacy_id FROM intelligence_legacy_topics').all().map(x=>`${x.kind}:${x.legacy_id}`));
 const rows=w.db.prepare("SELECT * FROM intel_cards WHERE status IN ('watch','adopted') AND research_id IS NULL").all().filter(r=>!linked.has(`intel:${r.id}`)).map(r=>{const raw=JSON.parse(r.data_json),d=visibleIntent(w,{...raw,sourceIds:(raw.evidence||[]).map(e=>e.sourceId)});return {kind:'intel',id:r.id,title:d.workingTitle||d.question||'历史选题',notes:d.angle||d.why||'',updatedAt:r.updated_at,createdAt:r.created_at};});
 for(const o of w.contentBridge.opportunities())if(!linked.has(`bridge:${o.id}`)&&!(o.projectId&&w.db.prepare('SELECT research_id FROM research_projects WHERE project_id=? LIMIT 1').get(o.projectId)))rows.push({kind:'bridge',id:o.id,title:o.audienceProblemStatement||o.coreClaim,notes:o.fitReason,updatedAt:o.updatedAt,createdAt:o.createdAt});
 return rows.map(r=>({id:`legacy:${r.kind}:${r.id}`,title:r.title,question:r.title,notes:r.notes,excerpt:r.notes.slice(0,240),openQuestions:'',version:0,createdAt:r.createdAt,updatedAt:r.updatedAt,references:[],conversations:[],projects:[],legacyTopic:{kind:r.kind,id:r.id}}));
}
export function openLegacyIntelligenceTopic(w,kind,id,input){
 if(input?.confirmed!==true)throw bad('请确认将历史选题带入统一选题列表');
 if(!['intel','bridge'].includes(kind))throw bad('历史选题类型无效');
 return w.repository.transaction(()=>{
  const linked=w.db.prepare('SELECT research_id FROM intelligence_legacy_topics WHERE kind=? AND legacy_id=?').get(kind,id);
  if(linked)return getResearch(w,linked.research_id);
  let research;
  if(kind==='intel'){
   const r=w.db.prepare('SELECT * FROM intel_cards WHERE id=?').get(id);if(!r)throw bad('选题不存在',404);
   if(r.research_id)return getResearch(w,r.research_id);
   if(!['watch','adopted'].includes(r.status))throw bad('尚未确认的AI候选不能自动成为选题',409);
   const d=JSON.parse(r.data_json),sources=[...new Set((d.evidence||[]).map(e=>e.sourceId))].map(s=>source(w,s));
   for(const e of d.evidence||[]){const s=sources.find(s=>s.id===e.sourceId);if(!sourceContainsVerbatim(s.body,e.quote))throw bad('历史依据已变化，请重新核查',409);}
   research=createResearch(w,{question:d.workingTitle||d.question||'历史选题',notes:[d.whyNow||d.why,d.angle,'证据边界：',...(d.nonClaims||[]),'材料中的作者经历不能作为我的个人经历'].filter(Boolean).join('\n\n'),openQuestions:[...(d.evidenceGaps||[d.gaps]),...(d.researchTasks||[])].filter(Boolean).join('\n')});
   for(const s of sources)attachSource(w,research.id,s);
   for(const b of d.briefIds||[])if(w.db.prepare('SELECT id FROM intel_briefs WHERE id=?').get(b))w.db.prepare('INSERT OR IGNORE INTO intel_brief_researches(brief_id,research_id,created_at) VALUES(?,?,?)').run(b,research.id,new Date().toISOString());
   for(const k of d.wiki||[]){try{researchReference(w,research.id,{kind:'wiki',id:k.id});}catch(e){if(e.status!==404)throw e;}}
   w.db.prepare("UPDATE intel_cards SET research_id=?,status='adopted',readiness='in_progress' WHERE id=?").run(research.id,id);
  }else{
   const o=w.contentBridge.opportunity(id);if(!o||o.status!=='active')throw bad('历史机会不可用',404);
   const project=w.db.prepare("SELECT project_id FROM content_project_opportunities WHERE opportunity_id=? AND role='primary'").get(id);
   if(project){const existing=w.db.prepare('SELECT research_id FROM research_projects WHERE project_id=? ORDER BY created_at LIMIT 1').get(project.project_id);if(existing)return getResearch(w,existing.research_id);}
   const d=JSON.parse(w.db.prepare('SELECT planning_json FROM content_opportunities WHERE id=?').get(id).planning_json);
   research=createResearch(w,{question:d.workingTitle||o.coreClaim,notes:[o.knowledgeExplanation,d.angle||o.coreClaim,o.fitReason,...(d.nonClaims||[])].filter(Boolean).join('\n\n'),openQuestions:[o.cognitiveGap,...(d.evidenceGaps||[]),...(d.researchTasks||[])].filter(Boolean).join('\n')});
   researchReference(w,research.id,{kind:'wiki',id:o.wikiPageId});
   if(project)w.db.prepare('INSERT OR IGNORE INTO research_projects(research_id,project_id,selected_text,created_at) VALUES(?,?,?,?)').run(research.id,project.project_id,'',new Date().toISOString());
  }
  w.db.prepare('INSERT INTO intelligence_legacy_topics(kind,legacy_id,research_id,created_at) VALUES(?,?,?,?)').run(kind,id,research.id,new Date().toISOString());
  w.domain.audit('intelligence.legacy_topic_opened',research.id,{kind,legacyId:id});
  return getResearch(w,research.id);
 });
}
