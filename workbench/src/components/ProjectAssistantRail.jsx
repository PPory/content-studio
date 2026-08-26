import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { documentVersion } from "../lib/document-version.js";
import { EXPERT_KINDS } from "../lib/expert-kinds.js";
import { ExpertReport } from "./ExpertTaskPanel.jsx";
import { AssistantPane } from "./assistant/AssistantPane.jsx";
import { Working } from "./assistant/AssistantThread.jsx";
import {
  IconCheck,
  IconDatabase,
  IconFileText,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconSparkles,
} from "./icons.jsx";

const TABS = [
  { id: "assistant", label: "AI 助手", icon: IconSparkles },
  { id: "materials", label: "项目素材", icon: IconDatabase },
  { id: "reports", label: "检查报告", icon: IconShieldCheck },
];

const REPORT_ICONS = { "material-research": IconSearch, "quality-review": IconFileText, "fact-check": IconShieldCheck };
const REPORTS = EXPERT_KINDS.map((item) => ({ ...item, label: item.displayName, expert: item.expertName, icon: REPORT_ICONS[item.id] }));
const statusLabel = { queued: "排队中", running: "正在检查", done: "已完成", failed: "未完成", cancelled: "已中止" };

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
