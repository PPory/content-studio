import { useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";

export function ProjectResearchLinks({ projectId, onGo }) {
  const [linked, setLinked] = useState(null);
  const [choices, setChoices] = useState(null);
  const [selected, setSelected] = useState("");
  const [question, setQuestion] = useState("");
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function load() {
    try { const result = await api.projectResearches(projectId); setLinked(result.researches || []); setError(null); }
    catch (cause) { setError(cause); }
  }
  async function choose() {
    setBusy(true);
    try { const result = await api.researches(); setChoices(result.researches || []); setError(null); }
    catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  async function attach(id, open = false) {
    setBusy(true); setError(null);
    try {
      await api.researchProject(id, { projectId });
      await load(); setSelected(""); setCreated(null); setQuestion("");
      if (open) onGo?.("research", id);
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  async function start() {
    if (!question.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const research = created || (await api.createResearch({ question: question.trim() })).research;
      setCreated(research);
      await attach(research.id, true);
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  return <details className="project-research-links" onToggle={(event) => { if (event.currentTarget.open && linked === null) load(); }}>
    <summary>相关研究</summary>
    <ErrorNote error={error} what="关联研究" onRetry={load} />
    {linked === null && !error ? <p role="status">正在读取…</p> : null}
    {linked?.length ? linked.map((item) => <div key={item.id}><button type="button" className="btn btn-sm" onClick={() => onGo?.("research", item.id)}>继续研究 · {item.question || item.title}</button></div>) : <p>有需要继续弄明白的问题，可以关联研究，之后再回到这篇。</p>}
    <button type="button" className="btn btn-sm" disabled={busy} onClick={choose}>关联已有研究</button>
    {choices ? <div><label>选择研究<select aria-label="选择研究" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">选择一项研究</option>{choices.filter((item) => !linked?.some((entry) => entry.id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.question || item.title}</option>)}</select></label><button className="btn btn-sm" type="button" disabled={!selected || busy} onClick={() => attach(selected)}>关联到这篇</button></div> : null}
    <label>补充一个问题<input aria-label="要继续研究的问题" value={question} maxLength={500} disabled={Boolean(created)} onChange={(event) => setQuestion(event.target.value)} placeholder="还有什么需要弄明白？" /></label>
    <button type="button" className="btn btn-sm" disabled={busy || !question.trim()} onClick={start}>{created ? "重试关联并继续研究" : "新建研究并打开"}</button>
  </details>;
}
