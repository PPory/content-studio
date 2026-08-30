import { useEffect, useState } from "react";
import { IconDatabase, IconFileText, IconSearch, IconShieldCheck, IconSparkles } from "../icons.jsx";
import { ActionCard } from "./ActionCard.jsx";
import { AssistantMessage } from "./AssistantMessage.jsx";
import { ThinkingLine } from "./ThinkingLine.jsx";

function elapsedSeconds(startedAt) {
  const value = Date.parse(startedAt || "");
  return Number.isFinite(value) ? Math.max(0, Math.floor((Date.now() - value) / 1_000)) : 0;
}

function elapsedLabel(seconds) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function actionFingerprint(action) {
  if (!action || action.status !== "pending") return "";
  return JSON.stringify([action.type, action.title, action.platform, action.path, action.command, action.audience, action.viewpoint, action.body]);
}

export function dedupeConsecutiveActionIds(actionIds = [], actions = []) {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const visible = [];
  let previousFingerprint = "";
  for (const id of actionIds) {
    const fingerprint = actionFingerprint(byId.get(id));
    if (fingerprint && fingerprint === previousFingerprint) visible[visible.length - 1] = id;
    else visible.push(id);
    previousFingerprint = fingerprint;
  }
  return visible;
}

export function Working({ label = "Pi 正在处理", detail = "", startedAt = "" }) {
  const [seconds, setSeconds] = useState(() => elapsedSeconds(startedAt));
  useEffect(() => {
    setSeconds(elapsedSeconds(startedAt));
    const timer = setInterval(() => setSeconds(startedAt ? elapsedSeconds(startedAt) : (value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const stage = detail || (seconds < 3 ? "正在读取上下文" : seconds < 12 ? "正在组织回答" : "正在等待模型返回");
  /**
   * ⚠️ **阶段那一行换成会动的**（`ThinkingLine`），秒数留在它右边不动。
   * 秒数在跳、阶段在换、微光在扫——三样都动的话读不出哪个是主信息；
   * 秒数是**唯一一个精确的数**，它必须是静止可读的那一个。
   */
  return <div className="assistant-working"><span className="assistant-orbit" aria-hidden="true"><i /></span><div><b>{label}</b><small><ThinkingLine text={stage} sizer="正在等待模型返回" /> · {elapsedLabel(seconds)}</small>{seconds >= 20 ? <em>可以离开此页，任务会在后台继续</em> : null}</div></div>;
}

/**
 * 空态拆成两半，中间夹着输入器：
 *
 *   问候（`EmptyAssistant`）
 *   输入器            ← 由 AssistantPane 摆在中间
 *   入口卡（`AssistantStarters`）
 *
 * ⚠️ **为什么不把卡片留在问候里、让输入器继续钉底。**
 * 那样首屏是「问候 + 卡片」一组在上、输入器孤零零在最下，中间空一大段：
 * 读完「今天想一起想清什么？」，眼睛还得往下跳过一片空白才找到能打字的地方。
 * 而这一屏用户要做的第一件事就是打字——输入器该在视线落点上，不在角落里。
 *
 * 卡片放在输入器**下面**而不是上面：它们是「不知道说什么时的备选」，
 * 优先级低于直接开口。上面是主路径，下面是兜底，顺序就是优先级。
 */
function starterActions(scope) {
  const reading = scope === "reading";
  return scope === "global" ? [
    { icon: IconDatabase, title: "从知识库找关联", detail: "串起书、笔记和近期内容", prompt: "搜索我的知识库，看看最近记录的内容之间有什么关联" },
    { icon: IconSearch, title: "联网核查一个事实", detail: "搜公开来源，把证据边界说清", prompt: "我想核查一个事实，请先问我要查什么" },
    { icon: IconSparkles, title: "让专家一起分析", detail: "从写作、素材或品控角度进入", prompt: "我有一个问题想让专家一起分析，请先问我问题是什么" },
  ] : reading ? [
    { icon: IconFileText, title: "梳理这份文档", detail: "概括核心观点与论证关系", prompt: "请梳理这份文档的核心观点和论证关系" },
    { icon: IconSearch, title: "带着问题深读", detail: "结合全文回答，不改动原文", prompt: "我想围绕这份文档继续深读，请先问我最关心什么" },
  ] : [
    { icon: IconShieldCheck, title: "先看一个关键问题", detail: "找出当前稿件最值得先解决的一处", prompt: "帮我看看这篇文章现在最需要解决的一个问题" },
    { icon: IconFileText, title: "给下一步方向", detail: "结合全文，判断下一段最值得写什么", prompt: "结合当前内容，告诉我下一段最值得写什么" },
  ];
}

/** 输入器**下面**那排入口卡。由 AssistantPane 在空态时渲染。 */
export function AssistantStarters({ onPrompt, scope }) {
  return <div className="assistant-empty__actions" data-scope={scope}>
    {starterActions(scope).map((action) => <button type="button" key={action.title} onClick={() => onPrompt(action.prompt)}>
      <action.icon aria-hidden="true" />
      <span><b>{action.title}</b><small>{action.detail}</small></span>
    </button>)}
  </div>;
}

function EmptyAssistant({ scope }) {
  const reading = scope === "reading";
  const heading = scope === "global" ? "今天想一起想清什么？" : reading ? "想从这份文档看清什么？" : "这篇内容，下一步做什么？";
  /**
   * ⚠️ **全局这一档没有注脚。**
   *
   * 原来那句是「直接开始对话，或从下面挑一个更明确的入口」——它把屏幕上
   * **已经看得见**的两件事（一个光标在闪的输入框、三张写着字的卡）又说了一遍。
   * 阅读和项目那两档的注脚留着，因为它们说的是看不见的事：
   * AI 会读到什么、以及它不会动你的正文。**说明只在有东西要说明时才写。**
   */
  const description = reading
    ? "它会读取当前文档与选区；回答只作为阅读参考，不会修改原文。"
    : scope === "global" ? "" : "它会读取当前全文与选区；任何改写都先给候选，由你决定是否采用。";
  return <div className="assistant-empty" data-scope={scope}>
    <span className="assistant-empty__mark"><IconSparkles aria-hidden="true" /></span>
    <h3>{heading}</h3>
    {description ? <p>{description}</p> : null}
  </div>;
}

export function AssistantThread({
  messages,
  actions,
  attachments,
  busy,
  loading,
  error,
  activity,
  turnStartedAt,
  scope,
  showRuntime = true,
  policy,
  target,
  currentVersion,
  onPrompt,
  onPrefill,
  onRegenerate,
  onEdit,
  onApplyAction,
  onRejectAction,
  onRetry,
  starters,
  endRef,
}) {
  const latestUserId = [...messages].reverse().find((item) => item.role === "user")?.id;
  const latestAssistantId = [...messages].reverse().find((item) => item.role === "assistant" && item.text)?.id;
  return <div className="assistant-thread">
    {/* 侧栏的入口卡跟着空态问候留在消息区里（输入器贴底，卡在它上面）；
        完整页的那三张由 AssistantPane 摆在输入器下面。 */}
    {!messages.length && !busy && !loading ? <><EmptyAssistant scope={scope} />{starters}</> : null}
    {loading ? <Working label="正在打开对话" /> : null}
    {messages.map((item, index) => <div className="assistant-turn" key={item.id}><AssistantMessage item={item} attachments={attachments} currentVersion={currentVersion} capabilities={policy.capabilities} onRevise={(advice) => target.actions?.revise({ mode: "rewrite", label: "按建议改写", instruction: advice.slice(0, 2_000), selection: target.selection })} onInsert={(text) => target.actions?.insert(text, { ai: true, kind: "AI 助手候选", resultKind: "candidate", rerun: onRegenerate })} onRegenerate={onRegenerate} onEdit={onEdit} latestAssistant={item.id === latestAssistantId} latestUser={item.id === latestUserId} working={busy && item.pending && !!item.text} activity={activity} showRuntime={showRuntime} showIdentity={scope !== "project" || !messages.slice(0, index).some((entry) => entry.role === "assistant")} />{dedupeConsecutiveActionIds(item.actionIds, actions).map((id) => <ActionCard key={id} action={actions.find((action) => action.id === id)} onApply={onApplyAction} onReject={onRejectAction} />)}</div>)}
    {busy && !messages.some((item) => item.pending && item.text) ? <Working label={showRuntime ? "Pi 正在处理" : "AI 正在处理"} detail={activity} startedAt={turnStartedAt} /> : null}
    {error ? <div className="assistant-error" role="alert"><span><b>{error.message || "AI 助手没有完成"}</b>{error.hint ? <small>{error.hint}</small> : null}</span><button onClick={onRetry}>重试</button></div> : null}
    <div ref={endRef} className="assistant-thread__end" aria-hidden="true" />
  </div>;
}
