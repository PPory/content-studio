// 写初稿之后，编辑器上方那一行：和选题流程同一条进度线，每一步都能点回去改（换角度、补资料、换结构重写）。
// 后面跟着这篇的字数和还有几处【待补】——正文是编辑器里的实时内容，不是服务端存的统计；
// 「N 处待补」可点：每点一次跳到正文里下一处（onJumpGap）。
// 有一版还没看的 AI 初稿（正文已有字时生成的候选，存在 plan.pendingDraft）：这一行提示「有一版 AI 初稿等你看」。
import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { HOW } from "./StageAngles.jsx";
import { gapList, gapState } from "./gaps.js";

export function DraftTrail({ projectId, body = "", reloadKey = 0, onPick, onJumpGap, onPending }) {
  const [view, setView] = useState(null);
  useEffect(() => { let live = true; api.projectPlan(projectId).then((v) => { if (live) setView(v); }).catch(() => {}); return () => { live = false; }; }, [projectId, reloadKey]);
  const plan = view?.plan || {};
  const angle = plan.chosenAngle;
  const gaps = view ? gapList(view) : [];
  const done = gaps.filter((g) => gapState(view, g) !== "open").length;
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
    <span className="draft-trail__meta">
      {plan.pendingDraft?.body ? <button type="button" className="draft-trail__pending" onClick={() => onPending?.(plan.pendingDraft)}>有一版 AI 初稿等你看</button> : null}
      约 {words} 字
      {pending ? <button type="button" className="draft-trail__gaps" onClick={onJumpGap} title="跳到下一处【待补】">{pending} 处待补</button> : null}
    </span>
  </nav>;
}
