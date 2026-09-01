import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../lib/api.js";
import { documentVersion } from "../../lib/document-version.js";
import { ASSISTANT_SURFACES, resolveAssistantPolicy } from "../../lib/assistant-policy.js";
import { EXPERT_KINDS } from "../../lib/expert-kinds.js";
import { useDialog } from "../../lib/use-dialog.js";
import { transitionActionResult } from "../../lib/ai/result-model.js";
import { KnowledgeCardDialog } from "../KnowledgeCardDialog.jsx";
import { IconArchive, IconArrowDown, IconArrowsDiagonal, IconChatList, IconDots, IconEdit, IconLayoutSidebarRight, IconPencil, IconX } from "../icons.jsx";
import { AssistantComposer } from "./AssistantComposer.jsx";
import { AssistantHistory } from "./AssistantHistory.jsx";
import { AssistantStarters, AssistantThread } from "./AssistantThread.jsx";
import "../project-assistant.css";


const expertMenuItem = (kindId, hint) => {
  const item = EXPERT_KINDS.find((entry) => entry.id === kindId);
  return { id: item.expertId, label: item.expertName, hint };
};
const EXPERTS = [
  { id: "topic-editor", label: "选题顾问", hint: "收束方向与核心问题" },
  { id: "writing-coach", label: "写作教练", hint: "梳理、续写和改稿" },
  expertMenuItem("material-research", "查知识库与公开来源"),
  expertMenuItem("quality-review", "逐项回答 Xenho 品控九问"),
  { id: "style-coach", label: "风格顾问", hint: "调准语气、节奏和表达习惯" },
  expertMenuItem("fact-check", "核对数字、日期、人物与引语"),
];

const PROJECT_EXPERTS = new Set(["writing-coach", ...EXPERT_KINDS.map((item) => item.expertId)]);

const ASSISTANT_MODEL_STORAGE_KEY = "xenho-assistant-model";

function rejectedActionIds(scopeId, conversationId) {
  try { return new Set(JSON.parse(sessionStorage.getItem(`xenho-rejected-actions:${scopeId}:${conversationId}`) || "[]")); }
  catch { return new Set(); }
}

function rememberRejectedAction(scopeId, conversationId, actionId) {
  const ids = rejectedActionIds(scopeId, conversationId);
  ids.add(actionId);
  try { sessionStorage.setItem(`xenho-rejected-actions:${scopeId}:${conversationId}`, JSON.stringify([...ids])); }
  catch {}
  return ids;
}
export const DEFAULT_ASSISTANT_MODEL = "claude-sonnet-4-6";

function storedAssistantModel() {
  try { return localStorage.getItem(ASSISTANT_MODEL_STORAGE_KEY) || DEFAULT_ASSISTANT_MODEL; }
  catch { return DEFAULT_ASSISTANT_MODEL; }
}

function rememberAssistantModel(value) {
  if (!value) return;
  try { localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, value); }
  catch {}
}

/**
 * 光标前那半截 `@…` / `/…`。
 *
 * ⚠️ **`@` 现在只有一个语义：提及。** 上一版 `@` 是专家、`/` 是 Skill，
 * 两个记号各一套语义，用户得先记住哪个对应哪个才用得上。现在 `@` 唤起的是
 * 「文章 + 专家」同一个列表（照 Notion 的「页面 / 用户」两组），
 * `/` 仍然留给 Skill——它在别处（编辑器块菜单、命令行）也一直是这个意思。
 */
function commandAt(value, cursor) {
  const before = String(value || "").slice(0, cursor);
  const match = before.match(/(^|\s)([@/])([^\s@/]*)$/u);
  if (!match) return null;
  return {
    type: match[2] === "@" ? "mention" : "skills",
    query: match[3] || "",
    from: before.length - match[2].length - (match[3] || "").length,
    to: cursor,
  };
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

export function AssistantPane({ scope, surface, target = { kind: "none", editable: false }, scopeId, document = {}, materials = [], profile, promptRequest = null, handoffRequest = null, initialConversationId = "", onConversationChange, draftStorageKey = "", onContinue, onClose, headerLead = null, headerSlots = null, projectContext = null, onCollapse }) {
  const policy = resolveAssistantPolicy({ scope, target });
  const presentation = ASSISTANT_SURFACES[surface];
  if (!presentation) throw new TypeError(`Unknown assistant surface: ${surface}`);
  // actions 只执行 policy 已声明的能力；缺失是集成错误，不能退回成“隐藏按钮”的隐式判据。
  if (policy.capabilities.insertCandidate && typeof target.actions?.insert !== "function") {
    throw new TypeError(`Assistant target "${target.kind}" requires an insert action`);
  }
  if (policy.capabilities.reviseSelection && typeof target.actions?.revise !== "function") {
    throw new TypeError(`Assistant target "${target.kind}" requires a revision action`);
  }
  if (policy.capabilities.rewriteBody && typeof target.actions?.replaceBody !== "function") {
    throw new TypeError(`Assistant target "${target.kind}" requires a replaceBody action`);
  }
  const selection = target.selection || null;
  const historyEnabled = policy.capabilities.history;
  const globalScope = scope === "global";
  const projectRail = scope === "project" && surface === "rail";
  const [messages, setMessages] = useState([]);
  const [actions, setActions] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [expertActivity, setExpertActivity] = useState([]);
  const [turnStartedAt, setTurnStartedAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // `menu` 现在只剩模型选择器一支（"" | "models"）。专家 / Skill / 文章都归 `addLevel`。
  const [menu, setMenu] = useState("");
  const [menuIndex, setMenuIndex] = useState(0);
  const [commandRange, setCommandRange] = useState(null);
  /**
   * `+` 那颗浮层的全部状态。
   * - `addLevel`：`"" | "root" | "articles" | "experts" | "skills" | "mention"`
   * - `addSource`：`"button"`（浮层自带搜索框）或 `"typing"`（过滤词来自 textarea）
   */
  const [addLevel, setAddLevel] = useState("");
  const [addSource, setAddSource] = useState("button");
  const [addQuery, setAddQuery] = useState("");
  const [addIndex, setAddIndex] = useState(0);
  /** 本轮带上的文章 / 专家 / Skill。`[{ kind, id, title, hint }]` */
  const [references, setReferences] = useState([]);
  const [articles, setArticles] = useState(null);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [conversationTitle, setConversationTitle] = useState("新对话");
  const [conversationItems, setConversationItems] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * 抽屉的键盘规矩走 `use-dialog.js` 那一份（Esc、焦点进出、焦点归还）。
   *
   * ⚠️ **`modal: false`，尽管它有遮罩。** `modal: true` 会给背景整块加 `inert`，
   * 而背景里包含**页头**——那上面正是唯一那颗关它的按钮（标题）。
   * 挡住点击这件事由遮罩自己做（它铺在正文上、并且自己带 onClick 关闭），
   * 页头留在遮罩外面，照旧能点。
   * `outsideIgnore` 排掉标题自己：不排的话「点标题关闭」会先被外部点击关一次、
   * 再被 onClick 开一次，屏幕上看着是点不灭。
   */
  const historyRef = useDialog(historyOpen, () => setHistoryOpen(false), {
    modal: false,
    dismissOnPointerDownOutside: true,
    /**
     * ⚠️ **这里要排掉的是「开它的那颗按钮」，不是标题。**
     * 开关从标题换成 `≡` 的时候这一行漏改了，后果是**点 `≡` 关不掉抽屉**：
     * 外部点击先把它关掉，紧接着 onClick 又把它打开，屏幕上就是「点了没反应」。
     * 抽屉通顶之后它自己也带了一颗收起钮，两颗都要排掉。
     */
    outsideIgnore: ".assistant-head-icon",
  });
  const [historyView, setHistoryView] = useState("recent");
  const [historyMenuId, setHistoryMenuId] = useState("");
  const [historyDeleteId, setHistoryDeleteId] = useState("");
  const [renameId, setRenameId] = useState("");
  // 页头上那一颗笔（改当前这段的名字）。和浮层里逐条重命名共用 `renameValue`——
  // 两处不可能同时开着，各存一份只会多一个要同步的状态
  const [titleEditing, setTitleEditing] = useState(false);
  // 页头右端那颗 `⋯`。规矩走 `use-dialog.js`（Esc、点外面、焦点归还）
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useDialog(moreOpen, () => setMoreOpen(false), {
    modal: false,
    dismissOnPointerDownOutside: true,
    outsideIgnore: ".assistant-head-menu-wrap",
  });
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
  const promptRequestRef = useRef("");
  const handoffRequestRef = useRef("");
  const enabledStyles = (profile?.styles || []).filter((item) => item.enabled);
  const style = enabledStyles.find((item) => item.id === styleId) || null;
  useEffect(() => {
    setStyleId((current) => enabledStyles.some((item) => item.id === current) ? current : enabledStyles.some((item) => item.id === profile?.profile?.styleId) ? profile.profile.styleId : "");
  }, [profile, scopeId]);
  useEffect(() => {
    if (!draftStorageKey) return;
    try { setInput(sessionStorage.getItem(draftStorageKey) || ""); }
    catch {}
  }, [draftStorageKey, scopeId]);
  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      if (input) sessionStorage.setItem(draftStorageKey, input);
      else sessionStorage.removeItem(draftStorageKey);
    } catch {}
  }, [draftStorageKey, input]);
  const currentVersion = documentVersion(document);

  const refreshHistory = async () => {
    if (!historyEnabled) return;
    const result = await api.assistantConversations(scopeId);
    setConversationItems(result.conversations?.items || []);
  };

  const applyConversation = (conversation) => {
    conversationIdRef.current = conversation?.id || "";
    setConversationId(conversationIdRef.current);
    onConversationChange?.(conversationIdRef.current);
    setConversationTitle(conversation?.title || "新对话");
    setMessages(conversation?.messages || []);
    setAttachments((current) => (conversation?.attachments || []).map((item) => ({ ...item, previewUrl: current.find((candidate) => candidate.id === item.id)?.previewUrl || "" })));
    const rejected = rejectedActionIds(scopeId, conversationIdRef.current);
    setActions((conversation?.actions || []).map((action) => rejected.has(action.id) && action.status !== "applied" && action.status !== "superseded" ? transitionActionResult(action, "rejected") : action));
    if (conversation?.model) { setModel(conversation.model); rememberAssistantModel(conversation.model); }
    setPermissionMode(conversation?.permissionMode || "daily");
    const running = conversation?.activeTurn?.status === "running";
    if (running) {
      setBusy(true);
      setActivity(conversation.activeTurn.stage || "正在处理");
      setExpertActivity(conversation.activeTurn.experts || []);
      setTurnStartedAt(conversation.activeTurn.startedAt || "");
    } else if (!activeRequestRef.current) {
      setBusy(false);
      setActivity("");
      setExpertActivity([]);
      setTurnStartedAt("");
    }
    if (conversation?.lastTurn?.status === "interrupted") {
      setError(Object.assign(new Error("上次对话因工作台重启而中断"), { hint: "已保留之前的对话；重新发送最后一个问题即可继续。" }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    conversationIdRef.current = "";
    promptRequestRef.current = "";
    handoffRequestRef.current = "";
    /**
     * ⚠️ **全局侧栏（overlay）不自动接上一段会话。**
     *
     * 上一版的判据是「不是完整页就续」，那是「侧栏和 `#/assistant` 共用一段对话」时代写的。
     * 现在两处分开了：侧栏是「手头这件事顺便问一句」，整页是「坐下来想一件事」——
     * 在别的页面顺手问的那句，不该在你打开 AI 助手页时已经躺在里面。
     *
     * - `rail`（项目 / 阅读）：**照旧续**。它绑着这篇稿件或这份文档，
     *   切个页签回来就丢掉对话是另一种坏。
     * - `page` / `overlay`：只有拿到明确的 `initialConversationId` 才续，
     *   否则起一段新的。侧栏那段要带进整页，走「⤢ 在完整工作区继续」。
     */
    const shouldResume = surface === "rail" || !historyEnabled || Boolean(initialConversationId);
    setMessages([]); setActions([]); setAttachments([]); setConversationId(""); setConversationTitle("新对话"); setError(null); setUploadError(""); setLoading(shouldResume); setTitleEditing(false);
    if (shouldResume) api.assistantConversation(scopeId, initialConversationId).then((result) => { if (!cancelled) applyConversation(result.conversation); }).catch((next) => { if (!cancelled) setError(next); }).finally(() => { if (!cancelled) setLoading(false); });
    if (historyEnabled) api.assistantConversations(scopeId).then((result) => { if (!cancelled) setConversationItems(result.conversations?.items || []); }).catch(() => {});
    api.assistantModels().then((result) => {
      if (cancelled) return;
      const nextModels = result.models?.items || [];
      setModels(nextModels); setModelNotice(result.models?.warning || "");
      setModel((current) => {
        const next = current || DEFAULT_ASSISTANT_MODEL;
        rememberAssistantModel(next);
        return next;
      });
    }).catch((next) => { if (!cancelled) setModelNotice(next.message || "模型目录暂时不可用"); });
    // `item.id` 是 `.agents/skills` 下的目录名——引用之后服务端要靠它读回 SKILL.md，
    // 不能在这里改写成显示名或加前缀。
    api.assistantSkills().then((result) => { if (!cancelled) setSkills((result.skills?.items || []).map((item) => ({ id: item.id, label: item.name, hint: item.description }))); }).catch(() => {});
    api.assistantModes().then((result) => { if (!cancelled) setPermissionModes(result.modes?.items || []); }).catch(() => {});

    api.assistantExperts().then((result) => { if (!cancelled) setExpertPresets((result.experts?.items || []).map((item) => ({ id: item.id, label: item.name, hint: item.description }))); }).catch(() => {});
    return () => { cancelled = true; clearTimeout(streamRef.current.timer); cancelAnimationFrame(scrollFrameRef.current); };
  }, [scopeId, historyEnabled]);
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
    if (!historyEnabled || !hasRunningHistory) return undefined;
    const timer = setInterval(() => refreshHistory().catch(() => {}), 1_500);
    return () => clearInterval(timer);
  }, [historyEnabled, scopeId, hasRunningHistory]);
  useEffect(() => {
    const typingMenu = addLevel && addSource === "typing";
    if (!permissionOpen && !menu && !typingMenu && !historyMenuId && !historyDeleteId && !renameId) return undefined;
    const close = (event) => {
      if (permissionOpen && !permissionRef.current?.contains(event.target) && !event.target.closest?.(".assistant-composer__access")) setPermissionOpen(false);
      if (menu && !event.target.closest?.(".assistant-command-menu, .assistant-composer__model")) { setMenu(""); setCommandRange(null); }
      // 打字唤起的那颗浮层由这里收；`+` 点开的那条路由 ComposerAddMenu 自己收
      // （它要能分辨「点在搜索框里」，那不该关）。
      if (typingMenu && !event.target.closest?.(".assistant-add-menu, .assistant-composer textarea")) closeAdd();
      if ((historyMenuId || historyDeleteId) && !event.target.closest?.(".assistant-history__item")) { setHistoryMenuId(""); setHistoryDeleteId(""); }
    };
    const key = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPermissionOpen(false); setMenu(""); setCommandRange(null); setHistoryMenuId(""); setHistoryDeleteId(""); setRenameId("");
      if (typingMenu) closeAdd();
    };
    window.document.addEventListener("pointerdown", close);
    window.document.addEventListener("keydown", key, true);
    return () => { window.document.removeEventListener("pointerdown", close); window.document.removeEventListener("keydown", key, true); };
  }, [permissionOpen, menu, addLevel, addSource, historyMenuId, historyDeleteId, renameId]);
  /**
   * ⚠️ **别把这个函数直接当回调传出去。** 它现在收一个参数，而
   * `requestAnimationFrame(scrollThreadToEnd)` 会把**时间戳**塞进 `behavior`——
   * 浏览器直接抛 `'13760' is not a valid enum value of type ScrollBehavior`，
   * 而抛出的地方是流式输出的每一帧。下面那处已经包成箭头函数了。
   */
  function scrollThreadToEnd(behavior = "instant") {
    const thread = endRef.current?.closest(".assistant-thread");
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior });
  }

  /**
   * 「跳到底部」。**只在你真的翻上去了才出现**——一颗常驻的按钮在你本来就在底部时
   * 是纯噪音，而它压在输入框正上方，那是这一屏最贵的一块地方。
   *
   * ⚠️ **判据是「离底还有多远」，不是「有没有滚动过」。** 一轮回答正在流式写入时，
   * 内容每几十毫秒长一次，`scrollTop` 一直在变而人并没有动——按「滚动过」算的话
   * 它会在生成过程中不停闪。留 120px 的余量：那大约是一行半，
   * 差这么点还弹一颗按钮出来，只会让人以为自己漏看了什么。
   */
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  useEffect(() => {
    const thread = endRef.current?.closest(".assistant-thread");
    if (!thread) return;
    const read = () => setAwayFromEnd(thread.scrollHeight - thread.scrollTop - thread.clientHeight > 120);
    read();
    thread.addEventListener("scroll", read, { passive: true });
    return () => thread.removeEventListener("scroll", read);
  }, [messages.length, loading]);

  useLayoutEffect(() => {
    cancelAnimationFrame(scrollFrameRef.current);
    scrollThreadToEnd();
  }, [messages.length, actions.length, busy]);

  function flushStream(streamingId) {
    const current = streamRef.current;
    if (!current.text || current.id !== streamingId) return;
    const text = current.text; current.text = ""; current.timer = 0;
    setMessages((items) => items.map((item) => item.id === streamingId ? { ...item, text: (item.text || "") + text } : item));
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => scrollThreadToEnd());
  }

  function queueStream(streamingId, text) {
    streamRef.current.id = streamingId; streamRef.current.text += text;
    if (!streamRef.current.timer) streamRef.current.timer = window.setTimeout(() => flushStream(streamingId), 42);
  }

  const send = async (text = input) => {
    const message = String(text || "").trim();
    const pendingAttachments = attachments.filter((item) => !item.usedAt);
    if ((!message && !pendingAttachments.length) || busy) return;
    const sentReferences = references.map((item) => ({ kind: item.kind, id: item.id, title: item.title }));
    const optimistic = { id: `optimistic-${Date.now()}`, role: "user", text: message, attachmentIds: pendingAttachments.map((item) => item.id), references: sentReferences, createdAt: new Date().toISOString() };
    const streamingId = `streaming-${Date.now()}`;
    const requestId = Symbol("assistant-request");
    setMessages((current) => [...current, optimistic, { id: streamingId, role: "assistant", text: "", createdAt: new Date().toISOString(), pending: true, model }]);
    activeRequestRef.current = requestId;
    // 引用**发出去就清空**：它说的是「这一句带了什么」，不是会话级设置。
    // 留着的话下一句会莫名其妙再带一遍同样的全文，而屏幕上那行芯片看着毫无变化。
    setInput(""); setMenu(""); setReferences([]); closeAdd(); setBusy(true); setActivity("正在读取上下文"); setExpertActivity([]); setTurnStartedAt(new Date().toISOString()); setError(null); setUploadError("");
    try {
      const result = await api.assistantChatStream(
        { scopeId, conversationId, startNew: !conversationId, message, references: sentReferences, document, documentVersion: currentVersion, materials, style: policy.capabilities.writingStyle ? style : null, model, permissionMode, mode: policy.requestMode },
        (event) => {
          if (activeRequestRef.current !== requestId) return;
          if (event.type === "conversation" && event.conversationId) {
            conversationIdRef.current = event.conversationId;
            setConversationId(event.conversationId);
            onConversationChange?.(event.conversationId);
            refreshHistory().catch(() => {});
          }
          if (event.type === "status") setActivity(event.stage || "Pi 正在继续处理");
          if (event.type === "expert" && event.kind) {
            setExpertActivity((current) => [...current.filter((item) => item.kind !== event.kind), {
              id: event.id,
              batchId: event.batchId,
              kind: event.kind,
              expertName: event.expertName,
              status: event.status,
              stageLabel: event.stageLabel,
              percent: event.percent,
              error: event.error,
            }]);
          }
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
    onConversationChange?.("");
    setTitleEditing(false);
    setConversationId(""); setConversationTitle("新对话"); setPermissionMode("daily"); setMessages([]); setActions([]); setAttachments([]); setReferences([]); closeAdd(); setError(null); setUploadError(""); setInput(""); setBusy(false); setActivity(""); setTurnStartedAt("");
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
        onConversationChange?.(result.conversationId);
      }
      setAttachments((current) => [...current, { ...result.attachment, previewUrl: prepared.type.startsWith("image/") ? URL.createObjectURL(prepared) : "" }]);

      inputRef.current?.focus();
    } catch (next) { setUploadError(next.hint || next.message || "这个附件暂时无法读取"); }
    finally { setUploading(false); }
  };

  // 专家仍以结构化引用跟随本轮消息；素材、品控和事实三类由服务端确定性启动
  // 子 Agent，写作/选题/风格类则继续作为主会话的方法约束。
  const experts = (expertPresets.length ? expertPresets : EXPERTS)
    .filter((item) => policy.capabilities.allExperts || PROJECT_EXPERTS.has(item.id));
  const modelItems = model && !models.some((item) => item.id === model) ? [{ id: model, name: model, remembered: true }, ...models] : models;
  const filteredMenuItems = modelItems.map((item) => ({ id: item.id, label: item.name || item.id, hint: item.remembered ? "最近使用" : "", provider: item.ownedBy || "" })).slice(0, 80);

  function openMenu(type) {
    setMenu(type); setMenuIndex(0); setCommandRange(null); closeAdd();
  }

  /**
   * `+` 浮层的候选。二级各只列自己那一组；`@` 打字唤起的 `mention` 把
   * 「文章 / 专家」两组一起列——照参考图里 Notion 的「页面 / 用户」。
   *
   * ⚠️ **已经加进去的不再列。** 同一篇文章引用两次没有意义，而列表里留着它
   * 只会让人以为第一次没点上，于是点第二次。
   */
  const addGroups = (() => {
    if (!addLevel || addLevel === "root") return [];
    const taken = new Set(references.map((item) => `${item.kind}:${item.id}`));
    const match = (item) => !addQuery || `${item.label} ${item.id} ${item.hint || ""}`.toLowerCase().includes(addQuery.toLowerCase());
    const pick = (kind, source) => source
      .map((item) => ({ ...item, kind }))
      .filter((item) => !taken.has(`${kind}:${item.id}`) && match(item))
      .slice(0, 40);
    const groups = [];
    if (addLevel === "mention") {
      const knowledge = { id: "knowledge-base", label: "知识库", hint: "检索持续维护的 Wiki 页面", kind: "knowledge" };
      if (!taken.has("knowledge:knowledge-base") && match(knowledge)) groups.push({ key: "knowledge", label: "知识库", items: [knowledge] });
    }
    if (addLevel === "articles" || addLevel === "mention") groups.push({ key: "articles", label: "文章", items: pick("article", articles || []) });
    if (addLevel === "experts" || addLevel === "mention") groups.push({ key: "experts", label: "专家", items: pick("expert", experts) });
    if (addLevel === "skills") groups.push({ key: "skills", label: "Skill", items: pick("skill", skills) });
    return groups.filter((group) => group.items.length);
  })();

  /**
   * 文章列表**用到才拉**。它走 `api.projects()`，那个接口对每个项目跑一次全量 DTO；
   * 每次开输入框都拉一遍是白花的开销，而这个二级菜单大部分会话里根本不会被点开。
   */
  async function loadArticles() {
    if (articles || articlesLoading) return;
    setArticlesLoading(true);
    try {
      const result = await api.projects();
      setArticles((result.projects || []).map((item) => ({ id: item.id, label: item.title || "未命名内容", hint: item.stage || "" })));
    } catch { setArticles([]); }
    finally { setArticlesLoading(false); }
  }

  function openAdd(level, source = "button") {
    setAddLevel(level); setAddIndex(0); setAddSource(source);
    if (source === "button") setAddQuery("");
    setMenu(""); setPermissionOpen(false);
    if (level === "articles" || level === "mention") loadArticles();
  }

  function closeAdd() {
    setAddLevel(""); setAddQuery(""); setAddIndex(0); setAddSource("button"); setCommandRange(null);
  }

  /** 选中之后把用户为了唤出菜单打的那半截 `@…` / `/…` 抹掉——留着的话下一句话会莫名带上它。 */
  function dropCommandText(replacement = "") {
    const range = commandRange;
    if (!range) return;
    const next = `${input.slice(0, range.from)}${replacement}${input.slice(range.to)}`;
    setInput(next);
    const cursor = range.from + replacement.length;
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(cursor, cursor); });
  }

  function chooseAddItem(item) {
    if (!item) return;
    dropCommandText();
    closeAdd();
    setReferences((current) => current.some((entry) => entry.kind === item.kind && entry.id === item.id)
      ? current
      : [...current, { kind: item.kind, id: item.id, title: item.label, hint: item.hint || "" }]);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function removeReference(item) {
    setReferences((current) => current.filter((entry) => !(entry.kind === item.kind && entry.id === item.id)));
  }

  async function chooseModel(item) {
    const previous = model;
    setMenu(""); setCommandRange(null); setModel(item.id); rememberAssistantModel(item.id); setModelPending(true); setError(null);
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
    const previousItems = action === "delete" ? conversationItems : null;
    if (action === "delete") setConversationItems((current) => current.filter((candidate) => candidate.id !== item.id));
    setHistoryPending(`${item.id}:${action}`); setHistoryMenuId(""); setHistoryDeleteId(""); setError(null);
    try {
      const result = await api.manageAssistantConversation({ scopeId, conversationId: item.id, action, ...payload });
      setConversationItems(result.conversations?.items || []);
      if (result.conversation && item.id === conversationId) applyConversation(result.conversation);
      if (["archive", "delete"].includes(action) && item.id === conversationId) await newConversation();
      if (action === "restore") setHistoryView("recent");
    } catch (next) {
      if (action === "delete") {
        const refreshed = await api.assistantConversations(scopeId).catch(() => null);
        setConversationItems(refreshed?.conversations?.items || previousItems || []);
      }
      setError(next);
    } finally { setHistoryPending(""); }
  }

  function startRename(item) {
    setHistoryMenuId(""); setRenameId(item.id); setRenameValue(item.title || "新对话");
    requestAnimationFrame(() => window.document.querySelector(`[data-rename-id="${item.id}"]`)?.focus());
  }

  /**
   * 页头那颗笔的提交。**空标题 = 放弃**，不是「把名字清空」——
   * 一段没有名字的对话在历史列里是一行空白，比原来的名字糟得多。
   */
  async function submitTitle() {
    const title = renameValue.trim();
    setTitleEditing(false);
    if (!conversationId || !title || title === conversationTitle) return;
    await manageHistory({ id: conversationId }, "rename", { title });
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

  function rejectAction(actionId) {
    if (!actionId || !conversationId) return;
    rememberRejectedAction(scopeId, conversationId, actionId);
    setActions((items) => items.map((action) => action.id === actionId ? transitionActionResult(action, "rejected") : action));
  }

  function changeInput(event) {
    const value = event.target.value;
    const command = commandAt(value, event.target.selectionStart ?? value.length);
    setInput(value);
    if (command) {
      if (addLevel !== command.type) openAdd(command.type, "typing");
      setAddQuery(command.query); setAddIndex(0); setAddSource("typing");
      setCommandRange({ from: command.from, to: command.to });
    } else if (addLevel && addSource === "typing") {
      closeAdd();
    }
  }

  /**
   * ⚠️ **`+` 浮层开着时 Enter 是「选中这一项」，不是发送。**
   * 打字唤起的那条路焦点仍然在 textarea 上，键盘事件到不了浮层自己那个 `onKeyDown`——
   * 所以导航必须在这里再接一遍。`+` 点开的那条路焦点在浮层里，走它自己那份。
   */
  function inputKeyDown(event) {
    const addItems = addSource === "typing" ? addGroups.flatMap((group) => group.items) : [];
    if (addItems.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setAddIndex((value) => (value + step + addItems.length) % addItems.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); chooseAddItem(addItems[addIndex] || addItems[0]); return; }
      if (event.key === "Escape") { event.preventDefault(); closeAdd(); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
  }

  /**
   * `promptRequest`：**一个新问题**，真的发出去跑一遍。
   * 阅读里划词「问 AI」、整篇提问走这条——那些问题还没有答案。
   */
  useEffect(() => {
    const requestId = String(promptRequest?.id || "");
    if (!requestId || loading || busy || promptRequestRef.current === requestId) return;
    promptRequestRef.current = requestId;
    send(promptRequest?.text || "");
  }, [promptRequest?.id, loading, busy]);

  /**
   * 正文里那次问答**搬**进来，成为一段可以接着聊的对话。
   *
   * ⚠️ **不是重新发一遍。** 上一版把用户那句指令交给 `send()`，模型于是再答一次——
   * 用户刚在正文里读完的答案没了，屏幕上是同一个问题的第二个答案。他点「对话」的意思是
   * 「把这段挪过来继续」，不是「换一个答案」。
   *
   * 落库由服务端做（`/api/assistant/adopt`），这里只把返回的对话装上：
   * 这段问答必须真的进历史，否则切个页签回来就没了。
   */
  useEffect(() => {
    const requestId = String(handoffRequest?.id || "");
    if (!requestId || handoffRequestRef.current === requestId) return;
    handoffRequestRef.current = requestId;
    let cancelled = false;
    api.adoptAssistantExchange({
      scopeId,
      prompt: handoffRequest.prompt || "",
      answer: handoffRequest.answer || "",
      model,
      permissionMode,
    }).then((result) => {
      if (cancelled || !result.conversation) return;
      applyConversation(result.conversation);
      refreshHistory().catch(() => {});
    }).catch((next) => { if (!cancelled) setError(next); });
    return () => { cancelled = true; };
    // 由一次性的 request id 触发；其余入参从当前状态读。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffRequest?.id]);

  const visibleConversations = conversationItems.filter((item) => historyView === "archived" ? Boolean(item.archivedAt) : !item.archivedAt);
  const canArchive = !busy && messages.some((item) => item.role === "assistant" && item.text);
  const backgroundConversation = conversationItems.find((item) => item.activeTurn?.status === "running" && item.id !== conversationId);
  const pendingAttachments = attachments.filter((item) => !item.usedAt);

  /**
   * 空态 = 还没有任何消息、没有在生成、也不在加载。
   *
   * ⚠️ **只有完整工作区页把输入器提到中间。** 侧栏（全局 / 项目 / 阅读）一律**贴底**——
   * 侧栏是「一边看正文一边问」的地方，输入器的位置必须和正文里其它常驻控件一样稳定；
   * 而且窄栏里居中省不下多少距离，却让「第一条消息发出去」时输入器整个往下跳一次。
   */
  const emptyState = !messages.length && !busy && !loading;
  // ⚠️ 必须定义在 `starters` 之前：那儿要用它，const 没有提升，晚一行就是 TDZ 崩整页。
  const prefill = (value) => { setInput(value); requestAnimationFrame(() => inputRef.current?.focus()); };
  const centeredEmpty = emptyState && surface === "page";
  /**
   * 入口卡：
   * - 完整页：在居中的输入器**下面**，作为「不知道说什么」的兜底。
   * - 项目 / 阅读栏：在贴底输入器**上面**（跟着空态问候走）——它们是针对当前稿件/文档的
   *   两条具体建议，值得留。
   * - 全局侧栏：**不给**。那三张是通用入口，而侧栏本来就是顺手问一句的地方，
   *   三张卡把一栏塞满，反而挡住了「直接开口」这条主路径。
   */
  const starters = emptyState && surface !== "overlay"
    ? <AssistantStarters scope={scope} onPrompt={scope === "project" ? prefill : send} />
    : null;

  /**
   * ⚠️ **阅读侧栏的这条 header 只在它有话说的时候才画。**
   *
   * 阅读页右栏本来就有一条页签（标记 / 衍生 / AI 助手 / 收起），下面再压一条
   * 「当前全文 ………… ＋」——两条加起来 88px，而全局侧栏做完同样的事只用了 44px。
   * 更要紧的是空态下这一条里**没有一个字是新信息**：「当前全文」是恒定值，
   * 而「新对话」在一段还没开始的对话里点了等于没点。
   * 有选区（「选中 N 字」是真变化）、有消息、或有后台任务时它才出现。
   *
   * 项目右栏不适用：它那条 header 承载着「当前稿件」上下文入口，一直有内容。
   */
  const railHeaderIdle = surface === "rail" && !projectRail
    && !selection?.text && !messages.length && !backgroundConversation && !canArchive;

  /**
   * 「这一轮 AI 读到什么」——**放在输入框里**，见 `AssistantComposer` 里那段注释。
   *
   * 项目栏交出去的是一个可点的触发器加它的面板（`projectContext`）；
   * 其它 surface 只有两颗不可点的事实芯片。两者落在同一个位置，
   * 所以用户在任何一栏里找「它读的是什么」都是同一处。
   */
  /**
   * ⚠️ **「当前全文」这颗芯片是**回执**，只在**真的有正文**时才画。**
   *
   * 上一版的判据是 `policy.capabilities.documentContext`——那是「这一档**允许**读全文」，
   * 不是「这一轮**真的带了**全文」。于是阅读栏里文档没接上时它照样写着「当前全文」，
   * 而模型回的是「您尚未开始编写正文」：**界面在替一件没发生的事打包票**。
   * 这比不显示糟得多——用户会照着这条回执去判断模型为什么答错。
   */
  const hasDocumentBody = Boolean(String(document?.body || "").trim());
  const composerContext = projectRail
    ? projectContext
    : (hasDocumentBody || selection?.text || materials.length) ? <>
        {selection?.text
          ? <span className="assistant-context-chip" data-live="true">选中 {selection.text.length} 字</span>
          : hasDocumentBody ? <span className="assistant-context-chip">当前全文</span> : null}
        {materials.length ? <span className="assistant-context-chip">项目素材 {materials.length}</span> : null}
      </> : null;

  /**
   * ⚠️ **完整页上这一条 header 就是外壳的页头，不是它下面的第二条。**
   *
   * 上一版两条并排：外壳画「AI助手 ✦」，pane 自己再画「新对话 ⌄ …… ＋」——
   * 两条 40px 的横栏叠在一起，中间那道线把一件事切成了两半。
   * 给了插槽（`headerSlots`）就把左右两段 portal 进页头：
   * 页名 + 对话标题读成一条面包屑「AI助手 / 帮我梳理这周的选题」。
   * 没给插槽的（浮层、项目栏、阅读栏）照旧就地画自己那一条。
   */
  const headerParts = (lead, end, center = null) => headerSlots
    ? <>
        {headerSlots.lead ? createPortal(lead, headerSlots.lead) : null}
        {center && headerSlots.center ? createPortal(center, headerSlots.center) : null}
        {headerSlots.end ? createPortal(end, headerSlots.end) : null}
      </>
    : <header className="assistant-pane__context">{lead}{center}{end}</header>;

  const dialog = <div className="assistant-pane__dialog" data-empty={centeredEmpty ? "true" : undefined}>
    {railHeaderIdle ? null : (projectRail ? <header className="assistant-pane__context">
      <>
        {/* ⚠️ **项目右栏的头只有一条。**
            上一版是两条：44px 的「协作」和 39px 的「当前稿件 · 已用素材 4」，
            两条都是同一档灰细字，谁也没压过谁——占了 83px 却读不出主次。
            现在它们是同一行的一个面包屑：「协作」是这块区域的名字（安静），
            后半截是唯一可点的东西（当前上下文）。上下文面板改挂在这条 header 上，
            所以它仍然铺满整栏宽度，不会缩成触发器那么窄。 */}
        <div className="assistant-pane__crumb">
          <strong>协作</strong>
        </div>
        <div className="assistant-context-actions">
          {backgroundConversation ? <button className="assistant-background-task" type="button" onClick={() => openConversation(backgroundConversation.id)} title="查看仍在后台运行的对话"><span className="assistant-background-task__dot" /></button> : null}
          <button type="button" onClick={newConversation} title="保留当前记录并新建对话" aria-label="新对话"><IconEdit aria-hidden="true" /></button>
          {onCollapse ? <button type="button" onClick={onCollapse} title="收起协作区" aria-label="收起协作区"><IconLayoutSidebarRight aria-hidden="true" /></button> : null}
        </div>
      </>
    </header> : headerParts(<>
        {/**
          * ⚠️ **完整页的左段就是「当前对话标题 ⌄」，历史对话是它拉开的那块浮层。**
          *
          * 上一版是一颗写着「历史对话」的按钮 + 一条常驻 248px 的左栏。两个问题：
          * 那颗按钮和标题说的是同一件事（你在哪段对话里），却分成两处；
          * 而那条栏在你**不翻旧会话**的时候（也就是绝大多数时候）白占八分之一屏宽。
          *
          * 照 Circle 的 agent 页：标题即入口。点开是搜索 + 最近/已归档 + 会话列表，
          * 每条仍然带重命名 / 置顶 / 归档 / 删除——**一个功能都没丢**，只是不再常驻。
          * 右边那颗 `+` 留在动作组里（见下面 `surface !== "page"` 那条的改动）。
          */}
        {/* 浮层把自己的身份和「这轮带了什么」交给这一条 header 渲染，
            而不是在上面再叠一条自己的——两条 header 是上一版 Quick 最丑的地方：
            下面那条只剩三颗图标悬在一片空白上，看着像忘了做完。 */}
        {headerLead ? <div className="assistant-context-actions assistant-context-actions--lead">{headerLead}</div> : null}
        {/**
          * 左端只有一颗 `≡`：**开合历史抽屉**。
          *
          * ⚠️ **它和标题都不套在 `.assistant-context-actions` 里。**
          * 那个类上挂着一条 `button:not(:has(span)) { width: 28px }`（给只有图标的按钮用的），
          * 而它是**后代**选择器——套进去会把里面的东西按图标钮的尺寸压一遍。
          * 这两样本来也不是「动作」：一个是入口，一个是位置。
          *
          * ⚠️ **标题从这儿搬到正中去了**（`center` 插槽）。它当过一阵子「点开是历史」的触发器，
          * 而那让一个东西干了两件事：既是「你在哪一段对话」，又是「去别的对话」。
          * 拆开之后各自只说一件事——`≡` 说「换一段」，正中的标题说「这一段叫什么」。
          */}
        {surface === "page" && historyEnabled ? (
          <button
            type="button"
            className="assistant-head-icon"
            aria-expanded={historyOpen}
            aria-haspopup="dialog"
            onClick={() => setHistoryOpen((value) => !value)}
            title="历史对话"
            aria-label="历史对话"
          >
            <IconChatList aria-hidden="true" />
          </button>
        ) : null}
      </>, <>
        <div className="assistant-context-actions">
          {policy.capabilities.writingStyle && enabledStyles.length ? <label className="assistant-context-style" title="本轮写作风格"><span>风格</span><select value={styleId} onChange={(event) => setStyleId(event.target.value)}><option value="">原本语气</option>{enabledStyles.map((item) => <option value={item.id} key={item.id}>{item.name}{item.customized ? " · 已校准" : ""}</option>)}</select></label> : null}
          {/* ⚠️ **浮层里不画它。** 那颗绿芯片一直亮在浮层最上面一行，
              而浮层是个「问一句就走」的地方——你在这儿不会去接管另一段后台对话。
              入口没丢：完整 AI 页的页头上有同一颗，那儿才是管会话的地方。 */}
          {backgroundConversation && surface !== "overlay" ? <button className="assistant-background-task" type="button" onClick={() => openConversation(backgroundConversation.id)} title="查看仍在后台运行的对话"><span className="assistant-background-task__dot" /> <span>后台任务进行中</span></button> : null}
          {/* ⚠️ **完整页上「存为知识卡」收进右端那颗 `⋯`。**
              它是「这段对话结束之后要不要留点什么」——**一段对话里最多用一次**，
              而它带字的按钮一直摆在页头上，和每天都点的「新对话」抢同一排位置。
              侧栏和项目栏窄，那儿仍然是直接一颗图标钮：再套一层菜单是多一次点击。 */}
          {/* ⚠️ **只留图标，不带字。** 这一栏最窄处只有 360px，而它旁边那两颗
              （新对话、收起）本来就是纯图标——三颗并排里唯一带字的那颗会把整条压偏，
              而它并不比另外两颗更常用。说明留在 `title` 和 `aria-label` 里。
              ⚠️ 带 `<span>` 的话还会被 `.assistant-context-actions button:not(:has(span))`
              那条排除在 28px 之外，三颗高矮不齐——这是那条后代选择器的又一次现场。 */}
          {canArchive && surface !== "page" ? <button type="button" onClick={() => setCardOpen(true)} title="存入 Wiki：先生成候选，再确认归档" aria-label="存入 Wiki"><IconArchive aria-hidden="true" /></button> : null}
          {/* ⚠️ **侧栏里没有「历史对话」入口——全局侧栏和项目协作栏都没有。**
              这一栏是「现在这段对话」的地方，翻旧会话是另一件事：完整 AI 工作区那边
              有带搜索和时间分组的历史栏，比在 420px 里塞一个抽屉好用得多。
              代价写在这儿：**项目 scope 的旧会话目前没有别的入口**（全局历史只列 global scope）。 */}
          {/* ⚠️ **三个 surface 是同一颗图标钮。** 完整页上它以前是带字的「＋新对话」，
              和左边那颗「历史对话」并排——而标题接管入口之后，那两个字只是把
              「开一段新的」说得更长了一点。
              ⚠️ **记号是 compose（带加号的笔）不是光秃秃的 `+`。** 一个孤立的加号
              在输入框那一带已经有主人了（加附件）；同一屏两个 `+` 管两件事，
              用户得先试一下才知道哪个是哪个。 */}
          <button type="button" onClick={newConversation} title="保留当前记录并新建对话" aria-label="新对话"><IconEdit aria-hidden="true" /></button>
          {/**
            * ⚠️ **不用 `ui.jsx` 的 `MenuButton`。** 那一个是给「新建内容」那类菜单做的：
            * 每一行都强制画一枚右端的 `+`（「这会新建一个东西」），而且它读的是
            * `item.title` / `item.hint` 两段。塞一个「存为知识卡」进去的结果是
            * **屏幕上只剩那句长长的 hint，右边还挂着一个莫名其妙的 `+`**——
            * 一个存东西的动作被画成了新建。
            * 这儿要的是「图标 + 一个短词」的一列，自己画十行就够。
            */}
          {surface === "page" && canArchive ? (
            <div className="assistant-head-menu-wrap">
              <button
                type="button"
                className="assistant-head-icon"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((value) => !value)}
                title="更多"
                aria-label="更多"
              >
                <IconDots aria-hidden="true" />
              </button>
              {moreOpen ? (
                <div className="assistant-head-menu" role="menu" ref={moreRef}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMoreOpen(false); setCardOpen(true); }}
                    title="先生成候选，再确认归档到 Wiki"
                  >
                    <IconArchive aria-hidden="true" />
                    存入 Wiki
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {/* 「去完整工作区」是**导航**，不是发送。上一版把它摆在发送键旁边，
              一行文字按钮的横向重量压过了那颗 30px 的主操作——
              浮层里唯一该抢眼的东西是发送。挪到头部和其它窗口控件一起。 */}
          {/* 「窗口动作」单独成一组。⚠️ 不要靠 `:first-of-type` 之类的位置选择器去画分隔线——
              那匹配的是「第一个 button」，而这一排前面还有存知识卡、历史、新对话，
              线会画在完全不相干的地方，而且**看着只是没生效**，不会报错。 */}
          {(surface === "overlay" && onContinue) || onClose ? <span className="assistant-context-window">
            {surface === "overlay" && onContinue ? <button type="button" className="assistant-context-expand" onClick={onContinue} title="在完整 AI 工作区继续这段对话" aria-label="在完整 AI 工作区继续"><IconArrowsDiagonal aria-hidden="true" /></button> : null}
            {onClose ? <button type="button" className="assistant-context-expand" onClick={onClose} title="关闭（Esc）" aria-label="关闭 AI 助手"><IconX aria-hidden="true" /></button> : null}
          </span> : null}
        </div>
      </>, surface === "page" ? <div className="assistant-title-wrap">
        {/**
          * 正中：**这一段叫什么**，点旁边那枚笔就地改。
          * ⚠️ **不弹面板。** 参考的那个应用点笔是弹一个「重命名」对话框——
          * 一个只有一个输入框的对话框，为了改一行字要开一层、关一层。
          * 名字就写在这儿，改它的地方就该在原地。
          * ⚠️ 没落库之前不画笔（`conversationId` 为空）：那时标题是占位的「新对话」，
          * 改了没有东西可存。
          */}
        {titleEditing ? (
          <form
            className="assistant-title-edit"
            onSubmit={(event) => { event.preventDefault(); submitTitle(); }}
          >
            <input
              autoFocus
              value={renameValue}
              aria-label="给这段对话改名"
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={submitTitle}
              onKeyDown={(event) => {
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setTitleEditing(false); }
              }}
            />
          </form>
        ) : <>
          <span className="assistant-title assistant-title--static">{conversationTitle || "新对话"}</span>
          {conversationId ? (
            <button
              type="button"
              className="assistant-title-rename"
              onClick={() => { setRenameValue(conversationTitle || ""); setTitleEditing(true); }}
              title="给这段对话改名"
              aria-label="给这段对话改名"
            >
              <IconPencil aria-hidden="true" />
            </button>
          ) : null}
        </>}
      </div> : null))}

    <AssistantThread
      messages={messages} actions={actions} attachments={attachments} busy={busy} loading={loading}
      error={error} activity={activity} expertActivity={expertActivity} turnStartedAt={turnStartedAt} scope={scope} showRuntime={scope === "global" && surface === "page"}
      policy={policy} target={target} currentVersion={currentVersion} documentLength={String(document.body || "").length}
      onPrompt={send} onPrefill={prefill} onRegenerate={() => rewind(false)}
      onEdit={() => rewind(true)} onApplyAction={applyAction} onRejectAction={rejectAction}
      onRetry={() => { setError(null); setInput(messages.at(-1)?.role === "user" ? messages.at(-1).text : input); }}
      starters={surface === "page" ? null : starters}
      endRef={endRef}
    />

    {/**
      * ⚠️ **它自己不占高度**（`.assistant-jump` 那一层是 `height: 0`），
      * 所以出现和消失都不会把输入框往下顶一下——被顶一下的输入框正是
      * 「我打字的地方怎么自己动了」那类最惹人烦的抖动。
      */}
    {awayFromEnd && messages.length ? (
      <div className="assistant-jump">
        <button type="button" onClick={() => scrollThreadToEnd("smooth")} title="回到最新一条" aria-label="回到最新一条">
          <IconArrowDown aria-hidden="true" />
        </button>
      </div>
    ) : null}

    <AssistantComposer
      pendingAttachments={pendingAttachments} busy={busy} uploadError={uploadError} inputRef={inputRef}
      input={input} scope={scope} surface={surface} permissionOpen={permissionOpen} permissionRef={permissionRef}
      permissionModes={permissionModes} permissionMode={permissionMode} modePending={modePending}
      menu={menu} filteredMenuItems={filteredMenuItems} menuIndex={menuIndex}
      references={references} addLevel={addLevel} addSource={addSource} addQuery={addQuery}
      addIndex={addIndex} addGroups={addGroups} addLoading={articlesLoading && !articles}
      modelPending={modelPending} fileRef={fileRef} uploading={uploading} models={models} model={model}
      modelNotice={modelNotice} loading={loading} onSubmit={send}
      onDismissUploadError={() => setUploadError("")} onInputChange={changeInput} onInputKeyDown={inputKeyDown}
      onChoosePermissionMode={choosePermissionMode}
      onMenuIndex={setMenuIndex} onChooseMenuItem={chooseModel} onUploadFile={uploadFile}
      onAddLevel={(level) => openAdd(level, "button")} onAddQuery={(value) => { setAddQuery(value); setAddIndex(0); }}
      onAddIndex={setAddIndex} onChooseAddItem={chooseAddItem} onCloseAdd={closeAdd} onRemoveReference={removeReference}
      onTogglePermission={() => { setPermissionOpen((value) => !value); setMenu(""); closeAdd(); }}
      onToggleModel={() => menu === "models" ? setMenu("") : openMenu("models")} onStop={stop}
      context={composerContext}
    />
    {surface === "page" ? starters : null}
    <KnowledgeCardDialog open={cardOpen} onClose={() => setCardOpen(false)} messages={messages.map((item) => ({ ...item, role: item.role === "assistant" ? "agent" : item.role }))} source={{ title: document.title || conversationTitle || "AI 助手对话", type: policy.knowledgeCardSource, engine: "Pi Agent SDK" }} scopeId={scopeId} conversationId={conversationId} onConversation={applyConversation} />
  </div>;

  return <div className={`assistant-pane${globalScope ? " assistant-pane--standalone" : ""}${surface === "overlay" ? " assistant-pane--overlay" : ""}${projectRail ? " assistant-pane--project-rail" : ""}`}>
    {/**
      * 历史对话：**一条压着对话滑进来的抽屉**，不是常驻的一列。
      *
      * ⚠️ **这块地方来回过三次，三次的理由都记下来，别再绕回去。**
      *   1. 常驻 248px 的一列 —— 翻旧会话是偶尔一次的动作，那一列在你不翻的时候
      *      （绝大多数时候）白占八分之一屏宽。
      *   2. 挂在标题下的浮层 —— 宽度够了，但它**点外面就关**：慢慢往下翻的时候
      *      手一滑点到正文，整块就没了，得重新开、重新滚。
      *   3. 现在：抽屉 + 遮罩。**遮罩不是装饰，它是那条「稳得住」的实现**——
      *      正文被盖住，也就没有「误点正文把它关掉」这回事；同时它自己说清了
      *      「这是临时盖上来的一层，翻完就走」。
      *
      * ⚠️ **通顶：抽屉和遮罩都从窗口最上沿起，页头也一起盖住。**
      * 上一版只盖到页头以下（理由是「页头上有唯一那颗关它的按钮」），
      * 落地一看是**上面一截亮、下面一大块暗**——没读成「临时盖上来的一层」，
      * 读成了「这块渲染坏了」。改法不是把遮罩缩回去，是让抽屉自己补一颗收起钮。
      * 它靠 `lib/view-slots.js` 的 `overlay` 插槽 portal 到外壳那一层：
      * 这块 DOM 自己所在的 `.main` 顶已经在页头**以下**了，怎么定位都够不到页头。
      */}
    {historyEnabled && historyOpen && surface === "page" && headerSlots?.overlay ? createPortal(<>
      <div className="assistant-history-scrim" onClick={() => setHistoryOpen(false)} aria-hidden="true" />
      <aside className="assistant-history-drawer" ref={historyRef} aria-label="历史对话">
        {/**
          * ⚠️ **抽屉自己带一颗收起钮，落在抽屉的右上角。**
          *
          * 上一版把它放在左边、和页头那颗 `≡` 严格重合，理由是「屏幕上就是同一颗按钮」。
          * 参考（genspark 的任务列表）放在右边，试下来右边更对：抽屉推开之后，
          * 视线是从左边那一列标题**往右**走的，收起它的动作也该在那条路的终点；
          * 左上角那个位置已经被「任务列表 / 历史对话」这个标题占着了。
          * 抽屉是通顶的，会把页头那颗盖住——没有这一颗的话，开它的按钮在开着的时候
          * 就消失了，只能靠点遮罩或 Esc 关。两颗在屏幕上是同一个位置、同一个记号，
          * 用起来就是「同一颗按钮，点一下开、再点一下关」。
          */}
        <div className="assistant-history-drawer__head">
          <button
            type="button"
            className="assistant-head-icon"
            onClick={() => setHistoryOpen(false)}
            title="收起历史对话"
            aria-label="收起历史对话"
          >
            <IconChatList aria-hidden="true" />
          </button>
        </div>
        <AssistantHistory
          visibleConversations={visibleConversations} historyView={historyView} historyMenuId={historyMenuId}
          historyDeleteId={historyDeleteId} historyPending={historyPending} renameId={renameId}
          renameValue={renameValue} conversationId={conversationId}
          onHistoryView={(value) => { setHistoryView(value); setHistoryMenuId(""); }}
          onOpenConversation={(id) => { openConversation(id); setHistoryOpen(false); }}
          onHistoryMenu={(id) => { setHistoryDeleteId(""); setHistoryMenuId((current) => current === id ? "" : id); }}
          onHistoryDelete={setHistoryDeleteId} onRenameValue={setRenameValue}
          onCancelRename={() => setRenameId("")} onSubmitRename={submitRename}
          onStartRename={startRename} onManageHistory={manageHistory}
        />
      </aside>
    </>, headerSlots.overlay) : null}
    {dialog}
  </div>;
}
