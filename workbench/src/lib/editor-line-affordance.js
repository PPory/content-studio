/**
 * 光标那一行的两个提示：**空行灰字**和左边的 `+`。
 *
 * 这是这一轮最重要的一条：**入口要长在光标所在的那一行上，不能长在用户的记忆里。**
 * 上一版唤起内联 AI 只有 `Alt+Enter`，界面上没有任何字提到它——功能在，但没人会用。
 *
 * 空行上那一行灰字（「按空格问 AI · 按 / 插入」）就是整个 AI 功能的说明书，
 * 而且**只在它有用的那一刻出现**：光标在这一行、这一行是空的、这份文档能写。
 * 有字的行不挂，因为那时候空格和 `/` 都是普通字符。
 *
 * ⚠️ 两个提示都是**绝对定位**的：灰字压在空行上不能占位（否则光标会被顶到它后面），
 * `+` 落在左边的空当里（`.cm-content` 为此留了 `padding-left`）。参见 styles.css 的
 * `.cm-line-affordance`。
 */
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { textRevisionField } from "./editor-text-revisions.js";

/** 这份文档能不能写。只读的 Reading 文档不该看到「按空格问 AI」。 */
export const setLineAffordance = StateEffect.define();

/** `+` 被点了。MarkdownEditor 在编辑器容器上收这个事件，然后开块菜单。 */
export const BLOCK_MENU_EVENT = "workbench-block-menu";

class LineAffordance extends WidgetType {
  constructor({ empty, canWrite, pos }) {
    super();
    this.empty = empty;
    this.canWrite = canWrite;
    this.pos = pos;
  }
  eq(other) {
    return other.empty === this.empty && other.canWrite === this.canWrite;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-line-affordance";
    wrap.setAttribute("aria-hidden", "true");

    const add = document.createElement("button");
    add.type = "button";
    add.className = "cm-line-affordance__add";
    add.tabIndex = -1;
    add.title = "插入区块";
    add.dataset.lineAdd = "true";
    add.textContent = "+";
    // pointerdown 而不是 click：click 之前编辑器会先处理一次失焦，菜单的锚点就跑了
    add.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      wrap.dispatchEvent(new CustomEvent(BLOCK_MENU_EVENT, { bubbles: true, detail: { pos: this.pos } }));
    });
    wrap.append(add);

    if (this.empty) {
      const hint = document.createElement("span");
      hint.className = "cm-line-affordance__hint";
      hint.textContent = this.canWrite ? "按 space（空格）以启用 AI，或按 “/” 启用命令" : "按 “/” 启用命令";
      wrap.append(hint);
    }
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

function decorate(state, canWrite) {
  const range = state.selection.main;
  if (!range.empty) return Decoration.none;
  /**
   * ⚠️ **正在审阅候选时整个不画。**
   *
   * 插入型候选（续写）在文档里是**零宽 widget**——采纳前正文一个字节都没改，
   * 所以那一行的 `line.text.length` 仍然是 0，而屏幕上它已经满满一段字了。
   * 不加这一条的话，「按 space…」那句灰字会直接压在生成出来的文字上面。
   */
  if (state.field(textRevisionField, false)?.active) return Decoration.none;
  const line = state.doc.lineAt(range.head);
  const empty = line.text.length === 0;
  return Decoration.set([
    /**
     * ⚠️ **光标的高度是行高画的，改不了；但空行的行高可以压。**
     *
     * 原生光标的高度等于所在行的行框高度，CSS 管不到它。正文行高 1.65 是为了自动换行
     * 之后段内读着不挤——**而空行没有第二行**，那份行距在这儿一点用都没有，
     * 只是把光标拉成一根比字还高的竖条。
     *
     * 所以只对空行把行高压到贴着字，多出来的高度用 padding 补回来：
     * 总高度一个像素都没变（不会因为光标移进移出而抖动），而光标变回了字的高度。
     * 「padding 不抬光标、行高会」是这个编辑器里第二次用到的同一条。
     */
    ...(empty ? [Decoration.line({ class: "cm-empty-caret-line" }).range(line.from)] : []),
    Decoration.widget({
      widget: new LineAffordance({ empty, canWrite, pos: line.from }),
      side: -1,
    }).range(line.from),
  ], true);
}

export const lineAffordanceField = StateField.define({
  create(state) {
    return { canWrite: false, deco: decorate(state, false) };
  },
  update(value, tr) {
    let canWrite = value.canWrite;
    for (const effect of tr.effects) if (effect.is(setLineAffordance)) canWrite = Boolean(effect.value);
    const revisionChanged = tr.startState.field(textRevisionField, false)?.active !== tr.state.field(textRevisionField, false)?.active;
    if (!tr.docChanged && !tr.selection && !revisionChanged && canWrite === value.canWrite) return value;
    return { canWrite, deco: decorate(tr.state, canWrite) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
});

/**
 * 空行上的空格是不是该被劫持成「问 AI」。
 *
 * 判据收得很紧，因为空格是中文输入里最常按的键：
 * - 这一行必须**完全是空的**（有一个字符都不算），
 * - 光标必须**没有选区**，
 * - 不能在输入法组合中（组合中的空格是选词键）。
 *
 * 第三条在空行上其实自动成立——要起组合得先有字母，而有字母这一行就不空了。
 * 仍然显式判一次：这条判据将来会被复制到别处，写清楚比省两行重要。
 */
export function shouldOpenInlineAiOnSpace(state, { composing = false, canWrite = true } = {}) {
  if (composing || !canWrite) return false;
  const range = state.selection.main;
  if (!range.empty) return false;
  return state.doc.lineAt(range.head).text.length === 0;
}

/**
 * `/` 是不是该开块菜单。
 *
 * 判据是**反过来写的**：默认开，只挡会误伤的那几种前一个字符。
 *
 * ⚠️ 上一版是「只在行首或空白之后开」，太紧了——中文正文里一句话以「。」结尾，
 * 紧接着敲 `/` 是最常见的用法，而那时候菜单不出来，看着就是这个功能坏了。
 *
 * 现在挡的是 ASCII 字母、数字、`/` 和 `:`，正好覆盖
 * `https://`、`2026/08/28`、`and/or` 这三类不该弹菜单的地方；
 * 行首、空白、中文字和中文标点后面一律开。
 */
const SLASH_BLOCKED_BEFORE = /[A-Za-z0-9/:]/;

export function shouldOpenBlockMenuOnSlash(state) {
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const before = line.text.slice(0, range.head - line.from);
  if (!before.length) return true;
  return !SLASH_BLOCKED_BEFORE.test(before.at(-1));
}

/**
 * `/` 之后用户继续在正文里打的那几个字，就是块菜单的过滤词。
 *
 * 只有一个文本光标——菜单不另开输入框（那样屏幕上会同时有两个插入点）。
 * 中间一出现空白或换行就返回 null，调用方据此关掉菜单：那时候用户显然是在写正文。
 */
export function blockMenuQuery(state, slashFrom) {
  const range = state.selection.main;
  if (!range.empty || range.head < slashFrom) return null;
  const text = state.sliceDoc(slashFrom, range.head);
  return /[\s\n]/.test(text) ? null : text;
}
