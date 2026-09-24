// 这篇的构思（2026-09-24 起就是「选题」本身：选题和写作合并成一个工作区）。
//
// 从上到下回答开写前要想清楚的事：想讲什么 → 为什么写 → 写给谁、读者能得到什么 → 还缺什么 →
// 手上有什么 → 我的判断与笔记；讲法候选、创作方向、来源假设和以前的讨论收在「更多」里。都可以留空。
// 「还缺什么」是勾选清单，存在 `questions` 里（读写规则见 `lib/content-checklist.js`）；
// 第一项「你的实测」不存文字，按这篇有没有挂经历类个人资产推算（`plan.experience`，服务端给）。
//
// ⚠️ 同一时刻只能挂一个构思实例：工作区在「构思」视图时它在中间，在「正文」视图时它在侧栏，
// 切换前先保存（`saveRef`）。两个实例同时在，会各自拿着旧版本号互相顶掉。
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { appendItems, parseChecklist, removeItem, setItemDone } from "../lib/content-checklist.js";
import { ExperienceNote } from "./ExperienceNote.jsx";
import { ErrorNote } from "./ui.jsx";
import "./project-notebook.css";

const WINDOW = { "24h": "建议 24 小时内写", week: "建议本周内写", evergreen: "不赶时效" };

const fields = [
  ["thought", "想讲什么", "一句疑问、一段经历或还没成形的想法都可以。"],
  ["audience", "写给谁", "可选，谁会关心这件事？"],
  ["intent", "读者能得到什么", "可选，读完能做成什么、少走什么弯路。"],
  ["questions", "还缺什么", ""],
  ["evidenceNotes", "我的判断与笔记", "自己的判断、试用时的记录、想到的例子。"],
];

// 构思只保存探索，不采纳 AI 候选，也不改变正式正文。
export function ProjectNotebook({ projectId, onSaved, onAsk, onGo, onDirty, saveRef, onEdited, compact = false, plan = null, origin = null, onOpenMaterials, onPlanChanged }) {
  const [value, setValue] = useState(null);
  const [agendas, setAgendas] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [generating, setGenerating] = useState(false);
  const [remote, setRemote] = useState(null);
  const [newDirection, setNewDirection] = useState(null);
  const [directionBusy, setDirectionBusy] = useState(false);
  const [refinements, setRefinements] = useState({});
  // 这篇背后的研究记录：情报来源、挂上的资料和 Wiki、以前的讨论（「为什么写」「手上有什么」用）。
  const [research, setResearch] = useState(null);
  const [newItem, setNewItem] = useState("");
  const [recording, setRecording] = useState(false);
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
    }).catch((cause) => { if (alive) setError(cause); });
    api.agendas().then((result) => { if (alive) setAgendas(result.agendas || []); }).catch(() => {});
    api.projectResearches(projectId).then((result) => { if (alive) setResearch(result.researches?.[0] || null); }).catch(() => { if (alive) setResearch(null); });
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

  function checklist(next) { change("questions", next); }
  function addItem(event) {
    event.preventDefault();
    if (!newItem.trim()) return;
    checklist(appendItems(value.questions, [newItem])); setNewItem("");
  }
  /** 「让 AI 找」：只交给右侧协作去找和导读，不改构思、不起稿。 */
  function findFor(label) {
    onAsk?.(`帮我补上这篇内容还缺的一项：「${label}」。先查找并阅读实际原文，给出处和一句导读；找不到就直说，不要编造。不要改写正文，也不要替我勾掉这一项。\n这篇想讲的是：${value.thought || "未定"}`);
  }

  function ask(task) {
    onAsk?.(`${task}\n以下是这篇内容当前的探索记录，均不等于已核实事实。不要自动改写正文。\n${fields.map(([key, label]) => `${label}：${value[key] || "未定"}`).join("\n")}\n候选讲法：${JSON.stringify(value.alternatives)}`);
  }

  const intents = (research?.intelligenceIntents || []).filter((item) => !item.unavailable);
  const intent = intents.at(-1) || null;
  const brief = intents.map((item) => item.brief).filter(Boolean).at(-1) || null;
  const checklistItems = value ? parseChecklist(value.questions).items : [];
  const earlier = value ? parseChecklist(value.questions).other : "";
  const evidence = intents.flatMap((item) => item.evidence || []).slice(0, 6);
  const wikiLinks = intents.flatMap((item) => item.wikiLinks || []);
  const references = (research?.references || []).filter((item) => !item.missing && item.kind !== "wiki");
  const conversations = research?.conversations || [];
  const field = (key, label, placeholder, rows = 2) => <label className={`content-plan__field content-plan__field--${key}`}>{label}<textarea aria-label={label} rows={rows} value={value[key]} placeholder={placeholder} onChange={(event) => change(key, event.target.value)} onBlur={() => { if (dirty && !busy) save(); }} /></label>;

  return <section className={`project-notebook content-plan${compact ? " is-compact" : ""}`} aria-label="这篇的构思">
    <header><span role="status">{status || "可以随写随改，不必先填完整"}</span>{dirty ? <button type="button" className="btn btn-sm" disabled={busy} onClick={save}>{busy ? "保存中…" : "保存构思"}</button> : null}</header>
    <ErrorNote error={error} what="构思" onRetry={!value ? () => window.location.reload() : save} />
    {error?.status === 409 ? <div><button type="button" className="btn btn-sm" onClick={viewRemote}>查看另一处保存的构思</button>{remote ? <div><p>另一处的版本 {remote.version}。下面是已保存内容；你的输入仍留在编辑区。</p><pre style={{ whiteSpace: "pre-wrap" }}>{fields.map(([key, label]) => `${label}：${remote[key]}`).join("\n")}</pre><button type="button" className="btn btn-sm" onClick={() => { latest.current = { ...latest.current, version: remote.version }; setRemote(null); setError(null); save(); }}>确认以我的构思替换此版本</button></div> : null}</div> : null}
    {!value && !error ? <p role="status">正在读取构思…</p> : null}
    {value ? <div className="project-notebook__body">
      {field("thought", "想讲什么", "一句疑问、一段经历或还没成形的想法都可以。", compact ? 2 : 3)}

      {brief || origin ? <section className="content-plan__block" aria-label="为什么写">
        <h3>为什么写</h3>
        {brief ? <div className="content-plan__why">
          <p className="content-plan__event">{brief.title}</p>
          {brief.summary ? <p>{brief.summary}</p> : null}
          {brief.whyItMatters ? <p>{brief.whyItMatters}</p> : null}
          <p className="content-plan__meta">{intent?.creation?.window ? <span className={intent.creation.window === "24h" ? "is-urgent" : ""}>{WINDOW[intent.creation.window]}</span> : null}<button type="button" className="text-action" onClick={() => onGo?.("intel-detail", brief.id)}>看原情报卡</button></p>
        </div> : null}
        {origin}
      </section> : null}

      <div className="content-plan__pair">
        {field("audience", "写给谁", "可选，谁会关心这件事？")}
        {field("intent", "读者能得到什么", "可选，读完能做成什么、少走什么弯路。")}
      </div>

      <section className="content-plan__block" aria-label="还缺什么">
        <h3>还缺什么</h3>
        <ul className="content-plan__checklist">
          <li className={plan?.experience ? "is-done" : ""}>
            <input type="checkbox" checked={Boolean(plan?.experience)} readOnly disabled aria-label="你的实测 / 使用体验" />
            <span>你的实测 / 使用体验{plan?.experience ? "（已挂上）" : ""}</span>
            {!plan?.experience && !recording ? <button type="button" className="text-action" onClick={() => setRecording(true)}>记下实测</button> : null}
          </li>
          {recording ? <li className="content-plan__record"><ExperienceNote projectId={projectId} topic={value.thought} onCancel={() => setRecording(false)} onDone={() => { setRecording(false); onPlanChanged?.(); }} /></li> : null}
          {checklistItems.map((item) => <li key={`${item.index}:${item.text}`} className={item.done ? "is-done" : ""}>
            <input type="checkbox" checked={item.done} aria-label={item.text} onChange={(event) => checklist(setItemDone(value.questions, item.index, event.target.checked))} />
            <span>{item.text}</span>
            {!item.done && onAsk ? <button type="button" className="text-action" onClick={() => findFor(item.text)}>让 AI 找</button> : null}
            <button type="button" className="text-action content-plan__remove" aria-label={`删掉「${item.text}」`} onClick={() => checklist(removeItem(value.questions, item.index))}>删掉</button>
          </li>)}
        </ul>
        <form className="content-plan__add" onSubmit={addItem}><input aria-label="加一项待补的事" placeholder="还缺什么？例如：官方价格表" value={newItem} maxLength={300} onChange={(event) => setNewItem(event.target.value)} /><button className="btn btn-sm" disabled={!newItem.trim()}>加一项</button></form>
        {earlier ? <p className="content-plan__earlier"><span>以前记下的疑问</span>{earlier}</p> : null}
      </section>

      <section className="content-plan__block" aria-label="手上有什么">
        <h3>手上有什么</h3>
        {brief?.keyFacts?.length ? <ul className="content-plan__facts">{brief.keyFacts.map((fact, index) => <li key={index}>{fact}</li>)}</ul> : null}
        {evidence.length ? <details className="content-plan__evidence"><summary>原文依据 · {evidence.length}</summary>{evidence.map((item, index) => <blockquote key={index}>{item.quote}<small>{item.title || "原文"}</small></blockquote>)}</details> : null}
        {wikiLinks.length ? <ul className="content-plan__wiki">{wikiLinks.map((link) => <li key={link.id}><span className="content-plan__kind">知识</span><button type="button" className="text-action" onClick={() => onGo?.("entries", link.id)}>《{link.title}》</button>{link.quote ? <q>{link.quote}</q> : null}{link.application || link.point ? <span>{link.application || link.point}</span> : null}</li>)}</ul> : null}
        {references.length ? <ul className="content-plan__refs">{references.map((item) => <li key={`${item.kind}:${item.id}`}><button type="button" className="text-action" onClick={() => onGo?.("library", `${item.kind}:${item.id}`)}>{item.title || "未命名资料"}</button>{item.nature ? <small>{item.nature}</small> : null}</li>)}</ul> : null}
        {!brief?.keyFacts?.length && !evidence.length && !wikiLinks.length && !references.length ? <p className="content-plan__empty">还没有挂资料。</p> : null}
        {onOpenMaterials ? <button type="button" className="btn btn-sm" onClick={onOpenMaterials}>补资料</button> : null}
      </section>

      {field("evidenceNotes", "我的判断与笔记", "自己的判断、试用时的记录、想到的例子。", compact ? 3 : 4)}

      <details className="content-plan__more"><summary>更多：讲法候选、创作方向、来源假设{conversations.length ? "、以前的讨论" : ""}</summary>
      <details><summary>创作方向（可选）</summary><label>创作方向（可选）<select aria-label="创作方向（可选）" value={value.agendaId || ""} onChange={(event) => change("agendaId", event.target.value || null)}><option value="">不限定方向</option>{agendas.map((agenda) => <option key={agenda.id} value={agenda.id}>{agenda.title}</option>)}</select></label>
      <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={() => setNewDirection(newDirection ? null : { title: "", desiredJudgment: "", audience: "", problemSpace: "", valueCommitment: "", relatedProduct: "" })}>新建创作方向</button>
      {newDirection ? <div className="project-notebook__fields">{[["title", "方向名称"], ["desiredJudgment", "希望读者形成的认识"], ["audience", "服务谁（可选）"], ["problemSpace", "持续关注的问题（可选）"]].map(([key, label]) => <label key={key}>{label}<input aria-label={label} value={newDirection[key]} onChange={(event) => setNewDirection({ ...newDirection, [key]: event.target.value })} /></label>)}<button type="button" className="btn btn-sm" disabled={directionBusy || !newDirection.title.trim() || !newDirection.desiredJudgment.trim()} onClick={saveDirection}>保存方向并用于这篇</button></div> : null}
      {value.agendaId ? <p>{agendas.find((agenda) => agenda.id === value.agendaId)?.desiredJudgment}</p> : null}
      </details>
      <details><summary>比较讲法 · {value.alternatives.length} 个候选</summary>
        {value.discovery?.connection ? <button type="button" className="btn btn-sm" disabled={generating || busy} onClick={compare}>{generating ? "正在比较…" : "根据这个方向生成讲法候选"}</button> : null}
        <p>候选保留在这里。可以改构思，也可以直接继续写，正文不会被替换。</p>
        {value.alternatives.map((item, index) => <div className="project-notebook__alternative" key={item.id}><label>讲法 {index + 1}<input aria-label={`讲法 ${index + 1} 名称`} value={item.label} onChange={(event) => change("alternatives", value.alternatives.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry))} /></label><textarea aria-label={`讲法 ${index + 1} 内容`} rows={4} value={item.body} onChange={(event) => change("alternatives", value.alternatives.map((entry) => entry.id === item.id ? { ...entry, body: event.target.value } : entry))} /><button type="button" className="btn btn-sm" onClick={() => useAlternative(item)}>用作当前构思</button>{Array.isArray(value.discovery?.routes) && value.discovery.routes.some((route) => route.id === item.id) ? <div><input aria-label={`调整讲法 ${index + 1}`} placeholder="例如：保留判断，换一个更具体的开头" value={refinements[item.id] || ""} onChange={(event) => setRefinements({ ...refinements, [item.id]: event.target.value })} /><button type="button" className="btn btn-sm" disabled={generating || !refinements[item.id]?.trim()} onClick={() => refineAlternative(item.id)}>{generating ? "正在调整…" : "调整这条候选"}</button></div> : null}</div>)}
        <button type="button" className="btn btn-sm" disabled={value.alternatives.length >= 20} onClick={() => change("alternatives", [...value.alternatives, { id: crypto.randomUUID(), label: "另一种讲法", body: "" }])}>记下另一种讲法</button>
      </details>
      {value.discovery?.connection ? <details><summary>这个方向的来源与假设</summary><p>{value.discovery.connection.problem?.statement}</p><p>{value.discovery.connection.problem?.origin === "hypothesis" ? "受众假设，尚待验证" : "引用原话需回到来源核对"}</p>{(Array.isArray(value.discovery.connection.knowledgeAnchors) ? value.discovery.connection.knowledgeAnchors : []).map((anchor) => <button key={anchor.wikiPageId} type="button" className="btn btn-sm" onClick={() => onGo?.("entries", anchor.wikiPageId)}>{anchor.title}</button>)}<p>{value.discovery.connection.knowledgeExplanation}</p></details> : null}
      {conversations.length ? <div className="content-plan__talks"><span>以前的讨论</span>{conversations.slice(0, 5).map((talk) => <button key={talk.id} type="button" className="text-action" onClick={() => onGo?.("assistant", talk.id)}>{talk.title || "未命名讨论"}</button>)}</div> : null}
      {value.discovery?.research?.conversationId ? <button type="button" className="btn btn-sm" onClick={() => onGo?.("assistant", value.discovery.research.conversationId)}>回到原研究对话</button> : null}
      </details>
      <div className="project-notebook__actions"><button type="button" className="btn btn-sm" onClick={() => ask("帮我理清这篇的想法，一次只问一个问题。")}>理清想法</button><button type="button" className="btn btn-sm" onClick={() => ask("基于当前真实材料比较三种不同讲法，说明各自适合的表达与缺口，不编造经历。")}>比较讲法</button><button type="button" className="btn btn-sm" onClick={() => ask("核对当前判断的依据，找反例并指出还缺哪些材料。")}>找依据与反例</button></div>
    </div> : null}
  </section>;
}
