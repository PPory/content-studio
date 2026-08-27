import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { placeInlineAiMenu } from "../lib/inline-ai-positioning.js";
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

function isCompositionEvent(event) {
  return event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229;
}

function moveToolbarFocus(event, menuRef) {
  if (isCompositionEvent(event) || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const actions = [...(menuRef.current?.querySelectorAll('[data-inline-ai-action="true"]:not(:disabled)') || [])];
  if (!actions.length) return;
  const current = actions.indexOf(document.activeElement);
  const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? actions.length - 1
      : current < 0
        ? (backwards ? actions.length - 1 : 0)
        : (current + (backwards ? -1 : 1) + actions.length) % actions.length;
  event.preventDefault();
  actions[next]?.focus();
}

function useInlineAiMenu({ anchor, menuRef, focusRef, onClose, autoFocus = true }) {
  const [position, setPosition] = useState(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node || !anchor?.anchorRect || !anchor?.boundaryRect) return;
    const update = () => {
      const menuRect = node.getBoundingClientRect();
      setPosition(placeInlineAiMenu({
        anchorRect: anchor.anchorRect,
        boundaryRect: anchor.boundaryRect,
        menuRect: { width: menuRect.width, height: menuRect.height },
        preferredPlacement: anchor.preferredPlacement,
      }));
    };
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [anchor, menuRef]);

  useLayoutEffect(() => {
    if (!autoFocus) return undefined;
    const focus = () => focusRef.current?.focus({ preventScroll: true });
    focus();
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, focusRef]);
  useEffect(() => {
    const close = (event) => {
      if (isCompositionEvent(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current({ restoreFocus: true });
        return;
      }
      if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !menuRef.current?.contains(document.activeElement)) {
        moveToolbarFocus(event, menuRef);
      }
    };
    const closeOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) onCloseRef.current({ restoreFocus: false });
    };
    window.addEventListener("keydown", close, true);
    document.addEventListener("pointerdown", closeOutside, true);
    return () => {
      window.removeEventListener("keydown", close, true);
      document.removeEventListener("pointerdown", closeOutside, true);
    };
  }, [menuRef]);

  return position;
}

export function CursorWritingMenu({ anchor, state, onRun, onClose }) {
  const [custom, setCustom] = useState(false);
  const [instruction, setInstruction] = useState("");
  const firstRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const position = useInlineAiMenu({ anchor, menuRef, focusRef: custom ? inputRef : firstRef, onClose });

  const generate = () => {
    const value = instruction.trim();
    if (!value) return inputRef.current?.focus();
    onRun("paragraph", value);
  };

  return (
    <div
      ref={menuRef}
      className="text-revision-menu cursor-writing-menu"
      data-placement={position?.placement}
      data-kind="cursor"
      style={position
        ? { left: position.left, top: position.top, maxWidth: position.maxWidth, maxHeight: position.maxHeight }
        : { left: 0, top: 0, visibility: "hidden" }}
      role="dialog"
      aria-label="光标处 AI 写作"
      onMouseDown={(event) => { if (!event.target.closest("input")) event.preventDefault(); }}
    >
      <div className="text-revision-menu__actions" role="toolbar" aria-label="光标写作方式" onKeyDown={(event) => moveToolbarFocus(event, menuRef)}>
        <button ref={firstRef} type="button" data-inline-ai-action="true" onClick={() => onRun("nudge", "")} title="围绕光标给一个最值得继续思考的问题">
          <IconBulb aria-hidden="true" stroke={1.7} /><span>想一想</span>
        </button>
        <button type="button" data-inline-ai-action="true" onClick={() => onRun("paragraph", "")} title="结合上下文在当前光标生成一段正文候选">
          <IconSparkles aria-hidden="true" stroke={1.7} /><span>续写</span>
        </button>
        <button type="button" data-inline-ai-action="true" data-on={custom || undefined} onClick={() => setCustom(true)} title="说明要写什么，再生成正文候选">
          <IconPencil aria-hidden="true" stroke={1.7} /><span>按要求写</span>
        </button>
        <button className="text-revision-menu__close" type="button" onClick={() => onClose({ restoreFocus: true })} aria-label="关闭光标写作工具" title="关闭">
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
            onKeyDown={(event) => { if (!isCompositionEvent(event) && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); generate(); } }}
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
  const firstRef = useRef(null);
  const menuRef = useRef(null);
  const position = useInlineAiMenu({ anchor: selection, menuRef, focusRef: customMode ? inputRef : firstRef, onClose, autoFocus: Boolean(customMode) });

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
      data-placement={position?.placement}
      style={position
        ? { left: position.left, top: position.top, maxWidth: position.maxWidth, maxHeight: position.maxHeight }
        : { left: 0, top: 0, visibility: "hidden" }}
      role="dialog"
      aria-label="AI 局部修订"
      onMouseDown={(event) => {
        if (!event.target.closest("input")) event.preventDefault();
      }}
    >
      <div className="text-revision-menu__actions" role="toolbar" aria-label="修订方式" onKeyDown={(event) => moveToolbarFocus(event, menuRef)}>
        {REVISION_ACTIONS.map((action, index) => {
          const Icon = action.icon;
          return (
            <button ref={index === 0 ? firstRef : undefined} key={action.mode} data-inline-ai-action="true" data-on={customMode === action.mode ? "true" : undefined} onClick={() => choose(action)} title={action.hint}>
              <Icon aria-hidden="true" stroke={1.7} /><span>{action.label}</span>
            </button>
          );
        })}
        <button className="text-revision-menu__close" onClick={() => onClose({ restoreFocus: true })} aria-label="关闭修订工具" title="关闭">
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
            onKeyDown={(event) => { if (!isCompositionEvent(event) && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
          />
          <button onClick={submit} aria-label={`开始${revisionLabel(customMode)}`} title={`开始${revisionLabel(customMode)}`}>
            <IconSend aria-hidden="true" stroke={1.8} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
