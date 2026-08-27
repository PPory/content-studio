import { reportSeverity } from "../lib/report-severity.js";
import { createAiResult } from "../lib/ai/result-model.js";
import "./expert-report.css";

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

function Severity({ kind, status }) {
  const severity = reportSeverity(kind, status);
  if (!severity) return null;
  return <em className="expert-severity" data-severity={severity.id}>{severity.displayName}</em>;
}

function PositiveFindings({ items }) {
  if (!items.length) return null;
  return <section><h4>值得保留</h4>{items.map((item, index) => <article key={index}>
    <blockquote>{item.quote || item.finding || item.need || item.id || "已通过检查"}</blockquote>
    <p>{item.reason || item.direction || item.suggestion || "这一项已经成立。"}</p>
  </article>)}</section>;
}

export function ExpertReport({ report }) {
  if (!report) return null;
  const result = createAiResult({ kind: "report", findings: report.questions || report.claims || [], report });
  const positive = result.findings.filter((item) => ["pass", "verified", "supported"].includes(String(item.status).toLowerCase()));
  const actionable = result.findings.filter((item) => !["pass", "verified", "supported"].includes(String(item.status).toLowerCase()));
  const strengths = [...(report.strengths || []), ...positive];
  if (report.kind === "quality-review") return <div className="expert-report">
    <p className="expert-report__summary">{report.summary}</p>
    <p className="expert-report__reference">AI 报告仅供参考；阶段推进仍由确定性业务规则决定。</p>
    <PositiveFindings items={strengths} />
    {actionable.length ? <section><h4>需要判断</h4>{actionable.map((item, index) => <article className="quality-row" data-status={item.status} key={`${item.id}-${index}`}><span>{index + 1}</span><div><header className="expert-finding-head"><b>{item.finding || item.id}</b><Severity kind={report.kind} status={item.status} /></header>{item.location ? <small>{item.location}</small> : null}{item.direction ? <p>修改方向：{item.direction}</p> : null}</div></article>)}</section> : null}
    {report.mustFix?.length ? <section><h4>高风险</h4><ul>{report.mustFix.map((item, index) => <li key={index}>{item}</li>)}</ul></section> : null}
  </div>;
  return <div className="expert-report">
    <p className="expert-report__summary">{report.summary}</p>
    <p className="expert-report__reference">AI 报告仅供参考；阶段推进仍由确定性业务规则决定。</p>
    <PositiveFindings items={positive} />
    {actionable.length ? <section><h4>{report.kind === "fact-check" ? "逐条核查" : "观点与素材缺口"}</h4>{actionable.map((item, index) => <article className="claim-row" data-status={item.status} key={index}>
      <header><span>{index + 1}</span><b>{item.quote || item.need || "未命名观点"}</b><Severity kind={report.kind} status={item.status} /></header>
      {item.location ? <small>{item.location}</small> : null}
      {item.need ? <p>需要：{item.need}</p> : null}
      {item.risk ? <p>风险：{item.risk}</p> : null}
      {item.gap ? <p>仍缺：{item.gap}</p> : null}
      {item.suggestion ? <p>建议改法：{item.suggestion}</p> : null}
      <Sources items={[...(item.localSources || []), ...(item.webSources || [])]} />
    </article>)}</section> : null}
    {report.nextSteps?.length ? <section><h4>下一步</h4><ul>{report.nextSteps.map((item, index) => <li key={index}>{item}</li>)}</ul></section> : null}
  </div>;
}
