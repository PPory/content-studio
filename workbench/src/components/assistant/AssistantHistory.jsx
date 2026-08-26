import { IconDots, IconPin, IconTrash } from "@tabler/icons-react";
import { IconArchive, IconPencil, IconPlus } from "../icons.jsx";

export function AssistantHistory({
  visibleConversations,
  historyView,
  historyMenuId,
  historyDeleteId,
  historyPending,
  renameId,
  renameValue,
  conversationId,
  onNewConversation,
  onHistoryView,
  onOpenConversation,
  onHistoryMenu,
  onHistoryDelete,
  onRenameValue,
  onCancelRename,
  onSubmitRename,
  onStartRename,
  onManageHistory,
}) {
  return <aside className="assistant-history" aria-label="历史对话">
    <header><strong>历史对话</strong><button onClick={onNewConversation} title="新建对话" aria-label="新建对话"><IconPlus aria-hidden="true" /></button></header>
    <div className="assistant-history__filters" role="tablist" aria-label="历史范围"><button type="button" role="tab" aria-selected={historyView === "recent"} onClick={() => onHistoryView("recent")}>最近</button><button type="button" role="tab" aria-selected={historyView === "archived"} onClick={() => onHistoryView("archived")}>已归档</button></div>
    <nav>{visibleConversations.length ? visibleConversations.map((item) => <div className="assistant-history__item" key={item.id} data-current={item.id === conversationId ? "true" : undefined}>
      {renameId === item.id ? <form className="assistant-history__rename" onSubmit={(event) => { event.preventDefault(); onSubmitRename(item); }}><input data-rename-id={item.id} value={renameValue} onChange={(event) => onRenameValue(event.target.value)} onBlur={onCancelRename} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancelRename(); } }} aria-label="新的对话名称" /></form> : <button className="assistant-history__open" type="button" aria-current={item.id === conversationId ? "page" : undefined} onClick={() => onOpenConversation(item.id)}><b><span>{item.title}</span>{item.pinnedAt ? <IconPin aria-label="已置顶" /> : null}</b><small>{item.activeTurn?.status === "running" ? <><i className="assistant-history__running" />{item.activeTurn.stage || "后台运行中"}</> : item.preview || "还没有消息"}</small><time>{new Date(item.updatedAt || item.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</time></button>}
      <button className="assistant-history__more" type="button" onClick={() => onHistoryMenu(item.id)} aria-expanded={historyMenuId === item.id} aria-label={`管理对话：${item.title}`}><IconDots aria-hidden="true" /></button>
      {historyMenuId === item.id ? <div className="assistant-history__menu" role="menu">
        {historyDeleteId === item.id ? <div className="assistant-history__delete-confirm" role="alert"><p>删除“{item.title || "这段对话"}”？<small>原始记录会移入本地回收目录。</small></p><div><button type="button" className="is-danger" onClick={() => onManageHistory(item, "delete")} disabled={Boolean(historyPending)}>确认删除</button><button type="button" onClick={() => onHistoryDelete("")} disabled={Boolean(historyPending)}>取消</button></div></div> : <>
          <button type="button" role="menuitem" onClick={() => onStartRename(item)} disabled={item.activeTurn?.status === "running"}><IconPencil aria-hidden="true" />重命名</button>
          {!item.archivedAt ? <button type="button" role="menuitem" onClick={() => onManageHistory(item, item.pinnedAt ? "unpin" : "pin")} disabled={item.activeTurn?.status === "running"}><IconPin aria-hidden="true" />{item.pinnedAt ? "取消置顶" : "置顶聊天"}</button> : null}
          <button type="button" role="menuitem" onClick={() => onManageHistory(item, item.archivedAt ? "restore" : "archive")} disabled={item.activeTurn?.status === "running"}><IconArchive aria-hidden="true" />{item.archivedAt ? "移出归档" : "归档"}</button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => onHistoryDelete(item.id)} disabled={item.activeTurn?.status === "running"}><IconTrash aria-hidden="true" />删除</button>
        </>}
      </div> : null}
    </div>) : <p className="assistant-history__empty">{historyView === "archived" ? "还没有归档对话" : "还没有历史对话"}</p>}</nav>
  </aside>;
}
