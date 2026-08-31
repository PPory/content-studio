// 文档渲染 + 划词。
//
// 划词工具条挂在选区正上方（放不下就翻到下方）。它必须用 onMouseUp 而不是
// selectionchange：后者在拖选过程中每移动一个字符就触发一次，工具条会跟着鼠标乱跳。
//
// **正文必须是 memo 的**，这条是踩出来的：工具条一出现就是一次 setState，
// React 顺手把 `dangerouslySetInnerHTML` 那一坨重新写了一遍，DOM 节点全换新的，
// **浏览器的选区当场消失**——现象是「弹出菜单了，但不知道自己选中了哪几句」。
// 查的时候一直以为是 ::selection 颜色太浅，其实选区根本就不在了。
// 两道保险：html 用 useMemo 只算一次，正文块用 memo 隔离掉无关的重渲染。

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "../lib/markdown.js";
import { contextOf } from "../lib/reading.js";
import {
  IconArchive,
  IconArrowsDiagonal,
  IconBulb,
  IconWand,
  IconHighlight,
  IconLanguage,
  IconMessageCircle,
  IconPencil,
  IconScale,
} from "./icons.jsx";

/**
 * 划词工具条。**图标不带文字**，理由是这条会浮在正文上：五个中文词一排要 300 多像素，
 * 盖住的正好是你刚读的那一行；图标一排只要一半宽，而且每个都有 `title`，
 * 悬停半秒就知道是什么。
 *
 * 分三组，中间用竖线断开——**动作的性质不一样**：
 *   标记（高亮 / 批注）  留在这本书里
 *   问（解释 / 展开 / 反驳 / 翻译 / 拿去对话）  问 AI，不落盘
 *   带走（选题 / 存素材）  离开这本书，进流水线
 * 混成一排的话，「存素材」这种会写到别处的动作和「解释」这种一次性的看起来一样重。
 *
 * 「选题」归在带走组而不是问组：它产出的是**新东西**（能发的标题），最终要进流水线，
 * 和「存素材」的意图是连续的——「这段有用」→ 要么直接存，要么先展开成选题再存。
 * 而问组那几个是对着原文本身做理解，看完就过。
 */
export const ACTIONS = [
  { key: "highlight", label: "高亮", hint: "划一道黄，再点一次取消", icon: IconHighlight, group: 1 },
  { key: "annotate", label: "批注", hint: "写一段自己的想法，存进 notes.md", icon: IconPencil, group: 1 },
  { key: "解释", label: "解释", hint: "这段在说什么", icon: IconBulb, group: 2 },
  { key: "展开", label: "展开", hint: "顺着这段多讲一点", icon: IconArrowsDiagonal, group: 2 },
  { key: "反驳", label: "反驳", hint: "站在对立面挑毛病", icon: IconScale, group: 2 },
  { key: "translate", label: "翻译", hint: "翻成中文（DeepL）", icon: IconLanguage, group: 2 },
  { key: "chat", label: "去对话", hint: "带着这段去问 AI，它能检索当前本地工作区", icon: IconMessageCircle, group: 2 },
  { key: "选题", label: "选题", hint: "把这段变成能发的标题（4A 四个角度）", icon: IconWand, group: 3 },
  { key: "intake", label: "存素材", hint: "存成素材卡，进内容流水线", icon: IconArchive, group: 3 },
];

const Prose = memo(function Prose({ html, plain, innerRef }) {
  if (html === null) {
    return (
      <div className="prose plain" ref={innerRef}>
        {plain}
      </div>
    );
  }
  return <div className="prose" ref={innerRef} dangerouslySetInnerHTML={{ __html: html }} />;
});

/**
 * `baseDir` 是这份文档在 vault 里的目录。给了它，正文里的相对图片路径
 * （`![](images/00001.jpeg)`，epub 导进来就是这么写的）才能显示出来。
 *
 * 为什么正文里存相对路径而不是直接存 API 地址：vault 的另一个读者是 Obsidian，
 * Markdown 外链保持可移植，当前工作区的 asset URI 只在渲染时转换成本地读取地址。
 */
export function Reader({
  title,
  content,
  format = "markdown",
  baseDir = "",
  highlights,       // 可选：[{ text, color }]，画在正文里
  evidenceQuote = "", // 从词条跳入时，用逐字依据定位并强调所在段落
  actions = ACTIONS, // 可选：这个源支持哪些划词动作
  onSelect,
  onOutline,
  children,
}) {
  const bodyRef = useRef(null);
  const proseRef = useRef(null);
  const [bar, setBar] = useState(null); // { top, left, text }

  const clear = useCallback(() => setBar(null), []);

  const handleMouseUp = useCallback((e) => {
    // 工具条在 .reader 内部，点它时 mouseup 会冒泡到这里。不挡掉的话选区会被重算、
    // 工具条重新渲染，用户那一下 click 就落到了被换掉的节点上——按钮看着能点，实际没反应。
    if (e.target.closest?.(".sel-bar")) return;

    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 2) return clear();
    // 选区必须落在正文里，否则在右栏批注上划词也会弹工具条
    if (!bodyRef.current?.contains(sel.anchorNode)) return clear();

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const host = bodyRef.current.getBoundingClientRect();
    const above = rect.top - host.top > 52; // 上方放不下就翻到选区下方
    const BAR_W = 300; // 8 个图标 + 2 条分隔 + 内边距，估个值就够——差几像素不影响可用
    setBar({
      top: above ? rect.top - host.top - 44 : rect.bottom - host.top + 10,
      left: Math.max(0, Math.min(rect.left - host.left + rect.width / 2 - BAR_W / 2, host.width - BAR_W)),
      text,
    });
  }, [clear]);

  // 选区一没了工具条就该消失，否则会留一条悬空的按钮
  useEffect(() => {
    const onDown = (e) => {
      if (e.target.closest?.(".sel-bar")) return; // 点工具条自己不算取消
      clear();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [clear]);

  // 上下文的取法只写一处（`lib/reading.js`）。这里原来另有一份写法略不同的——
  // 少一层 `String()` 兜底，`content` 是 undefined 时直接抛。
  const context = useCallback((text) => contextOf(content, text), [content]);

  // 消毒、强调标记修复、wikilink 脱壳、相对图片改写全在 `lib/markdown.js` 里，
  // 这里只管什么时候重算。正文来自外部（epub / 抓回来的网页 / 库里 LLM 写的稿），
  // **绝不能**在这儿直接 marked.parse 之后塞进 DOM。
  const html = useMemo(
    () => (format === "markdown" ? renderMarkdown(content, { baseDir }) : null),
    [content, format, baseDir]
  );

  // 目录从**渲染后的 DOM**里取，不从 Markdown 源码里正则捞：源码里 ``` 代码块中的
  // `# 注释` 会被误认成标题，而 DOM 里它们本来就不是 heading。
  // 目录本身交给外面画（阅读区的左栏），这里只负责认出来。
  useLayoutEffect(() => {
    const root = proseRef.current;
    if (!root) return onOutline?.([]);
    const found = [...root.querySelectorAll("h1, h2, h3")].map((el, i) => {
      const id = `sec-${i}`;
      el.id = id;
      return { id, level: Number(el.tagName[1]), text: el.textContent.trim() };
    });
    onOutline?.(found.length > 1 ? found.slice(0, 16) : []);
  }, [html, content, onOutline]);

  /**
   * 把高亮画到正文上。
   *
   * **在渲染后的 DOM 上做，不在 HTML 字符串上做**：一句话在 HTML 里可能被 `<em>`、
   * 脚注 `<sup>` 之类切成好几段，字符串替换要么匹配不上、要么把标签劈坏。
   * 走文本节点则是按「看得见的文字」找，和用户划词时看到的一致。
   *
   * 依赖 [html, highlights] 重跑：正文块是 memo 的，它自己重渲染时这个 effect 也会重跑，
   * 所以标记不会因为一次无关的 setState 就消失。
   */
  useLayoutEffect(() => {
    const root = proseRef.current;
    if (!root) return;
    root.querySelectorAll("mark[data-hl]").forEach((el) => {
      el.replaceWith(document.createTextNode(el.textContent));
      });
    root.normalize();
    if (!highlights?.length) return;

    for (const h of highlights) {
      const needle = String(h.text || "").trim();
      if (needle.length < 2) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const hits = [];
      let node;
      while ((node = walker.nextNode())) {
        const i = node.nodeValue.indexOf(needle);
        if (i !== -1) hits.push([node, i]);
      }
      for (const [textNode, at] of hits) {
        const tail = textNode.splitText(at);
        tail.splitText(needle.length);
        const mark = document.createElement("mark");
        mark.dataset.hl = h.color || "yellow";
        mark.title = "再划一次同一句可以取消";
        tail.replaceWith(mark);
        mark.appendChild(tail);
      }
    }
  }, [html, content, highlights]);

  useLayoutEffect(() => {
    const root = proseRef.current;
    if (!root) return;
    root.querySelectorAll(".evidence-hit").forEach((element) => element.classList.remove("evidence-hit"));
    const needle = String(evidenceQuote || "").split(/\s*(?:\.{3,}|。{3,}|…+)\s*/)[0]?.trim();
    if (!needle || needle.length < 8) return;
    const visible = root.textContent || "";
    const at = visible.indexOf(needle);
    if (at < 0) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let node;
    while ((node = walker.nextNode())) {
      const end = offset + node.nodeValue.length;
      if (at >= offset && at < end) {
        const target = node.parentElement?.closest("p, li, blockquote, h1, h2, h3") || node.parentElement;
        target?.classList.add("evidence-hit");
        requestAnimationFrame(() => target?.scrollIntoView({ block: "center" }));
        break;
      }
      offset = end;
    }
  }, [html, content, evidenceQuote]);

  return (
    <div className="reader" ref={bodyRef} onMouseUp={handleMouseUp}>
      {title ? <h1 className="reader-title">{title}</h1> : null}
      {children}
      {content?.trim() ? (
        <Prose html={html} plain={content} innerRef={proseRef} />
      ) : (
        <p className="page-sub reader-empty">这一篇还没有正文。写好之后回来刷新就能看到。</p>
      )}

      {bar && (
        <div className="sel-bar" style={{ top: bar.top, left: bar.left }}>
          {actions.map((a, i) => (
            <Fragment key={a.key}>
              {i > 0 && actions[i - 1].group !== a.group ? <span className="sel-bar__sep" aria-hidden="true" /> : null}
              <button
                aria-label={a.label}
                onClick={() => {
                  onSelect({ action: a.key, text: bar.text, context: context(bar.text) });
                  clear();
                  // 选区留着不清：动作发出去之后，右栏会显示引用的原文，
                  // 正文里那一段还高亮着，两边能对上。
                }}
              >
                <a.icon aria-hidden="true" stroke={1.7} />
                {/* 自绘 tooltip：原生 `title` 要悬停一秒才出、样式跟不了主题，
                    而这条工具条上八个图标，看不懂就等于没有 */}
                <span className="sel-bar__tip">
                  <b>{a.label}</b>
                  {a.hint}
                </span>
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
