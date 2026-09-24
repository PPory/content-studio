// 第三步：补齐。列出选定角度缺的东西，加上清单里别的待补项（研究时记下的疑问）；每项说清为什么需要，操作只有三种：让 AI 找 / 我自己放 / 这条不写了。
// 「已补上」只在资料真的挂进这篇之后才标（补资料面板里挂上、或在协作里确认 AI 找到的那份）——点了按钮不算。
// 去哪找（搜索词和地方）不摆在界面上，交给 AI 当线索。
// 需要亲身经历的一项只能作者来：存成经历类个人资产、经授权挂到这一篇（ExperienceNote），AI 起稿时才认得这段第一人称；
// 记下之后只勾这一项（经历缺口逐条算）。
// 缺口没补完也能往下走——结构和初稿会把缺的地方标成【待补】，不拿别的东西充数。
// `focus`：从正文里点【待补：X】回来时，滚到并轻轻标出 X 那一项。
import { useEffect, useRef, useState } from "react";
import { ExperienceNote } from "../ExperienceNote.jsx";
import { gapList, gapState, markGap } from "./gaps.js";
import { ErrorNote } from "../ui.jsx";

export function StageGaps({ projectId, view, busy, onNext, onReload, onAsk, onAddMaterial, focus = "" }) {
  const angle = view.plan.chosenAngle;
  const gaps = gapList(view);
  const [recording, setRecording] = useState(""), [error, setError] = useState(null), [saving, setSaving] = useState("");
  const list = useRef(null);
  // 【待补：X】的 X 是初稿里写的说法，不一定和缺口标签一字不差：先找完全相同的，再找互相包含的。
  const focused = focus ? (gaps.find((g) => g.label === focus) || gaps.find((g) => g.label.includes(focus) || focus.includes(g.label)))?.label || "" : "";
  useEffect(() => {
    if (!focus) return;
    const el = focused ? list.current?.querySelector(`[data-gap="${CSS.escape(focused)}"]`) : list.current;
    el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [focus, focused]);

  async function act(g, fn) {
    setSaving(g.label); setError(null);
    try { await fn(); await onReload(); } catch (e) { setError(e); } finally { setSaving(""); }
  }
  const skip = (g) => act(g, () => markGap(projectId, g.label, { skip: true }));
  const askAi = (g) => onAsk?.(`帮我找这篇还缺的一项：「${g.label}」。${g.why ? `为什么需要：${g.why}。` : ""}${g.where?.length ? `可以从这些地方找：${g.where.join("；")}。` : ""}先查找并阅读实际原文；每找到一份能用的网页，就提出「放进这篇的资料」让我确认，并用一句话说它能补上什么。找不到就直说，不要编造，也不要改写正文。`, g.label);

  const open = gaps.filter((g) => gapState(view, g) === "open").length;
  return <section className="tf-stage" aria-label="补齐">
    <p className="tf-lead-sm">按「{angle.title}」对了一遍手上的资料。{gaps.length ? `写成这个角度，还缺下面 ${gaps.length} 项。` : "材料是够的，可以直接搭结构。"}</p>
    <ErrorNote error={error} what="记下补齐进度" />
    <ol className="tf-gaps" ref={list}>
      {gaps.map((g) => {
        const s = gapState(view, g);
        return <li key={g.label} data-gap={g.label} className={`tf-gap is-${s}${focused === g.label ? " is-focus" : ""}`}>
          <div className="tf-gap__head"><h3>{g.label}</h3>{s === "done" ? <span className="tf-tag is-done">已补上</span> : s === "skip" ? <span className="tf-tag">不写了</span> : g.kind === "exp" ? <span className="tf-tag is-own">只能你来</span> : g.other ? <span className="tf-tag">之前记下的</span> : null}</div>
          {g.why && s === "open" ? <p className="tf-gap__why">{g.why}</p> : null}
          {s === "open" ? (g.kind === "exp"
            ? (recording === g.label ? <ExperienceNote projectId={projectId} topic={g.label} onCancel={() => setRecording("")} onDone={() => { setRecording(""); act(g, () => markGap(projectId, g.label)); }} />
              : <p className="tf-gap__acts"><button type="button" className="btn btn-sm" onClick={() => setRecording(g.label)}>记下我的实测</button><button type="button" className="text-action" disabled={saving === g.label} onClick={() => skip(g)}>这条不写了</button></p>)
            : <p className="tf-gap__acts">
                <button type="button" className="btn btn-sm" onClick={() => askAi(g)}>让 AI 找</button>
                <button type="button" className="text-action" onClick={() => onAddMaterial?.(g.label)}>我自己放</button>
                <button type="button" className="text-action" disabled={saving === g.label} onClick={() => skip(g)}>这条不写了</button>
              </p>) : null}
        </li>;
      })}
    </ol>
    <div className="tf-next">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onNext}>{busy ? "正在搭结构…" : "搭结构"}</button>
      <span className="tf-hint">{busy ? "大约 20 秒" : open ? `还缺 ${open} 项也可以先往下走，初稿会把缺的地方标出来` : ""}</span>
    </div>
  </section>;
}
