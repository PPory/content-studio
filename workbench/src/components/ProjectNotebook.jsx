import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ProjectResearchLinks } from "./ProjectResearchLinks.jsx";
import { ErrorNote } from "./ui.jsx";
import "./project-notebook.css";

const fields = [
  ["thought", "想讲什么", "一句疑问、一段经历或还没成形的想法都可以。"],
  ["audience", "写给谁", "可选，谁会关心这件事？"],
  ["intent", "想让读者带走什么", "可选，还没有判断也可以开始写。"],
  ["questions", "还没想明白", "留下疑问，下次继续研究。"],
  ["evidenceNotes", "依据与待核实", "区分原文、自己的理解和需要补充的证据。"],
];

// 构思只保存探索，不采纳 AI 候选，也不改变正式正文。
export function ProjectNotebook({ projectId, onSaved, onAsk, onGo, onDirty, saveRef, onEdited, embedded = false }) {
  const [value, setValue] = useState(null);
  const [agendas, setAgendas] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(embedded);
  const [status, setStatus] = useState("");
  const [generating, setGenerating] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [remote, setRemote] = useState(null);
  const [newDirection, setNewDirection] = useState(null);
  const [directionBusy, setDirectionBusy] = useState(false);
  const [refinements, setRefinements] = useState({});
  const latest = useRef(null);
  const inFlight = useRef(null);
  const dirtyRef = useRef(false);
  useEffect(() => { if (saveRef) saveRef.current = save; });
  useEffect(() => {
    if (!dirty || busy || error) return;
    const timer = setTimeout(() => { save(); }, 900);
    return () => clearTimeout(timer);
  }, [value, dirty, busy, error]);

  useEffect(() => {
    let alive = true;
    api.projectNotebook(projectId).then(({ notebook }) => {
      if (!alive) return;
      setValue(notebook); latest.current = notebook;
      setOpen(embedded || Boolean(notebook.discovery || notebook.thought));
    }).catch((cause) => { if (alive) setError(cause); });
    api.agendas().then((result) => { if (alive) setAgendas(result.agendas || []); }).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(key, next) {
    const updated = { ...latest.current, [key]: next };
    latest.current = updated; dirtyRef.current = true; setValue(updated); setDirty(true); onDirty?.(true); onEdited?.(); setStatus("尚未保存");
  }

  async function save() {
    if (inFlight.current) {
      const ok = await inFlight.current;
      if (!ok) return false;
      return dirtyRef.current ? save() : true;
    }
    if (!latest.current) return false;
    if (!dirtyRef.current) return true;
    const snapshot = latest.current;
    setBusy(true); setError(null);
    const operation = (async () => {
      try {
        const { projectId: ignored, version, updatedAt, ...body } = snapshot;
        const { notebook } = await api.saveProjectNotebook(projectId, { ...body, expectedVersion: version });
        const clean = latest.current === snapshot;
        const next = clean ? notebook : { ...latest.current, version: notebook.version };
        latest.current = next; dirtyRef.current = !clean; setValue(next); setDirty(!clean); onDirty?.(!clean);
        setStatus(clean ? "构思已保存" : "还有新的修改待保存");
        onSaved?.(notebook);
        return true;
      } catch (cause) { setError(Object.assign(cause, { hint: cause.hint || "输入仍保留在这里。恢复后重试保存；版本冲突时先核对另一处的修改。" })); return false; }
      finally { inFlight.current = null; setBusy(false); }
    })();
    inFlight.current = operation;
    const ok = await operation;
    return ok && dirtyRef.current ? save() : ok;
  }

  async function saveDirection() {
    if (!newDirection?.title.trim() || !newDirection?.desiredJudgment.trim() || directionBusy) return;
    setDirectionBusy(true); setError(null);
    try {
      const result = await api.createAgenda({ ...newDirection, confirmed: true });
      const list = await api.agendas(); setAgendas(list.agendas || []);
      change("agendaId", result.agenda.id); setNewDirection(null);
    } catch (cause) { setError(cause); }
    finally { setDirectionBusy(false); }
  }
  async function viewRemote() {
    try { setRemote((await api.projectNotebook(projectId)).notebook); }
    catch (cause) { setError(cause); }
  }
  function useAlternative(item) {
    const next = { ...latest.current, thought: item.body, discovery: { ...latest.current.discovery, selectedId: item.id } };
    latest.current = next; dirtyRef.current = true; setValue(next); setDirty(true); onDirty?.(true); onEdited?.(); setStatus("尚未保存");
  }
  async function refineAlternative(id) {
    const route = value.discovery?.routes?.find((item) => item.id === id);
    if (!route || !refinements[id]?.trim() || generating) return;
    if (!(await save())) return;
    setGenerating(true); setError(null);
    try {
      const result = await api.refineConstructionRoute({ connection: value.discovery.connection, route, instruction: refinements[id], agendaId: value.discovery.routesAgendaId || undefined });
      const body = [result.route.entry, result.route.coreClaim, result.route.storyline, result.route.risk].filter(Boolean).join("\n\n");
      const next = { ...latest.current, alternatives: latest.current.alternatives.map((item) => item.id === id ? { ...item, body } : item), discovery: { ...latest.current.discovery, routes: latest.current.discovery.routes.map((item) => item.id === id ? result.route : item), freshness: result.freshness || null } };
      latest.current = next; dirtyRef.current = true; setValue(next); setDirty(true); onDirty?.(true); setRefinements({ ...refinements, [id]: "" }); await save();
    } catch (cause) { setError(cause); }
    finally { setGenerating(false); }
  }
  async function compare() {
    if (generating || !value.discovery?.connection) return;
    if (!(await save())) return;
    setGenerating(true); setError(null);
    try {
      const result = await api.constructionRoutes({ connection: value.discovery.connection, agendaId: value.agendaId || undefined });
      const next = { ...latest.current,
        alternatives: (result.routes || []).slice(0, 20).map((route) => ({ id: route.id, label: route.label, body: [route.entry, route.coreClaim, route.storyline, route.risk].filter(Boolean).join("\n\n") })),
        discovery: { ...latest.current.discovery, routes: result.routes || [], routesAgendaId: value.agendaId || null, freshness: result.freshness || null },
      };
      latest.current = next; dirtyRef.current = true; setValue(next); setDirty(true); onDirty?.(true);
      await save();
    } catch (cause) { setError(cause); }
    finally { setGenerating(false); }
  }

  function ask(task) {
    onAsk?.(`${task}\n以下是这篇内容当前的探索记录，均不等于已核实事实。不要自动改写正文。\n${fields.map(([key, label]) => `${label}：${value[key] || "未定"}`).join("\n")}\n候选讲法：${JSON.stringify(value.alternatives)}`);
  }

  return <section className="project-notebook" aria-label="这篇的构思">
    <header>{embedded ? null : <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>构思{open ? " · 收起" : " · 展开"}</button>}<span role="status">{status || "可以随写随改，不必先填完整"}</span>{dirty ? <button type="button" className="btn btn-sm" disabled={busy} onClick={save}>{busy ? "保存中…" : "保存构思"}</button> : null}</header>
    <ErrorNote error={error} what="构思" onRetry={!value ? () => window.location.reload() : save} />
    {error?.status === 409 ? <div><button type="button" className="btn btn-sm" onClick={viewRemote}>查看另一处保存的构思</button>{remote ? <div><p>另一处的版本 {remote.version}。下面是已保存内容；你的输入仍留在编辑区。</p><pre style={{ whiteSpace: "pre-wrap" }}>{fields.map(([key, label]) => `${label}：${remote[key]}`).join("\n")}</pre><button type="button" className="btn btn-sm" onClick={() => { latest.current = { ...latest.current, version: remote.version }; setRemote(null); setError(null); save(); }}>确认以我的构思替换此版本</button></div> : null}</div> : null}
    {open && !value && !error ? <p role="status">正在读取构思…</p> : null}
    {open && value ? <div className="project-notebook__body">
      <div className="project-notebook__fields">{fields.filter(([key]) => key === "thought" || detailsOpen).map(([key, label, placeholder]) => <label key={key}>{label}<textarea aria-label={label} rows={key === "thought" ? 3 : 2} value={value[key]} placeholder={placeholder} onChange={(event) => change(key, event.target.value)} onBlur={() => { if (dirty && !busy) save(); }} /></label>)}</div>
      <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? "收起补充信息" : "补充读者、疑问与依据"}</button>
      <details><summary>创作方向（可选）</summary><label>创作方向（可选）<select aria-label="创作方向（可选）" value={value.agendaId || ""} onChange={(event) => change("agendaId", event.target.value || null)}><option value="">不限定方向</option>{agendas.map((agenda) => <option key={agenda.id} value={agenda.id}>{agenda.title}</option>)}</select></label>
      <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={() => setNewDirection(newDirection ? null : { title: "", desiredJudgment: "", audience: "", problemSpace: "", valueCommitment: "", relatedProduct: "" })}>新建创作方向</button>
      {newDirection ? <div className="project-notebook__fields">{[["title", "方向名称"], ["desiredJudgment", "希望读者形成的认识"], ["audience", "服务谁（可选）"], ["problemSpace", "持续关注的问题（可选）"]].map(([key, label]) => <label key={key}>{label}<input aria-label={label} value={newDirection[key]} onChange={(event) => setNewDirection({ ...newDirection, [key]: event.target.value })} /></label>)}<button type="button" className="btn btn-sm" disabled={directionBusy || !newDirection.title.trim() || !newDirection.desiredJudgment.trim()} onClick={saveDirection}>保存方向并用于这篇</button></div> : null}
      {value.agendaId ? <p>{agendas.find((agenda) => agenda.id === value.agendaId)?.desiredJudgment}</p> : null}
      </details>
      <ProjectResearchLinks projectId={projectId} onGo={onGo} />
      <details><summary>比较讲法 · {value.alternatives.length} 个候选</summary>
        {value.discovery?.connection ? <button type="button" className="btn btn-sm" disabled={generating || busy} onClick={compare}>{generating ? "正在比较…" : "根据这个方向生成讲法候选"}</button> : null}
        <p>候选保留在这里。可以改构思，也可以直接继续写，正文不会被替换。</p>
        {value.alternatives.map((item, index) => <div className="project-notebook__alternative" key={item.id}><label>讲法 {index + 1}<input aria-label={`讲法 ${index + 1} 名称`} value={item.label} onChange={(event) => change("alternatives", value.alternatives.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry))} /></label><textarea aria-label={`讲法 ${index + 1} 内容`} rows={4} value={item.body} onChange={(event) => change("alternatives", value.alternatives.map((entry) => entry.id === item.id ? { ...entry, body: event.target.value } : entry))} /><button type="button" className="btn btn-sm" onClick={() => useAlternative(item)}>用作当前构思</button>{Array.isArray(value.discovery?.routes) && value.discovery.routes.some((route) => route.id === item.id) ? <div><input aria-label={`调整讲法 ${index + 1}`} placeholder="例如：保留判断，换一个更具体的开头" value={refinements[item.id] || ""} onChange={(event) => setRefinements({ ...refinements, [item.id]: event.target.value })} /><button type="button" className="btn btn-sm" disabled={generating || !refinements[item.id]?.trim()} onClick={() => refineAlternative(item.id)}>{generating ? "正在调整…" : "调整这条候选"}</button></div> : null}</div>)}
        <button type="button" className="btn btn-sm" disabled={value.alternatives.length >= 20} onClick={() => change("alternatives", [...value.alternatives, { id: crypto.randomUUID(), label: "另一种讲法", body: "" }])}>记下另一种讲法</button>
      </details>
      {value.discovery?.connection ? <details><summary>这个方向的来源与假设</summary><p>{value.discovery.connection.problem?.statement}</p><p>{value.discovery.connection.problem?.origin === "hypothesis" ? "受众假设，尚待验证" : "引用原话需回到来源核对"}</p>{(Array.isArray(value.discovery.connection.knowledgeAnchors) ? value.discovery.connection.knowledgeAnchors : []).map((anchor) => <button key={anchor.wikiPageId} type="button" className="btn btn-sm" onClick={() => onGo?.("entries", anchor.wikiPageId)}>{anchor.title}</button>)}<p>{value.discovery.connection.knowledgeExplanation}</p></details> : null}
      {value.discovery?.research?.conversationId ? <button type="button" className="btn btn-sm" onClick={() => onGo?.("assistant", value.discovery.research.conversationId)}>回到原研究对话</button> : null}
      <div className="project-notebook__actions"><button type="button" className="btn btn-sm" onClick={() => ask("帮我理清这篇的想法，一次只问一个问题。")}>理清想法</button><button type="button" className="btn btn-sm" onClick={() => ask("基于当前真实材料比较三种不同讲法，说明各自适合的表达与缺口，不编造经历。")}>比较讲法</button><button type="button" className="btn btn-sm" onClick={() => ask("核对当前判断的依据，找反例并指出还缺哪些材料。")}>找依据与反例</button><button type="button" className="btn btn-sm" disabled={busy || !dirty} onClick={save}>保存构思</button></div>
    </div> : null}
  </section>;
}
