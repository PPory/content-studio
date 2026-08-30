import { memo, useEffect, useRef, useState } from "react";
import { renderMarkdown } from "../../lib/markdown.js";
import { RunningMark } from "./loaders.jsx";
import { IconCheck, IconCopy, IconFileText, IconPlus, IconPencil, IconRefresh, IconWand } from "../icons.jsx";

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

export const AssistantMessage = memo(function AssistantMessage({ item, attachments = [], capabilities, currentVersion, onRevise, onInsert, onRegenerate, onEdit, latestAssistant = false, latestUser = false, working = false, activity = "", showRuntime = true }) {
  const [copied, copy] = useCopied();
  const [userCopied, copyUser] = useCopied();
  const assistant = item.role === "assistant";
  const stale = assistant && item.documentVersion && currentVersion && item.documentVersion !== currentVersion;
  const sentAttachments = assistant ? [] : attachments.filter((attachment) => item.attachmentIds?.includes(attachment.id));
  if (assistant && !item.text && item.pending) return null;
  return <article className={`assistant-message assistant-message--${assistant ? "assistant" : "user"}`}>
    {/* ⚠️ **自己那条不写「你」。** 靠右 + 深色气泡已经把「谁说的」说完了，
        再挂一行标签是同一件事说两遍；而助手那条要标模型和耗时，标签必须留。 */}
    {/**
      * 身份行。**「✦ AI 助手」那个标签删掉了。**
      *
      * 一栏对话里它每条回复重复一次，而它说的事**屏幕上已经说过了**：
      * 你的话是靠右的灰气泡，它的话是靠左的全宽正文——排版本身就是身份。
      * 一个一屏出现十次、每次都不带新信息的标签，是纯粹的行噪音。
      * （这条以前的注释写着「助手那条要标模型和耗时，标签必须留」——
      * 前半句成立，后半句不成立：要标的是模型，不是「AI 助手」四个字。）
      *
      * ⚠️ **模型和耗时留着，但改成指上去才现形。** 它是回执：
      * 平时不该占版面，而「这条是哪个模型答的、花了多久」在比较两次回答时
      * 是唯一能回答问题的信息，删掉就再也找不回来了。
      * 生成中那条 `__live` **一直可见**——它是状态，不是回执。
      */}
    {assistant && working ? <small><span className="assistant-message__live"><RunningMark size={14} />{activity || "正在生成回答"}</span></small> : null}
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
      {/**
        * 模型和耗时。**排在按钮后面，指到才现形。**
        *
        * 它原来在回复上方、和一枚 ✦ 加「AI 助手」排一行：那四个字每条回复重复一次，
        * 而排版本身已经说清了谁在说话；回执被那个标签带着常驻在最显眼的位置，
        * 它却是「事后想核对时才用得上」的东西。
        *
        * ⚠️ **必须排在按钮后面。** 放前面的那一版即使 `opacity: 0` 也照样占宽度，
        * 于是复制和重新生成两颗被推到了一段回复的**正中间**——
        * 屏幕上是「按钮位置怎么跑了」，而按钮自己一行没改。
        * 透明的东西不占位置，只有当它在末尾时才成立。
        */}
      {showRuntime && (item.model || item.durationMs) ? <em className="assistant-message__runtime">{[item.model, item.durationMs ? `${(item.durationMs / 1000).toFixed(item.durationMs < 10_000 ? 1 : 0)}s` : ""].filter(Boolean).join(" · ")}</em> : null}
    </footer> : null}
  </article>;
});
