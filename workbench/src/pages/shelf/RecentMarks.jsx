// 书架右栏：跨书的「最近标注」。
//
// ⚠️ **为什么它在书架，不在书详情。**
// 标记放书详情页意味着：你得先想起「是哪本书」，才能看到自己写过什么。
// 而标记是**跨书**的——「我最近在想什么」根本不按书分。书详情那一栏仍然留着，
// 但它回答的是另一个问题（「这一本里我留下了什么」），两者不重复。
//
// 数据来自 `GET /api/vault/recent-marks`，聚合规则在 `server/lib/marks.mjs`。

import { useEffect, useState } from "react";
import { ErrorNote, Loading } from "../../components/ui.jsx";
import { IconChevronRight, IconQuote } from "../../components/icons.jsx";

export function RecentMarks({ onOpen, limit = 3 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/vault/recent-marks?limit=${limit}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.ok) setData(d);
        else setError(d);
      })
      .catch((e) => alive && setError({ error: String(e.message || e) }));
    return () => {
      alive = false;
    };
  }, [limit]);

  // 书架目录还没建：这一栏整块不画。**不画一个恒空的框**——
  // 那一屏上已经有「书架目录还没建」的引导了，再来一个空栏是同一句话说两遍。
  if (data?.shelfMissing) return null;

  return (
    <section className="recent-marks shelf-top__col">
      {/* 标题和左栏「正在阅读」共用一套，两栏才落在同一条基线上 */}
      <h3 className="shelf-top__label">
        最近标注
        <em>跨书</em>
      </h3>

      <ErrorNote error={error} what="读取标注" />

      {!data && !error ? (
        <Loading rows={3} />
      ) : data?.items?.length ? (
        <>
          {data.items.map((m) => {
            /**
             * ⚠️ **定位不到章节的条目点不动，而且要**说出来**。**
             * 那种批注（引的原文在任何一章里都找不到）没有可跳的落点。
             * 硬给一个「打开这本书」的兜底，用户点下去会莫名其妙落在第一章——
             * 「宁可不画，也不要画一个点了没落点的东西」。
             */
            const jumpable = Boolean(m.path);
            return (
              <article
                key={`${m.bookDir}::${m.id}`}
                className="recent-mark"
                data-jumpable={jumpable ? "" : undefined}
                onClick={jumpable ? () => onOpen?.(m) : undefined}
                title={jumpable ? `跳到《${m.book}》${m.chapter}` : "这条批注引的原文在章节里找不到，没有可跳的落点"}
              >
                <div className="recent-mark__q">{m.quote}</div>
                <div className="recent-mark__f">
                  <b>
                    {m.book}
                    {m.chapter ? ` · ${m.chapter}` : ""}
                  </b>
                  {/**
                    * ⚠️ **高亮没有时间就照实空着，不许编一个「刚刚」。**
                    * 高亮文件的格式里不记时间（见 `server/lib/marks.mjs`）。
                    * 这里用「只划了线」占位——它说的是**这条是什么**，不是**什么时候**，
                    * 所以不会被误读成一个时间。
                    */}
                  <time>{m.at || (m.kind === "highlight" ? "只划了线" : "")}</time>
                </div>
              </article>
            );
          })}
          {data.total > data.items.length ? (
            <div className="recent-marks__more">
              还有 {data.total - data.items.length} 条 · 点进一本书能看全这一本的
            </div>
          ) : null}
        </>
      ) : (
        /* 空态说的是**下一步**，不是「暂无数据」 */
        <div className="recent-marks__empty">
          <IconQuote size={18} stroke={1.6} aria-hidden="true" />
          <p>还没有标注</p>
          <span>读的时候划一句、或写一条批注，这儿就会有。</span>
        </div>
      )}
    </section>
  );
}
