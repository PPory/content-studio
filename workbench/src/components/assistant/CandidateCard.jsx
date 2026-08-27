import { useEffect, useState } from "react";
import { changeSummary } from "../../lib/ai/result-model.js";
import { IconAlertTriangle, IconCheck, IconLoader2, IconRefresh } from "../icons.jsx";
import "../text-revision.css";

const STATUS_LABEL = {
  generating: "生成中",
  ready: "待审阅",
  edited: "已编辑",
  stale: "正文已变化",
  failed: "生成失败",
};

export function GroundingReceipt({ grounding, onAction }) {
  if (!grounding) return null;
  return <section className="candidate-grounding" aria-label="证据回执">
    <header><b>证据回执</b><span data-gate={grounding.gate}>{grounding.gate === "rejected" ? "服务端未放行" : "服务端已放行"}</span></header>
    {grounding.used.length ? <div className="candidate-grounding__group"><b>已使用 {grounding.used.length}</b><ul>{grounding.used.map((item) => <li key={item.id}>{item.title}</li>)}</ul></div> : null}
    {grounding.skipped.length ? <div className="candidate-grounding__group is-warning"><b>已跳过 {grounding.skipped.length}</b><ul>{grounding.skipped.map((item) => <li key={item.id}><span><strong>{item.title}</strong><small>{item.reason}</small></span><button type="button" onClick={() => onAction?.(item, item.nextStep)}>{item.nextStep.label}</button></li>)}</ul></div> : null}
    {grounding.unverified.length ? <div className="candidate-grounding__group is-warning"><b>未经核验 {grounding.unverified.length}</b><ul>{grounding.unverified.map((item, index) => <li key={`${item.quote}-${index}`}><span><strong>“{item.quote}”</strong><small>{item.why}</small></span></li>)}</ul></div> : null}
    {grounding.gate === "rejected" && grounding.gateDetail ? <p className="candidate-grounding__gate"><IconAlertTriangle aria-hidden="true" />{grounding.gateDetail}</p> : null}
  </section>;
}

export function CandidateCard({ candidate, persistenceError, onText, onRegenerate, onAdopt, onDiscard, onGroundingAction }) {
  const [instruction, setInstruction] = useState(candidate.instruction || "");
  useEffect(() => setInstruction(candidate.instruction || ""), [candidate.id, candidate.instruction]);
  const summary = changeSummary(candidate.original, candidate.text);
  const blocked = candidate.status === "generating" || candidate.status === "failed" || candidate.status === "stale";
  const needsInstruction = candidate.mode === "rewrite" && candidate.source !== "assistant";
  const regenerate = () => {
    if (needsInstruction && !instruction.trim()) return;
    onRegenerate(instruction.trim());
  };
  const shortcut = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === "Enter" && !blocked && candidate.text.trim()) {
      event.preventDefault();
      onAdopt();
    } else if (event.key === "Backspace" && candidate.status !== "generating") {
      event.preventDefault();
      onDiscard();
    }
  };
  return <section className="text-revision-review candidate-card" data-status={candidate.status} aria-label={`${candidate.label}候选`} aria-live="polite" onKeyDown={shortcut}>
    <header>
      <span><b>{candidate.label}</b></span>
      <span>{candidate.generations?.length ? `第 ${candidate.generations.length} 版` : STATUS_LABEL[candidate.status]} · {summary.label}</span>
    </header>
    {candidate.status === "stale" ? <p className="candidate-card__stale"><IconAlertTriangle aria-hidden="true" />正文已在候选生成后变化。请重新生成，避免覆盖新内容。</p> : null}
    {candidate.status === "generating" ? <div className="text-revision-review__loading"><IconLoader2 className="spin" aria-hidden="true" /><span>正在保持原意，生成可比较的新版本…</span></div>
      : candidate.status === "failed" || candidate.error ? <div className="text-revision-review__error"><b>{candidate.error?.message || candidate.grounding?.gateDetail || "候选没有生成"}</b>{candidate.error?.hint ? <small>{candidate.error.hint}</small> : null}<button type="button" onClick={regenerate}>重试</button></div>
        : <textarea value={candidate.text} onChange={(event) => onText(event.target.value)} aria-label="AI 正文候选，可直接编辑" aria-keyshortcuts="Control+Enter Meta+Enter Control+Backspace Meta+Backspace" rows={Math.min(12, Math.max(3, candidate.text.split("\n").length + 1))} />}
    <GroundingReceipt grounding={candidate.grounding} onAction={onGroundingAction} />
    <footer>
      <div className="text-revision-review__command">
        <input value={instruction} maxLength={500} onChange={(event) => setInstruction(event.target.value)} placeholder={candidate.mode === "rewrite" ? "调整改写要求后重新生成" : "可补充具体要求后重新生成"} aria-label="调整候选要求" />
        <button type="button" onClick={regenerate} disabled={candidate.status === "generating" || (needsInstruction && !instruction.trim())} title="按当前要求重新生成" aria-label="重新生成"><IconRefresh aria-hidden="true" stroke={1.7} /></button>
      </div>
      <div className="text-revision-review__decide">
        <button type="button" onClick={onDiscard} disabled={candidate.status === "generating"} title="Ctrl/⌘+Backspace">弃用</button>
        <button type="button" className="is-primary" onClick={onAdopt} disabled={blocked || !candidate.text.trim()} title="Ctrl/⌘+Enter"><IconCheck aria-hidden="true" />采纳</button>
      </div>
    </footer>
    <small className={`text-revision-review__note${persistenceError ? " is-bad" : ""}`}>{persistenceError ? `候选历史未保存：${persistenceError}` : `内容由 AI 生成 · ${STATUS_LABEL[candidate.status] || "待审阅"} · 采纳前不会写入正文`}</small>
  </section>;
}
