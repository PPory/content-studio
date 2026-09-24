// 第二步：选角度。三个角度是安静的行，选中的那一行左侧一道品牌绿竖线；一屏只有一个主按钮「用这个角度」。
// 每个角度按「读者现在以为 → 这篇要讲清楚」写，并说明用哪篇知识来讲、写成它还缺什么（选角度的同时就知道写不写得成）。
import { useEffect, useState } from "react";

export const HOW = { knowledge: "讲知识", judgment: "讲判断", experience: "讲经历", demonstration: "讲展示" };

export function StageAngles({ plan, busy, onChoose, onRegenerate, onGenerate }) {
  const items = plan.angles?.items || [];
  // 旧的角度没有推荐标记：推荐要补的最少的那个。
  const recId = items.find((a) => a.recommended)?.id || [...items].sort((a, b) => a.gaps.length - b.gaps.length)[0]?.id;
  // 默认停在：已经选过的 → AI 推荐的 → 第一个。
  const initial = () => (plan.chosenAngle?.id && items.some((a) => a.id === plan.chosenAngle.id) ? plan.chosenAngle.id : recId || items[0]?.id || "");
  const [picked, setPicked] = useState(initial);
  const [own, setOwn] = useState(null);
  useEffect(() => { if (!items.some((a) => a.id === picked)) setPicked(initial()); }, [plan.angles?.generatedAt]);
  if (!items.length) return <section className="tf-stage"><p className="tf-quiet-p">还没有角度。</p><div className="tf-next"><button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={onGenerate}>{busy === "angles" ? "正在想角度…" : "想三个角度"}</button></div></section>;

  return <section className="tf-stage" aria-label="选角度">
    {plan.anglesStale ? <p className="tf-note">资料更新过了，角度是按之前的资料想的。<button type="button" className="text-action" disabled={Boolean(busy)} onClick={onRegenerate}>按新资料重新想</button></p> : null}
    <div className="tf-options" role="radiogroup" aria-label="三个角度">
      {items.map((a) => {
        const on = picked === a.id && own === null;
        return <div key={a.id} role="radio" aria-checked={on} tabIndex={on || (!picked && a === items[0]) ? 0 : -1} className={`tf-option${on ? " is-on" : ""}`}
          onClick={() => { setPicked(a.id); setOwn(null); }} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setPicked(a.id); setOwn(null); } }}>
          <span className="tf-option__kind">{HOW[a.how]}{a.id === recId ? <b className="tf-rec">推荐</b> : null}{plan.chosenAngle?.id === a.id ? " · 当前选定" : ""}</span>
          <h3>{a.title}</h3>
          {a.id === recId && a.why ? <p className="tf-why">{a.why}</p> : null}
          {a.was || a.is ? <div className="tf-shift">
            {a.was ? <p><span>读者现在以为</span>{a.was}</p> : null}
            <p><span>这篇讲清楚</span>{a.is}</p>
          </div> : null}
          {on ? <div className="tf-option__more">
            {a.audience || a.gain ? <p className="tf-meta-line">{a.audience ? <>写给 {a.audience}</> : null}{a.audience && a.gain ? "　·　" : null}{a.gain ? <>读完 {a.gain}</> : null}</p> : null}
            {a.wiki ? <blockquote className="tf-wiki">
              <span>用你的知识《{a.wiki.title}》来讲</span>
              <q>{a.wiki.quote}</q>
              {a.wiki.how ? <p>{a.wiki.how}</p> : null}
            </blockquote> : null}
          </div> : null}
          <p className={`tf-feas${a.gaps.length ? "" : " is-ready"}`}>{a.gaps.length ? <>还缺 {a.gaps.length} 项：{a.gaps.map((g) => g.label).join("、")}</> : "手上的材料够写"}</p>
        </div>;
      })}
    </div>
    {own === null
      ? <p className="tf-aside"><button type="button" className="text-action" onClick={() => setOwn("")}>都不对？自己写一句</button>　<button type="button" className="text-action" disabled={Boolean(busy)} onClick={onRegenerate}>{busy === "angles" ? "正在重新想…" : "再想三个"}</button></p>
      : <div className="tf-own"><label htmlFor="tf-own-angle">你想怎么讲</label><textarea id="tf-own-angle" rows={2} value={own} onChange={(e) => setOwn(e.target.value)} placeholder="一句话：你想讲什么、写给谁" autoFocus /><button type="button" className="text-action" onClick={() => setOwn(null)}>还是从上面选</button></div>}
    <div className="tf-next">
      <button type="button" className="btn btn-primary" disabled={Boolean(busy) || (own !== null && !own.trim())} onClick={() => onChoose(own !== null ? { own } : { angleId: picked })}>{busy === "choose" ? "正在记下…" : "用这个角度"}</button>
    </div>
  </section>;
}
