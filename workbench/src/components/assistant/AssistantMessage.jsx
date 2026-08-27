import { memo } from "react";
import { renderMarkdown } from "../../lib/markdown.js";
import { IconCopy, IconFileText, IconPlus, IconPencil, IconRefresh, IconSparkles } from "../icons.jsx";

export const AssistantMessage = memo(function AssistantMessage({ item, attachments = [], capabilities, currentVersion, onRevise, onInsert, onRegenerate, onEdit, latestAssistant = false, latestUser = false, working = false, activity = "", showRuntime = true, showIdentity = true }) {
  const assistant = item.role === "assistant";
  const stale = assistant && item.documentVersion && currentVersion && item.documentVersion !== currentVersion;
  const sentAttachments = assistant ? [] : attachments.filter((attachment) => item.attachmentIds?.includes(attachment.id));
  if (assistant && !item.text && item.pending) return null;
  return <article className={`assistant-message assistant-message--${assistant ? "assistant" : "user"}`}>
    {/* ⚠️ **自己那条不写「你」。** 靠右 + 深色气泡已经把「谁说的」说完了，
        再挂一行标签是同一件事说两遍；而助手那条要标模型和耗时，标签必须留。 */}
    {assistant && (showIdentity || working) ? <small>{showIdentity ? <><span className="assistant-message__avatar"><IconSparkles aria-hidden="true" /></span>{showRuntime ? <>Pi Agent SDK{item.model ? ` · ${item.model}` : ""}{item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(item.durationMs < 10_000 ? 1 : 0)}s` : ""}</> : "协作回复"}</> : null}{working ? <span className="assistant-message__live"><i />{activity || "正在生成回答"}</span> : null}</small> : null}
    {assistant ? (working ? <p className="assistant-message__stream">{item.text}</p> : <div className="assistant-message__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text || "") }} />) : <div className="assistant-message__user">{sentAttachments.length ? <div className="assistant-message__attachments">{sentAttachments.map((attachment) => <span key={attachment.id}>{attachment.kind === "image" ? (attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : <span className="assistant-attachment-image">▧</span>) : <IconFileText aria-hidden="true" />}<span>{attachment.name}</span></span>)}</div> : null}{item.text ? <p>{item.text}</p> : null}{item.text ? <footer className="assistant-message__user-actions"><button type="button" onClick={() => navigator.clipboard?.writeText(item.text)} title="复制消息" aria-label="复制消息"><IconCopy aria-hidden="true" /></button>{latestUser && !working ? <button type="button" onClick={onEdit} title="编辑并重新发送" aria-label="编辑并重新发送"><IconPencil aria-hidden="true" /></button> : null}</footer> : null}</div>}
    {stale ? <p className="assistant-message__stale">正文已在这条回复之后变化；建议重新生成候选，避免覆盖新内容。</p> : null}
    {assistant && item.text && !working ? <footer>
      <button onClick={() => navigator.clipboard?.writeText(item.text)} title="复制这条回复"><IconCopy aria-hidden="true" />复制</button>
      {capabilities.insertCandidate ? <button onClick={() => onInsert(item.text)} disabled={stale} title={stale ? "正文版本已变化，请重新生成" : "插入后会带底纹，仍需确认采用"}><IconPlus aria-hidden="true" />作为候选插入</button> : null}
      {capabilities.reviseSelection ? <button onClick={() => onRevise(item.text)} disabled={stale} title={stale ? "正文版本已变化，请重新生成" : "按这条建议生成选区改写候选"}><IconRefresh aria-hidden="true" />按建议改选区</button> : null}
      {latestAssistant ? <button onClick={onRegenerate} title="用相同问题重新生成"><IconRefresh aria-hidden="true" />重新生成</button> : null}
    </footer> : null}
  </article>;
});
