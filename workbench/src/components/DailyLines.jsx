// 每日发布量：一条平台一条折线，每天一个实心点。
//
// ⚠️ **点是真值，线只表示节奏。** 发布量是整数、量级只有 0~2，
// 光画线的话两天之间那截斜线等于宣称「周二半夜发了 1.5 篇」——那个数不存在。
// 所以每一天都落一个点：读数看点，看趋势才看线。**别为了干净把点去掉。**
//
// ⚠️ **不复用 `WeeklyBars`**：那个还在「今日」页按月画每周发布量，柱状在那儿是对的
//（一周一根、要一眼看出总量和构成）。改它等于为了这一页去动另一页。
//
// 图例常驻 + 「看数字」表格是**强制项**不是装饰：浅色主题下有几个平台色对比度低于 3:1，
// 身份不能只靠颜色。和 `WeeklyBars` 同一条。

import { useState } from "react";
import { platformColor } from "./TrendChart.jsx";
import { IconTable } from "./icons.jsx";

export function DailyLines({ days, platforms, dark }) {
  const [table, setTable] = useState(false);
  // ⚠️ 分母取**单平台单日的最大值**，不是当天合计：线是逐平台画的，
  // 拿合计当分母的话每条线都被压扁到下半截，两个平台各发一篇会看着像都没发。
  const max = Math.max(1, ...days.flatMap((d) => platforms.map((p) => d.byPlatform[p] || 0)));

  // 横坐标取每一格的中心：第 i 格中心是 (i + 0.5) / n
  const xAt = (i) => ((i + 0.5) / days.length) * 100;
  const yAt = (v) => 100 - (v / max) * 100; // svg 里 y 向下

  return (
    <div className="lines">
      {table ? (
        <div className="table-wrap" style={{ marginTop: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>这一天</th>
                {platforms.map((p) => (
                  <th key={p} className="num">{p}</th>
                ))}
                <th className="num">合计</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.key}>
                  <td>{d.label} <span className="muted">{d.day.slice(5)}</span></td>
                  {platforms.map((p) => (
                    <td key={p} className="num">{d.byPlatform[p] || 0}</td>
                  ))}
                  <td className="num"><strong>{d.total}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // 高度由 CSS 给（`--lines-h`），不写死在 JS 里——写死的话它填不满所在那一栏，
        // 下面空出一片，看着像还没加载完。和 `WeeklyBars` 同一条教训。
        <div className="lines__plot">
          {/* ⚠️ 线和点装在同一个盒子里：`bottom: X%` 的基准是定位祖先，
              和 svg 的坐标系必须是同一个高度，否则两者对不上（见 styles.css）。 */}
          <div className="lines__area">
          <svg
            className="lines__svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={`每日发布量，${platforms.join("、")}`}
          >
            {platforms.map((p) => (
              <polyline
                key={p}
                className="lines__path"
                points={days.map((d, i) => `${xAt(i)},${yAt(d.byPlatform[p] || 0)}`).join(" ")}
                stroke={platformColor(p, dark)}
                fill="none"
                /* ⚠️ `preserveAspectRatio="none"` 把坐标系拉扁了，线宽会跟着被拉成
                   横粗竖细。`non-scaling-stroke` 让描边不参与缩放，两个方向一样粗。 */
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {/* 点用 HTML 画不用 svg：在被拉扁的坐标系里 `<circle>` 会变成椭圆 */}
          {platforms.map((p) =>
            days.map((d, i) => (
              <span
                key={`${p}-${d.key}`}
                className="lines__dot"
                data-zero={(d.byPlatform[p] || 0) === 0 ? "" : undefined}
                style={{ left: `${xAt(i)}%`, bottom: `${((d.byPlatform[p] || 0) / max) * 100}%`, background: platformColor(p, dark) }}
                title={`${d.label} ${d.day.slice(5)} · ${p} ${d.byPlatform[p] || 0} 篇`}
              />
            ))
          )}

          </div>

          <div className="lines__axis" aria-hidden="true">
            {days.map((d) => (
              <span key={d.key} className="lines__col" title={`${d.label} ${d.day.slice(5)}：${d.total} 篇`}>
                {d.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bars__foot">
        <div className="legend">
          {platforms.map((p) => (
            <span key={p} className="legend-item">
              <span className="dot" style={{ background: platformColor(p, dark) }} />
              {p}
            </span>
          ))}
        </div>
        <button className="btn btn-sm" onClick={() => setTable((v) => !v)}>
          <IconTable aria-hidden="true" stroke={1.7} />
          {table ? "看图" : "看数字"}
        </button>
      </div>
    </div>
  );
}
