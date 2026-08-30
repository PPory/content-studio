/**
 * 编辑器内联层的三个菜单。共同的判断只有一条：
 *
 * **面板按「此刻的操作对象」组织，不按「功能类别」组织。**
 *
 * 上一版把排版按钮钉在顶栏、AI 按钮浮在选区旁。选中一段话想加粗，眼睛要飞到顶栏；
 * 想润色，眼睛落在选区旁——**同一段选中的字，两个面板，两个位置**。现在选区只有一个
 * 面板：格式 / AI 技能 / 自由指令三段并排，顶栏只留对整篇的动作。
 *
 * - `SelectionRevisionMenu`：有选区。
 * - `InlineAiPrompt`：光标在空处（空格 / `Alt+Enter`）。
 * - `BlockInsertMenu`：`/` 或行首 `+`。
 *
 * 结果一律先进 Candidate，不直接落进正文——这条是产品硬约束，不在这一层放宽。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { placeInlineAiMenu } from "../lib/inline-ai-positioning.js";
import {
  IconArrowUp,
  IconPhoto,
  IconVideo,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconBold,
  IconBulb,
  IconCode,
  IconH1,
  IconH2,
  IconH3,
  IconHighlight,
  IconItalic,
  IconLink,
  IconList,
  IconListCheck,
  IconListNumbers,
  IconPencil,
  IconPilcrow,
  IconQuote,
  IconSend,
  IconSeparator,
  IconShieldCheck,
  IconSparkles,
  IconStrikethrough,
  IconTable,
  IconWand,
  IconX,
} from "./icons.jsx";
import "./text-revision.css";

export const REVISION_ACTIONS = [
  { mode: "polish", label: "润色", icon: IconWand, hint: "保持原意，让表达更自然流畅" },
  { mode: "correct", label: "纠错", icon: IconShieldCheck, hint: "只修表述、语法、用词和标点" },
  { mode: "shorten", label: "缩写", icon: IconArrowsMinimize, hint: "压缩篇幅，保留关键信息" },
  { mode: "expand", label: "扩写", icon: IconArrowsMaximize, hint: "补足解释和过渡，不编造事实" },
];

/**
 * 「改写」不在上面那一排里。
 *
 * 它和润色、纠错不是同一类东西：那四个是**不用解释就能按**的快捷方式，而改写没有指令
 * 就没有意义。上一版把它并排放成第五颗，点下去还要再展开一个输入框——等于把「自由指令」
 * 伪装成一个预设。现在它就是面板最底下那条输入框本身。
 */
export const REVISION_LABELS = { ...Object.fromEntries(REVISION_ACTIONS.map((item) => [item.mode, item.label])), rewrite: "改写" };
export const revisionLabel = (mode) => REVISION_LABELS[mode] || "修订";

/**
 * `/` 菜单顶上的「建议」组。**光标层的预设动作只住在这里。**
 *
 * ⚠️ 行内输入条里不再挂一排「续写 / 想一想」按钮。那一排是我们自己加的，
 * 而 Notion 按下空格之后**只有一条输入框**——多出来的那排把「直接说要写什么」
 * 这条主路径挤成了三选一，还让那个框看着像个带工具栏的小面板而不是一行输入。
 * 不用打字就能起的那两件事，从 `/` 进来，和插入区块同一个入口。
 */
export const BLOCK_AI_ITEMS = [
  // `note` 只进 tooltip，不占右边那一列——那一列是留给记号的（`#`、`-`、`1.`）。
  // 三条说明并排排在标签右边时，眼睛读的是说明，反而找不到自己要的那一条。
  { id: "ai:write", label: "让 AI 写", icon: IconSparkles, note: "说明要写什么" },
  { id: "ai:paragraph", label: "续写这一段", icon: IconPencil, note: "结合上下文往下写" },
  { id: "ai:nudge", label: "想一想", icon: IconBulb, note: "给一个角度，不改正文" },
];

/** `/` 菜单的「基本区块」。统一保存为可移植 Markdown，编辑层只负责把它们变成可操作的内容块。 */
export const BLOCK_ITEMS = [
  { id: "text", label: "正文", icon: IconPilcrow, note: "普通文本", keywords: "文本 paragraph" },
  { id: "h1", label: "标题 1", icon: IconH1, hint: "#", keywords: "一级 heading" },
  { id: "h2", label: "标题 2", icon: IconH2, hint: "##", keywords: "二级 heading" },
  { id: "h3", label: "标题 3", icon: IconH3, hint: "###", keywords: "三级 heading" },
  { id: "bullet", label: "项目符号列表", icon: IconList, hint: "-", keywords: "无序 列表 bullet" },
  { id: "ordered", label: "有序列表", icon: IconListNumbers, hint: "1.", keywords: "编号 列表 number" },
  { id: "todo", label: "待办事项", icon: IconListCheck, note: "可直接勾选", keywords: "任务 清单 checkbox todo" },
  { id: "callout", label: "标注", icon: IconHighlight, note: "突出提示或结论", keywords: "提示 高亮 callout note" },
  { id: "quote", label: "引用", icon: IconQuote, hint: ">", keywords: "引语 blockquote" },
  { id: "table", label: "表格", icon: IconTable, note: "单元格直接编辑", keywords: "二维 数据 table" },
  { id: "code", label: "代码块", icon: IconCode, hint: "```", keywords: "程序 code" },
  { id: "divider", label: "分隔线", icon: IconSeparator, hint: "---", keywords: "水平线 divider" },
];

/** 媒体组。选中后弹文件选择器，文件落进本地资产库，正文里只留稳定资源引用。 */
export const MEDIA_ITEMS = [
  { id: "image", label: "图片", icon: IconPhoto, note: "png / jpg / gif / webp，也可以直接粘贴或拖进来" },
  { id: "video", label: "视频", icon: IconVideo, note: "mp4 / webm / mov" },
];

function isCompositionEvent(event) {
  return event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229;
}

function moveToolbarFocus(event, menuRef) {
  if (isCompositionEvent(event) || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const actions = [...(menuRef.current?.querySelectorAll('[data-inline-ai-action="true"]:not(:disabled)') || [])];
  if (!actions.length) return;
  const current = actions.indexOf(document.activeElement);
  const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? actions.length - 1
      : current < 0
        ? (backwards ? actions.length - 1 : 0)
        : (current + (backwards ? -1 : 1) + actions.length) % actions.length;
  event.preventDefault();
  actions[next]?.focus();
}

/**
 * `arrowFocus` 决定方向键是不是把焦点搬进菜单。
 *
 * 选区面板和输入条要（焦点本来就该在面板里）；`/` 打开的块菜单**不要**——
 * 那时候用户还在正文里打字，把焦点抢走等于打断输入。块菜单自己在捕获阶段接管方向键。
 */
function useInlineAiMenu({ anchor, menuRef, focusRef, onClose, autoFocus = true, arrowFocus = true, stretch = false, placement, gap }) {
  const [position, setPosition] = useState(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node || !anchor?.anchorRect || !anchor?.boundaryRect) return;
    const update = () => {
      const menuRect = node.getBoundingClientRect();
      setPosition(placeInlineAiMenu({
        anchorRect: anchor.anchorRect,
        boundaryRect: anchor.boundaryRect,
        menuRect: { width: menuRect.width, height: menuRect.height },
        preferredPlacement: placement || anchor.preferredPlacement,
        stretch,
        ...(gap === undefined ? {} : { gap }),
      }));
    };
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [anchor, menuRef, stretch, placement, gap]);

  /**
   * ⚠️ **必须等位置算出来再聚焦。** 面板在拿到 `position` 之前是 `visibility: hidden`，
   * 而浏览器**不会把焦点给一个 visibility: hidden 的元素**——focus() 静默失败，
   * 现象是「唤起了输入条但打字打进了正文」。这里挂在 position 上，不是挂在挂载上。
   */
  useLayoutEffect(() => {
    if (!autoFocus || !position) return undefined;
    const focus = () => focusRef.current?.focus({ preventScroll: true });
    focus();
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, focusRef, Boolean(position)]);

  useEffect(() => {
    const close = (event) => {
      if (isCompositionEvent(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current({ restoreFocus: true });
        return;
      }
      if (arrowFocus && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !menuRef.current?.contains(document.activeElement)) {
        moveToolbarFocus(event, menuRef);
      }
    };
    const closeOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) onCloseRef.current({ restoreFocus: false });
    };
    window.addEventListener("keydown", close, true);
    document.addEventListener("pointerdown", closeOutside, true);
    return () => {
      window.removeEventListener("keydown", close, true);
      document.removeEventListener("pointerdown", closeOutside, true);
    };
  }, [menuRef, arrowFocus]);

  return position;
}

/** 三个菜单共用的定位外壳。位置、Esc、点外面关闭、方向键都在这里，各自只写内容。 */
function InlineAiSurface({ anchor, menuRef, position, className, kind, label, children, onClose }) {
  return (
    <div
      ref={menuRef}
      className={`text-revision-menu ${className}`}
      data-placement={position?.placement}
      data-kind={kind}
      style={position
        ? { left: position.left, top: position.top, maxWidth: position.maxWidth, maxHeight: position.maxHeight, ...(position.width ? { width: position.width } : {}) }
        : { left: 0, top: 0, visibility: "hidden" }}
      role="dialog"
      aria-label={label}
      onKeyDown={(event) => moveToolbarFocus(event, menuRef)}
      /**
       * 面板上按下鼠标不抢正文的选区——**除了那些自己要处理这一下的原生控件**。
       *
       * ⚠️ 上一版只放行了 `input`，于是块类型那颗 `<select>` 的 `mousedown` 被
       * `preventDefault` 掉了，**浏览器根本不会展开它的下拉**——现象是那个角标点了没反应。
       * 原生控件的展开、聚焦、拖选都发生在 mousedown 上，一律放行。
       */
      onMouseDown={(event) => { if (!event.target.closest("input, select, textarea")) event.preventDefault(); }}
      data-anchor={anchor ? "true" : undefined}
      data-closable={onClose ? "true" : undefined}
    >
      {children}
    </div>
  );
}

/**
 * 光标处的 AI 输入条。空行按空格、或任意位置 `Alt+Enter` 唤起。
 *
 * **主路径是直接说要写什么**，所以输入框在第一行、自动聚焦。「续写 / 想一想」退成下面
 * 一排小字快捷键——它们是「不知道说什么时的备选」，优先级低于直接开口。
 */
export function InlineAiPrompt({ anchor, onRun, onClose }) {
  const [instruction, setInstruction] = useState("");
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  /**
   * **铺满正文列、落在这一行的正下方**（`stretch` + `below` + 4px 贴合）。
   *
   * 上一版是个跟着光标漂的 max-content 卡片，横向位置每次都不一样，而它下面那行灰字
   * 还留在原地——屏幕上同时有「一个浮着的框」和「一行说按空格的提示」，看着像两件事。
   * 现在它在视觉上**接替**了当前这一行。
   */
  const position = useInlineAiMenu({ anchor, menuRef, focusRef: inputRef, onClose, stretch: true, placement: "below", gap: 4 });

  const generate = () => {
    const value = instruction.trim();
    if (!value) return inputRef.current?.focus();
    onRun("paragraph", value);
  };

  return (
    <InlineAiSurface anchor={anchor} menuRef={menuRef} position={position} className="inline-ai-prompt" kind="cursor" label="使用 AI 编辑">
      <div className="inline-ai-prompt__field">
        <IconSparkles aria-hidden="true" stroke={1.6} />
        <input
          ref={inputRef}
          value={instruction}
          maxLength={500}
          placeholder="使用 AI 编辑"
          aria-label="让 AI 写什么"
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => { if (!isCompositionEvent(event) && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); generate(); } }}
        />
        <button type="button" data-ready={instruction.trim() ? "true" : undefined} onClick={generate} aria-label="生成正文候选" title="生成正文候选">
          <IconArrowUp aria-hidden="true" stroke={2} />
        </button>
      </div>
      {/**
        * 结果**不在这条 bar 里显示**，它进正文里的回答卡（见 `AiAnswerCard`）。
        * 一条输入框自己长出一段答案会把它从「输入」变成「面板」，
        * 而答案要停留到用户做决定为止——那是正文里一个块该干的事，不是输入框。
        */}
    </InlineAiSurface>
  );
}

/**
 * 块菜单。`/` 或行首 `+` 唤起。
 *
 * 两种过滤源：`/` 触发时用户继续在**正文里**打字（`query` 由编辑器算好传进来，
 * 只有一个文本光标）；`+` 触发时菜单自带一个输入框（没有正文可打）。
 * 这个差别只影响焦点落在哪儿，列表和键盘导航完全共用。
 */
export function BlockInsertMenu({ anchor, query = "", ownFilter = false, canWrite = false, onSelect, onQuery, onClose }) {
  const [ownQuery, setOwnQuery] = useState("");
  const [active, setActive] = useState(0);
  const menuRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const position = useInlineAiMenu({ anchor, menuRef, focusRef: inputRef, onClose, autoFocus: ownFilter, arrowFocus: ownFilter });
  const text = (ownFilter ? ownQuery : query).trim().toLowerCase();

  const groups = useMemo(() => {
    const match = (item) => !text || [item.label, item.id, item.note, item.keywords]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(text));
    return [
      // 只读文档不出现「建议」组：那一组每一条都会改正文，列出来只是等着被拒绝
      canWrite ? { id: "ai", title: "建议", items: BLOCK_AI_ITEMS.filter(match) } : null,
      { id: "block", title: "基本区块", items: BLOCK_ITEMS.filter(match) },
      canWrite ? { id: "media", title: "媒体", items: MEDIA_ITEMS.filter(match) } : null,
    ].filter((group) => group && group.items.length);
  }, [text, canWrite]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  useEffect(() => { setActive(0); }, [text]);
  // 键盘选中的那条必须自己滚进视野，否则往下走两屏之后看着就是「菜单没反应」
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, groups]);

  const choose = (item) => {
    if (!item) return;
    onSelect(item);
  };

  const navigate = (event) => {
    if (isCompositionEvent(event)) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + flat.length) % Math.max(flat.length, 1));
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(flat[active]);
      return true;
    }
    return false;
  };

  /**
   * `/` 模式：焦点还在正文里，方向键和 Enter 得在**捕获阶段**接管，
   * 否则 CodeMirror 先拿到 Enter，用户按下去是换行而不是「选中这一条」。
   */
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    if (ownFilter) return undefined;
    const onKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (navigateRef.current(event)) event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [ownFilter]);

  return (
    <InlineAiSurface anchor={anchor} menuRef={menuRef} position={position} className="block-insert-menu" kind="block" label="插入区块">
      <div className="block-insert-menu__list" ref={listRef} role="listbox" aria-label="可插入的区块">
        {groups.map((group) => (
          <div className="block-insert-menu__group" key={group.id}>
            <small>{group.title}</small>
            {group.items.map((item) => {
              const Icon = item.icon;
              const index = flat.indexOf(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-label={item.label}
                  aria-selected={index === active}
                  data-active={index === active ? "true" : undefined}
                  data-inline-ai-action="true"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item)}
                  title={item.note || undefined}
                >
                  <Icon aria-hidden="true" stroke={1.6} />
                  <span>{item.label}</span>
                  {item.hint ? <em>{item.hint}</em> : null}
                </button>
              );
            })}
          </div>
        ))}
        {!groups.length ? <p className="block-insert-menu__empty">没有匹配的区块</p> : null}
      </div>
      {/**
        * 筛选行在**底部**，和 Notion 一致。
        *
        * 它不是这个菜单的主输入口——`/` 唤起时用户是在**正文里**继续打字，
        * 这一行只是把「你正在筛什么」显示出来。放顶上会读成「先在这儿输入」，
        * 而那正好是错的。`+` 唤起时没有正文可打，它才真的接管键盘。
        */}
      <div className="block-insert-menu__foot">
        {ownFilter ? (
          <input
            ref={inputRef}
            value={ownQuery}
            maxLength={40}
            placeholder="输入以筛选…"
            aria-label="筛选区块"
            onChange={(event) => { setOwnQuery(event.target.value); onQuery?.(event.target.value); }}
            onKeyDown={navigate}
          />
        ) : (
          <span className="block-insert-menu__typed" data-empty={query ? undefined : "true"}>{query ? query : "输入以筛选…"}</span>
        )}
        <kbd>esc</kbd>
      </div>
    </InlineAiSurface>
  );
}

/**
 * 选区面板：**同一段选中的字，一个面板。**
 *
 * 三段的顺序是有理由的：格式在最上（最高频、纯本地、零等待），AI 技能在中间（一次点击
 * 就出结果），自由指令在最下（要打字，最慢）。从上到下就是从快到慢。
 */
export function SelectionRevisionMenu({ selection, format, onRun, onClose }) {
  const [instruction, setInstruction] = useState("");
  const inputRef = useRef(null);
  const firstRef = useRef(null);
  const menuRef = useRef(null);
  const position = useInlineAiMenu({ anchor: selection, menuRef, focusRef: firstRef, onClose, autoFocus: false });

  const submit = () => {
    const value = instruction.trim();
    if (!value) return inputRef.current?.focus();
    onRun("rewrite", value);
  };

  return (
    <InlineAiSurface anchor={selection} menuRef={menuRef} position={position} className="selection-menu" kind="selection" label="选中文字的格式与 AI 操作">
      {/**
        * ⚠️ **这儿没有块类型下拉。**
        *
        * 它占了整整一行，而它做的事——把这一行变成标题——`/` 菜单里已经有了，
        * 而且那儿是**按下去就变**，这儿要先展开、再找、再选，三步做一步的事。
        * 更要命的是它答非所问：面板是因为「选中了一段字」才出现的，
        * 而这颗下拉作用在**光标所在的那一行**上，选中跨三行时它改的不是你选的东西。
        */}
      <div className="text-revision-menu__actions selection-menu__format" role="toolbar" aria-label="格式">
        <button type="button" ref={firstRef} data-inline-ai-action="true" onClick={() => format?.bold()} aria-label="加粗" title="加粗 **文字**"><IconBold aria-hidden="true" stroke={1.9} /></button>
        <button type="button" data-inline-ai-action="true" onClick={() => format?.italic()} aria-label="斜体" title="斜体 *文字*"><IconItalic aria-hidden="true" stroke={1.7} /></button>
        <button type="button" data-inline-ai-action="true" onClick={() => format?.strike()} aria-label="删除线" title="删除线 ~~文字~~"><IconStrikethrough aria-hidden="true" stroke={1.7} /></button>
        <button type="button" data-inline-ai-action="true" onClick={() => format?.code()} aria-label="行内代码" title="行内代码 `文字`"><IconCode aria-hidden="true" stroke={1.7} /></button>
        <button type="button" data-inline-ai-action="true" onClick={() => format?.link()} aria-label="链接" title="链接 [文字](地址)"><IconLink aria-hidden="true" stroke={1.7} /></button>
        <span className="text-revision-menu__divider" aria-hidden="true" />
        <button type="button" data-inline-ai-action="true" onClick={() => format?.quote()} aria-label="引用" title="引用 > 文字"><IconQuote aria-hidden="true" stroke={1.7} /></button>
        <button type="button" data-inline-ai-action="true" onClick={() => format?.bullet()} aria-label="无序列表" title="无序列表"><IconList aria-hidden="true" stroke={1.7} /></button>
        <button type="button" data-inline-ai-action="true" onClick={() => format?.ordered()} aria-label="有序列表" title="有序列表"><IconListNumbers aria-hidden="true" stroke={1.7} /></button>
      </div>
      {/**
        * 技能是**竖排列表 + 一个分组标题**，不是一排横着的胶囊。
        *
        * 横排看着紧凑，但它把「技能」读成了「工具栏上的四颗按钮」；竖排 + 标题读出来的是
        * 「这里有一组可以对这段字做的事」，而且以后加第五、第六条时不用重新排版。
        */}
      <div className="selection-menu__skills" role="listbox" aria-label="AI 技能">
        <small>技能</small>
        {REVISION_ACTIONS.map((action) => (
          <button key={action.mode} type="button" role="option" aria-selected="false" data-inline-ai-action="true" onClick={() => onRun(action.mode, "")} title={action.hint}>
            {action.label}
          </button>
        ))}
      </div>
      {/* 自由指令：一条朴素的输入行，右边写着快捷键。不放实心发送键——
          那颗黑块在这个白面板里是全屏最重的东西，而它只是三条路径中的一条 */}
      <div className="selection-menu__command">
        <input
          ref={inputRef}
          value={instruction}
          maxLength={500}
          placeholder="使用 AI 编辑"
          aria-label="改写要求"
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => { if (!isCompositionEvent(event) && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
        />
        {instruction.trim()
          ? <button type="button" onClick={submit} aria-label="开始改写" title="按这条要求改写选中的文字"><IconArrowUp aria-hidden="true" stroke={2} /></button>
          : <kbd>Alt+⇧+E</kbd>}
      </div>
    </InlineAiSurface>
  );
}
