// 选题到初稿（2026-09-24）：系统先写，用户来选。
//
//   读懂 → 选角度 → 补齐 → 定结构 → 写初稿
//
// 这一栏是一篇阅读宽度的文档，不是一叠卡片：进度只占一行，做过的步骤写出结论、点一下回去改；
// 只展开当前这一步，每一屏只有一个主按钮。AI 的每一步结果都存在服务端（构思里的 plan），刷新不丢、不重复花钱。
// 设计规则见 docs/design-system.md「选题流程」；数据见 server/domain/content-plan-ai.mjs。
//
// ⚠️ 一篇只有一个标题（view.pieceTitle：主稿标题 / 第四步选的 / 选题本身），顶上只显示它；原来的选题名作为「来自」放小字，
// 角度只在进度线和第二步里出现。
// ⚠️ `startAt` 是 { step, id, focus }：从编辑器点回某一步时跳一次；之后刷新数据（放进资料等）不再把人拉回那一步。
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { ErrorNote, Loading } from "../ui.jsx";
import { StageRead } from "./StageRead.jsx";
import { StageAngles, HOW } from "./StageAngles.jsx";
import { StageGaps } from "./StageGaps.jsx";
import { StageStructure } from "./StageStructure.jsx";
import { gapList, gapState } from "./gaps.js";
import "./topic-flow.css";

const STEP_NAMES = ["读懂", "选角度", "补齐", "定结构"];
const WHAT = { angles: "想角度", choose: "记下角度", structures: "搭结构", draft: "写初稿" };

/** 进到页面时停在哪一步：走到哪算哪。 */
function startStep(plan) {
  if (plan.structures?.items?.length) return 4;
  if (plan.chosenAngle) return 3;
  if (plan.angles?.items?.length) return 2;
  return 1;
}

/** 顶栏左边那一小段：这篇在选题阶段走到哪了。 */
export function flowProgress(view) {
  if (!view) return "";
  const plan = view.plan, gaps = gapList(view);
  if (plan.draftAt) return "初稿已写";
  if (plan.structures?.items?.length) return "定结构";
  if (plan.chosenAngle) return `补齐 ${gaps.filter((g) => gapState(view, g) !== "open").length}/${gaps.length}`;
  if (plan.angles?.items?.length) return "选角度";
  return "读懂";
}

export function TopicFlow({ projectId, title, onDraft, onAsk, onAddMaterial, onGo, onSettings, onProgress, reloadKey = 0, startAt = null }) {
  const [view, setView] = useState(null), [error, setError] = useState(null);
  const [step, setStep] = useState(0), [busy, setBusy] = useState("");
  const top = useRef(null), failed = useRef(null);

  const load = useCallback(async () => {
    try { const next = await api.projectPlan(projectId); setView(next); setError(null); return next; }
    catch (e) { setError(e); return null; }
  }, [projectId]);
  // 刷新数据不改当前步；第一次进来走到哪算哪。
  useEffect(() => { load().then((v) => { if (v) setStep((s) => s || startAt?.step || startStep(v.plan)); }); }, [load, reloadKey]);
  // 从编辑器的进度线 / 【待补】点回来：只在这次跳转发生时跳一次。
  useEffect(() => { if (startAt?.step) setStep(startAt.step); }, [startAt?.id]);
  useEffect(() => { onProgress?.(flowProgress(view)); }, [view, onProgress]);

  // 深读还在生成：每 6 秒看一次，生成完第一步自动换成完整内容。
  const deepening = view?.read?.kind === "intel" && ["queued", "running"].includes(view.read.deepen?.status);
  useEffect(() => { if (!deepening) return undefined; const t = setInterval(load, 6000); return () => clearInterval(t); }, [deepening, load]);

  // 换一步就回到这一栏顶上（滚的是外壳的 .main，不是整页——整页滚会让标题钻到顶栏底下）。
  const go = (n) => { setStep(n); requestAnimationFrame(() => top.current?.closest(".main")?.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })); };
  /** 跑一步 AI。失败时记住这一步，「重试」就是真的再跑一次，而不是只把提示关掉。 */
  async function run(kind, fn, next) {
    setBusy(kind); setError(null); failed.current = null;
    try { const r = await fn(); if (r?.plan) setView(r); if (next) go(next); return r; }
    catch (e) { e.kind = kind; setError(e); failed.current = () => run(kind, fn, next); return null; }
    finally { setBusy(""); }
  }
  async function write(choice) {
    const chosen = await run("draft", () => api.planChooseStructure(projectId, choice));
    if (!chosen) return;
    const result = await run("draft", () => api.planDraft(projectId));
    if (result) onDraft?.(result);
  }

  if (!view) return error ? <ErrorNote error={error} what="读取这篇选题" onRetry={load} /> : <Loading rows={4} />;
  const { plan } = view;
  const angle = plan.chosenAngle;
  const gaps = gapList(view);
  const doneGaps = gaps.filter((g) => gapState(view, g) !== "open").length;
  const reach = [true, Boolean(plan.angles?.items?.length) || step >= 2, Boolean(angle), Boolean(angle)];
  const trail = [
    "读懂",
    angle ? <>角度：<b>{HOW[angle.how] || "自己定的"}</b></> : "选角度",
    angle ? <>补齐 <b>{doneGaps}/{gaps.length}</b></> : "补齐",
    plan.structures?.items?.length ? (() => { const name = plan.structures.items[plan.chosenStructure || 0]?.name || ""; return <>结构：<b className="is-long" title={name}>{name.split(/\s|→/)[0]}</b></>; })() : "定结构",
  ];
  const done = [step > 1 || Boolean(angle), Boolean(angle), Boolean(angle) && doneGaps === gaps.length, Boolean(plan.draftAt)];
  const noModel = /模型尚未配置|未配置模型/.test(error?.message || "");

  return <div className="topic-flow" ref={top}>
    <header className="topic-flow__head">
      <h1>{view.pieceTitle || title}</h1>
      {view.origin ? <p className="topic-flow__from">来自：{view.origin}</p> : null}
      <nav className="topic-flow__trail" aria-label="选题进度">
        {trail.map((label, i) => <span key={i} className="topic-flow__crumb">
          {i ? <span className="topic-flow__sep" aria-hidden="true">›</span> : null}
          <button type="button" aria-current={step === i + 1 ? "step" : undefined} className={done[i] ? "is-done" : ""} disabled={!reach[i]} onClick={() => go(i + 1)}>{label}</button>
        </span>)}
        {plan.draftAt || view.hasBody ? <span className="topic-flow__crumb"><span className="topic-flow__sep" aria-hidden="true">›</span><button type="button" className="is-done" onClick={() => onDraft?.({ open: true })}>{plan.draftAt ? "初稿" : "正文"}</button></span> : null}
      </nav>
    </header>
    {error ? <div className="tf-error">
      <ErrorNote error={error} what={WHAT[error.kind] || "这一步"} />
      <p className="tf-error__acts">
        {noModel && onSettings ? <button type="button" className="btn btn-sm" onClick={onSettings}>打开设置</button> : null}
        {failed.current ? <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => failed.current?.()}>重试</button> : null}
        <button type="button" className="text-action" onClick={() => { setError(null); failed.current = null; }}>先不管</button>
      </p>
    </div> : null}
    <div className="topic-flow__stage" key={step}>
      {step === 1 ? <StageRead projectId={projectId} view={view} title={view.pieceTitle || title} busy={busy === "angles"} onAsk={onAsk} onReload={load} onGo={onGo}
        onNext={() => plan.angles?.items?.length ? go(2) : run("angles", () => api.planAngles(projectId), 2)} /> : null}
      {step === 2 ? <StageAngles plan={plan} busy={busy} onRegenerate={() => run("angles", () => api.planAngles(projectId, true))}
        onChoose={(body) => run("choose", () => api.planChooseAngle(projectId, body), 3)} onGenerate={() => run("angles", () => api.planAngles(projectId))} /> : null}
      {step === 3 && angle ? <StageGaps projectId={projectId} view={view} onReload={load} onAsk={onAsk} onAddMaterial={onAddMaterial} focus={startAt?.focus || ""}
        busy={busy === "structures"} onNext={() => plan.structures?.items?.length && !plan.structuresStale ? go(4) : run("structures", () => api.planStructures(projectId), 4)} /> : null}
      {step === 4 ? <StageStructure plan={plan} busy={busy} hasBody={view.hasBody} onRegenerate={() => run("structures", () => api.planStructures(projectId, true))} onWrite={write} /> : null}
    </div>
  </div>;
}

export { STEP_NAMES };
