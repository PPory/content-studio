import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { documentVersion } from "../../lib/document-version.js";
import { ASSISTANT_SURFACES, resolveAssistantPolicy } from "../../lib/assistant-policy.js";
import { EXPERT_KINDS } from "../../lib/expert-kinds.js";
import { transitionActionResult } from "../../lib/ai/result-model.js";
import { KnowledgeCardDialog } from "../KnowledgeCardDialog.jsx";
import { IconArchive, IconArrowsDiagonal, IconHistory, IconLayoutSidebarRight, IconPlus, IconX } from "../icons.jsx";
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

/**
 * 三个「跑一次出报告」的专家：`@` 菜单里选中它们不是插一段提及，而是**直接起任务**。
 *
 * ⚠️ 这是「项目检查」搬家之后的唯一入口。原来它是上下文面板里的一组常驻按钮——
 * 那块面板要回答的是「这一轮 AI 读到什么」，而检查是「去做一件新的事」，
 * 两件事塞在一个抽屉里，结果最低频的动作占了最显眼的半屏。
 * 现在它和其他专家共用 `@`：想让谁看，就 `@` 谁。
 */
const EXPERT_RUN_KIND = new Map(EXPERT_KINDS.map((item) => [item.expertId, item.id]));

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

export function AssistantPane({ scope, surface, target = { kind: "none", editable: false }, scopeId, document = {}, materials = [], profile, promptRequest = null, handoffRequest = null, initialConversationId = "", onConversationChange, draftStorageKey = "", onContinue, onClose, headerLead = null, projectContext = null, onExpertRun = null, onCollapse }) {
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
  const selection = target.selection || null;
  const historyEnabled = policy.capabilities.history;
  const globalScope = scope === "global";
  const projectRail = scope === "project" && surface === "rail";
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
  const [historyDeleteId, setHistoryDeleteId] = useState("");
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
    setMessages([]); setActions([]); setAttachments([]); setConversationId(""); setConversationTitle("新对话"); setError(null); setUploadError(""); setLoading(shouldResume);
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
    api.assistantSkills().then((result) => { if (!cancelled) setSkills((result.skills?.items || []).map((item) => ({ id: `skill:${item.id}`, label: item.name, hint: item.description, prompt: `/${item.id} ` }))); }).catch(() => {});
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
    if (!permissionOpen && !menu && !historyMenuId && !historyDeleteId && !renameId) return undefined;
    const close = (event) => {
      if (permissionOpen && !permissionRef.current?.contains(event.target) && !event.target.closest?.(".assistant-composer__access")) setPermissionOpen(false);
      if (menu && !event.target.closest?.(".assistant-command-menu, .assistant-composer__model")) { setMenu(""); setCommandRange(null); }
      if ((historyMenuId || historyDeleteId) && !event.target.closest?.(".assistant-history__item")) { setHistoryMenuId(""); setHistoryDeleteId(""); }
    };
    const key = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPermissionOpen(false); setMenu(""); setCommandRange(null); setHistoryMenuId(""); setHistoryDeleteId(""); setRenameId("");
    };
    window.document.addEventListener("pointerdown", close);
    window.document.addEventListener("keydown", key, true);
    return () => { window.document.removeEventListener("pointerdown", close); window.document.removeEventListener("keydown", key, true); };
  }, [permissionOpen, menu, historyMenuId, historyDeleteId, renameId]);
  function scrollThreadToEnd() {
    const thread = endRef.current?.closest(".assistant-thread");
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "instant" });
  }

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
    scrollFrameRef.current = requestAnimationFrame(scrollThreadToEnd);
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
        { scopeId, conversationId, startNew: !conversationId, message, document, documentVersion: currentVersion, materials, style: policy.capabilities.writingStyle ? style : null, model, permissionMode, mode: policy.requestMode },
        (event) => {
          if (activeRequestRef.current !== requestId) return;
          if (event.type === "conversation" && event.conversationId) {
            conversationIdRef.current = event.conversationId;
            setConversationId(event.conversationId);
            onConversationChange?.(event.conversationId);
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
    onConversationChange?.("");
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
        onConversationChange?.(result.conversationId);
      }
      setAttachments((current) => [...current, { ...result.attachment, previewUrl: prepared.type.startsWith("image/") ? URL.createObjectURL(prepared) : "" }]);

      inputRef.current?.focus();
    } catch (next) { setUploadError(next.hint || next.message || "这个附件暂时无法读取"); }
    finally { setUploading(false); }
  };

  function chooseExpert(item) {
    const kind = onExpertRun ? EXPERT_RUN_KIND.get(item.id) : "";
    if (!kind) { insertCommand(`@${item.label} `); return; }
    // 检查类专家点下去就开跑，所以要把用户为了唤出菜单打的那半截 `@…` 抹掉——
    // 留在输入框里的话，下一句话会莫名其妙带上一个没人再用的提及。
    const range = commandRange;
    if (range) setInput(`${input.slice(0, range.from)}${input.slice(range.to)}`);
    setMenu(""); setMenuQuery(""); setCommandRange(null);
    onExpertRun(kind);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function chooseSkill(item) {
    insertCommand(item.prompt || `/${item.label} `);
  }

  const experts = (expertPresets.length ? expertPresets : EXPERTS)
    .filter((item) => policy.capabilities.allExperts || PROJECT_EXPERTS.has(item.id))
    // 会起任务的那几个要在菜单里说清楚「点下去会发生什么」——
    // 同一个菜单里一半插字一半跑任务，不写出来的话只能靠点一次才知道。
    .map((item) => onExpertRun && EXPERT_RUN_KIND.has(item.id) ? { ...item, hint: `${item.hint ? `${item.hint} · ` : ""}跑一次并出报告` } : item);
  const availableSkills = skills;
  const modelItems = model && !models.some((item) => item.id === model) ? [{ id: model, name: model, remembered: true }, ...models] : models;
  const menuItems = menu === "experts" ? experts : menu === "skills" ? availableSkills : modelItems.map((item) => ({ id: item.id, label: item.name || item.id, hint: item.remembered ? "最近使用" : "", provider: item.ownedBy || "" }));
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
  const composerContext = projectRail
    ? projectContext
    : (policy.capabilities.documentContext || materials.length) ? <>
        {policy.capabilities.documentContext ? <span className="assistant-context-chip" data-live={selection?.text ? "true" : undefined}>{selection?.text ? `选中 ${selection.text.length} 字` : "当前全文"}</span> : null}
        {materials.length ? <span className="assistant-context-chip">项目素材 {materials.length}</span> : null}
      </> : null;

  const dialog = <div className="assistant-pane__dialog" data-empty={centeredEmpty ? "true" : undefined}>
    {railHeaderIdle ? null : <header className="assistant-pane__context">
      {projectRail ? <>
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
          <button type="button" onClick={newConversation} title="保留当前记录并新建对话" aria-label="新对话"><IconPlus aria-hidden="true" /></button>
          {onCollapse ? <button type="button" onClick={onCollapse} title="收起协作区" aria-label="收起协作区"><IconLayoutSidebarRight aria-hidden="true" /></button> : null}
        </div>
      </> : <>
        {/* ⚠️ **完整页上「新对话」跟「历史对话」并排，不甩到另一端。**
            上一版是 `space-between` 的两端布局：左端一颗、右端一颗，中间一千像素全空——
            两颗都是「管理这段对话」的同一件事，却被排成了对立的两组，
            而那条横条因此必须一直有 58px 高才撑得住。
            现在它们成一组待在左边，右边只留「这段对话产生了什么」（存为知识卡、后台任务）。 */}
        <div className="assistant-context-actions assistant-context-actions--lead">
          {/* 浮层把自己的身份和「这轮带了什么」交给这一条 header 渲染，
              而不是在上面再叠一条自己的——两条 header 是上一版 Quick 最丑的地方：
              下面那条只剩三颗图标悬在一片空白上，看着像忘了做完。 */}
          {headerLead}
          {/* 完整页宽，「历史对话 / 新对话」带文字排在左边当主入口；
              浮层和右栏窄，它们退成右侧那排图标的一部分——
              夹在上下文芯片和窗口按钮中间的话，三组东西挤成一条，谁属于谁读不出来。 */}
          {surface === "page" && historyEnabled ? <button className="assistant-history-toggle" type="button" onClick={() => setHistoryOpen((value) => !value)} aria-pressed={historyOpen} title="历史对话"><IconHistory aria-hidden="true" /><span>历史对话</span></button> : null}
          {surface === "page" ? <button type="button" onClick={newConversation} title="保留当前记录并新建对话" aria-label="新对话"><IconPlus aria-hidden="true" /><span>新对话</span></button> : null}
        </div>
        <div className="assistant-context-actions">
          {policy.capabilities.writingStyle && enabledStyles.length ? <label className="assistant-context-style" title="本轮写作风格"><span>风格</span><select value={styleId} onChange={(event) => setStyleId(event.target.value)}><option value="">原本语气</option>{enabledStyles.map((item) => <option value={item.id} key={item.id}>{item.name}{item.customized ? " · 已校准" : ""}</option>)}</select></label> : null}
          {backgroundConversation ? <button className="assistant-background-task" type="button" onClick={() => openConversation(backgroundConversation.id)} title="查看仍在后台运行的对话"><span className="assistant-background-task__dot" /> <span>后台任务进行中</span></button> : null}
          {canArchive ? <button type="button" onClick={() => setCardOpen(true)} title="预览 Markdown 知识卡；确认后保存到 vault / 99 - 个人工作台 / 06 - 知识卡片"><IconArchive aria-hidden="true" /><span>存为知识卡</span></button> : null}
          {/* ⚠️ **侧栏里没有「历史对话」入口——全局侧栏和项目协作栏都没有。**
              这一栏是「现在这段对话」的地方，翻旧会话是另一件事：完整 AI 工作区那边
              有带搜索和时间分组的历史栏，比在 420px 里塞一个抽屉好用得多。
              代价写在这儿：**项目 scope 的旧会话目前没有别的入口**（全局历史只列 global scope）。 */}
          {surface !== "page" ? <button type="button" onClick={newConversation} title="保留当前记录并新建对话" aria-label="新对话"><IconPlus aria-hidden="true" /></button> : null}
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
      </>}
    </header>}

    <AssistantThread
      messages={messages} actions={actions} attachments={attachments} busy={busy} loading={loading}
      error={error} activity={activity} turnStartedAt={turnStartedAt} scope={scope} showRuntime={scope === "global" && surface === "page"}
      policy={policy} target={target} currentVersion={currentVersion} onPrompt={send} onPrefill={prefill} onRegenerate={() => rewind(false)}
      onEdit={() => rewind(true)} onApplyAction={applyAction} onRejectAction={rejectAction}
      onRetry={() => { setError(null); setInput(messages.at(-1)?.role === "user" ? messages.at(-1).text : input); }}
      starters={surface === "page" ? null : starters}
      endRef={endRef}
    />

    <AssistantComposer
      pendingAttachments={pendingAttachments} busy={busy} uploadError={uploadError} inputRef={inputRef}
      input={input} scope={scope} surface={surface} permissionOpen={permissionOpen} permissionRef={permissionRef}
      permissionModes={permissionModes} permissionMode={permissionMode} modePending={modePending}
      menu={menu} menuQuery={menuQuery} filteredMenuItems={filteredMenuItems} menuIndex={menuIndex}
      modelPending={modelPending} fileRef={fileRef} uploading={uploading} models={models} model={model}
      modelNotice={modelNotice} loading={loading} onSubmit={send}
      onDismissUploadError={() => setUploadError("")} onInputChange={changeInput} onInputKeyDown={inputKeyDown}
      onChoosePermissionMode={choosePermissionMode} onCloseMenu={() => setMenu("")}
      onMenuIndex={setMenuIndex} onChooseMenuItem={chooseMenuItem} onUploadFile={uploadFile}
      onTogglePermission={() => { setPermissionOpen((value) => !value); setMenu(""); }}
      onToggleModel={() => menu === "models" ? setMenu("") : openMenu("models")} onStop={stop}
      context={composerContext}
    />
    {surface === "page" ? starters : null}
    <KnowledgeCardDialog open={cardOpen} onClose={() => setCardOpen(false)} messages={messages.map((item) => ({ ...item, role: item.role === "assistant" ? "agent" : item.role }))} source={{ title: document.title || conversationTitle || "AI 助手对话", type: policy.knowledgeCardSource, engine: "Pi Agent SDK" }} />
  </div>;

  return <div className={`assistant-pane${globalScope ? " assistant-pane--standalone" : ""}${surface === "overlay" ? " assistant-pane--overlay" : ""}${projectRail ? " assistant-pane--project-rail" : ""}`}>
    {historyEnabled && historyOpen ? <AssistantHistory
      visibleConversations={visibleConversations} historyView={historyView} historyMenuId={historyMenuId}
      historyDeleteId={historyDeleteId} historyPending={historyPending} renameId={renameId}
      renameValue={renameValue} conversationId={conversationId}
      onHistoryView={(value) => { setHistoryView(value); setHistoryMenuId(""); }}
      onOpenConversation={openConversation}
      onHistoryMenu={(id) => { setHistoryDeleteId(""); setHistoryMenuId((current) => current === id ? "" : id); }}
      onHistoryDelete={setHistoryDeleteId} onRenameValue={setRenameValue}
      onCancelRename={() => setRenameId("")} onSubmitRename={submitRename}
      onStartRename={startRename} onManageHistory={manageHistory}
    /> : null}
    {dialog}
  </div>;
}
