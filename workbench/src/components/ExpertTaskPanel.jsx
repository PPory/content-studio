import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { IconLoader2, IconRefresh, IconX } from "./icons.jsx";

const LABELS = {
  "material-research": "素材查缺",
  "quality-review": "Xenho 品控九问",
  "fact-check": "事实核查",
};

function Sources({ items = [] }) {
  if (!items.length) return null;
  return <div className="expert-sources">{items.map((source, index) => (
    <article key={`${source.url || source.path || source.title}-${index}`}>
      <b>{source.title || "未命名来源"}</b>
      {source.excerpt ? <p>{source.excerpt}</p> : null}
      {source.why ? <small>{source.why}</small> : null}
      {source.url ? <a href={source.url} target="_blank" rel="noreferrer">打开网页来源</a> : source.path ? <code>{source.path}</code> : null}
    </article>
  ))}</div>;
}

function Report({ report }) {
  if (!report) return null;
  if (report.kind === "quality-review") return <div className="expert-report">
    <p className="expert-report__summary">{report.summary}</p>
    {report.strengths?.length ? <section><h4>值得保留和强化</h4>{report.strengths.map((item, index) => <article key={index}><blockquote>{item.quote}</blockquote><p>{item.reason}</p></article>)}</section> : null}
    <section><h4>九问结果</h4>{(report.questions || []).map((item, index) => <article className="quality-row" data-status={item.status} key={`${item.id}-${index}`}><span>{index + 1}</span><div><b>{item.finding || item.id}</b>{item.location ? <small>{item.location}</small> : null}{item.direction ? <p>修改方向：{item.direction}</p> : null}</div></article>)}</section>
    {report.mustFix?.length ? <section><h4>发布前必须处理</h4><ul>{report.mustFix.map((item, index) => <li key={index}>{item}</li>)}</ul></section> : null}
  </div>;
  return <div className="expert-report">
    <p className="expert-report__summary">{report.summary}</p>
    <section><h4>{report.kind === "fact-check" ? "逐条核查" : "观点与素材缺口"}</h4>{(report.claims || []).map((item, index) => <article className="claim-row" data-status={item.status} key={index}>
      <header><span>{index + 1}</span><b>{item.quote || item.need || "未命名观点"}</b>{item.status ? <em>{item.status}</em> : null}</header>
      {item.location ? <small>{item.location}</small> : null}
      {item.need ? <p>需要：{item.need}</p> : null}
      {item.risk ? <p>风险：{item.risk}</p> : null}
      {item.gap ? <p>仍缺：{item.gap}</p> : null}
      {item.suggestion ? <p>建议改法：{item.suggestion}</p> : null}
      <Sources items={[...(item.localSources || []), ...(item.webSources || [])]} />
    </article>)}</section>
    {report.nextSteps?.length ? <section><h4>下一步</h4><ul>{report.nextSteps.map((item, index) => <li key={index}>{item}</li>)}</ul></section> : null}
  </div>;
}

export function ExpertTaskPanel({ run: initialRun, onRunChange, onClose, onRetry }) {
  const [run, setRun] = useState(initialRun);
  useEffect(() => setRun(initialRun), [initialRun]);
  useEffect(() => {
    if (!run?.id || !["queued", "running"].includes(run.status)) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const next = (await api.expertRun(run.id)).run;
        if (stopped) return;
        setRun(next);
        onRunChange?.(next);
      } catch { /* 临时重启时继续轮询，不把任务误判成失败。 */ }
    };
    const timer = setInterval(poll, 1200);
    poll();
    return () => { stopped = true; clearInterval(timer); };
  }, [run?.id, run?.status, onRunChange]);
  useEffect(() => {
    const esc = (event) => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onClose]);
  if (!run) return null;
  const working = ["queued", "running"].includes(run.status);
  return <div className="expert-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section className="expert-task" role="dialog" aria-modal="true" aria-label={LABELS[run.kind] || "专家任务"}>
      <header>
        <div><small>专家任务 · {run.localSourceCount != null ? `本地找到 ${run.localSourceCount} 条候选来源` : "只读研究"}</small><strong>{LABELS[run.kind] || "专家检查"}</strong></div>
        <button onClick={onClose} aria-label="关闭专家任务"><IconX aria-hidden="true" /></button>
      </header>
      {working ? <div className="expert-progress"><div><span style={{ width: `${run.percent || 2}%` }} /></div><p><IconLoader2 className="spin" aria-hidden="true" />{run.stageLabel || "正在执行"}</p><small>关闭这个面板不会中止任务，回来仍能看到结果。</small></div> : null}
      {run.status === "failed" ? <div className="expert-error"><strong>{run.error}</strong>{run.hint ? <p>{run.hint}</p> : null}</div> : null}
      {run.status === "cancelled" ? <div className="expert-error"><strong>这次任务已中止</strong></div> : null}
      <Report report={run.report} />
      <footer>
        <span>报告不会自动改正文；来源与修改建议由你决定是否采用。</span>
        <div>{working ? <button onClick={async () => { const next = (await api.cancelExpertRun(run.id)).run; setRun(next); onRunChange?.(next); }}>中止任务</button> : <button onClick={onRetry}><IconRefresh aria-hidden="true" />重新检查</button>}</div>
      </footer>
    </section>
  </div>;
}
