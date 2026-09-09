import {DirectionBrowser} from '../components/DirectionBrowser.jsx';
import {AssistantPane} from '../components/assistant/AssistantPane.jsx';
import {DirectionEvidence} from '../components/DirectionEvidence.jsx';
import {DirectionActions} from '../components/DirectionActions.jsx';
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, FilterHeader, Loading, SearchBox, ViewTabs, relTime } from "../components/ui.jsx";
import { takeDiscoveryFocus } from "../lib/discovery-handoff.js";
import { IconSparkles, IconArrowRight, IconMessageQuestion, IconRefresh } from "../components/icons.jsx";
import "./content-bridge.css";
import "./content-discovery.css";

const FIT_LABELS = { strong: "很自然", medium: "值得继续", weak: "比较牵强" };
function dateLabel(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date) : "";
}

/**
 * 一个方向读起来该是什么样。
 *
 * ⚠️ **眉标从六个砍到两个。** 上一版是「为什么值得关注 / 可以怎样理解 /
 * 与已有积累的连接 / 可能带来的新认识 / 还需要验证 / 这个方向如何形成」，
 * 一屏光灰色标签就占六行——而 `docs/design-system.md` 里那条判据
 *（「读了内容还猜不出这是什么」才值得挂标签）当初就是从这张卡上总结出来的。
 *
 * 逐个过一遍：一个**问号**不用标注「这是个问题」，何况它底下那行
 * `evidenceLabel` 已经说了它是「你认为的受众问题，尚待验证」——两句连着出现是
 * 文档里点名批过的重复；一段**解释**读了就知道是解释；一句**加粗的结论**不用
 * 标注「这是结论」。留下来的两个是猜不出来的：一列词条名要说清是什么列表，
 * 几行待办要说清它们还没做。
 *
 * ⚠️ **原话只摆一处。** 上一版「看原话」和「这个方向如何形成」渲染的是同一批
 * `problem.evidence`，同一段引文在一屏上出现两遍。现在合到底部那个折叠里，
 * 和 `basis` 一起——它们回答的是同一个问题：这条方向凭什么。
 */
function OpportunityBrief({ connection, onDiscuss, onGo, busy }) {
  const anchors = connection.knowledgeAnchors || [];
  const basis = connection.basis || [];
  const quotes = connection.problem.evidence || [];
  return (
    <article className="opportunity-brief" aria-label="方向详情">
      <header className="opportunity-brief__head">
        {/* ⚠️ **一屏只有一颗实心黑，那颗是页脚的「带入选题」。**
            这里原来也是实心黑，于是同一屏上下各一块最重的颜色，读起来是两个「最该点的」。
            「方向详情」那个眉标也撤了：面包屑写着「情报 / 发现方向」，左边列表指着是哪一条，
            这四个字回答的问题没有人在问。 */}
        <div className="opportunity-brief__toolbar">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onDiscuss(connection)}>聊聊这个方向<IconArrowRight aria-hidden="true" /></button>
        </div>
        <h3 tabIndex={-1}>{connection.coreClaim}</h3>
        <p className="opportunity-brief__reason"><span className="opportunity-fit" data-fit={connection.fit}>{FIT_LABELS[connection.fit] || connection.fit}</span>{connection.fitReason}</p>
      </header>

      {/* 读者问题：问号自己会说话，底下那行才是它的身份说明 */}
      <p className="opportunity-brief__q">{connection.problem.statement}</p>
      <small className="opportunity-evidence" data-origin={connection.problem.origin}>{connection.problem.evidenceLabel}</small>

      <p className="opportunity-brief__body">{connection.knowledgeExplanation}</p>
      <p className="opportunity-brief__claim">{connection.cognitiveGap}</p>

      {anchors.length > 0 ? (
        <section className="opportunity-brief__section">
          <h4>与已有积累的连接</h4>
          <ul className="opportunity-sources">{anchors.map((anchor) => (
            <li key={anchor.wikiPageId}><button type="button" onClick={() => onGo("entries", anchor.wikiPageId)}>{anchor.title}<IconArrowRight aria-hidden="true" /></button>{anchor.reason ? <p>{anchor.reason}</p> : null}</li>
          ))}</ul>
        </section>
      ) : null}

      {connection.evidenceGaps?.length ? (
        <section className="opportunity-brief__section opportunity-brief__gaps">
          <h4>还需要验证</h4>
          <ul>{connection.evidenceGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>
        </section>
      ) : null}

      {basis.length + quotes.length > 0 ? (
        <details className="opportunity-basis">
          <summary>这个方向的依据 · {basis.length + quotes.length} 条</summary>
          <p className="opportunity-basis__note">以下是实际引用的资料；上面的解释和方向仍待讨论验证。</p>
          {basis.map((b, i) => <DirectionEvidence key={i} basis={b} onGo={onGo} />)}
          {quotes.map((e, i) => (
            <blockquote key={i}>{e.quote}<small>{e.kindLabel}{e.sourceName ? ` · ${e.sourceName}` : ""}{e.observedAt ? ` · ${dateLabel(e.observedAt)}` : ""}</small></blockquote>
          ))}
        </details>
      ) : null}

      {connection.agendaSuggestion?.reason ? <p className="opportunity-brief__agenda">{connection.agendaSuggestion.reason}</p> : null}
    </article>
  );
}

function DirectionDetail({item,onGo,onSaved}){
 const connection=item.connection;
 const [record,setRecord]=useState(item.saved||null),[chat,setChat]=useState(false),[prompt,setPrompt]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState(''),[merge,setMerge]=useState(false);
 const act=async mode=>{if(busy)return;setBusy(true);setError(null);try{
  const result=await api.keepIntelligenceDirection(connection.directionId||record?.id);setRecord(result.direction);onSaved(result.direction);
  if(mode==='chat'||mode==='research'){setPrompt(mode==='research'?{id:crypto.randomUUID(),text:'请围绕这个方向的证据缺口，先提出需要查证的问题与资料范围，和我确定后再采集。缺口：'+(connection.evidenceGaps||[]).join('；')}:null);setChat(true);}
  else if(mode==='merge')setMerge(true);else setNotice('方向已保存，仍是待讨论的候选。');
 }catch(e){setError(e);}finally{setBusy(false);}};
 return <><OpportunityBrief connection={connection} onDiscuss={()=>act('chat')} onGo={onGo} busy={busy}/><ErrorNote error={error} what="打开方向"/>{notice&&<p role="status">{notice}</p>}<div className="direction-actions"><button type="button" className="text-action" aria-pressed={Boolean(record)} disabled={busy} onClick={()=>act('save')}>{record?'已保存方向':'保存方向'}</button><button type="button" className="text-action" disabled={busy} onClick={()=>act('research')}>补充调研</button><button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={()=>act('merge')}>{record?.researchId?'打开选题':'带入选题'}</button></div>
 {chat&&record&&<section className="direction-chat"><header><h3>聊聊这个方向</h3><button className="btn btn-sm" onClick={()=>setChat(false)}>收起讨论</button></header><AssistantPane key={record.id} embedded scope="global" surface="page" scopeId={record.scopeId} promptRequest={prompt} initialConversationId={record.conversations?.[0]?.id||''} document={{title:connection.coreClaim,body:JSON.stringify(connection)}} materials={[]} target={{kind:'none',editable:false}} emptyMessage="从你的疑问开始，也可以请 AI 根据缺口补充调研。" draftStorageKey={record.scopeId}/></section>}
 {merge&&record&&<DirectionActions direction={record} onClose={()=>setMerge(false)} onGo={onGo}/>}</>;
}

export function ContentDiscovery({ onGo, onCaptureVoice, initialDirection="", renderLegacy }) {
  const [data, setData] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [error, setError] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [directions,setDirections]=useState([]),[reading,setReading]=useState(false);
  useEffect(()=>{if(initialDirection)api.intelligenceDirection(initialDirection).then(r=>{setDirections(old=>[r.direction,...old.filter(d=>d.id!==r.direction.id)]);setView('saved');}).catch(setError);},[initialDirection]);
  const [focus, setFocus] = useState(() => takeDiscoveryFocus());
  const [research, setResearch] = useState([]);
  const [researchOpen, setResearchOpen] = useState(false);
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
      setReading(false);
    } catch (failure) {
      setScanError(failure);
    } finally {
      setScanning(false);
    }
  }, [focus]);

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

  const filteredDirections=directions.filter(d=>`${d.connection.coreClaim} ${d.connection.problem.statement}`.toLowerCase().includes(savedQuery.toLowerCase()));
  const savedItems = opportunities.filter((item) => `${item.coreClaim} ${item.wikiTitle} ${item.audienceProblemStatement}`.toLowerCase().includes(savedQuery.toLowerCase()));

  const onSaved=d=>setDirections(old=>[d,...old.filter(v=>v.id!==d.id)]);
  const savedEntry=d=>({key:d.id,group:'saved',saved:d,connection:{...d.connection,directionId:d.id},title:d.connection.coreClaim,summary:d.connection.problem.statement,reason:d.connection.fitReason,status:d.researchId?'已带入选题':'已保存'});
  const browserItems=view==='saved'?[...filteredDirections.map(savedEntry),...savedItems.map(o=>({key:`legacy:${o.id}`,group:'saved',legacy:o,title:o.coreClaim||o.audienceProblemStatement,summary:o.audienceProblemStatement,reason:o.knowledgeExplanation|| (o.wikiTitle?`与已有知识「${o.wikiTitle}」连接`: '此前保存的方向简报'),status:o.hasProject?'已进入创作':'已保存'}))]:connections.map((c,i)=>{const saved=directions.find(d=>d.id===c.directionId);return {key:c.directionId||`candidate:${i}`,group:'discover',connection:c,saved,title:c.coreClaim,summary:c.problem.statement,reason:c.fitReason,status:saved?.researchId?'已带入选题':saved?'已保存':'待讨论'};});
  return (
    <div className={`view-body content-bridge content-discovery opportunity-home ${reading?"direction-reading-mode":""}`}>
      {/**
        * ⚠️ **这一页不再自我介绍。** 页名在外壳页头（`情报 / 发现方向`）已经写过一次，
        * 页内那个 `✧ 发现方向` 是第二次；而 `← 今日精选` 在它升成侧栏一项之后
        * 也不再是「返回」——它是横着跳到一个平级的去处，那归侧栏。
        * 读方向时动作条本来就是隐藏的，所以 `reading` 时不传 `aside`。
        */}
      {/* ⚠️ **胶囊走 `ui.jsx` 那一份，别再画第四种页签。** 这里原来是下划线式的一排，
          而找题 / 选题 / 复盘 / 数据 / 热点 五个页面用的是同一颗胶囊——同一个问题
         （「这一页现在看哪一档」）在这个工作台里只该有一种长相。
          第一档改叫「新发现」：叫「发现方向」和页名同名，选中时读起来像面包屑不像筛选。 */}
      <FilterHeader
        title="发现方向"
        chips={
          <ViewTabs
            label="方向视图"
            value={view}
            onChange={setView}
            items={[
              { key: "discover", label: "新发现", count: connections.length },
              { key: "saved", label: "已保存", count: opportunities.length + directions.length },
              { key: "research", label: "研究线索", count: research.length },
            ]}
          />
        }
        action={reading ? null : (
          <>
            <button type="button" className="btn btn-sm" onClick={() => onCaptureVoice?.("")}><IconMessageQuestion aria-hidden="true" />收集声音</button>
            <button type="button" className="btn btn-sm" onClick={() => onGo("bridge", "manual")}>手动探索<IconArrowRight aria-hidden="true" /></button>
          </>
        )}
      />
      <ErrorNote error={error} what="读取方向" onRetry={load} />
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
      {scan_ && !scanning && !connections.length ? <section className="opportunity-welcome"><h3>这次还没有值得展开的新方向</h3><p>{scan_.nothingFoundReason || "暂时没有足够依据形成自然的新方向。"}</p><div className="row-actions"><button type="button" className="btn" onClick={() => onCaptureVoice?.("", "find")}>去找找有没有人在说</button><button type="button" className="btn" onClick={() => onGo("entries")}>补充我的知识</button></div></section> : null}
      </div>
      <section hidden={view !== "saved"} id="opportunity-saved" tabIndex={-1} className="discovery-saved opportunity-saved" aria-label="进行中的内容机会">
        <header className="opportunity-section-heading"><div><h3>已保存的方向</h3><p>候选方向与此前保存的简报，需要时继续讨论</p></div>{opportunities.length+directions.length ? <SearchBox value={savedQuery} onChange={setSavedQuery} placeholder="搜索已保存的机会" ariaLabel="搜索已保存的机会" /> : null}</header>
        <ErrorNote error={savedError} what="读取已保存机会" onRetry={load} />
        {!browserItems.length&&!savedError&&!loading&&<p className="opportunity-saved-empty">{savedQuery?'没有找到匹配的机会，试试其他关键词。':'还没有保存的方向。'}</p>}
      </section>
      <div hidden={view==='research'}><DirectionBrowser items={browserItems} initialKey={initialDirection} onReadingChange={setReading} renderDetail={item=>item.legacy?renderLegacy?.(item.legacy.id):<DirectionDetail item={item} onGo={onGo} onSaved={onSaved}/>}/></div>
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
