import { useEffect, useRef } from "react";
import { EXPERT_KINDS } from "../lib/expert-kinds.js";
import { IconCheck, IconDatabase, IconFileText, IconRefresh, IconShieldCheck, IconX } from "./icons.jsx";

const NEEDS_VERIFICATION = new Set(["数据/事实", "金句/原话"]);

function isPending(material) {
  if (!NEEDS_VERIFICATION.has(material.type)) return false;
  return material.verificationStatus !== "已核验";
}

export function ProjectContextPanel({ open, openedByKeyboard, document, materials, totalMaterials = materials.length, runs, onClose, onRun, onOpenReport, onOpenMaterials }) {
  const panelRef = useRef(null);
  useEffect(() => {
    if (open && openedByKeyboard) requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
  }, [open, openedByKeyboard]);
  useEffect(() => {
    if (!open) return undefined;
    const escape = (event) => { if (event.key === "Escape") { event.preventDefault(); onClose(true); } };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [open, onClose]);
  if (!open) return null;
  return <section ref={panelRef} className="project-context-panel" tabIndex="-1" aria-label="当前 AI 上下文">
    <header><div><small>当前上下文</small><strong>{document.title || "未命名稿件"}</strong></div><button type="button" onClick={() => onClose(true)} aria-label="关闭上下文"><IconX aria-hidden="true" /></button></header>
    <div className="project-context-panel__document"><IconFileText aria-hidden="true" /><span><b>当前主稿</b><small>标题、正文与当前选区</small></span><IconCheck aria-label="已附带" /></div>
    <section className="project-context-panel__materials">
      <div><span>已使用素材</span><b>{materials.length}</b></div>
      <div className="project-context-panel__list">
        {materials.length ? materials.map((item) => <button type="button" key={item.id} className="project-context-material">
          <IconDatabase aria-hidden="true" /><span><b>{item.title || item.name || "未命名素材"}</b><small>{item.type || "项目素材"}</small></span>{isPending(item) ? <em>待核验</em> : <IconCheck className="project-context-material__verified" aria-label="已核验或无需核验" />}
        </button>) : <p className="project-context-panel__empty"><b>还没有使用素材</b><small>需要时再从项目素材中添加。</small></p>}
      </div>
    </section>
    <section className="project-context-panel__reports">
      <div><span>项目检查</span><small>报告仅供参考</small></div>
      {EXPERT_KINDS.map((kind) => {
        const run = runs.find((item) => item.kind === kind.id);
        const working = run && ["queued", "running"].includes(run.status);
        return <button type="button" key={kind.id} onClick={() => run?.report ? onOpenReport(run) : onRun(kind.id)} disabled={working}>
          <IconShieldCheck aria-hidden="true" /><span><b>{kind.displayName}</b><small>{working ? run.stageLabel || "正在检查" : run?.report ? "查看最近报告" : "按需运行"}</small></span>{run?.report ? <IconCheck aria-hidden="true" /> : working ? <IconRefresh className="spin" aria-hidden="true" /> : null}
        </button>;
      })}
    </section>
    <footer><span>只附带你明确选择的项目内容</span><button type="button" onClick={onOpenMaterials}>查看全部素材{totalMaterials ? `（${totalMaterials}）` : ""}</button></footer>
  </section>;
}
