import { useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconRefresh } from "./icons.jsx";

const POSITIVE = new Set(["pass", "verified", "supported"]);
const RISK = new Set(["fail", "disputed", "unsupported"]);

function blocksOf(body = "") {
  const lines = String(body).split("\n");
  const blocks = [];
  let offset = 0;
  let buffer = [];
  let start = 0;
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) blocks.push({ id: `block-${blocks.length}`, text, from: start, to: start + buffer.join("\n").length, heading: /^#{1,6}\s/.test(text) });
    buffer = [];
  };
  for (const line of lines) {
    if (!line.trim()) { flush(); offset += 1; continue; }
    if (!buffer.length) start = offset;
    buffer.push(line);
    offset += line.length + 1;
  }
  flush();
  return blocks;
}

function blockForFinding(blocks, finding) {
  const exact = [finding.quote, finding.excerpt, finding.text].find(Boolean);
  if (exact) {
    const match = blocks.find((block) => block.text.includes(exact) || exact.includes(block.text));
    if (match) return match;
  }
  const section = Number(String(finding.location || "").match(/第\s*(\d+)\s*节/)?.[1]);
  const paragraph = Number(String(finding.location || "").match(/第\s*(\d+)\s*段/)?.[1]);
  if (paragraph && !section) return blocks.filter((block) => !block.heading)[Math.max(0, paragraph - 1)] || null;
  if (section) {
    const headings = blocks.map((block, index) => block.heading ? index : -1).filter((index) => index >= 0);
    const start = headings[Math.max(0, section - 1)] ?? 0;
    const end = headings[section] ?? blocks.length;
    const bodyBlocks = blocks.slice(start + 1, end).filter((block) => !block.heading);
    return bodyBlocks[Math.max(0, (paragraph || 1) - 1)] || blocks[start] || null;
  }
  return null;
}

function severityLabel(status) {
  if (RISK.has(status)) return "高风险";
  return "建议修改";
}

function findingTitle(item) {
  return item.finding || item.quote || item.need || "未命名发现";
}

export function ProjectReportReview({ run, document, onClose, onRetry, onGenerateCandidate, onReveal, onVerify }) {
  const report = run.report;
  const findings = report.questions || report.claims || [];
  const positive = findings.filter((item) => POSITIVE.has(String(item.status).toLowerCase()));
  const actionable = findings.filter((item) => !POSITIVE.has(String(item.status).toLowerCase()));
  const strengths = [...(report.strengths || []), ...positive.map((item) => ({ quote: findingTitle(item), reason: item.direction || item.reason || "证据与表达成立。" }))];
  const blocks = useMemo(() => blocksOf(document.body), [document.body]);
  const mapping = useMemo(() => new Map(actionable.map((item) => [item.id || findingTitle(item), blockForFinding(blocks, item)])), [actionable, blocks]);
  const [activeId, setActiveId] = useState(actionable[0]?.id || (actionable[0] ? findingTitle(actionable[0]) : ""));
  const [decisions, setDecisions] = useState({});
  const blockRefs = useRef(new Map());
  const findingRefs = useRef(new Map());
  const focusFinding = (item) => {
    const id = item.id || findingTitle(item);
    setActiveId(id);
    mapping.get(id) && blockRefs.current.get(mapping.get(id).id)?.scrollIntoView({ block: "center", behavior: "auto" });
  };
  const focusFromBlock = (block) => {
    const entry = actionable.find((item) => mapping.get(item.id || findingTitle(item))?.id === block.id);
    if (!entry) return;
    const id = entry.id || findingTitle(entry);
    setActiveId(id);
    findingRefs.current.get(id)?.scrollIntoView({ block: "center", behavior: "auto" });
  };
  const locate = (item) => mapping.get(item.id || findingTitle(item));
  const actionsFor = (item) => {
    const block = locate(item);
    const id = item.id || findingTitle(item);
    const common = <button type="button" onClick={() => setDecisions((value) => ({ ...value, [id]: "ignored" }))}>忽略</button>;
    if (report.kind === "fact-check") return <>{common}<button type="button" onClick={() => onVerify(item)}>去核验</button><button type="button" disabled={!block} onClick={() => onReveal(block)}>去正文修改</button></>;
    if (report.kind === "material-research") return <>{common}<button type="button" onClick={() => setDecisions((value) => ({ ...value, [id]: "sources" }))}>查看来源</button><button type="button" disabled={!block} onClick={() => onReveal(block)}>去正文补充</button></>;
    return <>{common}<button type="button" disabled={!block} onClick={() => onGenerateCandidate(item, block)}>生成候选</button><button type="button" disabled={!block} onClick={() => onReveal(block)}>去正文修改</button></>;
  };
  return <section className="project-report-review" aria-label="报告对照审阅">
    <header><button type="button" onClick={onClose}><IconArrowLeft aria-hidden="true" />返回正文</button><div><small>检查报告 · 仅供参考</small><strong>{report.kind === "quality-review" ? "Xenho 品控九问" : report.kind === "fact-check" ? "事实核查" : "素材研究"}</strong></div><button type="button" onClick={() => onRetry(run)}><IconRefresh aria-hidden="true" />重新检查</button></header>
    <div className="project-report-review__grid">
      <article className="project-report-document">
        <h1>{document.title || "未命名稿件"}</h1>
        {blocks.map((block) => {
          const linked = actionable.find((item) => mapping.get(item.id || findingTitle(item))?.id === block.id);
          const id = linked?.id || (linked ? findingTitle(linked) : "");
          const Tag = block.heading ? "h2" : "p";
          return <Tag key={block.id} ref={(node) => node ? blockRefs.current.set(block.id, node) : blockRefs.current.delete(block.id)} data-finding={id || undefined} data-current={id && id === activeId ? "true" : undefined} onClick={() => focusFromBlock(block)}>{block.text.replace(/^#{1,6}\s*/, "")}</Tag>;
        })}
      </article>
      <aside className="project-report-findings">
        <header><div><small>报告摘要</small><strong>{actionable.length} 条待处理</strong></div><span>不改变正文</span></header>
        <p>{report.summary}</p>
        <section className="project-report-findings__list"><h3>需要处理</h3>{actionable.map((item, index) => {
          const id = item.id || findingTitle(item);
          return <article ref={(node) => node ? findingRefs.current.set(id, node) : findingRefs.current.delete(id)} key={id} data-current={id === activeId ? "true" : undefined} onClick={() => focusFinding(item)}>
            <header><span>{index + 1}</span><div><b>{findingTitle(item)}</b>{item.location ? <small>{item.location}</small> : null}</div><em>{severityLabel(String(item.status).toLowerCase())}</em></header>
            <p>{item.direction || item.suggestion || item.risk || item.gap || "需要进一步判断。"}</p>
            <footer>{actionsFor(item)}</footer>
            {decisions[id] ? <small className="project-report-finding__state">{decisions[id] === "ignored" ? "已忽略此项" : "来源已展开"}</small> : null}
          </article>;
        })}</section>
        {strengths.length ? <details className="project-report-strengths"><summary>值得保留 <span>{strengths.length}</span></summary><div>{strengths.map((item, index) => <article key={index}><b>{item.quote}</b><small>{item.reason}</small></article>)}</div></details> : null}
      </aside>
    </div>
  </section>;
}
