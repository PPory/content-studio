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
import { createPortal } from "react-dom";
import { EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import { EditorView, keymap, Decoration } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { creationApi } from "../lib/creation-api.js";
import { resolveAssistantPolicy } from "../lib/assistant-policy.js";
import { citationExtension, citationField, focusCitationAt, revealCitation, setCitations } from "../lib/editor-citations.js";
import { addAiDraft, aiDraftExtension, aiDraftField, confirmAiDraft } from "../lib/editor-ai-drafts.js";
import { clearTextRevision, setTextRevisionDiff, startTextRevision, textRevisionExtension, textRevisionField } from "../lib/editor-text-revisions.js";
import { clearInlineAnswer, inlineAnswerExtension, inlineAnswerField, setInlineAnswer } from "../lib/editor-inline-answer.js";
import { diffTokens, looksLikeEdit } from "../lib/text-diff.js";
import { livePreview, mediaKind } from "../lib/editor-live-preview.js";
import { clearHeldSelection, heldSelectionExtension, heldSelectionField, setHeldSelection } from "../lib/editor-held-selection.js";
import { decodeMarkdownPath, encodeMarkdownPath } from "../lib/markdown-path.js";
import { api } from "../lib/api.js";
import { candidateReviewMode, candidateStatus, createCandidate, documentVersionOf } from "../lib/ai/result-model.js";
import { normalizeGrounding } from "../lib/ai/grounding.js";
import { inlineAiBoundary, intersectRects, rectOf } from "../lib/inline-ai-positioning.js";
import {
  IconLoader2,
  IconSparkles,
  IconX,
} from "./icons.jsx";
import { AiAnswerCard, CandidateCard, RevisionDecisionBar } from "./assistant/CandidateCard.jsx";
import { BlockInsertMenu, InlineAiPrompt, SelectionRevisionMenu, revisionLabel } from "./TextRevision.jsx";
import {
  BLOCK_MENU_EVENT,
  blockMenuQuery,
  lineAffordanceField,
  setLineAffordance,
  shouldOpenBlockMenuOnSlash,
  shouldOpenInlineAiOnSpace,
} from "../lib/editor-line-affordance.js";
import "./ai-draft-review.css";

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
    /**
     * 1.65 而不是原来的 1.9。
     *
     * 这是 Markdown **源码**，段落之间本来就隔着一个空行——1.9 的行高叠上那个空行等于
     * 双倍行距，而**光标的高度是跟着行高画的**：1.9 × 16px 的光标在一行字旁边像一根竖条。
     * 1.65 是「段内读着不挤、光标又不喧宾夺主」的那一档，和 Notion 正文一致。
     */
    lineHeight: "1.65",
    // 编辑器自己滚，不把整页撑长——顶上的工具栏要一直在
    overflow: "auto",
  },
  // 左边那 26px 是给行首 `+` 让的位置。**不能靠 margin 挪走正文**——
  // 那会把选区高亮和 `.cm-flash` 的底色一起挪出去，看着像整段错位了 2px
  ".cm-content": { padding: "20px 0 40vh 26px", caretColor: "var(--text-1)" },
  // 底部留大片空白：写到最后一行时，光标不该贴在窗口最下沿
  // `position: relative` 是行首 `+` 和空行灰字的定位父级，见 editor-line-affordance.js
  // 上下 2px 让段落之间透气，而**不抬高行高**（行高会一起抬高光标）
  ".cm-line": { padding: "2px 2px", position: "relative" },
  // 不画活动行底色：这里的一「行」是整个逻辑段落（开了换行），一整段被涂上暖色底
  // 看着像「这段被高亮了」，而不是「光标在这儿」——而暖色底在这套界面里已经有主人了。
  "::selection": { backgroundColor: "var(--mark-yellow)" },
});

function editorVisibleBoundaryOf(view) {
  return inlineAiBoundary(view.scrollDOM.getBoundingClientRect(), {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

function unionRects(rects = []) {
  if (!rects.length) return null;
  return rectOf({
    left: Math.min(...rects.map((item) => item.left)),
    top: Math.min(...rects.map((item) => item.top)),
    right: Math.max(...rects.map((item) => item.right)),
    bottom: Math.max(...rects.map((item) => item.bottom)),
  });
}

function selectionAnchorRectOf(view, from, to, boundary) {
  try {
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const visibleRects = [...range.getClientRects()]
      .map((item) => intersectRects(item, boundary))
      .filter(Boolean);
    const selectionRect = unionRects(visibleRects);
    if (selectionRect) return selectionRect;
  } catch {
    // CodeMirror can recycle an off-screen line between selection and measurement.
  }
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  if (!start || !end) return null;
  return unionRects([start, end].map((item) => intersectRects(item, boundary)).filter(Boolean));
}

function inlineAnchorOf(view, from, to) {
  const boundaryRect = editorVisibleBoundaryOf(view);
  if (!boundaryRect) return null;
  const cursorRect = from === to ? view.coordsAtPos(from) : null;
  const anchorRect = from === to
    ? intersectRects(cursorRect && { ...rectOf(cursorRect), right: Math.max(cursorRect.right, cursorRect.left + 1) }, boundaryRect)
    : selectionAnchorRectOf(view, from, to, boundaryRect);
  if (!anchorRect) return null;
  return {
    anchorRect,
    boundaryRect,
    preferredPlacement: "above",
  };
}

function revisionSelectionOf(view) {
  const { from, to } = view.state.selection.main;
  if (from === to) return null;
  const text = view.state.sliceDoc(from, to);
  if (!text.trim()) return null;
  const anchor = inlineAnchorOf(view, from, to);
  return anchor ? { from, to, text, ...anchor } : null;
}

function cursorWritingAnchorOf(view) {
  const { from, to } = view.state.selection.main;
  if (from !== to) return null;
  const anchor = inlineAnchorOf(view, from, to);
  return anchor ? { from, to, ...anchor } : null;
}

function inlineMaterialContext(materials = []) {
  return materials.slice(0, 12).map((item, index) => {
    const text = String(item.content || item.note || item.summary || "").trim().slice(0, 900);
    const source = String(item.sourceUrl || item.source || "").trim().slice(0, 300);
    return [`${index + 1}. ${item.title || "未命名素材"}`, text, source ? `来源：${source}` : ""].filter(Boolean).join("\n");
  }).join("\n\n").slice(0, 8_000);
}

function inlineWritingPrompts(context = {}, instruction = "") {
  const profile = context.profile || {};
  const writer = (profile.experts || []).find((item) => item.enabled && item.id === "writing-coach");
  const style = profile.style || (profile.styles || []).find((item) => item.enabled && item.id === profile.profile?.styleId);
  return {
    expert: [writer ? `${writer.name}\n${writer.instructions}` : "", instruction ? `本次生成要求：${instruction}` : ""].filter(Boolean).join("\n"),
    style: style ? `${style.name}\n${style.instructions}` : "",
    materials: inlineMaterialContext(context.materials || []),
  };
}
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

/**
 * 给选中的每一行加前缀（`## `、`- `、`> `）。再点一次去掉——同一个按钮管开也管关。
 *
 * ⚠️ **空行上必须显式把光标放到前缀后面。** 在行首插入时 CodeMirror 默认把光标留在
 * 插入点**之前**（那是它对「在光标处插入」最保守的映射），结果是选完「标题 2」之后
 * 屏幕上是 `|## `——光标在记号前面，接着打的字会跑到 `#` 前，整行不再是标题。
 */
function prefixLines(view, prefix, re) {
  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from);
  const last = view.state.doc.lineAt(to);
  const lines = [];
  for (let n = first.number; n <= last.number; n++) lines.push(view.state.doc.line(n));
  const all = lines.every((l) => re.test(l.text));
  const caretOnEmptyLine = from === to && first.number === last.number && !first.text.trim();
  view.dispatch({
    changes: lines.map((l) => ({
      from: l.from,
      to: l.from + (l.text.match(re)?.[0].length || 0),
      insert: all ? "" : prefix,
    })),
    ...(caretOnEmptyLine ? { selection: { anchor: first.from + (all ? 0 : prefix.length) } } : {}),
  });
  view.focus();
}

/** 标题级别。先把已有的 `#` 全剥掉再加，不然点两次 H2 会变成 `#### ` */
function setHeading(view, level) {
  const line = view.state.doc.lineAt(view.state.selection.main.from);
  const cur = line.text.match(/^#{1,6}\s+/)?.[0] || "";
  const marker = level ? "#".repeat(level) + " " : "";
  const caretOnEmptyLine = view.state.selection.main.empty && !line.text.slice(cur.length).trim();
  view.dispatch({
    changes: { from: line.from, to: line.from + cur.length, insert: marker },
    // 同上：空行上换块类型之后光标要停在能接着打字的地方
    ...(caretOnEmptyLine ? { selection: { anchor: line.from + marker.length } } : {}),
  });
  view.focus();
}

/**
 * 插入一个可以继续编辑的完整内容块。
 *
 * 空行直接占用当前位置；有正文时另起一段。末尾始终留出一个空段，避免表格、代码等
 * 原子块把光标困在文末。`caretOffset` 让标注和代码插入后直接落在真正要输入的位置。
 */
function insertStructuredBlock(view, text, { caretOffset = text.length, focusSelector = "", caretAfter = false, compactTail = false } = {}) {
  const line = view.state.doc.lineAt(view.state.selection.main.from);
  const hasText = Boolean(line.text.trim());
  const at = hasText ? line.to : line.from;
  const lead = hasText ? "\n\n" : "";
  const tail = compactTail ? "\n" : line.to < view.state.doc.length ? "\n" : "\n\n";
  const insert = `${lead}${text}${tail}`;
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + (caretAfter ? insert.length : lead.length + caretOffset) },
  });
  view.focus();
  if (focusSelector) requestAnimationFrame(() => view.dom.querySelector(focusSelector)?.focus());
}


/**
 * 正文里的相对媒体路径 → 能取的地址。
 *
 * 外链原样返回；当前工作区的 asset URI 按类型分流到本地资源端点，而资源端点
 * 仍按图片和视频分别校验类型（图片白名单里没有视频，白名单
 * 正是那个端点最后一道防线，不能为了省一条路由把视频掺进去）。
 */
/**
 * 正文里的相对路径 → 能取到文件的地址。
 *
 * ⚠️ **先解码再拼。** 正文里存的是编码过的合法 Markdown（`07%20-%20附件/…`），
 * 而 `api.imageUrl` 自己会对整条路径做一次 `encodeURIComponent`——不解开就是双重编码，
 * 服务端拿到的是字面量 `%2520`，找不到文件，图片静默变成 404。
 */
function resolveMediaUrl(src, base = "") {
  const raw = decodeMarkdownPath(src);
  if (!raw || /^(https?:)?\/\//.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
  const rel = base ? `${base}/${raw}` : raw;
  return mediaKind(raw) === "video" ? api.mediaUrl(rel) : api.imageUrl(rel);
}

/**
 * 块菜单选中一条之后落地。**每一条都走上面那几个已有的记号命令**，没有第二套模型。
 *
 * `eat` 是 `/` 和它后面那几个过滤字符的区间：先把它们删掉再执行，否则「输入 `/标题` 选
 * 标题 1」的结果是 `# /标题`。用 `+` 打开时没有这段文字，`eat` 为空。
 */
function applyBlockItem(view, id, eat) {
  if (eat && eat.from < eat.to) {
    view.dispatch({ changes: { from: eat.from, to: eat.to }, selection: { anchor: eat.from } });
  }
  const level = { text: 0, h1: 1, h2: 2, h3: 3 }[id];
  if (level !== undefined) {
    setHeading(view, level);
    return;
  }
  if (id === "bullet") return prefixLines(view, "- ", /^[-*]\s/);
  if (id === "ordered") return prefixLines(view, "1. ", /^\d+\.\s/);
  if (id === "todo") return prefixLines(view, "- [ ] ", /^[-*]\s\[[ xX]\]\s/);
  if (id === "callout") return insertStructuredBlock(view, "> [!note]\n> ", { caretOffset: 12 });
  if (id === "quote") return prefixLines(view, "> ", /^>\s?/);
  if (id === "table") {
    return insertStructuredBlock(
      view,
      "| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |",
      { focusSelector: ".cm-lp-table input", compactTail: true },
    );
  }
  if (id === "divider") return insertStructuredBlock(view, "---", { caretAfter: true });
  if (id === "code") {
    // 围栏中间空一行并把光标放进去——插完就能直接开始写，不用自己再敲一次回车
    return insertStructuredBlock(view, "```\n\n```", { caretOffset: 4 });
  }
}

function candidateTargetKind({ original = "", candidate = "", document = "", preferred }) {
  if (preferred) return preferred;
  if (original && original.length === document.length) return "whole-document";
  const text = original || candidate;
  const paragraphs = text.split(/\n\s*\n/).filter((part) => part.trim()).length;
  if (text.length >= 800 || paragraphs >= 3) return "section";
  if (text.includes("\n")) return "paragraph";
  return original ? "selection" : "insertion";
}

/**
 * 「跳到这句话」的落地：**选中 + 滚进视野 + 底色闪一下**。
 *
 * 三样缺一不可。只滚过去的话，一屏 Markdown 全是同色的字，人到了也认不出是哪句；
 * 只选中的话，选区在没有焦点的编辑器里是一块很淡的灰，从别处点过来根本注意不到；
 * 而闪光只闪一下就退掉——**它是一次「在这儿」的提示，不是一个要人去关掉的状态**。
 */
const setFlash = StateEffect.define();
const flashMark = Decoration.mark({ class: "cm-flash" });
const flashField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setFlash)) {
        return e.value ? Decoration.set([flashMark.range(e.value.from, e.value.to)]) : Decoration.none;
      }
    }
    // 文档一改就撤掉：位置会挪，而这本来就是个一次性的提示
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * 在正文里找到 `text` 并跳过去。找不到就什么都不做——**宁可没反应，也不能跳到一个错的地方**。
 *
 * ⚠️ 整段找不到时退回**首行**。告警里那段话是 Worker 在**入库时的原始正文**上切出来的，
 * 而编辑器里这份过了 `unescapeNewlines` / `stripLegacyDraftWarnings`，段落之间的字节可能
 * 已经不一样了。首行几乎总能命中，而「跳到这一段的开头」已经完成了这次点击的全部意图。
 */
function revealText(view, text) {
  const doc = view.state.doc.toString();
  const want = String(text || "").trim();
  if (!want) return false;
  let from = doc.indexOf(want);
  let len = want.length;
  if (from < 0) {
    const head = want.split(String.fromCharCode(10))[0].trim();
    if (head.length < 6) return false;
    from = doc.indexOf(head);
    len = head.length;
  }
  if (from < 0) return false;
  const to = Math.min(doc.length, from + len);
  /**
   * ⚠️ **光标收在段首，不整段选中。** 试过选中整段，撤了：`drawSelection` 那层淡紫
   * 铺满整段，把闪光盖成一块说不清是什么颜色的东西——而闪光正是这次点击唯一的
   * 「就是这儿」的信号。收成光标之后，黄色闪光自己说话，光标也已经落在要改的地方。
   */
  view.dispatch({
    selection: { anchor: from },
    effects: [setFlash.of({ from, to }), EditorView.scrollIntoView(from, { y: "center" })],
  });
  view.focus();
  return true;
}

export function MarkdownEditor({
  value, onChange, ariaLabel = "正文", insertRequest, onInsertHandled,
  citations, onCitations, onCiteClick, revealRequest,
  revealText: revealTextRequest,   // { text, nonce } —— 打开编辑器时跳到某一段（真实性告警的「去这儿改」）
  toolbarExtra,                    // 写作推动等只在部分编辑场景出现的轻量动作
  onCursorChange,                 // 当前光标是写作推动的锚点；不改变正文，只上报位置
  onSelectionChange,              // 有选区时，专家只分析这一段；无选区时回到全文
  revisionRequest, onRevisionHandled, // 右栏 AI 助手发来的选区修订；仍走同一套候选/采纳机制
  revisionScope = "", revisionTitle = "", revisionPlatform = "",
  assistantScope = "", assistantTarget = { kind: "none", editable: false }, inlineAiContext = {},
  onCandidateReviewModeChange,
  onDiscuss,                       // 回答卡的「对话」：把这一问交给右侧 AI 助手继续聊
  mediaBase = "",                  // 导入文档中相对图片/视频路径的兼容基准目录
  readOnly = false,
}) {
  const host = useRef(null);
  const view = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCiteClickRef = useRef(onCiteClick);
  onCiteClickRef.current = onCiteClick;
  const onCitationsRef = useRef(onCitations);
  onCitationsRef.current = onCitations;
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const [aiDrafts, setAiDrafts] = useState([]);
  const [selectionMenu, setSelectionMenu] = useState(null);
  const selectionMenuRef = useRef(null);
  selectionMenuRef.current = selectionMenu;
  const dismissedSelectionRef = useRef("");
  const [cursorMenu, setCursorMenu] = useState(null);
  const cursorMenuRef = useRef(null);
  cursorMenuRef.current = cursorMenu;
  // `/` 打开时带 `slashFrom`（过滤词跟着正文走）；行首 `+` 打开时带 `ownFilter`（菜单自带输入框）
  const [blockMenu, setBlockMenu] = useState(null);
  const blockMenuRef = useRef(null);
  blockMenuRef.current = blockMenu;
  /**
   * AI 回答卡：**生成新内容和回答问题的落点**，和改写用的 Candidate 是两条路。
   * 卡片开着时正文一个字都没动，落地是显式的第二步（插入 / 替换）。
   */
  const [inlineAnswer, setInlineAnswer_] = useState(null);
  const inlineAnswerRef = useRef(null);
  inlineAnswerRef.current = inlineAnswer;
  const answerAbort = useRef(null);
  const [, setAnswerHostTick] = useState(0);
  const [activeRevision, setActiveRevision] = useState(null);
  const [, setRevisionHostTick] = useState(0);
  const activeRevisionRef = useRef(null);
  const revisionAbort = useRef(null);
  const cursorNudgeAbort = useRef(null);
  const imeComposingRef = useRef(false);
  // 导入文档里可能仍有相对媒体路径；编辑器只转交兼容基准，不直接读取文件系统。
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const mediaBaseRef = useRef(mediaBase);
  mediaBaseRef.current = mediaBase;
  const revisionSaveTimer = useRef(0);
  const [revisionHistory, setRevisionHistory] = useState([]);
  const [revisionSaveError, setRevisionSaveError] = useState("");
  const revisionScopeRef = useRef(revisionScope);
  revisionScopeRef.current = revisionScope;
  const assistantScopeRef = useRef(assistantScope);
  assistantScopeRef.current = assistantScope;
  const assistantTargetRef = useRef(assistantTarget);
  assistantTargetRef.current = assistantTarget;
  const inlineAiContextRef = useRef(inlineAiContext);
  inlineAiContextRef.current = inlineAiContext;

  const setCurrentRevision = (next) => {
    activeRevisionRef.current = next;
    setActiveRevision(next);
  };

  function inlinePolicyAt(selection = null) {
    const scope = assistantScopeRef.current;
    if (!scope) return null;
    return resolveAssistantPolicy({
      scope,
      target: { ...assistantTargetRef.current, selection },
    });
  }

  function restoreEditorFocus() {
    view.current?.focus();
    requestAnimationFrame(() => view.current?.focus());
  }

  function closeCursorWriting({ restoreFocus = true } = {}) {
    cursorNudgeAbort.current?.abort();
    cursorNudgeAbort.current = null;
    setCursorMenu(null);
    if (restoreFocus) restoreEditorFocus();
  }

  function closeSelectionRevision({ restoreFocus = true } = {}) {
    const current = selectionMenuRef.current;
    if (current) dismissedSelectionRef.current = `${current.from}:${current.to}`;
    setSelectionMenu(null);
    if (restoreFocus) restoreEditorFocus();
  }

  function visibleSelectionMenu(nextSelection, activeRevision) {
    if (!nextSelection) {
      dismissedSelectionRef.current = "";
      return null;
    }
    const key = `${nextSelection.from}:${nextSelection.to}`;
    if (dismissedSelectionRef.current === key) return null;
    const policy = inlinePolicyAt(nextSelection);
    /**
     * ⚠️ **回答卡在的时候不弹这个面板。**
     * 卡片会把原来那段选区留在选中态（灰底标出「这张卡在说哪一段」），于是编辑器每来一次
     * update，这里就按「有选区」把面板又弹出来一次——现象是卡片和面板叠在一起，
     * 关掉一个另一个还在。选区还在不等于用户此刻要对选区动手。
     */
    if (inlineAnswerRef.current) return null;
    return policy?.capabilities.reviseSelection && !activeRevision ? nextSelection : null;
  }

  /**
   * 选区面板开着 → 那段字保持一个底色。
   *
   * 面板底下那条指令输入框是真的 `<input>`：点进去打字，正文失焦，
   * **原生选区高亮当场消失**——用户正要为那段字写指令，却看不到那段字了。
   * 这里挂的是文档装饰，和焦点无关。
   */
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const held = selectionMenu && selectionMenu.from < selectionMenu.to
      ? { from: selectionMenu.from, to: selectionMenu.to }
      : null;
    const current = v.state.field(heldSelectionField, false)?.active || null;
    if (!held && !current) return;
    if (held && current && held.from === current.from && held.to === current.to) return;
    v.dispatch({
      effects: held ? setHeldSelection.of(held) : clearHeldSelection.of(null),
      annotations: Transaction.addToHistory.of(false),
    });
  }, [selectionMenu?.from, selectionMenu?.to, Boolean(selectionMenu)]);

  /** 编辑器里按 Ctrl/⌘+Enter：有待审阅的候选就采纳它，没有就让默认行为过去。 */
  function adoptFromKeyboard() {
    const current = activeRevisionRef.current;
    if (!current || ["generating", "failed", "stale"].includes(current.status) || !current.text.trim()) return false;
    closeRevision("adopted");
    return true;
  }

  function discardFromKeyboard() {
    const current = activeRevisionRef.current;
    if (!current || current.status === "generating") return false;
    closeRevision("discarded");
    return true;
  }

  function closeBlockMenu({ restoreFocus = true } = {}) {
    setBlockMenu(null);
    if (restoreFocus) restoreEditorFocus();
  }

  /** 内联层此刻能不能开：预览、专注审阅和正在对比的候选都会挡住它。 */
  function inlineLayerReady(currentView) {
    return !currentView.state.field(textRevisionField).active;
  }

  function openCursorWriting(currentView) {
    if (imeComposingRef.current || currentView.composing) return false;
    const anchor = cursorWritingAnchorOf(currentView);
    const policy = inlinePolicyAt(null);
    if (!anchor || !policy?.capabilities.writeAtCursor || !inlineLayerReady(currentView)) return false;
    setSelectionMenu(null);
    setBlockMenu(null);
    setCursorMenu({ ...anchor, busy: false, error: null, result: null, mode: "" });
    return true;
  }

  /**
   * 块菜单。`slashFrom` 为数字时是 `/` 触发（过滤词跟着正文走，屏幕上只有一个插入点）；
   * 为 null 时是行首 `+` 触发（没有正文可打，菜单自带输入框）。
   */
  function openBlockMenu(currentView, slashFrom = null) {
    if (imeComposingRef.current || currentView.composing) return false;
    const anchor = cursorWritingAnchorOf(currentView);
    if (!anchor || !inlineLayerReady(currentView)) return false;
    setSelectionMenu(null);
    setCursorMenu(null);
    setBlockMenu({ ...anchor, slashFrom, query: "", canWrite: Boolean(inlinePolicyAt(null)?.capabilities.writeAtCursor) });
    return true;
  }
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
          /**
           * ⚠️ **不用 `drawSelection()`，用浏览器原生光标和原生选区。**
           *
           * `drawSelection` 画的 `.cm-cursor` 高度**等于整个行框**（行高 × 字号）；
           * 而原生 caret 的高度是**字的高度**。前者在 1.65 行高下比字高出一截，
           * 看着就是「光标很大」，而且和这个应用里其它所有输入框都不一样。
           * 选区颜色由 `::selection` 管，效果一样。
           */
          EditorView.lineWrapping,
          keymap.of([
            { key: "Alt-Enter", run: (currentView) => openCursorWriting(currentView) },
            /**
             * 采纳 / 弃用挂在**编辑器**上，不只挂在决策栏上。
             *
             * 候选生成完之后焦点还在正文里（这是对的——人正在读那段 diff），
             * 而上一版的快捷键只在候选卡的 textarea 里生效。文案上写着 `Ctrl+Enter 采纳`，
             * 实际按下去没反应，除非先点一下卡片。
             */
            { key: "Mod-Enter", run: () => adoptFromKeyboard() },
            { key: "Mod-Backspace", run: () => discardFromKeyboard() },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          markdown({ base: markdownLanguage }),
          /**
           * 实时预览：Markdown 记号始终隐去，图片和结构化内容块就地渲染。
           * 文档一个字节没变——见 `editor-live-preview.js` 开头那段。
           */
          livePreview({ resolveUrl: (src) => resolveMediaUrl(src, mediaBaseRef.current) }),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          syntaxHighlighting(mdHighlight),
          cmTheme,
          citationExtension,
          aiDraftExtension,
          textRevisionExtension,
          inlineAnswerExtension,
          heldSelectionExtension,
          lineAffordanceField,
          flashField,
          // 点正文里被标注的那句 → 右侧面板高亮对应素材。反方向由 revealRequest 走。
          EditorView.domEventHandlers({
            /**
             * 点正文里被标注的那一句 → 右侧对应素材高亮并滚进视野。
             *
             * 位置用 `posAtCoords` 反查，而不是读 DOM 上的 `data-cite`：同一条素材
             * 可能有好几处，只知道 id 定位不到「点的是第几处」。
             */
            click(event, view) {
              // **点没标注的地方 = 取消选中**，所以这里不提前 return：
              // 选中态只能换、不能退出的话，想安静读一遍正文时右边永远有一张卡亮着
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              onCiteClickRef.current?.(focusCitationAt(view, pos));
            },
            /**
             * 粘贴和拖放。**截图直接 Ctrl+V 进正文**是这类编辑器最常用的一条路，
             * 走菜单选文件反而是备选。带文件时才拦，纯文本粘贴一律放行。
             */
            paste(event, currentView) {
              const file = [...(event.clipboardData?.files || [])][0];
              if (!file || !inlineLayerReady(currentView)) return false;
              event.preventDefault();
              insertMediaFile(file);
              return true;
            },
            drop(event, currentView) {
              const file = [...(event.dataTransfer?.files || [])][0];
              if (!file || !inlineLayerReady(currentView)) return false;
              event.preventDefault();
              // 落在哪就插在哪，而不是插在原来的光标处
              const pos = currentView.posAtCoords({ x: event.clientX, y: event.clientY });
              if (Number.isFinite(pos)) currentView.dispatch({ selection: { anchor: pos } });
              insertMediaFile(file);
              return true;
            },
            compositionstart() {
              imeComposingRef.current = true;
            },
            compositionend() {
              imeComposingRef.current = false;
            },
            /**
             * ⚠️ **`imeComposingRef` 会卡住。** 组合被点击、失焦或切走输入法打断时，
             * `compositionend` 不一定发得出来，那个布尔值就永远是 true——**之后空格和
             * `/` 全部失效**，现象是「斜杠打进了正文但菜单不出来」，而且怎么试都不好。
             * 失焦时强制清一次，它只是个尽力而为的旁证。
             */
            blur() {
              imeComposingRef.current = false;
            },
            /**
             * 空格和 `/` 这两个**字符键**走 DOM 事件，不走 keymap。
             *
             * keymap 的 `run(view)` 拿不到原始事件，只能去读上面那个会卡住的 ref；
             * 而这里能直接读 `event.isComposing` / `keyCode === 229`——那是**这一次按键
             * 自己**的组合状态，不会被历史状态污染。中文输入里这两个键太常用，
             * 判据必须是当下的事实。
             */
            keydown(event, currentView) {
              if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
              if (!inlineLayerReady(currentView)) return false;
              if (event.key === " ") {
                const canWrite = Boolean(inlinePolicyAt(null)?.capabilities.writeAtCursor);
                if (!shouldOpenInlineAiOnSpace(currentView.state, { composing: false, canWrite })) return false;
                // 空格**不插入**——这一行仍然是空行，Esc 之后什么痕迹都不留
                event.preventDefault();
                return openCursorWriting(currentView);
              }
              if (event.key === "/") {
                if (!shouldOpenBlockMenuOnSlash(currentView.state)) return false;
                // 斜杠照常插进正文：关掉菜单后留在纸上的就是一个普通斜杠，
                // 不会出现「按了个键什么都没有」
                const at = currentView.state.selection.main.head;
                event.preventDefault();
                currentView.dispatch({ changes: { from: at, insert: "/" }, selection: { anchor: at + 1 } });
                requestAnimationFrame(() => openBlockMenu(currentView, at));
                return true;
              }
              return false;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              onCursorChangeRef.current?.(u.state.selection.main.head);
              const { from, to } = u.state.selection.main;
              const text = from === to ? "" : u.state.sliceDoc(from, to);
              onSelectionChangeRef.current?.(text.trim() ? { from, to, text } : null);
            }
            // 标注的**当下**状态（位置挪过、stale 重算过）回给右侧面板。
            // 面板要靠它说「已用 2 处」和「有 1 处改过了」——那两句话必须跟着编辑走，
            // 而位置只有编辑器这一份是准的。字段没变时是同一个对象，比较引用就够。
            const now = u.state.field(citationField);
            if (u.startState.field(citationField) !== now) onCitationsRef.current?.(now.items);
            const aiNow = u.state.field(aiDraftField);
            if (u.startState.field(aiDraftField) !== aiNow) setAiDrafts(aiNow.items);
            const revisionNow = u.state.field(textRevisionField);
            const revisionChanged = u.startState.field(textRevisionField) !== revisionNow;
            if (revisionNow.active && (revisionChanged || u.docChanged)) {
              setSelectionMenu(null);
              const current = activeRevisionRef.current;
              if (current?.id === revisionNow.active.id) {
                const currentDocumentVersion = documentVersionOf(u.state.doc.toString());
                const next = {
                  ...current,
                  from: revisionNow.active.from,
                  to: revisionNow.active.to,
                  status: candidateStatus({ ...current, currentDocumentVersion }),
                };
                activeRevisionRef.current = next;
                setActiveRevision(next);
                requestAnimationFrame(() => setRevisionHostTick((value) => value + 1));
              }
            } else if (revisionChanged && !revisionNow.active) {
              activeRevisionRef.current = null;
              setActiveRevision(null);
            }
            if (u.selectionSet || u.docChanged) {
              const nextSelection = revisionSelectionOf(u.view);
              setSelectionMenu(visibleSelectionMenu(nextSelection, revisionNow.active));
              if (cursorMenuRef.current) {
                const cursorAnchor = !u.docChanged && !nextSelection && !revisionNow.active ? cursorWritingAnchorOf(u.view) : null;
                if (cursorAnchor) setCursorMenu((current) => current ? { ...current, ...cursorAnchor } : current);
                else {
                  cursorNudgeAbort.current?.abort();
                  cursorNudgeAbort.current = null;
                  setCursorMenu(null);
                }
              }
              /**
               * `/` 打开的块菜单：过滤词就是斜杠后面那几个字，跟着正文走。
               * 一出现空白、换行，或光标退到斜杠前面，`blockMenuQuery` 返回 null——
               * 那时候人显然是在写正文，菜单自己让开。
               */
              const openBlock = blockMenuRef.current;
              if (openBlock && openBlock.slashFrom !== null && openBlock.slashFrom !== undefined) {
                const query = blockMenuQuery(u.state, openBlock.slashFrom + 1);
                const anchor = query === null ? null : cursorWritingAnchorOf(u.view);
                if (query === null || !anchor || nextSelection || revisionNow.active) setBlockMenu(null);
                else setBlockMenu((current) => current ? { ...current, ...anchor, query } : current);
              } else if (openBlock && (nextSelection || revisionNow.active)) {
                setBlockMenu(null);
              }
              /**
               * **续写底纹点走就算落定。** 插入这个动作本身已经是一次确认，
               * 上一版还要再点一颗 ✓ 才退底纹——同一件事收了两次确认。
               * 光标离开这段底纹（去别处写字、点到别的段落）时自动确认。
               */
              const head = u.state.selection.main.head;
              for (const item of u.state.field(aiDraftField).items) {
                if (item.confirmed || item.removed) continue;
                if (head < item.from || head > item.to) u.view.dispatch({ effects: confirmAiDraft.of(item.id) });
              }
            }
          }),
        ],
      }),
    });
    view.current = v;
    onCursorChangeRef.current?.(v.state.selection.main.head);
    onSelectionChangeRef.current?.(null);
    const refreshInlineMenus = () => {
      const active = v.state.field(textRevisionField).active;
      const nextSelection = revisionSelectionOf(v);

      setSelectionMenu(visibleSelectionMenu(nextSelection, active));
      if (cursorMenuRef.current) {
        const cursorAnchor = !nextSelection && !active ? cursorWritingAnchorOf(v) : null;
        if (cursorAnchor) setCursorMenu((current) => current ? { ...current, ...cursorAnchor } : current);
        else {
          cursorNudgeAbort.current?.abort();
          cursorNudgeAbort.current = null;
          setCursorMenu(null);
        }
      }
      if (active) requestAnimationFrame(() => setRevisionHostTick((tick) => tick + 1));
    };
    let refreshFrame = 0;
    const scheduleInlineRefresh = () => {
      cancelAnimationFrame(refreshFrame);
      refreshFrame = requestAnimationFrame(refreshInlineMenus);
    };
    // 行首那颗 `+`：widget 是原生 DOM，只能通过冒泡的自定义事件回到 React 这边
    const openFromGutter = (event) => {
      const pos = event.detail?.pos;
      if (!Number.isFinite(pos)) return;
      v.dispatch({ selection: { anchor: pos } });
      v.focus();
      requestAnimationFrame(() => openBlockMenu(v, null));
    };
    v.dom.addEventListener(BLOCK_MENU_EVENT, openFromGutter);
    const boundaryObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleInlineRefresh) : null;
    boundaryObserver?.observe(v.scrollDOM);
    v.scrollDOM.addEventListener("scroll", scheduleInlineRefresh, { passive: true });
    window.addEventListener("scroll", scheduleInlineRefresh, true);
    window.addEventListener("resize", scheduleInlineRefresh);
    document.addEventListener("selectionchange", scheduleInlineRefresh);
    return () => {
      cancelAnimationFrame(refreshFrame);
      v.dom.removeEventListener(BLOCK_MENU_EVENT, openFromGutter);
      boundaryObserver?.disconnect();
      v.scrollDOM.removeEventListener("scroll", scheduleInlineRefresh);
      window.removeEventListener("scroll", scheduleInlineRefresh, true);
      window.removeEventListener("resize", scheduleInlineRefresh);
      document.removeEventListener("selectionchange", scheduleInlineRefresh);
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 块菜单「建议」组交接过来的那一次执行。清掉标记再跑，保证只跑一次。 */
  useEffect(() => {
    if (!cursorMenu?.pendingRun) return;
    const mode = cursorMenu.pendingRun;
    setCursorMenu((menu) => menu ? { ...menu, pendingRun: null } : menu);
    runCursorWriting(mode, "");
    // 由一次性的 pendingRun 触发；其余状态通过 ref 读取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorMenu?.pendingRun]);

  /**
   * 空行灰字要不要提「问 AI」，跟着这份文档的实际写作权限走。
   *
   * 只读的 Reading 文档看到的是「按 / 插入」，不会出现一个按下去什么都不发生的空格提示。
   * 判据仍然只有 `resolveAssistantPolicy` 一处，编辑器不自己推测能力。
   */
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: setLineAffordance.of(Boolean(inlinePolicyAt(null)?.capabilities.writeAtCursor)) });
    // 能力由 scope + target 决定，两者都在 ref 里同步；readOnly 会改变编辑器可写性。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantScope, assistantTarget?.kind, assistantTarget?.editable, readOnly]);

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

  /**
   * 标注换了一批（起稿完成 / 重新核对完）。
   *
   * ⚠️ **必须排在上面那个「外部换值」effect 之后**：换文档和换标注常常是同一次渲染
   * 里的事，而标注的下标是**针对新正文**算的。反过来的话，新标注会先落到旧文档上，
   * 被 `withStale` 判成一片过时，然后才换文档——用户看到的是满屏虚线问号。
   */
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: setCitations.of(citations || []) });
  }, [citations]);

  // 从右侧面板点某条素材 → 正文滚到它第 seq 处引用（同一条用了多处时循环着看）
  useEffect(() => {
    // silent = 正文里刚点过，位置已经在眼前，只是把 seq 记下来给下一次点卡片用
    if (view.current && revealRequest?.id && !revealRequest.silent) {
      revealCitation(view.current, revealRequest.id, revealRequest.seq || 0);
    }
  }, [revealRequest]);

  /**
   * 「去这儿改」：进编辑器的同时跳到被点名的那一段。
   *
   * ⚠️ 靠 `nonce` 触发而不是靠 text 变没变——同一段连点两次也该再跳一次（人多半是
   * 滚走了想回来）。文本相同就不响应的话，第二次点看着就是坏了。
   */
  useEffect(() => {
    if (view.current && revealTextRequest?.nonce) revealText(view.current, revealTextRequest.text);
  }, [revealTextRequest]);

  useEffect(() => {
    let cancelled = false;
    revisionAbort.current?.abort();
    cursorNudgeAbort.current?.abort();
    clearTimeout(revisionSaveTimer.current);
    setRevisionSaveError("");
    setRevisionHistory([]);
    setSelectionMenu(null);
    setCursorMenu(null);
    if (view.current?.state.field(textRevisionField).active) view.current.dispatch({ effects: clearTextRevision.of(null) });
    answerAbort.current?.abort();
    answerAbort.current = null;
    setInlineAnswer_(null);
    if (view.current?.state.field(inlineAnswerField).active) view.current.dispatch({ effects: clearInlineAnswer.of(null) });
    setCurrentRevision(null);
    if (revisionScope) {
      creationApi.revisions(revisionScope)
        .then((result) => { if (!cancelled) setRevisionHistory(result.items || []); })
        .catch((error) => { if (!cancelled) setRevisionSaveError(error.message); });
    }
    return () => { cancelled = true; };
    // scope 变了就是换稿件；这里有意清掉上一份稿的临时对比态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisionScope]);

  useEffect(() => () => {
    revisionAbort.current?.abort();
    cursorNudgeAbort.current?.abort();
    answerAbort.current?.abort();
    clearTimeout(revisionSaveTimer.current);
  }, []);

  useEffect(() => {
    const v = view.current;
    const text = String(insertRequest?.text || "").trim();
    if (!v || !insertRequest?.id || !text) return;
    if (insertRequest.resultKind === "candidate" && activeRevisionRef.current) return;
    const { from, to } = v.state.selection.main;
    const exact = insertRequest.spacing === "exact";
    const before = exact ? "" : v.state.sliceDoc(0, from);
    const after = exact ? "" : v.state.sliceDoc(to);
    const lead = !exact && before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const tail = !exact && after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
    const insert = exact ? text : `${lead}${text}${tail}`;
    /**
     * ⚠️ **没有选区就不是「候选」，是「插入」。**
     *
     * 候选审阅回答的是「改成这样好不好」——它得有个原文可比。光标处插入时原文是空串，
     * diff 全是新增，一条 250 字的回复于是被 `candidateTargetKind` 判成「章节」，
     * 弹出整屏的「章节审阅」：一次插入被当成一次全篇改造，而屏幕上根本没有第二个版本可比。
     *
     * 这条判据和 `looksLikeEdit` 是同一条：**在改用户写下的字，还是在产出新的字。**
     * 产出新的字就走续写底纹——插到光标处、带底纹、点别处即落定，
     * 和空行上生成、回答卡「在下面插入」完全同一条路。
     */
    if (insertRequest.resultKind === "candidate" && from !== to) {
      const createdAt = new Date().toISOString();
      const documentVersion = documentVersionOf(v.state.doc.toString());
      const candidate = createCandidate({
        id: insertRequest.id,
        source: "assistant",
        target: { kind: candidateTargetKind({ original: v.state.sliceDoc(from, to), candidate: insert, document: v.state.doc.toString(), preferred: insertRequest.targetKind }), from, to },
        from,
        to,
        mode: "rewrite",
        label: insertRequest.kind || "AI 助手候选",
        original: v.state.sliceDoc(from, to),
        text: insert,
        generations: [{ text: insert, at: createdAt }],
        grounding: insertRequest.grounding,
        documentVersion,
        createdAt,
        status: "ready",
        rerun: insertRequest.rerun,
      }, documentVersion);
      setSelectionMenu(null);
      setCurrentRevision(candidate);
      v.dispatch({ effects: startTextRevision.of({ id: candidate.id, from, to }), annotations: Transaction.addToHistory.of(false) });
      persistRevision(candidate, "pending");
      onInsertHandled?.(insertRequest.id);
      return;
    }
    const effects = insertRequest.ai || insertRequest.resultKind === "candidate"
      ? [addAiDraft.of({ id: insertRequest.id, from: from + lead.length, to: from + insert.length - tail.length, original: text, label: insertRequest.kind || "AI 续写", createdAt: Date.now() })]
      : undefined;
    v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length - tail.length }, effects });
    v.focus();
    onInsertHandled?.(insertRequest.id);
  }, [insertRequest, onInsertHandled, activeRevision?.id]);

  const cmd = (fn) => () => view.current && fn(view.current);
  const pendingAiDrafts = aiDrafts.filter((item) => !item.confirmed);
  const activeAiDraft = pendingAiDrafts.at(-1);
  const aiText = (item) => {
    const v = view.current;
    if (!v || !item || item.from < 0 || item.to > v.state.doc.length) return "";
    return v.state.sliceDoc(item.from, item.to);
  };
  const activeAiChanged = activeAiDraft ? aiText(activeAiDraft) !== activeAiDraft.original : false;
  function recordOf(revision, status = revision.status || "pending") {
    return {
      id: revision.id,
      mode: revision.mode,
      label: revision.label,
      instruction: revision.instruction || "",
      original: revision.original,
      candidate: revision.text || "",
      generations: revision.generations || [],
      status,
      createdAt: revision.createdAt,
    };
  }

  async function persistRevision(revision, status) {
    if (!revisionScope || !revision) return;
    try {
      const result = await creationApi.saveRevision(revisionScope, recordOf(revision, status));
      setRevisionHistory(result.items || []);
      setRevisionSaveError("");
    } catch (error) {
      setRevisionSaveError(error.message || "修订历史没有保存下来");
    }
  }

  async function generateCursorCandidate(base, instruction = base.instruction || "") {
    const v = view.current;
    if (!v || !base) return;
    revisionAbort.current?.abort();
    const controller = new AbortController();
    revisionAbort.current = controller;
    const documentVersion = documentVersionOf(v.state.doc.toString());
    const pending = createCandidate({ ...base, instruction, documentVersion, status: "generating", error: null }, documentVersion);
    setCurrentRevision(pending);
    try {
      const prompts = inlineWritingPrompts(inlineAiContextRef.current, instruction);
      const result = await creationApi.writingAssist({
        mode: "paragraph",
        title: revisionTitle,
        content: v.state.doc.toString(),
        cursor: pending.from,
        platform: revisionPlatform,
        materials: prompts.materials,
        expert: prompts.expert,
        style: prompts.style,
      }, controller.signal);
      const current = activeRevisionRef.current;
      if (!current || current.id !== base.id) return;
      const now = new Date().toISOString();
      const next = createCandidate({
        ...current,
        instruction,
        text: result.text,
        grounding: result.grounding,
        generations: [...(current.generations || []), { text: result.text, at: now }],
        status: "ready",
        error: null,
        documentVersion,
      }, documentVersionOf(v.state.doc.toString()));
      setCurrentRevision(next);
      await persistRevision(next, "pending");
    } catch (error) {
      if (error.name === "AbortError") return;
      const current = activeRevisionRef.current;
      if (current?.id === base.id) setCurrentRevision(createCandidate({ ...current, instruction, status: "failed", error }, documentVersionOf(v.state.doc.toString())));
    } finally {
      if (revisionAbort.current === controller) revisionAbort.current = null;
    }
  }

  /**
   * 生成新内容 / 回答问题 → **回答卡**，不是 diff。
   *
   * 三条路都进这里：空行输入条的自由指令、`/` 的「续写这一段 / 想一想」、
   * 选区面板底部的自由指令。它们的共同点是**没有「原文」可比**——
   * 用户要的是一段新的字或一个答案，而不是「把这段改成那段」。
   *
   * 上一版把它们全塞进 Candidate，于是「选中一段问它在讲什么」会变成一次改写，
   * 答案直接顶掉了原文。这里正文一个字都不动，落地是显式的第二步。
   */
  /**
   * ⚠️ **`cursor` 和 `at` 是两个东西，不能合并。**
   * `cursor` 是真实光标位置——服务端靠它判断「从哪儿往下写」；
   * `at` 是卡片这个块级 widget 挂在哪一行的末尾。合并之后「想一想」会按行尾提问，
   * 而用户的光标可能停在这一行中间。
   */
  async function runInlineAnswer({ mode, instruction = "", cursor, at, selection = null, label }) {
    const v = view.current;
    const policy = inlinePolicyAt(selection);
    if (!v || !policy?.capabilities.writeAtCursor || activeRevisionRef.current) return;
    answerAbort.current?.abort();
    const controller = new AbortController();
    answerAbort.current = controller;
    const id = inlineAnswerRef.current?.id
      || `answer-${Date.now().toString(36)}-${crypto.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;
    const caret = Number.isFinite(cursor) ? cursor : (selection ? selection.to : v.state.selection.main.head);
    const anchorAt = Number.isFinite(at) ? at : v.state.doc.lineAt(caret).to;
    const base = { id, mode, instruction, label, cursor: caret, at: anchorAt, selection, text: "", busy: true, error: null };
    setSelectionMenu(null);
    setCursorMenu(null);
    setBlockMenu(null);
    setInlineAnswer_(base);
    v.dispatch({
      effects: setInlineAnswer.of({ id, at: anchorAt, ...(selection ? { from: selection.from, to: selection.to } : {}) }),
      annotations: Transaction.addToHistory.of(false),
    });
    requestAnimationFrame(() => setAnswerHostTick((tick) => tick + 1));

    try {
      const prompts = inlineWritingPrompts(inlineAiContextRef.current, instruction);
      const doc = v.state.doc.toString();
      // 选区上的自由指令仍然走 `text-revision` 那个服务端契约——**变的是呈现，不是业务规则**。
      const result = selection
        ? await creationApi.reviseText({
          mode: "rewrite",
          instruction,
          selected: selection.text,
          title: revisionTitle,
          platform: revisionPlatform,
          before: doc.slice(Math.max(0, selection.from - 4_000), selection.from),
          after: doc.slice(selection.to, Math.min(doc.length, selection.to + 4_000)),
        }, controller.signal)
        : await creationApi.writingAssist({
          mode,
          title: revisionTitle,
          content: doc,
          cursor: caret,
          platform: revisionPlatform,
          materials: prompts.materials,
          expert: prompts.expert,
          style: mode === "nudge" ? "" : prompts.style,
        }, controller.signal);
      if (inlineAnswerRef.current?.id !== id) return;
      /**
       * ⚠️ **grounding 必须先归一化再进卡片。**
       * 服务端回的是原始结构，`skipped[].nextStep`（「去核验」/「仍然使用」那颗按钮）
       * 是 `normalizeGrounding` 补出来的。直接渲染原始对象会在读 `nextStep.label` 时抛异常，
       * React 把整棵子树卸掉——现象是「卡片一闪就没了」，而且控制台之外看不出原因。
       * 候选那条路一直是对的（`createCandidate` 内部会归一化），只有这条新路漏了。
       */
      const grounding = normalizeGrounding(result.grounding);
      /**
       * **结果如果是在改这段字，就落到正文里画 diff，而不是停在卡片里。**
       *
       * 选中一段输入「润色优化一下」，用户要的是**看到文章变成什么样**；停在卡片里
       * 等于让他再点一次「插入」，而且插到下面去了——那不是他要的位置。
       * 判据在 `looksLikeEdit`：看回来的东西保留了多少原文，不猜他那句话是什么意思。
       *
       * ⚠️ **gate 被拒时不走这条路。** diff 那条路点空白就是采纳，
       * 而服务端拒了的内容一个字都不该有机会落进正文——留在卡片里，只剩重试和对话。
       */
      if (selection && grounding?.gate !== "rejected" && looksLikeEdit(selection.text, result.text)) {
        landAnswerAsRevision({ selection, instruction, text: result.text, grounding });
        return;
      }
      setInlineAnswer_({ ...base, text: result.text, grounding, busy: false, error: null });
      requestAnimationFrame(() => setAnswerHostTick((tick) => tick + 1));
    } catch (error) {
      if (controller.signal.aborted || error.name === "AbortError") return;
      if (inlineAnswerRef.current?.id !== id) return;
      setInlineAnswer_({ ...base, busy: false, error });
    } finally {
      if (answerAbort.current === controller) answerAbort.current = null;
    }
  }

  /**
   * 卡片 → 正文 diff。**同一次生成，换一种呈现，不重新请求。**
   *
   * 只有「选区上的自由指令」会走到这里：预设技能从一开始就走 diff，
   * 空行上的生成没有原文可比。转过来之后它和预设技能产出的候选完全同构——
   * 同一个 Candidate 状态机、同一条决策栏、同一套 Ctrl+Enter / 点空白采纳。
   */
  function landAnswerAsRevision({ selection, instruction, text, grounding }) {
    const v = view.current;
    if (!v) return;
    setInlineAnswer_(null);
    v.dispatch({ effects: clearInlineAnswer.of(null), annotations: Transaction.addToHistory.of(false) });
    const from = Math.min(selection.from, v.state.doc.length);
    const to = Math.min(selection.to, v.state.doc.length);
    // 选区在生成期间被改动过就不落地：那时候 from/to 指的已经不是用户看到的那段字
    if (v.state.sliceDoc(from, to) !== selection.text) {
      setInlineAnswer_({ id: `answer-${Date.now().toString(36)}`, mode: "rewrite", instruction, label: "改写", cursor: to, at: v.state.doc.lineAt(to).to, selection, text, grounding, busy: false, error: null });
      requestAnimationFrame(() => setAnswerHostTick((tick) => tick + 1));
      return;
    }
    const documentVersion = documentVersionOf(v.state.doc.toString());
    const createdAt = new Date().toISOString();
    const id = `revision-${Date.now().toString(36)}-${crypto.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;
    const candidate = createCandidate({
      id,
      source: "selection-revision",
      target: { kind: candidateTargetKind({ original: selection.text, candidate: text, document: v.state.doc.toString() }), from, to },
      mode: "rewrite",
      label: "改写",
      instruction,
      original: selection.text,
      text,
      generations: [{ text, at: createdAt }],
      grounding,
      from,
      to,
      documentVersion,
      createdAt,
      status: "ready",
      error: null,
    }, documentVersion);
    setSelectionMenu(null);
    setCurrentRevision(candidate);
    v.dispatch({ effects: startTextRevision.of({ id, from, to }), annotations: Transaction.addToHistory.of(false) });
    persistRevision(candidate, "pending");
  }

  /**
   * 「对话」：**把刚发生的这一轮搬到右栏**，不重新问一遍。
   *
   * 用户已经读完这个答案了。点「对话」是想接着这段往下聊，不是想看同一个问题的第二个答案——
   * 上一版把指令重新发过去，于是他刚读的那段在右栏消失了，换成另一段。
   *
   * 送出去的两条都真实发生过：他写的指令（连同选中的原文）和模型回的字。服务端把它们落成
   * 一段新对话并打开 `replayHistory`，下一轮模型看得到这段前文——和「换权限模式后接着聊」
   * 用的是同一套机制，不另起一条路。
   */
  function discussInlineAnswer() {
    const answer = inlineAnswerRef.current;
    if (!answer || !onDiscuss || !answer.text?.trim()) return;
    const quoted = answer.selection?.text
      ? answer.selection.text.split("\n").map((line) => `> ${line}`).join("\n")
      : "";
    const ask = answer.instruction
      || (answer.mode === "nudge" ? "针对这一段，给我一个最值得继续想的问题。" : "接着这里往下写一段。");
    onDiscuss({ id: answer.id, prompt: [ask, quoted].filter(Boolean).join("\n\n"), answer: answer.text });
    closeInlineAnswer();
  }

  function closeInlineAnswer() {
    answerAbort.current?.abort();
    answerAbort.current = null;
    setInlineAnswer_(null);
    view.current?.dispatch({ effects: clearInlineAnswer.of(null), annotations: Transaction.addToHistory.of(false) });
    restoreEditorFocus();
  }

  /** 「在下面插入」：走续写底纹，插入后点别处即落定（和 Notion 图 31→32 一致）。 */
  function insertAnswerBelow() {
    const answer = inlineAnswerRef.current;
    const v = view.current;
    if (!v || !answer?.text.trim()) return;
    const at = Math.min(answer.at, v.state.doc.length);
    const before = v.state.sliceDoc(0, at);
    const lead = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const insert = `${lead}${answer.text.trim()}`;
    setInlineAnswer_(null);
    v.dispatch({
      changes: { from: at, insert },
      selection: { anchor: at + insert.length },
      effects: [
        clearInlineAnswer.of(null),
        addAiDraft.of({ id: answer.id, from: at + lead.length, to: at + insert.length, original: answer.text.trim(), label: answer.label || "AI 生成", createdAt: Date.now() }),
      ],
    });
    v.focus();
  }

  /** `/` 建议组和空行输入条的统一入口。全部产出回答卡。 */
  function runCursorWriting(mode, instruction = "") {
    const anchor = cursorMenuRef.current || cursorMenu;
    const v = view.current;
    if (!v) return;
    const caret = anchor ? anchor.from : v.state.selection.main.head;
    runInlineAnswer({
      mode: mode === "nudge" ? "nudge" : "paragraph",
      instruction,
      cursor: caret,
      at: v.state.doc.lineAt(caret).to,
      label: mode === "nudge" ? "想一想" : instruction ? "按要求生成" : "续写一段",
    });
  }

  async function generateRevision(base, instruction = base.instruction || "") {
    const v = view.current;
    if (!v || !base) return;
    revisionAbort.current?.abort();
    const controller = new AbortController();
    revisionAbort.current = controller;
    const documentVersion = documentVersionOf(v.state.doc.toString());
    const pending = createCandidate({ ...base, instruction, documentVersion, status: "generating", error: null }, documentVersion);
    setCurrentRevision(pending);
    try {
      const doc = v.state.doc.toString();
      const result = await creationApi.reviseText({
        mode: base.mode,
        instruction,
        selected: base.original,
        title: revisionTitle,
        platform: revisionPlatform,
        before: doc.slice(Math.max(0, pending.from - 4_000), pending.from),
        after: doc.slice(pending.to, Math.min(doc.length, pending.to + 4_000)),
      }, controller.signal);
      const current = activeRevisionRef.current;
      if (!current || current.id !== base.id) return;
      const now = new Date().toISOString();
      const next = createCandidate({
        ...current,
        instruction,
        text: result.text,
        grounding: result.grounding,
        generations: [...(current.generations || []), { text: result.text, at: now }],
        status: "ready",
        error: null,
        documentVersion,
      }, documentVersionOf(v.state.doc.toString()));
      setCurrentRevision(next);
      await persistRevision(next, "pending");
    } catch (error) {
      if (error.name === "AbortError") return;
      const current = activeRevisionRef.current;
      if (current?.id === base.id) setCurrentRevision(createCandidate({ ...current, instruction, status: "failed", error }, documentVersionOf(v.state.doc.toString())));
    } finally {
      if (revisionAbort.current === controller) revisionAbort.current = null;
    }
  }

  function regenerateCandidate(base, instruction = base?.instruction || "") {
    if (!base) return;
    if (base.source === "cursor-writing") {
      generateCursorCandidate(base, instruction);
      return;
    }
    if (base.source === "assistant" && typeof base.rerun === "function") {
      const rerun = base.rerun;
      closeRevision("discarded");
      rerun();
      return;
    }
    generateRevision(base, instruction);
  }

  /**
   * 选区上的动作分两条路：
   *
   * - **预设技能**（润色 / 纠错 / 缩写 / 扩写）→ 就地 diff。用户按下去就知道会发生什么，
   *   要判断的只是「改得好不好」，所以直接给「改完的样子」。
   * - **自由指令** → 回答卡。那句话可能是「翻译成英文」，也可能是「这段在讲什么」——
   *   我们无从判断它是不是一次改写，**默认成改写就会用答案顶掉用户的原文**。
   *   卡片里正文一个字不动，是替换还是插入由用户说了算。
   */
  function beginRevision(mode, instruction) {
    const v = view.current;
    if (!v || !selectionMenu || !inlinePolicyAt(selectionMenu)?.capabilities.reviseSelection) return;
    if (mode === "rewrite") {
      const selection = { from: selectionMenu.from, to: selectionMenu.to, text: selectionMenu.text };
      runInlineAnswer({ mode: "rewrite", instruction, cursor: selection.to, at: v.state.doc.lineAt(selection.to).to, selection, label: "改写" });
      return;
    }
    const id = `revision-${Date.now().toString(36)}-${crypto.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;
    const revision = createCandidate({
      id,
      source: "selection-revision",
      target: { kind: candidateTargetKind({ original: selectionMenu.text, document: v.state.doc.toString() }), from: selectionMenu.from, to: selectionMenu.to },
      mode,
      label: revisionLabel(mode),
      instruction,
      original: selectionMenu.text,
      text: "",
      generations: [],
      from: selectionMenu.from,
      to: selectionMenu.to,
      documentVersion: documentVersionOf(v.state.doc.toString()),
      createdAt: new Date().toISOString(),
      status: "generating",
      error: null,
    }, documentVersionOf(v.state.doc.toString()));
    setSelectionMenu(null);
    setCurrentRevision(revision);
    v.dispatch({ effects: startTextRevision.of({ id, from: revision.from, to: revision.to }), annotations: Transaction.addToHistory.of(false) });
    generateRevision(revision, instruction);
  }

  useEffect(() => {
    if (!revisionRequest?.id || !revisionRequest.selection?.text || !revisionScope) return;
    const selected = revisionRequest.selection;
    const v = view.current;
    if (!v || selected.from < 0 || selected.to > v.state.doc.length || selected.from >= selected.to) {
      onRevisionHandled?.(revisionRequest.id);
      return;
    }
    const original = v.state.sliceDoc(selected.from, selected.to);
    if (original !== selected.text) {
      onRevisionHandled?.(revisionRequest.id);
      return;
    }
    const id = `revision-${Date.now().toString(36)}-${crypto.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;
    const revision = createCandidate({
      id,
      source: "assistant-revision",
      target: { kind: candidateTargetKind({ original, document: v.state.doc.toString(), preferred: selected.targetKind }), from: selected.from, to: selected.to },
      mode: revisionRequest.mode || "rewrite",
      label: revisionRequest.label || revisionLabel(revisionRequest.mode || "rewrite"),
      instruction: revisionRequest.instruction || "",
      original,
      text: "",
      generations: [],
      from: selected.from,
      to: selected.to,
      documentVersion: documentVersionOf(v.state.doc.toString()),
      createdAt: new Date().toISOString(),
      status: "generating",
      error: null,
    }, documentVersionOf(v.state.doc.toString()));
    setSelectionMenu(null);
    setCurrentRevision(revision);
    v.dispatch({ effects: startTextRevision.of({ id, from: revision.from, to: revision.to }), annotations: Transaction.addToHistory.of(false) });
    generateRevision(revision, revision.instruction);
    onRevisionHandled?.(revisionRequest.id);
    // 由一次性的 request id 触发；生成函数通过 ref 读取当前编辑器状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisionRequest?.id]);

  function closeRevision(status) {
    const current = activeRevisionRef.current;
    const v = view.current;
    if (!current || !v) return;
    revisionAbort.current?.abort();
    clearTimeout(revisionSaveTimer.current);
    if (status === "adopted") {
      if (["generating", "failed", "stale"].includes(current.status)) return;
      const candidate = current.text.trim();
      if (!candidate) return;
      v.dispatch({
        changes: { from: current.from, to: current.to, insert: candidate },
        selection: { anchor: current.from + candidate.length },
        effects: clearTextRevision.of(null),
      });
      persistRevision({ ...current, text: candidate, status: "adopted" }, "adopted");
    } else {
      v.dispatch({ effects: clearTextRevision.of(null) });
      persistRevision({ ...current, status: "discarded" }, "discarded");
    }
    setCurrentRevision(null);
    v.focus();
  }

  useEffect(() => {
    clearTimeout(revisionSaveTimer.current);
    if (!activeRevision || activeRevision.status === "generating" || !activeRevision.text) return;
    revisionSaveTimer.current = setTimeout(() => persistRevision(activeRevision, "pending"), 700);
    return () => clearTimeout(revisionSaveTimer.current);
    // 持久保存只跟候选文字变化走；其余状态由生成、采纳、弃用即时保存。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRevision?.text]);

  const focusedRevision = activeRevision && candidateReviewMode(activeRevision.target) === "focused";
  const focusedRevisionOpen = Boolean(focusedRevision);
  useEffect(() => {
    onCandidateReviewModeChange?.(focusedRevisionOpen);
    return () => { if (focusedRevisionOpen) onCandidateReviewModeChange?.(false); };
  }, [focusedRevisionOpen, onCandidateReviewModeChange]);
  const revisionHost = activeRevision && !focusedRevision && view.current
    ? view.current.dom.querySelector(`[data-revision-host="${activeRevision.id}"]`)
    : null;
  const answerHost = inlineAnswer && view.current
    ? view.current.dom.querySelector(`[data-answer-host="${inlineAnswer.id}"]`)
    : null;
  /**
   * 候选定稿后才算 diff，**流式生成期间不算**。
   *
   * 生成中每几十毫秒就多几个字，逐字 diff 会跟着整段重排——读起来是花屏，算起来还白费。
   * 这期间正文保持「整段划掉 + 下方生成中」，等文字停下来再一次性上色。
   */
  const revisionDiff = useMemo(
    () => (activeRevision && activeRevision.status !== "generating"
      ? diffTokens(activeRevision.original, activeRevision.text)
      : { parts: [], degraded: false }),
    [activeRevision?.id, activeRevision?.original, activeRevision?.text, activeRevision?.status],
  );

  // 算好的 diff 交给编辑器去画。原文一个字节都不动，新增靠零宽 widget 落位。
  useEffect(() => {
    const v = view.current;
    if (!v || !activeRevision) return;
    if (v.state.field(textRevisionField).active?.id !== activeRevision.id) return;
    v.dispatch({
      effects: setTextRevisionDiff.of({ id: activeRevision.id, parts: revisionDiff.parts }),
      annotations: Transaction.addToHistory.of(false),
    });
    requestAnimationFrame(() => setRevisionHostTick((tick) => tick + 1));
    // 由候选 id 和算好的 diff 驱动；编辑器实例通过 ref 读取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRevision?.id, revisionDiff]);

  const candidateDecisions = activeRevision ? {
    candidate: activeRevision,
    degraded: revisionDiff.degraded,
    persistenceError: revisionSaveError,
    onRegenerate: (instruction) => regenerateCandidate(activeRevisionRef.current, instruction),
    onAdopt: () => closeRevision("adopted"),
    onDiscard: () => closeRevision("discarded"),
    onGroundingAction: (item, nextStep) => {
      if (nextStep.id === "verify") {
        window.location.hash = "#/materials/需核验";
        return;
      }
      const current = activeRevisionRef.current;
      const instruction = [current?.instruction, `在服务端校验允许的前提下，仍然使用素材“${item.title}”。`].filter(Boolean).join("\n");
      regenerateCandidate(current, instruction);
    },
  } : null;

  /**
   * 选区面板里的格式动作。**一律复用上面那三个已有的记号命令**，没有第二套模型：
   * 按钮做的事和自己敲出来的完全一样。
   */
  const selectionFormat = {
    bold: cmd((v) => wrap(v, "**")),
    italic: cmd((v) => wrap(v, "*")),
    strike: cmd((v) => wrap(v, "~~")),
    code: cmd((v) => wrap(v, "`")),
    link: cmd((v) => wrap(v, "[", "](url)")),
    quote: cmd((v) => prefixLines(v, "> ", /^>\s?/)),
    bullet: cmd((v) => prefixLines(v, "- ", /^[-*]\s/)),
    ordered: cmd((v) => prefixLines(v, "1. ", /^\d+\.\s/)),
  };

  /**
   * 插图片 / 视频。**文件落进本地资产库，正文里只留稳定的 asset URI。**
   *
   * ⚠️ 上传成功之前正文一个字都不写：失败时留下一个指向不存在文件的
   * `![](…)` 比什么都没有更糟——它看着像插成功了。
   */
  function mediaLabel(file) {
    const fallback = file?.type?.startsWith("video/") ? "视频" : "图片";
    return String(file?.name || fallback)
      .replace(/\.[^.]+$/, "")
      .replace(/[\[\]\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || fallback;
  }

  async function insertMediaFile(file) {
    const v = view.current;
    if (!v || !file) return;
    const kind = file.type?.startsWith("video/") ? "视频" : "图片";
    setMediaError("");
    setMediaBusy(kind);
    try {
      const result = await api.uploadMedia(file);
      const rel = mediaBaseRef.current && result.path.startsWith(`${mediaBaseRef.current}/`)
        ? result.path.slice(mediaBaseRef.current.length + 1)
        : result.path;
      // 上传期间仍可移动光标或继续写字，完成后以此刻的光标为准，避免旧下标把图片插错段。
      const at = v.state.selection.main.head;
      const line = v.state.doc.lineAt(at);
      const lead = line.text.trim() ? "\n\n" : "";
      const tail = line.to < v.state.doc.length ? "\n" : "\n\n";
      // 路径进正文前必须编码；文件名也要去掉会截断 Markdown alt 的方括号与换行。
      const markdown = `${lead}![${mediaLabel(file)}](${encodeMarkdownPath(rel)})${tail}`;
      const insertAt = line.text.trim() ? line.to : line.from;
      v.dispatch({ changes: { from: insertAt, insert: markdown }, selection: { anchor: insertAt + markdown.length } });
      v.focus();
    } catch (error) {
      setMediaError(error.message || `没能插入这个${kind}`);
    } finally {
      setMediaBusy(false);
    }
  }

  function pickMedia(kind) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = kind === "video" ? "video/mp4,video/webm,video/quicktime" : "image/png,image/jpeg,image/gif,image/webp,image/avif";
    input.addEventListener("change", () => { if (input.files?.[0]) insertMediaFile(input.files[0]); });
    input.click();
  }

  /** 块菜单选中一条。`ai:` 前缀的那几条转交给光标写作，其余是纯本地的记号命令。 */
  function chooseBlockItem(item) {
    const v = view.current;
    const current = blockMenuRef.current;
    if (!v || !current) return;
    // `/` 和它后面那几个过滤字符要先吃掉，否则「输入 /标题 选标题 1」会得到 `# /标题`
    const eat = current.slashFrom === null || current.slashFrom === undefined
      ? null
      : { from: current.slashFrom, to: Math.min(v.state.doc.length, current.slashFrom + 1 + (current.query || "").length) };
    setBlockMenu(null);
    if (item.id === "image" || item.id === "video") {
      if (eat && eat.from < eat.to) v.dispatch({ changes: { from: eat.from, to: eat.to }, selection: { anchor: eat.from } });
      pickMedia(item.id);
      return;
    }
    if (item.id.startsWith("ai:")) {
      if (eat && eat.from < eat.to) v.dispatch({ changes: { from: eat.from, to: eat.to }, selection: { anchor: eat.from } });
      v.focus();
      /**
       * ⚠️ **不能在这里直接调 `runCursorWriting`**：它要的锚点在 `cursorMenu` 里，
       * 而 `openCursorWriting` 刚 setState，这一轮还读不到。所以把「要跑什么」写进
       * 菜单状态本身（`pendingRun`），由下面那个 effect 在状态真的落地之后执行一次。
       */
      const mode = item.id.slice(3);
      requestAnimationFrame(() => {
        if (!openCursorWriting(v)) return;
        if (mode !== "write") setCursorMenu((menu) => menu ? { ...menu, pendingRun: mode } : menu);
      });
      return;
    }
    applyBlockItem(v, item.id, eat);
    restoreEditorFocus();
  }

  return (
    <div
      className="md-editor"
      data-readonly={readOnly || undefined}
      /* 内联菜单占位时灰字让开：屏幕上同时出现「输入框」和「按空格问 AI」
         会读成两件事，而它们本来就是同一件事的两个阶段 */
      data-inline-open={cursorMenu || blockMenu ? "true" : undefined}
    >
      {/**
        * 顶栏**只留对整篇的动作**。
        *
        * 加粗、标题、列表这些改的是「此刻选中的那段字」，它们的位置应该跟着选区走，
        * 而不是钉在几百像素之外的顶栏上——上一版选中一段话想加粗要把视线甩到屏幕顶端，
        * 想润色又要甩回选区旁边，同一个操作对象被拆到了两个面板。它们现在都在选区面板里。
        */}
      {/**
        * ⚠️ **正文上方不留任何工具栏。**
        *
        * 撤销 / 重做走 `Ctrl+Z` / `Ctrl+Shift+Z`（和所有编辑器一样，不需要两颗按钮占一行）；
        * 预览撤了——编辑态本身就是实时预览，一个「看排版后的样子」的开关等于承认平时看的不是；
        * AI 历史也撤了（修订记录仍在服务端，只是界面上不再有回看入口）。
        * `toolbarExtra` 留着：调用方偶尔要在正文顶上挂一颗轻量动作，它自己管样式。
        */}
      {toolbarExtra ? <div className="md-editor__bar">{toolbarExtra}</div> : null}
      {/**
        * 上传中 / 失败的反馈。**不做成 toast**：视线此刻在正文里那个插入点上，
        * 而屏幕角落弹出来的东西要转头去找。失败时说清楚是哪一步没成，正文一个字没写。
        */}
      {mediaBusy || mediaError ? (
        <div className={`md-editor__media${mediaError ? " is-bad" : ""}`} aria-live="polite">
          {mediaBusy ? <><IconLoader2 className="spin" aria-hidden="true" />正在插入{mediaBusy}…</> : <>{mediaError}<button type="button" onClick={() => setMediaError("")}>知道了</button></>}
        </div>
      ) : null}
      {/**
        * 续写插进来之后的那条提示。**没有确认键**——光标离开这段底纹就算落定
        * （见 updateListener 里那段）。插入本身已经是一次确认，再收一次等于同一件事问两遍。
        */}
      {activeAiDraft ? (
        <div className="ai-draft-review" aria-live="polite">
          <IconSparkles aria-hidden="true" stroke={1.7} />
          <div className="ai-draft-review__copy">
            <b>AI 续写已插入</b>
            <span>{activeAiChanged ? "已经改过" : "可以直接在底纹里改"} · 点别处即落定{pendingAiDrafts.length > 1 ? ` · 共 ${pendingAiDrafts.length} 段` : ""}</span>
          </div>
        </div>
      ) : null}
      {focusedRevision ? <section className="md-candidate-focus" aria-label="专注审阅正文候选">
        <header><div><small>正文候选</small><strong>{activeRevision.target.kind === "whole-document" ? "全文审阅" : "章节审阅"}</strong></div><button type="button" onClick={() => closeRevision("discarded")} aria-label="弃用候选并结束审阅">弃用并结束审阅</button></header>
        <CandidateCard {...candidateDecisions} />
      </section> : null}      {/* 编辑器**一直挂在 DOM 里**，预览只是盖上去。卸载再挂的话，撤销历史和滚动位置会丢 */}
      <div className="md-editor__body" hidden={focusedRevision || undefined}>
        <div ref={host} className="md-editor__cm" aria-label={ariaLabel} />
      </div>
      {cursorMenu && !focusedRevision ? createPortal(
        <InlineAiPrompt anchor={cursorMenu} onRun={runCursorWriting} onClose={closeCursorWriting} />,
        document.body
      ) : null}
      {blockMenu && !focusedRevision ? createPortal(
        <BlockInsertMenu
          anchor={blockMenu}
          query={blockMenu.query}
          ownFilter={blockMenu.slashFrom === null}
          canWrite={blockMenu.canWrite}
          onSelect={chooseBlockItem}
          onClose={closeBlockMenu}
        />,
        document.body
      ) : null}
      {selectionMenu && !focusedRevision ? createPortal(
        <SelectionRevisionMenu
          selection={selectionMenu}
          format={selectionFormat}
          onRun={beginRevision}
          onClose={closeSelectionRevision}
        />,
        document.body
      ) : null}
      {activeRevision && revisionHost ? createPortal(<RevisionDecisionBar {...candidateDecisions} />, revisionHost) : null}
      {inlineAnswer && answerHost ? createPortal(
        <AiAnswerCard
          answer={inlineAnswer}
          onInsert={insertAnswerBelow}
          onRetry={() => runInlineAnswer({ mode: inlineAnswer.mode, instruction: inlineAnswer.instruction, cursor: inlineAnswer.cursor, at: inlineAnswer.at, selection: inlineAnswer.selection, label: inlineAnswer.label })}
          onDiscuss={onDiscuss ? discussInlineAnswer : undefined}
          onDismiss={closeInlineAnswer}
        />,
        answerHost
      ) : null}
    </div>
  );
}
