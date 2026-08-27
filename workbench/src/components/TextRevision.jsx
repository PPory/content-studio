import { useEffect, useRef, useState } from "react";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconBulb,
  IconCheck,
  IconLoader2,
  IconPencil,
  IconRefresh,
  IconSend,
  IconShieldCheck,
  IconSparkles,
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

export function CursorWritingMenu({ anchor, state, onRun, onClose }) {
  const [custom, setCustom] = useState(false);
  const [instruction, setInstruction] = useState("");
  const firstRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => { (custom ? inputRef : firstRef).current?.focus(); }, [custom]);
  useEffect(() => {
    const close = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseRef.current();
    };
    const closeOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) onCloseRef.current();
    };
    window.addEventListener("keydown", close, true);
    document.addEventListener("pointerdown", closeOutside, true);
    return () => {
      window.removeEventListener("keydown", close, true);
      document.removeEventListener("pointerdown", closeOutside, true);
    };
  }, []);

  const generate = () => {
    const value = instruction.trim();
    if (!value) return inputRef.current?.focus();
    onRun("paragraph", value);
  };

  return (
    <div
      ref={menuRef}
      className="text-revision-menu cursor-writing-menu"
      data-placement={anchor.placement}
      data-kind="cursor"
      style={{ left: anchor.left, top: anchor.top }}
      role="dialog"
      aria-label="光标处 AI 写作"
      onMouseDown={(event) => { if (!event.target.closest("input")) event.preventDefault(); }}
    >
      <div className="text-revision-menu__actions" role="toolbar" aria-label="光标写作方式">
        <button ref={firstRef} type="button" onClick={() => onRun("nudge", "")} title="围绕光标给一个最值得继续思考的问题">
          <IconBulb aria-hidden="true" stroke={1.7} /><span>想一想</span>
        </button>
        <button type="button" onClick={() => onRun("paragraph", "")} title="结合上下文在当前光标生成一段正文候选">
          <IconSparkles aria-hidden="true" stroke={1.7} /><span>续写</span>
        </button>
        <button type="button" data-on={custom || undefined} onClick={() => setCustom(true)} title="说明要写什么，再生成正文候选">
          <IconPencil aria-hidden="true" stroke={1.7} /><span>生成</span>
        </button>
        <button className="text-revision-menu__close" type="button" onClick={onClose} aria-label="关闭光标写作工具" title="关闭">
          <IconX aria-hidden="true" stroke={1.7} />
        </button>
      </div>
      {custom ? (
        <div className="text-revision-menu__command">
          <input
            ref={inputRef}
            value={instruction}
            maxLength={500}
            placeholder="说明这一段要写什么，例如：补一个克制的过渡段"
            aria-label="光标生成要求"
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); generate(); } }}
          />
          <button type="button" onClick={generate} aria-label="生成正文候选" title="生成正文候选">
            <IconSend aria-hidden="true" stroke={1.8} />
          </button>
        </div>
      ) : null}
      {state.busy ? <div className="cursor-writing-menu__status"><IconLoader2 className="spin" aria-hidden="true" /><span>{state.mode === "nudge" ? "正在找下一步…" : "正在生成正文候选…"}</span></div> : null}
      {state.error ? <div className="cursor-writing-menu__error"><strong>{state.error.message}</strong>{state.error.hint ? <small>{state.error.hint}</small> : null}</div> : null}
      {state.result ? <div className="cursor-writing-menu__result"><small>{state.result.kind || "下一步"}</small><p>{state.result.text}</p><button type="button" onClick={() => onRun("nudge", "")} title="再给一个角度"><IconRefresh aria-hidden="true" />再想一个</button></div> : null}
      <small className="cursor-writing-menu__hint">Alt+Enter 唤起 · 生成结果先进入候选</small>
    </div>
  );
}

export function SelectionRevisionMenu({ selection, onRun, onClose }) {
  const [customMode, setCustomMode] = useState("");
  const [instruction, setInstruction] = useState("");
  const inputRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (customMode) inputRef.current?.focus();
  }, [customMode]);
  useEffect(() => {
    const close = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    const closeOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) onClose();
    };
    window.addEventListener("keydown", close, true);
    document.addEventListener("pointerdown", closeOutside, true);
    return () => {
      window.removeEventListener("keydown", close, true);
      document.removeEventListener("pointerdown", closeOutside, true);
    };
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
      ref={menuRef}
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
