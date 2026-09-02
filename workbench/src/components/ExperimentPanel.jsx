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
import "./experiment-panel.css";

const VERDICTS = [
  { key: "supported", label: "成立", hint: "结果和假设一致" },
  { key: "mixed", label: "一半一半", hint: "部分成立，部分没有" },
  { key: "refuted", label: "不成立", hint: "结果否掉了假设" },
];

const VERDICT_LABELS = Object.fromEntries(VERDICTS.map((item) => [item.key, item.label]));

export function ExperimentPanel({ projectId, publication, onGo }) {
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
    <section className="experiment-panel" aria-labelledby="experiment-title">
      <header>
        <h2 id="experiment-title">这一篇在验证什么</h2>
        <small>假设 → 发布 → 发生了什么 → 我更新了什么判断</small>
      </header>

      {error ? <ErrorNote error={error} what="内容实验" onRetry={load} /> : null}

      {!openExperiment && !settled.length ? (
        published ? (
          <Note title="这一篇没有事前假设">
            假设必须在发布前写下——发布之后补的假设一定和结果吻合，用它验证等于自我确认。
            这一篇可以直接写复盘；下一篇发之前，先在这里留一句。
          </Note>
        ) : (
          <div className="experiment-record">
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
              <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>发布前，先写下你的假设</button>
            )}
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
                <label>发生了什么<textarea rows={2} value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="数据、评论、私信里实际观察到的" /></label>
                <label>我更新了什么判断<textarea rows={2} value={learning} onChange={(event) => setLearning(event.target.value)} placeholder="下一次会因此改变什么" /></label>
                <div className="experiment-verdicts" role="group" aria-label="这条假设成立吗">
                  {VERDICTS.map((item) => (
                    <button key={item.key} type="button" aria-pressed={verdict === item.key} title={item.hint} onClick={() => setVerdict(item.key)}>{item.label}</button>
                  ))}
                </div>
                <div className="experiment-actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={!outcome.trim() || !learning.trim() || busy} onClick={() => settle(openExperiment.id)}>
                    {busy ? "正在结算…" : "结算这次实验"}
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
