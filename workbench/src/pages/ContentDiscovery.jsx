import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, SearchBox, relTime } from "../components/ui.jsx";
import { setDiscoveryHandoff, takeDiscoveryFocus } from "../lib/discovery-handoff.js";
import { IconSparkles, IconArrowRight, IconMessageQuestion, IconRefresh } from "../components/icons.jsx";
import "./content-bridge.css";
import "./content-discovery.css";

const FIT_LABELS = { strong: "很自然", medium: "值得继续", weak: "比较牵强" };
function dateLabel(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date) : "";
}

function OpportunityBrief({ connection, onDevelop, onGo, busy, onBack, mobileDetail }) {
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
        <div className="opportunity-brief__toolbar"><span>方向详情</span><button className="opportunity-mobile-back" type="button" onClick={onBack}>← 返回方向列表</button><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDevelop(connection)}>发展这条<IconArrowRight aria-hidden="true" /></button></div>
        <h3 ref={headingRef} tabIndex={-1}>{connection.coreClaim}</h3>
        <p className="opportunity-brief__reason"><span className="opportunity-fit" data-fit={connection.fit}>{FIT_LABELS[connection.fit] || connection.fit}</span>{connection.fitReason}</p>
      </header>

      <section className="opportunity-brief__section">
        <h4>为谁解决什么问题</h4>
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
        <h4>你有什么独特的解释</h4>
        <p>{connection.knowledgeExplanation}</p>
        <ul className="opportunity-sources">{anchors.map((anchor) => (
          <li key={anchor.wikiPageId}><button type="button" onClick={() => onGo("entries", anchor.wikiPageId)}>{anchor.title}<IconArrowRight aria-hidden="true" /></button>{anchor.reason ? <p>{anchor.reason}</p> : null}</li>
        ))}</ul>
      </section>
      <section className="opportunity-brief__section"><h4>读者能带走什么新认识</h4><p>{connection.cognitiveGap}</p></section>
      {connection.evidenceGaps?.length ? <section className="opportunity-brief__section opportunity-brief__gaps"><h4>动笔前还需要补充</h4><ul>{connection.evidenceGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></section> : null}
      {connection.agendaSuggestion?.reason ? <p className="opportunity-brief__agenda">{connection.agendaSuggestion.reason}</p> : null}

    </article>
  );
}

export function ContentDiscovery({ onGo, onCaptureVoice }) {
  const [data, setData] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [error, setError] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
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
      setOpenConnection(0);
      setMobileDetail(false);
    } catch (failure) {
      setScanError(failure);
    } finally {
      setScanning(false);
    }
  }, [focus]);

  const develop = useCallback((connection) => {
    // ⚠️ 这里**什么都不写库**。候选一路带到「保存为内容机会」那一刻。
    setDiscoveryHandoff(connection);
    onGo("bridge", "develop");
  }, [onGo]);

  const scan_ = data?.scan || null;
  const connections = scan_?.connections || [];
  const read = scan_?.read || null;
  const stale = Boolean(data?.stale);
  const neverScanned = !scan_;

  const summary = useMemo(() => {
    if (!read) return "";
    const parts = [`${read.wikiPages} 条知识`];
    if (read.voices) parts.push(`${read.voices} 段原话`);
    if (read.problems) parts.push(`${read.problems} 条已确认问题`);
    return parts.join(" · ");
  }, [read]);

  const activeConnection = connections[openConnection] || connections[0];
  const savedItems = opportunities.filter((item) => `${item.coreClaim} ${item.wikiTitle} ${item.audienceProblemStatement}`.toLowerCase().includes(savedQuery.toLowerCase()));

  return (
    <div className="view-body content-bridge content-discovery opportunity-home">
      <header className="opportunity-header">
        <div className="opportunity-header__identity"><IconSparkles aria-hidden="true" /><h2>内容机会</h2></div>
        <div className="opportunity-header__actions"><button type="button" className="btn btn-sm" onClick={() => onCaptureVoice?.("")}><IconMessageQuestion aria-hidden="true" />收集声音</button><button type="button" className="btn btn-sm" onClick={() => onGo("bridge", "manual")}>手动探索<IconArrowRight aria-hidden="true" /></button></div>
      </header>
      <nav className="opportunity-views" aria-label="内容机会视图">
        {[['discover', '发现方向', connections.length], ['saved', '已保存', opportunities.length], ['research', '研究线索', research.length]].map(([id, label, count]) => <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>{label}<span>{count}</span></button>)}
      </nav>
      <ErrorNote error={error} what="读取内容机会" onRetry={load} />
      {loading && !data ? <Loading rows={3} /> : null}
      <div hidden={view !== "discover"} className="opportunity-discover-view">
      <div className="opportunity-scan">
        <form onSubmit={(event) => { event.preventDefault(); if (!scanning) scan({ force: true }); }}>
          <IconSparkles aria-hidden="true" />
          <label className="sr-only" htmlFor="opportunity-focus">这次想关注的方向</label>
          <input id="opportunity-focus" value={focus} maxLength={500} onChange={(event) => setFocus(event.target.value)} disabled={scanning} placeholder="输入关注方向，或留空探索最近的积累" />
          <button type="submit" className={`btn${connections.length ? "" : " btn-primary"}`} disabled={scanning || loading || !data}>{scanning ? "正在寻找…" : scan_ ? "重新扫描" : "发现新方向"}</button>
        </form>
        <div className="opportunity-scan__meta"><span>{scan_ ? `${relTime(scan_.scannedAt)}扫描${summary ? ` · 读了 ${summary}` : ""}` : "使用你的知识和真实用户声音，生成待你判断的候选。"}</span></div>
        {stale && data?.staleReason ? <p className="opportunity-update">{data.staleReason}</p> : null}
      </div>
      {scanError ? <div className="discovery-failed"><ErrorNote error={scanError} what="寻找新方向" onRetry={() => scan({ force: true })} /><p>已有机会没有被改动。你可以继续看上次的结果，或手动探索。</p></div> : null}
      {scanning ? <div className="opportunity-pending" role="status"><IconRefresh aria-hidden="true" /><div><strong>正在把你的积累和读者的问题放在一起看</strong><p>找出值得讲的判断，并核对它的来源。你可以继续浏览已有机会。</p></div></div> : null}
      {data && neverScanned && !scanning ? <section className="opportunity-welcome"><span className="opportunity-eyebrow">第一篇，从你的积累里开始</span><h3>不必对着空白页想选题。</h3><p>让知识回答一个真实的问题，把你的理解变成一篇有价值的内容。</p><ol><li><b>找方向</b><span>从知识和用户声音中发现连接</span></li><li><b>挑讲法</b><span>比较切入点、判断和依据</span></li><li><b>开始写</b><span>确认简报，带着材料进入创作</span></li></ol></section> : null}
      {activeConnection ? (
        <section className="opportunity-workspace" aria-label="值得发展的连接" data-mobile-detail={mobileDetail}>
          <div className="opportunity-index">
            <div className="opportunity-section-heading"><h3>发现的方向</h3><span>{connections.length} 条候选</span></div>
            <div className="opportunity-options">{connections.map((connection, index) => (
              <button type="button" className="opportunity-option" key={`${connection.problem.statement}:${index}`} aria-pressed={activeConnection === connection} onClick={() => { setOpenConnection(index); setMobileDetail(true); }}>
                <span className="opportunity-option__number" aria-hidden="true">◇</span><strong>{connection.coreClaim}</strong><p>{connection.problem.statement}</p><small>{connection.problem.origin === "hypothesis" ? "受众假设 · 待验证" : "有真实用户声音"} · {connection.knowledgeAnchors?.length || 0} 条知识</small><span className="opportunity-option__read">查看方向<IconArrowRight aria-hidden="true" /></span>
              </button>
            ))}</div>

          </div>
          <OpportunityBrief key={openConnection} connection={activeConnection} onDevelop={develop} onGo={onGo} busy={scanning} mobileDetail={mobileDetail} onBack={() => { setMobileDetail(false); requestAnimationFrame(() => document.querySelector(".opportunity-option[aria-pressed=true]")?.focus()); }} />
        </section>
      ) : null}
      {scan_ && !scanning && !connections.length ? <section className="opportunity-welcome"><h3>这次还没有值得展开的新方向</h3><p>{scan_.nothingFoundReason || "暂时没有足够的知识或真实声音支撑新的内容。"}</p><div className="row-actions"><button type="button" className="btn" onClick={() => onCaptureVoice?.("", "find")}>去找找有没有人在说</button><button type="button" className="btn" onClick={() => onGo("entries")}>补充我的知识</button></div></section> : null}
      </div>
      <section hidden={view !== "saved"} id="opportunity-saved" tabIndex={-1} className="discovery-saved opportunity-saved" aria-label="进行中的内容机会">
        <header className="opportunity-section-heading"><div><h3>已保存的机会</h3><p>已确认的创作方向与简报</p></div>{opportunities.length ? <SearchBox value={savedQuery} onChange={setSavedQuery} placeholder="搜索已保存的机会" ariaLabel="搜索已保存的机会" /> : null}</header>
        <ErrorNote error={savedError} what="读取已保存机会" onRetry={load} />
        {savedItems.length ? <ul className="opportunity-saved-list">{savedItems.map((item) => <li key={item.id}><button type="button" onClick={() => onGo("bridge", `opportunity:${item.id}`)} aria-label={`打开内容机会：${item.wikiTitle} × ${item.audienceProblemStatement}`}><div><strong>{item.coreClaim || item.audienceProblemStatement}</strong><p>{item.wikiTitle || "知识已移除"}<span> · </span>{item.audienceProblemStatement}</p></div><span className="opportunity-saved-list__status">{item.hasProject ? "已进入创作" : "待开始写作"}<small>{dateLabel(item.updatedAt)}更新</small></span><IconArrowRight aria-hidden="true" /></button></li>)}</ul> : !savedError && !loading ? <p className="opportunity-saved-empty">{savedQuery ? "没有找到匹配的机会，试试其他关键词。" : "还没有保存的机会。选一个方向，打磨讲法后，它会留在这里。"}</p> : null}
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
