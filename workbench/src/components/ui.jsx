// 共用的小件。错误一律走 <Note>，它会把服务端的 hint 一起显示出来——
// 只报告问题（「连接失败」）而不给下一步，是这个项目明确要避免的反馈方式。

import { useEffect, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArchive,
  IconArrowsExchange,
  IconBook2,
  IconBrandBilibili,
  IconBrandTiktok,
  IconBrandWechat,
  IconBrandX,
  IconBrandYoutube,
  IconBulb,
  IconCalendarEvent,
  IconCategory,
  IconChartBar,
  IconCheck,
  IconChevronDown,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleDot,
  IconCircleX,
  IconCoin,
  IconFlag,
  IconInbox,
  IconList,
  IconMessageQuestion,
  IconNotebook,
  IconProgress,
  IconQuote,
  IconSearch,
  IconSitemap,
  IconTag,
  IconTarget,
  IconUser,
  IconUsers,
  IconVideo,
  IconWorld,
  IconX,
} from "./icons.jsx";

// 页头：一行等宽小字（这一页属于哪一层）+ 大标题 + 右侧状态/动作。
// 三段式是这套设计的骨架，每页都长一样，所以用户不用重新找「刷新在哪」。
export function PageHeader({ eyebrow, title, desc, aside }) {
  return (
    <header className="page-header">
      <div className="page-header__main">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1 className="page-title">{title}</h1>
        {desc ? <p className="page-sub">{desc}</p> : null}
      </div>
      {aside ? <div className="page-header__aside">{aside}</div> : null}
    </header>
  );
}

export function SectionHead({ icon: Icon, eyebrow, title, count, aside }) {
  return (
    <div className="section-head">
      <div className="section-head__left">
        {Icon ? (
          <span className="section-head__icon">
            <Icon aria-hidden="true" stroke={1.7} />
          </span>
        ) : null}
        <div>
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <h2>{title}</h2>
        </div>
      </div>
      {count != null ? <span className="section-head__count">{count}</span> : aside}
    </div>
  );
}

/**
 * 一条提示。
 *
 * ⚠️ **别再给它加左边那道竖线。** 撤掉那一版是因为它是「模板感」最重的一个形状——
 * 一道彩色竖线 + 一句加粗标题，任何一个界面套上去都长一个样，而这套界面的层次
 * 本来靠的是字重、留白和实心块。现在的做法是：**一个安静的描边框 + 一枚按语气变的图标**，
 * 语气靠**形状**区分（对勾 / 感叹号 / 三角），颜色只在真出错时才上。
 *
 * `default` 故意不给图标：中性提示是这里最常见的一类，给每条都挂个图标就成了噪音。
 */
const NOTE_ICON = { danger: IconAlertTriangle, warn: IconAlertCircle, success: IconCircleCheck };

export function Note({ tone = "warn", title, children }) {
  const Icon = NOTE_ICON[tone];
  return (
    <div className={`note note-${tone}`}>
      {Icon ? <Icon aria-hidden="true" size={16} stroke={1.8} /> : null}
      <div>
        <div className="note-title">{title}</div>
        {children ? <div className="note-hint">{children}</div> : null}
      </div>
    </div>
  );
}

export function ErrorNote({ error, what }) {
  if (!error) return null;
  return (
    <Note tone="danger" title={`${what}失败：${error.message}`}>
      {error.hint || "回终端看 npm run dev 的日志"}
    </Note>
  );
}

export function Empty({ icon: Icon = IconSearch, children }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon aria-hidden="true" stroke={1.6} />
      </div>
      {children}
    </div>
  );
}

export function Loading({ rows = 3 }) {
  return (
    <div className="card grid" style={{ gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${88 - i * 17}%` }} />
      ))}
    </div>
  );
}

export function Tags({ items = [], accent = false }) {
  if (!items.length) return null;
  return (
    <>
      {items.map((t) => (
        <span key={t} className={accent ? "tag tag-accent" : "tag"}>
          {t}
        </span>
      ))}
    </>
  );
}

/**
 * 字段名 → 图标。
 *
 * 一行五六个「灰字段名 + 值」排开时，人是靠**位置**找信息的，得从头读一遍才知道
 * 哪个是平台哪个是读者。图标先于文字被认出来，第二次打开时就直接扫图标了。
 *
 * 按**关键词**匹配而不是精确等于：库那边的字段名随时可能从「适配平台」
 * 改成「发布平台」，精确匹配的话图标会悄悄消失。认不出来的一律回落到标签图标——
 * 宁可给个通用的，也不要一行里有的有图标有的没有。
 */
const FIELD_ICONS = [
  [/平台|渠道/, IconWorld],
  [/读者|受众|人群/, IconUsers],
  [/作者|署名|译者/, IconUser],
  [/优先|重要|价值/, IconFlag],
  [/类型|分类|栏目/, IconCategory],
  [/来源|出处|渠道/, IconInbox],
  [/状态|阶段/, IconTarget],
  [/章节|章数|篇数|目录/, IconList],
  [/导入|时间|日期/, IconCalendarEvent],
  [/字数|长度|成本|价格/, IconCoin],
];
export const fieldIcon = (name) => FIELD_ICONS.find(([re]) => re.test(name))?.[1] || IconTag;

/**
 * 分面下拉里**每个选项自己的**图标（平台名、素材类型）。
 *
 * 一开始整列用的是同一枚字段图标，结果七行长得一模一样——那时候图标不提供任何信息，
 * 只是在每行左边占了 15px。图标要有用，就得**逐项不同**。
 *
 * 同 `fieldIcon` / `STATE_ICONS` / `BOARD_ICONS` 那套：**关键词匹配，认不出来回落**。
 * 精确匹配在这里尤其不行——这些值来自库里的取值，随时会改字（「金句/原话」可能变成
 * 「金句·原话」，那个分隔符实测两种都出现过）。回落交给调用方传，因为「全部平台」
 * 这一行该用的是**字段**图标（它代表整个维度，不代表某个值）。
 */
const VALUE_ICONS = [
  // 平台
  [/公众号|微信/, IconBrandWechat],
  [/^X\b|twitter/i, IconBrandX],
  [/小红书|红书/, IconNotebook],
  [/视频号/, IconVideo],
  [/youtube/i, IconBrandYoutube],
  [/抖音|tiktok/i, IconBrandTiktok],
  [/知乎/, IconMessageQuestion],
  [/b\s?站|bilibili/i, IconBrandBilibili],
  // 素材类型
  [/金句|原话|引语/, IconQuote],
  [/观点|洞察|想法/, IconBulb],
  [/框架|模型|方法/, IconSitemap],
  [/反直觉|反常|意外|反面/, IconArrowsExchange],
  [/案例|故事|例子/, IconBook2],
  [/数据|事实|统计|数字/, IconChartBar],
];
export const valueIcon = (value, fallback = IconTag) =>
  VALUE_ICONS.find(([re]) => re.test(String(value || "")))?.[1] || fallback;

/**
 * 元信息的一项：**「图标 + 字段名 + 值」的三段式，不是一颗灰药丸**。
 *
 * 放在这儿是因为阅读区和书详情**必须长一样**。它们回答的是同一个问题（「这份东西
 * 是什么」），各画各的话，同一个界面里就有了两套元信息语言——书详情那版曾经是等宽
 * 大写的小药丸，而等宽包里没有中文字形，「在读」两个字直接掉进系统回退，
 * 和旁边所有字的字重、字宽都对不上。
 */
export function MetaItem({ name, value, title }) {
  const Icon = fieldIcon(name);
  if (value == null || value === "") return null;
  return (
    <span className="doc-meta__item" title={title}>
      {/* 图标和字段名是**同一样东西**（图标就是字段名的图形版），所以贴成一个单元，
          值和它之间才留空。三个等距的间隔会让一项看着像三项——那正是这一行显得挤的原因。 */}
      <span className="doc-meta__label">
        <Icon size={13} stroke={1.7} aria-hidden="true" />
        <b>{name}</b>
      </span>
      <span className="doc-meta__val">{value}</span>
    </span>
  );
}

// 相对时间：列表里「3 小时前」比一串 ISO 时间戳有用得多
export function relTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

/**
 * 自己画的下拉框。
 *
 * 原生 `<select>` 在这套界面里是**唯一一个跟着操作系统走的控件**：Windows 上是直角
 * 白底、蓝色高亮的系统菜单，字体也不跟 CSS 走。旁边所有东西都是圆角药丸 + 黑白两色，
 * 只有它一处露出「这是个网页表单」，而它偏偏还是阅读区里最常点的控件（改状态）。
 *
 * 只做一件事：选一个值。所以不引下拉库——它们的体积和 API 面都是为搜索、多选、
 * 异步加载准备的，这里一样都不需要。
 */
/**
 * 每个状态配一个图标，**靠形状区分，不靠颜色**。
 *
 * 参考的那套菜单用了橙/绿/红/灰，好看，但在这套黑白体系里加一档状态色，等于新开一个
 * 颜色维度——而颜色在这里已经有主人了（选区和高亮的标记黄，含义是「我圈中的」）。
 * 形状一样能表意，而且**不依赖辨色**：虚线圈=还没开始，半圈=进行中，勾=完成了，
 * 实心点=发出去了，叉=不要了，叹号=出事了要人管。
 *
 * 按**关键词**匹配而不是精确等于：四个库的状态名各不相同（待写/待修改/待初筛…），
 * 而且库那边随时可能改字。认不出来的回落到空心圈，不会出现有的有图标有的没有。
 */
const STATE_ICONS = [
  [/失败|需人工|异常/, IconAlertCircle],   // 出事了，等人管
  [/弃用|作废/, IconCircleX],              // 不要了
  [/搁置|存档|备用/, IconArchive],         // 收起来
  [/已发布/, IconCircleDot],               // 已经出去了（终态）
  [/待发布|已成稿|已选题|已整理|完成/, IconCircleCheck], // 我做完了，等下一步
  [/中$|进行/, IconProgress],              // 正在跑
  // 剩下的都是「等我动手」（待写 / 待修改 / 待初筛 / 待选题）→ 空的虚线圈
];
export const stateIcon = (name) => STATE_ICONS.find(([re]) => re.test(name))?.[1] || IconCircleDashed;

/**
 * `renderIcon` 让调用方换掉那枚记号。默认是状态图标，但这个下拉也用来选**平台**——
 * 平台不是状态，给它配一个「虚线圈=等我动手」纯属答非所问。数据页传的是平台的系列色圆点，
 * 和图上那条柱、那条线同一个颜色，一眼对得上。
 */
export function Select({ value, options, onChange, disabled, title, ariaLabel, renderIcon }) {
  const [open, setOpen] = useState(false);
  // 键盘走到哪一项。**和「当前值」是两回事**：上下键只是在看，回车才算选中——
  // 边走边写的话，用方向键路过「已弃用」就把这篇稿子废了。
  const [at, setAt] = useState(-1);
  const ref = useRef(null);
  const popRef = useRef(null);
  const Current = stateIcon(value);
  const icon = (o, size) => (renderIcon ? renderIcon(o) : null);

  const openAt = (i) => {
    setAt(i);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    /**
     * 菜单自己的键盘规则，**全在捕获阶段拦下**：这个下拉常常开在阅读覆盖层里，
     * 而那一层的 Esc 是「退一层」。不拦的话，收菜单的那一下会顺手把整个阅读区关掉。
     * 上下键同理——阅读区里 j/k 是翻条目，方向键要是漏出去就成了两件事一起发生。
     */
    const onKey = (e) => {
      const keys = ["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Tab"];
      if (!keys.includes(e.key)) return;
      if (e.key === "Escape" || e.key === "Tab") {
        // Tab 收起菜单但**不吞掉这一下**：焦点该照常走到下一个控件去
        if (e.key === "Escape") e.stopPropagation();
        setOpen(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Enter" || e.key === " ") {
        const picked = options[at];
        setOpen(false);
        if (picked != null && picked !== value) onChange(picked);
        return;
      }
      const n = options.length;
      if (!n) return;
      if (e.key === "Home") return setAt(0);
      if (e.key === "End") return setAt(n - 1);
      setAt((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, at, options, value, onChange]);

  // 键盘走到看不见的那几项时把它滚进来
  useEffect(() => {
    if (open) popRef.current?.querySelector('[data-at="1"]')?.scrollIntoView({ block: "nearest" });
  }, [at, open]);

  return (
    <div className="select" ref={ref}>
      <button
        type="button"
        className="select__btn"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(Math.max(0, options.indexOf(value))))}
        // 关着的时候按 ↓ / ↑ 直接展开并落在当前值上，和原生 select 一个手感
        onKeyDown={(e) => {
          if (open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
          e.preventDefault();
          openAt(Math.max(0, options.indexOf(value)));
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
      >
        {/* 按钮上用的是**同一枚记号**：按钮和菜单里那一行必须长得一样，
            不然人得在两套记号之间做一次翻译 */}
        {renderIcon ? icon(value) : <Current size={14} stroke={1.8} aria-hidden="true" />}
        {value}
        <IconChevronDown size={13} stroke={2} aria-hidden="true" />
      </button>
      {open ? (
        <div className="select__pop" ref={popRef} role="listbox" aria-label={ariaLabel}>
          {options.map((o, i) => {
            const Icon = stateIcon(o);
            return (
              <button
                key={o}
                type="button"
                role="option"
                aria-selected={o === value}
                // 键盘游标和鼠标 hover 共用一个高亮：两套的话，鼠标动一下
                // 就看不出回车会选中哪一项了
                data-at={i === at ? 1 : 0}
                onMouseEnter={() => setAt(i)}
                onClick={() => {
                  setOpen(false);
                  if (o !== value) onChange(o);
                }}
              >
                {renderIcon ? icon(o) : <Icon size={16} stroke={1.8} aria-hidden="true" />}
                <span>{o}</span>
                {o === value ? <IconCheck className="select__tick" size={14} stroke={2.4} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 一次动作之后的短反馈。**三处共用**（书架 / 内容工作台 / 热点），
 * 合并之前各写一份、连 DOM 都一样，只有换行位置不同。
 *
 * **`onUndo` 是可选的，但有它的时候必须显示出来。** 改状态那类动作给的是
 * 「已改成 X · 撤销」——只报告结果不给退路，用户下次就不敢按那个按钮了。
 * 关闭按钮一直在：toast 会自己消失，但正读到一半时它压着内容，得能手动收掉。
 */
/**
 * 回执条。
 *
 * **`detail` 是第二句，不是把第一句写长。** 删除的回执要同时说两件可恢复性相反的事
 *（库里删掉了 / Obsidian 里的归档进了废纸篓），拿分号接成一句的话是一条 60 多字、
 * 折成两行的长句，读的人得自己找断点。拆成主句 + 一行淡色副句，扫一眼就知道
 * 「做完了」在第一行、「东西去哪了」在第二行。
 *
 * ⚠️ **关闭键用 `IconX`，不要写字面的 `×`。** 这一处曾是全项目唯一的例外：
 * 那个槽是按 15px 的 svg 排的（`.icon-btn svg`），塞一个字形进去在深色底上
 * 几乎看不见，看着就是**一颗没画完的空按钮**。图标统一从 `icons.jsx` 出去。
 */
export function Toast({ text, detail, onUndo, onClose }) {
  if (!text) return null;
  return (
    <div className="toast" role="status">
      <div className="toast__body">
        <span>{text}</span>
        {detail ? <small>{detail}</small> : null}
      </div>
      {onUndo ? (
        <button className="btn btn-sm" onClick={onUndo}>撤销</button>
      ) : null}
      <button className="icon-btn" onClick={onClose} aria-label="关闭提示">
        <IconX aria-hidden="true" stroke={1.7} />
      </button>
    </div>
  );
}
