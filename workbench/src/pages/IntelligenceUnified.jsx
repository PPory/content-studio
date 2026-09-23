import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { BriefReading, freshnessLabel, platformName, sourceDate } from "../components/BriefReading.jsx";
import { BriefPeek } from "../components/BriefPeek.jsx";
import { EventReading, EventMarks } from "../components/EventReading.jsx";
import { IconBookmark, IconBookmarkFilled, IconCheck, IconDots, IconPlus } from "../components/icons.jsx";
import { IntelligenceAngles } from "../components/IntelligenceAngles.jsx";
import { IntelligenceHeader } from "../components/IntelligenceHeader.jsx";
import { IntelligenceNav } from "../components/IntelligenceNav.jsx";
import { AnchoredPopover } from "../components/AnchoredPopover.jsx";
import { AssistantPane } from "../components/assistant/AssistantPane.jsx";
import { Empty, ErrorNote, LayoutToggle, Loading, SearchBox, ViewTabs } from "../components/ui.jsx";
import { useLayoutMode } from "../lib/use-layout-mode.js";
import "./intelligence-feed.css";
import "./intelligence-unified.css";

const groups={aihot:"AIhot",follow_builders:"Follow Builders",t2_media:"T2 媒体",community:"社区",legacy:"其他来源"};
const storageKey="intel-reading-view-v1";
function stored(){try{return JSON.parse(sessionStorage.getItem(storageKey)||"{}");}catch{return {};}}
function pendingKeys(){try{return JSON.parse(sessionStorage.getItem("intel-topic-operations")||"{}");}catch{return {};}}
/** 卡片日期用服务端算好的主日期（非评论来源里最新的发布时间），不再用最早那份材料的日期。 */
const cardMeta=item=>{const platforms=[...new Set((item.sourceMeta||[]).map(s=>platformName(s.provider)).filter(Boolean))];return [platforms.join(" · "),sourceDate(item.primaryDate||item.publicationRange?.to)||"日期未知"].filter(Boolean).join(" · ");};
/** 旧流程的卡没有事件标记，沿用原来的时效说明（中性字）。 */
const legacyKind=item=>[item.deepRead?"深读 · 原文较早":freshnessLabel(item.freshnessKind),item.readScope==="summary"?"仅基于摘要":"",item.changeNote?"有新进展":""].filter(Boolean).join(" · ");
const marks=item=>item.event?<EventMarks brief={item} withDepth/>:<span className="intel-mark">{legacyKind(item)}</span>;
/** 卡片和目录里的日期：今年的只写「9/23」，省下的宽度留给来源数，不被动作按钮挤成省略号。 */
const shortDate=value=>{const t=new Date(value||"");if(Number.isNaN(t.getTime()))return "日期未知";return t.getFullYear()===new Date().getFullYear()?`${t.getMonth()+1}/${t.getDate()}`:sourceDate(value);};
/** 「只看值得做」：价值为高或中的事件。卡上只标「高」，中的角度在详情里。 */
const worthDoing=item=>["high","medium"].includes(item.event?.creation?.value);
/** 不再限 8 条：一批 30 条，滚到底自动接着加载。 */
const PAGE=30;
const firstTab=value=>value==="saved"?"saved":"recommended";
const isTyping = target => target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input,textarea,select,a,summary"));
export function IntelligenceUnified({view="intel",state,onGo}) {
  const [data,setData]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState("");
  const [tab,setTab]=useState(()=>firstTab(stored().tab)),[scope,setScope]=useState(()=>stored().scope||"all");
  const [source,setSource]=useState(()=>stored().source||"all"),[query,setQuery]=useState(()=>stored().query||"");
  const [worth,setWorth]=useState(()=>Boolean(stored().worth)),[limit,setLimit]=useState(()=>Math.max(PAGE,stored().limit||0)),[selected,setSelected]=useState(()=>stored().selected||[]);
  const [peekId,setPeekId]=useState(()=>stored().peekId||""),[brief,setBrief]=useState(null),[detailError,setDetailError]=useState(null),[nonce,setNonce]=useState(0);
  const [notice,setNotice]=useState(null),[settings,setSettings]=useState(view==="intel-settings"),[directions,setDirections]=useState("");
  const [joining,setJoining]=useState(null),[researches,setResearches]=useState([]),[target,setTarget]=useState(""),[notes,setNotes]=useState("");
  const [correction,setCorrection]=useState(null),[splitIds,setSplitIds]=useState([]),[mergeTarget,setMergeTarget]=useState("");
  const [chat,setChat]=useState(false),[consent,setConsent]=useState(null);
  // 卡片 / 列表是显示偏好，和「选题」页同一颗开关、各页各存一份。
  const [layout,setLayout]=useLayoutMode("intel");
  const sentinelRef=useRef(null),settingsRef=useRef(null),joinRef=useRef(null),correctionRef=useRef(null),consentRef=useRef(null),inflight=useRef(false),keys=useRef(pendingKeys());
  const full=view==="intel-detail",activeId=full?state:peekId;
  const load=useCallback(async()=>{try{const next=await api.intelligenceFeed();setData(next);setError(null);return next;}catch(e){setError(e);}},[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(!data?.activeRuns?.length)return;const timer=setInterval(()=>{if(!document.hidden)void load();},3500);return()=>clearInterval(timer);},[data?.activeRuns?.length,load]);
  useEffect(()=>{if(view==="intel-settings")setSettings(true);if(view!=="intel"||!state)return;try{const old=JSON.parse(state);if(old.briefIds?.length)setSelected(old.briefIds.slice(0,8));}catch{if(state==="aihot")setSource("aihot");}},[view,state]);
  useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify({tab,scope,source,query,worth,limit,selected,peekId}));}catch{}},[tab,scope,source,query,worth,limit,selected,peekId]);
  useEffect(()=>{if(settings){setDirections((data?.preferences?.directions||[]).join("\n"));settingsRef.current?.showModal();}},[settings]);
  useEffect(()=>{if(joining){joinRef.current?.showModal();api.researches().then(r=>setResearches((r.researches||[]).filter(x=>!x.legacyTopic))).catch(setError);}},[joining]);
  useEffect(()=>{if(correction)correctionRef.current?.showModal();},[correction]);
  useEffect(()=>{if(consent)consentRef.current?.showModal();},[Boolean(consent)]);
  const apply = next => {setData(d=>d?{...d,briefs:d.briefs.map(b=>b.id===next.id?next:b)}:d);setBrief(b=>b?.id===next.id?next:b);};
  useEffect(()=>{
    if(!activeId){setBrief(null);setDetailError(null);return;}let stopped=false;setBrief(null);setDetailError(null);
    api.intelligenceBrief(activeId).then(async r=>{if(stopped)return;setBrief(r.brief);if(r.brief.event&&r.brief.depth!=="deep"&&!["queued","running","failed"].includes(r.brief.deepen?.status)){api.intelligenceDeepen(r.brief.id).then(d=>{if(!stopped)setBrief(b=>b?.id===r.brief.id?{...b,deepen:d.deepen}:b);}).catch(()=>{});}if(!r.brief.read){try{const read=await api.intelligenceFeedback(r.brief.id,{read:true});if(!stopped)apply(read.brief);}catch(e){if(!stopped)setError(e);}}}).catch(e=>{if(!stopped)setDetailError(e);});
    return()=>{stopped=true;};
  },[activeId,nonce]);
  // 深度解读生成中：每 3 秒看一次，生成完就换成完整解读。
  const deepening=brief?.event&&brief.depth!=="deep"&&["queued","running"].includes(brief.deepen?.status);
  useEffect(()=>{if(!deepening)return;const id=brief.id;const timer=setInterval(()=>{if(document.hidden)return;api.intelligenceBrief(id).then(r=>{setBrief(b=>b?.id===id?r.brief:b);if(r.brief.depth==="deep")apply(r.brief);}).catch(()=>{});},3000);return()=>clearInterval(timer);},[deepening,brief?.id]);
  const retryDeep=()=>brief&&api.intelligenceDeepen(brief.id,{force:true}).then(d=>setBrief(b=>b?.id===brief.id?{...b,deepen:d.deepen}:b)).catch(setError);
  const reading=item=>item.event?<EventReading brief={item} onGo={onGo} onBlock={block} onRetryDeep={retryDeep} onAddAngle={()=>addFromCreation(item)} dense/>:null;
  const act=async(key,fn)=>{setBusy(key);setError(null);try{return await fn();}catch(e){setError(e);return null;}finally{setBusy("");}};
  async function feedback(item,patch){const r=await act(item.id,()=>api.intelligenceFeedback(item.id,patch));if(!r)return;apply(r.brief);if(patch.dismissed){setNotice({text:"已忽略，可随时恢复",undo:()=>feedback(item,{dismissed:false})});if(peekId===item.id)setPeekId("");}else setNotice({text:patch.dismissed===false?"已恢复推荐":patch.saved===undefined?"已记录":patch.saved?"已收藏":"已取消收藏"});}
  async function addTopic(ids,angle,options={}){
    if(inflight.current)return;inflight.current=true;
    const {operationId:explicitOperationId,...intentOptions}=options;
    const payload={briefIds:[...new Set(ids)],...(angle?{angle}:{}),...intentOptions,confirmed:true};
    const signature=JSON.stringify(payload);let operationId=explicitOperationId||keys.current[signature];
    if(!operationId){operationId=crypto.randomUUID();keys.current[signature]=operationId;try{sessionStorage.setItem("intel-topic-operations",JSON.stringify(keys.current));}catch{}}
    const result=await act("topic",()=>api.intelligenceTopicIntent({...payload,operationId}));inflight.current=false;
    if(result){setNotice({text:"已加入选题",researchId:result.research.id});setJoining(null);setSelected([]);await load();}
  }
  function alternate(ids,angle){const signature=JSON.stringify({briefIds:ids,...(angle?{angle}:{}),confirmed:true});delete keys.current[signature];try{sessionStorage.setItem("intel-topic-operations",JSON.stringify(keys.current));}catch{}setTarget("");setNotes("");setJoining({ids,angle,operationId:crypto.randomUUID()});}
  async function correct(action){if(!brief?.reviewClusterId)return;const r=await act("correct",()=>api.intelligenceCorrectGroup(brief.reviewClusterId,{action,confirmed:true,...(action==="split"?{sourceIds:splitIds}:{targetId:mergeTarget})}));if(r){setCorrection(null);setNonce(n=>n+1);await load();setNotice({text:"分组已更新，人工决定会保留"});}}
  const all=data?.briefs||[];
  const ordered=(data?.recommendationIds||data?.featuredIds||[]).map(id=>all.find(b=>b.id===id)).filter(Boolean);
  const recommended=Array.isArray(data?.recommendationIds)?ordered:[...ordered,...all.filter(b=>!ordered.some(x=>x.id===b.id)&&b.editorialState==="ready")];
  const list=(tab==="saved"?all.filter(b=>b.saved):scope==="dismissed"?all.filter(b=>b.dismissed):scope==="history"?all:recommended)
    .filter(b=>tab==="saved"||scope==="dismissed"||!b.dismissed).filter(b=>scope!=="unread"||!b.read)
    .filter(b=>source==="all"||(b.sourceGroups||b.sourceMeta?.map(x=>x.sourceGroup)||[]).includes(source))
    .filter(b=>!worth||worthDoing(b))
    .filter(b=>!query||`${b.title} ${b.summary}`.toLowerCase().includes(query.toLowerCase()));
  const visible=list.slice(0,limit),position=list.findIndex(x=>x.id===activeId);
  // 键盘走到已加载的最后一条再往下，顺手加载下一批。
  const step=delta=>{const at=position<0?0:Math.max(0,Math.min(list.length-1,position+delta));if(at>=limit)setLimit(v=>v+PAGE);if(list[at])setPeekId(list[at].id);};
  useEffect(()=>{const node=sentinelRef.current;if(!node||typeof IntersectionObserver==="undefined")return;const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))setLimit(v=>v+PAGE);},{rootMargin:"600px 0px"});io.observe(node);return()=>io.disconnect();},[list.length,limit,Boolean(peekId),layout]);
  // 目录里当前那条始终在可视范围内（↑↓ 切换、从卡片点开都一样）。
  useEffect(()=>{if(!peekId)return;const frame=requestAnimationFrame(()=>document.querySelector(`.intel-index [data-brief="${CSS.escape(peekId)}"]`)?.scrollIntoView({block:"nearest"}));return()=>cancelAnimationFrame(frame);},[peekId]);
  useEffect(()=>{if(full)return;const handler=e=>{if(e.metaKey||e.ctrlKey||e.altKey||settings||joining||correction)return;if(e.key==="Escape"&&peekId){e.preventDefault();closePeek();return;}if(isTyping(e.target))return;const item=visible.find(x=>x.id===peekId);const commands={j:()=>step(1),ArrowDown:()=>step(1),k:()=>step(-1),ArrowUp:()=>step(-1),s:()=>item&&feedback(item,{saved:!item.saved}),e:()=>item&&feedback(item,{dismissed:true})};if(commands[e.key]){e.preventDefault();commands[e.key]();}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);});
  const pick=id=>setSelected(ids=>ids.includes(id)?ids.filter(x=>x!==id):ids.length<8?[...ids,id]:ids);
  const change=fn=>{fn();setLimit(PAGE);setPeekId("");setSelected([]);};
  const openFull=()=>{try{sessionStorage.setItem("intel-list-scroll",JSON.stringify({main:document.querySelector(".main")?.scrollTop||0,window:window.scrollY}));}catch{}onGo("intel-detail",peekId);};
  useEffect(()=>{if(full||!data)return;let frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{try{const p=JSON.parse(sessionStorage.getItem("intel-list-scroll")||"{}");document.querySelector(".main")?.scrollTo(0,p.main||0);window.scrollTo(0,p.window||0);}catch{}});});return()=>cancelAnimationFrame(frame);},[full,Boolean(data)]);
  const closePeek=()=>{const old=peekId;setPeekId("");requestAnimationFrame(()=>document.querySelector(`[data-brief="${CSS.escape(old)}"] :is(.brief-card__title,.brief-row__open)`)?.focus({preventScroll:true}));};
  const block=host=>act("block",()=>api.intelligenceBlockSource({host,blocked:true}));
  const notification=notice&&<div className="unified-notice" role="status"><span>{notice.text}</span>{notice.undo&&<button className="text-action" onClick={()=>{notice.undo();setNotice(null);}}>撤销</button>}{notice.researchId&&<button className="text-action" onClick={()=>onGo("research",notice.researchId)}>查看选题</button>}<button className="text-action" onClick={()=>setNotice(null)} aria-label="关闭提示">关闭</button></div>;
  const openCorrection=item=>{setPeekId(item.id);setSplitIds([]);setMergeTarget("");setCorrection(item);};
  const links=item=>item.researchLinks||item.researchIds?.map(id=>({id,title:"查看选题"}))||[];
  // 事件卡带创作判断时，加入选题会带上切入角度和时效（截止时间由服务端算）。
  const addFromCreation=item=>{const c=item.event?.creation;return addTopic([item.id],null,c&&c.value!=="low"?{creation:{angle:c.angle,window:c.window}}:{});};
  // 卡片动作是三个图标按钮：收藏、加入选题、更多。已发生的状态（已收藏、已加入选题）常驻，其余悬停才出现。
  const topicControl=item=>{
    const topics=links(item);
    if(!topics.length)return <button type="button" className="intel-act intel-act--topic" aria-label="加入选题" title="加入选题" disabled={!!busy} onClick={()=>addFromCreation(item)}><IconPlus aria-hidden="true" stroke={1.8}/>选题</button>;
    if(topics.length===1)return <button type="button" className="intel-act topic-linked" onClick={()=>onGo("research",topics[0].id)}><IconCheck aria-hidden="true" stroke={2}/>已加入选题</button>;
    return <AnchoredPopover className="topic-links" panelClassName="topic-links__menu" label="已加入的选题" trigger={<><IconCheck aria-hidden="true" stroke={2}/>已加入 {topics.length} 个选题</>} panelRole="menu">{close=>topics.map(topic=><button role="menuitem" key={topic.id} onClick={()=>{close();onGo("research",topic.id);}}>{topic.title||"查看选题"}</button>)}</AnchoredPopover>;
  };
  const controls=item=><>
    <button type="button" className="intel-act intel-act--icon" disabled={!!busy} aria-pressed={!!item.saved} aria-label={item.saved?"已收藏":"收藏"} title={item.saved?"取消收藏（s）":"收藏（s）"} onClick={()=>feedback(item,{saved:!item.saved})}>{item.saved?<IconBookmarkFilled aria-hidden="true"/>:<IconBookmark aria-hidden="true" stroke={1.8}/>}</button>
    {topicControl(item)}
    <AnchoredPopover className="unified-card-more" panelClassName="unified-card-menu" label="卡片操作" trigger={<IconDots aria-hidden="true" stroke={1.8}/>} panelRole="menu" align="end">{close=><><button role="menuitem" onClick={()=>{close();feedback(item,{dismissed:!item.dismissed});}}>{item.dismissed?"恢复推荐":"忽略"}</button><button role="menuitem" onClick={()=>{close();alternate([item.id]);}}>加入已有选题 / 补充想法</button></>}</AnchoredPopover>
  </>;
  const pickBox=item=><label className="brief-card__pick"><input type="checkbox" aria-label={`选择：${item.title}`} checked={selected.includes(item.id)} disabled={!selected.includes(item.id)&&selected.length>=8} onChange={()=>pick(item.id)}/></label>;
  const materials=item=>item.event?[`${item.event.sourceCount} 个来源`,item.event.discussionCount?`${item.event.discussionCount} 条讨论`:"",shortDate(item.primaryDate||item.event.latestAt)].filter(Boolean).join(" · "):`${cardMeta(item)}${item.sourceCount?` · ${item.sourceCount} 份材料`:""}${item.editorialState!=="ready"?" · 待复核":""}`;
  const unread=item=>!item.read&&<span className="intel-dot" role="img" aria-label="未读"/>;
  // 整张卡可点（按钮、勾选框除外）；标题仍是按钮，键盘从它进入。
  const openRow=(event,item)=>{if(event.target.closest("button,a,input,label,[role=menu],.anchored-popover"))return;setPeekId(item.id);};
  // 每张卡同一个骨架：顶行（未读点 + 标记 + 勾选框）、两行标题、两行概要、底行（信息 + 动作）。同一排等高，底行贴底。
  const card=item=><article className={`brief-card intel-card ${item.read?"is-read":""} ${peekId===item.id?"is-active":""} ${selected.includes(item.id)?"is-picked":""}`} key={item.id} data-brief={item.id} onClick={e=>openRow(e,item)}>
    <div className="intel-card__top">{unread(item)}<span className="intel-card__marks">{marks(item)}</span>{pickBox(item)}</div>
    <button type="button" className="brief-card__title" onClick={()=>setPeekId(item.id)}>{item.title}</button>
    <p className="brief-card__summary">{item.summary}</p>
    <footer className="intel-card__foot"><span className="brief-card__meta">{materials(item)}</span><span className="intel-acts">{controls(item)}</span></footer>
  </article>;
  // 列表行走共用的 `.rows / .row`（Wiki、选题同一种）：未读点、标题、概要、标记与信息、悬停出现的动作。
  const row=item=><div className={`row brief-row ${item.read?"is-read":""} ${peekId===item.id?"is-active":""} ${selected.includes(item.id)?"is-picked":""}`} key={item.id} data-brief={item.id}><div className="row-head">{pickBox(item)}<button type="button" className="row-title brief-row__open" onClick={()=>setPeekId(item.id)}>{unread(item)}{item.title}</button><span className="brief-row__summary">{item.summary}</span><span className="row-meta"><span className="intel-row__info">{marks(item)}<span className="brief-card__meta">{materials(item)}</span></span><span className="intel-row__acts intel-acts">{controls(item)}</span></span></div></div>;
  // 详情打开时左边换成紧凑目录：标题 + 标记与来源数，一屏扫十几条，动作都在详情底栏。
  const indexItem=item=><li key={item.id} data-brief={item.id} className={`intel-index__item ${item.read?"is-read":""} ${peekId===item.id?"is-active":""}`} onClick={e=>openRow(e,item)}><button type="button" className="intel-index__title" aria-current={peekId===item.id?"true":undefined} onClick={()=>setPeekId(item.id)}>{unread(item)}{item.title}</button><p className="intel-index__meta">{marks(item)}<span>{item.event?`${item.event.sourceCount} 个来源 · ${shortDate(item.primaryDate||item.event.latestAt)}`:cardMeta(item)}</span></p></li>;
  const updating=Boolean(data?.activeRuns?.length);
  const processingProblem=Boolean(data?.processing?.failures||data?.processing?.permissionRequired||data?.processing?.needsContext);
  const processingCount=Number(data?.processing?.pending||0);
  // 说清楚现在在哪一步：采集进度（第几个信源）比「整理 N 份」更接近真实情况；Reddit 慢，不让它挡住其它信源。
  const progress=data?.intake?.progress,stage=data?.activeRuns?.[0]?.stage||"";
  const collecting=progress&&progress.finished<progress.total&&!progress.redditOnly;
  const updateText=collecting?`正在采集信源（${progress.finished}/${progress.total}）${progress.running?`：${progress.running}`:""}…`
    :/补全|整理|筛选|导读|归并|判断/.test(stage)?`${stage}${progress?.redditOnly?" · Reddit 仍在采集，到了会自动补上":""}…`
    :progress?.redditOnly?"其它信源已整理完；Reddit 社区仍在采集，到了会自动补上"
    :processingCount>0?`正在整理 ${processingCount} 份新增资料…`:"正在同步信源并整理情报…";
  const intake=data?.intake,needsConsent=Boolean(intake&&!intake.consent?.publicSources),gap=Number(data?.processing?.permissionRequired||0);
  const redditQuota=intake?.reddit?.healthStatus==="QUOTA_EXHAUSTED";
  const openConsent=()=>setConsent({publicSources:true,reddit:intake?.redditApproved?(intake?.consent?.reddit??true):false,autoUpdate:intake?.autoUpdate!==false,...(intake?.consent?.publicSources?{publicSources:true,reddit:Boolean(intake.consent.reddit)}:{})});
  async function saveConsent(){const first=!intake?.consent?.publicSources;const r=await act("consent",()=>api.intelligenceSaveSettings(consent));if(!r)return;setConsent(null);await load();setNotice({text:r.run?"已开始更新情报，已有内容仍可阅读":first?"已保存":"授权已更新"});}
  const toolItems=close=>intake?.consent?.publicSources?<><button role="menuitemcheckbox" aria-checked={intake.autoUpdate!==false} onClick={()=>{close();act("auto",async()=>{await api.intelligenceSaveSettings({autoUpdate:intake.autoUpdate===false});await load();});}}>{intake.autoUpdate!==false?"✓ ":""}自动更新（每 6 小时）</button><button role="menuitem" onClick={()=>{close();openConsent();}}>AI 整理授权…</button></>:null;
  return <div className={`intel-workspace intel-feed intel-unified ${full?"intel-unified-full":""}`}>
    {!full?<>
      <IntelligenceHeader title="情报" action={<><IntelligenceNav current="intel" onGo={onGo} extra={toolItems}/><button className="btn btn-primary" disabled={!!busy||updating} onClick={()=>act("update",async()=>{await api.intelligenceRefreshFeed();await load();setNotice({text:"正在更新情报，已有内容仍可阅读"});})}>{busy==="update"||updating?"正在更新…":"更新情报"}</button></>}/>
      <div className="unified-toolbar">
        <ViewTabs items={[{key:"recommended",label:"热点"},{key:"saved",label:"已收藏"}]} value={tab} onChange={v=>change(()=>{setTab(v);setScope("all");})} label="情报范围"/>
        <div className="unified-toolbar__actions">
          <SearchBox value={query} onChange={v=>change(()=>setQuery(v))} ariaLabel="搜索情报" placeholder="搜索情报"/>
          <AnchoredPopover className="unified-filters" panelClassName="unified-filter-panel" label="筛选情报" trigger={scope!=="all"||source!=="all"||worth?"筛选 · 已启用":"筛选"}>
            <fieldset><legend>创作</legend><label><input type="checkbox" checked={worth} onChange={e=>change(()=>setWorth(e.target.checked))}/>只看值得做</label></fieldset>
            <fieldset><legend>阅读状态</legend>{[["all","全部"],["unread","未读"],["history","历史与待复核"],["dismissed","已忽略"]].map(([value,label])=><label key={value}><input type="radio" name="intel-scope" value={value} checked={scope===value} onChange={()=>change(()=>setScope(value))}/>{label}</label>)}</fieldset>
            <label className="unified-filter-select">信源<select aria-label="情报信源" value={source} onChange={e=>change(()=>setSource(e.target.value))}><option value="all">全部信源</option>{Object.entries(groups).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
            <button className="text-action unified-filter-settings" onClick={()=>setSettings(true)}>设置关注方向</button>
          </AnchoredPopover>
          <LayoutToggle value={layout} onChange={setLayout}/>
        </div>
      </div>
      {data&&<p className={`unified-update-status ${processingProblem||needsConsent||redditQuota?"has-problem":""}`}>{updating?<>{updateText}</>:needsConsent?<><span>{gap?`最近 7 天采到 ${gap} 条新资料，还没授权交给模型整理`:"新采集的资料需要授权后才能整理成情报"}</span><button className="text-action" onClick={openConsent}>允许并开始整理</button></>:redditQuota?<><span>Reddit 额度不足，社区内容暂由 Hacker News 补位</span><button className="text-action" onClick={()=>onGo("intel-runs")}>查看详情</button></>:processingProblem?<><span>{gap?`${gap} 条近期资料还没授权整理`:"部分资料需要处理"}</span><button className="text-action" onClick={()=>gap?openConsent():onGo("intel-runs")}>{gap?"查看授权":"查看详情"}</button></>:data.lastSuccessfulUpdate?<span>最近更新 {new Date(data.lastSuccessfulUpdate).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>:<span>尚未更新</span>}</p>}
    </>:<header className="brief-detail-toolbar"><button className="btn" onClick={()=>onGo("intel")}>← 返回情报</button><div>{brief&&controls(brief)}<button className="btn" onClick={()=>setChat(v=>!v)}>{chat?"收起讨论":"和 AI 聊聊"}</button></div></header>}
    {error&&<ErrorNote error={error} what="处理情报" onRetry={load}/>} {notification}
    {full?<>{detailError?<ErrorNote error={detailError} what="打开情报" onRetry={()=>setNonce(n=>n+1)}/>:!brief?<Loading rows={4}/>:<div className={`brief-detail-layout ${chat?"with-chat":""}`}><article className="brief-reading">{reading(brief)||<BriefReading brief={brief} onGo={onGo} onBlock={block}/>}{brief.reviewClusterId&&!brief.event&&<div className="unified-detail-feedback"><span>资料归到一起有误？</span><button className="text-action" onClick={()=>openCorrection(brief)}>纠正分组</button></div>}<IntelligenceAngles key={`${brief.id}:${brief.version}`} brief={brief} onChoose={angle=>addTopic([brief.id],angle)}/></article>{chat&&<aside className="brief-chat"><AssistantPane embedded scope="global" surface="page" scopeId={brief.scopeId||`intelligence:${brief.id}`} initialConversationId={brief.conversations?.[0]?.id||""} document={{title:brief.title,body:brief.body,intelligenceId:brief.id}} materials={[]} target={{kind:"none",editable:false}} draftStorageKey={`intelligence:${brief.id}`}/></aside>}</div>}</>:<>
      {!data&&!error?<Loading rows={5}/>:<div className={`intel-feed__body ${peekId?"has-peek":""}`}><div className="intel-feed__list">{!list.length?<Empty><h2>{worth&&!query?"最近没有标为值得做的事件":query||source!=="all"?"没有匹配的情报":tab==="saved"?"还没有收藏的情报":scope==="dismissed"?"没有已忽略的情报":"暂时没有符合条件的推荐"}</h2>{worth&&!query?<><p>最近 7 天里没有创作价值为高或中的事件。热点都还在，只是没有特别值得专门做一条的。</p><button className="btn" onClick={()=>change(()=>setWorth(false))}>看全部热点</button></>:needsConsent&&tab!=="saved"&&!query&&source==="all"?<><p>最近 7 天的新资料需要你授权交给模型整理，才能变成情报卡。</p><button className="btn btn-primary" onClick={openConsent}>允许并开始整理</button><button className="text-action" onClick={()=>onGo("intel-resources")}>查找原始资料</button></>:<><p>推荐只收最近 7 天的内容，更早的在「筛选 → 历史」里；未完成筛选的内容不会冒充推荐。</p><button className="btn" onClick={()=>onGo("intel-resources")}>查找原始资料</button></>}</Empty>:(peekId?<ol className="intel-index" aria-label="情报目录">{visible.map(indexItem)}</ol>:layout==="list"?<div className="rows brief-rows intel-rows">{visible.map(row)}</div>:<div className="brief-grid intel-card-grid">{visible.map(card)}</div>)}{list.length>limit?<div ref={sentinelRef} className="unified-more"><button type="button" className="text-action" onClick={()=>setLimit(v=>v+PAGE)}>继续加载（还有 {list.length-limit} 条）</button></div>:list.length>PAGE?<p className="unified-more">已显示全部 {list.length} 条</p>:null}</div>{peekId&&<BriefPeek brief={brief} error={detailError?.message} loading={!brief&&!detailError} position={position+1} total={list.length} busy={busy} onRetry={()=>setNonce(n=>n+1)} onClose={closePeek} onFull={openFull} onPrev={position>0?()=>step(-1):undefined} onNext={position>=0&&position<list.length-1?()=>step(1):undefined} onFeedback={patch=>brief&&feedback(brief,patch)} onMerge={()=>brief&&(links(brief).length?onGo("research",links(brief)[0].id):addTopic([brief.id]))} mergeLabel={brief&&links(brief).length?"查看选题":"加入选题"} onCorrectGroup={brief?.reviewClusterId&&!brief.event?()=>openCorrection(brief):undefined} onGo={onGo} onBlock={block} reading={reading}/>}</div>}
      {!!selected.length&&<div className="brief-selection-bar"><span>已选 {selected.length} 条</span><button className="btn btn-primary" disabled={!!busy} onClick={()=>addTopic(selected)}>将所选情报加入一个选题</button><button className="btn" disabled={!!busy} onClick={()=>alternate(selected)}>加入已有选题 / 补充想法</button><button className="text-action" onClick={()=>setSelected([])}>取消选择</button></div>}
    </>}
    {settings&&<dialog className="brief-settings" ref={settingsRef} aria-label="关注方向" onCancel={()=>setSettings(false)}><h2>关注方向</h2>{error&&<ErrorNote error={error} what="保存关注方向"/>}<p>用于排序和解释价值，不会把无关内容放进 AI 推荐。</p><label>每行一个方向<textarea aria-label="关注方向内容" rows={6} value={directions} onChange={e=>setDirections(e.target.value)}/></label><footer><button className="btn btn-primary" disabled={!!busy} disabled={!!busy} onClick={()=>act("settings",async()=>{await api.intelligencePreferences({directions:directions.split("\n").map(x=>x.trim()).filter(Boolean)});setSettings(false);await load();})}>保存</button><button className="btn" onClick={()=>setSettings(false)}>取消</button></footer></dialog>}
    {joining&&<dialog className="brief-settings" ref={joinRef} aria-label="加入选题" onCancel={()=>setJoining(null)}><h2>将 {joining.ids.length} 条情报加入一个选题</h2>{error&&<ErrorNote error={error} what="保存选题"/>}<label>保存到<select aria-label="保存到选题" value={target} onChange={e=>setTarget(e.target.value)}><option value="">新选题</option>{researches.map(r=><option key={r.id} value={r.id}>{r.question||r.title}</option>)}</select></label><label>我的想法（可选）<textarea aria-label="我的选题想法" rows={4} value={notes} onChange={e=>setNotes(e.target.value)}/></label><p>保留资料出处，不会自动开始 AI 研究或创建文章。</p><footer><button className="btn btn-primary" disabled={!!busy} onClick={()=>addTopic(joining.ids,joining.angle,{...(target?{researchId:target}:{}),notes,operationId:joining.operationId})}>保存选题</button><button className="btn" onClick={()=>setJoining(null)}>取消</button></footer></dialog>}
    {consent&&<dialog className="brief-settings intel-consent" ref={consentRef} aria-label="AI 整理授权" onCancel={()=>setConsent(null)}><h2>允许模型整理新资料</h2>{error&&<ErrorNote error={error} what="保存授权"/>}<p>情报要把资料正文发给你在设置里配置的模型，才能筛出和 AI 有关的内容、合并重复报道、写成卡片。只处理最近 7 天的资料；原文仍只保存在本机，随时可以收回。</p><fieldset><legend>哪些信源</legend><label><input type="checkbox" checked={consent.publicSources} onChange={e=>setConsent(c=>({...c,publicSources:e.target.checked}))}/>公开信源：AIhot、Follow Builders、科技媒体、Hacker News</label>{intake?.redditApproved?<label><input type="checkbox" checked={consent.reddit} onChange={e=>setConsent(c=>({...c,reddit:e.target.checked}))}/>Reddit 社区（付费采集，每天一次）</label>:<p className="intel-consent__hint">Reddit 需要先在「设置」里批准付费采集，批准后可在这里一并授权。</p>}</fieldset><label><input type="checkbox" checked={consent.autoUpdate} onChange={e=>setConsent(c=>({...c,autoUpdate:e.target.checked}))}/>打开应用期间每 6 小时自动更新</label><footer><button className="btn btn-primary" disabled={!!busy} onClick={saveConsent}>{intake?.consent?.publicSources?"保存":"允许并开始整理"}</button><button className="btn" onClick={()=>setConsent(null)}>{intake?.consent?.publicSources?"取消":"暂不"}</button></footer></dialog>}
    {correction&&<dialog className="brief-settings" ref={correctionRef} aria-label="纠正分组" onCancel={()=>setCorrection(null)}><h2>纠正分组</h2>{error&&<ErrorNote error={error} what="纠正分组"/>}<p>拆分或合并会保存你的分组决定，不删除原始资料。</p>{!brief?<Loading rows={2}/>:<><fieldset><legend>将所选材料拆成独立卡片</legend>{(brief.sourceDocuments||brief.sources||[]).map(s=><label key={s.id}><input type="checkbox" checked={splitIds.includes(s.id)} onChange={()=>setSplitIds(ids=>ids.includes(s.id)?ids.filter(x=>x!==s.id):[...ids,s.id])}/>{s.title}</label>)}<button className="btn" disabled={!!busy||!splitIds.length} onClick={()=>correct("split")}>确认拆分</button></fieldset><label>合并到<select aria-label="合并目标" value={mergeTarget} onChange={e=>setMergeTarget(e.target.value)}><option value="">请选择另一条情报</option>{all.filter(b=>b.reviewClusterId&&b.id!==brief.id).map(b=><option key={b.id} value={b.reviewClusterId}>{b.title}</option>)}</select></label><button className="btn" disabled={!!busy||!mergeTarget} onClick={()=>correct("merge")}>确认合并</button></>}<button className="btn" onClick={()=>setCorrection(null)}>关闭</button></dialog>}
  </div>;
}
