// 第四步：定结构。两种结构、三个标题，都是可选的行；主按钮只有一个「按这个结构写初稿」。
// 结构只决定每一节讲什么、用哪份资料；初稿的小标题用文章自己的说法（服务端提示词里写明了）。
import { useEffect, useState } from "react";

export function StageStructure({ plan, busy, onWrite, onRegenerate }) {
  const s = plan.structures;
  const [structure, setStructure] = useState(plan.chosenStructure || 0), [title, setTitle] = useState(plan.chosenTitle || 0);
  useEffect(() => { setStructure(plan.chosenStructure || 0); setTitle(plan.chosenTitle || 0); }, [s?.generatedAt]);
  if (!s?.items?.length) return <section className="tf-stage"><p className="tf-quiet-p">还没有结构。</p></section>;
  const pick = (setter, value) => (e) => { if (e.type === "click" || e.key === " " || e.key === "Enter") { e.preventDefault?.(); setter(value); } };
  return <section className="tf-stage" aria-label="定结构">
    {plan.structuresStale ? <p className="tf-note">补过资料或换过角度，结构是按之前的情况搭的。<button type="button" className="text-action" disabled={Boolean(busy)} onClick={onRegenerate}>重新搭</button></p> : null}
    <div className="tf-options tf-options--two" role="radiogroup" aria-label="两种结构">
      {s.items.map((it, i) => <div key={i} role="radio" aria-checked={structure === i} tabIndex={structure === i ? 0 : -1} className={`tf-option${structure === i ? " is-on" : ""}`} onClick={pick(setStructure, i)} onKeyDown={pick(setStructure, i)}>
        <h3>{it.name}</h3>
        {it.fit ? <p className="tf-option__fit">{it.fit}</p> : null}
        <ol className="tf-outline">{it.outline.sections.map((sec, j) => <li key={j}><strong>{sec.heading}</strong><span>{sec.purpose}{sec.uses?.length ? ` · 用：${sec.uses.map((u) => u.label).join("、")}` : ""}</span></li>)}</ol>
      </div>)}
    </div>
    <div className="tf-block">
      <h2>标题</h2>
      <div className="tf-titles" role="radiogroup" aria-label="标题">
        {s.titles.map((t, i) => <div key={i} role="radio" aria-checked={title === i} tabIndex={title === i ? 0 : -1} className={`tf-title${title === i ? " is-on" : ""}`} onClick={pick(setTitle, i)} onKeyDown={pick(setTitle, i)}>
          <span>{t.text}</span>{t.why ? <small>{t.why}</small> : null}
        </div>)}
      </div>
    </div>
    <p className="tf-aside"><button type="button" className="text-action" disabled={Boolean(busy)} onClick={onRegenerate}>{busy === "structures" ? "正在重新搭…" : "换两种结构"}</button></p>
    <div className="tf-next">
      <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => onWrite({ structure, title })}>{busy === "draft" ? "正在写初稿…" : "按这个结构写初稿"}</button>
      {busy === "draft" ? <span className="tf-hint">整篇大约 30–60 秒</span> : null}
    </div>
  </section>;
}
