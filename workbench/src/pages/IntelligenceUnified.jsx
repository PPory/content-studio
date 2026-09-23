import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { BriefReading, briefCardMeta, freshnessLabel } from "../components/BriefReading.jsx";
import { BriefPeek } from "../components/BriefPeek.jsx";
import { IntelligenceAngles } from "../components/IntelligenceAngles.jsx";
import { IntelligenceHeader } from "../components/IntelligenceHeader.jsx";
import { IntelligenceNav } from "../components/IntelligenceNav.jsx";
import { AnchoredPopover } from "../components/AnchoredPopover.jsx";
import { AssistantPane } from "../components/assistant/AssistantPane.jsx";
import { Empty, ErrorNote, Loading, SearchBox, ViewTabs } from "../components/ui.jsx";
import "./intelligence-feed.css";
import "./intelligence-unified.css";

const groups={aihot:"AIhot",follow_builders:"Follow Builders",t2_media:"T2 媒体",community:"社区",legacy:"其他来源"};
const storageKey="intel-reading-view-v1";
function stored(){try{return JSON.parse(sessionStorage.getItem(storageKey)||"{}");}catch{return {};}}
function pendingKeys(){try{return JSON.parse(sessionStorage.getItem("intel-topic-operations")||"{}");}catch{return {};}}
const isTyping = target => target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input,textarea,select,a,summary"));
export function IntelligenceUnified({view="intel",state,onGo}) {
  const [data,setData]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState("");
  const [tab,setTab]=useState(()=>stored().tab||"recommended"),[scope,setScope]=useState(()=>stored().scope||"all");
  const [source,setSource]=useState(()=>stored().source||"all"),[query,setQuery]=useState(()=>stored().query||"");
  const [limit,setLimit]=useState(()=>stored().limit||8),[selected,setSelected]=useState(()=>stored().selected||[]);
  const [peekId,setPeekId]=useState(()=>stored().peekId||""),[brief,setBrief]=useState(null),[detailError,setDetailError]=useState(null),[nonce,setNonce]=useState(0);
  const [notice,setNotice]=useState(null),[settings,setSettings]=useState(view==="intel-settings"),[directions,setDirections]=useState("");
  const [joining,setJoining]=useState(null),[researches,setResearches]=useState([]),[target,setTarget]=useState(""),[notes,setNotes]=useState("");
  const [correction,setCorrection]=useState(null),[splitIds,setSplitIds]=useState([]),[mergeTarget,setMergeTarget]=useState("");
  const [chat,setChat]=useState(false);
  const settingsRef=useRef(null),joinRef=useRef(null),correctionRef=useRef(null),inflight=useRef(false),keys=useRef(pendingKeys());
  const full=view==="intel-detail",activeId=full?state:peekId;
  const load=useCallback(async()=>{try{const next=await api.intelligenceFeed();setData(next);setError(null);return next;}catch(e){setError(e);}},[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(!data?.activeRuns?.length)return;const timer=setInterval(()=>{if(!document.hidden)void load();},3500);return()=>clearInterval(timer);},[data?.activeRuns?.length,load]);
  useEffect(()=>{if(view==="intel-settings")setSettings(true);if(view!=="intel"||!state)return;try{const old=JSON.parse(state);if(old.briefIds?.length)setSelected(old.briefIds.slice(0,8));}catch{if(state==="aihot")setSource("aihot");}},[view,state]);
  useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify({tab,scope,source,query,limit,selected,peekId}));}catch{}},[tab,scope,source,query,limit,selected,peekId]);
  useEffect(()=>{if(settings){setDirections((data?.preferences?.directions||[]).join("\n"));settingsRef.current?.showModal();}},[settings]);
  useEffect(()=>{if(joining){joinRef.current?.showModal();api.researches().then(r=>setResearches((r.researches||[]).filter(x=>!x.legacyTopic))).catch(setError);}},[joining]);
  useEffect(()=>{if(correction)correctionRef.current?.showModal();},[correction]);
  const apply = next => {setData(d=>d?{...d,briefs:d.briefs.map(b=>b.id===next.id?next:b)}:d);setBrief(b=>b?.id===next.id?next:b);};
  useEffect(()=>{
    if(!activeId){setBrief(null);setDetailError(null);return;}let stopped=false;setBrief(null);setDetailError(null);
    api.intelligenceBrief(activeId).then(async r=>{if(stopped)return;setBrief(r.brief);if(!r.brief.read){try{const read=await api.intelligenceFeedback(r.brief.id,{read:true});if(!stopped)apply(read.brief);}catch(e){if(!stopped)setError(e);}}}).catch(e=>{if(!stopped)setDetailError(e);});
    return()=>{stopped=true;};
  },[activeId,nonce]);
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
    .filter(b=>!query||`${b.title} ${b.summary}`.toLowerCase().includes(query.toLowerCase()));
  const visible=list.slice(0,limit),position=visible.findIndex(x=>x.id===activeId);
  const step=delta=>{const at=position<0?0:Math.max(0,Math.min(visible.length-1,position+delta));if(visible[at])setPeekId(visible[at].id);};
  useEffect(()=>{if(full)return;const handler=e=>{if(e.metaKey||e.ctrlKey||e.altKey||settings||joining||correction)return;if(e.key==="Escape"&&peekId){e.preventDefault();closePeek();return;}if(isTyping(e.target))return;const item=visible.find(x=>x.id===peekId);const commands={j:()=>step(1),ArrowDown:()=>step(1),k:()=>step(-1),ArrowUp:()=>step(-1),s:()=>item&&feedback(item,{saved:!item.saved}),e:()=>item&&feedback(item,{dismissed:true})};if(commands[e.key]){e.preventDefault();commands[e.key]();}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);});
  const pick=id=>setSelected(ids=>ids.includes(id)?ids.filter(x=>x!==id):ids.length<8?[...ids,id]:ids);
  const change=fn=>{fn();setLimit(8);setPeekId("");setSelected([]);};
  const openFull=()=>{try{sessionStorage.setItem("intel-list-scroll",JSON.stringify({main:document.querySelector(".main")?.scrollTop||0,window:window.scrollY}));}catch{}onGo("intel-detail",peekId);};
  useEffect(()=>{if(full||!data)return;let frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{try{const p=JSON.parse(sessionStorage.getItem("intel-list-scroll")||"{}");document.querySelector(".main")?.scrollTo(0,p.main||0);window.scrollTo(0,p.window||0);}catch{}});});return()=>cancelAnimationFrame(frame);},[full,Boolean(data)]);
  const closePeek=()=>{const old=peekId;setPeekId("");requestAnimationFrame(()=>document.querySelector(`[data-brief="${CSS.escape(old)}"] .brief-card__title`)?.focus({preventScroll:true}));};
  const block=host=>act("block",()=>api.intelligenceBlockSource({host,blocked:true}));
  const notification=notice&&<div className="unified-notice" role="status"><span>{notice.text}</span>{notice.undo&&<button className="text-action" onClick={()=>{notice.undo();setNotice(null);}}>撤销</button>}{notice.researchId&&<button className="text-action" onClick={()=>onGo("research",notice.researchId)}>查看选题</button>}<button className="text-action" onClick={()=>setNotice(null)} aria-label="关闭提示">关闭</button></div>;
  const openCorrection=item=>{setPeekId(item.id);setSplitIds([]);setMergeTarget("");setCorrection(item);};
  const links=item=>item.researchLinks||item.researchIds?.map(id=>({id,title:"查看选题"}))||[];
  const topicControl=item=>{
    const topics=links(item);
    if(!topics.length)return <button className="btn btn-sm" disabled={!!busy} onClick={()=>addTopic([item.id])}>加入选题</button>;
    if(topics.length===1)return <button className="btn btn-sm topic-linked" onClick={()=>onGo("research",topics[0].id)}>✓ 已加入选题</button>;
    return <AnchoredPopover className="topic-links" panelClassName="topic-links__menu" label="已加入的选题" trigger={`✓ 已加入 ${topics.length} 个选题`} panelRole="menu">{close=>topics.map(topic=><button role="menuitem" key={topic.id} onClick={()=>{close();onGo("research",topic.id);}}>{topic.title||"查看选题"}</button>)}</AnchoredPopover>;
  };
  const controls=item=><><button className="text-action" disabled={!!busy} aria-pressed={!!item.saved} onClick={()=>feedback(item,{saved:!item.saved})}>{item.saved?"已收藏":"收藏"}</button>{topicControl(item)}<AnchoredPopover className="unified-card-more" panelClassName="unified-card-menu" label="卡片操作" trigger="···" panelRole="menu">{close=><><button role="menuitem" onClick={()=>{close();feedback(item,{dismissed:!item.dismissed});}}>{item.dismissed?"恢复推荐":"忽略"}</button><button role="menuitem" onClick={()=>{close();alternate([item.id]);}}>加入已有选题 / 补充想法</button></>}</AnchoredPopover></>;
  const updating=Boolean(data?.activeRuns?.length);
  const processingProblem=Boolean(data?.processing?.failures||data?.processing?.permissionRequired||data?.processing?.needsContext);
  const processingCount=Number(data?.processing?.pending||0);
  return <div className={`intel-workspace intel-feed intel-unified ${full?"intel-unified-full":""}`}>
    {!full?<>
      <IntelligenceHeader title="情报" action={<><IntelligenceNav current="intel" onGo={onGo}/><button className="btn btn-primary" disabled={!!busy||updating} onClick={()=>act("update",async()=>{await api.intelligenceRefreshFeed();await load();setNotice({text:"正在更新情报，已有内容仍可阅读"});})}>{busy==="update"||updating?"正在更新…":"更新情报"}</button></>}/>
      <div className="unified-toolbar">
        <ViewTabs items={[{key:"recommended",label:"推荐"},{key:"saved",label:"已收藏"}]} value={tab} onChange={v=>change(()=>{setTab(v);setScope("all");})} label="情报范围"/>
        <div className="unified-toolbar__actions">
          <SearchBox value={query} onChange={v=>change(()=>setQuery(v))} ariaLabel="搜索情报" placeholder="搜索情报"/>
          <AnchoredPopover className="unified-filters" panelClassName="unified-filter-panel" label="筛选情报" trigger={scope!=="all"||source!=="all"?"筛选 · 已启用":"筛选"}>
            <fieldset><legend>阅读状态</legend>{[["all","全部"],["unread","未读"],["history","历史与待复核"],["dismissed","已忽略"]].map(([value,label])=><label key={value}><input type="radio" name="intel-scope" value={value} checked={scope===value} onChange={()=>change(()=>setScope(value))}/>{label}</label>)}</fieldset>
            <label className="unified-filter-select">信源<select aria-label="情报信源" value={source} onChange={e=>change(()=>setSource(e.target.value))}><option value="all">全部信源</option>{Object.entries(groups).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
            <button className="text-action unified-filter-settings" onClick={()=>setSettings(true)}>设置关注方向</button>
          </AnchoredPopover>
        </div>
      </div>
      {data&&<p className={`unified-update-status ${processingProblem?"has-problem":""}`}>{updating?<>{processingCount>0?`正在整理 ${processingCount} 份新增资料…`:"正在同步信源并整理情报…"}</>:processingProblem?<><span>部分资料需要处理</span><button className="text-action" onClick={()=>onGo("intel-runs")}>查看详情</button></>:data.lastSuccessfulUpdate?<span>最近更新 {new Date(data.lastSuccessfulUpdate).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>:<span>尚未更新</span>}</p>}
    </>:<header className="brief-detail-toolbar"><button className="btn" onClick={()=>onGo("intel")}>← 返回情报</button><div>{brief&&controls(brief)}<button className="btn" onClick={()=>setChat(v=>!v)}>{chat?"收起讨论":"和 AI 聊聊"}</button></div></header>}
    {error&&<ErrorNote error={error} what="处理情报" onRetry={load}/>} {notification}
    {full?<>{detailError?<ErrorNote error={detailError} what="打开情报" onRetry={()=>setNonce(n=>n+1)}/>:!brief?<Loading rows={4}/>:<div className={`brief-detail-layout ${chat?"with-chat":""}`}><article className="brief-reading"><BriefReading brief={brief} onGo={onGo} onBlock={block}/>{brief.reviewClusterId&&<div className="unified-detail-feedback"><span>资料归到一起有误？</span><button className="text-action" onClick={()=>openCorrection(brief)}>纠正分组</button></div>}<IntelligenceAngles key={`${brief.id}:${brief.version}`} brief={brief} onChoose={angle=>addTopic([brief.id],angle)}/></article>{chat&&<aside className="brief-chat"><AssistantPane embedded scope="global" surface="page" scopeId={brief.scopeId||`intelligence:${brief.id}`} initialConversationId={brief.conversations?.[0]?.id||""} document={{title:brief.title,body:brief.body,intelligenceId:brief.id}} materials={[]} target={{kind:"none",editable:false}} draftStorageKey={`intelligence:${brief.id}`}/></aside>}</div>}</>:<>
      {!data&&!error?<Loading rows={5}/>:<div className={`intel-feed__body ${peekId?"has-peek":""}`}><div className="intel-feed__list">{!list.length?<Empty><h2>{query||source!=="all"?"没有匹配的情报":tab==="saved"?"还没有收藏的情报":scope==="dismissed"?"没有已忽略的情报":"暂时没有符合条件的推荐"}</h2><p>已有材料和历史记录会保留；未完成筛选的内容不会冒充推荐。</p><button className="btn" onClick={()=>onGo("intel-resources")}>查找原始资料</button></Empty>:<div className="brief-grid">{visible.map(item=><article className={`brief-card ${item.read?"is-read":""} ${peekId===item.id?"is-active":""} ${selected.includes(item.id)?"is-picked":""}`} key={item.id} data-brief={item.id}><div className="brief-card__top"><span className="brief-card__kind">{freshnessLabel(item.freshnessKind)}{item.changeNote?" · 有新进展":""}</span><label className="brief-card__pick"><input type="checkbox" aria-label={`选择：${item.title}`} checked={selected.includes(item.id)} disabled={!selected.includes(item.id)&&selected.length>=8} onChange={()=>pick(item.id)}/></label></div><button className="brief-card__title" onClick={()=>setPeekId(item.id)}>{!item.read&&<span className="brief-card__dot" aria-label="未读"/>}{item.title}</button><p className="brief-card__summary">{item.summary}</p>{item.whyItMatters&&<p className="unified-card-value"><strong>值得关注：</strong>{item.whyItMatters}</p>}<p className="brief-card__meta">{briefCardMeta(item)}{item.sourceCount?` · ${item.sourceCount} 份材料`:""}{item.editorialState!=="ready"?" · 待复核":""}</p><footer>{controls(item)}</footer></article>)}</div>}{list.length>limit&&<button className="btn unified-load-more" onClick={()=>setLimit(v=>v+8)}>查看更多（还有 {list.length-limit} 条）</button>}</div>{peekId&&<BriefPeek brief={brief} error={detailError?.message} loading={!brief&&!detailError} position={position+1} total={visible.length} busy={busy} onRetry={()=>setNonce(n=>n+1)} onClose={closePeek} onFull={openFull} onPrev={position>0?()=>step(-1):undefined} onNext={position>=0&&position<visible.length-1?()=>step(1):undefined} onFeedback={patch=>brief&&feedback(brief,patch)} onMerge={()=>brief&&(links(brief).length?onGo("research",links(brief)[0].id):addTopic([brief.id]))} mergeLabel={brief&&links(brief).length?"查看选题":"加入选题"} onCorrectGroup={brief?.reviewClusterId?()=>openCorrection(brief):undefined} onGo={onGo} onBlock={block}/>}</div>}
      {!!selected.length&&<div className="brief-selection-bar"><span>已选 {selected.length} 条</span><button className="btn btn-primary" disabled={!!busy} onClick={()=>addTopic(selected)}>将所选情报加入一个选题</button><button className="btn" disabled={!!busy} onClick={()=>alternate(selected)}>加入已有选题 / 补充想法</button><button className="text-action" onClick={()=>setSelected([])}>取消选择</button></div>}
    </>}
    {settings&&<dialog className="brief-settings" ref={settingsRef} aria-label="关注方向" onCancel={()=>setSettings(false)}><h2>关注方向</h2>{error&&<ErrorNote error={error} what="保存关注方向"/>}<p>用于排序和解释价值，不会把无关内容放进 AI 推荐。</p><label>每行一个方向<textarea aria-label="关注方向内容" rows={6} value={directions} onChange={e=>setDirections(e.target.value)}/></label><footer><button className="btn btn-primary" disabled={!!busy} onClick={()=>act("settings",async()=>{await api.intelligencePreferences({directions:directions.split("\n").map(x=>x.trim()).filter(Boolean)});setSettings(false);await load();})}>保存关注方向</button><button className="btn" onClick={()=>setSettings(false)}>取消</button></footer></dialog>}
    {joining&&<dialog className="brief-settings" ref={joinRef} aria-label="加入选题" onCancel={()=>setJoining(null)}><h2>将 {joining.ids.length} 条情报加入一个选题</h2>{error&&<ErrorNote error={error} what="保存选题"/>}<label>保存到<select aria-label="保存到选题" value={target} onChange={e=>setTarget(e.target.value)}><option value="">新选题</option>{researches.map(r=><option key={r.id} value={r.id}>{r.question||r.title}</option>)}</select></label><label>我的想法（可选）<textarea aria-label="我的选题想法" rows={4} value={notes} onChange={e=>setNotes(e.target.value)}/></label><p>保留资料出处，不会自动开始 AI 研究或创建文章。</p><footer><button className="btn btn-primary" disabled={!!busy} onClick={()=>addTopic(joining.ids,joining.angle,{...(target?{researchId:target}:{}),notes,operationId:joining.operationId})}>保存选题</button><button className="btn" onClick={()=>setJoining(null)}>取消</button></footer></dialog>}
    {correction&&<dialog className="brief-settings" ref={correctionRef} aria-label="纠正分组" onCancel={()=>setCorrection(null)}><h2>纠正分组</h2>{error&&<ErrorNote error={error} what="纠正分组"/>}<p>拆分或合并会保存你的分组决定，不删除原始资料。</p>{!brief?<Loading rows={2}/>:<><fieldset><legend>将所选材料拆成独立卡片</legend>{(brief.sourceDocuments||brief.sources||[]).map(s=><label key={s.id}><input type="checkbox" checked={splitIds.includes(s.id)} onChange={()=>setSplitIds(ids=>ids.includes(s.id)?ids.filter(x=>x!==s.id):[...ids,s.id])}/>{s.title}</label>)}<button className="btn" disabled={!!busy||!splitIds.length} onClick={()=>correct("split")}>确认拆分</button></fieldset><label>合并到<select aria-label="合并目标" value={mergeTarget} onChange={e=>setMergeTarget(e.target.value)}><option value="">请选择另一条情报</option>{all.filter(b=>b.reviewClusterId&&b.id!==brief.id).map(b=><option key={b.id} value={b.reviewClusterId}>{b.title}</option>)}</select></label><button className="btn" disabled={!!busy||!mergeTarget} onClick={()=>correct("merge")}>确认合并</button></>}<button className="btn" onClick={()=>setCorrection(null)}>关闭</button></dialog>}
  </div>;
}
