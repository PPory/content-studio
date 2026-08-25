import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrandX,
  IconCube,
  IconFish,
  IconLetterA,
  IconLetterK,
  IconLetterQ,
  IconLetterZ,
  IconDots,
  IconPin,
  IconTrash,
} from "@tabler/icons-react";
import { api } from "../lib/api.js";
import { documentVersion } from "../lib/document-version.js";
import { renderMarkdown } from "../lib/markdown.js";
import { KnowledgeCardDialog } from "./KnowledgeCardDialog.jsx";
import { ExpertReport } from "./ExpertTaskPanel.jsx";
import {
  IconArchive,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconDatabase,
  IconFileText,
  IconHistory,
  IconPlus,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconSend,
  IconShieldCheck,
  IconSparkles,
  IconX,
} from "./icons.jsx";
import "./project-assistant.css";

const TABS = [
  { id: "assistant", label: "AI 助手", icon: IconSparkles },
  { id: "materials", label: "项目素材", icon: IconDatabase },
  { id: "reports", label: "检查报告", icon: IconShieldCheck },
];

const REPORTS = [
  { id: "material-research", label: "素材查验", expert: "素材顾问", icon: IconSearch },
  { id: "quality-review", label: "审稿建议", expert: "审稿顾问", icon: IconFileText },
  { id: "fact-check", label: "事实核查", expert: "事实核查", icon: IconShieldCheck },
];

const EXPERTS = [
  { id: "topic-editor", label: "选题顾问", hint: "收束方向与核心问题" },
  { id: "writing-coach", label: "写作教练", hint: "梳理、续写和改稿" },
  { id: "material-researcher", label: "素材顾问", hint: "查知识库与公开来源" },
  { id: "quality-reviewer", label: "审稿顾问", hint: "逐项回答 Xenho 品控九问" },
  { id: "style-coach", label: "风格顾问", hint: "调准语气、节奏和表达习惯" },
  { id: "fact-checker", label: "事实核查", hint: "核对数字、日期、人物与引语" },
];

const PROJECT_EXPERTS = new Set(["writing-coach", "material-researcher", "quality-reviewer", "fact-checker"]);

const statusLabel = { queued: "排队中", running: "正在检查", done: "已完成", failed: "未完成", cancelled: "已中止" };
const ASSISTANT_MODEL_STORAGE_KEY = "xenho-assistant-model";

function storedAssistantModel() {
  try { return localStorage.getItem(ASSISTANT_MODEL_STORAGE_KEY) || ""; }
  catch { return ""; }
}

function rememberAssistantModel(value) {
  if (!value) return;
  try { localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, value); }
  catch {}
}

function commandAt(value, cursor) {
  const before = String(value || "").slice(0, cursor);
  const match = before.match(/(^|\s)([@/])([^\s@/]*)$/u);
  if (!match) return null;
  return {
    type: match[2] === "@" ? "experts" : "skills",
    query: match[3] || "",
    from: before.length - match[2].length - (match[3] || "").length,
    to: cursor,
  };
}

function elapsedSeconds(startedAt) {
  const value = Date.parse(startedAt || "");
  return Number.isFinite(value) ? Math.max(0, Math.floor((Date.now() - value) / 1_000)) : 0;
}

function elapsedLabel(seconds) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function Working({ label = "Pi 正在处理", detail = "", startedAt = "" }) {
  const [seconds, setSeconds] = useState(() => elapsedSeconds(startedAt));
  useEffect(() => {
    setSeconds(elapsedSeconds(startedAt));
    const timer = setInterval(() => setSeconds(startedAt ? elapsedSeconds(startedAt) : (value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const stage = detail || (seconds < 3 ? "正在读取上下文" : seconds < 12 ? "正在组织回答" : "正在等待模型返回");
  return <div className="assistant-working" role="status"><span className="assistant-orbit"><i /></span><div><b>{label}</b><small>{stage} · {elapsedLabel(seconds)}</small>{seconds >= 20 ? <em>可以离开此页，任务会在后台继续</em> : null}</div></div>;
}

function modelBrand(id = "", provider = "") {
  const value = `${id} ${provider}`.toLowerCase();
  if (/grok|\bxai\b/.test(value)) return { key: "grok", Icon: IconBrandX };
  if (/gemini|google/.test(value)) return { key: "gemini", Icon: IconBrandGoogle };
  if (/claude|anthropic/.test(value)) return { key: "claude", Icon: IconLetterA };
  if (/deepseek/.test(value)) return { key: "deepseek", Icon: IconFish };
  if (/kimi|moonshot/.test(value)) return { key: "kimi", Icon: IconLetterK };
  if (/glm|zhipu/.test(value)) return { key: "glm", Icon: IconLetterZ };
  if (/qwen|alibaba/.test(value)) return { key: "qwen", Icon: IconLetterQ };
  if (/gpt|openai|\bo[134]\b/.test(value)) return { key: "openai", Icon: IconBrandOpenai };
  return { key: "other", Icon: IconCube };
}

function ModelGlyph({ id, provider = "" }) {
  const brand = modelBrand(id, provider);
  const BrandIcon = brand.Icon;
  return <span className="assistant-model-glyph" data-brand={brand.key} aria-hidden="true"><BrandIcon stroke={1.8} /></span>;
}

async function prepareAssistantUpload(file) {
  if (!file?.type?.startsWith("image/") || file.type === "image/gif" || typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  const pixels = bitmap.width * bitmap.height;
  const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height), Math.sqrt(16_000_000 / Math.max(1, pixels)));
  if (file.size <= 8_000_000 && scale >= 1) { bitmap.close(); return file; }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error("这张图暂时无法压缩");
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp", lastModified: file.lastModified });
}

function EmptyAssistant({ onPrompt, standalone = false }) {
  const actions = standalone ? [
    { icon: IconDatabase, title: "从知识库找关联", detail: "串起书、笔记和近期内容", prompt: "搜索我的知识库，看看最近记录的内容之间有什么关联" },
    { icon: IconSearch, title: "联网核查一个事实", detail: "搜公开来源，把证据边界说清", prompt: "我想核查一个事实，请先问我要查什么" },
    { icon: IconSparkles, title: "让专家一起分析", detail: "从写作、素材或品控角度进入", prompt: "我有一个问题想让专家一起分析，请先问我问题是什么" },
  ] : [
    { icon: IconShieldCheck, title: "先看一个关键问题", detail: "找出当前稿件最值得先解决的一处", prompt: "帮我看看这篇文章现在最需要解决的一个问题" },
    { icon: IconFileText, title: "给下一步方向", detail: "结合全文，判断下一段最值得写什么", prompt: "结合当前内容，告诉我下一段最值得写什么" },
  ];
  return <div className="assistant-empty">
    <span className="assistant-empty__mark"><IconSparkles aria-hidden="true" /></span>
    <h3>{standalone ? "今天想一起想清什么？" : "这篇内容，下一步做什么？"}</h3>
    <p>{standalone ? "直接开始对话，或选一个更明确的入口。" : "它会读取当前全文与选区；任何改写都先给候选，由你决定是否采用。"}</p>
    <div className="assistant-empty__actions">
      {actions.map((action) => <button key={action.title} onClick={() => onPrompt(action.prompt)}>
        <action.icon aria-hidden="true" />
        <span><b>{action.title}</b><small>{action.detail}</small></span>
      </button>)}
    </div>
  </div>;
}

const Message = memo(function Message({ item, attachments = [], canRevise, canInsert, currentVersion, onRevise, onInsert, onRegenerate, onEdit, latestAssistant = false, latestUser = false, working = false, activity = "" }) {
  const assistant = item.role === "assistant";
  const stale = assistant && item.documentVersion && currentVersion && item.documentVersion !== currentVersion;
  const sentAttachments = assistant ? [] : attachments.filter((attachment) => item.attachmentIds?.includes(attachment.id));
  if (assistant && !item.text && item.pending) return null;
  return <article className={`assistant-message assistant-message--${assistant ? "assistant" : "user"}`}>
    {/* ⚠️ **自己那条不写「你」。** 靠右 + 深色气泡已经把「谁说的」说完了，
        再挂一行标签是同一件事说两遍；而助手那条要标模型和耗时，标签必须留。 */}
    {assistant ? <small><span className="assistant-message__avatar"><IconSparkles aria-hidden="true" /></span>Pi Agent SDK{item.model ? ` · ${item.model}` : ""}{item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(item.durationMs < 10_000 ? 1 : 0)}s` : ""}{working ? <span className="assistant-message__live"><i />{activity || "正在生成回答"}</span> : null}</small> : null}
    {assistant ? (working ? <p className="assistant-message__stream">{item.text}</p> : <div className="assistant-message__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text || "") }} />) : <div className="assistant-message__user">{sentAttachments.length ? <div className="assistant-message__attachments">{sentAttachments.map((attachment) => <span key={attachment.id}>{attachment.kind === "image" ? (attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : <span className="assistant-attachment-image">▧</span>) : <IconFileText aria-hidden="true" />}<span>{attachment.name}</span></span>)}</div> : null}{item.text ? <p>{item.text}</p> : null}{item.text ? <footer className="assistant-message__user-actions"><button type="button" onClick={() => navigator.clipboard?.writeText(item.text)} title="复制消息" aria-label="复制消息"><IconCopy aria-hidden="true" /></button>{latestUser && !working ? <button type="button" onClick={onEdit} title="编辑并重新发送" aria-label="编辑并重新发送"><IconPencil aria-hidden="true" /></button> : null}</footer> : null}</div>}
    {stale ? <p className="assistant-message__stale">正文已在这条回复之后变化；建议重新生成候选，避免覆盖新内容。</p> : null}
    {assistant && item.text && !working ? <footer>
      <button onClick={() => navigator.clipboard?.writeText(item.text)} title="复制这条回复"><IconCopy aria-hidden="true" />复制</button>
      {canInsert ? <button onClick={() => onInsert(item.text)} disabled={stale} title={stale ? "正文版本已变化，请重新生成" : "插入后会带底纹，仍需确认采用"}><IconPlus aria-hidden="true" />作为候选插入</button> : null}
      {canRevise ? <button onClick={() => onRevise(item.text)} disabled={stale} title={stale ? "正文版本已变化，请重新生成" : "按这条建议生成选区改写候选"}><IconRefresh aria-hidden="true" />按建议改选区</button> : null}
      {latestAssistant ? <button onClick={onRegenerate} title="用相同问题重新生成"><IconRefresh aria-hidden="true" />重新生成</button> : null}
    </footer> : null}
  </article>;
});

const ACTION_LABELS = {
  create_content: ["新建到「创作」", "确认新建"],
  document_create: ["新建工作台文档", "确认写入"],
  document_update: ["更新工作台文档", "确认更新"],
  annotation_append: ["追加工作台批注", "确认追加"],
  reference_insert: ["插入来源引用", "确认插入"],
  project_write: ["写入项目文件", "确认写入"],
  project_edit: ["编辑项目文件", "确认编辑"],
  powershell: ["执行 PowerShell", "确认执行"],
  workspace_write: ["写入授权工作区", "确认写入"],
  workspace_edit: ["编辑授权工作区", "确认编辑"],
  workspace_powershell: ["在授权工作区执行命令", "确认执行"],
};

function ActionCard({ action, onApply }) {
  if (!action || action.status === "superseded") return null;
  const applied = action.status === "applied";
  const [title, button] = ACTION_LABELS[action.type] || ["执行候选操作", "确认执行"];
  const detail = action.type === "create_content" ? `${action.title} · ${action.platform}` : action.path || action.command?.slice(0, 120) || "已由服务端校验范围";
  return <section className="assistant-action-card">
    <div><small>{applied ? "已执行" : "等待你确认"}</small><b>{title}</b><p>{detail}</p></div>
    {applied ? (action.result?.projectId ? <button type="button" onClick={() => { window.location.hash = `#/project/${action.result.projectId}`; }}>打开内容</button> : <span>已完成</span>) : <button type="button" onClick={() => onApply(action.id)}>{button}</button>}
  </section>;
}

export function AssistantPane({ scopeId, document = {}, materials = [], profile, selection, onInsert, onRevision, standalone = false, docked = false }) {
  const [messages, setMessages] = useState([]);
  const [actions, setActions] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [turnStartedAt, setTurnStartedAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [menu, setMenu] = useState("");
  const [menuQuery, setMenuQuery] = useState("");
  const [menuIndex, setMenuIndex] = useState(0);
  const [commandRange, setCommandRange] = useState(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [conversationTitle, setConversationTitle] = useState("新对话");
  const [conversationItems, setConversationItems] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyView, setHistoryView] = useState("recent");
  const [historyMenuId, setHistoryMenuId] = useState("");
  const [renameId, setRenameId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [historyPending, setHistoryPending] = useState("");
  const [models, setModels] = useState([]);
  const [modelNotice, setModelNotice] = useState("");
  const [skills, setSkills] = useState([]);
  const [expertPresets, setExpertPresets] = useState([]);
  const [model, setModel] = useState(storedAssistantModel);
  const [modelPending, setModelPending] = useState(false);
  const [permissionModes, setPermissionModes] = useState([{ id: "daily", label: "日常", description: "只读、检索和候选动作", warning: "" }, { id: "creative", label: "创作", description: "个人工作台内的受控写入", warning: "所有写入仍需确认。" }, { id: "developer", label: "开发", description: "项目写入和 PowerShell", warning: "开发模式可触及项目代码和命令，请确认当前任务确实需要。" }]);
  const [permissionMode, setPermissionMode] = useState("daily");
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [styleId, setStyleId] = useState("");
  const [modePending, setModePending] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const endRef = useRef(null);
  const streamRef = useRef({ id: "", text: "", timer: 0 });
  const scrollFrameRef = useRef(0);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const permissionRef = useRef(null);
  const activeRequestRef = useRef(null);
  const conversationIdRef = useRef("");
  const enabledStyles = (profile?.styles || []).filter((item) => item.enabled);
  const style = enabledStyles.find((item) => item.id === styleId) || null;
  useEffect(() => {
    setStyleId((current) => enabledStyles.some((item) => item.id === current) ? current : enabledStyles.some((item) => item.id === profile?.profile?.styleId) ? profile.profile.styleId : "");
  }, [profile, scopeId]);
  const currentVersion = documentVersion(document);

  const refreshHistory = async () => {
    if (!standalone) return;
    const result = await api.assistantConversations(scopeId);
    setConversationItems(result.conversations?.items || []);
  };

  const applyConversation = (conversation) => {
    conversationIdRef.current = conversation?.id || "";
    setConversationId(conversationIdRef.current);
    setConversationTitle(conversation?.title || "新对话");
    setMessages(conversation?.messages || []);
    setAttachments((current) => (conversation?.attachments || []).map((item) => ({ ...item, previewUrl: current.find((candidate) => candidate.id === item.id)?.previewUrl || "" })));
    setActions(conversation?.actions || []);
    if (conversation?.model) { setModel(conversation.model); rememberAssistantModel(conversation.model); }
    setPermissionMode(conversation?.permissionMode || "daily");
    const running = conversation?.activeTurn?.status === "running";
    if (running) {
      setBusy(true);
      setActivity(conversation.activeTurn.stage || "Pi 正在处理");
      setTurnStartedAt(conversation.activeTurn.startedAt || "");
    } else if (!activeRequestRef.current) {
      setBusy(false);
      setActivity("");
      setTurnStartedAt("");
    }
    if (conversation?.lastTurn?.status === "interrupted") {
      setError(Object.assign(new Error("上次对话因工作台重启而中断"), { hint: "已保留之前的对话；重新发送最后一个问题即可继续。" }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    conversationIdRef.current = "";
    setMessages([]); setActions([]); setAttachments([]); setConversationId(""); setConversationTitle("新对话"); setError(null); setUploadError(""); setLoading(!standalone);
    if (!standalone) api.assistantConversation(scopeId).then((result) => { if (!cancelled) applyConversation(result.conversation); }).catch((next) => { if (!cancelled) setError(next); }).finally(() => { if (!cancelled) setLoading(false); });
    if (standalone) api.assistantConversations(scopeId).then((result) => { if (!cancelled) setConversationItems(result.conversations?.items || []); }).catch(() => {});
    api.assistantModels().then((result) => {
      if (cancelled) return;
      const nextModels = result.models?.items || [];
      setModels(nextModels); setModelNotice(result.models?.warning || "");
      setModel((current) => {
        const currentStillAvailable = nextModels.some((item) => item.id === current);
        const next = currentStillAvailable ? current : result.models?.configured || nextModels[0]?.id || current || "";
        rememberAssistantModel(next);
        return next;
      });
    }).catch((next) => { if (!cancelled) setModelNotice(next.message || "模型目录暂时不可用"); });
    api.assistantSkills().then((result) => { if (!cancelled) setSkills((result.skills?.items || []).map((item) => ({ id: `skill:${item.id}`, label: item.name, hint: item.description, prompt: `/${item.id} ` }))); }).catch(() => {});
    api.assistantModes().then((result) => { if (!cancelled) setPermissionModes(result.modes?.items || []); }).catch(() => {});

    api.assistantExperts().then((result) => { if (!cancelled) setExpertPresets((result.experts?.items || []).map((item) => ({ id: item.id, label: item.name, hint: item.description }))); }).catch(() => {});
    return () => { cancelled = true; clearTimeout(streamRef.current.timer); cancelAnimationFrame(scrollFrameRef.current); };
  }, [scopeId, standalone]);
  useEffect(() => {
    if (!conversationId || !busy || activeRequestRef.current) return undefined;
    let cancelled = false;
    const poll = async () => {
      const result = await api.assistantConversation(scopeId, conversationId).catch(() => null);
      if (!cancelled && result?.conversation) applyConversation(result.conversation);
    };
    poll();
    const timer = setInterval(poll, 1_500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [scopeId, conversationId, busy]);
  const hasRunningHistory = conversationItems.some((item) => item.activeTurn?.status === "running");
  useEffect(() => {
    if (!standalone || !hasRunningHistory) return undefined;
    const timer = setInterval(() => refreshHistory().catch(() => {}), 1_500);
    return () => clearInterval(timer);
  }, [standalone, scopeId, hasRunningHistory]);
  useEffect(() => {
    if (!permissionOpen && !historyMenuId && !renameId) return undefined;
    const close = (event) => {
      if (permissionOpen && !permissionRef.current?.contains(event.target) && !event.target.closest?.(".assistant-composer__access")) setPermissionOpen(false);
      if (historyMenuId && !event.target.closest?.(".assistant-history__item")) setHistoryMenuId("");
    };
    const key = (event) => {
      if (event.key !== "Escape") return;
      setPermissionOpen(false); setHistoryMenuId(""); setRenameId("");
    };
    window.document.addEventListener("pointerdown", close);
    window.document.addEventListener("keydown", key);
    return () => { window.document.removeEventListener("pointerdown", close); window.document.removeEventListener("keydown", key); };
  }, [permissionOpen, historyMenuId, renameId]);
  useEffect(() => {
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
  }, [messages.length, busy]);

  function flushStream(streamingId) {
    const current = streamRef.current;
    if (!current.text || current.id !== streamingId) return;
    const text = current.text; current.text = ""; current.timer = 0;
    setMessages((items) => items.map((item) => item.id === streamingId ? { ...item, text: (item.text || "") + text } : item));
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
  }

  function queueStream(streamingId, text) {
    streamRef.current.id = streamingId; streamRef.current.text += text;
    if (!streamRef.current.timer) streamRef.current.timer = window.setTimeout(() => flushStream(streamingId), 42);
  }

  const send = async (text = input) => {
    const message = String(text || "").trim();
    const pendingAttachments = attachments.filter((item) => !item.usedAt);
    if ((!message && !pendingAttachments.length) || busy) return;
    const optimistic = { id: `optimistic-${Date.now()}`, role: "user", text: message, attachmentIds: pendingAttachments.map((item) => item.id), createdAt: new Date().toISOString() };
    const streamingId = `streaming-${Date.now()}`;
    const requestId = Symbol("assistant-request");
    setMessages((current) => [...current, optimistic, { id: streamingId, role: "assistant", text: "", createdAt: new Date().toISOString(), pending: true, model }]);
    activeRequestRef.current = requestId;
    setInput(""); setMenu(""); setBusy(true); setActivity("正在读取上下文"); setTurnStartedAt(new Date().toISOString()); setError(null); setUploadError("");
    try {
      const result = await api.assistantChatStream(
        { scopeId, conversationId, startNew: !conversationId, message, document, documentVersion: currentVersion, materials, style: standalone ? null : style, model, permissionMode, mode: standalone ? "general" : "content" },
        (event) => {
          if (activeRequestRef.current !== requestId) return;
          if (event.type === "conversation" && event.conversationId) {
            conversationIdRef.current = event.conversationId;
            setConversationId(event.conversationId);
            refreshHistory().catch(() => {});
          }
          if (event.type === "status") setActivity(event.stage || "Pi 正在继续处理");
          if (event.type === "text" && event.text) {
            setActivity("正在生成回答");
            queueStream(streamingId, event.text);
          }
        },
      );
      if (activeRequestRef.current !== requestId) return;
      flushStream(streamingId); applyConversation(result.conversation);
      await refreshHistory();
    } catch (next) {
      if (activeRequestRef.current === requestId && next.status === 409 && conversationIdRef.current) {
        const current = await api.assistantConversation(scopeId, conversationIdRef.current).catch(() => null);
        if (current?.conversation) applyConversation(current.conversation);
      } else if (activeRequestRef.current === requestId) setError(next);
    } finally {
      if (activeRequestRef.current === requestId) {
        activeRequestRef.current = null;
        setBusy(false); setActivity(""); setTurnStartedAt("");
      }
    }
  };

  const newConversation = async () => {
    activeRequestRef.current = null;
    clearTimeout(streamRef.current.timer);
    streamRef.current = { id: "", text: "", timer: 0 };
    conversationIdRef.current = "";
    setConversationId(""); setConversationTitle("新对话"); setPermissionMode("daily"); setMessages([]); setActions([]); setAttachments([]); setError(null); setUploadError(""); setInput(""); setBusy(false); setActivity(""); setTurnStartedAt("");
    refreshHistory().catch(() => {});
    inputRef.current?.focus();
  };

  const openConversation = async (id) => {
    if (id === conversationId) return;
    activeRequestRef.current = null;
    clearTimeout(streamRef.current.timer);
    streamRef.current = { id: "", text: "", timer: 0 };
    setBusy(false); setActivity(""); setTurnStartedAt("");
    setLoading(true); setError(null);
    try { applyConversation((await api.assistantConversation(scopeId, id)).conversation); }
    catch (next) { setError(next); }
    finally { setLoading(false); }
  };

  const stop = async () => {
    activeRequestRef.current = null;
    setError(null);
    const activeConversationId = conversationIdRef.current;
    setMessages((items) => items.filter((item) => !item.pending));
    await api.cancelAssistant(scopeId, activeConversationId).catch(() => {});
    if (activeConversationId) {
      const result = await api.assistantConversation(scopeId, activeConversationId).catch(() => null);
      if (result?.conversation) applyConversation(result.conversation);
    }
    await refreshHistory().catch(() => {});
    setBusy(false);
  };

  const uploadFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploading) return;
    setUploading(true); setUploadError("");
    try {
      const prepared = await prepareAssistantUpload(file);
      const result = await api.uploadAssistantAttachment(scopeId, conversationId, prepared);
      if (!conversationId) {
        conversationIdRef.current = result.conversationId;
        setConversationId(result.conversationId);
      }
      setAttachments((current) => [...current, { ...result.attachment, previewUrl: prepared.type.startsWith("image/") ? URL.createObjectURL(prepared) : "" }]);

      inputRef.current?.focus();
    } catch (next) { setUploadError(next.hint || next.message || "这个附件暂时无法读取"); }
    finally { setUploading(false); }
  };

  function chooseExpert(item) {
    insertCommand(`@${item.label} `);
  }

  function chooseSkill(item) {
    insertCommand(item.prompt || `/${item.label} `);
  }

  const experts = (expertPresets.length ? expertPresets : EXPERTS).filter((item) => standalone || PROJECT_EXPERTS.has(item.id));
  const availableSkills = skills;
  const modelItems = model && !models.some((item) => item.id === model) ? [{ id: model, name: model, remembered: true }, ...models] : models;
  const menuItems = menu === "experts" ? experts : menu === "skills" ? availableSkills : modelItems.map((item) => ({ id: item.id, label: item.name || item.id, hint: item.ownedBy || (item.remembered ? "最近使用" : "可用模型"), provider: item.ownedBy || "" }));
  const filteredMenuItems = (menu === "models" ? menuItems : menuItems.filter((item) => !menuQuery || `${item.label} ${item.id} ${item.hint || ""}`.toLowerCase().includes(menuQuery.toLowerCase()))).slice(0, 80);

  function openMenu(type) {
    setMenu(type); setMenuQuery(""); setMenuIndex(0); setCommandRange(null);
  }

  function insertCommand(text) {
    const range = commandRange;
    const next = range ? `${input.slice(0, range.from)}${text}${input.slice(range.to)}` : `${input}${input && !/\s$/.test(input) ? " " : ""}${text}`;
    setInput(next); setMenu(""); setMenuQuery(""); setCommandRange(null);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.length, next.length); });
  }

  async function chooseModel(item) {
    const previous = model;
    setMenu(""); setMenuQuery(""); setCommandRange(null); setModel(item.id); rememberAssistantModel(item.id); setModelPending(true); setError(null);
    if (!conversationId) { setModelPending(false); return; }
    try {
      const result = await api.setAssistantModel({ scopeId, conversationId, model: item.id });
      applyConversation(result.conversation);
    } catch (next) {
      setModel(previous); rememberAssistantModel(previous); setError(next);
    } finally { setModelPending(false); }
  }

  async function choosePermissionMode(value) {
    const next = typeof value === "string" ? value : value.target.value;
    setPermissionOpen(false);
    const item = permissionModes.find((modeItem) => modeItem.id === next);
    if (!item || next === permissionMode || busy) return;
    if (next === "developer" && !window.confirm(`${item.warning}\n\n只有明确的开发任务才应使用此模式。`)) return;
    const previous = permissionMode;
    setPermissionMode(next); setModePending(true); setError(null);
    if (!conversationId) { setModePending(false); return; }
    try {
      const result = await api.setAssistantMode({ scopeId, conversationId, permissionMode: next });
      applyConversation(result.conversation);
    } catch (nextError) {
      setPermissionMode(previous); setError(nextError);
    } finally { setModePending(false); }
  }

  async function manageHistory(item, action, payload = {}) {
    if (!item?.id || historyPending || item.activeTurn?.status === "running") return;
    if (action === "delete" && !window.confirm(`永久从历史列表删除“${item.title || "这段对话"}”？工作台会把原始记录移入本地回收目录。`)) return;
    setHistoryPending(`${item.id}:${action}`); setHistoryMenuId(""); setError(null);
    try {
      const result = await api.manageAssistantConversation({ scopeId, conversationId: item.id, action, ...payload });
      setConversationItems(result.conversations?.items || []);
      if (result.conversation && item.id === conversationId) applyConversation(result.conversation);
      if (["archive", "delete"].includes(action) && item.id === conversationId) await newConversation();
      if (action === "restore") setHistoryView("recent");
    } catch (next) { setError(next); }
    finally { setHistoryPending(""); }
  }

  function startRename(item) {
    setHistoryMenuId(""); setRenameId(item.id); setRenameValue(item.title || "新对话");
    requestAnimationFrame(() => window.document.querySelector(`[data-rename-id="${item.id}"]`)?.focus());
  }

  async function submitRename(item) {
    const title = renameValue.trim();
    setRenameId("");
    if (!title || title === item.title) return;
    await manageHistory(item, "rename", { title });
  }

  async function rewind(edit = false) {
    if (!conversationId || busy) return;
    setError(null);
    try {
      const result = await api.rewindAssistant(scopeId, conversationId);
      applyConversation(result.conversation);
      if (edit) { setInput(result.message || ""); requestAnimationFrame(() => inputRef.current?.focus()); }
      else await send(result.message || "");
    } catch (next) { setError(next); }
  }

  async function applyAction(actionId) {
    try {
      const result = await api.applyAssistantAction(scopeId, conversationId, actionId);
      applyConversation(result.conversation);
    } catch (next) { setError(next); }
  }

  function chooseMenuItem(item) {
    if (!item) return;
    if (menu === "experts") chooseExpert(item);
    else if (menu === "skills") chooseSkill(item);
    else chooseModel(item);
  }

  function changeInput(event) {
    const value = event.target.value;
    const command = commandAt(value, event.target.selectionStart ?? value.length);
    setInput(value);
    if (command) {
      setMenu(command.type); setMenuQuery(command.query); setMenuIndex(0); setCommandRange({ from: command.from, to: command.to });
    } else if (menu === "experts" || menu === "skills") {
      setMenu(""); setMenuQuery(""); setCommandRange(null);
    }
  }

  function inputKeyDown(event) {
    if (menu && filteredMenuItems.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setMenuIndex((value) => (value + step + filteredMenuItems.length) % filteredMenuItems.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); chooseMenuItem(filteredMenuItems[menuIndex] || filteredMenuItems[0]); return; }
      if (event.key === "Escape") { event.preventDefault(); setMenu(""); setCommandRange(null); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
  }

  const visibleConversations = conversationItems.filter((item) => historyView === "archived" ? Boolean(item.archivedAt) : !item.archivedAt);
  const latestUserId = [...messages].reverse().find((item) => item.role === "user")?.id;
  const latestAssistantId = [...messages].reverse().find((item) => item.role === "assistant" && item.text)?.id;
  const canArchive = !busy && messages.some((item) => item.role === "assistant" && item.text);
  const backgroundConversation = conversationItems.find((item) => item.activeTurn?.status === "running" && item.id !== conversationId);
  const pendingAttachments = attachments.filter((item) => !item.usedAt);

  const dialog = <div className="assistant-pane__dialog">
    <header className="assistant-pane__context">
      <div>
        {standalone && !docked ? <button className="assistant-history-toggle" type="button" onClick={() => setHistoryOpen((value) => !value)} aria-pressed={historyOpen} title="历史对话"><IconHistory aria-hidden="true" /><span>历史对话</span></button> : null}
        {!standalone ? <span className="assistant-context-chip" data-live={selection?.text ? "true" : undefined}>{selection?.text ? `选中 ${selection.text.length} 字` : "当前全文"}</span> : null}
        {materials.length ? <span className="assistant-context-chip">项目素材 {materials.length}</span> : null}
      </div>
      <div className="assistant-context-actions">

                {!standalone && enabledStyles.length ? <label className="assistant-context-style" title="本轮写作风格"><span>风格</span><select value={styleId} onChange={(event) => setStyleId(event.target.value)}><option value="">原本语气</option>{enabledStyles.map((item) => <option value={item.id} key={item.id}>{item.name}{item.customized ? " · 已校准" : ""}</option>)}</select></label> : null}
        {backgroundConversation ? <button className="assistant-background-task" type="button" onClick={() => openConversation(backgroundConversation.id)} title="查看仍在后台运行的对话"><span className="assistant-background-task__dot" /> <span>后台任务进行中</span></button> : null}
        {canArchive ? <button type="button" onClick={() => setCardOpen(true)} title="把本轮完整对话整理成知识卡片"><IconArchive aria-hidden="true" /><span>沉淀对话</span></button> : null}
        <button type="button" onClick={newConversation} title="保留当前记录并新建对话" aria-label="新对话"><IconPlus aria-hidden="true" />{standalone ? <span>新对话</span> : null}</button>
      </div>
    </header>

    <div className="assistant-thread">
      {!messages.length && !busy && !loading ? <EmptyAssistant onPrompt={send} standalone={standalone} /> : null}
      {loading ? <Working label="正在打开对话" /> : null}
      {messages.map((item) => <div className="assistant-turn" key={item.id}><Message item={item} attachments={attachments} currentVersion={currentVersion} canRevise={!standalone && !!selection?.text} canInsert={!standalone && !!onInsert} onRevise={(advice) => onRevision?.({ mode: "rewrite", label: "按建议改写", instruction: advice.slice(0, 2_000), selection })} onInsert={(text) => onInsert?.(text, { ai: true, kind: "AI 助手候选" })} onRegenerate={() => rewind(false)} onEdit={() => rewind(true)} latestAssistant={item.id === latestAssistantId} latestUser={item.id === latestUserId} working={busy && item.pending && !!item.text} activity={activity} />{(item.actionIds || []).map((id) => <ActionCard key={id} action={actions.find((action) => action.id === id)} onApply={applyAction} />)}</div>)}
      {busy && !messages.some((item) => item.pending && item.text) ? <Working label="Pi 正在处理" detail={activity} startedAt={turnStartedAt} /> : null}
      {error ? <div className="assistant-error" role="alert"><span><b>{error.message || "AI 助手没有完成"}</b>{error.hint ? <small>{error.hint}</small> : null}</span><button onClick={() => { setError(null); setInput(messages.at(-1)?.role === "user" ? messages.at(-1).text : input); }}>重试</button></div> : null}
      <div ref={endRef} />
    </div>

    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
      {pendingAttachments.length && !busy ? <div className="assistant-attachments">{pendingAttachments.slice(-4).map((item) => <span key={item.id}>{item.kind === "image" ? (item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="assistant-attachment-image">▧</span>) : <IconFileText aria-hidden="true" />}<span>{item.name}</span></span>)}</div> : null}
      {uploadError ? <div className="assistant-composer__notice" role="status"><span>{uploadError}</span><button type="button" onClick={() => setUploadError("")} aria-label="关闭"><IconX aria-hidden="true" /></button></div> : null}
      <textarea ref={inputRef} value={input} onChange={changeInput} onKeyDown={inputKeyDown} placeholder={standalone ? "问任何问题，或直接输入本地项目路径" : "问当前内容"} rows="2" disabled={busy} />
      {permissionOpen ? <div className="assistant-permission-menu" ref={permissionRef} role="menu" aria-label="选择权限">
        {permissionModes.map((item) => <button type="button" role="menuitemradio" key={item.id} aria-checked={item.id === permissionMode} onClick={() => choosePermissionMode(item.id)} disabled={busy || modePending}><IconShieldCheck aria-hidden="true" /><span><b>{item.label}</b><small>{item.description}</small></span>{item.id === permissionMode ? <IconCheck aria-hidden="true" /> : null}</button>)}
      </div> : null}
      {menu && menu !== "models" ? <div className="assistant-command-menu" role="menu">
        <header><span>{menu === "models" ? "选择模型" : menu === "experts" ? "选择专家" : "选择 Skill"}{menuQuery ? <em>“{menuQuery}”</em> : null}</span><button type="button" onClick={() => setMenu("")}><IconX aria-hidden="true" /></button></header>
        {filteredMenuItems.length ? filteredMenuItems.map((item, index) => <button type="button" role="menuitem" aria-current={index === menuIndex ? "true" : undefined} key={item.id} onMouseEnter={() => setMenuIndex(index)} onClick={() => chooseMenuItem(item)} disabled={menu === "models" && modelPending}><span className="assistant-command-menu__mark">{menu === "experts" ? "@" : menu === "skills" ? "/" : <ModelGlyph id={item.id} provider={item.provider} />}</span><span><b>{item.label}{menu === "models" && item.id === model ? <em>当前</em> : null}</b><small>{item.hint}</small></span></button>) : <p className="assistant-command-menu__empty">{menu === "models" ? "暂时没有可用模型" : "没有匹配项"}</p>}
      </div> : null}
      <footer>
        <div className="assistant-composer__left">
          <><input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.md,.markdown,.txt,.csv,.json,.xml,.html,.htm,.yaml,.yml,.js,.jsx,.ts,.tsx,.css" onChange={uploadFile} /><button type="button" className="assistant-composer__attach" title={uploading ? "正在读取附件" : "添加图片或文件"} aria-label={uploading ? "正在读取附件" : "添加图片或文件"} onClick={() => fileRef.current?.click()} disabled={uploading}><IconPlus aria-hidden="true" /></button></>
          <button type="button" className="assistant-composer__access" title="权限" onClick={() => { setPermissionOpen((value) => !value); setMenu(""); }} aria-expanded={permissionOpen} disabled={busy || modePending}><IconShieldCheck aria-hidden="true" /><span>权限 {permissionModes.find((item) => item.id === permissionMode)?.label || "日常"}</span><IconChevronDown aria-hidden="true" /></button>
        </div>
        <div className="assistant-composer__right">
          <div className="assistant-model-picker">
            <button type="button" className="assistant-composer__model" title={modelNotice || "从当前接口返回的可用模型中选择"} onClick={() => menu === "models" ? setMenu("") : openMenu("models")} aria-expanded={menu === "models"} disabled={busy || modelPending}><ModelGlyph id={model} provider={models.find((item) => item.id === model)?.ownedBy} /><b>{models.find((item) => item.id === model)?.name || model || "默认模型"}</b><IconChevronDown aria-hidden="true" /></button>
            {menu === "models" ? <div className="assistant-command-menu assistant-command-menu--models" role="menu">
              <header><span>选择模型</span><button type="button" onClick={() => setMenu("")}><IconX aria-hidden="true" /></button></header>
              {filteredMenuItems.length ? filteredMenuItems.map((item, index) => <button type="button" role="menuitem" aria-current={index === menuIndex ? "true" : undefined} key={item.id} onMouseEnter={() => setMenuIndex(index)} onClick={() => chooseMenuItem(item)} disabled={modelPending}><span className="assistant-command-menu__mark"><ModelGlyph id={item.id} provider={item.provider} /></span><span><b>{item.label}{item.id === model ? <em>当前</em> : null}</b><small>{item.hint}</small></span></button>) : <p className="assistant-command-menu__empty">暂时没有可用模型</p>}
            </div> : null}
          </div>
          {busy ? <button type="button" className="assistant-send assistant-send--stop" onClick={stop} aria-label="停止"><IconX aria-hidden="true" /></button> : <button type="submit" className="assistant-send" disabled={(!input.trim() && !pendingAttachments.length) || loading || uploading} aria-label="发送"><IconSend aria-hidden="true" /></button>}
        </div>
      </footer>
    </form>
    <KnowledgeCardDialog open={cardOpen} onClose={() => setCardOpen(false)} messages={messages.map((item) => ({ ...item, role: item.role === "assistant" ? "agent" : item.role }))} source={{ title: document.title || conversationTitle || "AI 助手对话", type: standalone ? "AI 助手对话" : "内容项目对话", engine: "Pi Agent SDK" }} />
  </div>;

  return <div className={`assistant-pane${standalone ? " assistant-pane--standalone" : ""}${docked ? " assistant-pane--docked" : ""}`}>
    {standalone && historyOpen ? <aside className="assistant-history" aria-label="历史对话">
      <header><strong>历史对话</strong><button onClick={newConversation} title="新建对话" aria-label="新建对话"><IconPlus aria-hidden="true" /></button></header>
      <div className="assistant-history__filters" role="tablist" aria-label="历史范围"><button type="button" role="tab" aria-selected={historyView === "recent"} onClick={() => { setHistoryView("recent"); setHistoryMenuId(""); }}>最近</button><button type="button" role="tab" aria-selected={historyView === "archived"} onClick={() => { setHistoryView("archived"); setHistoryMenuId(""); }}>已归档</button></div>
      <nav>{visibleConversations.length ? visibleConversations.map((item) => <div className="assistant-history__item" key={item.id} data-current={item.id === conversationId ? "true" : undefined}>
        {renameId === item.id ? <form className="assistant-history__rename" onSubmit={(event) => { event.preventDefault(); submitRename(item); }}><input data-rename-id={item.id} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={() => setRenameId("")} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setRenameId(""); } }} aria-label="新的对话名称" /></form> : <button className="assistant-history__open" type="button" aria-current={item.id === conversationId ? "page" : undefined} onClick={() => openConversation(item.id)}><b><span>{item.title}</span>{item.pinnedAt ? <IconPin aria-label="已置顶" /> : null}</b><small>{item.activeTurn?.status === "running" ? <><i className="assistant-history__running" />{item.activeTurn.stage || "后台运行中"}</> : item.preview || "还没有消息"}</small><time>{new Date(item.updatedAt || item.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</time></button>}
        <button className="assistant-history__more" type="button" onClick={() => setHistoryMenuId((current) => current === item.id ? "" : item.id)} aria-expanded={historyMenuId === item.id} aria-label={`管理对话：${item.title}`}><IconDots aria-hidden="true" /></button>
        {historyMenuId === item.id ? <div className="assistant-history__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => startRename(item)} disabled={item.activeTurn?.status === "running"}><IconPencil aria-hidden="true" />重命名</button>
          {!item.archivedAt ? <button type="button" role="menuitem" onClick={() => manageHistory(item, item.pinnedAt ? "unpin" : "pin")} disabled={item.activeTurn?.status === "running"}><IconPin aria-hidden="true" />{item.pinnedAt ? "取消置顶" : "置顶聊天"}</button> : null}
          <button type="button" role="menuitem" onClick={() => manageHistory(item, item.archivedAt ? "restore" : "archive")} disabled={item.activeTurn?.status === "running"}><IconArchive aria-hidden="true" />{item.archivedAt ? "移出归档" : "归档"}</button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => manageHistory(item, "delete")} disabled={item.activeTurn?.status === "running"}><IconTrash aria-hidden="true" />删除</button>
        </div> : null}
      </div>) : <p className="assistant-history__empty">{historyView === "archived" ? "还没有归档对话" : "还没有历史对话"}</p>}</nav>
    </aside> : null}
    {dialog}
  </div>;
}

function ReportsPane({ runs, activeKind, onKind, onRun, onRetry, onCancel }) {
  const latest = runs.find((item) => item.kind === activeKind) || null;
  const working = latest && ["queued", "running"].includes(latest.status);
  return <div className="assistant-reports">
    <nav>{REPORTS.map((item) => <button key={item.id} onClick={() => onKind(item.id)} aria-pressed={activeKind === item.id}><item.icon aria-hidden="true" />{item.label}{runs.some((run) => run.kind === item.id && run.status === "done") ? <IconCheck className="assistant-report-check" aria-hidden="true" /> : null}</button>)}</nav>
    {!latest ? <div className="assistant-report-empty"><IconShieldCheck aria-hidden="true" /><h3>还没有这类报告</h3><p>专家会读取当前全文；如果正文有选区，只检查选中的部分。</p><button onClick={() => onRun(activeKind)}>开始{REPORTS.find((item) => item.id === activeKind)?.label}</button></div> : null}
    {working ? <div className="assistant-report-running"><Working label={latest.stageLabel || "专家正在检查"} /><div className="assistant-report-track"><span style={{ width: `${latest.percent || 2}%` }} /></div><p>关闭或切换页签不会中止，结果会留在这里。</p><button onClick={() => onCancel(latest.id)}>中止任务</button></div> : null}
    {latest?.status === "failed" ? <div className="assistant-error assistant-report-error"><small>本次检查未完成</small><b>{latest.error}</b>{latest.hint ? <p>{latest.hint}</p> : null}<button onClick={() => onRetry(latest)}>重新检查</button></div> : null}
    {latest?.status === "cancelled" ? <div className="assistant-report-empty"><p>这次任务已中止。</p><button onClick={() => onRetry(latest)}>重新检查</button></div> : null}
    {latest?.report ? <div className="assistant-report-result"><header><div><small>{statusLabel[latest.status]} · {new Date(latest.finishedAt || latest.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small><h3>{REPORTS.find((item) => item.id === latest.kind)?.label}</h3></div><button onClick={() => onRetry(latest)}><IconRefresh aria-hidden="true" />重查</button></header><ExpertReport report={latest.report} /></div> : null}
  </div>;
}

export function ProjectAssistantRail({ scopeId, document, materials = [], profile, selection, onInsert, onRevision, children }) {
  const [tab, setTab] = useState("assistant");
  const [reportKind, setReportKind] = useState("material-research");
  const [runs, setRuns] = useState([]);
  const [reportError, setReportError] = useState(null);

  const loadRuns = async () => {
    try { setRuns((await api.expertRuns(scopeId)).runs || []); setReportError(null); }
    catch (error) { setReportError(error); }
  };
  useEffect(() => { loadRuns(); }, [scopeId]);
  useEffect(() => {
    if (!runs.some((item) => ["queued", "running"].includes(item.status))) return undefined;
    const timer = setInterval(loadRuns, 1_200);
    return () => clearInterval(timer);
  }, [runs, scopeId]);

  const startRun = async (kind, force = false) => {
    setTab("reports"); setReportKind(kind); setReportError(null);
    try {
      const result = await api.startExpertRun({ kind, scopeId, document, documentVersion: documentVersion(document), force });
      setRuns((current) => [result.run, ...current.filter((item) => item.id !== result.run.id)]);
    } catch (error) { setReportError(error); }
  };
  const retry = (run) => startRun(run.kind, true);
  const cancel = async (id) => { await api.cancelExpertRun(id); loadRuns(); };
  const counts = useMemo(() => ({ materials: materials.length, reports: new Set(runs.filter((item) => item.status === "done").map((item) => item.kind)).size }), [materials.length, runs]);

  return <aside className="project-rail project-assistant" aria-label="项目 AI 与资料">
    <nav className="project-assistant__tabs" aria-label="右栏">
      {TABS.map((item) => <button key={item.id} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}><item.icon aria-hidden="true" /><span>{item.label}</span>{item.id !== "assistant" && counts[item.id] ? <em>{counts[item.id]}</em> : null}</button>)}
    </nav>
    <div className="project-assistant__body">
      {tab === "assistant" ? <AssistantPane scopeId={scopeId} document={document} materials={materials} profile={profile} selection={selection} onInsert={onInsert} onRevision={onRevision} /> : null}
      {tab === "materials" ? <div className="project-assistant__materials">{children}</div> : null}
      {tab === "reports" ? <ReportsPane runs={runs} activeKind={reportKind} onKind={setReportKind} onRun={startRun} onRetry={retry} onCancel={cancel} /> : null}
      {reportError ? <div className="assistant-error assistant-report-global"><b>{reportError.message}</b>{reportError.hint ? <p>{reportError.hint}</p> : null}</div> : null}
    </div>
  </aside>;
}
