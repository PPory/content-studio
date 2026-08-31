// 写作现场的相关词条。
//
// ⚠️ **这一栏的价值在第二层。** 只回显「你正文里提过的词」是个回声，没人需要。
// 真正有用的是**你没提到、但连着你提到的那个**——写「金字塔原理」时把「结构化思维」
// 带出来。那是关系存在的理由。
//
// ⚠️ **它绝不能挤占 AI 助手。** 前两版都在往这个坑里走：第一版一条四行，
// 第二版一条一行——但只要它在流里占位置，助手就会被往下推。右栏是助手的地盘，
// 这一栏是**旁边的提示**，两者不是并列关系。
//
// 所以：**收起时只有一行**（`相关词条 3`），展开是**浮在助手上面的一层**，
// 不参与布局、不改变助手一个像素。没命中时整块不画。

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { IconChevronDown } from "./icons.jsx";

/** 正文停下来才查。每敲一下发一次请求既吵又没用——写到一半的句子召回不出东西。 */
const IDLE_MS = 1200;

export function RelatedEntries({ text, onOpen }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [factsFor, setFactsFor] = useState("");
  const timer = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    const body = String(text || "");
    if (body.trim().length < 20) { setData(null); return undefined; }
    timer.current = setTimeout(() => {
      api.knowledgeRecall(body).then(setData).catch(() => setData(null));
    }, IDLE_MS);
    return () => clearTimeout(timer.current);
  }, [text]);

  // 点别处收起。浮层盖在助手上，不收起就挡着人打字。
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (!boxRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const entries = data?.entries || [];
  if (!entries.length) return null;
  // 「你没提到但连着的」有几个——这一栏的价值全在这个数上，所以它写在收起态那一行里
  const linked = entries.filter((entry) => entry.via).length;

  return (
    <div className="rel" ref={boxRef}>
      <button type="button" className="rel__bar" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>相关词条</span>
        <b>{entries.length}</b>
        {linked ? <em>含 {linked} 个由关系带出</em> : null}
        <IconChevronDown aria-hidden="true" stroke={1.8} data-open={open ? "" : undefined} />
      </button>

      {open ? (
        <div className="rel__pop" role="group" aria-label="相关词条">
          {entries.map((entry) => {
            const expanded = factsFor === entry.id;
            return (
              <article key={entry.id} className="rel__item" data-open={expanded ? "" : undefined}>
                <button type="button" className="rel__head" aria-expanded={expanded} onClick={() => setFactsFor(expanded ? "" : entry.id)}>
                  <b>{entry.name}</b>
                  {/* 为什么它在这儿。**永远可见**——不解释自己的推荐没人看第二次。 */}
                  {entry.via ? <em>← {entry.via}</em> : <i aria-label="正文提到" title="正文里提到了" />}
                </button>
                <p className="rel__def">{entry.definition}</p>
                {expanded ? (
                  <div className="rel__facts">
                    {entry.facts.map((fact) => (
                      <p key={fact.id} data-disputed={fact.status === "disputed" ? "" : undefined}>
                        {fact.statement}<span>{fact.sourceTitle}</span>
                      </p>
                    ))}
                    <button type="button" className="rel__open" onClick={() => onOpen?.(entry.id)}>打开词条</button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
