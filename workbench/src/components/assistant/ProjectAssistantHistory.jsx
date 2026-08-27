import { IconPlus } from "../icons.jsx";

export function ProjectAssistantHistory({ conversationId, conversationTitle, items, onOpen, onNew }) {
  const recent = items.filter((item) => !item.archivedAt && item.id !== conversationId).slice(0, 5);
  return <section className="project-assistant-history" aria-label="项目会话历史">
    <header><strong>最近会话</strong><button type="button" onClick={onNew}><IconPlus aria-hidden="true" />新对话</button></header>
    <button className="project-assistant-history__current" type="button" aria-current="page">
      <span><i />当前会话</span><b>{conversationTitle || "新对话"}</b>
    </button>
    {recent.length ? <nav aria-label="最近会话">{recent.map((item) => <button type="button" key={item.id} onClick={() => onOpen(item.id)}>
      <b>{item.title || "未命名对话"}</b><small>{item.preview || "还没有消息"}</small>
    </button>)}</nav> : <p>还没有其他会话</p>}
  </section>;
}
