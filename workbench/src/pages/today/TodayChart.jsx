// 首屏右边那张图：本月每周发布量。
//
// ⚠️ **复用 `WeeklyBars` + `weeklyPublish`，不在这儿另画一张。**
// 复盘页那张图已经是这两样拼出来的；抄一份的话，以后改配色或改「一周怎么算」
// 要改两处，而漏掉的那处不报错——只是两页上的同一张图对不上。
//
// **为什么是这张图而不是粉丝趋势**：粉丝一周才动一次，放在每天要看一遍的首屏上，
// 十有八九和昨天一模一样。发布量回答的是「我最近产出稳不稳」，那是这一页真正的问题。

import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { WeeklyBars } from "../../components/WeeklyBars.jsx";
import { monthOf, platformsIn, inMonth, weeklyPublish } from "../../lib/posts.js";
import { IconArrowRight } from "../../components/icons.jsx";

export function TodayChart({ onGo }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    api.posts().then((d) => alive && setRows(d.rows || [])).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, []);

  const ym = monthOf(new Date().toISOString().slice(0, 10));
  const mine = rows ? inMonth(rows, ym) : [];
  const weeks = rows ? weeklyPublish(rows, ym) : [];
  const total = mine.length;

  return (
    <section className="today-chart">
      <div className="today-chart__head">
        <div>
          <span className="today-chart__label">本月发布量</span>
          <b>{rows ? total : "—"}<em>篇</em></b>
        </div>
        <button className="today-chart__go" onClick={() => onGo("metrics")}>
          去复盘
          <IconArrowRight size={14} stroke={1.8} aria-hidden="true" />
        </button>
      </div>

      {/**
        * ⚠️ **一篇都没有时不画空图。** 一张全是 0 的柱状图既不报告什么、也不指引下一步，
        * 只是把「你这个月还没发」放大成这一块最大的图形——和「一条任务都没有时不画进度环」
        * 是同一条判据：这个图形此刻有没有话要说。
        */}
      {rows && total ? (
        <WeeklyBars weeks={weeks} platforms={platformsIn(mine)} />
      ) : (
        <p className="today-chart__empty">
          {rows ? "这个月还没有发布记录。发出去之后在「复盘」里录一条，这儿就会有。" : "读取中…"}
        </p>
      )}
    </section>
  );
}
