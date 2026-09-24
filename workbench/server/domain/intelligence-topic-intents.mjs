import { canonicalBriefId } from './intelligence-unified.mjs';
import { assertSourcePermission, sourcePermission, visibleDerived } from '../acquisition/compatibility.mjs';
import { createUlid } from '../storage/ids.mjs';
import { sha256Json, sourceContainsVerbatim } from './integrity.mjs';
import { sourceFromRow } from './intelligence-quality.mjs';
import { intelligenceBrief } from './intelligence-feed.mjs';
import { createResearch, getResearch, saveResearch, researchReference, researchConversation, ensureResearchProject } from './research.mjs';
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(value,max=20000)=>{if(typeof value!=='string'||value.length>max)throw bad('选题文字格式或长度无效');return value.trim();};
function source(w,id){
 const row=w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(id);
 if(!row||row.deleted_at||(row.expires_at&&Date.parse(row.expires_at)<=Date.now()))throw bad('引用资料已过期或移除，请重新选择',409);
 const item=sourceFromRow(row);assertSourcePermission(item,'export');return item;
}
/**
 * 加入选题时，一份资料能带走多少：
 * - 有导出许可：整篇复制进研究（原逻辑）；
 * - 没有导出许可（新采集资料的默认状态）或 Reddit 原文已按保留期清除：只挂标题和原文链接，
 *   卡片里经过核验的短引文仍随选题意图保存。
 * 用户删除的资料、撤回 AI 许可的资料仍然拒绝。
 */
function sourceState(w,id){
 const row=w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(id);
 if(!row)return null;
 const retired=row.content_status==='retention_expired'||(!row.deleted_at&&Boolean(row.expires_at)&&Date.parse(row.expires_at)<=Date.now());
 if(row.deleted_at&&!retired)return null;
 const item=sourceFromRow(row),raw=JSON.parse(row.data_json||'{}');
 if(!retired&&row.acquisition_identity&&!sourcePermission(item,'ai'))return null;
 return {item,retired,exportable:!retired&&sourcePermission(item,'export'),url:raw.url||'',title:raw.title&&!retired?raw.title:''};
}
function attachLink(w,researchId,state,fallback){
 const id=w.domain.createCapture({kind:'web',title:state.title||fallback.title||'原文链接',bodyMarkdown:'',sourceUrl:state.url||fallback.url||'',actor:'user',confirmed:true});
 researchReference(w,researchId,{kind:'capture',id});
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
const WINDOWS=['24h','week','evergreen'];
/**
 * 按创作建议加入选题：切入方向、建议时效、读者价值和开写前还缺什么（2026-09-24）。
 * 时效只是建议，不再生成「点击时刻 + 1 天」这种看起来像客观截止日的日期；要不要定截止由用户自己决定。
 */
function normalizeTopicCreation(input){
 if(input==null)return null;
 if(typeof input!=='object'||Array.isArray(input))throw bad('选题做法格式无效');
 const angle=text(input.angle??'',400),readerValue=text(input.readerValue??'',400);
 if(input.window!==undefined&&input.window!==null&&!WINDOWS.includes(input.window))throw bad('选题时效无效');
 if(input.needs!==undefined&&(!Array.isArray(input.needs)||input.needs.length>5))throw bad('选题待补材料格式无效');
 const needs=(input.needs||[]).map(x=>text(x,300)).filter(Boolean);
 return {angle,window:input.window||null,...(readerValue?{readerValue}:{}),...(needs.length?{needs}:{})};
}
/** 深读里的知识连接：只带引用和连接理由（记下当时的 Wiki 版本），不复制 Wiki 全文。 */
function wikiLinksOf(briefs){
 const seen=new Set(),links=[];
 for(const b of briefs)for(const k of b.wiki||[]){if(!k?.id||seen.has(k.id))continue;seen.add(k.id);links.push({id:k.id,title:k.title||'',revision:k.revision??null,relation:k.relation||null,point:k.point||k.reason||'',...(k.quote?{quote:k.quote}:{}),...(k.application?{application:k.application}:{})});}
 return links.slice(0,6);
}
export function createIntelligenceTopicIntent(w,input){
 if(input?.confirmed!==true)throw bad('请确认将情报加入选题');
 const operationId=text(input.operationId,160);if(!operationId)throw bad('缺少本次操作标识');
 if(!Array.isArray(input.briefIds)||!input.briefIds.length||input.briefIds.length>8||input.briefIds.some(x=>typeof x!=='string'))throw bad('请选择1至8条情报');
 const ids=[...new Set(input.briefIds.map(id=>canonicalBriefId(w,id)))];
 // Re-read stored evidence instead of trusting a redacted client projection.
 const sourceIds=[...new Set(ids.flatMap(id=>{const r=w.db.prepare('SELECT data_json FROM intel_briefs WHERE id=?').get(id);if(!r)throw bad('情报不存在',404);return (JSON.parse(r.data_json).evidence||[]).map(e=>e.sourceId);} ))];
 if(!sourceIds.length)throw bad('情报缺少可核对的来源',409);
 const states=new Map(sourceIds.map(id=>[id,sourceState(w,id)]));
 if([...states.values()].some(x=>!x))throw bad('引用资料已移除或权限已变化，请重新核查',409);
 const sources=new Map([...states].filter(([,x])=>!x.retired).map(([id,x])=>[id,x.item]));
 const evidenceUrl=new Map();
 // 原文已按保留期清除的，引文在生成卡片时已核验过，这里无从再比对，沿用当时的结果。
 for(const id of ids){const d=JSON.parse(w.db.prepare('SELECT data_json FROM intel_briefs WHERE id=?').get(id).data_json);for(const e of d.evidence||[]){if(e.url)evidenceUrl.set(e.sourceId,e.url);if(states.get(e.sourceId).retired||e.headline)continue;if(!sourceContainsVerbatim(sources.get(e.sourceId).body,e.quote))throw bad('情报引用的原文已经变化，请重新核查',409);}}
 const briefs=ids.map(id=>intelligenceBrief(w,id));
 const creation=normalizeTopicCreation(input.creation);
 const angle=normalizeAngle(input.angle,sources),notes=text(input.notes??''),question=text(input.question??((typeof angle==='object'&&angle?.question)||creation?.angle||briefs[0].title),1000);
 const payload={briefIds:ids,angle,notes,question,researchId:input.researchId?text(input.researchId,160):null,creation};
 // 截止时间按调用时刻算，不能进幂等签名，否则重试会被当成另一次操作。
 const hash=sha256Json({...payload,briefIds:[...new Set(input.briefIds)],question:input.question??null,angle:angle&&typeof angle==='object'?{...angle,evidence:angle.evidence.map(({title,...e})=>e)}:angle});
 const wikiLinks=wikiLinksOf(briefs);
 // 开写前还缺什么：创作建议里的待补材料，加上解读里最主要的几条不确定项。
 const open=[...(creation?.needs||[]),...briefs.flatMap(b=>b.uncertainties||[]).slice(0,3)].filter(Boolean);
 const openQuestions=[...new Set(open)].map(x=>`- ${x}`).join('\n');
 return w.repository.transaction(()=>{
  const old=w.db.prepare('SELECT * FROM intelligence_topic_intents WHERE operation_id=?').get(operationId);
  if(old){if(old.payload_hash!==hash)throw bad('操作标识已用于其他选题，请重新提交',409);const {projectId}=ensureResearchProject(w,old.research_id);return {research:getResearch(w,old.research_id),projectId,reused:true};}
  let research=payload.researchId?getResearch(w,payload.researchId):createResearch(w,{question,notes,openQuestions});
  if(payload.researchId&&(notes||openQuestions))research=saveResearch(w,research.id,{expectedVersion:research.version,...(notes?{notes:[research.notes,notes].filter(Boolean).join('\n\n')}:{}),...(openQuestions?{openQuestions:[research.openQuestions,openQuestions].filter(Boolean).join('\n')}:{})});
  const at=new Date().toISOString();
  for(const [id,state] of states){if(state.exportable)attachSource(w,research.id,state.item);else attachLink(w,research.id,state,{title:briefs[0].title,url:evidenceUrl.get(id)});}
  for(const b of briefs){
   w.db.prepare('INSERT OR IGNORE INTO intel_brief_researches(brief_id,research_id,created_at) VALUES(?,?,?)').run(b.id,research.id,at);
   w.db.prepare('INSERT INTO intel_feedback(id,brief_id,version,action,value,created_at) VALUES(?,?,?,?,1,?)').run(createUlid(),b.id,b.version,'topic_saved',at);
   for(const c of b.conversations||[])researchConversation(w,research.id,{conversationId:c.id});
  }
  // 帮你形成判断的那几篇 Wiki 一起挂到选题上（词条被删了就跳过，不挡住保存）。
  for(const k of wikiLinks){try{researchReference(w,research.id,{kind:'wiki',id:k.id});}catch(e){if(e.status!==404)throw e;}}
  const data={...payload,sourceIds,wikiLinks,briefVersions:Object.fromEntries(briefs.map(b=>[b.id,b.version])),evidence:briefs.flatMap(b=>b.evidence||[]),nonClaims:[...new Set([...briefs.flatMap(b=>b.uncertainties||[]),'来源作者的经历不等于我的个人经历；情报解读与选题角度仍需核对'])]};
  w.db.prepare('INSERT INTO intelligence_topic_intents(operation_id,payload_hash,research_id,data_json,created_at) VALUES(?,?,?,?,?)').run(operationId,hash,research.id,JSON.stringify(data),at);
  w.domain.audit('intelligence.topic_intent',research.id,{operationId,briefIds:ids,sourceIds});
  // 加入选题就是建一篇内容（2026-09-24）：构思按研究预填；加入已有选题时新的待补项追加进那篇的清单。
  const {projectId}=ensureResearchProject(w,research.id,{extraItems:[...new Set(open)]});
  return {research:getResearch(w,research.id),projectId,reused:false};
 });
}
/** 构思里「为什么写」要的卡片概要：取当前版本（合并过的取规范卡），只读卡片记录，不拼整张详情。 */
function briefSummary(w,id){
 if(!id)return null;
 try{
  const r=w.db.prepare('SELECT id,data_json FROM intel_briefs WHERE id=?').get(canonicalBriefId(w,id));if(!r)return null;
  const d=visibleDerived(w,JSON.parse(r.data_json));
  return {id:r.id,title:d.title||'',summary:d.summary||'',whyItMatters:d.whyItMatters||'',keyFacts:(d.keyFacts||[]).map(f=>typeof f==='string'?f:f?.text).filter(Boolean).slice(0,6)};
 }catch{return null;}
}
export function researchIntelligenceIntents(w,id){
 if(!w.db.prepare("SELECT name FROM sqlite_master WHERE name='intelligence_topic_intents'").get())return [];
 return w.db.prepare('SELECT operation_id,data_json,created_at FROM intelligence_topic_intents WHERE research_id=? ORDER BY created_at').all(id).map(r=>{const v=visibleIntent(w,JSON.parse(r.data_json));return {operationId:r.operation_id,...v,...(v.unavailable?{}:{brief:briefSummary(w,v.briefIds?.[0])}),createdAt:r.created_at};});
}
export function researchIntelligenceRestricted(w,id,purpose="export"){
 if(!w.db.prepare("SELECT name FROM sqlite_master WHERE name='intel_brief_researches'").get())return false;
 // 复制过原文的来源（capture 里有正文）按导出许可检查；只挂了链接的来源没有复制任何原文，
 // 只在被删除或撤回 AI 许可时才让选题受限（2026-09-23，热点事件卡的来源默认只挂链接）。
 const linked=new Set(),copied=new Set();
 for(const r of w.db.prepare('SELECT data_json FROM intel_cards WHERE research_id=?').all(id))for(const e of JSON.parse(r.data_json).evidence||[])linked.add(e.sourceId);
 for(const r of w.db.prepare('SELECT b.data_json FROM intel_briefs b JOIN intel_brief_researches l ON l.brief_id=b.id WHERE l.research_id=?').all(id))for(const e of JSON.parse(r.data_json).evidence||[])linked.add(e.sourceId);
 for(const r of w.db.prepare("SELECT s.id FROM intel_sources s JOIN research_references f ON f.entity_id=s.capture_id AND f.kind='capture' WHERE f.research_id=?").all(id))copied.add(r.id);
 for(const sourceId of copied){try{assertSourcePermission(source(w,sourceId),purpose);}catch{return true;}}
 for(const sourceId of linked){if(copied.has(sourceId))continue;if(!sourceState(w,sourceId))return true;}
 return false;
}
function visibleIntent(w,data){
 const unavailable=(data.sourceIds||[]).some(id=>!sourceState(w,id));
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
