// 首屏右边那张图：**本周每天的发布量**。
//
// ⚠️ **口径从「本月每周」换成「本周每天」，图形跟着从柱状换成折线。**
// 按月的那一版横轴是六个周区间，而月初打开它有五格是 0——首屏最大的那块图形
// 大半在展示「还没到」。首页问的是「我最近产出稳不稳」，那是**这一周**的事；
// 上个月发了几篇属于复盘，那一页有。
//
// ⚠️ **复用 `DailyLines` + `dailyPublish`，不在这儿另画一张。**
// 复盘页那张周图已经是这两样拼出来的；抄一份的话，以后改配色或改「一周怎么算」
// 要改两处，而漏掉的那处不报错——只是两页上的同一张图对不上。
//
// ⚠️ **这一张是黑白的（`mono`），复盘页那张仍是彩色。** 不是配色没统一：
// 首屏收成黑白之后，彩色只剩状态 pill 和阻塞那行红——那两样才是要一眼分出来的；
// 而复盘页整页在比平台，颜色在那儿是**内容**要的。
//
// **为什么是这张图而不是粉丝趋势**：粉丝一周才动一次，放在每天要看一遍的首屏上，
// 十有八九和昨天一模一样。发布量回答的是「我最近产出稳不稳」，那是这一页真正的问题。

import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { DailyLines } from "../../components/DailyLines.jsx";
import { localDay, weekStartOf, inWeek, platformsIn, dailyPublish, fmtWeek } from "../../lib/posts.js";
import { IconArrowRight } from "../../components/icons.jsx";

export function TodayChart({ onGo }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    api.posts().then((d) => alive && setRows(d.rows || [])).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, []);

  // ⚠️ **本地日期，不用 `toISOString()`**：东八区晚上八点之后它已经是明天了，
  // 于是周日晚上打开首页看到的是下一周（全是 0）。和计划那条是同一个坑。
  const weekStart = weekStartOf(localDay(new Date()));
  const mine = rows ? inWeek(rows, weekStart) : [];
  const days = rows ? dailyPublish(mine, weekStart) : [];
  const total = mine.length;

  return (
    <section className="today-chart">
      <div className="today-chart__head">
        <div>
          <span className="today-chart__label">本周发布量<i>{fmtWeek(weekStart)}</i></span>
          <b>{rows ? total : "—"}<em>篇</em></b>
        </div>
        <button className="today-chart__go" onClick={() => onGo("metrics")}>
          去复盘
          <IconArrowRight size={14} stroke={1.8} aria-hidden="true" />
        </button>
      </div>

      {/**
        * ⚠️ **一篇都没有时不画空图。** 一张全是 0 的图既不报告什么、也不指引下一步，
        * 只是把「你这周还没发」放大成这一块最大的图形——和「一条任务都没有时不画进度环」
        * 是同一条判据：这个图形此刻有没有话要说。
        */}
      {rows && total ? (
        <DailyLines days={days} platforms={platformsIn(mine)} mono />
      ) : (
        <p className="today-chart__empty">
          {rows ? "这周还没有发布记录。发出去之后在「复盘」里录一条，这儿就会有。" : "读取中…"}
        </p>
      )}
    </section>
  );
}
