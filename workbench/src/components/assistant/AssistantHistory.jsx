import { useState } from "react";
import { IconDots, IconPin, IconTrash } from "@tabler/icons-react";
import { IconArchive, IconPencil, IconSearch, IconX } from "../icons.jsx";
import { RunningMark } from "./loaders.jsx";
import { conversationStamp, groupConversationsByTime } from "../../lib/conversation-groups.js";
import { useClearDissolve } from "../../lib/use-clear-dissolve.js";
import "../clear-dissolve.css";

export function AssistantHistory({
  visibleConversations,
  historyView,
  historyMenuId,
  historyDeleteId,
  historyPending,
  renameId,
  renameValue,
  conversationId,
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
  const [query, setQuery] = useState("");
  // 和别处的搜索框同一套清空手感（见 `lib/use-clear-dissolve.js`）
  const { wrapRef: clearWrapRef, clear: clearQuery } = useClearDissolve(() => setQuery(""));
  /**
   * ⚠️ **这一栏顶上不再写一遍「历史对话」，也不再放第二颗「新对话」。**
   * 打开它的那颗按钮上就写着「历史对话」四个字，栏里再写一遍是同一个词一屏说两遍；
   * 而「新对话」在页头已经有一颗了——同一个动作两个入口，用户还得先想它俩是不是一回事
   * （上一版这两颗的 aria-label 甚至一个叫「新对话」一个叫「新建对话」）。
   * 省下来的那一行给**搜索**：会话攒到几十条之后，靠一路翻标题找不回来。
   */
  const matched = query.trim()
    ? visibleConversations.filter((item) => `${item.title || ""} ${item.preview || ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    : visibleConversations;
  return <aside className="assistant-history" aria-label="历史对话">
    <header>
      <label className="assistant-history__search t-clear" ref={clearWrapRef}>
        <IconSearch aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话" aria-label="搜索历史会话" />
        {query ? <button type="button" onClick={() => clearQuery(query)} aria-label="清空搜索"><IconX aria-hidden="true" /></button> : null}
      </label>
    </header>
    <div className="assistant-history__filters" role="tablist" aria-label="历史范围"><button type="button" role="tab" aria-selected={historyView === "recent"} onClick={() => onHistoryView("recent")}>最近</button><button type="button" role="tab" aria-selected={historyView === "archived"} onClick={() => onHistoryView("archived")}>已归档</button></div>
    <nav>{matched.length ? groupConversationsByTime(matched).map(([bucket, group]) => <section className="assistant-history__group" key={bucket}><h4>{bucket}</h4>{group.map((item) => <div className="assistant-history__item" key={item.id} data-current={item.id === conversationId ? "true" : undefined}>
      {renameId === item.id ? <form className="assistant-history__rename" onSubmit={(event) => { event.preventDefault(); onSubmitRename(item); }}><input data-rename-id={item.id} value={renameValue} onChange={(event) => onRenameValue(event.target.value)} onBlur={onCancelRename} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancelRename(); } }} aria-label="新的对话名称" /></form> : <button className="assistant-history__open" type="button" aria-current={item.id === conversationId ? "page" : undefined} onClick={() => onOpenConversation(item.id)}>{/* ⚠️ **不再挂一行预览。** 标题就是从首条消息生成的，预览也是首条消息——
    一屏会话每条都把同一句话写两遍，行高翻倍、信息量不变，
    而扫一列会话时真正在扫的是标题。第二行只留给**真信息**：这条还在后台跑。 */}
<b><span>{item.title}</span>{item.pinnedAt ? <IconPin aria-label="已置顶" /> : null}</b>{item.activeTurn?.status === "running" ? <small><span className="assistant-history__running"><RunningMark /></span>{item.activeTurn.stage || "后台运行中"}</small> : null}<time>{conversationStamp(item, bucket)}</time></button>}
      <button className="assistant-history__more" type="button" onClick={() => onHistoryMenu(item.id)} aria-expanded={historyMenuId === item.id} aria-label={`管理对话：${item.title}`}><IconDots aria-hidden="true" /></button>
      {historyMenuId === item.id ? <div className="assistant-history__menu" role="menu">
        {historyDeleteId === item.id ? <div className="assistant-history__delete-confirm" role="alert"><p>永久删除“{item.title || "这段对话"}”？<small>正文、附件和 Pi 会话记录都会移除，删除后无法恢复。</small></p><div><button type="button" className="is-danger" onClick={() => onManageHistory(item, "delete")} disabled={Boolean(historyPending)}>永久删除</button><button type="button" onClick={() => onHistoryDelete("")} disabled={Boolean(historyPending)}>取消</button></div></div> : <>
          <button type="button" role="menuitem" onClick={() => onStartRename(item)} disabled={item.activeTurn?.status === "running"}><IconPencil aria-hidden="true" />重命名</button>
          {!item.archivedAt ? <button type="button" role="menuitem" onClick={() => onManageHistory(item, item.pinnedAt ? "unpin" : "pin")} disabled={item.activeTurn?.status === "running"}><IconPin aria-hidden="true" />{item.pinnedAt ? "取消置顶" : "置顶聊天"}</button> : null}
          <button type="button" role="menuitem" onClick={() => onManageHistory(item, item.archivedAt ? "restore" : "archive")} disabled={item.activeTurn?.status === "running"}><IconArchive aria-hidden="true" />{item.archivedAt ? "移出归档" : "归档"}</button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => onHistoryDelete(item.id)} disabled={item.activeTurn?.status === "running"}><IconTrash aria-hidden="true" />删除</button>
        </>}
      </div> : null}
    </div>)}</section>) : <p className="assistant-history__empty">{query.trim() ? `没有匹配“${query.trim()}”的会话` : historyView === "archived" ? "还没有归档对话" : "还没有历史对话"}</p>}</nav>
  </aside>;
}
