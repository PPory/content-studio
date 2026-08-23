// 共用的小件。错误一律走 <Note>，它会把服务端的 hint 一起显示出来——
// 只报告问题（「连接失败」）而不给下一步，是这个项目明确要避免的反馈方式。

import { Fragment, useEffect, useRef, useState } from "react";
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
  IconCircleMinus,
  IconCircleX,
  IconCoin,
  IconFlag,
  IconInbox,
  IconList,
  IconLoader2,
  IconShieldCheck,
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
/**
 * ⚠️ **计数挂在页标题上，不在下面再画一个写着同一个库名的小标题。**
 * 之前是「页头说一遍『选题库』，正文顶上那个框里再说一遍『TOPICS / 选题库 1 条』」——
 * 同一个名字一屏出现两次，中间只隔了一行描述。计数是**这个库此刻的事实**，
 * 它属于库名旁边，不属于另一个标题。
 */
/**
 * 一个数：**小字标题 + 大数字 + 对比 + 一行基准**。首屏那一排就是它。
 *
 * 三张参考图（Fincai / Nexus / Shopeers）的 KPI 卡都是这个结构，而它们的共同点
 * 不是「好看」，是**每个数字都带着让它有意义的那个参照**：
 * `$84,120 across 3 accounts`、`16,431 ↑15.5% · vs. 14,653 last period`。
 * 一个孤零零的数字回答不了「这算多还是少」——而那正是看一眼首屏想知道的事。
 *
 * ⚠️ **`tone` 必须由调用方给，不能按涨跌自动判断。**
 * 「粉丝 +180」是好事，「等你动手 +3」是坏事，而两者都是「涨了」。
 * 按符号自动上色的话，首屏会把一件坏事画成绿的。
 */
export function StatCard({ icon: Icon, label, value, unit, delta, deltaTone = "", note, onClick, title }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className="stat" onClick={onClick} title={title} type={onClick ? "button" : undefined}>
      <span className="stat__head">
        <span className="stat__label">{label}</span>
        {Icon ? <Icon aria-hidden="true" stroke={1.7} /> : null}
      </span>
      <span className="stat__row">
        <b className="stat__value">{value}</b>
        {unit ? <span className="stat__unit">{unit}</span> : null}
        {delta ? <em className="stat__delta" data-tone={deltaTone || undefined}>{delta}</em> : null}
      </span>
      {/* ⚠️ **基准那一行没内容也占高**，不然一排四张卡的下沿参差不齐 */}
      <span className="stat__note">{note || ""}</span>
    </Tag>
  );
}

/**
 * 主按钮 + 下拉菜单。「新建内容」「新建」这类**一个动作有几种起点**的入口用它。
 *
 * ⚠️ **它省掉的是一整屏。** 「新建内容」原来点开是创作弹层的「起点选择」那一屏，
 * 整屏只干一件事：问你三选一。下拉在**点之前**就把三条路摊开了，
 * 选完直接进对应那一屏——同一个决定，少一次全屏切换。
 *
 * ⚠️ **每条要带一句话说明。** 参考产品那种菜单（Add Contact / Add Deal）不需要，
 * 因为选项自解释；我们这三条不是——「从素材开始」和「访谈起稿」的差别
 * 恰恰在那句「先挑依据」和「边聊边梳」上。
 *
 * 键盘规矩和 `Select` 一套：上下键只是**在看**，回车才算选中；Esc 和点外面都收。
 *
 * ⚠️ **分节靠 `item.section` 起一个小标题，不做二级飞出菜单。**
 * 「空白文章」要先问发哪个平台（主稿的平台建完就改不了），飞出菜单意味着
 * 一个动作要悬停两层、还得处理鼠标斜着穿过去那套判定——**这个项目里没有先例，
 * 也不该为一个五选一开这个头**。同一层里分节，一眼看全。
 *
 * `busy` 是给「点完要等一下才跳走」的入口用的（建项目那条）：不给的话
 * 用户会以为没点上，然后再点一次——那就是两个项目。
 */
export function MenuButton({ label, icon: Icon, items, ariaLabel, align = "end", busy = false, className = "btn btn-primary" }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(-1);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (item) => {
    setOpen(false);
    item.onPick?.();
  };

  return (
    <div className="menu-btn" ref={ref} data-align={align}>
      <button
        className={className}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel || label}
        onClick={() => (setAt(-1), setOpen((v) => !v))}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown") return;
          e.preventDefault();
          setOpen(true);
          setAt(0);
        }}
      >
        {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : Icon ? <Icon aria-hidden="true" stroke={2} /> : null}
        {label}
      </button>

      {open ? (
        <div
          className="menu-btn__pop"
          role="menu"
          onKeyDown={(e) => {
            // ⚠️ 全在捕获阶段之外也够用：这一层没有嵌套弹层。
            // 但 Esc 要自己吃掉——不然会一路冒到阅读区/弹层那些监听上去
            if (e.key === "Escape") { e.stopPropagation(); setOpen(false); return; }
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => (i + 1) % items.length); }
            if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => (i - 1 + items.length) % items.length); }
            if (e.key === "Enter" && items[at]) { e.preventDefault(); pick(items[at]); }
          }}
        >
          {items.map((item, i) => {
            const RowIcon = item.icon;
            return (
              <Fragment key={item.key}>
                {item.section ? <p className="menu-btn__section">{item.section}</p> : null}
              <button
                className="menu-btn__row"
                role="menuitem"
                data-at={i === at ? "" : undefined}
                autoFocus={i === at}
                onMouseEnter={() => setAt(i)}
                onClick={() => pick(item)}
              >
                {RowIcon ? <RowIcon aria-hidden="true" stroke={1.7} /> : null}
                <span>
                  <b>{item.title}</b>
                  {item.hint ? <em>{item.hint}</em> : null}
                </span>
                {/* 右端那个 `+`：**它不区分任何东西**（四行都一样），
                    作用是给每一行一个「这会新建一个东西」的一致记号和右锚点。
                    它是装饰，所以 `aria-hidden`——读屏念的是标题和说明。 */}
                <i className="menu-btn__plus" aria-hidden="true">+</i>
              </button>
              </Fragment>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 状态 pill：**浅底 + 深字 + 那枚状态图标**。
 *
 * ⚠️ **图标不能省，它才是主编码。** 参考产品里这个位置放的是一个纯色圆点，
 * 但那套东西**不辨色就完全读不出来**。这里放的是 `stateIcon` 那枚形状
 *（虚线圈 / 扇形 / 勾 / 叉 / 盾），颜色只是让它在一屏几十行里被扫到——
 * 这是这个项目从一开始就守着的那条，换成圆点等于把它悄悄丢了。
 *
 * ⚠️ **字色走 `--tone-ink` 不是 `--tone`。** `--tone` 那七个值是给图标描边挑的，
 * `--st-doing` 在白底上只有 1.7:1，拿来当文字就是糊的。两者的分工写在 styles.css 的 token 注释里。
 */
export function StatePill({ state, size = "" }) {
  if (!state) return null;
  const Icon = stateIcon(state);
  return (
    <span className={`pill ${size}`} data-tone={stateTone(state)}>
      <Icon size={13} stroke={1.9} aria-hidden="true" />
      {state}
    </span>
  );
}

/**
 * 进度条：槽 + 墨绿填充 + 右侧百分比。
 *
 * ⚠️ **`value` 为 null 时整条不画**，不是画一条 0%。两者在界面上不是同一件事：
 * null = 这东西没有「进度」这个概念（已搁置、需处理），0% = 开了但还没动。
 * 混在一起的话，一屏上每一行底下都挂着一条空槽，「哪些动过」这个信息就没了——
 * 和书架封面那条进度是同一条规矩。
 *
 * ⚠️ **百分比数字要跟着**：一条没有数字的进度条只能读出「大概过半」，
 * 而这一版正是为了让人不用再猜。
 */
export function Meter({ value, label = "进度" }) {
  if (value == null || !Number.isFinite(value)) return null;
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <span className="meter" role="img" aria-label={`${label} ${pct}%`}>
      <span className="meter__track">
        <i style={{ width: `${pct}%` }} />
      </span>
      <b>{pct}%</b>
    </span>
  );
}

/**
 * 搜索框。⚠️ **三处调用方共用这一个**（内容工作台的工具条、书架页头、书详情），
 * 别再各写各的 `<label className="search-box">`。
 *
 * 各写一份的直接后果已经出过：**书架那处既没有 Esc 也没有清空按钮**，
 * 搜完只能把字一个个删掉——而另外两处有 Esc。同一个控件在三个页面上三种脾气，
 * 而且没有任何地方会报错。
 *
 * 两条退路都要给：**× 是看得见的那条，Esc 是快的那条**。只给 Esc 不够——
 * 一个框里有字、旁边没有任何清除的记号，人不会去猜快捷键。
 */
export function SearchBox({ value, onChange, placeholder, inputRef, ariaLabel }) {
  return (
    <label className="search-box">
      <IconSearch aria-hidden="true" stroke={1.7} />
      <input
        ref={inputRef}
        value={value}
        aria-label={ariaLabel || placeholder}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          // ⚠️ **不能冒泡上去**：阅读区和弹层都在监听 Esc，
          // 不掐掉的话「清空搜索」会顺手把整层关掉
          e.stopPropagation();
          onChange("");
          e.currentTarget.blur();
        }}
      />
      {/* 有字才画。空框上挂一颗永远点不出效果的 × 是噪音 */}
      {value ? (
        <button
          type="button"
          className="search-box__clear"
          title="清空（Esc）"
          aria-label="清空搜索"
          onClick={() => onChange("")}
        >
          <IconX size={13} stroke={2} aria-hidden="true" />
        </button>
      ) : null}
    </label>
  );
}

/**
 * 页面顶部那一条：**一句说明 + 计数 + 动作**。
 *
 * ⚠️ **标题撤了，页名只在顶栏的面包屑里出现一次。**
 * 之前每一页都从一个 38px 的大标题开始，而顶栏有了面包屑之后，那就是**同一个词
 * 一屏说两遍**——而且它拿走了首屏最大的一块地方，去说这一屏信息量最低的一件事
 *（你自己点进来的，你知道这是哪儿）。
 *
 * ⚠️ **`eyebrow` 一起撤了。** 它和 `desc` 是同一件事的两个详略
 *（「准备要写的东西」/「改成『撰写中』就开始成稿——先选一个主平台」）；
 * 没有标题夹在中间之后，两句连着念就是重复。留具体的那句。
 *
 * `title` 这个参数**故意留着**：调用方还在传，而它现在只进 `aria-label`——
 * 这一条对读屏来说仍然需要一个名字。
 */
export function PageHeader({ title, count, desc, aside }) {
  if (!desc && !count && !aside) return null;
  return (
    <header className="page-bar" aria-label={title || undefined}>
      {desc ? <p className="page-bar__desc">{desc}</p> : <span />}
      <div className="page-bar__end">
        {count ? <span className="page-bar__count">{count}</span> : null}
        {aside}
      </div>
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

/**
 * `onRetry` 可选。给的话在提示下面多一颗「重试」——**能自己再试一次的错误，
 * 不该只留一句话让人回去刷浏览器**。不给就还是原来那样，别的调用点一个字不用改。
 */
export function ErrorNote({ error, what, onRetry }) {
  if (!error) return null;
  return (
    <Note tone="danger" title={`${what}失败：${error.message}`}>
      {error.hint || "回终端看 npm run dev 的日志"}
      {onRetry ? (
        <div className="note-act">
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            重试
          </button>
        </div>
      ) : null}
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
  [/搁置|存档|归档|备用/, IconArchive],    // 收起来
  // ⚠️ **核验那三个值必须在这儿有落点。** 「待核验 / 已核验 / 不适用」以前一个都不命中，
  // 三个全落到默认的虚线圈——素材页那个核验下拉里三项**图标和颜色一模一样**，
  // 而下拉的记号本来就是用来免掉读字的。（`待核验` 命中不了任何一条是**对的**：
  // 它落到 `backlog`＝「等我动手」，语义正好，所以只补另外两条。）
  [/已核验/, IconShieldCheck],             // 核过了，能进成稿
  [/不适用|无需/, IconCircleMinus],        // 这条压根不需要核验
  [/已发布|已使用/, IconCircleDot],        // 已经出去了（终态）
  [/待发布|已成稿|已选题|已整理|可用|完成/, IconCircleCheck], // 我做完了，等下一步
  [/中$|进行/, IconProgress],              // 正在跑
  // 剩下的都是「等我动手」（待写 / 待修改 / 待初筛 / 待选题 / 待处理 / 已收纳 / 需核验）
  // → 空的虚线圈。⚠️ **素材那六个环节里有三个是故意落在这儿的**：
  // 「待处理」「已收纳」「需核验」说的都是「轮到你了」，而另外三个各有终点——
  // 「可用素材」＝我做完了等下一步、「已使用」＝已经出去了、「已归档」＝收起来了。
  // 补这三条之前，素材页一列十几行的状态记号**全是同一枚灰圈**，那一格等于没有。
];
export const stateIcon = (name) => STATE_ICONS.find(([re]) => re.test(name))?.[1] || IconCircleDashed;

/**
 * 状态的**色调**，和 `stateIcon` 一一对应、**两张表必须同序**。
 *
 * ⚠️ 这不是给状态新开一个颜色维度——形状仍然是主编码（虚线圈 / 进度 / 勾 / 叉），
 * 颜色只让它在一屏几十行里被扫到。不辨色的人读形状，一样能用。
 * 取值在 `styles.css` 的 `--st-*`，来自 Circle（即 Linear 那套）。
 *
 * ⚠️ **加一档状态要同时改这两张表。** 只改一张的表现是：图标对了颜色不对，
 * 或者反过来——而两者都不报错。回落是 `backlog`（等你动手），和 `stateIcon`
 * 回落到虚线圈是同一个默认。
 */
const STATE_TONES = [
  [/失败|需人工|异常/, "urgent"],
  [/弃用|作废/, "cancel"],
  [/搁置|存档|归档|备用/, "cancel"],
  [/已核验/, "done"],
  [/不适用|无需/, "cancel"],
  [/已发布|已使用/, "done"],
  [/待发布|已成稿|已选题|已整理|可用|完成/, "review"],
  [/中$|进行/, "doing"],
];
export const stateTone = (name) => STATE_TONES.find(([re]) => re.test(String(name || "")))?.[1] || "backlog";

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
        {renderIcon ? icon(value) : <Current size={14} stroke={1.8} aria-hidden="true" data-tone={stateTone(value)} />}
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
