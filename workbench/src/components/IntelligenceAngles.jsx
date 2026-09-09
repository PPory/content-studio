// 「这条情报能怎么讲出去」——按需生成的表达角度，只在读完一条解读之后才有意义。
//
// ⚠️ **眉标只留两个。** 上一版是四个（可能回应的困惑 / 已有理解能补充什么 /
// 还需要验证 / 这个角度的依据），一屏光灰色标签就占四行——而一个问句不用标注
//「这是个问题」。受众和「已有理解能补充什么」合成问句底下的一句话：
// 那两句本来就是同一件事的两半（讲给谁听、我手上有什么可以讲）。
// 留下的两个是**读了内容也猜不出来的**：哪一步还没验证、这个角度是从哪几段原文来的。

import { useRef, useState } from "react";
import { api } from "../lib/api.js";

export function IntelligenceAngles({ brief, onChoose }) {
  const [open, setOpen] = useState(false);
  const [angles, setAngles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  const generate = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.intelligenceAngles(brief.id);
      // 情报在这中间被重新整理过的话，角度引用的原文可能已经不是同一批了。
      // 真实性是硬闸：宁可让用户重开一次，也不把对不上号的依据摆出来。
      if (result.version !== brief.version && brief.version) throw Error("情报已更新，请重新打开后探索");
      setAngles(result.angles);
    } catch (e) {
      setError(e.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="brief-angle-section">
      <button
        type="button"
        className="brief-angle-toggle"
        aria-expanded={open}
        aria-controls={`angles-${brief.id}`}
        onClick={() => {
          setOpen(!open);
          if (!open && angles === null && !busy) void generate();
        }}
      >
        <span>探索表达角度</span>
        <span aria-hidden="true">{open ? "−" : "＋"}</span>
      </button>
      <p className="brief-angle-hint">想把理解说给别人听时，再看看有哪些值得展开的问题。</p>

      {open ? (
        <div id={`angles-${brief.id}`}>
          {busy ? <p role="status">正在结合原文整理角度…</p> : null}
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={generate}>重试探索</button>
            </div>
          ) : null}
          {angles?.length === 0 ? <p>暂时没有自然的表达角度，可以先围绕这条情报继续讨论。</p> : null}

          {angles?.map((angle, index) => (
            <article className="brief-angle" key={index}>
              <span className="brief-meta">可探索的方向 {index + 1} · 待讨论</span>
              <h3>{angle.question}</h3>
              <p className="brief-angle__fit">
                讲给{angle.audience}；{angle.connection}
              </p>
              <dl>
                <dt>还需要验证</dt>
                <dd>{angle.gap}</dd>
              </dl>
              <details>
                <summary>这个角度的依据</summary>
                {angle.evidence.map((e, i) => (
                  <blockquote key={i}>
                    {e.quote}
                    <cite>{e.title}</cite>
                  </blockquote>
                ))}
              </details>
              <button type="button" className="btn btn-sm" onClick={() => onChoose(angle)}>带入选题</button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
