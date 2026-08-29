import { memo, useEffect, useRef, useState } from "react";
import { renderMarkdown } from "../../lib/markdown.js";
import { IconCheck, IconCopy, IconFileText, IconPlus, IconPencil, IconRefresh, IconSparkles, IconWand } from "../icons.jsx";

/**
 * 复制按钮：**点完必须看得见它成功了。**
 * 复制是这一屏最高频的动作之一，而剪贴板本身没有任何可见反馈——
 * 没有回执的话用户的第一反应是再点一次，然后怀疑功能坏了。
 * 用同一颗按钮就地换图标和文案，不弹 toast：toast 要飞到屏幕另一头，
 * 而用户的眼睛此刻就在这颗按钮上。
 */
function useCopied(ms = 1_400) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [copied, (text) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), ms);
  }];
}

export const AssistantMessage = memo(function AssistantMessage({ item, attachments = [], capabilities, currentVersion, onRevise, onInsert, onRegenerate, onEdit, latestAssistant = false, latestUser = false, working = false, activity = "", showRuntime = true, showIdentity = true }) {
  const [copied, copy] = useCopied();
  const [userCopied, copyUser] = useCopied();
  const assistant = item.role === "assistant";
  const stale = assistant && item.documentVersion && currentVersion && item.documentVersion !== currentVersion;
  const sentAttachments = assistant ? [] : attachments.filter((attachment) => item.attachmentIds?.includes(attachment.id));
  if (assistant && !item.text && item.pending) return null;
  return <article className={`assistant-message assistant-message--${assistant ? "assistant" : "user"}`}>
    {/* ⚠️ **自己那条不写「你」。** 靠右 + 深色气泡已经把「谁说的」说完了，
        再挂一行标签是同一件事说两遍；而助手那条要标模型和耗时，标签必须留。 */}
    {/* 身份行：**先说是谁，再说用了什么跑的。**
        原来这行第一个词是「Pi Agent SDK」——把运行时实现摆在整条回复最显眼的位置，
        而用户在这一刻要认的是「这段是 AI 说的」。模型和耗时退到行尾的灰字，
        并且只在完整全局页出现（`showRuntime`）：项目和阅读栏不暴露运行时。 */}
    {assistant && (showIdentity || working) ? <small>{showIdentity ? <><span className="assistant-message__avatar"><IconSparkles aria-hidden="true" /></span><b>AI 助手</b>{showRuntime && (item.model || item.durationMs) ? <em className="assistant-message__runtime">{[item.model, item.durationMs ? `${(item.durationMs / 1000).toFixed(item.durationMs < 10_000 ? 1 : 0)}s` : ""].filter(Boolean).join(" · ")}</em> : null}</> : null}{working ? <span className="assistant-message__live"><i />{activity || "正在生成回答"}</span> : null}</small> : null}
    {assistant ? (working ? <p className="assistant-message__stream">{item.text}</p> : <div className="assistant-message__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text || "") }} />) : <div className="assistant-message__user">{sentAttachments.length ? <div className="assistant-message__attachments">{sentAttachments.map((attachment) => <span key={attachment.id}>{attachment.kind === "image" ? (attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : <span className="assistant-attachment-image">▧</span>) : <IconFileText aria-hidden="true" />}<span>{attachment.name}</span></span>)}</div> : null}{item.text ? <p>{item.text}</p> : null}{item.text ? <footer className="assistant-message__user-actions"><button type="button" data-copied={userCopied ? "true" : undefined} onClick={() => copyUser(item.text)} title={userCopied ? "已复制" : "复制消息"} aria-label={userCopied ? "已复制" : "复制消息"}>{userCopied ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />}</button>{latestUser && !working ? <button type="button" onClick={onEdit} title="编辑并重新发送" aria-label="编辑并重新发送"><IconPencil aria-hidden="true" /></button> : null}</footer> : null}</div>}
    {stale ? <p className="assistant-message__stale">正文已在这条回复之后变化；建议重新生成候选，避免覆盖新内容。</p> : null}
    {/**
      * 动作条**只有图标**。
      *
      * 这条 footer 挂在每一段回复下面，一栏对话里会重复十几次；配上文字之后
      * 「复制 / 作为候选插入 / 重新生成」这排字比它上面那段要读的话还抢眼，
      * 而这三件事的图标都是通用符号，看一眼就知道。说明留在 tooltip 和 aria-label 里，
      * 无障碍不受影响。
      */}
    {assistant && item.text && !working ? <footer className="assistant-message__actions">
      <button data-copied={copied ? "true" : undefined} onClick={() => copy(item.text)} title={copied ? "已复制" : "复制这条回复"} aria-label={copied ? "已复制" : "复制这条回复"}>{copied ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />}</button>
      {capabilities.insertCandidate ? <button onClick={() => onInsert(item.text)} disabled={stale} title={stale ? "正文版本已变化，请重新生成" : "插到光标处，带底纹，点别处即落定"} aria-label="插入正文"><IconPlus aria-hidden="true" /></button> : null}
      {capabilities.reviseSelection ? <button onClick={() => onRevise(item.text)} disabled={stale} title={stale ? "正文版本已变化，请重新生成" : "按这条建议改写选中的文字"} aria-label="按建议改选区"><IconWand aria-hidden="true" /></button> : null}
      {latestAssistant ? <button onClick={onRegenerate} title="用相同问题重新生成" aria-label="重新生成"><IconRefresh aria-hidden="true" /></button> : null}
    </footer> : null}
  </article>;
});
