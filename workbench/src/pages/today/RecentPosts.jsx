// 首屏最下面那张表：最近发了什么，带上数据。
//
// ⚠️ **为什么这儿放「已经发生的」而不是又一张待办表。**
// 这一页的上半部已经全是待办了（等你动手 5 件、先做这一件三张卡）。
// 下面再来一张「全部内容项目」，是同一件事在一屏里说第二遍。
// 参考图第三块（交易明细）放的也是**已经发生的事**——四个数字说「现在什么状态」，
// 图说「最近趋势」，表说「具体是哪几条」。这三层各答一问，才是一屏看完。
//
// 它同时把**反馈**那一环补上了：上面「本月发布 8 篇」「粉丝 +295」是汇总，
// 这儿是那几篇具体是什么、数据怎么样。

import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { fmtNum, metricLabel, recent } from "../../lib/posts.js";
import { platformColor } from "../../components/TrendChart.jsx";
import { IconArrowRight, IconExternalLink } from "../../components/icons.jsx";

export function RecentPosts({ onGo, limit = 6 }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    api.posts().then((d) => alive && setRows(d.rows || [])).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, []);

  const list = rows ? recent(rows, limit) : [];

  return (
    <section className="recent-posts">
      <div className="recent-posts__head">
        <h2 className="section-label">最近发了什么</h2>
        <button className="today-chart__go" onClick={() => onGo("metrics")}>
          全部数据
          <IconArrowRight size={14} stroke={1.8} aria-hidden="true" />
        </button>
      </div>

      {rows && !list.length ? (
        <p className="today-chart__empty">还没有发布记录。发出去之后在「复盘」里录一条，这儿就会有。</p>
      ) : (
        <div className="rtable" role="table" aria-label="最近发布的内容">
          <div className="rtable__head" role="row">
            <span role="columnheader">平台</span>
            <span role="columnheader">内容</span>
            <span role="columnheader">发布</span>
            <span role="columnheader">数据</span>
          </div>

          {list.map((r, i) => {
            /**
             * ⚠️ **「还没有数据」和「数据是 0」是两件事，不能都写成 0。**
             * 刚发出去的那条还没回流数据（`views == null`），写成「观看 0」是在报一个
             * 没发生过的事实——而它看着和一条真的没人看的内容一模一样。
             */
            const hasData = r.views != null;
            return (
              <div key={`${r.date}-${r.platform}-${i}`} className="rtable__row" role="row">
                <span className="rtable__plat" role="cell">
                  {/* 平台色和图上那根柱、复盘页那条线**同一个颜色**，一眼对得上 */}
                  <i style={{ background: platformColor(r.platform) }} aria-hidden="true" />
                  {r.platform}
                </span>

                <span className="rtable__title" role="cell">
                  <b title={r.title}>{r.title || "（无标题）"}</b>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" title="打开原文" onClick={(e) => e.stopPropagation()}>
                      <IconExternalLink size={13} stroke={1.7} aria-hidden="true" />
                    </a>
                  ) : null}
                </span>

                <span className="rtable__dim" role="cell"><time>{r.date}</time></span>

                <span className="rtable__data" role="cell">
                  {hasData ? (
                    <>
                      <b>{fmtNum(r.views)}</b>
                      <em>{metricLabel(r.platform, "views")}</em>
                      {r.likes != null ? <><b>{fmtNum(r.likes)}</b><em>{metricLabel(r.platform, "likes")}</em></> : null}
                    </>
                  ) : (
                    <span className="rtable__none">还没有数据</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
