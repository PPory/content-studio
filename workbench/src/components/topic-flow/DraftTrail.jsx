// 写初稿之后，编辑器上方那一行：和选题流程同一条进度线，每一步都能点回去改（换角度、补资料、换结构重写）。
// 后面跟着这篇的字数和还有几处【待补】——正文是编辑器里的实时内容，不是服务端存的统计。
import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { HOW } from "./StageAngles.jsx";

export function DraftTrail({ projectId, body = "", reloadKey = 0, onPick }) {
  const [view, setView] = useState(null);
  useEffect(() => { let live = true; api.projectPlan(projectId).then((v) => { if (live) setView(v); }).catch(() => {}); return () => { live = false; }; }, [projectId, reloadKey]);
  const plan = view?.plan || {};
  const angle = plan.chosenAngle;
  const gaps = angle?.gaps || [];
  const done = gaps.filter((g) => g.kind === "exp" ? view.experienceCount > 0 : view.checklist.some((c) => c.text === g.label && c.done)).length;
  const words = String(body).replace(/\s+/g, "").length;
  const pending = (String(body).match(/【待补[:：]/g) || []).length;
  const steps = [
    "读懂",
    angle ? <>角度：<b>{HOW[angle.how] || "自己定的"}</b></> : "选角度",
    angle ? <>补齐 <b>{done}/{gaps.length}</b></> : "补齐",
    plan.structures?.items?.length ? (() => { const name = plan.structures.items[plan.chosenStructure || 0]?.name || ""; return <>结构：<b className="is-long" title={name}>{name.split(/\s|→/)[0]}</b></>; })() : "定结构",
  ];
  return <nav className="topic-flow__trail draft-trail" aria-label="选题进度">
    {steps.map((label, i) => <span key={i} className="topic-flow__crumb">
      {i ? <span className="topic-flow__sep" aria-hidden="true">›</span> : null}
      <button type="button" className="is-done" disabled={i > 0 && !angle} onClick={() => onPick(i + 1)} title="回到这一步">{label}</button>
    </span>)}
    <span className="topic-flow__crumb"><span className="topic-flow__sep" aria-hidden="true">›</span><button type="button" aria-current="step">{plan.draftAt ? "初稿" : "正文"}</button></span>
    <span className="draft-trail__meta">约 {words} 字{pending ? <>　<em>{pending} 处待补</em></> : null}</span>
  </nav>;
}
