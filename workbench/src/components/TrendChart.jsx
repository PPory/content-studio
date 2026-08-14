// 多平台趋势折线图（自绘 SVG，不引图表库）。
//
// 几条硬规则，改之前先看懂：
//
// - **绝不做双轴。** 粉丝数和阅读量量级差一两个数量级，画在同一张图的两个 Y 轴上是最常见的
//   图表错误（读者无法判断两条线的相对高低）。所以调用方分成两张图，各自单轴。
// - **系列颜色按平台固定分配，不按当前有几条线循环。** 筛掉一个平台后，剩下的线不能换色，
//   否则你会以为数据变了。颜色查表走 PLATFORM_COLORS，索引来自平台的固定顺序。
// - 配色是跑校验脚本验过的（浅色/暗色各一套，色盲可分辨度 ΔE、对比度都过）。浅色下有三个
//   颜色对比度低于 3:1，**因此必须配可见标签或表格视图**——这是校验器的强制项，不是建议。
//   所以：图例常驻 + 末点直标 + 表格开关，三重冗余，identity 永远不只靠颜色。

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// 平台的固定顺序 = 固定色槽。加平台往后加，不要插队，否则历史截图的颜色对不上。
export const PLATFORM_ORDER = ["公众号", "X", "小红书", "抖音", "视频号", "YouTube"];
const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];

export function platformColor(platform, dark) {
  const i = PLATFORM_ORDER.indexOf(platform);
  const ramp = dark ? DARK : LIGHT;
  return ramp[(i < 0 ? PLATFORM_ORDER.length : i) % ramp.length];
}

function useDark() {
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

// 用真实像素宽度渲染，不靠 viewBox 缩放——缩放会把字号一起放大缩小，标签一会儿大一会儿小
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmt = (n) =>
  n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万` : n >= 1000 ? n.toLocaleString("zh-CN") : String(n);

export function TrendChart({ title, unit, rows, metric }) {
  const dark = useDark();
  const [box, width] = useWidth();
  const [hover, setHover] = useState(null);

  // 按平台分组，只保留该指标有值的点
  const byPlatform = new Map();
  for (const r of rows) {
    const v = r[metric];
    if (v == null || Number.isNaN(v)) continue;
    if (!byPlatform.has(r.platform)) byPlatform.set(r.platform, []);
    byPlatform.get(r.platform).push({ t: new Date(r.date + "T00:00:00").getTime(), v, date: r.date });
  }
  const series = [...byPlatform.entries()]
    .map(([platform, pts]) => ({ platform, pts: pts.sort((a, b) => a.t - b.t) }))
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));

  const all = series.flatMap((s) => s.pts);
  const H = 220;
  const pad = { t: 16, r: 64, b: 26, l: 48 };

  if (!all.length) {
    return (
      <figure className="chart">
        <figcaption className="chart-title">{title}</figcaption>
        <div className="empty" style={{ padding: 28 }}>还没有{title}数据</div>
      </figure>
    );
  }

  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const v0 = Math.min(...all.map((p) => p.v));
  const v1 = Math.max(...all.map((p) => p.v));
  // 折线用非零基线（粉丝数从 0 起画会把变化压成一条平线），但轴上标清真实数值
  const span = v1 - v0 || Math.max(1, v1 * 0.1);
  const yMin = Math.max(0, v0 - span * 0.15);
  const yMax = v1 + span * 0.15;

  const W = Math.max(width, 320);
  const x = (t) => pad.l + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r));
  const y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);

  const ticks = [yMin, (yMin + yMax) / 2, yMax];
  const dates = [...new Set(all.map((p) => p.date))].sort();
  const xTicks = dates.length <= 4 ? dates : [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]];

  // 直标只给前 4 条，再多就全靠图例——每条线都挂标签会糊成一片
  const labelled = series.slice(0, 4).map((s) => s.platform);

  return (
    <figure className="chart" ref={box}>
      <figcaption className="chart-title">
        {title}
        {unit ? <span className="chart-unit">{unit}</span> : null}
      </figcaption>

      {width > 0 && (
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={`${title}趋势，共 ${series.length} 个平台`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left;
            let best = null;
            for (const s of series) {
              for (const p of s.pts) {
                const d = Math.abs(x(p.t) - px);
                if (!best || d < best.d) best = { d, p, platform: s.platform };
              }
            }
            setHover(best && best.d < 60 ? best : null);
          }}
        >
          {ticks.map((v, i) => (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="axis">{fmt(Math.round(v))}</text>
            </g>
          ))}
          {xTicks.map((d) => (
            <text key={d} x={x(new Date(d + "T00:00:00").getTime())} y={H - 8} textAnchor="middle" className="axis">
              {d.slice(5)}
            </text>
          ))}

          {series.map((s) => {
            const c = platformColor(s.platform, dark);
            const d = s.pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
            const last = s.pts[s.pts.length - 1];
            return (
              <g key={s.platform}>
                {s.pts.length > 1 && <path d={d} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
                {s.pts.map((p) => (
                  // 2px 底色描边：两条线交叠处才分得清谁在上面
                  <circle key={p.date} cx={x(p.t)} cy={y(p.v)} r="4" fill={c} stroke="var(--surface)" strokeWidth="2" />
                ))}
                {labelled.includes(s.platform) && (
                  <text x={x(last.t) + 8} y={y(last.v) + 4} className="series-label">{s.platform}</text>
                )}
              </g>
            );
          })}

          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.p.t)} x2={x(hover.p.t)} y1={pad.t} y2={H - pad.b} className="crosshair" />
              <circle cx={x(hover.p.t)} cy={y(hover.p.v)} r="6" fill="none" stroke={platformColor(hover.platform, dark)} strokeWidth="2" />
            </g>
          )}
        </svg>
      )}

      {hover && (
        <div className="chart-tip">
          <span className="dot" style={{ background: platformColor(hover.platform, dark) }} />
          {hover.platform} · {hover.p.date} · <strong>{fmt(hover.p.v)}</strong>
        </div>
      )}

      {/* 图例常驻：≥2 条线时 identity 不能只靠颜色 */}
      <div className="legend">
        {series.map((s) => (
          <span key={s.platform} className="legend-item">
            <span className="dot" style={{ background: platformColor(s.platform, dark) }} />
            {s.platform}
          </span>
        ))}
      </div>
    </figure>
  );
}
