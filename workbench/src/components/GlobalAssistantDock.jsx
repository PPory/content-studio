import { AssistantPane } from "./ProjectAssistantRail.jsx";
import { IconLayoutSidebarRight, IconSparkles, IconX } from "./icons.jsx";
import "./global-assistant-dock.css";

export function AssistantDockToggle({ open, onClick }) {
  return (
    <button
      className="topbar__icon assistant-dock-toggle"
      type="button"
      onClick={onClick}
      aria-label={open ? "关闭 AI 助手" : "打开 AI 助手"}
      aria-pressed={open}
      title={open ? "关闭右侧 AI 助手" : "在右侧打开 AI 助手"}
    >
      <IconLayoutSidebarRight aria-hidden="true" stroke={1.7} />
    </button>
  );
}

export function GlobalAssistantDock({ onClose }) {
  return (
    <aside className="global-assistant-dock" aria-label="AI 助手">
      <header className="global-assistant-dock__head">
        <span><IconSparkles aria-hidden="true" /><b>AI 助手</b></span>
        <button type="button" onClick={onClose} aria-label="关闭 AI 助手" title="关闭"><IconX aria-hidden="true" /></button>
      </header>
      <AssistantPane scopeId="global:assistant" document={{}} standalone docked />
    </aside>
  );
}
