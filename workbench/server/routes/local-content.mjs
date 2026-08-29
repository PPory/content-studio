import { fail, json, readJsonBody } from "../lib/http.mjs";
import { normalizeRevision } from "../lib/editor-revisions.mjs";
import { DEFAULT_AUDIENCES, normalizeAudiences } from "../lib/audiences.mjs";
import { DEFAULT_WRITING_PROFILE, normalizeWritingProfile, normalizeWritingStyleOverrides } from "../lib/writing-profile.mjs";
import { WRITING_EXPERTS, WRITING_STYLES } from "../lib/writing-presets.mjs";
import { createUlid } from "../storage/ids.mjs";
import { listMaterials } from "../workspace/workspace-view.mjs";

const clean = (value, max = 80_000) => String(value ?? "").trim().slice(0, max);
const iso = (value = new Date()) => new Date(value).toISOString();
const localDate = (value = new Date()) => {
  const date = new Date(value);
  const two = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
};
const offsetDate = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDate(date);
};

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guard(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await ready(context.workspace) }); }
    catch (error) { fail(context.res, error.message || "本地内容操作失败", { status: error.status || 400, hint: error.hint }); }
  };
}

function writingPayload(workspace) {
  const profile = normalizeWritingProfile(workspace.repository.getSetting("writing-profile", DEFAULT_WRITING_PROFILE));
  const overrides = normalizeWritingStyleOverrides(workspace.repository.getSetting("writing-styles", {}));
  const styles = WRITING_STYLES.map((item) => ({ ...item, defaultInstructions: item.instructions, instructions: overrides[item.id] || item.instructions, customized: Boolean(overrides[item.id]) }));
  return {
    profile,
    platforms: ["公众号", "X", "小红书", "视频号", "YouTube"],
    styles,
    experts: WRITING_EXPERTS.map((item) => ({ ...item })),
    style: styles.find((item) => item.enabled && item.id === profile.styleId) || null,
    source: "SQLite workspace",
    hint: "长期写作偏好保存在当前本地工作区。",
  };
}

function revisionStore(workspace) {
  return workspace.repository.getSetting("editor-revisions", { schemaVersion: 1, documents: {}, aliases: {} });
}

function resolveRevisionScope(store, requested) {
  let scope = clean(requested, 400);
  if (!scope || /[\u0000-\u001f]/.test(scope)) throw new Error("稿件修订身份不合法");
  const seen = new Set();
  for (let depth = 0; depth < 8 && store.aliases?.[scope] && !seen.has(scope); depth += 1) {
    seen.add(scope);
    scope = clean(store.aliases[scope], 400);
  }
  return scope;
}

function planPayload(workspace, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期格式要是 YYYY-MM-DD");
  const stored = workspace.repository.getSetting(`plan:${date}`, { version: 0, tasks: [] });
  return { date, path: `workspace:plan:${date}`, stamp: String(stored.version || 0), exists: Boolean(stored.tasks?.length), unknownMarks: 0, tasks: (stored.tasks || []).map((item, index) => ({ index, done: Boolean(item.done), text: clean(item.text, 200) })) };
}

function savePlan(workspace, date, action, body) {
  const current = planPayload(workspace, date);
  if (["toggle", "remove"].includes(action) && String(body.stamp ?? "") !== current.stamp) throw Object.assign(new Error("计划已经更新，请刷新后再试"), { status: 409 });
  const tasks = current.tasks.map(({ done, text }) => ({ done, text }));
  if (action === "add") {
    const text = clean(body.text, 200).replace(/^[-*+]\s+(?:\[[^\]]\]\s*)?/, "");
    if (!text) throw new Error("任务内容是空的");
    tasks.push({ done: false, text });
  } else if (action === "toggle") {
    if (!tasks[body.index]) throw Object.assign(new Error("这条任务不在清单里了"), { status: 409 });
    tasks[body.index].done = Boolean(body.done);
  } else if (action === "remove") {
    if (!tasks[body.index]) throw Object.assign(new Error("这条任务不在清单里了"), { status: 409 });
    tasks.splice(body.index, 1);
  } else throw new Error(`认不出的动作：${action}`);
  workspace.repository.setSetting(`plan:${date}`, { version: Number(current.stamp) + 1, tasks }, { now: new Date() });
  return planPayload(workspace, date);
}

function materialCandidate(item) {
  const record = item.record || item;
  return { id: record.id, title: record.title, type: record.type, note: record.note || record.content || "", content: record.content || record.note || "", link: record.sourceUrl || record.link || "", sourceUrl: record.sourceUrl || record.link || "", verificationStatus: record.verificationStatus };
}

function ideaCard(angle, materials = []) {
  return {
    angle: clean(angle, 240),
    audience: "最可能被这个问题困住、并愿意采取下一步行动的人",
    pain: "信息不少，但缺少一个能落到自己处境中的判断",
    why: "这个角度直接来自当前本地工作区已有内容，可继续补证据后再写。",
    materials: materials.slice(0, 4).map((item) => ({ id: item.id, title: item.title, use: "作为已有依据或反例，使用前核对来源与适用边界" })),
    form: "一篇只讲清一个判断的文章",
    effort: materials.length >= 2 ? "可开始" : "需补素材",
  };
}

function sourceCapture(workspace, id) {
  const row = workspace.db.prepare(`SELECT c.*,e.version,e.updated_at FROM captures c JOIN entities e ON e.id=c.id AND e.deleted_at IS NULL WHERE c.id=?`).get(id);
  if (!row) throw new Error("收藏不存在");
  return row;
}

function applyCollection(workspace, item) {
  const row = sourceCapture(workspace, item.id);
  if (item.updatedAt && String(item.updatedAt) !== String(row.updated_at)) throw Object.assign(new Error("收藏已经更新，请刷新后再整理"), { status: 409 });
  const action = clean(item.action);
  const stamp = new Date();
  const created = [];
  workspace.repository.transaction(() => {
    if (clean(item.title)) {
      workspace.db.prepare("UPDATE captures SET title=? WHERE id=?").run(clean(item.title, 300), row.id);
      workspace.repository.setEntityText(row.id, { title: clean(item.title, 300), body: row.body_markdown, now: stamp });
    }
    if (action === "archive") workspace.domain.transitionCapture(row.id, "archive", { actor: "user", now: stamp });
    else if (action === "idea") {
      const seedId = workspace.domain.createSeed({ title: clean(item.title || row.title, 300), reaction: "", sourceEntityId: row.id, actor: "user", now: stamp });
      created.push({ kind: "seed", id: seedId });
      if (row.status === "pending") workspace.domain.transitionCapture(row.id, "accept", { actor: "user", now: stamp });
    } else if (action === "material") {
      const drafts = Array.isArray(item.materialDrafts) && item.materialDrafts.length ? item.materialDrafts : [item.materialDraft || { title: item.title || row.title, type: "核心观点", content: row.body_markdown }];
      for (const draft of drafts.slice(0, 6)) {
        const materialId = workspace.domain.createMaterial({ title: clean(draft.title || row.title, 300), type: draft.type || "核心观点", bodyMarkdown: draft.content || row.body_markdown, sourceUrl: draft.sourceUrl || row.source_url, sourceEntityId: row.id, actor: "user", now: stamp });
        created.push({ kind: "material", id: materialId });
      }
      if (row.status === "pending") workspace.domain.transitionCapture(row.id, "accept", { actor: "user", now: stamp });
    } else if (action === "keep" && row.status === "pending") workspace.domain.transitionCapture(row.id, "accept", { actor: "user", now: stamp });
    else if (!["keep", "archive", "idea", "material"].includes(action)) throw new Error("整理动作不合法");
  });
  return { id: row.id, ok: true, action, created };
}

export const localContentRoutes = [
  { method: "GET", path: "/api/audiences", handler: guard(async ({ workspace, res }) => json(res, { ok: true, items: normalizeAudiences(workspace.repository.getSetting("audiences", DEFAULT_AUDIENCES)) })) },
  { method: "POST", path: "/api/audiences", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const current=normalizeAudiences(workspace.repository.getSetting("audiences",DEFAULT_AUDIENCES)); const value=clean(body.value,60); const items=normalizeAudiences(value?[value,...current]:current); workspace.repository.setSetting("audiences",items); json(res,{ok:true,items}); }) },
  { method: "GET", path: "/api/writing-profile", handler: guard(async ({ workspace, res }) => json(res, { ok: true, ...writingPayload(workspace) })) },
  { method: "POST", path: "/api/writing-profile", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); workspace.repository.setSetting("writing-profile",normalizeWritingProfile(body.profile||body)); json(res,{ok:true,...writingPayload(workspace)}); }) },
  { method: "POST", path: "/api/writing-style", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const preset=WRITING_STYLES.find((item)=>item.id===clean(body.id,120)); if(!preset) throw new Error("找不到这套写作风格"); const instructions=clean(body.instructions,6000); if(!instructions) throw new Error("风格提示词不能为空"); const current=normalizeWritingStyleOverrides(workspace.repository.getSetting("writing-styles",{})); if(instructions===preset.instructions) delete current[preset.id]; else current[preset.id]=instructions; workspace.repository.setSetting("writing-styles",current); json(res,{ok:true,...writingPayload(workspace)}); }) },
  { method: "GET", path: "/api/revisions", handler: guard(async ({ workspace, res, url }) => { const store=revisionStore(workspace); const scope=resolveRevisionScope(store,url.searchParams.get("scope")); json(res,{ok:true,items:store.documents?.[scope]?.items||[]}); }) },
  { method: "POST", path: "/api/revisions", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const store=revisionStore(workspace); const scope=resolveRevisionScope(store,body.scope); const item=normalizeRevision(body.item); const current=store.documents?.[scope]?.items||[]; const items=[item,...current.filter((entry)=>entry.id!==item.id)].slice(0,100); store.documents={...(store.documents||{}),[scope]:{updatedAt:item.updatedAt,items}}; workspace.repository.setSetting("editor-revisions",store); json(res,{ok:true,items}); }) },
  { method: "POST", path: "/api/revisions/move", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const store=revisionStore(workspace); const from=resolveRevisionScope(store,body.from); const to=resolveRevisionScope(store,body.to); const seen=new Set(); const items=[...(store.documents?.[from]?.items||[]),...(store.documents?.[to]?.items||[])].filter((item)=>item?.id&&!seen.has(item.id)&&seen.add(item.id)).slice(0,100); store.documents={...(store.documents||{}),[to]:{updatedAt:iso(),items}}; if(from!==to) delete store.documents[from]; store.aliases={...(store.aliases||{}),[clean(body.from,400)]:to,[from]:to}; workspace.repository.setSetting("editor-revisions",store); json(res,{ok:true,items}); }) },
  { method: "GET", path: "/api/plan", handler: guard(async ({ workspace, res, url }) => { const date=url.searchParams.get("date")||localDate(); json(res,{ok:true,today:localDate(),tomorrow:offsetDate(1),...planPayload(workspace,date)}); }) },
  { method: "POST", path: "/api/plan", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const date=body.date||localDate(); json(res,{ok:true,today:localDate(),tomorrow:offsetDate(1),...savePlan(workspace,date,body.action,body)}); }) },
  { method: "POST", path: "/api/pipe/pick/materials", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const want=clean(body.want,300); if(!want) throw new Error("want 不能为空"); const exclude=new Set(body.exclude||[]); const all=listMaterials(workspace).items; const found=workspace.repository.search(want,{limit:30}).filter((item)=>item.type==="material"&&!exclude.has(item.id)); const byId=new Map(all.map((item)=>[item.id,item])); const items=found.map((item)=>byId.get(item.id)).filter(Boolean).slice(0,6).map(materialCandidate); json(res,{ok:true,items,scanned:all.length}); }) },
  { method: "POST", path: "/api/pipe/ideas/materials", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); if(!/^\d{4}-\d{2}-\d{2}$/.test(body.from||"")||!/^\d{4}-\d{2}-\d{2}$/.test(body.to||"")) throw new Error("日期范围格式不对"); const rows=listMaterials(workspace).items.filter((item)=>String(item.updatedAt||"").slice(0,10)>=body.from&&String(item.updatedAt||"").slice(0,10)<=body.to); const cards=[]; for(let i=0;i+1<Math.min(rows.length,8);i+=2) cards.push(ideaCard(`${rows[i].title}与${rows[i+1].title}之间有什么共同问题？`,[materialCandidate(rows[i]),materialCandidate(rows[i+1])])); json(res,{ok:true,cards,scanned:rows.length}); }) },
  { method: "POST", path: "/api/pipe/ideas/angles", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const title=clean(body.title,300); if(!title) throw new Error("没有给要拆的那件事"); const related=workspace.repository.search(`${title} ${clean(body.summary,300)}`,{limit:8}).filter((item)=>item.type==="material").map((item)=>({id:item.id,title:item.title})); const cards=[ideaCard(`${title}真正改变了谁的什么选择？`,related),ideaCard(`关于“${title}”，常见判断遗漏了什么前提？`,related)].slice(0,2); json(res,{ok:true,cards}); }) },
  { method: "POST", path: "/api/pipe/collections/organize/preview", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const suggestions=(body.ids||[]).slice(0,20).map((id)=>{const row=sourceCapture(workspace,id);return{id,title:row.title,action:"keep",tags:[],reason:"先保留原内容；由你确认是否转成种子、素材或归档。",updatedAt:row.updated_at,materialDrafts:[{key:"material-1",title:row.title,type:"核心观点",content:row.body_markdown,sourceUrl:row.source_url,tags:[]}]};}); json(res,{ok:true,suggestions}); }) },
  { method: "POST", path: "/api/pipe/collections/organize/apply", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const results=[]; for(const item of body.items||[]){try{results.push(applyCollection(workspace,item));}catch(error){results.push({id:item.id,ok:false,error:error.message});}} json(res,{ok:true,results}); }) },
  { method: "POST", path: "/api/pipe/collections/:id/snapshot", handler: guard(async ({ workspace, res, params }) => { sourceCapture(workspace,params.id); json(res,{ok:true,id:params.id,snapshotStatus:"not_needed",reason:"本地工作区已保留原始正文和来源链接"}); }) },
  { method: "GET", path: "/api/insights/candidates", handler: guard(async ({ workspace, res }) => { const rows=listMaterials(workspace).items.slice(0,8); const week=`${new Date().getFullYear()}-local`; const items=rows.map((item)=>({id:`material:${item.id}`,title:item.title,status:item.verificationStatus==="待核验"?"needs_research":"ready",score:null,card:ideaCard(item.title,[materialCandidate(item)])})); json(res,{ok:true,week,items,cards:true,source:"SQLite workspace"}); }) },
  { method: "POST", path: "/api/ai/knowledge-card", handler: guard(async ({ req, res }) => { const body=await readJsonBody(req); const evidence=clean(body.source?.selection||body.source?.content||body.source?.text,6000); const dialogue=(body.messages||[]).map((item)=>clean(item.content,2000)).filter(Boolean); const conclusion=dialogue.at(-1)||evidence||""; json(res,{ok:true,card:{title:clean(body.source?.title||conclusion.split(/[。！？\n]/)[0]||"未命名知识卡",120),conclusion:clean(conclusion,500),explanation:clean(dialogue.join("\n\n"),4000),evidence,boundaries:"请在使用前核对适用场景和时效。",questions:"还有哪些反例或证据需要补充？",personalUnderstanding:"",tags:[],evidenceStatus:evidence?"有原文支撑":"待验证",sourceUrl:clean(body.source?.url,1000)}}); }) },
  { method: "POST", path: "/api/vault/knowledge-card", handler: guard(async ({ workspace, req, res }) => { const card=await readJsonBody(req); const id=createUlid(),stamp=new Date(); const title=clean(card.title,200); if(!title) throw new Error("知识卡标题不能为空"); const body=[card.conclusion,card.explanation,card.evidence,card.boundaries,card.questions,card.personalUnderstanding].filter(Boolean).join("\n\n"); workspace.repository.transaction(()=>{workspace.repository.createEntity({id,type:"knowledge_item",now:stamp});workspace.db.prepare("INSERT INTO knowledge_items(id,knowledge_kind,title,body_markdown,quote_text,source_url,locator) VALUES (?,'knowledge_card',?,?,?,?,?)").run(id,title,body,clean(card.evidence,6000),clean(card.sourceUrl,2000),`knowledge-card:${id}`);workspace.repository.setEntityText(id,{title,body,now:stamp});}); json(res,{ok:true,card:{...card,id,path:`workspace:knowledge-card:${id}`}}); }) },
  { method: "POST", path: "/api/vault/knowledge-card/links", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const counts={}; for(const ref of body.refs||[]){counts[ref]=workspace.db.prepare("SELECT COUNT(*) AS count FROM knowledge_items k JOIN entities e ON e.id=k.id AND e.deleted_at IS NULL WHERE k.knowledge_kind='knowledge_card' AND (k.locator=? OR k.source_url=?)").get(clean(ref,1000),clean(ref,1000)).count;} json(res,{ok:true,counts}); }) },
];
