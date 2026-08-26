import { useEffect, useState } from "react";
import { assistantReferenceDocument } from "../lib/assistant-summoner.js";
import { useDialog } from "../lib/use-dialog.js";
import { AssistantPane } from "./assistant/AssistantPane.jsx";
import { IconSparkles, IconX } from "./icons.jsx";
import "./quick-assistant.css";

const EXIT_MS = 140;

export function QuickAssistant({ open, context, conversationId, onConversationChange, onClose, onContinue }) {
  const [rendered, setRendered] = useState(open);
  const [entered, setEntered] = useState(false);
  const [contextAttached, setContextAttached] = useState(true);
  const dialogRef = useDialog(open, onClose, {
    modal: false,
    dismissOnPointerDownOutside: true,
    outsideIgnore: "[data-assistant-summoner]",
  });

  useEffect(() => {
    if (open) {
      setRendered(true);
      const frame = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(frame);
    }
    setEntered(false);
    const timer = setTimeout(() => setRendered(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => setContextAttached(true), [context?.pageType, context?.object?.id]);

  if (!open && !rendered) return null;
  const attachedObject = contextAttached ? context?.object : null;

  return (
    <aside
      className="quick-assistant"
      data-open={open && entered ? "true" : "false"}
      ref={dialogRef}
      role="dialog"
      aria-modal="false"
      aria-label="Quick Assistant"
    >
      <header className="quick-assistant__header">
        <span className="quick-assistant__mark"><IconSparkles aria-hidden="true" /></span>
        <div><strong>AI 助手</strong><small>快速提问</small></div>
        <button type="button" onClick={onClose} title="关闭（Esc）" aria-label="关闭 Quick Assistant"><IconX aria-hidden="true" /></button>
      </header>
      <div className="quick-assistant__context">
        {contextAttached ? (
          <>
            <span><b>当前位置：{context?.label || "工作台"}</b><small>{attachedObject ? `已附带对象：${attachedObject.title || attachedObject.id}` : "未附带页面内容"}</small></span>
            <button type="button" onClick={() => setContextAttached(false)} aria-label="移除当前页面上下文" title="移除当前页面上下文"><IconX aria-hidden="true" /></button>
          </>
        ) : <span><b>未附带当前页面上下文</b><small>对话仍会继续保留</small></span>}
      </div>
      <div className="quick-assistant__body">
        <AssistantPane
          scope="global"
          surface="overlay"
          target={{ kind: "none", editable: false }}
          scopeId="global:assistant"
          document={assistantReferenceDocument(context, contextAttached)}
          initialConversationId={conversationId}
          onConversationChange={onConversationChange}
          draftStorageKey="workbench:quick-assistant-draft:v1"
          onContinue={onContinue}
        />
      </div>
    </aside>
  );
}
