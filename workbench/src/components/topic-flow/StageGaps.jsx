// 第三步：补齐。只列选定角度真正缺的东西；每项说清为什么需要、去哪找，操作只有三种：找到了 / 让 AI 先找 / 这条不写了。
// 需要亲身经历的一项只能作者来：存成经历类个人资产、经授权挂到这一篇（ExperienceNote），AI 起稿时才认得这段第一人称。
// 缺口没补完也能往下走——结构和初稿会把缺的地方标成【待补】，不拿别的东西充数。
import { useState } from "react";
import { api } from "../../lib/api.js";
import { appendItems, parseChecklist, setItemDone } from "../../lib/content-checklist.js";
import { ExperienceNote } from "../ExperienceNote.jsx";
import { ErrorNote } from "../ui.jsx";

export function StageGaps({ projectId, view, busy, onNext, onReload, onAsk, onAddMaterial }) {
  const { plan, checklist, experienceCount } = view;
  const angle = plan.chosenAngle;
  const skipped = new Set(plan.skipped || []);
  const [recording, setRecording] = useState(""), [error, setError] = useState(null), [saving, setSaving] = useState("");
  const state = (g) => skipped.has(g.label) ? "skip" : g.kind === "exp" ? (experienceCount > 0 ? "done" : "open") : checklist.some((c) => c.text === g.label && c.done) ? "done" : "open";

  /** 把一项标成已补 / 不写了：改清单里那一行（没有就先加上），不写了另记在 plan.skipped。 */
  async function mark(g, skip = false) {
    setSaving(g.label); setError(null);
    try {
      const { notebook } = await api.projectNotebook(projectId);
      let q = appendItems(notebook.questions, [g.label]);
      const item = parseChecklist(q).items.find((i) => i.text === g.label);
      if (item) q = setItemDone(q, item.index, true);
      const nextPlan = skip ? { ...(notebook.plan || {}), skipped: [...new Set([...(notebook.plan?.skipped || []), g.label])] } : undefined;
      await api.saveProjectNotebook(projectId, { expectedVersion: notebook.version, questions: q, ...(nextPlan ? { plan: nextPlan } : {}) });
      await onReload();
    } catch (e) { setError(e); } finally { setSaving(""); }
  }

  const others = checklist.filter((c) => !c.done && !angle.gaps.some((g) => g.label === c.text));
  const open = angle.gaps.filter((g) => state(g) === "open").length;
  return <section className="tf-stage" aria-label="补齐">
    <p className="tf-lead-sm">按「{angle.title}」对了一遍手上的资料。{angle.gaps.length ? `写成这个角度，还缺下面 ${angle.gaps.length} 项。` : "材料是够的，可以直接搭结构。"}</p>
    <ErrorNote error={error} what="记下补齐进度" />
    <ol className="tf-gaps">
      {angle.gaps.map((g) => {
        const s = state(g);
        return <li key={g.label} className={`tf-gap is-${s}`}>
          <div className="tf-gap__head"><h3>{g.label}</h3>{s === "done" ? <span className="tf-tag is-done">已补上</span> : s === "skip" ? <span className="tf-tag">不写了</span> : g.kind === "exp" ? <span className="tf-tag is-own">只能你来</span> : null}</div>
          {g.why && s === "open" ? <p className="tf-gap__why">{g.why}</p> : null}
          {s === "open" && g.kind === "find" && g.where?.length ? <p className="tf-where"><span>去哪找</span>{g.where.map((x) => <code key={x}>{x}</code>)}</p> : null}
          {s === "open" ? (g.kind === "exp"
            ? (recording === g.label ? <ExperienceNote projectId={projectId} topic={g.label} onCancel={() => setRecording("")} onDone={async () => { setRecording(""); await onReload(); }} />
              : <p className="tf-gap__acts"><button type="button" className="btn btn-sm" onClick={() => setRecording(g.label)}>记下我的实测</button><button type="button" className="text-action" disabled={saving === g.label} onClick={() => mark(g, true)}>这条不写了</button></p>)
            : <p className="tf-gap__acts">
                <button type="button" className="btn btn-sm" disabled={saving === g.label} onClick={async () => { onAddMaterial?.(); await mark(g); }}>找到了，放进资料</button>
                <button type="button" className="text-action" onClick={() => onAsk?.(`帮我补上这篇还缺的一项：「${g.label}」。${g.why ? `为什么需要：${g.why}。` : ""}先查找并阅读实际原文，给出处和一句导读；找不到就直说，不要编造，也不要改写正文。`)}>让 AI 先找找</button>
                <button type="button" className="text-action" disabled={saving === g.label} onClick={() => mark(g, true)}>这条不写了</button>
              </p>) : null}
        </li>;
      })}
    </ol>
    {others.length ? <div className="tf-block"><h2>其他待补</h2><ul className="tf-quiet">{others.map((c) => <li key={c.index}>{c.text}</li>)}</ul></div> : null}
    <div className="tf-next">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onNext}>{busy ? "正在搭结构…" : "搭结构"}</button>
      <span className="tf-hint">{busy ? "大约 20 秒" : open ? `还缺 ${open} 项也可以先往下走，初稿会把缺的地方标出来` : ""}</span>
    </div>
  </section>;
}
