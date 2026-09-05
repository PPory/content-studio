/** 比较候选讲法，完善创作简报，并经用户确认保存为内容机会。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Note } from "../components/ui.jsx";
import { peekConstructionSession, peekDiscoveryHandoff, setConstructionSession } from "../lib/discovery-handoff.js";
import { IconArrowRight, IconSparkles } from "../components/icons.jsx";
import "./content-bridge.css";
import "./content-construction.css";

const ACTION_LABELS = {
  knowledge: "知识型",
  judgment: "判断型",
  experience: "经历型",
  demonstration: "展示型",
};

const ELEMENT_LABELS = {
  concept: "概念", fact: "事实", case: "案例", experience: "经历", judgment: "判断",
  problem: "问题", evidence: "证据", method: "方法", analogy: "类比", conflict: "冲突", observation: "观察",
};

const SOURCE_LABELS = {
  wiki_page: "Wiki", material: "素材", knowledge_item: "卡片", content_opportunity: "旧内容",
  audience_problem: "用户问题", raw: "来源原文",
};

/** 候选只呈现选择依据；选定后展开为可用于创作的简报。 */
function RouteCard({ route, selected = false, onSelect, compact = false, number, titleRef, disabled = false }) {
  const elements = route.supportingElements || [];
  const sourceCount = new Set(elements.filter((item) => item.sourceId).map((item) => `${item.sourceKind}:${item.sourceId}`)).size;
  return (
    <article className="route-card" data-selected={selected ? "true" : undefined} data-compact={compact ? "true" : undefined}>
      <header>
        <div className="route-card__meta"><span className="route-card__id">{selected ? "创作简报" : `讲法 ${number || route.id}`}</span><span className="route-card__action">{ACTION_LABELS[route.dominantAction] || route.dominantAction}</span></div>
        <h3 ref={titleRef} tabIndex={selected ? -1 : undefined}>{route.label}</h3>
      </header>
      <div className="route-field"><span>从这里开篇</span><p>{route.entry}</p></div>
      <div className="route-field route-field--claim"><span>让读者带走的判断</span><p>{route.coreClaim}</p></div>
      {selected ? <>
        <div className="route-field"><span>文章怎样展开</span><p>{route.storyline}</p></div>
        {route.keyRelation ? <div className="route-field"><span>为什么这样讲</span><p>{route.keyRelation}</p></div> : null}
      </> : null}
      {route.risk ? <div className="route-field route-field--risk"><span>需要留意</span><p>{route.risk}</p></div> : null}
      {route.evidenceGaps?.length ? <div className="route-field route-field--gaps"><span>还需要补充</span><ul className="route-gaps">{route.evidenceGaps.map((gap, index) => <li key={`${gap}:${index}`}>{gap}</li>)}</ul></div> : null}
      {selected ? <section className="route-sources" aria-label="材料与来源">
        <div className="route-sources__heading"><h4>材料与来源</h4><span>{sourceCount} 个关联来源</span></div>
        {elements.length ? <ul className="route-elements">{elements.map((element) => <li key={element.id}>
          <em>{ELEMENT_LABELS[element.type] || element.type}</em>
          <div><strong>{element.label}</strong>{element.role ? <p>{element.role}</p> : null}<small>{element.sourceId ? `来源：${SOURCE_LABELS[element.sourceKind] || element.sourceKind}` : "AI 组织的表达，不是来源证据"}</small></div>
        </li>)}</ul> : <p className="construction-note">还没有可引用的材料，需要在写作前补充依据。</p>}
      </section> : null}
      {onSelect ? <footer><span>{sourceCount} 个关联来源</span><button type="button" className="btn btn-sm" disabled={disabled} onClick={onSelect}>沿这个继续<IconArrowRight aria-hidden="true" /></button></footer> : null}
    </article>
  );
}
export function ContentConstruction({ onGo }) {
  /**
   * ⚠️ 用 `peek` 不用 `take`：这一页会因为状态更新重渲染好几次，
   * 取完即清的话第二次渲染就找不到连接了。真正消费掉它的是「查看完整分析」那次跳转。
   */
  const [connection] = useState(() => peekDiscoveryHandoff());
  /**
   * ⚠️ **进来先接住上一次没做完的工作。**
   * 去看一眼完整分析再回来，选好的讲法和推过的两轮都还在——
   * 它们还没保存，丢了就真的没了。
   */
  const restored = useMemo(() => peekConstructionSession(), []);
  const [routes, setRoutes] = useState(() => restored?.routes || []);
  const [note, setNote] = useState(() => restored?.note || "");
  const [droppedAsSame, setDroppedAsSame] = useState(() => restored?.droppedAsSame || 0);
  /** 不合格被丢掉的那些，以及为什么。一条都没剩时界面靠它说人话。 */
  const [dropped, setDropped] = useState(() => restored?.dropped || []);
  const [experienceAvailable, setExperienceAvailable] = useState(() => restored?.experienceAvailable !== false);
  const [selectedId, setSelectedId] = useState(() => restored?.selectedId || "");
  const [freshness, setFreshness] = useState(() => restored?.freshness || null);
  const [agendas, setAgendas] = useState([]);
  /**
   * ⚠️ **议程读回来之前不能开跑。**
   * 不等的话，第一次提路线用的是「不关联议程」，而下拉框随后默认选中了最近那条——
   * 于是保存时带着一个 freshness 里没有的议程，当场 409「请重新预览」，
   * 而用户什么都没改过。真实跑第一轮就是这么失败的。
   */
  const [agendasReady, setAgendasReady] = useState(false);
  const [agendaId, setAgendaId] = useState(() => restored?.agendaId || "");
  const [routesAgendaId, setRoutesAgendaId] = useState(() => restored?.routesAgendaId || "");
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState(null);
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState(() => restored?.history || []);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saved, setSaved] = useState(() => restored?.saved || null);
  const [showOthers, setShowOthers] = useState(false);
  const askRef = useRef(null);
  const briefHeadingRef = useRef(null);
  const focusBriefOnSelection = useRef(false);

  useEffect(() => {
    if (!selectedId || !focusBriefOnSelection.current) return;
    focusBriefOnSelection.current = false;
    briefHeadingRef.current?.closest(".construction-current")?.scrollIntoView({ block: "start", behavior: "instant" });
    briefHeadingRef.current?.focus({ preventScroll: true });
  }, [selectedId]);

  const selected = useMemo(() => routes.find((route) => route.id === selectedId) || null, [routes, selectedId]);
  const others = useMemo(() => routes.filter((route) => route.id !== selectedId), [routes, selectedId]);

  useEffect(() => {
    api.agendas().then((result) => {
      setAgendas(result.agendas || []);
      // 恢复出来的会话已经有它自己的议程选择，别用「最近那条」把它盖掉。
      if (!restored) setAgendaId((result.agendas || [])[0]?.id || "");
    }).catch(() => setAgendas([])).finally(() => setAgendasReady(true));
  }, [restored]);

  const propose = useCallback(async (currentAgendaId) => {
    if (!connection) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.constructionRoutes({ connection, agendaId: currentAgendaId || undefined });
      setRoutes(result.routes || []);
      setNote(result.note || "");
      setDroppedAsSame(result.droppedAsSame || 0);
      setDropped(result.dropped || []);
      setExperienceAvailable(result.experienceAvailable !== false);
      setFreshness(result.freshness || null);
      // 记下这批路线是按哪条议程跑的：保存时以它为准，和 freshness 保持一致。
      setRoutesAgendaId(currentAgendaId || "");
      setSelectedId("");
      setHistory([]);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }, [connection]);

  // 议程是可选的透镜：进来先按最近那条跑，换议程要用户自己点。
  useEffect(() => {
    if (!connection || !agendasReady || routes.length || busy || error) return;
    propose(agendaId);
  }, [connection, agendasReady, agendaId]);

  const refine = useCallback(async () => {
    const ask = instruction.trim();
    if (!ask || !selected || refining || saveBusy) return;
    setRefining(true);
    setError(null);
    try {
      const result = await api.refineConstructionRoute({ connection, route: selected, instruction: ask, agendaId: routesAgendaId || undefined });
      setRoutes((items) => items.map((route) => (route.id === result.route.id ? result.route : route)));
      setFreshness(result.freshness || freshness);
      setHistory((items) => [...items, { ask, note: result.note }]);
      setInstruction("");
    } catch (failure) {
      setError(failure);
    } finally {
      setRefining(false);
      askRef.current?.focus();
    }
  }, [instruction, selected, refining, saveBusy, connection, routesAgendaId, freshness]);

  const save = useCallback(async () => {
    if (!selected || !connection || saveBusy || refining) return;
    setSaveBusy(true);
    setError(null);
    try {
      const anchor = connection.knowledgeAnchors[0];
      const result = await api.saveContentOpportunity({
        wikiPageId: anchor.wikiPageId,
        audienceProblemId: connection.problem.existingProblemId || undefined,
        problemCandidate: connection.problem.existingProblemId ? undefined : {
          statement: connection.problem.statement,
          summary: connection.problem.whyItMatters,
          origin: connection.problem.origin,
          originAgendaId: connection.problem.originAgendaId,
          evidence: connection.problem.evidence,
        },
        // ⚠️ 用提路线时那条议程，不是下拉框此刻的值：freshness 记的是前者。
        agendaId: routesAgendaId || undefined,
        coreClaim: selected.coreClaim,
        knowledgeExplanation: selected.knowledgeExplanation,
        cognitiveGap: selected.cognitiveGap,
        dominantAction: selected.dominantAction,
        fit: connection.fit,
        fitReason: connection.fitReason,
        construction: selected.construction,
        freshness,
        confirmed: true,
      });
      setSaved(result.opportunity);
    } catch (failure) {
      setError(failure);
    } finally {
      setSaveBusy(false);
    }
  }, [selected, connection, routesAgendaId, freshness, saveBusy, refining]);

  /**
   * 把当前状态写回会话。⚠️ 每次变化都写，而不是离开时写——
   * React 里「离开时」这件事没有一个可靠的时机，而这份东西丢了就是丢了。
   */
  useEffect(() => {
    if (!connection) return;
    setConstructionSession({ routes, note, droppedAsSame, dropped, experienceAvailable, selectedId, freshness, history, agendaId, routesAgendaId, saved });
  }, [connection, routes, note, droppedAsSame, dropped, experienceAvailable, selectedId, freshness, history, agendaId, routesAgendaId, saved]);

  if (!connection) {
    return <div className="view-body content-bridge content-construction">
      <button type="button" className="bridge-back" disabled={refining || saveBusy} onClick={() => onGo?.("bridge", "")}>← 内容机会</button>
      <Note title="从一个内容方向开始">这份未保存的简报已不在当前会话中。回到内容机会，选择一个方向继续。</Note>
      <button type="button" className="btn btn-primary" onClick={() => onGo?.("bridge", "")}>寻找内容方向</button>
    </div>;
  }

  const hypothesis = connection.problem.origin === "hypothesis";
  const chooseRoute = (id) => { if (refining || saveBusy) return; focusBriefOnSelection.current = true; setSelectedId(id); setShowOthers(false); setInstruction(""); };

  return (
    <div className="view-body content-bridge content-construction">
      <nav className="construction-nav" aria-label="当前位置">
        <button type="button" className="bridge-back" disabled={refining || saveBusy} onClick={() => onGo?.("bridge", "")}>← 内容机会</button>
        <span>{selected ? "完善创作简报" : "选择讲法"}</span>
        <button type="button" className="btn btn-sm" disabled={refining || saveBusy} onClick={() => onGo?.("bridge", "analyze")}>查看完整分析</button>
      </nav>

      <header className="construction-heading">
        {saved ? <div className="construction-heading__eyebrow">已保存到内容机会</div> : null}
        <h1>{selected ? "创作简报" : "比较讲法"}</h1>
        <p>{selected ? "确认核心判断与依据，保存后进入创作。" : "从切入点、核心判断和依据中，选定一个创作方向。"}</p>
      </header>

      <section className="construction-intent" aria-label="创作意图">
        <div className="construction-intent__question"><span>{hypothesis ? "待验证的读者困惑" : "要回应的读者问题"}</span><strong>{connection.problem.statement}</strong><small data-origin={connection.problem.origin}>{connection.problem.evidenceLabel}</small></div>
        <div className="construction-intent__knowledge"><span>从你的知识出发</span><strong>{connection.knowledgeAnchors[0]?.title}</strong><p>{connection.fitReason}</p></div>
        {agendas.length ? <div className="construction-intent__agenda"><label htmlFor="construction-agenda">关联长期议程</label><select id="construction-agenda" value={agendaId} disabled={busy || refining || saveBusy || Boolean(saved)} onChange={(event) => { setAgendaId(event.target.value); setRoutes([]); setError(null); setSelectedId(""); }}><option value="">不关联议程</option>{agendas.map((agenda) => <option key={agenda.id} value={agenda.id}>{agenda.title}</option>)}</select></div> : null}
      </section>

      <ErrorNote error={error} what="创作简报" onRetry={routes.length ? undefined : () => propose(agendaId)} />
      {busy || !agendasReady ? <div className="construction-loading" role="status"><IconSparkles aria-hidden="true" /><h3>正在寻找不同的讲法</h3><p>结合这个问题和工作区里的材料，整理可以比较的候选。</p></div> : null}

      {!busy && routes.length ? <>
        {!selected ? <section className="construction-routes" aria-label="可选的讲法">
          <header className="construction-routes__head"><div><h2>候选讲法</h2><p>{routes.length} 种讲法 · 选定后展开完整简报{droppedAsSame ? ` · ${droppedAsSame} 条和上面重复，已合并` : ""}</p></div></header>
          <div className="construction-routes__list">{routes.map((route, index) => <RouteCard key={route.id} route={route} number={String(index + 1).padStart(2, "0")} onSelect={() => chooseRoute(route.id)} />)}</div>
          {note ? <p className="construction-note construction-note--after">{note}</p> : null}
          {!experienceAvailable ? <p className="construction-note construction-note--gate">尚无可用的个人经历素材，本次只提供其他讲法。要以自己的经历开篇，请先补充真实的个人经历。</p> : null}
        </section> : <section className="construction-current" aria-label="正在推的讲法">
          <div className="construction-document">
            <RouteCard route={selected} selected titleRef={briefHeadingRef} />
            {others.length && !saved ? <div className="construction-others"><button type="button" aria-expanded={showOthers} disabled={refining || saveBusy} onClick={() => setShowOthers((value) => !value)}>{showOthers ? "收起另外的讲法" : `另外 ${others.length} 种讲法`}</button>{showOthers ? <div className="construction-others__list">{others.map((route) => <RouteCard key={route.id} route={route} compact disabled={refining || saveBusy} onSelect={() => chooseRoute(route.id)} />)}</div> : null}</div> : null}
          </div>
          <aside className="construction-workspace" aria-label="修改与保存简报">
            {saved ? <div className="construction-saved" role="status"><span>已保存</span><h2>这个方向，已经留下来了。</h2><p>简报、材料和来源已一起保存。接下来可以建立内容项目开始写作。</p><button type="button" className="btn btn-primary" onClick={() => onGo?.("bridge", `opportunity:${saved.id}`)}>打开这条内容机会<IconArrowRight aria-hidden="true" /></button></div> : <>
              <div className="construction-ask"><div className="construction-ask__heading"><IconSparkles aria-hidden="true" /><label htmlFor="construction-ask">跟 Xenho 说</label></div><p>哪里还不像你想写的？</p>
                <textarea id="construction-ask" ref={askRef} rows={5} value={instruction} disabled={refining || saveBusy} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); refine(); } }} placeholder="例如：结论太绝对了，保留判断，但说清它适用的范围。" />
                <div className="construction-ask__prompts" aria-label="常见修改方向">{["收窄结论", "补充案例", "调整开篇"].map((label, index) => <button type="button" key={label} disabled={refining || saveBusy} onClick={() => { setInstruction(["结论太绝对了，请收窄判断并说明适用范围。", "请寻找工作区中有真实来源的案例，增强这条讲法的依据。", "请从读者遇到的具体场景开篇，再引出核心判断。"][index]); askRef.current?.focus(); }}>{label}</button>)}</div>
                <div className="construction-ask__actions"><small>Ctrl / ⌘ + Enter</small><button type="button" className="btn btn-sm" disabled={!instruction.trim() || refining || saveBusy} onClick={refine}>{refining ? "正在改…" : "继续推"}<IconArrowRight aria-hidden="true" /></button></div>
                {refining ? <p className="construction-note" role="status">正在更新简报，请稍候。</p> : null}
              </div>
              {history.length ? <details className="construction-revisions" open><summary>已调整 {history.length} 次</summary><ol className="construction-history" aria-label="这条讲法被怎么调整过">{history.map((item, index) => <li key={`${item.ask}:${index}`}><q>{item.ask}</q>{item.note ? <span>{item.note}</span> : null}</li>)}</ol></details> : null}
              <div className="construction-save"><h3>保存简报</h3><p>保存这份简报和关联材料，作为接下来创作的起点。</p><button type="button" className="btn btn-primary" disabled={saveBusy || refining} onClick={save}>{saveBusy ? "正在保存…" : "保存为内容机会"}<IconArrowRight aria-hidden="true" /></button><button type="button" className="construction-change" disabled={refining || saveBusy} onClick={() => setSelectedId("")}>返回比较，换一条讲法</button></div>
            </>}
          </aside>
        </section>}
      </> : null}

      {agendasReady && !busy && !routes.length && !error ? <div className="bridge-blank"><h3>还需要一些材料，才能讲得扎实</h3>{dropped.length ? <ul className="construction-dropped">{dropped.map((item, index) => <li key={`${item.id}:${index}`}>{item.reason}</li>)}</ul> : <p>现有材料还不足以形成讲法。可以换一个长期议程，或查看完整分析里的证据缺口。</p>}<button type="button" className="btn btn-primary" onClick={() => propose(agendaId)}><IconSparkles aria-hidden="true" />再试一次</button></div> : null}
    </div>
  );
}