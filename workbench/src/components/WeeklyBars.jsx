// 每周发布量：堆叠柱。
//
// **为什么不是折线**（参考的那个界面用的是三条折线）：发布量是整数，量级只有 0~4。
// 折线会在 1 和 2 之间画一条斜线，等于宣称「周三发了 1.5 篇」——那个数不存在。
// 堆叠柱一眼给两个答案：这周总共几篇（柱有多高）、都发在哪（分成几段）。
//
// 图例常驻 + 柱顶直标总数 + 「看数字」表格，三重冗余：浅色下有几个平台色对比度低于 3:1，
// identity 不能只靠颜色，这是配色校验器的强制项。

import { useState } from "react";
import { platformColor } from "./TrendChart.jsx";
import { IconTable } from "./icons.jsx";

export function WeeklyBars({ weeks, platforms, dark }) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const H = 168;

  return (
    <div className="bars">
      {table ? (
        <div className="table-wrap" style={{ marginTop: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>这一周</th>
                {platforms.map((p) => (
                  <th key={p} className="num">{p}</th>
                ))}
                <th className="num">合计</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.key}>
                  <td>{w.label}</td>
                  {platforms.map((p) => (
                    <td key={p} className="num">{w.byPlatform[p] || 0}</td>
                  ))}
                  <td className="num"><strong>{w.total}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bars__plot" style={{ height: H }}>
          {weeks.map((w) => (
            <div key={w.key} className="bars__col" title={`${w.label}：${w.total} 篇`}>
              <span className="bars__value" data-zero={w.total === 0 ? "" : undefined}>{w.total}</span>
              <div className="bars__stack" style={{ height: `${(w.total / max) * (H - 46)}px` }}>
                {platforms.map((p) =>
                  w.byPlatform[p] ? (
                    <span
                      key={p}
                      className="bars__seg"
                      style={{ flex: w.byPlatform[p], background: platformColor(p, dark) }}
                      title={`${p} ${w.byPlatform[p]} 篇`}
                    />
                  ) : null
                )}
              </div>
              <span className="bars__label">{w.label}</span>
            </div>
          ))}
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
