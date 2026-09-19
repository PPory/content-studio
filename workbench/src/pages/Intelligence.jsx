import { useCallback, useEffect, useState } from "react";
import { SourceResearchPicker } from "../components/SourceResearchPicker.jsx";
import { api } from "../lib/api.js";
import { Empty, ErrorNote, PageHeader, SearchBox, Toast } from "../components/ui.jsx";
import { IconRadar2 } from "../components/icons.jsx";
import "./intelligence.css";

const PROVIDERS = {local: "我的记录与素材", web: "主题搜索", aihot: "AI 行业信息", x: "X 公开内容", reddit: "Reddit 公开讨论", xiaohongshu: "小红书公开内容", douyin: "抖音公开内容"};
const sourceLabel = key => ({manual:"手动记录",screen:"相关性筛选",plan:"调研方案",channels:"订阅信源",organize:"主题整理",compose:"情报解读",quality:"质量检查","scope-review":"证据范围复核"}[key] || PROVIDERS[key] || key);
const stageLabel = value => String(value || "").replace(/screen/g,"相关性筛选").replace(/plan/g,"调研方案").replace(/读取 (local|web|aihot|xiaohongshu|douyin|x|reddit)/, (_, key) => `读取${sourceLabel(key)}`);
const STATUS = {queued:"等待调研",running:"正在调研",done:"已完成",partial:"部分完成",failed:"调研失败",cancelled:"已取消"};
const EMPTY = {profiles:[],runs:[],cards:[],sources:[],capabilities:{}};
const fresh = () => ({name:"",query:"",frequency:"manual",enabled:true});
const listText = value => Array.isArray(value) ? value.join("；") : String(value || "");
const time = value => value ? new Date(value).toLocaleString("zh-CN", {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "";
const safeUrl = value => { try { const url = new URL(value); return ["https:","http:"].includes(url.protocol) ? url.href : null; } catch { return null; } };

function IntelligenceStep({step}) {
  const counts = step.provider === "quality"
    ? `可推荐 ${step.ready || 0} 条 · 待复核 ${step.needsReview || 0} 条 · 未通过 ${step.rejected || 0} 条`
    : Number.isFinite(step.outputCount) ? `输入 ${step.inputCount || 0} 条 · 输出 ${step.outputCount} 条`
    : Number.isFinite(step.count) ? `${step.count} 条` : "";
  return <div><p>{sourceLabel(step.provider)}{counts && ` · ${counts}`} · {step.error || STATUS[step.status] || step.status}</p>
    {step.rejectionReasons?.length > 0 && <ul>{step.rejectionReasons.map((item,index)=><li key={index}>{item.title ? `${item.title}：` : ""}{item.error || item.reason || "依据未通过检查"}</li>)}</ul>}
    {step.reviews?.filter(item=>item.verdict !== "supported" && item.reason).map((item,index)=><p className="intel-hint" key={index}>待核对：{item.reason}</p>)}
    {step.model && <p className="intel-hint">使用模型：{step.model}</p>}
  </div>;
}

function IntelligenceSourceBody({source}) {
  const [full,setFull] = useState(null), [loading,setLoading] = useState(false), [error,setError] = useState("");
  const load = async () => {
    if(!source.bodyTruncated || full || loading)return;
    setLoading(true);setError("");
    try {const result=await api.intelligenceSourceDetail(source.id);setFull(result.source);}
    catch(e){setError(e.message);}finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[source.id]);
  return <>{loading && <p className="intel-hint" role="status">正在读取内容…</p>}{error && <div className="intel-error" role="alert">{error}<button className="btn" onClick={load}>重试读取</button></div>}<p className="intel-source-body">{full?.body || source.body || "尚未读取正文"}</p>{source.bodyTruncated && !full && !loading && !error && <button className="btn" onClick={load}>读取完整内容</button>}</>;
}
function IntelligenceSourceDisclosure({source,children,className,onLink}) {
  const [open,setOpen] = useState(false);
  return <details className={className} onToggle={event=>setOpen(event.currentTarget.open)}><summary>{children}</summary>{open && <IntelligenceSourceBody key={source.id} source={source}/>} {open && safeUrl(source.url) && <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">查看原文 ↗</a>}{open && onLink && <div className="intel-source-actions"><button className="btn btn-sm" onClick={()=>onLink(source)}>带入选题</button></div>}</details>;
}

export function Intelligence({view, initialAction, onGo}) {
  const [data,setData] = useState(EMPTY), [loading,setLoading] = useState(true), [error,setError] = useState("");
  const [busy,setBusy] = useState(""), [notice,setNotice] = useState(""), [filter,setFilter] = useState("new");
  const [editing,setEditing] = useState(null), [note,setNote] = useState({title:"",body:"",url:""});
  const [linking,setLinking]=useState(null);
  const [search,setSearch] = useState("");
  const [topic,setTopic] = useState(""), [selectedTopic,setSelectedTopic] = useState(""), [inboxTab,setInboxTab] = useState(initialAction === "manual" ? "manual" : "research"), [showNote,setShowNote] = useState(false);
  const [connections,setConnections] = useState([]);
  const [recovery,setRecovery] = useState({});
  const page = view === "intel-runs" ? "runs" : view === "intel-settings" ? "settings" : view === "intel-inbox" ? "inbox" : "discover";
  const load = useCallback(async (quiet = false) => { try {const result=await api.intelligence();setData({...EMPTY,...result});if(!quiet)setError("");} catch(e){setError(e.message);} finally {setLoading(false);} },[]);
  useEffect(() => {void load();},[load]);
  useEffect(() => {if(view === "intel-settings" && initialAction === "new")setEditing(fresh());},[view,initialAction]);
  useEffect(() => {const timer=setInterval(() => {if(!document.hidden) void load(true);},5000);return () => clearInterval(timer);},[load]);
  const act = async (key, fn, message="") => {setBusy(key);setError("");setNotice("");try {const result=await fn();await load();setNotice(message);return result;}catch(e){setError(e.message);return null;}finally{setBusy("");}};
  const openCard = async card => {if(card.researchId){onGo("research",card.researchId);return;} const result=await act(card.id,()=>api.intelligenceAdopt(card.id));if(result?.research?.id)onGo("research",result.research.id);};
  const cards=data.cards.filter(card => (!selectedTopic || card.profileId === selectedTopic)).filter(card => filter === "all" || (filter === "adopted" ? Boolean(card.researchId) : card.status===filter && !card.researchId));
  const sources = data.sources.filter(source => `${source.title} ${source.body}`.toLowerCase().includes(search.toLowerCase()));
  const active=data.runs.filter(run=>["queued","running"].includes(run.status));
  const scopeChange = patch => setEditing(current=>({...current,...patch}));
  const manualSources=sources.filter(s=>s.provider === "manual");
  const automaticSources=sources.filter(s=>!["manual","local"].includes(s.provider) && !s.legacy);
  const groups=Object.values(automaticSources.reduce((result,source)=>{const link=source.runs?.[0] || {};const runId=source.runId || link.id || link.runId;const profileId=source.profileId || link.profileId;const run=data.runs.find(r=>r.id===runId);const profile=data.profiles.find(p=>p.id===(profileId || run?.profileId));const key=runId || profileId || "related";if(!result[key])result[key]={key,name:source.profileName || link.profileName || profile?.name || "相关调研资料",date:source.runCreatedAt || run?.createdAt || link.createdAt,items:[]};result[key].items.push(source);return result;},{}));
  const startTopic = async event => {event.preventDefault();const name=topic.trim();if(!name)return;const result=await act("start",async()=>{let profile=data.profiles.find(p=>p.name===name);if(!profile){const saved=await api.intelligenceProfile({name,query:name,frequency:"manual"});profile=saved.profile;}if(!profile?.id)throw new Error("主题保存失败，请重试");setSelectedTopic(profile.id);await api.intelligenceRun(profile.id);return profile;},"正在寻找相关资料，结果会自动出现在这里");if(result)setTopic("");};
  const saveProfile = async event => {event.preventDefault();const result=await act("profile",()=>api.intelligenceProfile({...editing,query:editing.query?.trim() || editing.name.trim()}),"关注方向已保存");if(result)setEditing(null);};
  const saveNote = async event => {event.preventDefault();const result=await act("note",()=>api.intelligenceSource(note),"已收集，下次相关调研会参考这条记录");if(result){const body=note.body;setNote({title:"",body:"",url:""});setShowNote(false);try{const linked=await api.wikiConnections(body.slice(0,500));setConnections(linked.items || []);}catch{setNotice("灵感已保存，Wiki 关联暂时无法读取");}}};
  return <div className="intelligence">
    <PageHeader
      title={page === "runs" ? "处理记录" : page === "settings" ? "关注与调研" : page === "inbox" ? (initialAction === "manual" ? "我的灵感" : "收集箱") : "选题发现"}
      aside={page === "runs" ? <button className="btn" onClick={()=>onGo("intel")}>返回精选</button> : page === "settings"
        ? <button className="btn btn-primary" onClick={()=>setEditing(fresh())}>添加主题</button>
        : page === "inbox" && inboxTab === "manual"
          ? <button className="btn btn-primary" onClick={()=>setShowNote(v=>!v)}>{showNote ? "收起记录" : "记一条灵感"}</button>
          : <button className="btn" onClick={()=>onGo("intel-settings")}>关注的主题</button>}
    />
    {error && <ErrorNote error={{message:error}} what="读取情报" onRetry={()=>load()} />}
    {loading ? <p role="status">正在读取情报…</p> : <>
      {active.length>0 && <div className="intel-active" aria-live="polite">{active.map(run=><div key={run.id}><span>{data.profiles.find(p=>p.id===run.profileId)?.name || "调研"} · {STATUS[run.status]}{run.stage ? ` · ${stageLabel(run.stage)}` : ""}</span><button className="btn" disabled={Boolean(busy)} onClick={()=>act(run.id,()=>api.intelligenceCancel(run.id))}>取消调研</button></div>)}</div>}
      {page === "discover" && <>
        <form className="intel-topic-start" onSubmit={startTopic}>
          <label htmlFor="intel-topic-input">这次想了解什么？</label>
          <div><input id="intel-topic-input" required maxLength={120} value={topic} onChange={e=>setTopic(e.target.value)} placeholder="例如：GPT 模型的进展和实际使用"/><button className="btn btn-primary" disabled={Boolean(busy) || !topic.trim()}>{busy==="start" ? "正在开始…" : "开始调研"}</button></div>
        </form>
        <div className="intel-result-toolbar"><div className="chips-sm" aria-label="选题状态">{[["new","待挑选"],["watch","继续观察"],["adopted","已采用"],["dismissed","不感兴趣"]].map(([key,label])=><button key={key} className="chip" aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>{data.profiles.length>0 && <select aria-label="筛选调研主题" value={selectedTopic} onChange={e=>setSelectedTopic(e.target.value)}><option value="">全部主题</option>{data.profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}</div>
        {!cards.length && <div className="intel-empty"><h2>{active.length ? "AI 正在寻找与你的主题相关的内容" : data.runs.length ? "这个范围下暂时没有候选" : "从一个想了解的主题开始"}</h2><p>{active.length ? "先阅读资料，再判断哪些问题值得展开。完成后会自动显示结果。" : data.runs.length ? "可以换一个主题或查看调研记录。资料不足时不会为凑数生成选题。" : "AI 会查找相关资料、连接已有知识，再给出有依据的选题建议。无需先配置平台和账号。"}</p>{data.runs.some(r=>["failed","partial"].includes(r.status)) && <button className="btn" onClick={()=>onGo("intel-settings")}>查看未完成的调研</button>}</div>}
        <div className="intel-cards">{cards.map(card=><article className="intel-card" key={card.id}><div className="intel-meta"><span>{card.researchId ? "已采用" : card.status === "watch" ? "继续观察" : card.status === "dismissed" ? "不感兴趣" : "选题候选"}</span><span>{time(card.updatedAt)}</span></div><h2>{card.question}</h2><p className="intel-why">{card.why}</p><details className="intel-card-thinking"><summary>展开思路</summary><dl><dt>表达角度</dt><dd>{card.angle}</dd>{card.audience && <><dt>适合谁看</dt><dd>{card.audience}</dd></>}{card.wiki?.length>0 && <><dt>与你的连接</dt><dd>{card.wiki.map(wiki=><div key={wiki.id}><button className="intel-link" onClick={()=>onGo("entries",wiki.id)}>{wiki.title}</button>{wiki.reason && ` · ${wiki.reason}`}</div>)}</dd></>}{listText(card.gaps) && <><dt>还缺什么</dt><dd>{listText(card.gaps)}</dd></>}</dl></details><details><summary>查看依据 · {card.evidence?.length || 0} 条</summary><p className="intel-hint">上方是 AI 的候选解释；以下为实际收集到的来源与摘录。</p>{card.evidence?.map((e,index)=>{const source=data.sources.find(s=>s.id===e.sourceId);const url=safeUrl(source?.url);return <div className="intel-evidence" key={`${e.sourceId}-${index}`}><strong>{source?.title || "来源暂不可用"}</strong><p className="intel-hint">{sourceLabel(source?.provider)} {source?.readLevel && ` · ${source.readLevel === "original" ? "已读取原文" : "读取范围有限"}`} {time(source?.publishedAt)}</p><blockquote>{e.quote}</blockquote>{url && <a href={url} target="_blank" rel="noreferrer">查看原文 ↗</a>}{source?.body && <IntelligenceSourceDisclosure source={source}>已读取的内容</IntelligenceSourceDisclosure>}</div>;})}</details><footer><button className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>openCard(card)}>{busy===card.id ? "处理中…" : card.researchId ? "继续讨论" : "采用并一起讨论"}</button>{!card.researchId && <><button className="btn" disabled={Boolean(busy)} onClick={()=>act(card.id,()=>api.intelligenceCard(card.id,{status:card.status==="watch" ? "new":"watch"}))}>{card.status==="watch" ? "放回待挑选" : "留着观察"}</button><button className="btn" disabled={Boolean(busy)} onClick={()=>act(card.id,()=>api.intelligenceCard(card.id,{status:card.status==="dismissed" ? "new":"dismissed"}))}>{card.status==="dismissed" ? "恢复候选" : "不感兴趣"}</button></>}</footer></article>)}</div>
      </>}
      {page === "inbox" && <>
        <div className="intel-result-toolbar">{initialAction === "manual" ? <p className="intel-hint">留下疑问、经历或资料，随时带入选题。</p> : <div className="chips-sm"><button className="chip" aria-pressed={inboxTab==="research"} onClick={()=>setInboxTab("research")}>调研资料</button><button className="chip" aria-pressed={inboxTab==="manual"} onClick={()=>setInboxTab("manual")}>我的灵感</button></div>}<SearchBox value={search} onChange={setSearch} ariaLabel="搜索收集内容" placeholder="搜索已收集内容" /></div>
        {inboxTab === "manual" && <>{showNote && <form className="intel-note" onSubmit={saveNote}><label>标题<input aria-label="标题" required maxLength={300} value={note.title} onChange={e=>setNote({...note,title:e.target.value})} placeholder="一个疑问或观察"/></label><label>内容<textarea aria-label="内容" required rows={3} value={note.body} onChange={e=>setNote({...note,body:e.target.value})} placeholder="写下想法或粘贴资料"/></label><label>来源链接（可选）<input type="url" value={note.url} onChange={e=>setNote({...note,url:e.target.value})} placeholder="https://"/></label><button className="btn btn-primary" disabled={Boolean(busy) || !note.title.trim() || !note.body.trim()}>保存灵感</button></form>}{connections.length>0 && <details className="intel-source"><summary>发现 {connections.length} 条 Wiki 关联</summary>{connections.map(item=><p key={item.id}><button className="intel-link" onClick={()=>onGo("entries",item.id)}>{item.title}</button> · {item.reason || item.excerpt}</p>)}</details>}{!manualSources.length && <p className="intel-empty">{search ? "没有匹配的灵感" : "还没有灵感，记一条想法或从 AI 热点收藏资料。"}</p>}{manualSources.map(source=><IntelligenceSourceDisclosure className="intel-source" key={source.id} source={source} onLink={setLinking}>{source.title}<span>{time(source.createdAt)}</span></IntelligenceSourceDisclosure>)}</>}
        {inboxTab === "research" && <>{!groups.length && <div className="intel-empty"><h2>{data.runs.length ? "暂未找到匹配的外部资料" : "这里会留下调研找到的外部资料"}</h2><p>{data.runs.length ? "本次可能只关联了已有知识与素材，可在选题卡的依据中查看。找到的外部资料会按调研批次归在这里。" : "AI 找到并确认与主题相关的外部资料会按调研归在一起，已有知识仍在选题依据中呈现。"}</p><button className="btn" onClick={()=>onGo("intel")}>开始一个主题</button></div>}{groups.map(group=><section className="intel-source-group" key={group.key}><header><h2>{group.name}</h2><span>{time(group.date)} · {group.items.length} 条资料</span></header>{group.items.map(source=><IntelligenceSourceDisclosure className="intel-source" key={source.id} source={source}>{source.title}<span>{sourceLabel(source.provider)}{source.reason ? ` · ${source.reason}` : ""}</span></IntelligenceSourceDisclosure>)}</section>)}</>}
      </>}
      {["settings","runs"].includes(page) && <>
        {page === "settings" && <>
        {editing && <form className="intel-profile-form" onSubmit={saveProfile}><h2>{editing.id ? "编辑主题" : "添加主题"}</h2><label>关注主题<input aria-label="关注主题" required maxLength={120} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})} placeholder="例如：GPT 模型的进展和实际使用"/></label><label>多久看看新进展<select aria-label="调研频率" value={editing.frequency} onChange={e=>scopeChange({frequency:e.target.value})}><option value="manual">需要时调研</option><option value="daily">每天</option><option value="weekly">每周</option></select></label><details className="intel-advanced"><summary>补充要求与高级设置</summary><label>想重点了解什么（可选）<textarea aria-label="补充要求" rows={2} value={editing.query} onChange={e=>setEditing({...editing,query:e.target.value})} placeholder="不填时，AI 根据主题安排调研"/></label><p className="intel-hint">默认根据主题和可用工具寻找资料，使用已配置服务的账户额度；额度及超额规则以服务商为准。下方仅用于需要限定来源的情况。</p><label className="intel-check"><input type="checkbox" checked={Array.isArray(editing.providers)} onChange={e=>setEditing(current=>{const next={...current};if(e.target.checked)next.providers=["local","web"];else{delete next.providers;delete next.accounts;delete next.subreddits;delete next.limit;}return next;})}/>限定调研来源</label>{Array.isArray(editing.providers) && <><fieldset>{Object.entries(PROVIDERS).map(([key,label])=><label className="intel-check" key={key}><input type="checkbox" checked={editing.providers.includes(key)} onChange={e=>scopeChange({providers:e.target.checked ? [...editing.providers,key] : editing.providers.filter(p=>p!==key)})}/>{label}{data.capabilities[key] === false && <span className="intel-hint">（尚未配置）</span>}</label>)}</fieldset>{editing.providers.includes("x") && <label>指定 X 账号（可选）<input value={(editing.accounts || []).join(",")} onChange={e=>scopeChange({accounts:e.target.value.split(/[,，]/).map(s=>s.trim())})} placeholder="账号名，逗号分隔"/></label>}{editing.providers.includes("reddit") && <label>指定 Reddit 社区（可选）<input value={(editing.subreddits || []).join(",")} onChange={e=>scopeChange({subreddits:e.target.value.split(/[,，]/).map(s=>s.trim())})} placeholder="社区名，逗号分隔"/></label>}<label>每个来源读取上限<input type="number" min="1" max="20" value={editing.limit || 5} onChange={e=>scopeChange({limit:Number(e.target.value)})}/></label></>}</details><footer><button className="btn btn-primary" disabled={Boolean(busy) || !editing.name.trim() || (Array.isArray(editing.providers) && !editing.providers.length)}>保存主题</button><button type="button" className="btn" onClick={()=>setEditing(null)}>取消</button></footer></form>}
        {!data.profiles.length && !editing && <div className="intel-empty"><h2>还没有持续关注的主题</h2><p>直接在选题发现输入主题即可开始，也可以在这里设置每天或每周跟进。</p></div>}
        {data.profiles.map(profile=><article className="intel-profile" key={profile.id}><div><h2>{profile.name}</h2><p className="intel-hint">{{manual:"需要时调研",daily:"每天跟进",weekly:"每周跟进"}[profile.frequency]}{profile.enabled === false && " · 已暂停"}</p></div><div className="intel-actions"><button className="btn" disabled={Boolean(busy) || active.some(r=>r.profileId===profile.id)} onClick={()=>act(profile.id,()=>api.intelligenceRun(profile.id),"已开始调研")}>调研一次</button><button className="btn" onClick={()=>setEditing({...fresh(),...profile})}>编辑</button>{profile.frequency!=="manual" && <button className="btn" disabled={Boolean(busy)} onClick={()=>act(profile.id,()=>api.intelligenceProfile({...profile,enabled:!profile.enabled}))}>{profile.enabled ? "暂停" : "启用"}</button>}</div></article>)}
        <p className="intel-hint intel-schedule-note">定期调研在工作台开启时执行，错过的计划会在下次开启后补跑。</p>
        </>}
        <section className="intel-history"><h2>调研记录</h2>{!data.runs.length && <p className="intel-hint">首次执行后，这里会记录实际来源覆盖和结果。</p>}{data.runs.map(run=><details key={run.id} className="intel-run"><summary><span>{data.profiles.find(p=>p.id===run.profileId)?.name || "调研"}</span><span>{STATUS[run.status] || run.status} · {time(run.createdAt)}</span></summary>{run.stage && <p>{stageLabel(run.stage)}</p>}{run.error && <p className="intel-error">{run.error}</p>}{run.coverage?.filter(c=>c.provider !== "plan").map((c,index)=><IntelligenceStep key={`${c.provider}-${index}`} step={c}/>)}{run.coverage?.filter(c=>c.uncertain).map(c=><label className="intel-recovery" key={c.provider}>{sourceLabel(c.provider)} 采集恢复 ID<p className="intel-hint">上次请求结果未确认。请从服务商任务记录填写已有采集 ID，避免重复付费；没有 ID 时不会重新发起付费采集。</p><input value={recovery[run.id]?.[c.provider] || ""} placeholder="s_…" onChange={e=>setRecovery({...recovery,[run.id]:{...recovery[run.id],[c.provider]:e.target.value}})}/></label>)}{["failed","partial","cancelled"].includes(run.status) && <button className="btn" disabled={Boolean(busy)} onClick={()=>act(run.id,()=>api.intelligenceRetry(run.id,{snapshotIds:recovery[run.id] || {}}),"已重新安排调研")}>重试调研</button>}</details>)}</section>
      </>}
    </>}
    {linking && <SourceResearchPicker source={linking} onClose={()=>setLinking(null)} onGo={onGo}/> }
    <Toast text={notice} onClose={()=>setNotice("")} />
  </div>;
}
