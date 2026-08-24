import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { renderMarkdown } from "../lib/markdown.js";
import { KnowledgeCardDialog } from "./KnowledgeCardDialog.jsx";
import { ExpertReport } from "./ExpertTaskPanel.jsx";
import {
  IconArchive,
  IconCheck,
  IconCopy,
  IconDatabase,
  IconFileText,
  IconHistory,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconShieldCheck,
  IconSparkles,
  IconUpload,
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
  { id: "writing", label: "写作教练", hint: "梳理、续写和改稿", mention: "@写作教练 " },
  { id: "material-research", label: "素材顾问", hint: "查知识库与公开来源" },
  { id: "quality-review", label: "审稿顾问", hint: "逐项回答 Xenho 品控九问" },
  { id: "fact-check", label: "事实核查", hint: "核对数字、日期、人物与引语" },
];

const SKILLS = [
  { id: "continue", label: "续写一段", hint: "结合上下文给候选段落", prompt: "/续写一段 请接着当前光标继续写，先给候选，不要声称已写入正文。" },
  { id: "complete", label: "完成全文", hint: "补全尚未完成的部分", prompt: "/完成全文 请保持本文主题和结构，给出完整候选稿。" },
  { id: "polish", label: "润色选区", hint: "保持原意，改善表达", revision: "polish" },
  { id: "rewrite", label: "改写选区", hint: "按要求重新表达", revision: "rewrite" },
  { id: "proofread", label: "纠错选区", hint: "只处理明确错误", revision: "proofread" },
  { id: "card", label: "沉淀知识卡片", hint: "预览确认后进入知识库", card: true },
];

const STANDALONE_SKILLS = [
  { id: "knowledge", label: "搜索知识库", hint: "从书、笔记、知识卡和素材中查找", prompt: "/搜索知识库 请根据我的问题检索本地知识库，并标出实际找到的来源。" },
  { id: "web", label: "联网查证", hint: "搜索公开网页并保留来源", prompt: "/联网查证 请联网核查我接下来提出的事实，只使用能找到来源的内容。" },
  { id: "connect", label: "寻找关联", hint: "发现近期内容之间的联系", prompt: "/寻找关联 请搜索我的知识库，找出最近内容之间值得继续追问的关联。" },
  { id: "card", label: "沉淀知识卡片", hint: "预览确认后进入知识库", card: true },
];

const revisionLabel = { polish: "润色", rewrite: "改写", proofread: "纠错" };
const statusLabel = { queued: "排队中", running: "正在检查", done: "已完成", failed: "未完成", cancelled: "已中止" };

function Working({ label = "Harness 正在处理", detail = "" }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);
  const stage = detail || (seconds < 3 ? "正在读取上下文" : seconds < 12 ? "正在组织回答" : seconds < 30 ? "正在生成内容" : "这次思考较久，可停止后重试");
  return <div className="assistant-working" role="status"><span className="assistant-orbit"><i /></span><div><b>{label}</b><small>{stage} · {seconds}s</small></div></div>;
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

function Message({ item, canRevise, canInsert, onRevise, onInsert, onCard }) {
  const assistant = item.role === "assistant";
  return <article className={`assistant-message assistant-message--${assistant ? "assistant" : "user"}`}>
    {/* ⚠️ **自己那条不写「你」。** 靠右 + 深色气泡已经把「谁说的」说完了，
        再挂一行标签是同一件事说两遍；而助手那条要标模型和耗时，标签必须留。 */}
    {assistant ? <small><span className="assistant-message__avatar"><IconSparkles aria-hidden="true" /></span>Xenho AI{item.model ? ` · ${item.model}` : ""}{item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(item.durationMs < 10_000 ? 1 : 0)}s` : ""}</small> : null}
    {assistant ? <div className="assistant-message__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text || "") }} /> : <p>{item.text}</p>}
    {assistant ? <footer>
      <button onClick={() => navigator.clipboard?.writeText(item.text)} title="复制这条回复"><IconCopy aria-hidden="true" />复制</button>
      {canInsert ? <button onClick={() => onInsert(item.text)} title="插入后会带底纹，仍需确认采用"><IconPlus aria-hidden="true" />作为候选插入</button> : null}
      {canRevise ? <button onClick={() => onRevise(item.text)} title="按这条建议生成选区改写候选"><IconRefresh aria-hidden="true" />按建议改选区</button> : null}
      <button onClick={onCard} title="先生成知识卡片预览"><IconArchive aria-hidden="true" />沉淀</button>
    </footer> : null}
  </article>;
}

export function AssistantPane({ scopeId, document = {}, materials = [], profile, selection, onInsert, onRevision, onExpert, reportBusy = false, standalone = false }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [menu, setMenu] = useState("");
  const [cardOpen, setCardOpen] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [conversationTitle, setConversationTitle] = useState("新对话");
  const [conversationItems, setConversationItems] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(standalone);
  const [models, setModels] = useState([]);
  const [harnessSkills, setHarnessSkills] = useState([]);
  const [model, setModel] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const modelListId = `assistant-models-${scopeId.replace(/[^a-z0-9_-]/gi, "-")}`;
  const [styleId, setStyleId] = useState(() => {
    try { return localStorage.getItem(`workbench:draft-style:v1:${scopeId}`) || profile?.profile?.styleId || ""; } catch { return profile?.profile?.styleId || ""; }
  });
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const styles = (profile?.styles || []).filter((item) => item.enabled);
  const style = styles.find((item) => item.id === styleId) || null;

  const refreshHistory = async () => {
    if (!standalone) return;
    const result = await api.assistantConversations(scopeId);
    setConversationItems(result.conversations?.items || []);
  };

  const applyConversation = (conversation) => {
    setConversationId(conversation?.id || "");
    setConversationTitle(conversation?.title || "新对话");
    setMessages(conversation?.messages || []);
    setAttachments(conversation?.attachments || []);
    if (conversation?.model) setModel(conversation.model);
    if (conversation?.lastTurn?.status === "interrupted") {
      setError(Object.assign(new Error("上次对话因工作台重启而中断"), { hint: "已保留之前的对话；重新发送最后一个问题即可继续。" }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    setMessages([]); setError(null); setLoading(true);
    Promise.all([
      api.assistantConversation(scopeId),
      standalone ? api.assistantConversations(scopeId) : Promise.resolve({ conversations: { items: [] } }),
      standalone ? api.assistantModels() : Promise.resolve({ models: { items: [], configured: "" } }),
      api.assistantSkills(),
    ]).then(([conversationResult, historyResult, modelResult, skillResult]) => {
      if (cancelled) return;
      applyConversation(conversationResult.conversation);
      setConversationItems(historyResult.conversations?.items || []);
      const nextModels = modelResult.models?.items || [];
      setModels(nextModels);
      setHarnessSkills((skillResult.skills?.items || []).map((item) => ({ id: `harness:${item.id}`, label: item.name, hint: item.description, prompt: `/${item.id} ` })));
      setModel(conversationResult.conversation?.model || modelResult.models?.configured || nextModels[0]?.id || "");
    }).catch((next) => { if (!cancelled) setError(next); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scopeId, standalone]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);
  useEffect(() => {
    if (!styleId && styles.length) setStyleId(profile?.profile?.styleId || styles[0].id);
  }, [profile?.profile?.styleId, styleId, styles]);

  const send = async (text = input) => {
    const message = String(text || "").trim();
    if (!message || busy) return;
    const optimistic = { id: `optimistic-${Date.now()}`, role: "user", text: message, createdAt: new Date().toISOString() };
    const streamingId = `streaming-${Date.now()}`;
    setMessages((current) => [...current, optimistic, { id: streamingId, role: "assistant", text: "", createdAt: new Date().toISOString(), pending: true }]);
    setInput(""); setMenu(""); setBusy(true); setActivity("正在读取上下文"); setError(null);
    try {
      const result = await api.assistantChatStream(
        { scopeId, conversationId, message, document, materials, style: standalone ? null : style, model, mode: standalone ? "general" : "content" },
        (event) => {
          if (event.type === "status") setActivity(event.stage || "Harness 正在继续处理");
          if (event.type === "text" && event.text) {
            setActivity("正在生成回答");
            setMessages((current) => current.map((item) => item.id === streamingId ? { ...item, text: `${item.text || ""}${event.text}` } : item));
          }
        },
      );
      applyConversation(result.conversation);
      await refreshHistory();
    } catch (next) {
      setError(next);
    } finally {
      setBusy(false); setActivity("");
    }
  };

  const newConversation = async () => {
    if (busy) return;
    const result = await api.newAssistantConversation(scopeId, model);
    applyConversation(result.conversation);
    setError(null); setInput("");
    await refreshHistory();
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
    await api.cancelAssistant(scopeId, conversationId).catch(() => {});
    setBusy(false);
  };

  const uploadFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploading || busy) return;
    setUploading(true); setError(null);
    try {
      const result = await api.uploadAssistantAttachment(scopeId, conversationId, file);
      setAttachments((current) => [...current, result.attachment]);
      setInput((current) => current || `请阅读附件《${file.name}》并告诉我你发现了什么`);
      inputRef.current?.focus();
    } catch (next) { setError(next); }
    finally { setUploading(false); }
  };

  function chooseExpert(item) {
    setMenu("");
    if (standalone || item.mention) { setInput(item.mention || `@${item.label} `); inputRef.current?.focus(); return; }
    onExpert?.(item.id);
  }

  function chooseSkill(item) {
    setMenu("");
    if (item.card) { setCardOpen(true); return; }
    if (item.revision) {
      if (!selection?.text) { setError(new Error(`先在正文里选中一段，再使用“${item.label}”`)); return; }
      onRevision?.({ mode: item.revision, label: revisionLabel[item.revision], instruction: "", selection });
      return;
    }
    setInput(item.prompt || ""); inputRef.current?.focus();
  }

  const availableSkills = [...harnessSkills, ...(standalone ? STANDALONE_SKILLS : SKILLS)];

  const dialog = <div className="assistant-pane__dialog">
    <header className="assistant-pane__context">
      <div>
        {standalone ? <button className="assistant-history-toggle" type="button" onClick={() => setHistoryOpen((value) => !value)} aria-pressed={historyOpen} title="对话历史"><IconHistory aria-hidden="true" /></button> : null}
        {standalone ? <strong>{conversationTitle}</strong> : <span className="assistant-context-chip" data-live={selection?.text ? "true" : undefined}>{selection?.text ? `选中 ${selection.text.length} 字` : "当前全文"}</span>}
        {standalone ? <span className="assistant-context-note">知识库 · 联网 · 文件 · Skill</span> : null}
        {materials.length ? <span className="assistant-context-chip">项目素材 {materials.length}</span> : null}
      </div>
      <button onClick={newConversation} title="保留当前记录并新建对话" aria-label="新对话"><IconPlus aria-hidden="true" />{standalone ? <span>新对话</span> : null}</button>
    </header>

    <div className="assistant-thread">
      {!messages.length && !busy && !loading ? <EmptyAssistant onPrompt={send} standalone={standalone} /> : null}
      {loading ? <Working label="正在打开对话" /> : null}
      {messages.map((item) => <Message key={item.id} item={item} canRevise={!standalone && !!selection?.text} canInsert={!standalone && !!onInsert} onRevise={(advice) => onRevision?.({ mode: "rewrite", label: "按建议改写", instruction: advice.slice(0, 2_000), selection })} onInsert={(text) => onInsert?.(text, { ai: true, kind: "AI 助手候选" })} onCard={() => setCardOpen(true)} />)}
      {busy ? <Working label="Harness 正在调用模型和工具" detail={activity} /> : null}
      {error ? <div className="assistant-error" role="alert"><b>{error.message || "AI 助手没有完成"}</b>{error.hint ? <p>{error.hint}</p> : null}<button onClick={() => { setError(null); setInput(messages.at(-1)?.role === "user" ? messages.at(-1).text : input); }}>重试这条</button></div> : null}
      <div ref={endRef} />
    </div>

    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
      {standalone && attachments.length ? <div className="assistant-attachments">{attachments.slice(-4).map((item) => <span key={item.id}><IconFileText aria-hidden="true" />{item.name}</span>)}</div> : null}
      <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={standalone ? "问任何问题，输入 @ 调专家，或 / 使用 Skill…" : "问当前内容，或输入 @ 调专家、/ 使用 Skill…"} rows="3" disabled={busy} />
      {menu ? <div className="assistant-command-menu" role="menu">
        <header>{menu === "experts" ? "调用专家" : "使用 Skill"}<button type="button" onClick={() => setMenu("")}><IconX aria-hidden="true" /></button></header>
        {(menu === "experts" ? EXPERTS : availableSkills).map((item) => <button type="button" role="menuitem" key={item.id} onClick={() => menu === "experts" ? chooseExpert(item) : chooseSkill(item)} disabled={!standalone && reportBusy && !item.mention}><b>{item.label}</b><small>{item.hint}</small></button>)}
      </div> : null}
      <footer>
        <div>
          {standalone ? <><input ref={fileRef} type="file" hidden accept=".pdf,.md,.markdown,.txt,.csv,.json,.xml,.html,.htm,.yaml,.yml,.js,.jsx,.ts,.tsx,.css" onChange={uploadFile} /><button type="button" title="上传文件（PDF、文本、Markdown、CSV、JSON 等）" onClick={() => fileRef.current?.click()} disabled={uploading}><IconUpload aria-hidden="true" /><span>{uploading ? "读取中" : "文件"}</span></button></> : null}
          <button type="button" title="调用专家（在输入框里打 @ 也一样）" onClick={() => setMenu(menu === "experts" ? "" : "experts")} aria-expanded={menu === "experts"}>@ <span>专家</span></button>
          <button type="button" title="使用 Harness Skill（在输入框里打 / 也一样）" onClick={() => setMenu(menu === "skills" ? "" : "skills")} aria-expanded={menu === "skills"}>/ <span>Skill</span></button>
          {standalone ? <label className="assistant-composer__model" title="选择接口返回的模型，也可以直接输入模型 ID"><span>模型</span><input list={modelListId} value={model} onChange={(event) => setModel(event.target.value)} placeholder="输入模型 ID" /><datalist id={modelListId}>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist></label> : <label className="assistant-composer__style" title="这次发送要带上的写作风格"><span>风格</span><select value={styleId} onChange={(event) => { setStyleId(event.target.value); try { localStorage.setItem(`workbench:draft-style:v1:${scopeId}`, event.target.value); } catch {} }}><option value="">不调用</option>{styles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        </div>
        <small className="assistant-composer__hint">Enter 发送 · Shift+Enter 换行</small>
        {busy ? <button type="button" className="assistant-send assistant-send--stop" onClick={stop} aria-label="停止"><IconX aria-hidden="true" /></button> : <button type="submit" className="assistant-send" disabled={!input.trim() || loading || uploading} aria-label="发送"><IconSend aria-hidden="true" /></button>}
      </footer>
    </form>
    <KnowledgeCardDialog open={cardOpen} onClose={() => setCardOpen(false)} messages={messages.map((item) => ({ ...item, role: item.role === "assistant" ? "agent" : item.role }))} source={{ title: document.title || conversationTitle || "AI 助手对话", type: standalone ? "AI 助手对话" : "内容项目对话", engine: "DeepSeek Harness" }} />
  </div>;

  return <div className={`assistant-pane${standalone ? " assistant-pane--standalone" : ""}`}>
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

  const startRun = async (kind) => {
    setTab("reports"); setReportKind(kind); setReportError(null);
    try {
      const result = await api.startExpertRun({ kind, scopeId, document });
      setRuns((current) => [result.run, ...current.filter((item) => item.id !== result.run.id)]);
    } catch (error) { setReportError(error); }
  };
  const retry = (run) => startRun(run.kind);
  const cancel = async (id) => { await api.cancelExpertRun(id); loadRuns(); };
  const reportBusy = runs.some((item) => ["queued", "running"].includes(item.status));
  const counts = useMemo(() => ({ materials: materials.length, reports: new Set(runs.filter((item) => item.status === "done").map((item) => item.kind)).size }), [materials.length, runs]);

  return <aside className="project-rail project-assistant" aria-label="项目 AI 与资料">
    <nav className="project-assistant__tabs" aria-label="右栏">
      {TABS.map((item) => <button key={item.id} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}><item.icon aria-hidden="true" /><span>{item.label}</span>{item.id !== "assistant" && counts[item.id] ? <em>{counts[item.id]}</em> : null}</button>)}
    </nav>
    <div className="project-assistant__body">
      {tab === "assistant" ? <AssistantPane scopeId={scopeId} document={document} materials={materials} profile={profile} selection={selection} onInsert={onInsert} onRevision={onRevision} onExpert={startRun} reportBusy={reportBusy} /> : null}
      {tab === "materials" ? <div className="project-assistant__materials">{children}</div> : null}
      {tab === "reports" ? <ReportsPane runs={runs} activeKind={reportKind} onKind={setReportKind} onRun={startRun} onRetry={retry} onCancel={cancel} /> : null}
      {reportError ? <div className="assistant-error assistant-report-global"><b>{reportError.message}</b>{reportError.hint ? <p>{reportError.hint}</p> : null}</div> : null}
    </div>
  </aside>;
}
