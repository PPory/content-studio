// 写作现场的相关词条。
//
// ⚠️ **这一栏的价值在第二层。** 只回显「你正文里提过的词」是个回声，没人需要。
// 真正有用的是**你没提到、但连着你提到的那个**——写「金字塔原理」时把「结构化思维」
// 带出来。那是关系存在的理由。
//
// ⚠️ **它是提示，不是板块。** 上一版一条占四行（名字 + 完整定义 + 来由），
// 四条就把右栏最好的位置吃掉大半，还和下面「协作」的标题打架——两个标题上下叠着，
// 眼睛不知道该先看谁。现在**一条一行**：名字和来由并排，定义和事实点开才出来。
// 想看的时候一眼扫完，不想看的时候它几乎不存在。

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";

/** 正文停下来才查。每敲一下发一次请求既吵又没用——写到一半的句子召回不出东西。 */
const IDLE_MS = 1200;

export function RelatedEntries({ text, onOpen }) {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState("");
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
      {/* ⚠️ 标题压到最轻：它下面那块「协作」才是这一列的主角 */}
      <h2 className="rel__label">相关词条<span>{entries.length}</span></h2>
      <ul className="rel__list">
        {entries.map((entry) => {
          const expanded = openId === entry.id;
          return (
            <li key={entry.id} className="rel__row" data-open={expanded ? "" : undefined}>
              <button type="button" aria-expanded={expanded} onClick={() => setOpenId(expanded ? "" : entry.id)}>
                <b>{entry.name}</b>
                {/* 为什么它在这儿。**永远可见**——不解释自己的推荐没人看第二次。
                    直接提到的只标一个点，带出来的才写清连着谁：噪音留给真正需要解释的那一半。 */}
                {entry.via ? <em>← {entry.via}</em> : <i aria-label="正文提到" title="正文里提到了" />}
              </button>
              {expanded ? (
                <div className="rel__body">
                  <p>{entry.definition}</p>
                  {entry.facts.length ? (
                    <ul>
                      {entry.facts.map((fact) => (
                        <li key={fact.id} data-disputed={fact.status === "disputed" ? "" : undefined}>
                          {fact.statement}
                          <span>{fact.sourceTitle}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button type="button" className="rel__open" onClick={() => onOpen?.(entry.id)}>打开词条</button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
