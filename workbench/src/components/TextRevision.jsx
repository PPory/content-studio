import { useEffect, useRef, useState } from "react";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconCheck,
  IconLoader2,
  IconPencil,
  IconRefresh,
  IconSend,
  IconShieldCheck,
  IconWand,
  IconX,
} from "./icons.jsx";
import "./text-revision.css";

export const REVISION_ACTIONS = [
  { mode: "polish", label: "润色", icon: IconWand, custom: true, hint: "保持原意，让表达更自然流畅" },
  { mode: "correct", label: "纠错", icon: IconShieldCheck, hint: "只修表述、语法、用词和标点" },
  { mode: "shorten", label: "缩写", icon: IconArrowsMinimize, hint: "压缩篇幅，保留关键信息" },
  { mode: "expand", label: "扩写", icon: IconArrowsMaximize, hint: "补足解释和过渡，不编造事实" },
  { mode: "rewrite", label: "改写", icon: IconPencil, custom: true, required: true, hint: "按具体指令重新表达" },
];

export const revisionLabel = (mode) => REVISION_ACTIONS.find((item) => item.mode === mode)?.label || "修订";

export function SelectionRevisionMenu({ selection, onRun, onClose }) {
  const [customMode, setCustomMode] = useState("");
  const [instruction, setInstruction] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (customMode) inputRef.current?.focus();
  }, [customMode]);
  useEffect(() => {
    const close = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [onClose]);

  const choose = (action) => {
    if (action.custom) {
      setCustomMode(action.mode);
      setInstruction("");
    } else onRun(action.mode, "");
  };
  const submit = () => {
    if (customMode === "rewrite" && !instruction.trim()) return inputRef.current?.focus();
    onRun(customMode, instruction.trim());
  };

  return (
    <div
      className="text-revision-menu"
      data-placement={selection.placement}
      style={{ left: selection.left, top: selection.top }}
      role="dialog"
      aria-label="AI 局部修订"
      onMouseDown={(event) => {
        if (!event.target.closest("input")) event.preventDefault();
      }}
    >
      <div className="text-revision-menu__actions" role="toolbar" aria-label="修订方式">
        {REVISION_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button key={action.mode} data-on={customMode === action.mode ? "true" : undefined} onClick={() => choose(action)} title={action.hint}>
              <Icon aria-hidden="true" stroke={1.7} /><span>{action.label}</span>
            </button>
          );
        })}
        <button className="text-revision-menu__close" onClick={onClose} aria-label="关闭修订工具" title="关闭">
          <IconX aria-hidden="true" stroke={1.7} />
        </button>
      </div>
      {customMode ? (
        <div className="text-revision-menu__command">
          <input
            ref={inputRef}
            value={instruction}
            maxLength={500}
            placeholder={customMode === "rewrite" ? "输入具体改写要求，例如：换成第一人称" : "可选：更口语、更克制、更专业……"}
            aria-label={customMode === "rewrite" ? "改写要求" : "润色要求"}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
          />
          <button onClick={submit} aria-label={`开始${revisionLabel(customMode)}`} title={`开始${revisionLabel(customMode)}`}>
            <IconSend aria-hidden="true" stroke={1.8} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function RevisionReviewCard({ revision, persistenceError, onCandidate, onRegenerate, onAdopt, onDiscard }) {
  const [instruction, setInstruction] = useState(revision.instruction || "");
  useEffect(() => setInstruction(revision.instruction || ""), [revision.id, revision.instruction]);
  const regenerate = () => {
    if (revision.mode === "rewrite" && !instruction.trim()) return;
    onRegenerate(instruction.trim());
  };
  return (
    <section className="text-revision-review" aria-label={`${revision.label}候选`} aria-live="polite">
      <header>
        <span><b>{revision.label}</b><small>原文暂未替换</small></span>
        <span>{revision.generations?.length ? `第 ${revision.generations.length} 版` : "生成中"}</span>
      </header>
      {revision.busy ? (
        <div className="text-revision-review__loading"><IconLoader2 className="spin" aria-hidden="true" /><span>正在保持原意，生成可比较的新版本…</span></div>
      ) : revision.error ? (
        <div className="text-revision-review__error"><b>{revision.error.message}</b>{revision.error.hint ? <small>{revision.error.hint}</small> : null}<button onClick={regenerate}>重试</button></div>
      ) : (
        <textarea
          value={revision.candidate}
          onChange={(event) => onCandidate(event.target.value)}
          aria-label="AI 修订候选，可直接编辑"
          rows={Math.min(12, Math.max(3, revision.candidate.split("\n").length + 1))}
        />
      )}
      <footer>
        <div className="text-revision-review__command">
          <input
            value={instruction}
            maxLength={500}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={revision.mode === "rewrite" ? "调整改写要求后重新生成" : "可补充具体要求后重新生成"}
            aria-label="调整修订要求"
          />
          <button onClick={regenerate} disabled={revision.busy || (revision.mode === "rewrite" && !instruction.trim())} title="按当前要求重新生成" aria-label="重新生成">
            <IconRefresh aria-hidden="true" stroke={1.7} />
          </button>
        </div>
        <div className="text-revision-review__decide">
          <button onClick={onDiscard} disabled={revision.busy}>弃用</button>
          <button className="is-primary" onClick={onAdopt} disabled={revision.busy || !revision.candidate.trim()}><IconCheck aria-hidden="true" />采纳</button>
        </div>
      </footer>
      <small className={`text-revision-review__note${persistenceError ? " is-bad" : ""}`}>
        {persistenceError ? `修订历史未保存：${persistenceError}` : "内容由 AI 生成 · 采纳前不会写入正文"}
      </small>
    </section>
  );
}
