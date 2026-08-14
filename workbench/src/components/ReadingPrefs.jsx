// 阅读设置：字号 / 行宽 / 行距 / 段距 / 字体 / 字重 / 首行缩进 / 两端对齐 / 纸色。
//
// **数值是可以一格一格调的，不是三档。** 三档够快但不够准——同一个人在 27 寸屏和
// 笔记本上想要的行宽差一百多像素，而三档之间的跨度是 140px，中间那个刚好不合适。
// 现在是 −/+ 步进：默认值已经是好用的，想微调就一格一格来，右边直接显示数值。
//
// 不抄 readest 的分栏数、最大列高、页眉页脚、剩余页数——那些是**分页阅读器**的概念；
// 我们是滚动阅读 + 右侧常驻批注台，抄过来只会多出一堆调了没反应的开关。
// 取的每一项都满足一个标准：**调完屏幕上立刻看得出差别。**
//
// 存 localStorage，和阅读进度同一个理由：这是「这台机器上这个人的偏好」，不是知识。
// 落地是一组 CSS 变量挂在阅读区根节点上——不给正文组件加 props，也就不会因为改排版
// 而触发正文重渲染（那会把选区弄没，见 Reader.jsx 的注释）。

import { useEffect, useMemo, useRef, useState } from "react";
import { IconTypography } from "./icons.jsx";

const KEY = "workbench:reading-prefs:v3";

/**
 * 字体分成两组，因为它们管的**不是同一件事**：
 *
 *   **中文**——中文书里 99% 的字归它管，换一个整页观感就变。默认是黑体（系统无衬线），
 *             这也是原来的默认值，不能因为加了几个拉丁字体就把它挤掉。
 *   **拉丁**——@fontsource 里那几个包**只有拉丁字形**，中文一律落到系统字体。
 *             所以选它们只会改数字、英文和标点的样子；读中文书时差别很小，
 *             读英文书或代码多的稿子时差别很大。栈写成「拉丁face, 中文fallback, 通用族」。
 *
 * 苹方只有 macOS 有、微软雅黑只有 Windows 有，所以要**先量一下这台机器上到底有没有**
 * （见 hasFont）——摆一个点了没反应的按钮比不摆更糟。Bookerly 一律没有：
 * 那是亚马逊的专有字体，没有可分发版本。Georgia 是系统自带，不用引包。
 */
const CJK_SERIF = '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "SimSun", serif';
const CJK_SANS = '"Noto Sans SC", system-ui, sans-serif';
const FONTS = [
  /**
   * **「黑体」必须是思源黑体（Noto Sans SC），不能是 `system-ui`。**
   *
   * 这是原来的默认值——`.prose` 的 `font-family` 兜底到 `var(--font)`，而那就是
   * Noto Sans SC。上一版把「黑体」写成 `system-ui` 打头，Windows 上等于换成了
   * 微软雅黑：字重更细、字面更小、标点空隙更大，长文读起来就是不如原来的。
   * 它是自带的 @fontsource 包，不挑机器，所以也不用探测。
   */
  { id: "heiti", name: "黑体", group: "中文", stack: `"Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif` },
  { id: "pingfang", name: "苹方", group: "中文", probe: "PingFang SC", stack: `"PingFang SC", "PingFang TC", ${CJK_SANS}` },
  { id: "yahei", name: "微软雅黑", group: "中文", probe: "Microsoft YaHei", stack: `"Microsoft YaHei", ${CJK_SANS}` },
  { id: "songti", name: "宋体", group: "中文", stack: CJK_SERIF },
  // 拉丁（中文回落到系统字体）
  { id: "lexend", name: "Lexend", group: "拉丁", stack: `Lexend, ${CJK_SANS}` },
  { id: "inter", name: "Inter", group: "拉丁", stack: `Inter, ${CJK_SANS}` },
  { id: "source", name: "Source Sans", group: "拉丁", stack: `"Source Sans 3", ${CJK_SANS}` },
  { id: "literata", name: "Literata", group: "拉丁", stack: `Literata, ${CJK_SERIF}` },
  { id: "georgia", name: "Georgia", group: "拉丁", stack: `Georgia, ${CJK_SERIF}` },
];
const FONT_GROUPS = ["中文", "拉丁"];

/**
 * 这台机器上到底有没有这个字体：拿它和 monospace 各量一次同一串字，宽度完全一样
 * 就说明浏览器回落到了 monospace——它不在这台机器上。
 *
 * 不用 `document.fonts.check()`：那个查的是「字体加载完了没」，对压根不存在的系统字体
 * 一样返回 true，拿它做判断等于没判断。
 */
function hasFont(family) {
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    const probe = "汉字测量ABCgm123";
    ctx.font = "24px monospace";
    const base = ctx.measureText(probe).width;
    ctx.font = `24px "${family}", monospace`;
    return ctx.measureText(probe).width !== base;
  } catch {
    return true; // 量不出来就别拦着，最坏也就是回落到系统默认
  }
}

/**
 * 步进项。`unit` 只是显示用；`min/max` 卡在「还能读」的范围内——
 * 让人能把字号调到 8px 不叫自由，叫没做限制。
 */
const NUMBERS = {
  size: { label: "字号", min: 13, max: 24, step: 0.5, unit: "px", css: (v) => `${v}px` },
  width: { label: "行宽", min: 520, max: 1100, step: 20, unit: "px", css: (v) => `${v}px` },
  leading: { label: "行距", min: 1.4, max: 2.6, step: 0.05, unit: "", css: (v) => String(v) },
  gap: { label: "段距", min: 0.4, max: 2.4, step: 0.1, unit: "em", css: (v) => `${v}em` },
  weight: { label: "字重", min: 400, max: 600, step: 100, unit: "", css: (v) => String(v) },
};

const PAPERS = [["白", ""], ["米", "#faf6ee"], ["灰", "#f2f2f0"]];
const TOGGLES = { indent: "首行缩进", justify: "两端对齐" };

export const DEFAULT_PREFS = {
  size: 16.5, width: 760, leading: 1.95, gap: 1.25, weight: 400,
  font: "heiti", indent: 0, justify: 0, paper: 0,
};

const clamp = (v, { min, max }) => Math.min(max, Math.max(min, Number(v)));
// 步进之后可能出现 1.9500000000000002 这种浮点残渣，按步长的小数位收一下
const round = (v, step) => Number(v.toFixed(String(step).split(".")[1]?.length || 0));

export function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw) return DEFAULT_PREFS;
    const out = { ...DEFAULT_PREFS };
    for (const [k, cfg] of Object.entries(NUMBERS)) {
      if (Number.isFinite(raw[k])) out[k] = clamp(raw[k], cfg);
    }
    if (FONTS.some((f) => f.id === raw.font)) out.font = raw.font;
    out.indent = raw.indent === 1 ? 1 : 0;
    out.justify = raw.justify === 1 ? 1 : 0;
    out.paper = Number.isInteger(raw.paper) && raw.paper >= 0 && raw.paper < PAPERS.length ? raw.paper : 0;
    return out;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** 偏好 → CSS 变量。挂在阅读区根节点上，正文组件完全不用知道这件事。 */
export function prefsToStyle(p) {
  const style = {
    "--read-size": NUMBERS.size.css(p.size),
    "--read-width": NUMBERS.width.css(p.width),
    "--read-leading": NUMBERS.leading.css(p.leading),
    "--read-gap": NUMBERS.gap.css(p.gap),
    "--read-weight": NUMBERS.weight.css(p.weight),
    "--read-family": (FONTS.find((f) => f.id === p.font) || FONTS[0]).stack,
    "--read-indent": p.indent ? "2em" : "0",
    "--read-align": p.justify ? "justify" : "start",
  };
  if (PAPERS[p.paper]?.[1]) style["--read-paper"] = PAPERS[p.paper][1];
  return style;
}

export function ReadingPrefs({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  // 只量一次。canvas 测宽本身是微秒级的，但这个结果在一次会话里不会变
  const fonts = useMemo(
    () => Object.fromEntries(FONTS.filter((f) => f.probe).map((f) => [f.id, hasFont(f.probe)])),
    []
  );

  // 点外面就关。不做遮罩——这是个小面板，遮罩会让人以为后面的东西不能点了
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  function apply(next) {
    onChange(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 隐私模式下写不了，读书不该因此报错 */
    }
  }
  const set = (key, v) => apply({ ...value, [key]: v });
  const bump = (key, dir) => {
    const cfg = NUMBERS[key];
    set(key, round(clamp(value[key] + dir * cfg.step, cfg), cfg.step));
  };

  return (
    <div className="prefs" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="阅读设置" title="阅读设置">
        <IconTypography aria-hidden="true" stroke={1.7} />
      </button>
      {open ? (
        <div className="prefs__pop" role="group" aria-label="阅读设置">
          {Object.entries(NUMBERS).map(([key, cfg]) => (
            <div key={key} className="prefs__num">
              <span className="prefs__name">{cfg.label}</span>
              <span className="prefs__val">
                {value[key]}
                {cfg.unit}
              </span>
              <div className="prefs__step">
                <button onClick={() => bump(key, -1)} disabled={value[key] <= cfg.min} aria-label={`${cfg.label}减小`}>−</button>
                <button onClick={() => bump(key, 1)} disabled={value[key] >= cfg.max} aria-label={`${cfg.label}增大`}>+</button>
              </div>
            </div>
          ))}

          <div className="prefs__divider" />

          {FONT_GROUPS.map((g) => (
            <div key={g}>
              <span className="prefs__name">
                {g === "中文" ? "中文字体" : "拉丁字体"}
                {g === "拉丁" ? <em className="prefs__aside">中文不受影响</em> : null}
              </span>
              <div className="prefs__fonts">
                {FONTS.filter((f) => f.group === g).map((f) => {
                  const missing = f.probe ? !fonts[f.id] : false;
                  return (
                    <button
                      key={f.id}
                      aria-pressed={value.font === f.id}
                      disabled={missing}
                      onClick={() => set("font", f.id)}
                      style={{ fontFamily: f.stack }}
                      title={
                        missing
                          ? `这台机器上没装${f.name}（${f.probe} 是 ${f.probe.startsWith("PingFang") ? "macOS" : "Windows"} 自带的）`
                          : g === "拉丁"
                          ? `${f.name}：只管数字、英文和标点，中文回落到系统字体`
                          : f.name
                      }
                    >
                      {f.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="prefs__row">
            <span className="prefs__name">纸色</span>
            <div className="seg seg-sm">
              {PAPERS.map(([label], i) => (
                <button key={label} aria-pressed={value.paper === i} onClick={() => set("paper", i)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="prefs__divider" />

          {Object.entries(TOGGLES).map(([key, label]) => (
            <label key={key} className="prefs__switch">
              <input type="checkbox" checked={!!value[key]} onChange={(e) => set(key, e.target.checked ? 1 : 0)} />
              <span>{label}</span>
            </label>
          ))}

          <button className="prefs__reset" onClick={() => apply(DEFAULT_PREFS)}>恢复默认</button>
        </div>
      ) : null}
    </div>
  );
}
