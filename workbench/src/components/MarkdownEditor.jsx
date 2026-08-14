/**
 * Markdown 编辑器：**所见即源码，但源码长得像文档**。
 *
 * 为什么不是所见即所得：编辑器的值**永远是那串 Markdown 本身**，保存时一个字节都不会被
 * 重新序列化。真 WYSIWYG 每次保存都要把整份文档按自己的方言重写一遍——`*斜体*` 变 `_斜体_`、
 * 列表重排都是小事，真正会坏的是 `[[双链]]`、脚注、`> [!note]` 这类 **Obsidian 专有语法**
 * （不在通用 Markdown 规范里，通用编辑器会转义或直接丢掉）。而这些 md 的另一个编辑器
 * 就是 Obsidian，vault 里现在有 40 个文件在用双链。
 *
 * 所以走 CodeMirror 6：标题真的大、加粗真的粗、`#` 和 `**` 淡成浅灰不抢眼，
 * 但你存回去的就是你看到的那些字节。
 *
 * 用 CodeMirror **不等于**引 UI 库——它是个纯文本编辑器内核，不带组件、不带主题皮肤、
 * 不接管布局。这里也只装了用到的六个包，没装 `codemirror` 那个全家桶（搜索、自动补全、
 * lint 一样都不需要）。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { renderMarkdown } from "../lib/markdown.js";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconQuote,
  IconList,
  IconListNumbers,
  IconLink,
  IconSeparator,
  IconEye,
  IconPencil,
  IconHeading,
} from "./icons.jsx";
import { Select } from "./ui.jsx";

/**
 * 语法着色。**只用语义 token，不写死颜色**——不然暗色模式下这一块会是整屏唯一不认主题的东西。
 *
 * 关键的一条：`t.processingInstruction`（就是 `#`、`**`、`-` 这些记号本身）压到 `--text-3`。
 * 记号和内容同色的话，一屏 Markdown 就是一堵字符墙，那正是原来那个 textarea 难看的根源。
 */
const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.42em", fontWeight: "700", lineHeight: "1.35" },
  { tag: t.heading2, fontSize: "1.22em", fontWeight: "700", lineHeight: "1.35" },
  { tag: t.heading3, fontSize: "1.06em", fontWeight: "700", lineHeight: "1.4" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  // 加粗用正文那套暖色强调，和阅读区里看到的是同一个颜色——
  // 编辑和阅读长两样的话，人得在两套记号之间做一次翻译
  { tag: t.strong, fontWeight: "700", color: "var(--emph)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--text-3)" },
  { tag: t.quote, color: "var(--text-2)", fontStyle: "italic" },
  { tag: [t.link, t.url], color: "var(--text-2)", textDecoration: "underline" },
  { tag: [t.monospace], fontFamily: "var(--font-mono)", fontSize: "0.9em", color: "var(--text-2)" },
  { tag: t.list, color: "var(--text-1)" },
  // `#`/`**`/`-`/`>` 这些记号：在，但退到背景里
  { tag: t.processingInstruction, color: "var(--text-3)", fontWeight: "400", fontSize: "0.86em" },
  { tag: t.contentSeparator, color: "var(--text-3)" },
]);

const cmTheme = EditorView.theme({
  "&": { color: "var(--text-1)", backgroundColor: "transparent", fontSize: "15px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font)",
    lineHeight: "1.9",
    // 编辑器自己滚，不把整页撑长——顶上的工具栏要一直在
    overflow: "auto",
  },
  ".cm-content": { padding: "20px 0 40vh", caretColor: "var(--text-1)" },
  // 底部留大片空白：写到最后一行时，光标不该贴在窗口最下沿
  ".cm-line": { padding: "0 2px" },
  // 不画活动行底色：这里的一「行」是整个逻辑段落（开了换行），一整段被涂上暖色底
  // 看着像「这段被高亮了」，而不是「光标在这儿」——而暖色底在这套界面里已经有主人了。
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--mark-yellow)" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "var(--mark-yellow)" },
  ".cm-cursor": { borderLeftColor: "var(--text-1)", borderLeftWidth: "2px" },
});

// ---- 工具栏的动作：**一律是「插入 Markdown 记号」，不是富文本命令** ----------
// 这样按钮做的事和你自己敲出来的完全一样，没有第二套模型要对账。

/** 把选中的文字包起来（再点一次就脱掉，同划词高亮那条「再划一次就是取消」） */
function wrap(view, mark, markEnd = mark) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  const outer = view.state.sliceDoc(Math.max(0, from - mark.length), Math.min(view.state.doc.length, to + markEnd.length));
  const already = outer === mark + sel + markEnd;
  const changes = already
    ? { from: from - mark.length, to: to + markEnd.length, insert: sel }
    : { from, to, insert: mark + sel + markEnd };
  const head = already ? from - mark.length + sel.length : from + mark.length + sel.length;
  view.dispatch({ changes, selection: { anchor: already ? from - mark.length : from + mark.length, head } });
  view.focus();
}

/** 给选中的每一行加前缀（`## `、`- `、`> `）。再点一次去掉——同一个按钮管开也管关 */
function prefixLines(view, prefix, re) {
  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from);
  const last = view.state.doc.lineAt(to);
  const lines = [];
  for (let n = first.number; n <= last.number; n++) lines.push(view.state.doc.line(n));
  const all = lines.every((l) => re.test(l.text));
  view.dispatch({
    changes: lines.map((l) => ({
      from: l.from,
      to: l.from + (l.text.match(re)?.[0].length || 0),
      insert: all ? "" : prefix,
    })),
  });
  view.focus();
}

/** 标题级别。先把已有的 `#` 全剥掉再加，不然点两次 H2 会变成 `#### ` */
function setHeading(view, level) {
  const line = view.state.doc.lineAt(view.state.selection.main.from);
  const cur = line.text.match(/^#{1,6}\s+/)?.[0] || "";
  view.dispatch({
    changes: { from: line.from, to: line.from + cur.length, insert: level ? "#".repeat(level) + " " : "" },
  });
  view.focus();
}

function insertBlock(view, text) {
  const line = view.state.doc.lineAt(view.state.selection.main.from);
  view.dispatch({ changes: { from: line.to, insert: `\n\n${text}` }, selection: { anchor: line.to + 2 + text.length } });
  view.focus();
}

const HEADINGS = ["正文", "标题 1", "标题 2", "标题 3"];

export function MarkdownEditor({ value, onChange, ariaLabel = "正文" }) {
  const host = useRef(null);
  const view = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [preview, setPreview] = useState(false);

  // 建一次就够。**value 不进依赖**——进了的话每敲一个字就重建整个编辑器，
  // 光标、撤销历史、滚动位置全丢。外部改值走下面那个 effect 的补丁式更新。
  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value ?? "",
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(mdHighlight),
          cmTheme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部把值换掉了（换了一篇文档 / 取消后重进）时同步进来。
  // 先比一次再 dispatch：不比的话，自己敲字触发的 onChange 会绕回来把光标顶到末尾。
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (value != null && value !== cur) {
      v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    }
  }, [value]);

  const html = useMemo(() => (preview ? renderMarkdown(value || "") : ""), [preview, value]);
  const cmd = (fn) => () => view.current && fn(view.current);
  const headingOf = () => {
    const v = view.current;
    if (!v) return HEADINGS[0];
    const line = v.state.doc.lineAt(v.state.selection.main.from);
    return HEADINGS[(line.text.match(/^(#{1,3})\s+/)?.[1].length ?? 0)] || HEADINGS[0];
  };

  return (
    <div className="md-editor">
      <div className="md-editor__bar" role="toolbar" aria-label="排版工具">
        <button className="icon-btn" onClick={cmd(undo)} title="撤销 Ctrl+Z" aria-label="撤销">
          <IconArrowBackUp aria-hidden="true" stroke={1.7} />
        </button>
        <button className="icon-btn" onClick={cmd(redo)} title="重做 Ctrl+Shift+Z" aria-label="重做">
          <IconArrowForwardUp aria-hidden="true" stroke={1.7} />
        </button>
        <span className="md-editor__sep" />
        <Select
          value={headingOf()}
          options={HEADINGS}
          onChange={(v) => cmd((view) => setHeading(view, HEADINGS.indexOf(v)))()}
          renderIcon={() => <IconHeading size={15} stroke={1.8} aria-hidden="true" />}
          ariaLabel="标题级别"
          title="把光标所在这一行变成标题"
        />
        <span className="md-editor__sep" />
        <button className="icon-btn" onClick={cmd((v) => wrap(v, "**"))} title="加粗 **文字**" aria-label="加粗">
          <IconBold aria-hidden="true" stroke={1.9} />
        </button>
        <button className="icon-btn" onClick={cmd((v) => wrap(v, "*"))} title="斜体 *文字*" aria-label="斜体">
          <IconItalic aria-hidden="true" stroke={1.7} />
        </button>
        <button className="icon-btn" onClick={cmd((v) => wrap(v, "~~"))} title="删除线 ~~文字~~" aria-label="删除线">
          <IconStrikethrough aria-hidden="true" stroke={1.7} />
        </button>
        <span className="md-editor__sep" />
        <button className="icon-btn" onClick={cmd((v) => prefixLines(v, "> ", /^>\s?/))} title="引用 > 文字" aria-label="引用">
          <IconQuote aria-hidden="true" stroke={1.7} />
        </button>
        <button className="icon-btn" onClick={cmd((v) => prefixLines(v, "- ", /^[-*]\s/))} title="无序列表" aria-label="无序列表">
          <IconList aria-hidden="true" stroke={1.7} />
        </button>
        <button className="icon-btn" onClick={cmd((v) => prefixLines(v, "1. ", /^\d+\.\s/))} title="有序列表" aria-label="有序列表">
          <IconListNumbers aria-hidden="true" stroke={1.7} />
        </button>
        <span className="md-editor__sep" />
        <button className="icon-btn" onClick={cmd((v) => wrap(v, "[", "](url)"))} title="链接 [文字](地址)" aria-label="链接">
          <IconLink aria-hidden="true" stroke={1.7} />
        </button>
        <button className="icon-btn" onClick={cmd((v) => insertBlock(v, "---"))} title="分隔线" aria-label="分隔线">
          <IconSeparator aria-hidden="true" stroke={1.7} />
        </button>
        {/* 预览挂最右边：它切的是整块区域，和左边那些「改一段文字」的按钮不是一类动作 */}
        <button
          className={`btn btn-sm md-editor__preview${preview ? " is-on" : ""}`}
          onClick={() => setPreview((p) => !p)}
          aria-pressed={preview}
          title={preview ? "回到编辑" : "看排版后的样子"}
        >
          {preview ? <IconPencil aria-hidden="true" stroke={1.7} /> : <IconEye aria-hidden="true" stroke={1.7} />}
          {preview ? "编辑" : "预览"}
        </button>
      </div>
      {/* 编辑器**一直挂在 DOM 里**，预览只是盖上去。卸载再挂的话，撤销历史和滚动位置会丢 */}
      <div className="md-editor__body" hidden={preview}>
        <div ref={host} className="md-editor__cm" aria-label={ariaLabel} />
      </div>
      {preview ? (
        <div className="md-editor__body md-editor__preview-body">
          <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : null}
    </div>
  );
}
