import { memo, useEffect, useMemo, useRef, useState } from "react";
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

function Working({ label = "Harness 正在处理", detail = "" }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);
  const stage = detail || (seconds < 3 ? "正在读取上下文" : seconds < 12 ? "正在组织回答" : seconds < 30 ? "正在生成内容" : "这次思考较久，可停止后重试");
  return <div className="assistant-working" role="status"><span className="assistant-orbit"><i /></span><div><b>{label}</b><small>{stage} · {seconds}s</small></div></div>;
}

function modelBrand(id = "") {
  const value = String(id).toLowerCase();
  if (/gpt|openai|o[134]/.test(value)) return { key: "openai", mark: "◎" };
  if (/grok|xai/.test(value)) return { key: "grok", mark: "𝕏" };
  if (/gemini/.test(value)) return { key: "gemini", mark: "✦" };
  if (/claude/.test(value)) return { key: "claude", mark: "A" };
  if (/deepseek/.test(value)) return { key: "deepseek", mark: "D" };
  if (/kimi|moonshot/.test(value)) return { key: "kimi", mark: "K" };
  if (/glm/.test(value)) return { key: "glm", mark: "Z" };
  if (/qwen/.test(value)) return { key: "qwen", mark: "Q" };
  return { key: "other", mark: "◇" };
}

function ModelGlyph({ id }) {
  const brand = modelBrand(id);
  return <span className="assistant-model-glyph" data-brand={brand.key} aria-hidden="true">{brand.mark}</span>;
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

const Message = memo(function Message({ item, canRevise, canInsert, currentVersion, onRevise, onInsert, onRegenerate, onEdit, latestAssistant = false, latestUser = false, working = false, activity = "" }) {
  const assistant = item.role === "assistant";
  const stale = assistant && item.documentVersion && currentVersion && item.documentVersion !== currentVersion;
  if (assistant && !item.text && item.pending) return null;
  return <article className={`assistant-message assistant-message--${assistant ? "assistant" : "user"}`}>
    {/* ⚠️ **自己那条不写「你」。** 靠右 + 深色气泡已经把「谁说的」说完了，
        再挂一行标签是同一件事说两遍；而助手那条要标模型和耗时，标签必须留。 */}
    {assistant ? <small><span className="assistant-message__avatar"><IconSparkles aria-hidden="true" /></span>Xenho AI{item.model ? ` · ${item.model}` : ""}{item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(item.durationMs < 10_000 ? 1 : 0)}s` : ""}{working ? <span className="assistant-message__live"><i />{activity || "正在生成回答"}</span> : null}</small> : null}
    {assistant ? (working ? <p className="assistant-message__stream">{item.text}</p> : <div className="assistant-message__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text || "") }} />) : <div className="assistant-message__user"><p>{item.text}</p>{latestUser && !working ? <button type="button" onClick={onEdit} title="编辑并重新发送"><IconPencil aria-hidden="true" /></button> : null}</div>}
    {stale ? <p className="assistant-message__stale">正文已在这条回复之后变化；建议重新生成候选，避免覆盖新内容。</p> : null}
    {assistant && item.text && !working ? <footer>
      <button onClick={() => navigator.clipboard?.writeText(item.text)} title="复制这条回复"><IconCopy aria-hidden="true" />复制</button>
      {canInsert ? <button onClick={() => onInsert(item.text)} disabled={stale} title={stale ? "正文版本已变化，请重新生成" : "插入后会带底纹，仍需确认采用"}><IconPlus aria-hidden="true" />作为候选插入</button> : null}
      {canRevise ? <button onClick={() => onRevise(item.text)} disabled={stale} title={stale ? "正文版本已变化，请重新生成" : "按这条建议生成选区改写候选"}><IconRefresh aria-hidden="true" />按建议改选区</button> : null}
      {latestAssistant ? <button onClick={onRegenerate} title="用相同问题重新生成"><IconRefresh aria-hidden="true" />重新生成</button> : null}
    </footer> : null}
  </article>;
});

function ActionCard({ action, onApply }) {
  if (!action || action.status === "superseded") return null;
  const applied = action.status === "applied";
  return <section className="assistant-action-card">
    <div><small>{applied ? "已执行" : "等待你确认"}</small><b>新建到「创作」</b><p>{action.title} · {action.platform}</p></div>
    {applied ? <button type="button" onClick={() => { if (action.result?.projectId) window.location.hash = `#/project/${action.result.projectId}`; }}>打开内容</button> : <button type="button" onClick={() => onApply(action.id)}>确认新建</button>}
  </section>;
}

export function AssistantPane({ scopeId, document = {}, materials = [], profile, selection, onInsert, onRevision, standalone = false, docked = false }) {
  const [messages, setMessages] = useState([]);
  const [actions, setActions] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
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
  const [historyOpen, setHistoryOpen] = useState(standalone && !docked);
  const [models, setModels] = useState([]);
  const [modelNotice, setModelNotice] = useState("");
  const [harnessSkills, setHarnessSkills] = useState([]);
  const [expertPresets, setExpertPresets] = useState([]);
  const [model, setModel] = useState("");
  const [modelPending, setModelPending] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const endRef = useRef(null);
  const streamRef = useRef({ id: "", text: "", timer: 0 });
  const scrollFrameRef = useRef(0);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const activeRequestRef = useRef(null);
  const conversationIdRef = useRef("");
  const style = (profile?.styles || []).find((item) => item.enabled && item.id === profile?.profile?.styleId) || null;
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
    setAttachments(conversation?.attachments || []);
    setActions(conversation?.actions || []);
    if (conversation?.model) setModel(conversation.model);
    if (conversation?.lastTurn?.status === "interrupted") {
      setError(Object.assign(new Error("上次对话因工作台重启而中断"), { hint: "已保留之前的对话；重新发送最后一个问题即可继续。" }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    conversationIdRef.current = "";
    setMessages([]); setActions([]); setAttachments([]); setConversationId(""); setConversationTitle("新对话"); setError(null); setLoading(!standalone);
    if (!standalone) api.assistantConversation(scopeId).then((result) => { if (!cancelled) applyConversation(result.conversation); }).catch((next) => { if (!cancelled) setError(next); }).finally(() => { if (!cancelled) setLoading(false); });
    if (standalone) api.assistantConversations(scopeId).then((result) => { if (!cancelled) setConversationItems(result.conversations?.items || []); }).catch(() => {});
    api.assistantModels().then((result) => {
      if (cancelled) return;
      const nextModels = result.models?.items || [];
      setModels(nextModels); setModelNotice(result.models?.warning || "");
      setModel((current) => current || result.models?.configured || nextModels[0]?.id || "");
    }).catch((next) => { if (!cancelled) setModelNotice(next.message || "模型目录暂时不可用"); });
    api.assistantSkills().then((result) => { if (!cancelled) setHarnessSkills((result.skills?.items || []).map((item) => ({ id: `harness:${item.id}`, label: item.name, hint: item.description, prompt: `/${item.id} ` }))); }).catch(() => {});
    api.assistantExperts().then((result) => { if (!cancelled) setExpertPresets((result.experts?.items || []).map((item) => ({ id: item.id, label: item.name, hint: item.description }))); }).catch(() => {});
    return () => { cancelled = true; clearTimeout(streamRef.current.timer); cancelAnimationFrame(scrollFrameRef.current); };
  }, [scopeId, standalone]);
  useEffect(() => {
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
  }, [messages.length, busy]);

  function flushStream(streamingId) {
    const current = streamRef.current;
    if (!current.text || current.id !== streamingId) return;
    const text = current.text; current.text = ""; current.timer = 0;
    setMessages((items) => items.map((item) => item.id === streamingId ? { ...item, text: `${item.text || ""}${text}` } : item));
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
  }

  function queueStream(streamingId, text) {
    streamRef.current.id = streamingId; streamRef.current.text += text;
    if (!streamRef.current.timer) streamRef.current.timer = window.setTimeout(() => flushStream(streamingId), 42);
  }

  const send = async (text = input) => {
    const message = String(text || "").trim();
    if (!message || busy) return;
    const optimistic = { id: `optimistic-${Date.now()}`, role: "user", text: message, createdAt: new Date().toISOString() };
    const streamingId = `streaming-${Date.now()}`;
    const requestId = Symbol("assistant-request");
    setMessages((current) => [...current, optimistic, { id: streamingId, role: "assistant", text: "", createdAt: new Date().toISOString(), pending: true, model }]);
    activeRequestRef.current = requestId;
    setInput(""); setMenu(""); setBusy(true); setActivity("正在读取上下文"); setError(null);
    try {
      const result = await api.assistantChatStream(
        { scopeId, conversationId, startNew: !conversationId, message, document, documentVersion: currentVersion, materials, style: standalone ? null : style, model, mode: standalone ? "general" : "content" },
        (event) => {
          if (event.type === "conversation" && event.conversationId) {
            conversationIdRef.current = event.conversationId;
            setConversationId(event.conversationId);
          }
          if (event.type === "status") setActivity(event.stage || "Harness 正在继续处理");
          if (event.type === "text" && event.text) {
            setActivity("正在生成回答");
            queueStream(streamingId, event.text);
          }
        },
      );
      flushStream(streamingId); applyConversation(result.conversation);
      await refreshHistory();
    } catch (next) {
      if (activeRequestRef.current === requestId) setError(next);
    } finally {
      if (activeRequestRef.current === requestId) {
        activeRequestRef.current = null;
        setBusy(false); setActivity("");
      }
    }
  };

  const newConversation = async () => {
    if (busy) return;
    conversationIdRef.current = "";
    setConversationId(""); setConversationTitle("新对话"); setMessages([]); setActions([]); setAttachments([]); setError(null); setInput("");
    inputRef.current?.focus();
  };

  const openConversation = async (id) => {
    if (busy || id === conversationId) return;
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
    if (!file || uploading || busy) return;
    setUploading(true); setError(null);
    try {
      const result = await api.uploadAssistantAttachment(scopeId, conversationId, file);
      if (!conversationId) {
        conversationIdRef.current = result.conversationId;
        setConversationId(result.conversationId);
      }
      setAttachments((current) => [...current, result.attachment]);
      setInput((current) => current || `${file.type.startsWith("image/") ? "请查看图片" : "请阅读附件"}《${file.name}》并告诉我你发现了什么`);
      inputRef.current?.focus();
    } catch (next) { setError(next); }
    finally { setUploading(false); }
  };

  function chooseExpert(item) {
    insertCommand(`@${item.label} `);
  }

  function chooseSkill(item) {
    insertCommand(item.prompt || `/${item.label} `);
  }

  const experts = (expertPresets.length ? expertPresets : EXPERTS).filter((item) => standalone || PROJECT_EXPERTS.has(item.id));
  const availableSkills = harnessSkills;
  const modelItems = model && !models.some((item) => item.id === model) ? [{ id: model, name: model, remembered: true }, ...models] : models;
  const menuItems = menu === "experts" ? experts : menu === "skills" ? availableSkills : modelItems.map((item) => ({ id: item.id, label: item.name || item.id, hint: item.ownedBy || (item.remembered ? "曾用于当前工作台" : "可用模型") }));
  const filteredMenuItems = menuItems.filter((item) => !menuQuery || `${item.label} ${item.id} ${item.hint || ""}`.toLowerCase().includes(menuQuery.toLowerCase())).slice(0, 80);

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
    setMenu(""); setMenuQuery(""); setCommandRange(null); setModel(item.id); setModelPending(true); setError(null);
    if (!conversationId) { setModelPending(false); return; }
    try {
      const result = await api.setAssistantModel({ scopeId, conversationId, model: item.id });
      applyConversation(result.conversation);
    } catch (next) {
      setModel(previous); setError(next);
    } finally { setModelPending(false); }
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

  const latestUserId = [...messages].reverse().find((item) => item.role === "user")?.id;
  const latestAssistantId = [...messages].reverse().find((item) => item.role === "assistant" && item.text)?.id;
  const canArchive = !busy && messages.some((item) => item.role === "assistant" && item.text);

  const dialog = <div className="assistant-pane__dialog">
    <header className="assistant-pane__context">
      <div>
        {standalone && !docked ? <button className="assistant-history-toggle" type="button" onClick={() => setHistoryOpen((value) => !value)} aria-pressed={historyOpen} title="对话历史"><IconHistory aria-hidden="true" /></button> : null}
        {standalone ? <strong>{conversationTitle}</strong> : <span className="assistant-context-chip" data-live={selection?.text ? "true" : undefined}>{selection?.text ? `选中 ${selection.text.length} 字` : "当前全文"}</span>}
        {standalone ? <span className="assistant-context-note">知识库 · 联网 · 文件 · Skill</span> : null}
        {materials.length ? <span className="assistant-context-chip">项目素材 {materials.length}</span> : null}
      </div>
      <div className="assistant-context-actions">
        {canArchive ? <button type="button" onClick={() => setCardOpen(true)} title="把本轮完整对话整理成知识卡片"><IconArchive aria-hidden="true" /><span>沉淀对话</span></button> : null}
        <button type="button" onClick={newConversation} title="保留当前记录并新建对话" aria-label="新对话"><IconPlus aria-hidden="true" />{standalone ? <span>新对话</span> : null}</button>
      </div>
    </header>

    <div className="assistant-thread">
      {!messages.length && !busy && !loading ? <EmptyAssistant onPrompt={send} standalone={standalone} /> : null}
      {loading ? <Working label="正在打开对话" /> : null}
      {messages.map((item) => <div className="assistant-turn" key={item.id}><Message item={item} currentVersion={currentVersion} canRevise={!standalone && !!selection?.text} canInsert={!standalone && !!onInsert} onRevise={(advice) => onRevision?.({ mode: "rewrite", label: "按建议改写", instruction: advice.slice(0, 2_000), selection })} onInsert={(text) => onInsert?.(text, { ai: true, kind: "AI 助手候选" })} onRegenerate={() => rewind(false)} onEdit={() => rewind(true)} latestAssistant={item.id === latestAssistantId} latestUser={item.id === latestUserId} working={busy && item.pending && !!item.text} activity={activity} />{(item.actionIds || []).map((id) => <ActionCard key={id} action={actions.find((action) => action.id === id)} onApply={applyAction} />)}</div>)}
      {busy && !messages.some((item) => item.pending && item.text) ? <Working label="Harness 正在调用模型和工具" detail={activity} /> : null}
      {error ? <div className="assistant-error" role="alert"><b>{error.message || "AI 助手没有完成"}</b>{error.hint ? <p>{error.hint}</p> : null}<button onClick={() => { setError(null); setInput(messages.at(-1)?.role === "user" ? messages.at(-1).text : input); }}>重试这条</button></div> : null}
      <div ref={endRef} />
    </div>

    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
      {attachments.length ? <div className="assistant-attachments">{attachments.slice(-4).map((item) => <span key={item.id}>{item.kind === "image" ? <span className="assistant-attachment-image">▧</span> : <IconFileText aria-hidden="true" />}{item.name}</span>)}</div> : null}
      <textarea ref={inputRef} value={input} onChange={changeInput} onKeyDown={inputKeyDown} placeholder={standalone ? "问任何问题；输入 @ 调专家，输入 / 使用 Skill" : "问当前内容；输入 @ 调专家，输入 / 使用 Skill"} rows="2" disabled={busy} />
      {menu ? <div className="assistant-command-menu" role="menu">
        <header>{menu === "models" ? <label className="assistant-command-menu__search"><span>切换模型</span><input autoFocus value={menuQuery} onChange={(event) => { setMenuQuery(event.target.value); setMenuIndex(0); }} onKeyDown={inputKeyDown} placeholder="筛选可用模型" aria-label="筛选可用模型" /></label> : <span>{menu === "experts" ? "选择专家" : "选择 Skill"}{menuQuery ? <em>“{menuQuery}”</em> : null}</span>}<button type="button" onClick={() => setMenu("")}><IconX aria-hidden="true" /></button></header>
        {menu === "models" && modelNotice ? <p className="assistant-command-menu__notice">{modelNotice}</p> : null}
        {filteredMenuItems.length ? filteredMenuItems.map((item, index) => <button type="button" role="menuitem" aria-current={index === menuIndex ? "true" : undefined} key={item.id} onMouseEnter={() => setMenuIndex(index)} onClick={() => chooseMenuItem(item)} disabled={menu === "models" && modelPending}><span className="assistant-command-menu__mark">{menu === "experts" ? "@" : menu === "skills" ? "/" : <ModelGlyph id={item.id} />}</span><span><b>{item.label}{menu === "models" && item.id === model ? <em>当前</em> : null}</b><small>{item.hint}</small></span></button>) : <p className="assistant-command-menu__empty">没有匹配项</p>}
      </div> : null}
      <footer>
        <div>
          <><input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.md,.markdown,.txt,.csv,.json,.xml,.html,.htm,.yaml,.yml,.js,.jsx,.ts,.tsx,.css" onChange={uploadFile} /><button type="button" className="assistant-composer__attach" title={uploading ? "正在读取附件" : "添加图片或文件"} aria-label={uploading ? "正在读取附件" : "添加图片或文件"} onClick={() => fileRef.current?.click()} disabled={uploading}><IconPlus aria-hidden="true" /></button></>
          <button type="button" className="assistant-composer__model" title="从当前接口返回的可用模型中选择" onClick={() => menu === "models" ? setMenu("") : openMenu("models")} aria-expanded={menu === "models"} disabled={busy || modelPending}><ModelGlyph id={model} /><b>{models.find((item) => item.id === model)?.name || model || "选择模型"}</b><IconChevronDown aria-hidden="true" /></button>
        </div>
        <small className="assistant-composer__hint">Enter 发送 · Shift+Enter 换行</small>
        {busy ? <button type="button" className="assistant-send assistant-send--stop" onClick={stop} aria-label="停止"><IconX aria-hidden="true" /></button> : <button type="submit" className="assistant-send" disabled={!input.trim() || loading || uploading} aria-label="发送"><IconSend aria-hidden="true" /></button>}
      </footer>
    </form>
    <KnowledgeCardDialog open={cardOpen} onClose={() => setCardOpen(false)} messages={messages.map((item) => ({ ...item, role: item.role === "assistant" ? "agent" : item.role }))} source={{ title: document.title || conversationTitle || "AI 助手对话", type: standalone ? "AI 助手对话" : "内容项目对话", engine: "DeepSeek Harness" }} />
  </div>;

  return <div className={`assistant-pane${standalone ? " assistant-pane--standalone" : ""}${docked ? " assistant-pane--docked" : ""}`}>
    {standalone && historyOpen ? <aside className="assistant-history" aria-label="对话历史">
      <header><strong>对话</strong><button onClick={newConversation} title="新建对话"><IconPlus aria-hidden="true" /></button></header>
      <nav>{conversationItems.map((item) => <button key={item.id} aria-current={item.id === conversationId ? "page" : undefined} onClick={() => openConversation(item.id)}><b>{item.title}</b><small>{item.preview || "还没有消息"}</small><time>{new Date(item.updatedAt || item.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</time></button>)}</nav>
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
