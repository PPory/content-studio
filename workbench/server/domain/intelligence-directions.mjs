import {sha256Json} from './integrity.mjs';
import {readDiscoveryCache} from './content-discovery.mjs';
import {createResearch,getResearch,saveResearch,researchReference,researchConversation,ensureResearchProject} from './research.mjs';
import {getProjectNotebook,saveProjectNotebook} from './project-notebook.mjs';
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
export const directionKey=c=>sha256Json(c);
export function directionDetail(w,id){
 const row=w.db.prepare('SELECT * FROM intel_directions WHERE id=?').get(id);
 if(!row)throw bad('方向不存在',404);
 const scopeId=`direction:${id}`;
 const conversations=w.db.prepare('SELECT c.id,c.title FROM ai_conversations c JOIN entities e ON e.id=c.id WHERE c.scope_id=? AND e.deleted_at IS NULL ORDER BY e.updated_at DESC').all(scopeId);
 return {id,connection:JSON.parse(row.connection_json),researchId:row.research_id,dismissed:Boolean(row.dismissed),updatedAt:row.updated_at,scopeId,conversations};
}
// `dismissed=0`：移除过的方向不再出现在「已保存」里，但行还在，可以恢复。
export function savedDirections(w){return w.db.prepare('SELECT id FROM intel_directions WHERE dismissed=0 ORDER BY updated_at DESC').all().map(r=>directionDetail(w,r.id));}
/** 移除 / 恢复一个已保存的方向。只动标记位——已带入选题的正文在 researches 里，不受影响。 */
export function dismissDirection(w,id,dismissed=true){
 if(typeof id!=='string'||id.length!==64)throw bad('方向标识无效');
 if(!w.db.prepare('SELECT id FROM intel_directions WHERE id=?').get(id))throw bad('方向不存在',404);
 w.db.prepare('UPDATE intel_directions SET dismissed=?,updated_at=? WHERE id=?').run(dismissed?1:0,new Date().toISOString(),id);
 return directionDetail(w,id);
}
export function keepDirection(w,id){
 if(typeof id!=='string'||id.length!==64)throw bad('方向标识无效');
 // ⚠️ **行已经在了就顺手清掉 `dismissed`。** 再保存一次的意思就是要它回来；
 // 不清的话这次保存会「成功」，而「已保存」列表里查无此条——而且不会报错。
 if(w.db.prepare('SELECT id FROM intel_directions WHERE id=?').get(id))return dismissDirection(w,id,false);
 const connection=readDiscoveryCache(w)?.connections?.find(c=>directionKey(c)===id);
 if(!connection)throw bad('候选已更新，请重新选择方向',409);
 const now=new Date().toISOString();
 w.db.prepare('INSERT INTO intel_directions(id,connection_json,created_at,updated_at) VALUES(?,?,?,?)').run(id,JSON.stringify(connection),now,now);
 return directionDetail(w,id);
}
export function directionNotes(c){return [
 `## 待研究的方向\n\n${c.coreClaim}`,
 `### 为什么值得关注\n\n${c.fitReason}\n\n${c.problem.statement}\n\n${c.problem.evidenceLabel}`,
 `### 可以怎样理解\n\n${c.knowledgeExplanation}`,
 `### 可能带来的新认识\n\n${c.cognitiveGap}`,
 `### 还需要验证\n\n${(c.evidenceGaps||[]).join('\n')}`,
 `### 形成依据\n\n${[...(c.basis||[]).map(s=>`${s.title}\n${s.quote}\n${s.url||''}`),...(c.problem.evidence||[]).map(e=>`${e.sourceName||'记录'}\n${e.quote}`),...(c.knowledgeAnchors||[]).map(k=>`${k.title}：${k.reason}`)].join('\n\n')}`
 ].join('\n\n');}
export function developDirection(w,id,input={}){
 if(input.confirmed!==true)throw bad('请确认后带入选题');
 return w.repository.transaction(()=>{
 const d=directionDetail(w,id),c=d.connection;
 if(d.researchId){for(const chat of d.conversations)researchConversation(w,d.researchId,{conversationId:chat.id});return getResearch(w,d.researchId);}
 const question=input.question||c.problem.statement;
 if(typeof question!=='string'||!question.trim()||question.length>1000)throw bad('请输入1000字以内的问题');
 let research=input.researchId?getResearch(w,input.researchId):createResearch(w,{question,notes:''});
 research=saveResearch(w,research.id,{expectedVersion:research.version,notes:[research.notes,directionNotes(c)].filter(Boolean).join('\n\n')});
 for(const k of c.knowledgeAnchors||[]){try{researchReference(w,research.id,{kind:'wiki',id:k.wikiPageId});}catch(e){if(e.status!==404)throw e;}}
 for(const evidence of new Map((c.problem.evidence||[]).map(e=>[e.rawSourceId,e])).values()){
  const original=w.audienceRaw.source(evidence.rawSourceId);
  const captureId=w.domain.createCapture({kind:'excerpt',title:original.sourceName||'方向引用的原始记录',bodyMarkdown:original.body,sourceUrl:original.sourceUrl||'',actor:'user',confirmed:true});
  researchReference(w,research.id,{kind:'capture',id:captureId});
 }
 for(const s of c.basis||[]){
  if(s.kind==='capture'){researchReference(w,research.id,{kind:'capture',id:s.id});continue;}
  const row=w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(s.id);
  if(!row)throw bad('原始资料已不可用，请重新调研');
  const source=JSON.parse(row.data_json);
  let existingCapture=row.capture_id;if(existingCapture){try{w.domain.entity(existingCapture,'capture');}catch(e){if(e.status!==404)throw e;existingCapture=null;}}
  const captureId=existingCapture||w.domain.createCapture({kind:source.url?'web':'excerpt',title:source.title,bodyMarkdown:source.body,sourceUrl:source.url,actor:'user',confirmed:true});
  if(!existingCapture)w.db.prepare('UPDATE intel_sources SET capture_id=? WHERE id=?').run(captureId,s.id);
  researchReference(w,research.id,{kind:'capture',id:captureId});
 }
 for(const chat of d.conversations)researchConversation(w,research.id,{conversationId:chat.id});
 w.db.prepare('UPDATE intel_directions SET research_id=?,updated_at=? WHERE id=?').run(research.id,new Date().toISOString(),id);
 return getResearch(w,research.id);
 });
}
/**
 * 「来自我的知识」一列的「加入选题」（2026-09-24）：保存方向 → 带入选题 → 建这篇内容，一步完成。
 * 找到的「知识 × 读者问题」写进构思的 discovery.connection，选题第一步「读懂」和角度生成都用它；
 * 构思里已经写过的不覆盖。可重复调用。
 */
export function directionToContent(w,id){
 keepDirection(w,id);
 const research=developDirection(w,id,{confirmed:true});
 const {projectId}=ensureResearchProject(w,research.id);
 const c=directionDetail(w,id).connection,nb=getProjectNotebook(w,projectId);
 if(!nb.discovery?.connection)saveProjectNotebook(w,projectId,{expectedVersion:nb.version,discovery:{...(nb.discovery||{}),connection:c},...(nb.thought&&nb.thought!==research.question?{}:{thought:c.coreClaim||nb.thought})});
 return {projectId,researchId:research.id};
}
