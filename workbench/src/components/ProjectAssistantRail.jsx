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

function Working({ label = "Harness 正在处理" }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);
  const stage = seconds < 3 ? "正在读取上下文" : seconds < 12 ? "正在组织回答" : seconds < 30 ? "正在生成内容" : "这次思考较久，可停止后重试";
  return <div className="assistant-working" role="status"><span className="assistant-orbit"><i /></span><div><b>{label}</b><small>{stage} · {seconds}s</small></div></div>;
}

function EmptyAssistant({ onPrompt, standalone = false }) {
  return <div className="assistant-empty">
    <span className="assistant-empty__mark"><IconSparkles aria-hidden="true" /></span>
    <h3>{standalone ? "从一个问题开始" : "围绕这篇内容，一起往下做"}</h3>
    <p>{standalone ? "可以直接聊，也可以搜索本地知识库、公开网页，或调用专家一起处理。" : "它能读当前全文和选区，也能通过专家查知识库、搜公开来源。任何改写都会先给候选。"}</p>
    <div>
      {standalone ? <>
        <button onClick={() => onPrompt("搜索我的知识库，看看最近记录的内容之间有什么关联")}>找找最近内容的关联</button>
        <button onClick={() => onPrompt("根据我的知识库，给我三个今天值得继续思考的问题")}>从知识库找三个问题</button>
      </> : <>
        <button onClick={() => onPrompt("帮我看看这篇文章现在最需要解决的一个问题")}>先看一个关键问题</button>
        <button onClick={() => onPrompt("结合当前内容，告诉我下一段最值得写什么")}>给下一步方向</button>
      </>}
    </div>
  </div>;
}

function Message({ item, canRevise, canInsert, onRevise, onInsert, onCard }) {
  const assistant = item.role === "assistant";
  return <article className={`assistant-message assistant-message--${assistant ? "assistant" : "user"}`}>
    <small>{assistant ? <>Xenho AI{item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(item.durationMs < 10_000 ? 1 : 0)}s` : ""}</> : "你"}</small>
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
  const [error, setError] = useState(null);
  const [menu, setMenu] = useState("");
  const [cardOpen, setCardOpen] = useState(false);
  const [styleId, setStyleId] = useState(() => {
    try { return localStorage.getItem(`workbench:draft-style:v1:${scopeId}`) || profile?.profile?.styleId || ""; } catch { return profile?.profile?.styleId || ""; }
  });
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const styles = (profile?.styles || []).filter((item) => item.enabled);
  const style = styles.find((item) => item.id === styleId) || null;

  useEffect(() => {
    let cancelled = false;
    setMessages([]); setError(null);
    api.assistantConversation(scopeId).then((result) => { if (!cancelled) setMessages(result.conversation?.messages || []); }).catch((next) => { if (!cancelled) setError(next); });
    return () => { cancelled = true; };
  }, [scopeId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);
  useEffect(() => {
    if (!styleId && styles.length) setStyleId(profile?.profile?.styleId || styles[0].id);
  }, [profile?.profile?.styleId, styleId, styles]);

  const send = async (text = input) => {
    const message = String(text || "").trim();
    if (!message || busy) return;
    const optimistic = { id: `optimistic-${Date.now()}`, role: "user", text: message, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]);
    setInput(""); setMenu(""); setBusy(true); setError(null);
    try {
      const result = await api.assistantChat({ scopeId, message, document, materials, style });
      setMessages(result.conversation?.messages || []);
    } catch (next) {
      setError(next);
    } finally {
      setBusy(false);
    }
  };

  const newConversation = async () => {
    if (busy) return;
    const result = await api.newAssistantConversation(scopeId);
    setMessages(result.conversation?.messages || []); setError(null); setInput("");
  };

  const stop = async () => {
    await api.cancelAssistant(scopeId).catch(() => {});
    setBusy(false);
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

  const availableSkills = standalone ? STANDALONE_SKILLS : SKILLS;

  return <div className={`assistant-pane${standalone ? " assistant-pane--standalone" : ""}`}>
    <header className="assistant-pane__context">
      <div>
        <span className="assistant-context-chip" data-live={selection?.text ? "true" : undefined}>{standalone ? "独立对话" : selection?.text ? `选中 ${selection.text.length} 字` : "当前全文"}</span>
        {standalone ? <span className="assistant-context-chip">知识库 · 公开网页</span> : null}
        {materials.length ? <span className="assistant-context-chip">项目素材 {materials.length}</span> : null}
      </div>
      <button onClick={newConversation} title="清空当前对话，另开一轮" aria-label="新对话"><IconHistory aria-hidden="true" /></button>
    </header>

    <div className="assistant-thread">
      {!messages.length && !busy ? <EmptyAssistant onPrompt={send} standalone={standalone} /> : null}
      {messages.map((item) => <Message key={item.id} item={item} canRevise={!standalone && !!selection?.text} canInsert={!standalone && !!onInsert} onRevise={(advice) => onRevision?.({ mode: "rewrite", label: "按建议改写", instruction: advice.slice(0, 2_000), selection })} onInsert={(text) => onInsert?.(text, { ai: true, kind: "AI 助手候选" })} onCard={() => setCardOpen(true)} />)}
      {busy ? <Working label="AI 助手正在处理" /> : null}
      {error ? <div className="assistant-error" role="alert"><b>{error.message || "AI 助手没有完成"}</b>{error.hint ? <p>{error.hint}</p> : null}<button onClick={() => { setError(null); setInput(messages.at(-1)?.role === "user" ? messages.at(-1).text : input); }}>重试这条</button></div> : null}
      <div ref={endRef} />
    </div>

    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
      <div className="assistant-composer__style">
        <span>写作风格</span>
        <select value={styleId} onChange={(event) => { setStyleId(event.target.value); try { localStorage.setItem(`workbench:draft-style:v1:${scopeId}`, event.target.value); } catch {} }}>
          <option value="">不调用风格</option>
          {styles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>
      <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={standalone ? "问任何问题，或输入 @ 调专家、/ 使用 Skill…" : "问当前内容，或输入 @ 调专家、/ 使用 Skill…"} rows="3" disabled={busy} />
      {menu ? <div className="assistant-command-menu" role="menu">
        <header>{menu === "experts" ? "调用专家" : "使用 Skill"}<button type="button" onClick={() => setMenu("")}><IconX aria-hidden="true" /></button></header>
        {(menu === "experts" ? EXPERTS : availableSkills).map((item) => <button type="button" role="menuitem" key={item.id} onClick={() => menu === "experts" ? chooseExpert(item) : chooseSkill(item)} disabled={!standalone && reportBusy && !item.mention}><b>{item.label}</b><small>{item.hint}</small></button>)}
      </div> : null}
      <footer>
        <div><button type="button" onClick={() => setMenu(menu === "experts" ? "" : "experts")} aria-expanded={menu === "experts"}>@ <span>专家</span></button><button type="button" onClick={() => setMenu(menu === "skills" ? "" : "skills")} aria-expanded={menu === "skills"}>/ <span>Skill</span></button></div>
        {busy ? <button type="button" className="assistant-send assistant-send--stop" onClick={stop} aria-label="停止"><IconX aria-hidden="true" /></button> : <button type="submit" className="assistant-send" disabled={!input.trim()} aria-label="发送"><IconSend aria-hidden="true" /></button>}
      </footer>
    </form>
    <KnowledgeCardDialog open={cardOpen} onClose={() => setCardOpen(false)} messages={messages.map((item) => ({ ...item, role: item.role === "assistant" ? "agent" : item.role }))} source={{ title: document.title || "AI 助手对话", type: standalone ? "AI 助手对话" : "内容项目对话", engine: "DeepSeek Harness" }} />
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
