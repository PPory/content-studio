/**
 * 一次内容实验：假设 → 发布 → 发生了什么 → 我更新了什么判断。
 *
 * ⚠️ **假设的输入框只在发布之前出现。** 这不是为了少一个按钮，
 * 而是因为发布之后补的假设一定和结果吻合——服务端会直接拒绝拿它验证那次发布。
 * 界面把这条规则说出来，好过让人写完再被拒。
 *
 * ⚠️ 「从反馈里读用户问题」要求贴进真实原话。只有阅读量和收藏数时读不出
 * 任何人具体在困惑什么：那一步是创作者的推断，写成用户问题就是把推断当观察。
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Note } from "./ui.jsx";
import { IconSparkles } from "./icons.jsx";
import "./experiment-panel.css";

const VERDICTS = [
  { key: "supported", label: "成立", hint: "结果和假设一致" },
  { key: "mixed", label: "一半一半", hint: "部分成立，部分没有" },
  { key: "refuted", label: "不成立", hint: "结果否掉了假设" },
];

const VERDICT_LABELS = Object.fromEntries(VERDICTS.map((item) => [item.key, item.label]));

export function ExperimentPanel({ projectId, publication, onGo, compact = false }) {
  const [experiments, setExperiments] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hypothesis, setHypothesis] = useState("");
  const [open, setOpen] = useState(false);
  const [settling, setSettling] = useState("");
  const [outcome, setOutcome] = useState("");
  const [learning, setLearning] = useState("");
  const [verdict, setVerdict] = useState("mixed");
  const [feedbackFor, setFeedbackFor] = useState("");
  /** 发布前的假设候选。AI 先提，用户挑一条或者自己写。 */
  const [hypotheses, setHypotheses] = useState([]);
  const [proposing, setProposing] = useState(false);
  /** 发布后的结算预览：观察 / 推断 / 学习候选三段分开。 */
  const [settlement, setSettlement] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [candidateNote, setCandidateNote] = useState("");

  const load = useCallback(() => {
    if (!projectId) return;
    api.experiments(`?project=${encodeURIComponent(projectId)}`)
      .then((result) => setExperiments(result.experiments || []))
      .catch(setError);
  }, [projectId]);
  useEffect(load, [load]);

  const published = Boolean(publication?.publishedAt);
  const openExperiment = experiments.find((item) => item.verdict === "open") || null;
  const settled = experiments.filter((item) => item.verdict !== "open");

  const record = async () => {
    if (!hypothesis.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.recordHypothesis({ projectId, hypothesis: hypothesis.trim(), confirmed: true });
      setHypothesis("");
      setOpen(false);
      load();
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  };

  const proposeHypotheses = useCallback(async () => {
    setProposing(true);
    setError(null);
    try {
      const result = await api.hypothesisCandidates(projectId);
      setHypotheses(result.hypotheses || []);
    } catch (failure) { setError(failure); } finally { setProposing(false); }
  }, [projectId]);

  const recordCandidate = async (text) => {
    setBusy(true);
    setError(null);
    try {
      await api.recordHypothesis({ projectId, hypothesis: text, confirmed: true });
      setHypotheses([]);
      setOpen(false);
      load();
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  };

  /**
   * 结算预览：观察 / 推断 / 学习候选三段分开。
   *
   * ⚠️ 它不结算，只提候选。真实数据不够时服务端连模型都不跑，直接说还差什么。
   */
  const previewSettlement = useCallback(async (id) => {
    setPreviewing(true);
    setError(null);
    try {
      const result = await api.settlementPreview(id, feedbackText);
      setSettlement({ id, ...result });
      if (result.verdict) setVerdict(result.verdict);
      if (result.learningCandidate) setLearning(result.learningCandidate);
      if (result.observations?.length) {
        setOutcome(result.observations.map((item) => item.text).join("\n"));
      }
    } catch (failure) { setError(failure); } finally { setPreviewing(false); }
  }, [feedbackText]);

  const settle = async (id) => {
    if (!outcome.trim() || !learning.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.settleExperiment(id, {
        publicationId: publication?.id || undefined,
        outcome: outcome.trim(),
        learning: learning.trim(),
        verdict,
        confirmed: true,
      });
      setSettling("");
      setOutcome("");
      setLearning("");
      load();
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  };

  const readFeedback = async (id) => {
    setBusy(true);
    setError(null);
    setCandidateNote("");
    try {
      const result = await api.experimentProblemCandidates(id, { feedbackText });
      setCandidates(result.problems || []);
      if (!(result.problems || []).length) setCandidateNote("这段反馈里没读出值得记的用户问题。");
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  };

  const keepCandidate = async (experimentId, candidate) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.createAudienceProblem({ ...candidate, confirmed: true });
      await api.linkExperimentProblem(experimentId, { problemId: saved.problem.id, confirmed: true });
      setCandidates((items) => items.filter((item) => item !== candidate));
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  };

  return (
    <section className="experiment-panel" data-compact={compact ? "true" : undefined} aria-label="这一篇在验证什么">
      {/*
        ⚠️ 嵌进复盘的 01「这篇原本想验证什么」时不再自带标题：
        那一段问的就是这件事，两个标题叠在一起是把同一个问题问了两遍。
      */}
      {compact ? null : (
        <header>
          <h2>这一篇在验证什么</h2>
          <small>假设 → 发布 → 发生了什么 → 我更新了什么判断</small>
        </header>
      )}

      {error ? <ErrorNote error={error} what="内容实验" onRetry={load} /> : null}

      {!openExperiment && !settled.length ? (
        published ? (
          <Note title="这一篇没有事前假设">
            假设必须在发布前写下——发布之后补的假设一定和结果吻合，用它验证等于自我确认。
            这一篇可以直接写复盘；下一篇发之前，先在这里留一句。
          </Note>
        ) : (
          <div className="experiment-record">
            {/*
              ⚠️ **这里原来是一个空白输入框**（「你为什么认为这一篇会有效？」）。
              而这一篇的入口、讲法、主导动作和长期议程系统全都知道——
              那个框最常见的结果是随手写一句和策略无关的愿望。
              先由 AI 提，用户挑一条或者改一改；「自己写」退成次级，但一直在。
            */}
            {hypotheses.length ? (
              <div className="experiment-candidates" aria-label="待确认的假设候选">
                {hypotheses.map((item) => (
                  <article key={item.hypothesis}>
                    <strong>{item.hypothesis}</strong>
                    <span>{item.why}</span>
                    {/* 说不出「什么算不成立」的假设一定会被判成成立。 */}
                    <small>怎么算成立：{item.signal}</small>
                    <div className="experiment-actions">
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => recordCandidate(item.hypothesis)}>就验证这条</button>
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setHypothesis(item.hypothesis); setOpen(true); }}>改一改</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
            {open ? (
              <>
                <label>
                  你为什么认为这一篇会有效？
                  <textarea
                    rows={3}
                    value={hypothesis}
                    onChange={(event) => setHypothesis(event.target.value)}
                    placeholder="例如：用真实问题当入口，会比直接讲概念更容易被收藏。"
                  />
                </label>
                <div className="experiment-actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={!hypothesis.trim() || busy} onClick={record}>
                    {busy ? "正在记录…" : "记下这条假设"}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>取消</button>
                </div>
              </>
            ) : (
              <div className="experiment-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={proposing} onClick={proposeHypotheses}>
                  <IconSparkles aria-hidden="true" />
                  {proposing ? "正在想…" : hypotheses.length ? "换几条" : "这一篇最值得验证什么？"}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>自己写一条</button>
              </div>
            )}
            {proposing ? <p className="experiment-note" aria-live="polite">正在按这一篇的入口、讲法和长期议程想…</p> : null}
          </div>
        )
      ) : null}

      {openExperiment ? (
        <article className="experiment-card" data-verdict="open">
          <div className="experiment-card__label"><span>假设</span><em>{new Date(openExperiment.recordedAt).toLocaleDateString("zh-CN")}记下</em></div>
          <p>{openExperiment.hypothesisMarkdown}</p>
          {published ? (
            settling === openExperiment.id ? (
              <div className="experiment-settle">
                {/*
                  ⚠️ **这三个框原来都是空的。** 真实库里那条唯一结算过的实验，
                  「发生了什么」写的是「数据比之前好点」，「更新了什么判断」写的是
                  「下次可以继续这样尝试」——两句都不能被任何人复核。
                  所以先让 AI 把**能被复核的事实**和**它自己的解释**分开摆出来。
                */}
                {!settlement || settlement.id !== openExperiment.id ? (
                  <div className="experiment-actions">
                    <button type="button" className="btn btn-primary btn-sm" disabled={previewing} onClick={() => previewSettlement(openExperiment.id)}>
                      <IconSparkles aria-hidden="true" />
                      {previewing ? "正在读结果…" : "帮我看看这次发生了什么"}
                    </button>
                    <span className="experiment-note">也可以直接自己写。</span>
                  </div>
                ) : null}

                {settlement && settlement.id === openExperiment.id ? (
                  <div className="settlement">
                    {settlement.observations.length ? (
                      <section>
                        <h4>观察到的<em>能被复核的事实</em></h4>
                        <ul>
                          {settlement.observations.map((item, index) => (
                            <li key={`${item.text}:${index}`}>
                              {item.text}
                              <small>
                                {item.basisKind === "metric"
                                  ? `依据：${item.metricLabel} ${item.value}${item.baseline != null ? `（同平台中位数 ${item.baseline}）` : ""}`
                                  : `依据原话：「${item.quote}」`}
                              </small>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : (
                      <section>
                        <h4>观察到的</h4>
                        <p className="settlement-empty">
                          {settlement.note || "这次没有能被复核的事实。"}
                          {settlement.missing?.length ? <><br />还差：{settlement.missing.join("；")}</> : null}
                        </p>
                      </section>
                    )}

                    {settlement.inferences.length ? (
                      <section>
                        {/* ⚠️ 标签是硬要求：推断和观察长得一样的时候，人会把它当成事实记住。 */}
                        <h4>AI 的推断<em>不是事实，是解释</em></h4>
                        <ul>{settlement.inferences.map((item, index) => <li key={`${item}:${index}`}>{item}</li>)}</ul>
                      </section>
                    ) : null}

                    {settlement.verdictReason ? (
                      <section>
                        <h4>这条假设成立吗</h4>
                        <p>{settlement.verdictReason}</p>
                      </section>
                    ) : null}
                    {settlement.nextExperiment ? (
                      <section>
                        <h4>下一次值得试什么</h4>
                        <p>{settlement.nextExperiment}</p>
                      </section>
                    ) : null}
                  </div>
                ) : null}

                <label>发生了什么<textarea rows={2} value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="数据、评论、私信里实际观察到的" /></label>
                <label>我更新了什么判断<textarea rows={2} value={learning} onChange={(event) => setLearning(event.target.value)} placeholder="下一次会因此改变什么" /></label>
                <div className="experiment-verdicts" role="group" aria-label="这条假设成立吗">
                  {VERDICTS.map((item) => (
                    <button key={item.key} type="button" aria-pressed={verdict === item.key} title={item.hint} onClick={() => setVerdict(item.key)}>{item.label}</button>
                  ))}
                </div>
                <label>
                  把收到的评论、私信或群里的原话贴进来（可选）
                  <textarea rows={3} value={feedbackText} onChange={(event) => setFeedbackText(event.target.value)} placeholder="逐字粘贴。有原话，AI 才敢说读者在讨论什么；只有数字时它只能谈数字。" />
                </label>
                <div className="experiment-actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={!outcome.trim() || !learning.trim() || busy} onClick={() => settle(openExperiment.id)}>
                    {busy ? "正在结算…" : settlement?.id === openExperiment.id ? "确认这条判断并结算" : "结算这次实验"}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setSettling("")}>取消</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setSettling(openExperiment.id)}>发出去了，来结算</button>
            )
          ) : (
            <small className="experiment-waiting">等这一篇发出去，再回来结算。</small>
          )}
        </article>
      ) : null}

      {settled.map((item) => (
        <article key={item.id} className="experiment-card" data-verdict={item.verdict}>
          <div className="experiment-card__label"><span>{VERDICT_LABELS[item.verdict] || item.verdict}</span><em>{new Date(item.settledAt).toLocaleDateString("zh-CN")}结算</em></div>
          <dl>
            <dt>假设</dt><dd>{item.hypothesisMarkdown}</dd>
            <dt>发生了什么</dt><dd>{item.outcomeMarkdown}</dd>
            <dt>我更新了什么判断</dt><dd>{item.learningMarkdown}</dd>
          </dl>
          {feedbackFor === item.id ? (
            <div className="experiment-feedback">
              <label>
                把收到的评论、私信或群里的原话贴进来
                <textarea rows={4} value={feedbackText} onChange={(event) => setFeedbackText(event.target.value)} placeholder="逐字粘贴。只有阅读量和收藏数的话，读出来的问题是推断，不是观察。" />
              </label>
              <div className="experiment-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={!feedbackText.trim() || busy} onClick={() => readFeedback(item.id)}>
                  {busy ? "正在读…" : "从这段反馈里读用户问题"}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => { setFeedbackFor(""); setCandidates([]); setCandidateNote(""); }}>收起</button>
              </div>
              {candidateNote ? <p className="experiment-note">{candidateNote}</p> : null}
              {candidates.map((candidate) => (
                <div key={candidate.statement} className="experiment-candidate">
                  <strong>{candidate.statement}</strong>
                  <span>{candidate.whyItMatters}</span>
                  <small>原话：{candidate.sources?.[0]?.evidenceText}</small>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => keepCandidate(item.id, candidate)}>确认保存</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="experiment-actions">
              <button type="button" className="btn btn-sm" onClick={() => setFeedbackFor(item.id)}>从反馈里读用户问题</button>
              {onGo ? <button type="button" className="btn btn-sm" onClick={() => onGo("bridge", "")}>去内容机会</button> : null}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
