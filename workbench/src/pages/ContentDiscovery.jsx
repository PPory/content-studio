import {AssistantPane} from '../components/assistant/AssistantPane.jsx';
import {DirectionEvidence} from '../components/DirectionEvidence.jsx';
import {DirectionActions} from '../components/DirectionActions.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, SearchBox, relTime } from "../components/ui.jsx";
import { takeDiscoveryFocus } from "../lib/discovery-handoff.js";
import { IconSparkles, IconArrowRight, IconMessageQuestion, IconRefresh } from "../components/icons.jsx";
import "./content-bridge.css";
import "./content-discovery.css";

const FIT_LABELS = { strong: "很自然", medium: "值得继续", weak: "比较牵强" };
function dateLabel(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date) : "";
}

function OpportunityBrief({ connection, onDiscuss, onGo, busy, onBack, mobileDetail }) {
  const headingRef = useRef(null);
  useEffect(() => {
    if (mobileDetail && window.matchMedia("(max-width: 1000px)").matches) {
      headingRef.current?.closest("article")?.scrollIntoView({ block: "start", behavior: "instant" });
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [mobileDetail]);
  const anchors = connection.knowledgeAnchors || [];
  return (
    <article className="opportunity-brief" aria-label="方向详情">
      <header className="opportunity-brief__head">
        <div className="opportunity-brief__toolbar"><span>方向详情</span><button className="opportunity-mobile-back" type="button" onClick={onBack}>← 返回方向列表</button><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDiscuss(connection)}>聊聊这个方向<IconArrowRight aria-hidden="true" /></button></div>
        <h3 ref={headingRef} tabIndex={-1}>{connection.coreClaim}</h3>
        <p className="opportunity-brief__reason"><span className="opportunity-fit" data-fit={connection.fit}>{FIT_LABELS[connection.fit] || connection.fit}</span>{connection.fitReason}</p>
      </header>

      <section className="opportunity-brief__section">
        <h4>为什么值得关注</h4>
        <p className="discovery-card__q">{connection.problem.statement}</p>
        <small className="opportunity-evidence" data-origin={connection.problem.origin}>{connection.problem.evidenceLabel}</small>
        {connection.problem.evidence?.length ? (
          <details className="opportunity-quotes"><summary>看原话</summary>
            <ul className="discovery-quotes">{connection.problem.evidence.map((item, index) => (
              <li key={`${item.rawSourceId}:${index}`}><q>{item.quote}</q><small>{item.kindLabel}{item.sourceName ? ` · ${item.sourceName}` : ""}{item.observedAt ? ` · ${dateLabel(item.observedAt)}` : ""}</small></li>
            ))}</ul>
          </details>
        ) : null}
      </section>
      <section className="opportunity-brief__section">
        <h4>可以怎样理解</h4>
        <p>{connection.knowledgeExplanation}</p>
        {anchors.length>0&&<h4>与已有积累的连接</h4>}<ul className="opportunity-sources">{anchors.map((anchor) => (
          <li key={anchor.wikiPageId}><button type="button" onClick={() => onGo("entries", anchor.wikiPageId)}>{anchor.title}<IconArrowRight aria-hidden="true" /></button>{anchor.reason ? <p>{anchor.reason}</p> : null}</li>
        ))}</ul>
      </section>
      <section className="opportunity-brief__section"><h4>可能带来的新认识</h4><p>{connection.cognitiveGap}</p></section>
      {connection.evidenceGaps?.length ? <section className="opportunity-brief__section opportunity-brief__gaps"><h4>还需要验证</h4><ul>{connection.evidenceGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></section> : null}
      {(connection.basis?.length>0||connection.problem.evidence?.length>0)&&<section className="opportunity-brief__section"><h4>这个方向如何形成</h4><p>以下是实际引用的资料；上面的解释和方向仍待讨论验证。</p>{(connection.basis||[]).map((b,i)=><DirectionEvidence key={i} basis={b} onGo={onGo}/>)}{(connection.problem.evidence||[]).map((e,i)=><blockquote key={i}>{e.quote}<small>{e.sourceName||e.kindLabel||'已有记录'}</small></blockquote>)}</section>}
      {connection.agendaSuggestion?.reason ? <p className="opportunity-brief__agenda">{connection.agendaSuggestion.reason}</p> : null}

    </article>
  );
}

export function ContentDiscovery({ onGo, onCaptureVoice, initialDirection="" }) {
  const [data, setData] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [error, setError] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [developing, setDeveloping] = useState(false);
  const [directions,setDirections]=useState([]);
  const [openedDirection,setOpenedDirection]=useState(null);
  const [chat,setChat]=useState(false);
  const [prompt,setPrompt]=useState(null);
  const [notice,setNotice]=useState('');
  const [mergeDirection,setMergeDirection]=useState(null);
  useEffect(()=>{if(!initialDirection){setOpenedDirection(null);return;}api.intelligenceDirection(initialDirection).then(r=>setOpenedDirection(r.direction)).catch(setError);},[initialDirection]);
  const [focus, setFocus] = useState(() => takeDiscoveryFocus());
  const [research, setResearch] = useState([]);
  const [researchOpen, setResearchOpen] = useState(false);
  const [openConnection, setOpenConnection] = useState(0);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [view, setView] = useState("discover");
  const [savedQuery, setSavedQuery] = useState("");
  const [savedError, setSavedError] = useState(null);
  const [agendaSignals, setAgendaSignals] = useState(null);
  const [agendaCandidates, setAgendaCandidates] = useState(null);
  const [agendaBusy, setAgendaBusy] = useState(false);
  const [agendaKept, setAgendaKept] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      api.intelligenceDirections().then(r=>setDirections(r.directions||[])).catch(setError),
      api.contentDiscovery().then((result) => { setData(result); setError(null); }).catch(setError),
      api.contentOpportunities().then((result) => { setOpportunities(result.opportunities || []); setSavedError(null); }).catch(setSavedError),
      api.researchSignals().then((result) => setResearch(result.signals || [])),
      api.agendaSignals().then(setAgendaSignals),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const scan = useCallback(async ({ force = false, focusOverride } = {}) => {
    setView("discover");
    setScanning(true);
    setScanError(null);
    try {
      const result = await api.scanContentDiscovery({ force, focus: focusOverride || focus || undefined });
      setData((current) => ({ ...(current || {}), ...result }));
      setOpenedDirection(null);setChat(false);setOpenConnection(0);
      setMobileDetail(false);
    } catch (failure) {
      setScanError(failure);
    } finally {
      setScanning(false);
    }
  }, [focus]);

  const keep = async(connection)=>{
    const id=connection.directionId||openedDirection?.id;
    const result=await api.keepIntelligenceDirection(id);
    setDirections(items=>[result.direction,...items.filter(d=>d.id!==result.direction.id)]);
    return result.direction;
  };
  const act=async(connection,mode)=>{
    if(developing)return;setDeveloping(true);setScanError(null);
    try{const d=await keep(connection);setOpenedDirection(d);if(mode==='chat'||mode==='research'){setPrompt(mode==='research'?{id:crypto.randomUUID(),text:'请围绕这个方向的证据缺口，先提出需要查证的问题与可能的资料范围，和我确定后再采集。缺口：'+(connection.evidenceGaps||[]).join('；')}:null);setChat(true);}else if(mode==='merge')setMergeDirection(d);else setNotice('方向已保存，仍是待讨论的候选。');}
    catch(e){setScanError(e);}finally{setDeveloping(false);}
  };
  const scan_ = data?.scan || null;
  const connections = scan_?.connections || [];
  const read = scan_?.read || null;
  const stale = Boolean(data?.stale);
  const neverScanned = !scan_;

  const summary = useMemo(() => {
    if (!read) return "";
    const parts = [`${read.wikiPages} 条知识`];
    if (read.discoveries) parts.push(`${read.discoveries} 条情报与记录`);
    if (read.voices) parts.push(`${read.voices} 段原话`);
    if (read.problems) parts.push(`${read.problems} 条已确认问题`);
    return parts.join(" · ");
  }, [read]);

  const activeConnection = openedDirection?{...openedDirection.connection,directionId:openedDirection.id}:connections[openConnection] || connections[0];
  const filteredDirections=directions.filter(d=>`${d.connection.coreClaim} ${d.connection.problem.statement}`.toLowerCase().includes(savedQuery.toLowerCase()));
  const savedItems = opportunities.filter((item) => `${item.coreClaim} ${item.wikiTitle} ${item.audienceProblemStatement}`.toLowerCase().includes(savedQuery.toLowerCase()));

  return (
    <div className="view-body content-bridge content-discovery opportunity-home">
      <header className="opportunity-header">
        <div className="opportunity-header__identity"><IconSparkles aria-hidden="true" /><h2>发现方向</h2></div>
        <div className="opportunity-header__actions"><button className="btn btn-sm" onClick={()=>onGo("intel")}>← 今日精选</button><button type="button" className="btn btn-sm" onClick={() => onCaptureVoice?.("")}><IconMessageQuestion aria-hidden="true" />收集声音</button><button type="button" className="btn btn-sm" onClick={() => onGo("bridge", "manual")}>手动探索<IconArrowRight aria-hidden="true" /></button></div>
      </header>
      <nav className="opportunity-views" aria-label="方向视图">
        {[['discover', '发现方向', connections.length], ['saved', '已保存', opportunities.length+directions.length], ['research', '研究线索', research.length]].map(([id, label, count]) => <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>{label}<span>{count}</span></button>)}
      </nav>
      <ErrorNote error={error} what="读取方向" onRetry={load} />
      {notice&&<p role="status">{notice}</p>}
      {loading && !data ? <Loading rows={3} /> : null}
      <div hidden={view !== "discover"} className="opportunity-discover-view">
      <div className="opportunity-scan">
        <form onSubmit={(event) => { event.preventDefault(); if (!scanning) scan({ force: true }); }}>
          <IconSparkles aria-hidden="true" />
          <label className="sr-only" htmlFor="opportunity-focus">这次想关注的方向</label>
          <input id="opportunity-focus" value={focus} maxLength={500} onChange={(event) => setFocus(event.target.value)} disabled={scanning} placeholder="输入关注方向，或留空探索最近的积累" />
          <button type="submit" className={`btn${connections.length ? "" : " btn-primary"}`} disabled={scanning || loading || !data}>{scanning ? "正在寻找…" : scan_ ? "重新扫描" : "发现新方向"}</button>
        </form>
        <div className="opportunity-scan__meta"><span>{scan_ ? `${relTime(scan_.scannedAt)}扫描${summary ? ` · 读了 ${summary}` : ""}` : "结合近期情报、知识、灵感和讨论，寻找值得深入的问题。"}</span></div>
        {stale && data?.staleReason ? <p className="opportunity-update">{data.staleReason}</p> : null}
      </div>
      {scanError ? <div className="discovery-failed"><ErrorNote error={scanError} what="寻找新方向" onRetry={() => scan({ force: true })} /><p>已有机会没有被改动。你可以继续看上次的结果，或手动探索。</p></div> : null}
      {scanning ? <div className="opportunity-pending" role="status"><IconRefresh aria-hidden="true" /><div><strong>正在连接情报、积累和你关心的问题</strong><p>寻找有依据的方向；没有自然连接就不凑数。你可以继续浏览已有结果。</p></div></div> : null}
      {data && neverScanned && !scanning ? <section className="opportunity-welcome"><span className="opportunity-eyebrow">从好奇和积累里开始</span><h3>看看哪些问题值得再想一想。</h3><p>把情报、知识和记录放在一起看，先理解、先讨论，需要时再发展成选题。</p><ol><li><b>找方向</b><span>从情报与积累中发现连接</span></li><li><b>接着讨论</b><span>保存候选，想写时再带入选题</span></li></ol></section> : null}
      {activeConnection ? (
        <section className="opportunity-workspace" aria-label="值得发展的连接" data-mobile-detail={mobileDetail}>
          <div className="opportunity-index">
            <div className="opportunity-section-heading"><h3>发现的方向</h3><span>{connections.length} 条候选</span></div>
            <div className="opportunity-options">{connections.map((connection, index) => (
              <button type="button" className="opportunity-option" key={`${connection.problem.statement}:${index}`} aria-pressed={openedDirection?connection.directionId===openedDirection.id:activeConnection === connection} onClick={() => { setOpenedDirection(null);setChat(false);setOpenConnection(index); setMobileDetail(true); }}>
                <span className="opportunity-option__number" aria-hidden="true">◇</span><strong>{connection.coreClaim}</strong><p>{connection.problem.statement}</p><small>{connection.problem.origin === "hypothesis" ? "受众假设 · 待验证" : "有真实用户声音"}{connection.knowledgeAnchors?.length?` · ${connection.knowledgeAnchors.length} 条知识`:""}{connection.basis?.length?` · ${connection.basis.length} 条依据`:""}</small><span className="opportunity-option__read">查看方向<IconArrowRight aria-hidden="true" /></span>
              </button>
            ))}</div>

          </div>
          <OpportunityBrief key={openConnection} connection={activeConnection} onDiscuss={c=>act(c,"chat")} onGo={onGo} busy={scanning || developing} mobileDetail={mobileDetail} onBack={() => { setMobileDetail(false); requestAnimationFrame(() => document.querySelector(".opportunity-option[aria-pressed=true]")?.focus()); }} />
        </section>
      ) : null}
      {activeConnection&&<div className="direction-actions"><p>保存或开始讨论会留下这个候选，不创建文章。</p><button className="btn" disabled={developing} onClick={()=>act(activeConnection,'save')}>保存方向</button><button className="btn" disabled={developing} onClick={()=>act(activeConnection,'research')}>补充调研</button><button className="btn" disabled={developing} onClick={()=>act(activeConnection,'merge')}>带入选题</button></div>}
      {chat&&openedDirection&&<section className="direction-chat"><header><h3>聊聊这个方向</h3><button className="btn btn-sm" onClick={()=>setChat(false)}>收起讨论</button></header><AssistantPane key={openedDirection.id} embedded scope="global" surface="page" scopeId={openedDirection.scopeId} promptRequest={prompt} initialConversationId={openedDirection.conversations?.[0]?.id||''} document={{title:openedDirection.connection.coreClaim,body:JSON.stringify(openedDirection.connection)}} materials={[]} target={{kind:'none',editable:false}} emptyMessage="从你的疑问开始，也可以请 AI 根据缺口补充调研。" draftStorageKey={openedDirection.scopeId}/></section>}
      {mergeDirection&&<DirectionActions direction={mergeDirection} onClose={()=>setMergeDirection(null)} onGo={onGo}/>}
      {scan_ && !scanning && !connections.length ? <section className="opportunity-welcome"><h3>这次还没有值得展开的新方向</h3><p>{scan_.nothingFoundReason || "暂时没有足够依据形成自然的新方向。"}</p><div className="row-actions"><button type="button" className="btn" onClick={() => onCaptureVoice?.("", "find")}>去找找有没有人在说</button><button type="button" className="btn" onClick={() => onGo("entries")}>补充我的知识</button></div></section> : null}
      </div>
      <section hidden={view !== "saved"} id="opportunity-saved" tabIndex={-1} className="discovery-saved opportunity-saved" aria-label="进行中的内容机会">
        <header className="opportunity-section-heading"><div><h3>已保存的方向</h3><p>候选方向与此前保存的简报，需要时继续讨论</p></div>{opportunities.length+directions.length ? <SearchBox value={savedQuery} onChange={setSavedQuery} placeholder="搜索已保存的机会" ariaLabel="搜索已保存的机会" /> : null}</header>
        <ErrorNote error={savedError} what="读取已保存机会" onRetry={load} />
        {filteredDirections.map(d=><div className="direction-saved" key={d.id}><button className="brief-text-action" onClick={()=>{setOpenedDirection(d);setView('discover');setChat(false);setMobileDetail(true);}}>{d.connection.coreClaim}</button><p>{d.connection.problem.statement}</p><small>{d.researchId?'已带入选题':'待讨论'} · {dateLabel(d.updatedAt)}</small></div>)}
        {savedItems.length ? <ul className="opportunity-saved-list">{savedItems.map((item) => <li key={item.id}><button type="button" onClick={() => onGo("bridge", `opportunity:${item.id}`)} aria-label={`打开内容机会：${item.wikiTitle} × ${item.audienceProblemStatement}`}><div><strong>{item.coreClaim || item.audienceProblemStatement}</strong><p>{item.wikiTitle || "知识已移除"}<span> · </span>{item.audienceProblemStatement}</p></div><span className="opportunity-saved-list__status">{item.hasProject ? "已进入创作" : "待继续探索"}<small>{dateLabel(item.updatedAt)}更新</small></span><IconArrowRight aria-hidden="true" /></button></li>)}</ul> : !filteredDirections.length && !savedError && !loading ? <p className="opportunity-saved-empty">{savedQuery ? "没有找到匹配的机会，试试其他关键词。" : "还没有保存的机会。选一个方向，打磨讲法后，它会留在这里。"}</p> : null}
      </section>
      <aside hidden={view !== "research"} className="opportunity-context" aria-label="研究方向与长期议程">
      {research.length ? (
        <section className="discovery-research" aria-label="最近你在想的">
          <button type="button" aria-expanded={researchOpen} onClick={() => setResearchOpen((value) => !value)}>
            最近你在助手里想的 {research.length} 件事{researchOpen ? "" : "（扫描时会参考方向）"}
          </button>
          {researchOpen ? (
            <>
              <p className="discovery-research__gate">
                只取你自己写下的话。AI 的回答不算方向依据，更不算事实——知识仍然要回到 Wiki，证据仍然要回到原话。
              </p>
              <ul>
                {research.map((item) => (
                  <li key={item.conversationId}>
                    <strong>{item.title || "（未命名对话）"}</strong>
                    {/* ⚠️ 标题常常**就是第一句**（会话名取自开场那句），原样铺开时
                        屏幕上是同一句话连着出现两遍。重复的那句去掉再拼。 */}
                    <span>{item.userTurns.filter((turn) => turn !== item.title).join(" / ")}</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={scanning}
                      onClick={async () => {
                        try {
                          const result = await api.conversationFocus(item.conversationId);
                          setFocus(result.focus);
                          await scan({ force: true, focusOverride: result.focus });
                        } catch (failure) { setScanError(failure); }
                      }}
                    >按这段看一遍</button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {agendaSignals ? (
        <section className="discovery-agenda" aria-label="长期议程">
          {agendaSignals.ready ? (
            <>
              <div className="discovery-agenda__head">
                <strong>你最近反复在强化某个判断吗</strong>
                <button type="button" className="btn btn-sm" disabled={agendaBusy} onClick={async () => {
                  setAgendaBusy(true);
                  try {
                    const result = await api.agendaCandidates();
                    setAgendaCandidates(result);
                  } catch (failure) { setScanError(failure); } finally { setAgendaBusy(false); }
                }}>{agendaBusy ? "正在看…" : agendaCandidates ? "再看一遍" : "看看有没有一条长期议程"}</button>
              </div>
              {agendaCandidates && !agendaCandidates.agendas.length ? (
                <p className="discovery-agenda__none">{agendaCandidates.nothingFoundReason}</p>
              ) : null}
              {(agendaCandidates?.agendas || []).map((candidate) => (
                <article key={candidate.title} className="discovery-agenda__card">
                  <strong>{candidate.title}</strong>
                  <p>{candidate.desiredJudgment}</p>
                  <span>{candidate.reason}</span>
                  {/* 依据要摆出来：一条说不出「凭哪几条看出来」的议程，和自己写一句没区别。 */}
                  <small>
                    依据 {candidate.basis.length} 条 · 覆盖 {candidate.problemSpread} 个不同的用户问题
                    <br />{candidate.basis.map((item) => item.label).join("；")}
                  </small>
                  {agendaKept.includes(candidate.title) ? (
                    <em>已设为长期议程</em>
                  ) : (
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={async () => {
                        try {
                          await api.createAgenda({
                            title: candidate.title,
                            desiredJudgment: candidate.desiredJudgment,
                            audience: candidate.audience,
                            problemSpace: candidate.problemSpace,
                            confirmed: true,
                          });
                          setAgendaKept((items) => [...items, candidate.title]);
                        } catch (failure) { setScanError(failure); }
                      }}>设为长期议程</button>
                      <button type="button" className="btn btn-sm" onClick={() => setAgendaCandidates((current) => ({
                        ...current,
                        agendas: current.agendas.filter((item) => item.title !== candidate.title),
                      }))}>暂时不要</button>
                    </div>
                  )}
                </article>
              ))}
            </>
          ) : (
            /* ⚠️ 这条不画彩色左竖线（design-system 明令禁止），也不画引用块：
               它是一句进度说明，不是引文。安静一行，和上面的研究方向同一档。 */
            <p className="discovery-agenda__wait">
              还看不出一条长期议程：{agendaSignals.missing.join("；")}。
              {/* ⚠️ 措辞不要和顶栏那颗「手动探索」重名：一屏两个同名按钮，指的还不是同一件事。 */}
              {" "}要现在就定一条，可以<button type="button" className="linkish" onClick={() => onGo("bridge", "manual")}>自己写一条</button>。
            </p>
          )}
        </section>
      ) : null}
      </aside>
    </div>
  );
}
