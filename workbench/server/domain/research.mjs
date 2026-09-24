import { sourcePermission } from '../acquisition/compatibility.mjs';
import { sourceFromRow } from './intelligence-quality.mjs';
import { legacyResearchTopics, researchIntelligenceIntents, researchIntelligenceRestricted } from './intelligence-topic-intents.mjs';
import { initializeNote } from "./personal-assets.mjs";
import { createUlid } from "../storage/ids.mjs";
import { createHash } from "node:crypto";
import { createProjectExploration, getProjectNotebook, saveProjectNotebook } from "./project-notebook.mjs";
import { appendItems, checklistFromLines } from "../../src/lib/content-checklist.js";
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const stamp = () => new Date().toISOString();
function text(value, max = 100000) {
  if (typeof value !== "string" || value.length > max) throw error(`文字不能超过 ${max} 字符`);
  return value;
}
function inputObject(input, keys) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw error("数据格式无效");
}
function researchRow(w, id) {
  const row = w.db.prepare(`SELECT r.*,e.deleted_at FROM researches r JOIN entities e ON e.id=r.id WHERE r.id=? AND e.deleted_at IS NULL`).get(id);
  if (!row) throw error("研究不存在", 404);
  return row;
}
const librarySql = `SELECT m.id,'material' kind,m.title,m.body_markdown body,m.source_url sourceUrl,m.material_type nature,e.updated_at updatedAt FROM materials m JOIN entities e ON e.id=m.id WHERE e.deleted_at IS NULL
 UNION ALL SELECT p.id,'wiki',p.title,p.body_markdown,'','知识笔记',e.updated_at FROM wiki_pages p JOIN entities e ON e.id=p.id WHERE e.deleted_at IS NULL
 UNION ALL SELECT c.id,'capture',c.title,c.body_markdown,c.source_url,CASE WHEN c.capture_kind='thought' THEN '随手记' ELSE '原文' END,e.updated_at FROM captures c JOIN entities e ON e.id=c.id WHERE e.deleted_at IS NULL AND c.status!='discarded'
 UNION ALL SELECT s.id,'seed',s.title,s.reaction,'','想法',e.updated_at FROM seeds s JOIN entities e ON e.id=s.id WHERE e.deleted_at IS NULL
 UNION ALL SELECT d.id,'source',CASE WHEN d.title=b.title THEN d.title ELSE b.title||' · '||d.title END,d.body_markdown,b.source_url,b.source_kind||'原文',e.updated_at FROM book_documents d JOIN entities e ON e.id=d.id JOIN books b ON b.id=d.book_id JOIN entities be ON be.id=b.id WHERE e.deleted_at IS NULL AND be.deleted_at IS NULL
 UNION ALL SELECT k.id,'source',k.title,k.body_markdown,k.source_url,'阅读记录',e.updated_at FROM knowledge_items k JOIN entities e ON e.id=k.id WHERE e.deleted_at IS NULL`;
export function libraryItems(w, { q = "", kind = "", limit = 100 } = {}) {
  text(q, 500); text(kind, 20);
  const size = Number.isSafeInteger(Number(limit)) ? Math.max(1,Math.min(200,Number(limit))) : 100;
  if (kind && !["material","wiki","source","capture","seed"].includes(kind)) throw error("资料类型无效");
  return w.db.prepare(`SELECT *,substr(body,1,500) excerpt FROM (${librarySql}) WHERE (?='' OR kind=?) AND (?='' OR instr(lower(title||char(10)||body),lower(?))>0) ORDER BY updatedAt DESC LIMIT ?`).all(kind,kind,q,q,size).map(({body,...item}) => {if(item.kind!=="capture")return item;const {body:raw,...visible}=libraryItem(w,item.kind,item.id);return {...visible,excerpt:visible.excerpt.slice(0,500)};});
}
export function libraryItem(w, kind, id) {
  const item = w.db.prepare(`SELECT *,substr(body,1,20000) excerpt FROM (${librarySql}) WHERE kind=? AND id=?`).get(kind,id);
  if (!item) throw error("资料不存在或已移除",404);
  if(kind==='capture') {
    const sources=w.db.prepare('SELECT * FROM intel_sources WHERE capture_id=?').all(id);
    if(sources.some(row=>row.deleted_at||(row.expires_at&&Date.parse(row.expires_at)<=Date.now())||!sourcePermission(sourceFromRow(row),'export')))return {...item,title:'引用资料不可用',body:'',sourceUrl:'',excerpt:'引用权限已变化或资料已过期，请重新核查',unavailable:true};
  }
  return item;
}
export function getResearch(w,id) {
  const row = researchRow(w,id);
  const contentRestricted=researchIntelligenceRestricted(w,id),restrictionMessage='引用权限已变化或资料已过期，相关选题内容暂不可读取。原文仍保留，恢复权限后可继续编辑。';
  const references = w.db.prepare("SELECT kind,entity_id id FROM research_references WHERE research_id=? ORDER BY created_at").all(id).map(ref => {
    try { const {body,...item} = libraryItem(w,ref.kind,ref.id); return item; }
    catch (e) { if(e.status!==404) throw e; return {...ref,title:"资料已移除",excerpt:"",missing:true}; }
  });
  const conversations = w.db.prepare(`SELECT DISTINCT c.id,c.title,c.scope_id scopeId,e.updated_at updatedAt FROM ai_conversations c JOIN entities e ON e.id=c.id AND e.deleted_at IS NULL WHERE c.scope_id=? OR c.id IN (SELECT conversation_id FROM research_conversations WHERE research_id=?) ORDER BY e.updated_at DESC`).all(`research:${id}`,id);
  const projects = w.db.prepare(`SELECT p.id,p.title,l.selected_text selectedText FROM research_projects l JOIN projects p ON p.id=l.project_id JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL WHERE l.research_id=? ORDER BY l.created_at DESC`).all(id);
  return {id,contentRestricted,title:contentRestricted?"引用受限的选题":row.question || "未命名研究",question:contentRestricted?"引用受限的选题":row.question,notes:contentRestricted?restrictionMessage:row.notes,openQuestions:contentRestricted?"":row.open_questions,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,scopeId:`research:${id}`,references,conversations,projects,intelligenceIntents:researchIntelligenceIntents(w,id)};
}
export function listResearches(w) {
  return [...w.db.prepare("SELECT r.id FROM researches r JOIN entities e ON e.id=r.id WHERE e.deleted_at IS NULL ORDER BY r.updated_at DESC").all().map(({id}) => {const r=getResearch(w,id);return {...r,excerpt:r.notes.slice(0,240),projectId:r.projects[0]?.id||null};}),...legacyResearchTopics(w)].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
/**
 * 把一个选题移入回收站 / 拿回来。
 *
 * ⚠️ **软删除，不删行。** `listResearches` 已经在过滤 `deleted_at IS NULL`，
 * 所以这里只要动 entity 那一层；引用（`research_references` 是 ON DELETE RESTRICT）、
 * 讨论、带入记录都原样留着，恢复之后还是原来那一条。
 */
export function trashResearch(w,id){
 const row=w.db.prepare("SELECT r.id,r.question FROM researches r JOIN entities e ON e.id=r.id AND e.deleted_at IS NULL WHERE r.id=?").get(id);
 if(!row)throw Object.assign(new Error("选题不存在或已经移入回收站"),{status:404});
 w.domain.softDeleteEntity(id,{actor:"user",now:new Date()});
 return {id:row.id,question:row.question,recoverable:true};
}
export function restoreResearch(w,id){
 const row=w.db.prepare("SELECT id,question FROM researches WHERE id=?").get(id);
 if(!row)throw Object.assign(new Error("选题不存在"),{status:404});
 w.domain.restoreEntity(id,{actor:"user",now:new Date()});
 return {id:row.id,question:row.question};
}

export function createResearch(w,input) {
  inputObject(input,["question","notes","openQuestions"]);
  const question=text(input.question ?? "",1000),notes=text(input.notes ?? ""),openQuestions=text(input.openQuestions ?? "",20000);
  return w.repository.transaction(() => {
    const id=createUlid(),now=stamp();
    w.repository.createEntity({id,type:"research",now:new Date(now)});
    w.db.prepare("INSERT INTO researches(id,question,notes,open_questions,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id,question,notes,openQuestions,now,now);
    w.repository.setEntityText(id,{title:question,body:notes,now:new Date(now)});
    w.domain.audit("research.created",id);
    return getResearch(w,id);
  });
}
export function saveResearch(w,id,input) {
  inputObject(input,["question","notes","openQuestions","expectedVersion"]);
  if (!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1) throw error("缺少有效版本号");
  for(const key of ["question","notes","openQuestions"]) if(Object.hasOwn(input,key)) text(input[key],key==="question"?1000:key==="notes"?100000:20000);
  return w.repository.transaction(() => {
    const row=researchRow(w,id);
    if(researchIntelligenceRestricted(w,id))throw error('引用资料不可用时不能覆盖选题原文，请先恢复来源权限或有效资料',403);
    if(row.version!==input.expectedVersion) throw error("研究已在另一处更新，请重新载入后再保存",409);
    const now=stamp(),question=input.question??row.question,notes=input.notes??row.notes;
    w.db.prepare("UPDATE researches SET question=?,notes=?,open_questions=?,version=version+1,updated_at=? WHERE id=?").run(question,notes,input.openQuestions??row.open_questions,now,id);
    w.repository.setEntityText(id,{title:question,body:notes,now:new Date(now)});w.domain.touch(id,new Date(now));w.domain.audit("research.saved",id,{version:row.version+1});
    return getResearch(w,id);
  });
}
export function researchReference(w,id,input,remove=false) {
  inputObject(input,["kind","id"]);text(input.kind,20);text(input.id,160);researchRow(w,id);
  return w.repository.transaction(() => {
    if(remove) w.db.prepare("DELETE FROM research_references WHERE research_id=? AND entity_id=? AND kind=?").run(id,input.id,input.kind);
    else {libraryItem(w,input.kind,input.id);w.db.prepare("INSERT OR IGNORE INTO research_references(research_id,entity_id,kind,created_at) VALUES(?,?,?,?)").run(id,input.id,input.kind,stamp());}
    w.domain.audit(remove?"research.reference_removed":"research.reference_added",id,{kind:input.kind,id:input.id});return getResearch(w,id);
  });
}
export function researchConversation(w,id,input) {
  inputObject(input,["conversationId"]);text(input.conversationId,160);researchRow(w,id);
  const found=w.db.prepare("SELECT c.id FROM ai_conversations c JOIN entities e ON e.id=c.id WHERE c.id=? AND e.deleted_at IS NULL").get(input.conversationId);
  if(!found) throw error("讨论不存在",404);
  w.db.prepare("INSERT OR IGNORE INTO research_conversations(research_id,conversation_id,created_at) VALUES(?,?,?)").run(id,input.conversationId,stamp());
  return getResearch(w,id);
}
export function researchProject(w,id,input) {
  inputObject(input,["projectId","requestKey","title","selectedText"]);researchRow(w,id);
  return w.repository.transaction(() => {
    let created;
    if(input.projectId) {text(input.projectId,160);w.domain.entity(input.projectId,"project");created={projectId:input.projectId};}
    else {
      text(input.requestKey,120);
      const selectedText=text(input.selectedText,20000);
      if(!selectedText.trim()) throw error("请先选择要带入创作的文字");
      // A retry key belonging to a different research must not cross-link silently.
      const old=w.db.prepare("SELECT project_id,json_extract(notes_json,'$.discovery.research.id') research_id FROM project_notebooks WHERE request_key=?").get(input.requestKey);
      if(old && old.research_id!==id) throw error("请求 ID 已被其他创建操作使用",409);
      created=createProjectExploration(w,{requestKey:input.requestKey,title:input.title,thought:selectedText,discovery:{research:{id,scopeId:`research:${id}`}}});
    }
    w.db.prepare("INSERT OR IGNORE INTO research_projects(research_id,project_id,selected_text,created_at) VALUES(?,?,?,?)").run(id,created.projectId,input.selectedText===undefined?"":text(input.selectedText,20000),stamp());
    return {...created,research:getResearch(w,id)};
  });
}
/**
 * 一篇内容 = 一个工作区（2026-09-24）：研究记录继续承载挂上的资料、Wiki、情报意图和以前的讨论，
 * 构思和正文在它关联的内容项目里。两者一对一；这两个函数负责「缺哪边就补哪边」，都可以重复调用。
 */
const stableUuid = (seed) => { const h = createHash("sha256").update(seed).digest("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
function linkedProject(w, researchId) {
  return w.db.prepare("SELECT l.project_id id FROM research_projects l JOIN entities e ON e.id=l.project_id AND e.deleted_at IS NULL WHERE l.research_id=? ORDER BY l.created_at LIMIT 1").get(researchId)?.id || null;
}
/**
 * 研究 → 内容。没有关联内容时补建一篇，构思按研究预填：问题 → 想讲什么；未解的问题 → 还缺什么清单；
 * 笔记 → 我的判断与笔记；最近一次情报加入时的读者价值 → 读者能得到什么。原研究不改。
 * `extraItems`：已有内容时追加到清单里的新待补项（情报加入已有选题），不覆盖已写的内容。
 */
export function ensureResearchProject(w, id, { extraItems = [] } = {}) {
  researchRow(w, id);
  return w.repository.transaction(() => {
    const existing = linkedProject(w, id);
    if (existing) {
      if (extraItems.length) {
        const notebook = getProjectNotebook(w, existing), questions = appendItems(notebook.questions, extraItems);
        if (questions !== notebook.questions) saveProjectNotebook(w, existing, { expectedVersion: notebook.version, questions });
      }
      return { projectId: existing, created: false };
    }
    // 补建要读研究原文；来源权限变了就不能读（已建好的内容照常打开，受限提示在内容里显示）。
    const research = getResearch(w, id);
    if (research.contentRestricted) throw error("引用资料不可用时不能打开这个选题，请先恢复来源权限或有效资料", 403);
    const creation = (research.intelligenceIntents || []).map(i => i.creation).filter(Boolean).at(-1) || null;
    // 关联的内容删过时（旧数据：只删了项目），同一个幂等键会回放到已删的那篇——换一个键补建新的。
    const removed = w.db.prepare("SELECT COUNT(*) AS n FROM research_projects WHERE research_id=?").get(id).n;
    const { projectId, notebook } = createProjectExploration(w, { requestKey: stableUuid(`research-content:${id}${removed ? `:${removed}` : ""}`), title: (research.question || "未命名").slice(0, 200), thought: research.question || "", discovery: { research: { id, scopeId: `research:${id}` } } });
    const questions = appendItems(checklistFromLines(research.openQuestions || ""), extraItems);
    saveProjectNotebook(w, projectId, { expectedVersion: notebook.version, questions, evidenceNotes: research.notes || "", intent: creation?.readerValue || "" });
    w.db.prepare("INSERT OR IGNORE INTO research_projects(research_id,project_id,selected_text,created_at) VALUES(?,?,?,?)").run(id, projectId, "", stamp());
    w.domain.audit("research.content_created", id, { projectId });
    return { projectId, created: true };
  });
}
/**
 * 删掉一篇内容 = 连同它背后那条研究记录一起进回收站（2026-09-24）。
 *
 * ⚠️ 两者一对一：只删项目的话，研究记录会以「还没有内容的选题」重新出现在选题列表里，
 * 用户看到的就是「删不掉」。只带走**没有别的在用内容**的研究；同一个时间戳，恢复时据此一起回来。
 */
export function trashContent(w, projectId) {
  w.domain.entity(projectId, "project");
  const at = new Date();
  const drafts = w.db.prepare("SELECT COUNT(*) AS count FROM drafts d JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL WHERE d.project_id=?").get(projectId).count;
  const researches = w.db.prepare(`SELECT l.research_id id FROM research_projects l JOIN entities e ON e.id=l.research_id AND e.deleted_at IS NULL
    WHERE l.project_id=? AND NOT EXISTS (SELECT 1 FROM research_projects o JOIN entities oe ON oe.id=o.project_id AND oe.deleted_at IS NULL WHERE o.research_id=l.research_id AND o.project_id<>?)`).all(projectId, projectId).map((r) => r.id);
  return w.repository.transaction(() => {
    w.domain.softDeleteEntity(projectId, { actor: "user", now: at });
    for (const id of researches) w.domain.softDeleteEntity(id, { actor: "user", now: at });
    return { deleted: drafts, researches: researches.length, recoverable: true };
  });
}
/** 撤销删除：项目回来，和它同一刻进回收站的研究记录也回来（单独删过的不动）。 */
export function restoreContent(w, projectId) {
  const project = w.repository.getEntity(projectId, { includeDeleted: true });
  if (!project?.deletedAt) throw error("这篇内容不在回收站里", 404);
  const researches = w.db.prepare("SELECT l.research_id id FROM research_projects l JOIN entities e ON e.id=l.research_id WHERE l.project_id=? AND e.deleted_at=?").all(projectId, project.deletedAt).map((r) => r.id);
  return w.repository.transaction(() => {
    const at = new Date();
    w.domain.restoreEntity(projectId, { actor: "user", now: at });
    for (const id of researches) w.domain.restoreEntity(id, { actor: "user", now: at });
    return { researches: researches.length };
  });
}
/** 内容 → 研究：给一篇内容挂资料或情报时，需要它背后那条研究记录；没有就补一条（问题 = 内容标题）。 */
export function ensureProjectResearch(w, projectId) {
  w.domain.entity(projectId, "project");
  return w.repository.transaction(() => {
    const found = w.db.prepare("SELECT r.id FROM researches r JOIN research_projects l ON l.research_id=r.id JOIN entities e ON e.id=r.id AND e.deleted_at IS NULL WHERE l.project_id=? ORDER BY l.created_at LIMIT 1").get(projectId);
    if (found) return { researchId: found.id, created: false };
    const title = w.db.prepare("SELECT title FROM projects WHERE id=?").get(projectId)?.title || "";
    const research = createResearch(w, { question: title === "未命名" ? "" : title });
    w.db.prepare("INSERT OR IGNORE INTO research_projects(research_id,project_id,selected_text,created_at) VALUES(?,?,?,?)").run(research.id, projectId, "", stamp());
    return { researchId: research.id, created: true };
  });
}
export function projectResearches(w,id) {
  w.domain.entity(id,"project");
  return w.db.prepare("SELECT r.id FROM researches r JOIN research_projects l ON l.research_id=r.id JOIN entities e ON e.id=r.id AND e.deleted_at IS NULL WHERE l.project_id=? ORDER BY l.created_at").all(id).map(({id})=>getResearch(w,id));
}
export function quickNote(w,input) {
  inputObject(input,["text","sourceUrl","tags"]);const body=text(input.text);
  if(!body.trim()) throw error("请先写一点内容");
  const sourceUrl=text(input.sourceUrl??"",2000);
  if(sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw error("出处应为 http 或 https 链接");
  return w.repository.transaction(() => {
  const id=w.domain.createCapture({kind:"thought",title:body.trim().split("\n")[0].slice(0,80),bodyMarkdown:body,sourceUrl,actor:"user",confirmed:true});
  // A quick note is already saved; it is not an AI processing obligation.
  w.db.prepare("UPDATE captures SET status='accepted' WHERE id=?").run(id);
  return {...initializeNote(w,id,input),kind:"capture",nature:"随手记"};
  });
}
export function workState(w,kind,id,input) {
  if(!["research","project"].includes(kind)) throw error("工作类型无效");
  w.domain.entity(id,kind);inputObject(input,["pinned","hidden","position"]);
  for(const key of ["pinned","hidden"]) if(Object.hasOwn(input,key)&&typeof input[key]!=="boolean") throw error("置顶和隐藏必须是布尔值");
  if(Object.hasOwn(input,"position")) {
    if(!input.position || typeof input.position!=="object" || Array.isArray(input.position) || Buffer.byteLength(JSON.stringify(input.position))>4096) throw error("恢复位置格式无效");
  }
  const old=w.db.prepare("SELECT * FROM work_states WHERE entity_id=?").get(id);
  const state={pinned:input.pinned??Boolean(old?.pinned),hidden:input.hidden??Boolean(old?.hidden),position:input.position??JSON.parse(old?.position_json||"{}")};
  w.db.prepare("INSERT INTO work_states(entity_id,pinned,hidden,position_json) VALUES(?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET pinned=excluded.pinned,hidden=excluded.hidden,position_json=excluded.position_json").run(id,Number(state.pinned),Number(state.hidden),JSON.stringify(state.position));
  return state;
}
/**
 * 首页那一条「接着做」。
 *
 * ⚠️ **「最近打开」不是一个面板，是一个排序键。** 上一版首页把同一批对象按另一个时间
 * 又列了一遍，于是屏幕上 15 行里只有 8 个东西（量过）。这里 join 一次
 * `workspace_activity`（`mode='open'`），把**打开过但没改过**这件事并进排序——
 * 那正是那个面板存在的唯一理由，并进来之后它就不需要存在了。
 *
 * ⚠️ `workspace_activity` 上有 `UNIQUE(entity_id, mode)`，所以这个 join 是 1:1，
 * 不会把行数放大。`touchedAt` 必须和 `ORDER BY` 用**同一个表达式**：分别写两遍的话，
 * 前端显示的时间和实际排序依据会各算一次，而且不会报错。
 *
 * `pinned` 仍然排在最前（`api.workState` 写的），`hidden` 直接不返回——
 * 反悔的路是首页回执上那颗「撤销」，不是把隐藏的也发过去让前端再滤一遍。
 */
export function recentWork(w,{includeHidden=false}={}) {
  return w.db.prepare(`SELECT a.*,coalesce(s.pinned,0) pinned,coalesce(s.hidden,0) hidden,coalesce(s.position_json,'{}') position,max(a.updatedAt,coalesce(v.visited_at,a.updatedAt)) touchedAt FROM (
    SELECT r.id,'research' kind,CASE WHEN r.question='' THEN '未命名研究' ELSE r.question END title,substr(r.notes,1,240) excerpt,max(r.updated_at,coalesce((SELECT max(json_extract(message.value,'$.createdAt')) FROM ai_conversations c JOIN entities ce ON ce.id=c.id AND ce.deleted_at IS NULL,json_each(c.record_json,'$.messages') message WHERE (c.scope_id='research:'||r.id OR c.id IN (SELECT conversation_id FROM research_conversations WHERE research_id=r.id)) AND json_extract(message.value,'$.role')='user'),r.updated_at)) updatedAt FROM researches r JOIN entities e ON e.id=r.id WHERE e.deleted_at IS NULL
    UNION ALL SELECT p.id,'project',p.title,substr(coalesce(nullif(d.body_markdown,''),json_extract(n.notes_json,'$.thought'),''),1,240),max(e.updated_at,coalesce(de.updated_at,e.updated_at),coalesce(n.updated_at,e.updated_at)) FROM projects p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL LEFT JOIN project_primary_drafts pd ON pd.project_id=p.id LEFT JOIN drafts d ON d.id=pd.draft_id LEFT JOIN entities de ON de.id=d.id LEFT JOIN project_notebooks n ON n.project_id=p.id WHERE p.status!='parked' AND (d.id IS NULL OR (de.deleted_at IS NULL AND d.workflow_status NOT IN ('已发布','已弃用')))
  ) a LEFT JOIN work_states s ON s.entity_id=a.id LEFT JOIN workspace_activity v ON v.entity_id=a.id AND v.mode='open' WHERE (?=1 OR coalesce(s.hidden,0)=0)
    -- 已经有对应内容的选题不再单列一行（同一篇出现两次）；置顶过的照旧留着，置顶不能悄悄消失。
    AND NOT (a.kind='research' AND coalesce(s.pinned,0)=0 AND EXISTS (SELECT 1 FROM research_projects l JOIN entities pe ON pe.id=l.project_id AND pe.deleted_at IS NULL WHERE l.research_id=a.id))
    ORDER BY pinned DESC,touchedAt DESC LIMIT 100`).all(Number(includeHidden)).map(row=>{const r=row.kind==="research"?getResearch(w,row.id):null;return {...row,...(r?.contentRestricted?{title:r.title,excerpt:r.notes,contentRestricted:true}:{}),pinned:Boolean(row.pinned),hidden:Boolean(row.hidden),position:JSON.parse(row.position)};});
}
