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
import { EditorView, keymap, drawSelection, Decoration } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { renderMarkdown } from "../lib/markdown.js";
import { creationApi } from "../lib/creation-api.js";
import { citationExtension, citationField, focusCitationAt, revealCitation, setCitations } from "../lib/editor-citations.js";
import { addAiDraft, aiDraftExtension, aiDraftField, confirmAiDraft } from "../lib/editor-ai-drafts.js";
import { clearTextRevision, startTextRevision, textRevisionExtension, textRevisionField } from "../lib/editor-text-revisions.js";
import { candidateStatus, createCandidate, documentVersionOf } from "../lib/ai/result-model.js";
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
  IconCheck,
  IconHistory,
  IconSparkles,
  IconX,
} from "./icons.jsx";
import { Select } from "./ui.jsx";
import { CandidateCard } from "./assistant/CandidateCard.jsx";
import { SelectionRevisionMenu, revisionLabel } from "./TextRevision.jsx";
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

function revisionSelectionOf(view) {
  const { from, to } = view.state.selection.main;
  if (from === to) return null;
  const text = view.state.sliceDoc(from, to);
  if (!text.trim()) return null;
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  if (!start || !end) return null;
  const topEdge = Math.min(start.top, end.top);
  const bottomEdge = Math.max(start.bottom, end.bottom);
  const placement = topEdge > 92 ? "above" : "below";
  return {
    from,
    to,
    text,
    left: Math.max(18, Math.min(window.innerWidth - 18, (start.left + end.right) / 2)),
    top: placement === "above" ? topEdge - 8 : bottomEdge + 8,
    placement,
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
  const [preview, setPreview] = useState(false);
  const [aiDrafts, setAiDrafts] = useState([]);
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState(null);
  const [activeRevision, setActiveRevision] = useState(null);
  const [, setRevisionHostTick] = useState(0);
  const activeRevisionRef = useRef(null);
  const revisionAbort = useRef(null);
  const revisionSaveTimer = useRef(0);
  const [revisionHistory, setRevisionHistory] = useState([]);
  const [revisionSaveError, setRevisionSaveError] = useState("");
  const revisionScopeRef = useRef(revisionScope);
  revisionScopeRef.current = revisionScope;
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const setCurrentRevision = (next) => {
    activeRevisionRef.current = next;
    setActiveRevision(next);
  };

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
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          syntaxHighlighting(mdHighlight),
          cmTheme,
          citationExtension,
          aiDraftExtension,
          textRevisionExtension,
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
              setSelectionMenu(revisionScopeRef.current && !previewRef.current && !revisionNow.active ? revisionSelectionOf(u.view) : null);
            }
          }),
        ],
      }),
    });
    view.current = v;
    onCursorChangeRef.current?.(v.state.selection.main.head);
    onSelectionChangeRef.current?.(null);
    const refreshSelection = () => {
      const active = v.state.field(textRevisionField).active;
      setSelectionMenu(revisionScopeRef.current && !previewRef.current && !active ? revisionSelectionOf(v) : null);
      if (active) requestAnimationFrame(() => setRevisionHostTick((tick) => tick + 1));
    };
    v.scrollDOM.addEventListener("scroll", refreshSelection, { passive: true });
    window.addEventListener("resize", refreshSelection);
    return () => {
      v.scrollDOM.removeEventListener("scroll", refreshSelection);
      window.removeEventListener("resize", refreshSelection);
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
    clearTimeout(revisionSaveTimer.current);
    setRevisionSaveError("");
    setRevisionHistory([]);
    setSelectionMenu(null);
    if (view.current?.state.field(textRevisionField).active) view.current.dispatch({ effects: clearTextRevision.of(null) });
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
    if (insertRequest.resultKind === "candidate") {
      const createdAt = new Date().toISOString();
      const documentVersion = documentVersionOf(v.state.doc.toString());
      const candidate = createCandidate({
        id: insertRequest.id,
        source: "assistant",
        target: { kind: from === to ? "insertion" : "selection", from, to },
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
    const effects = insertRequest.ai
      ? [addAiDraft.of({ id: insertRequest.id, from, to: from + insert.length, original: text, label: insertRequest.kind || "AI 续写", createdAt: Date.now() })]
      : undefined;
    v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length - tail.length }, effects });
    v.focus();
    onInsertHandled?.(insertRequest.id);
  }, [insertRequest, onInsertHandled, activeRevision?.id]);

  const html = useMemo(() => (preview ? renderMarkdown(value || "") : ""), [preview, value]);
  const cmd = (fn) => () => view.current && fn(view.current);
  const headingOf = () => {
    const v = view.current;
    if (!v) return HEADINGS[0];
    const line = v.state.doc.lineAt(v.state.selection.main.from);
    return HEADINGS[(line.text.match(/^(#{1,3})\s+/)?.[1].length ?? 0)] || HEADINGS[0];
  };
  const pendingAiDrafts = aiDrafts.filter((item) => !item.confirmed);
  const activeAiDraft = pendingAiDrafts.at(-1);
  const aiText = (item) => {
    const v = view.current;
    if (!v || !item || item.from < 0 || item.to > v.state.doc.length) return "";
    return v.state.sliceDoc(item.from, item.to);
  };
  const activeAiChanged = activeAiDraft ? aiText(activeAiDraft) !== activeAiDraft.original : false;
  const acceptAiDraft = () => {
    if (!view.current || !activeAiDraft) return;
    view.current.dispatch({ effects: confirmAiDraft.of(activeAiDraft.id) });
    view.current.focus();
  };

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
    if (base.source === "assistant" && typeof base.rerun === "function") {
      const rerun = base.rerun;
      closeRevision("discarded");
      rerun();
      return;
    }
    generateRevision(base, instruction);
  }

  function beginRevision(mode, instruction) {
    const v = view.current;
    if (!v || !selectionMenu || !revisionScope) return;
    const id = `revision-${Date.now().toString(36)}-${crypto.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;
    const revision = createCandidate({
      id,
      source: "selection-revision",
      target: { kind: "selection", from: selectionMenu.from, to: selectionMenu.to },
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
      target: { kind: "selection", from: selected.from, to: selected.to },
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

  function editRevisionCandidate(text) {
    const current = activeRevisionRef.current;
    const v = view.current;
    if (!current || !v) return;
    setCurrentRevision(createCandidate({ ...current, text, status: "edited" }, documentVersionOf(v.state.doc.toString())));
  }

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

  const revisionHost = activeRevision && view.current
    ? view.current.dom.querySelector(`[data-revision-host="${activeRevision.id}"]`)
    : null;

  return (
    <div className="md-editor" data-readonly={readOnly || undefined}>
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
          onClick={() => { setSelectionMenu(null); setPreview((p) => !p); }}
          aria-pressed={preview}
          disabled={!!activeRevision}
          title={activeRevision ? "先采纳或弃用正在对比的修订" : preview ? "回到编辑" : "看排版后的样子"}
        >
          {preview ? <IconPencil aria-hidden="true" stroke={1.7} /> : <IconEye aria-hidden="true" stroke={1.7} />}
          {preview ? "编辑" : "预览"}
        </button>
        {aiDrafts.length || revisionHistory.length || revisionSaveError ? (
          <button
            className="icon-btn md-editor__ai-history"
            data-open={aiHistoryOpen ? "true" : undefined}
            onClick={() => setAiHistoryOpen((open) => !open)}
            aria-expanded={aiHistoryOpen}
            aria-label={`查看 AI 原稿与修订历史，共 ${aiDrafts.length + revisionHistory.length} 条`}
            title={`查看 AI 原稿与修订历史（${aiDrafts.length + revisionHistory.length}）`}
          >
            <IconHistory aria-hidden="true" stroke={1.7} />
          </button>
        ) : null}
        {toolbarExtra}
      </div>
      {activeAiDraft ? (
        <div className="ai-draft-review" aria-live="polite">
          <IconSparkles aria-hidden="true" stroke={1.7} />
          <div className="ai-draft-review__copy">
            <b>AI 续写待确认</b>
            <span>{activeAiChanged ? "已经改过，可以采用" : "直接在底纹里修改"}{pendingAiDrafts.length > 1 ? ` · 共 ${pendingAiDrafts.length} 段` : ""}</span>
          </div>
          <div className="ai-draft-review__actions">
            <button className="icon-btn" onClick={() => setAiHistoryOpen(true)} aria-label="回看 AI 插入时的原稿" title="回看 AI 插入时的原稿">
              <IconHistory aria-hidden="true" stroke={1.7} />
            </button>
            <button className="icon-btn" data-primary="true" onClick={acceptAiDraft} aria-label="确认采用这段，移除底纹" title="确认采用这段，移除底纹">
              <IconCheck aria-hidden="true" stroke={1.9} />
            </button>
          </div>
        </div>
      ) : null}
      {aiHistoryOpen && (aiDrafts.length || revisionHistory.length || revisionSaveError) ? (
        <section className="ai-draft-history" aria-label="AI 原稿与修订历史">
          <header className="ai-draft-history__head">
            <span><IconHistory aria-hidden="true" stroke={1.7} />AI 原稿与修订历史</span>
            <button className="icon-btn" onClick={() => setAiHistoryOpen(false)} aria-label="关闭 AI 历史" title="关闭">
              <IconX aria-hidden="true" stroke={1.7} />
            </button>
          </header>
          <div className="ai-draft-history__list">
            {revisionSaveError ? <div className="ai-draft-history__error">修订历史暂时没有保存：{revisionSaveError}</div> : null}
            {revisionHistory.map((item) => (
              <article className="ai-draft-history__item text-revision-history__item" key={item.id}>
                <div className="ai-draft-history__meta">
                  <span>{item.label || revisionLabel(item.mode)}{item.instruction ? ` · ${item.instruction}` : ""}</span>
                  <span>{{ adopted: "已采纳", discarded: "已弃用", pending: "未处理" }[item.status] || "未处理"}</span>
                </div>
                <small>原文</small>
                <p className="text-revision-history__original">{item.original}</p>
                {item.candidate ? <><small>候选</small><p className="text-revision-history__candidate">{item.candidate}</p></> : null}
              </article>
            ))}
            {[...aiDrafts].reverse().map((item, index) => (
              <article className="ai-draft-history__item" key={item.id}>
                <div className="ai-draft-history__meta">
                  <span>{item.label || "AI 续写"} · {aiDrafts.length - index}</span>
                  <span>{item.removed ? "已删除" : item.confirmed ? "已采用" : "待确认"}{!item.removed && aiText(item) !== item.original ? " · 已修改" : ""}</span>
                </div>
                <p>{item.original}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {/* 编辑器**一直挂在 DOM 里**，预览只是盖上去。卸载再挂的话，撤销历史和滚动位置会丢 */}
      <div className="md-editor__body" hidden={preview}>
        <div ref={host} className="md-editor__cm" aria-label={ariaLabel} />
      </div>
      {preview ? (
        <div className="md-editor__body md-editor__preview-body">
          <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : null}
      {selectionMenu && !preview ? createPortal(
        <SelectionRevisionMenu selection={selectionMenu} onRun={beginRevision} onClose={() => setSelectionMenu(null)} />,
        document.body
      ) : null}
      {activeRevision && revisionHost ? createPortal(
        <CandidateCard
          candidate={activeRevision}
          persistenceError={revisionSaveError}
          onText={editRevisionCandidate}
          onRegenerate={(instruction) => regenerateCandidate(activeRevisionRef.current, instruction)}
          onAdopt={() => closeRevision("adopted")}
          onDiscard={() => closeRevision("discarded")}
          onGroundingAction={(item, nextStep) => {
            if (nextStep.id === "verify") {
              window.location.hash = "#/materials/需核验";
              return;
            }
            const current = activeRevisionRef.current;
            const instruction = [current?.instruction, `在服务端校验允许的前提下，仍然使用素材“${item.title}”。`].filter(Boolean).join("\n");
            regenerateCandidate(current, instruction);
          }}
        />,
        revisionHost
      ) : null}
    </div>
  );
}
