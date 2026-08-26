import { useEffect, useState } from "react";
import { IconDatabase, IconFileText, IconSearch, IconShieldCheck, IconSparkles } from "../icons.jsx";
import { ActionCard } from "./ActionCard.jsx";
import { AssistantMessage } from "./AssistantMessage.jsx";

function elapsedSeconds(startedAt) {
  const value = Date.parse(startedAt || "");
  return Number.isFinite(value) ? Math.max(0, Math.floor((Date.now() - value) / 1_000)) : 0;
}

function elapsedLabel(seconds) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function Working({ label = "Pi 正在处理", detail = "", startedAt = "" }) {
  const [seconds, setSeconds] = useState(() => elapsedSeconds(startedAt));
  useEffect(() => {
    setSeconds(elapsedSeconds(startedAt));
    const timer = setInterval(() => setSeconds(startedAt ? elapsedSeconds(startedAt) : (value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const stage = detail || (seconds < 3 ? "正在读取上下文" : seconds < 12 ? "正在组织回答" : "正在等待模型返回");
  return <div className="assistant-working" role="status"><span className="assistant-orbit"><i /></span><div><b>{label}</b><small>{stage} · {elapsedLabel(seconds)}</small>{seconds >= 20 ? <em>可以离开此页，任务会在后台继续</em> : null}</div></div>;
}

function EmptyAssistant({ onPrompt, standalone = false, context = "project" }) {
  const reading = context === "reading";
  const actions = standalone ? [
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
  const heading = standalone ? "今天想一起想清什么？" : reading ? "想从这份文档看清什么？" : "这篇内容，下一步做什么？";
  const description = standalone
    ? "直接开始对话，或选一个更明确的入口。"
    : reading
      ? "它会读取当前文档与选区；回答只作为阅读参考，不会修改原文。"
      : "它会读取当前全文与选区；任何改写都先给候选，由你决定是否采用。";
  return <div className="assistant-empty">
    <span className="assistant-empty__mark"><IconSparkles aria-hidden="true" /></span>
    <h3>{heading}</h3>
    <p>{description}</p>
    <div className="assistant-empty__actions">
      {actions.map((action) => <button key={action.title} onClick={() => onPrompt(action.prompt)}>
        <action.icon aria-hidden="true" />
        <span><b>{action.title}</b><small>{action.detail}</small></span>
      </button>)}
    </div>
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
  standalone,
  emptyContext,
  currentVersion,
  selection,
  onRevision,
  onInsert,
  onPrompt,
  onRegenerate,
  onEdit,
  onApplyAction,
  onRetry,
  endRef,
}) {
  const latestUserId = [...messages].reverse().find((item) => item.role === "user")?.id;
  const latestAssistantId = [...messages].reverse().find((item) => item.role === "assistant" && item.text)?.id;
  return <div className="assistant-thread">
    {!messages.length && !busy && !loading ? <EmptyAssistant onPrompt={onPrompt} standalone={standalone} context={emptyContext} /> : null}
    {loading ? <Working label="正在打开对话" /> : null}
    {messages.map((item) => <div className="assistant-turn" key={item.id}><AssistantMessage item={item} attachments={attachments} currentVersion={currentVersion} canRevise={!standalone && typeof onRevision === "function" && !!selection?.text} canInsert={!standalone && !!onInsert} onRevise={(advice) => onRevision?.({ mode: "rewrite", label: "按建议改写", instruction: advice.slice(0, 2_000), selection })} onInsert={(text) => onInsert?.(text, { ai: true, kind: "AI 助手候选" })} onRegenerate={onRegenerate} onEdit={onEdit} latestAssistant={item.id === latestAssistantId} latestUser={item.id === latestUserId} working={busy && item.pending && !!item.text} activity={activity} />{(item.actionIds || []).map((id) => <ActionCard key={id} action={actions.find((action) => action.id === id)} onApply={onApplyAction} />)}</div>)}
    {busy && !messages.some((item) => item.pending && item.text) ? <Working label="Pi 正在处理" detail={activity} startedAt={turnStartedAt} /> : null}
    {error ? <div className="assistant-error" role="alert"><span><b>{error.message || "AI 助手没有完成"}</b>{error.hint ? <small>{error.hint}</small> : null}</span><button onClick={onRetry}>重试</button></div> : null}
    <div ref={endRef} />
  </div>;
}
