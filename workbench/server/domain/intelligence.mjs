import { createUlid } from "../storage/ids.mjs";
import { sha256Json, sourceContainsVerbatim } from "./integrity.mjs";
import { createResearch, getResearch, researchReference, libraryItems, libraryItem } from "./research.mjs";
const now = () => new Date().toISOString();
const json = JSON.stringify;
const parse = JSON.parse;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const providers = ["local", "web", "aihot", "x", "reddit", "xiaohongshu", "douyin"];
function str(v, max, required = false) {
  if (typeof v !== "string" || v.length > max || (required && !v.trim())) throw bad(`文字不能为空且不能超过 ${max} 字符`);
  return v.trim();
}
function list(v, max, pattern) {
  if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== "string" || !pattern.test(x))) throw bad("账号或社区格式无效，最多 5 个");
  return [...new Set(v)];
}
function profile(w, id) {
  const r = w.db.prepare("SELECT * FROM intel_profiles WHERE id=?").get(id);
  if (!r) throw bad("关注方向不存在", 404);
  return { ...parse(r.config_json), id:r.id, nextDueAt:r.next_due_at, createdAt:r.created_at, updatedAt:r.updated_at };
}
export function intelligenceFocus(input) {
 const name=String(input.name||"").trim(), query=String(input.query||"").trim();
 return !query || /^(无|没有|暂无|不清楚|none|null|n\/a)$/i.test(query) || query===name ? name : `${name} ${query}`;
}
export function saveIntelligenceProfile(w, input) {
  input={...input,query:intelligenceFocus(input),providers:input.providers??["local","web","aihot","x","reddit"]};
  const frequency = input.frequency || "manual";
  if (!["manual", "daily", "weekly"].includes(frequency)) throw bad("调研频率无效");
  if(input.output === "briefs" && frequency !== "manual")throw bad("精选当前按次验证，尚未开启持续采集");
  if (!Array.isArray(input.providers) || !input.providers.length || input.providers.some(p => !providers.includes(p))) throw bad("请选择有效调研来源，通用热榜不受支持");
  const limit = input.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw bad("每来源条数应为 1 到 20");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw bad("启用状态无效");
  const config = { name:str(input.name,120,true), query:str(input.query,500,true), frequency, providers:[...new Set(input.providers)],
    accounts:[...new Set(list(input.accounts||[],5,/^@?[A-Za-z0-9_]{1,15}$/).map(x=>x.replace(/^@/,"").toLowerCase()))], subreddits:[...new Set(list(input.subreddits||[],5,/^(?:r\/)?[A-Za-z0-9_]{2,30}$/).map(x=>x.replace(/^r\//,"").toLowerCase()))],
    limit, output:input.output === "briefs" ? "briefs" : "topics", enabled:input.enabled !== false, paidApproved:input.paidApproved === true };



  const id = input.id ? str(input.id,80,true) : createUlid();
  const old = input.id ? profile(w,id) : null;
  const interval = frequency === "daily" ? 86400000 : 604800000;
  const next = frequency === "manual" || !config.enabled ? null : old?.frequency === frequency && old.enabled ? old.nextDueAt : new Date(Date.now()+interval).toISOString();
  w.db.prepare(`INSERT INTO intel_profiles(id,config_json,next_due_at,created_at,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,next_due_at=excluded.next_due_at,updated_at=excluded.updated_at`).run(id,json(config),next,old?.createdAt||now(),now());
  return profile(w,id);
}
export function intelligenceRun(w,id) {
  const r=w.db.prepare("SELECT * FROM intel_runs WHERE id=?").get(id);
  if(!r) throw bad("调研记录不存在",404);
  const job = r.job_id ? w.jobs.get(r.job_id) : null;
  const exhausted = ["queued","running"].includes(r.status) && ["failed","cancelled"].includes(job?.status);
  return {id:r.id,profileId:r.profile_id,status:exhausted?"failed":r.status,stage:r.stage,error:exhausted?job.lastError:r.error,createdAt:r.created_at,updatedAt:r.updated_at,
    config:parse(r.config_json),coverage:w.db.prepare("SELECT provider,status,state_json,error FROM intel_steps WHERE run_id=?").all(id).map(s=>({...parse(s.state_json),provider:s.provider,status:s.status,error:s.error}))};
}
export function updateRun(w,id,status,stage,error="") { w.db.prepare("UPDATE intel_runs SET status=?,stage=?,error=?,updated_at=? WHERE id=?").run(status,stage,error,now(),id); }
export function stepState(w,id,provider) { const r=w.db.prepare("SELECT * FROM intel_steps WHERE run_id=? AND provider=?").get(id,provider);return r?{...parse(r.state_json),status:r.status,error:r.error}:{}; }
export function saveStep(w,id,provider,status,state={},error="") {
  const {status:ignoredStatus,error:ignoredError,provider:ignoredProvider,...data}=state;
  w.db.prepare(`INSERT INTO intel_steps(run_id,provider,status,state_json,error) VALUES(?,?,?,?,?) ON CONFLICT(run_id,provider) DO UPDATE SET status=excluded.status,state_json=excluded.state_json,error=excluded.error`).run(id,provider,status,json(data),error);
}
export function enqueueIntelligence(w,profileId) {
  return w.repository.transaction(()=>{
    const p=profile(w,profileId);
    const active=w.db.prepare("SELECT id FROM intel_runs WHERE profile_id=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1").get(profileId);
    if(active && intelligenceRun(w,active.id).status !== "failed") return intelligenceRun(w,active.id);
    const id=createUlid(),stamp=now();
    w.db.prepare("INSERT INTO intel_runs(id,profile_id,config_json,status,created_at,updated_at) VALUES(?,?,?,'queued',?,?)").run(id,profileId,json(p),stamp,stamp);
    const {job}=w.jobs.enqueue({kind:"intelligence.research",idempotencyKey:`intel:${id}:0`,payload:{runId:id}});
    w.db.prepare("UPDATE intel_runs SET job_id=? WHERE id=?").run(job.id,id);
    return intelligenceRun(w,id);
  });
}
export function retryIntelligence(w,id,input={}) {
  return w.repository.transaction(()=>{
    const r=intelligenceRun(w,id);
    if(!["failed","partial","cancelled"].includes(r.status)) throw bad("只有未完成的调研可以重试",409);
    const old=w.db.prepare("SELECT attempt,job_id FROM intel_runs WHERE id=?").get(id);
    if(w.jobs.get(old.job_id)?.status==="running") throw bad("上一次执行尚未退出，请稍后重试",409);
    for(const [provider,snapshotId] of Object.entries(input.snapshotIds||{})) {
      if(!["x","reddit"].includes(provider)||!/^s_[a-zA-Z0-9_-]+$/.test(snapshotId))throw bad("采集恢复 ID 无效");
      const state=stepState(w,id,provider);
      if(state.snapshotId && state.snapshotId!==snapshotId)throw bad("已有采集恢复 ID 不能替换",409);
      if(!state.uncertain && !state.snapshotId)throw bad("该来源没有待恢复的采集",409);
      saveStep(w,id,provider,"pending",{...state,snapshotId,uncertain:false});
    }
    const n=old.attempt+1;
    const {job}=w.jobs.enqueue({kind:"intelligence.research",idempotencyKey:`intel:${id}:${n}`,payload:{runId:id}});
    w.db.prepare("UPDATE intel_runs SET attempt=?,job_id=? WHERE id=?").run(n,job.id,id);updateRun(w,id,"queued","等待继续");return intelligenceRun(w,id);
  });
}
export function cancelIntelligence(w,id) { const r=intelligenceRun(w,id);if(["queued","running"].includes(r.status))updateRun(w,id,"cancelled","已取消；已触发的外部采集可能仍计费");return intelligenceRun(w,id); }
export function scheduleIntelligence(w,{now:at=new Date()}={}) {
  const stamp=new Date(at).toISOString();
  return w.repository.transaction(()=>w.db.prepare("SELECT id FROM intel_profiles WHERE next_due_at<=?").all(stamp).map(({id})=>{
    const p=profile(w,id);if(!p.enabled||p.frequency==="manual")return null;
    const r=enqueueIntelligence(w,id);
    w.db.prepare("UPDATE intel_profiles SET next_due_at=? WHERE id=?").run(new Date(new Date(at).getTime()+(p.frequency==="daily"?86400000:604800000)).toISOString(),id);return r.id;
  }).filter(Boolean));
}
export function addIntelligenceSource(w,input,runId=null) {
  const body=str(input.body||"",100000,true), title=str(input.title||"未命名资料",500,true),url=str(input.url||"",2000);
  if(url && !/^https?:\/\//i.test(url))throw bad("只支持公开网页链接");
  const provider=input.provider||"manual";
  const fingerprint=sha256Json([provider,input.localId||url,body]);
  let row=w.db.prepare("SELECT id,data_json,created_at FROM intel_sources WHERE fingerprint=?").get(fingerprint);
  if(!row){const id=createUlid(),createdAt=now();const data={title,body,url,provider,publishedAt:input.publishedAt||null,readLevel:input.readLevel||"original",background:Boolean(input.background),localId:input.localId||null,localKind:input.localKind||null};w.db.prepare("INSERT INTO intel_sources(id,fingerprint,data_json,created_at) VALUES(?,?,?,?)").run(id,fingerprint,json(data),createdAt);row={id,data_json:json(data),created_at:createdAt};}
  if(runId)w.db.prepare("INSERT OR IGNORE INTO intel_run_sources(run_id,source_id) VALUES(?,?)").run(runId,row.id);
  return {id:row.id,...parse(row.data_json),createdAt:row.created_at};
}
export function runSources(w,id){return w.db.prepare("SELECT s.* FROM intel_sources s JOIN intel_run_sources l ON l.source_id=s.id WHERE l.run_id=?").all(id).map(r=>({id:r.id,...parse(r.data_json),createdAt:r.created_at}));}
export function localIntelligenceSources(w,query,limit) {
  const terms=query.split(/[\s，,、；;]+/).filter(Boolean).slice(0,5);
  const found=new Map();for(const term of terms)for(const i of libraryItems(w,{q:term,limit})) {if(i.kind!=="wiki")found.set(i.id,i);}

  const items=[...found.values()].slice(0,limit).map(i=>{const full=libraryItem(w,i.kind,i.id);return {title:i.title,body:String(full.body||"").slice(0,40000),url:i.sourceUrl,localId:i.id,localKind:i.kind,provider:"local",readLevel:"original",publishedAt:i.updatedAt};}).filter(i=>i.body.trim());
  const manual=w.db.prepare("SELECT * FROM intel_sources WHERE json_extract(data_json,'$.provider')='manual' ORDER BY created_at DESC LIMIT 100").all().map(r=>({id:r.id,...parse(r.data_json)})).filter(a=>a.body?.trim() && terms.some(t=>(a.title+a.body).toLowerCase().includes(t.toLowerCase()))).slice(0,limit);
  return [...manual,...items].slice(0,limit);
}
export function saveIntelligenceCards(w,runId,candidates,wikiItems) {
  const run=intelligenceRun(w,runId),sources=runSources(w,runId),byId=new Map(sources.map(s=>[s.id,s]));
  if(!Array.isArray(candidates))throw bad("模型未返回选题候选数组");
  let rejected=0;
  w.repository.transaction(()=>{for(const c of candidates.slice(0,5)){
    const evidence=(Array.isArray(c.evidence)?c.evidence:[]).filter(e=>typeof e?.quote==="string"&&e.quote.trim().length>=8&&byId.get(e.sourceId)?.readLevel==="original"&&sourceContainsVerbatim(byId.get(e.sourceId).body,e.quote)).slice(0,8);
    if(!evidence.length || typeof c.question!=="string" || !c.question.trim()){rejected++;continue;}
    const wiki=(Array.isArray(c.wiki)?c.wiki:[]).filter(k=>wikiItems.some(i=>i.id===k.id)).slice(0,3).map(k=>({id:k.id,title:wikiItems.find(i=>i.id===k.id).title,reason:String(k.reason||"").slice(0,1000)}));
    const data={question:c.question.slice(0,500),audience:String(c.audience||"").slice(0,1000),why:String(c.why||"").slice(0,2000),angle:String(c.angle||"").slice(0,2000),gaps:String(c.gaps||"").slice(0,2000),evidence,wiki};
    const fingerprint=sha256Json(data.question.toLowerCase().replace(/[\s\p{P}]/gu,""));
    const old=w.db.prepare("SELECT * FROM intel_cards WHERE profile_id=? AND fingerprint=?").get(run.profileId,fingerprint);
    if(old){const prev=parse(old.data_json);data.evidence=[...new Map([...prev.evidence,...evidence].map(e=>[e.sourceId+e.quote,e])).values()].slice(-12);w.db.prepare("UPDATE intel_cards SET data_json=?,run_id=?,updated_at=? WHERE id=?").run(json(data),runId,now(),old.id);}
    else w.db.prepare("INSERT INTO intel_cards(id,profile_id,fingerprint,run_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(createUlid(),run.profileId,fingerprint,runId,json(data),now(),now());
  }});return {rejected};
}
export function setIntelligenceCard(w,id,status){if(!["new","watch","dismissed"].includes(status))throw bad("选题状态无效");if(!w.db.prepare("UPDATE intel_cards SET status=?,updated_at=? WHERE id=? AND research_id IS NULL").run(status,now(),id).changes)throw bad("选题不存在或已采用",409);}
export function adoptIntelligenceCard(w,id) {
 return w.repository.transaction(()=>{
  const row=w.db.prepare("SELECT * FROM intel_cards WHERE id=?").get(id);if(!row)throw bad("选题不存在",404);if(row.research_id)return getResearch(w,row.research_id);
  const c=parse(row.data_json);const notes=["待讨论的选题候选（尚未核实为个人判断）",c.why,`目标读者：${c.audience}`,`可能角度：${c.angle}`,"依据：",...c.evidence.map(e=>`> ${e.quote}`)].join("\n\n");
  const r=createResearch(w,{question:c.question,notes,openQuestions:c.gaps});
  for(const ref of c.evidence){const s=w.db.prepare("SELECT * FROM intel_sources WHERE id=?").get(ref.sourceId);const d=parse(s.data_json);let cid=s.capture_id;
    if(!cid){cid=w.domain.createCapture({kind:d.url?"web":"excerpt",title:d.title,bodyMarkdown:d.body,sourceUrl:d.url,actor:"user",confirmed:true});w.db.prepare("UPDATE intel_sources SET capture_id=? WHERE id=?").run(cid,s.id);}
    researchReference(w,r.id,{kind:"capture",id:cid});
  }
  for(const k of c.wiki){try{researchReference(w,r.id,{kind:"wiki",id:k.id});}catch(e){if(e.status!==404)throw e;}}
  w.db.prepare("UPDATE intel_cards SET research_id=?,status='adopted',updated_at=? WHERE id=?").run(r.id,now(),id);return getResearch(w,r.id);
 });
}
export function intelligenceSource(w,id) {
 const row=w.db.prepare("SELECT * FROM intel_sources WHERE id=?").get(id);
 if(!row)throw bad("来源不存在",404);
 return {id:row.id,...parse(row.data_json),createdAt:row.created_at};
}
export function intelligenceOverview(w,env={}) {
 const profiles=w.db.prepare("SELECT id FROM intel_profiles ORDER BY updated_at DESC").all().map(r=>profile(w,r.id));
 const approved=new Map(),screenedRuns=new Set();
 for(const row of w.db.prepare("SELECT r.id,r.profile_id,r.created_at,s.state_json FROM intel_runs r JOIN intel_steps s ON s.run_id=r.id AND s.provider='screen' ORDER BY r.created_at DESC LIMIT 200").all()) {
  screenedRuns.add(row.id);
  for(const item of parse(row.state_json).accepted||[])if(!approved.has(item.sourceId))approved.set(item.sourceId,{runId:row.id,profileId:row.profile_id,profileName:profiles.find(p=>p.id===row.profile_id)?.name||"调研",reason:item.reason,runCreatedAt:row.created_at});
 }
 return {profiles,runs:w.db.prepare("SELECT id FROM intel_runs ORDER BY created_at DESC LIMIT 50").all().map(r=>intelligenceRun(w,r.id)),
 cards:w.db.prepare("SELECT * FROM intel_cards ORDER BY updated_at DESC LIMIT 200").all().map(r=>({id:r.id,profileId:r.profile_id,runId:r.run_id,...parse(r.data_json),status:r.status,researchId:r.research_id,updatedAt:r.updated_at})).filter(c=>c.researchId||screenedRuns.has(c.runId)),
 sources:w.db.prepare("SELECT * FROM intel_sources ORDER BY created_at DESC LIMIT 500").all().map(r=>{const d=parse(r.data_json);return {id:r.id,...d,...approved.get(r.id),body:d.body?.slice(0,600)||"",bodyTruncated:(d.body?.length||0)>600,createdAt:r.created_at};}).filter(s=>s.provider==="manual"||approved.has(s.id)),
 capabilities:{local:true,aihot:true,web:Boolean(env.TAVILY_API_KEY||env.BRAVE_SEARCH_API_KEY),x:Boolean(env.BRIGHTDATA_API_KEY||env.TAVILY_API_KEY||env.BRAVE_SEARCH_API_KEY),reddit:Boolean(env.BRIGHTDATA_API_KEY||env.TAVILY_API_KEY||env.BRAVE_SEARCH_API_KEY),xiaohongshu:Boolean(env.TAVILY_API_KEY||env.BRAVE_SEARCH_API_KEY),douyin:Boolean(env.TAVILY_API_KEY||env.BRAVE_SEARCH_API_KEY)}};
}
