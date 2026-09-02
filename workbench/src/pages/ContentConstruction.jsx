/**
 * 内容构造工作台：和 Xenho 一起把一条连接讲成一篇内容。
 *
 * ⚠️ **这一页替代的是「AI 一次生成答案、用户阅读答案」。**
 * 上一版点「发展这条」直接进 01/02/03/04 那份完整分析——那份分析是对的，
 * 但它只有一个答案，而写作真正的选择恰恰发生在「这件事可以怎么讲」这一层。
 * 完整分析没有删，退成了「查看完整分析」。
 *
 * ⚠️ **没有关系图，没有白板。** 结构是三段：创作意图（顶）、当前讲法（中）、
 * 跟 Xenho 说（底）。选定一条之后其他两条退到次级区域——
 * 让三个完整方案长期并排，读的人每次都要重新比较一遍。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, Note } from "../components/ui.jsx";
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

/** 一条讲法的卡片。选择前是并排的候选，选择后是当前正在推的那一条。 */
function RouteCard({ route, selected, onSelect, compact = false }) {
  return (
    <article className="route-card" data-selected={selected ? "true" : undefined} data-compact={compact ? "true" : undefined}>
      <header>
        <span className="route-card__id">{route.id}</span>
        <h3>{route.label}</h3>
        <span className="route-card__action">{ACTION_LABELS[route.dominantAction] || route.dominantAction}</span>
      </header>

      {compact ? null : (
        <>
          <div className="route-field">
            <span>从哪进入</span>
            <p>{route.entry}</p>
          </div>
          <div className="route-field">
            <span>怎么推进</span>
            <p>{route.storyline}</p>
          </div>
          <div className="route-field route-field--claim">
            <span>最后留下什么判断</span>
            <p>{route.coreClaim}</p>
          </div>

          {/* 用了哪些东西 —— 每一条都带着它的真实出处，点不开也看得出是哪来的。 */}
          <div className="route-field">
            <span>用到的材料（{route.supportingElements.length}）</span>
            <ul className="route-elements">
              {route.supportingElements.map((element) => (
                <li key={element.id}>
                  <em>{ELEMENT_LABELS[element.type] || element.type}</em>
                  <strong>{element.label}</strong>
                  {element.role ? <span>{element.role}</span> : null}
                  <small>{element.sourceId ? (SOURCE_LABELS[element.sourceKind] || element.sourceKind) : "由这条讲法自己组织"}</small>
                </li>
              ))}
            </ul>
          </div>

          {route.keyRelation ? (
            <div className="route-field">
              <span>为什么这样组织</span>
              <p>{route.keyRelation}</p>
            </div>
          ) : null}

          {/*
            ⚠️ 风险和证据缺口是**默认展开**的，不折叠。
            这两样正是「选哪条」真正要比较的东西；折起来的话，三条讲法读上去
            就只剩三个漂亮的入口。
          */}
          {route.risk ? (
            <div className="route-field route-field--risk">
              <span>这条最容易出的问题</span>
              <p>{route.risk}</p>
            </div>
          ) : null}
          {route.evidenceGaps?.length ? (
            <div className="route-field">
              <span>还缺什么</span>
              <ul className="route-gaps">{route.evidenceGaps.map((gap, index) => <li key={`${gap}:${index}`}>{gap}</li>)}</ul>
            </div>
          ) : null}
        </>
      )}

      {onSelect ? (
        <footer>
          <button type="button" className={`btn btn-sm${selected ? "" : " btn-primary"}`} onClick={onSelect}>
            {selected ? "正在推这条" : "沿这个继续"}
            {selected ? null : <IconArrowRight aria-hidden="true" />}
          </button>
        </footer>
      ) : null}
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
  const [agendaId, setAgendaId] = useState(() => restored?.agendaId || "");
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState(null);
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState(() => restored?.history || []);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [showOthers, setShowOthers] = useState(false);
  const askRef = useRef(null);

  const selected = useMemo(() => routes.find((route) => route.id === selectedId) || null, [routes, selectedId]);
  const others = useMemo(() => routes.filter((route) => route.id !== selectedId), [routes, selectedId]);

  useEffect(() => {
    api.agendas().then((result) => {
      setAgendas(result.agendas || []);
      // 恢复出来的会话已经有它自己的议程选择，别用「最近那条」把它盖掉。
      if (!restored) setAgendaId((result.agendas || [])[0]?.id || "");
    }).catch(() => setAgendas([]));
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
      setSelectedId("");
      setHistory([]);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }, [connection]);

  // 议程是可选的透镜：进来先按最近那条跑，换议程要用户自己点。
  useEffect(() => { if (connection && agendas.length >= 0 && !routes.length && !busy && !error) propose(agendaId); }, [connection, agendaId]);

  const refine = useCallback(async () => {
    const ask = instruction.trim();
    if (!ask || !selected || refining) return;
    setRefining(true);
    setError(null);
    try {
      const result = await api.refineConstructionRoute({ connection, route: selected, instruction: ask, agendaId: agendaId || undefined });
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
  }, [instruction, selected, refining, connection, agendaId, freshness]);

  const save = useCallback(async () => {
    if (!selected || !connection || saveBusy) return;
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
        agendaId: agendaId || undefined,
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
  }, [selected, connection, agendaId, freshness, saveBusy]);

  /**
   * 把当前状态写回会话。⚠️ 每次变化都写，而不是离开时写——
   * React 里「离开时」这件事没有一个可靠的时机，而这份东西丢了就是丢了。
   */
  useEffect(() => {
    if (!connection) return;
    setConstructionSession({ routes, note, droppedAsSame, dropped, experienceAvailable, selectedId, freshness, history, agendaId });
  }, [connection, routes, note, droppedAsSame, dropped, experienceAvailable, selectedId, freshness, history, agendaId]);

  if (!connection) {
    return (
      <div className="view-body content-bridge content-construction">
        <div className="bridge-bar">
          <button type="button" className="bridge-back" onClick={() => onGo?.("bridge", "")}>← 内容</button>
        </div>
        <Note title="这条连接已经不在手边了">
          构造中的讲法只活在这一次操作里，刷新之后就没了——它还没有被保存，所以也没有留下任何东西。
          回内容首页重新挑一条继续。
        </Note>
      </div>
    );
  }

  const hypothesis = connection.problem.origin === "hypothesis";

  return (
    <div className="view-body content-bridge content-construction">
      <div className="bridge-bar bridge-bar--sticky">
        <button type="button" className="bridge-back" onClick={() => onGo?.("bridge", "")}>← 内容</button>
        <div className="bridge-bar__title">
          <h2><span>{connection.knowledgeAnchors[0]?.title}</span><em aria-hidden="true">×</em><span>{connection.problem.statement}</span></h2>
          <span className="bridge-bar__pending">{saved ? "已保存" : "还没保存"}</span>
        </div>
        <div className="bridge-bar__actions">
          {/*
            旧的完整分析没有删，只是不再是默认。
            ⚠️ **这里不要再 `setDiscoveryHandoff` 一次**：那个函数会顺手清掉构造会话
            （换连接时本该如此），于是从完整分析回来，选好的讲法和推过的两轮全没了。
            连接本来就还在交接位上，两边都只是读它。
          */}
          <button type="button" className="btn btn-sm" onClick={() => onGo?.("bridge", "analyze")}>查看完整分析</button>
          {selected && !saved ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={saveBusy} onClick={save}>
              {saveBusy ? "正在保存…" : "保存为内容机会"}
            </button>
          ) : null}
          {saved ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onGo?.("bridge", `opportunity:${saved.id}`)}>打开这条内容机会</button>
          ) : null}
        </div>
      </div>

      {/* 顶：创作意图。轻量三行，不占屏。 */}
      <section className="construction-intent" aria-label="创作意图">
        <div>
          <span>{hypothesis ? "你认为可能有人在困惑" : "有人在问"}</span>
          <strong>{connection.problem.statement}</strong>
          <small data-origin={connection.problem.origin}>{connection.problem.evidenceLabel}</small>
        </div>
        <div>
          <span>核心连接</span>
          <strong>{connection.fitReason}</strong>
        </div>
        {agendas.length ? (
          <div className="construction-intent__agenda">
            <label htmlFor="construction-agenda">长期议程</label>
            <select
              id="construction-agenda"
              value={agendaId}
              disabled={busy || refining}
              onChange={(event) => { setAgendaId(event.target.value); setRoutes([]); }}
            >
              <option value="">不关联议程</option>
              {agendas.map((agenda) => <option key={agenda.id} value={agenda.id}>{agenda.title}</option>)}
            </select>
          </div>
        ) : null}
      </section>

      <ErrorNote error={error} what="内容构造" onRetry={routes.length ? undefined : () => propose(agendaId)} />

      {busy ? (
        <div className="bridge-pending" aria-live="polite">
          <p>正在从整个工作区里找可用的材料，凑出几种不同的讲法…</p>
          <small>通常二十秒上下。给出来的是候选，选了才继续，保存了才入库。</small>
        </div>
      ) : null}

      {!busy && routes.length ? (
        <>
          {!selected ? (
            <section className="construction-routes" aria-label="可选的讲法">
              <header className="construction-routes__head">
                <h3>Xenho 找到 {routes.length} 种讲法</h3>
                <small>
                  {routes.length === 1 ? "这条连接目前只撑得起一种讲法。" : "它们的入口、用到的材料和最后的判断都不一样。"}
                  {droppedAsSame ? ` 另有 ${droppedAsSame} 条和上面重复，已经去掉。` : ""}
                </small>
              </header>
              {note ? <p className="construction-note">{note}</p> : null}
              {!experienceAvailable ? (
                <p className="construction-note construction-note--gate">
                  工作区里还没有个人经历，所以这次没有经历型的讲法。如果你有一段相关的真实经历，
                  先把它作为「个人经历」素材存进来，再回到这条连接。
                </p>
              ) : null}
              <div className="construction-routes__list">
                {routes.map((route) => (
                  <RouteCard key={route.id} route={route} onSelect={() => setSelectedId(route.id)} />
                ))}
              </div>
            </section>
          ) : (
            <section className="construction-current" aria-label="正在推的讲法">
              <RouteCard route={selected} selected />

              {/* 其他讲法退到次级：想比较时点开，不长期占屏。 */}
              {others.length ? (
                <div className="construction-others">
                  <button type="button" aria-expanded={showOthers} onClick={() => setShowOthers((value) => !value)}>
                    {showOthers ? "收起另外的讲法" : `另外 ${others.length} 种讲法`}
                  </button>
                  {showOthers ? (
                    <div className="construction-others__list">
                      {others.map((route) => (
                        <RouteCard key={route.id} route={route} compact onSelect={() => { setSelectedId(route.id); setShowOthers(false); }} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {history.length ? (
                <ol className="construction-history" aria-label="这条讲法被怎么调整过">
                  {history.map((item, index) => (
                    <li key={`${item.ask}:${index}`}>
                      <q>{item.ask}</q>
                      {item.note ? <span>{item.note}</span> : null}
                    </li>
                  ))}
                </ol>
              ) : null}

              {saved ? (
                <Note tone="success" title="内容机会已保存">
                  用户问题、这条讲法用到的材料和它们的组织方式都一起存下来了。接着可以建立内容项目开始写。
                </Note>
              ) : (
                <div className="construction-ask">
                  <label htmlFor="construction-ask">跟 Xenho 说</label>
                  <textarea
                    id="construction-ask"
                    ref={askRef}
                    rows={2}
                    value={instruction}
                    disabled={refining}
                    onChange={(event) => setInstruction(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) refine(); }}
                    placeholder="例如：结论太绝对了，收一点｜有没有我以前记过的案例能支撑它｜把最强的反方放到前面｜这条太像知识科普了，变成判断型"
                  />
                  <div className="construction-ask__actions">
                    <button type="button" className="btn btn-primary btn-sm" disabled={!instruction.trim() || refining} onClick={refine}>
                      {refining ? "正在改…" : "继续推"}
                    </button>
                    <button type="button" className="btn btn-sm" disabled={refining} onClick={() => setSelectedId("")}>换一条讲法</button>
                  </div>
                  {refining ? <p className="construction-note" aria-live="polite">只改你说的那部分，其余保持原样。</p> : null}
                </div>
              )}
            </section>
          )}
        </>
      ) : null}

      {!busy && !routes.length && !error ? (
        <div className="bridge-blank">
          <h3>这次没凑出站得住的讲法</h3>
          {/*
            ⚠️ **必须说出为什么。** 模型明明返回了东西却一条都没剩下，
            如果界面只说「暂时没有」，这故障就没法查也没法判断该不该重试。
          */}
          {dropped.length ? (
            <ul className="construction-dropped">
              {dropped.map((item, index) => <li key={`${item.id}:${index}`}>讲法 {item.id}：{item.reason}</li>)}
            </ul>
          ) : (
            <p>这条连接暂时凑不出站得住的构造路线。可以换个议程再试，或者回去看看完整分析。</p>
          )}
          <button type="button" className="btn btn-primary" onClick={() => propose(agendaId)}>
            <IconSparkles aria-hidden="true" />
            再试一次
          </button>
        </div>
      ) : null}
    </div>
  );
}
