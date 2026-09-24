// 第四步：定结构。两种结构、三个标题，都是可选的行；主按钮只有一个「按这个结构写初稿」。
// 结构只决定每一节讲什么、用哪份资料；初稿的小标题用文章自己的说法（服务端提示词里写明了）。
// 一篇只有一个标题：这里选的标题就是这篇的标题（写进主稿标题）。
// 正文已经有字时按钮写「按这个结构重写」，并说明结果是一版整篇对比、用不用由作者定。
// 「换两种结构」会再调用一次模型；上一组留着（plan.structuresPrev），可以切回去、也能从上一组里选。
import { useEffect, useState } from "react";
import { radioKeys } from "./radio-keys.js";

/** 写初稿要半分钟以上：按钮旁边数着秒，让人知道它在走。 */
function Elapsed() {
  const [s, setS] = useState(0);
  useEffect(() => { const t = setInterval(() => setS((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  return <span className="tf-hint" role="status">已经 {s} 秒，整篇大约 30–60 秒；可以先去看别的，写好会留在这篇里</span>;
}

export function StageStructure({ plan, busy, hasBody = false, onWrite, onRegenerate }) {
  const [showPrev, setShowPrev] = useState(false);
  const s = showPrev && plan.structuresPrev?.items?.length ? plan.structuresPrev : plan.structures;
  const [structure, setStructure] = useState(plan.chosenStructure || 0), [title, setTitle] = useState(plan.chosenTitle || 0);
  useEffect(() => { setStructure(showPrev ? 0 : plan.chosenStructure || 0); setTitle(showPrev ? 0 : plan.chosenTitle || 0); }, [s?.generatedAt]);
  if (!plan.structures?.items?.length) return <section className="tf-stage"><p className="tf-quiet-p">还没有结构。</p></section>;
  return <section className="tf-stage" aria-label="定结构">
    {plan.structuresStale && !showPrev ? <p className="tf-note">补过资料或换过角度，结构是按之前的情况搭的。<button type="button" className="text-action" disabled={Boolean(busy)} onClick={onRegenerate}>重新搭 · 会再调用一次模型</button></p> : null}
    {plan.structuresPrev?.items?.length ? <p className="tf-sets" role="group" aria-label="看哪一组结构">
      <button type="button" aria-pressed={!showPrev} onClick={() => setShowPrev(false)}>这一组</button>
      <button type="button" aria-pressed={showPrev} onClick={() => setShowPrev(true)}>上一组</button>
    </p> : null}
    <div className="tf-options tf-options--two" role="radiogroup" aria-label="两种结构">
      {s.items.map((it, i) => <div key={i} role="radio" aria-checked={structure === i} tabIndex={structure === i ? 0 : -1} className={`tf-option${structure === i ? " is-on" : ""}`} onClick={() => setStructure(i)} onKeyDown={radioKeys(s.items.length, i, setStructure)}>
        <h3>{it.name}</h3>
        {it.fit ? <p className="tf-option__fit">{it.fit}</p> : null}
        <ol className="tf-outline">{it.outline.sections.map((sec, j) => <li key={j}><strong>{sec.heading}</strong><span>{sec.purpose}{sec.uses?.length ? ` · 用：${[...new Set(sec.uses.map((u) => u.label))].join("、")}` : ""}</span></li>)}</ol>
      </div>)}
    </div>
    <div className="tf-block">
      <h2>标题</h2>
      <div className="tf-titles" role="radiogroup" aria-label="标题">
        {s.titles.map((t, i) => <div key={i} role="radio" aria-checked={title === i} tabIndex={title === i ? 0 : -1} className={`tf-title${title === i ? " is-on" : ""}`} onClick={() => setTitle(i)} onKeyDown={radioKeys(s.titles.length, i, setTitle)}>
          <span>{t.text}</span>{t.why ? <small>{t.why}</small> : null}
        </div>)}
      </div>
    </div>
    <p className="tf-aside"><button type="button" className="text-action" disabled={Boolean(busy)} onClick={() => { setShowPrev(false); onRegenerate(); }}>{busy === "structures" ? "正在重新搭…" : "换两种结构 · 会再调用一次模型"}</button></p>
    <div className="tf-next">
      <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => onWrite({ structure, title, ...(showPrev ? { from: "prev" } : {}) })}>{busy === "draft" ? (hasBody ? "正在重写…" : "正在写初稿…") : hasBody ? "按这个结构重写" : "按这个结构写初稿"}</button>
      {busy === "draft" ? <Elapsed /> : hasBody ? <span className="tf-hint">会生成一版整篇对比，用不用由你定；现在的正文不会被直接改掉</span> : null}
    </div>
  </section>;
}
