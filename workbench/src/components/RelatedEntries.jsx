// 写作现场的相关词条。
//
// ⚠️ **这一栏的价值在第二层，不在第一层。** 只回显「你正文里提过的词」是个回声，
// 没人需要。真正有用的是**你没提到、但连着你提到的那个**——写「金字塔原理」时
// 把「结构化思维」带出来。那是关系存在的理由。
//
// ⚠️ **每一条都要说清自己为什么在这儿。** 主动浮出来的东西不解释自己，
// 用户只会觉得它在瞎猜，看两次就再也不看这一栏了。

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";

/** 正文停下来才查。写字时每敲一下就发一次请求，既吵又没用——写到一半的句子召回不出东西。 */
const IDLE_MS = 1200;

export function RelatedEntries({ text, onOpen }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    const body = String(text || "");
    if (body.trim().length < 20) { setData(null); return undefined; }
    timer.current = setTimeout(() => {
      api.knowledgeRecall(body).then(setData).catch(() => setData(null));
    }, IDLE_MS);
    return () => clearTimeout(timer.current);
  }, [text]);

  const entries = data?.entries || [];
  if (!entries.length) return null;

  return (
    <section className="rel" aria-label="相关词条">
      <h2 className="section-label">相关词条</h2>
      {entries.map((entry) => {
        const expanded = open.has(entry.id);
        return (
          <article key={entry.id} className="rel__item">
            <button
              type="button"
              className="rel__head"
              aria-expanded={expanded}
              onClick={() => setOpen((current) => {
                const next = new Set(current);
                if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
                return next;
              })}
            >
              <b>{entry.name}</b>
              {/* 为什么它在这儿。直接提到的不啰嗦，带出来的要说清连着谁 */}
              <em>{entry.via ? `连着「${entry.via}」` : "正文提到"}</em>
            </button>
            <p className="rel__def">{entry.definition}</p>
            {expanded ? (
              <ul className="rel__facts">
                {entry.facts.map((fact) => (
                  <li key={fact.id} data-disputed={fact.status === "disputed" ? "" : undefined}>
                    {fact.statement}
                    <span>{fact.sourceTitle}</span>
                  </li>
                ))}
                <li className="rel__more">
                  <button type="button" onClick={() => onOpen?.(entry.id)}>打开词条</button>
                </li>
              </ul>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
