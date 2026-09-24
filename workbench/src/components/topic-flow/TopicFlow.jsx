// 选题到初稿（2026-09-24）：系统先写，用户来选。
//
//   读懂 → 选角度 → 补齐 → 定结构 → 写初稿
//
// 这一栏是一篇阅读宽度的文档，不是一叠卡片：进度只占一行，做过的步骤写出结论、点一下回去改；
// 只展开当前这一步，每一屏只有一个主按钮。AI 的每一步结果都存在服务端（构思里的 plan），刷新不丢、不重复花钱。
// 设计规则见 docs/design-system.md「选题流程」；数据见 server/domain/content-plan-ai.mjs。
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { ErrorNote, Loading } from "../ui.jsx";
import { StageRead } from "./StageRead.jsx";
import { StageAngles, HOW } from "./StageAngles.jsx";
import { StageGaps } from "./StageGaps.jsx";
import { StageStructure } from "./StageStructure.jsx";
import "./topic-flow.css";

const STEP_NAMES = ["读懂", "选角度", "补齐", "定结构"];

/** 进到页面时停在哪一步：走到哪算哪。 */
function startStep(plan) {
  if (plan.structures?.items?.length) return 4;
  if (plan.chosenAngle) return 3;
  if (plan.angles?.items?.length) return 2;
  return 1;
}

export function TopicFlow({ projectId, title, onDraft, onAsk, onAddMaterial, onGo, reloadKey = 0, startAt = 0 }) {
  const [view, setView] = useState(null), [error, setError] = useState(null);
  const [step, setStep] = useState(0), [busy, setBusy] = useState("");
  const top = useRef(null);

  const load = useCallback(async () => {
    try { const next = await api.projectPlan(projectId); setView(next); setError(null); return next; }
    catch (e) { setError(e); return null; }
  }, [projectId]);
  // 从编辑器的进度线点回来时，直接停在点的那一步；否则走到哪算哪。
  useEffect(() => { load().then((v) => { if (v) setStep((s) => startAt || s || startStep(v.plan)); }); }, [load, reloadKey, startAt]);

  // 深读还在生成：每 6 秒看一次，生成完第一步自动换成完整内容。
  const deepening = view?.read?.kind === "intel" && ["queued", "running"].includes(view.read.deepen?.status);
  useEffect(() => { if (!deepening) return undefined; const t = setInterval(load, 6000); return () => clearInterval(t); }, [deepening, load]);

  // 换一步就回到这一栏顶上（滚的是外壳的 .main，不是整页——整页滚会让标题钻到顶栏底下）。
  const go = (n) => { setStep(n); requestAnimationFrame(() => top.current?.closest(".main")?.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })); };
  async function run(kind, fn, next) {
    setBusy(kind); setError(null);
    try { const r = await fn(); if (r?.plan) setView(r); if (next) go(next); return r; }
    catch (e) { setError(e); return null; }
    finally { setBusy(""); }
  }

  if (!view) return error ? <ErrorNote error={error} what="读取这篇选题" onRetry={load} /> : <Loading rows={4} />;
  const { plan } = view;
  const angle = plan.chosenAngle;
  const gaps = angle?.gaps || [];
  const doneGaps = gaps.filter((g) => g.kind === "exp" ? view.experienceCount > 0 : view.checklist.some((c) => c.text === g.label && c.done)).length;
  const reach = [true, Boolean(plan.angles?.items?.length) || step >= 2, Boolean(angle), Boolean(angle)];
  const trail = [
    "读懂",
    angle ? <>角度：<b>{HOW[angle.how] || "自己定的"}</b></> : "选角度",
    angle ? <>补齐 <b>{doneGaps}/{gaps.length}</b></> : "补齐",
    plan.structures?.items?.length ? <>结构：<b>{plan.structures.items[plan.chosenStructure || 0]?.name.split(/\s|→/)[0]}</b></> : "定结构",
  ];
  const done = [step > 1 || Boolean(angle), Boolean(angle), Boolean(angle) && doneGaps === gaps.length, Boolean(plan.draftAt)];

  return <div className="topic-flow" ref={top}>
    <header className="topic-flow__head">
      <h1>{angle?.title || title}</h1>
      {angle && title && title !== angle.title ? <p className="topic-flow__from">选题：{title}</p> : null}
      <nav className="topic-flow__trail" aria-label="选题进度">
        {trail.map((label, i) => <span key={i} className="topic-flow__crumb">
          {i ? <span className="topic-flow__sep" aria-hidden="true">›</span> : null}
          <button type="button" aria-current={step === i + 1 ? "step" : undefined} className={done[i] ? "is-done" : ""} disabled={!reach[i]} onClick={() => go(i + 1)}>{label}</button>
        </span>)}
        {plan.draftAt ? <span className="topic-flow__crumb"><span className="topic-flow__sep" aria-hidden="true">›</span><button type="button" className="is-done" onClick={() => onDraft?.({ open: true })}>初稿</button></span> : null}
      </nav>
    </header>
    <ErrorNote error={error} what={busy === "angles" ? "想角度" : busy === "structures" ? "搭结构" : busy === "draft" ? "写初稿" : "这一步"} onRetry={() => setError(null)} />
    <div className="topic-flow__stage" key={step}>
      {step === 1 ? <StageRead view={view} title={title} busy={busy === "angles"} onNext={() => plan.angles?.items?.length ? go(2) : run("angles", () => api.planAngles(projectId), 2)} onGo={onGo} /> : null}
      {step === 2 ? <StageAngles plan={plan} busy={busy} onRegenerate={() => run("angles", () => api.planAngles(projectId, true))}
        onChoose={(body) => run("choose", () => api.planChooseAngle(projectId, body), 3)} onAsk={onAsk} onGenerate={() => run("angles", () => api.planAngles(projectId))} /> : null}
      {step === 3 && angle ? <StageGaps projectId={projectId} view={view} onReload={load} onAsk={onAsk} onAddMaterial={onAddMaterial}
        busy={busy === "structures"} onNext={() => plan.structures?.items?.length && !plan.structuresStale ? go(4) : run("structures", () => api.planStructures(projectId), 4)} /> : null}
      {step === 4 ? <StageStructure plan={plan} busy={busy} onRegenerate={() => run("structures", () => api.planStructures(projectId, true))}
        onWrite={async (choice) => {
          const chosen = await run("draft", () => api.planChooseStructure(projectId, choice));
          if (!chosen) return;
          const result = await run("draft", () => api.planDraft(projectId));
          if (result) onDraft?.(result);
        }} /> : null}
    </div>
  </div>;
}

export { STEP_NAMES };
