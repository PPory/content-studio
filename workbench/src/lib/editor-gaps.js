/**
 * 初稿里的【待补：……】（2026-09-24，选题流程）。
 *
 * AI 起稿时缺的材料不编，写成【待补：具体缺什么】。这里只把它染成浅橙色，让人一眼看出还有几处空着；
 * 文档一个字节不变——补上之后删掉这几个字就行。点一下交给外面（回到选题流程的「补齐」，并带上缺的是什么）。
 * `jumpToNextGap`：从光标往后找下一处（到底了从头找），选中并滚到中间——「N 处待补」逐处点过去用。
 */
import { Decoration, EditorView, MatchDecorator, ViewPlugin } from "@codemirror/view";

const GAP = /【待补[:：]([^】\n]*)】/g;
const matcher = new MatchDecorator({
  regexp: GAP,
  decoration: Decoration.mark({ class: "cm-gap", attributes: { title: "这里缺材料：点一下去补" } }),
});

const gapPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = matcher.createDeco(view); }
  update(update) { this.decorations = matcher.updateDeco(update, this.decorations); }
}, { decorations: (plugin) => plugin.decorations });

export function gapExtension(onGapClick) {
  return [
    gapPlugin,
    EditorView.domEventHandlers({
      // ⚠️ 用 mousedown 不用 click：按下去时编辑器会改选区、重画这一行，等 click 到的时候那个元素已经不在编辑器里，
      // CodeMirror 会把这次点击当成不是它的而丢掉（先用「N 处待补」选中过一处之后必现）。
      mousedown(event) {
        const el = event.button === 0 ? event.target?.closest?.(".cm-gap") : null;
        if (!onGapClick || !el) return false;
        onGapClick((el.textContent || "").replace(/^【待补[:：]\s*/, "").replace(/】$/, "").trim());
        return false;
      },
    }),
  ];
}

/** 跳到光标后面的下一处【待补】；返回 false 表示正文里一处也没有。 */
export function jumpToNextGap(view) {
  const text = view.state.doc.toString();
  const found = [...text.matchAll(GAP)];
  if (!found.length) return false;
  const head = view.state.selection.main.to;
  const next = found.find((m) => m.index >= head) || found[0];
  view.dispatch({ selection: { anchor: next.index, head: next.index + next[0].length }, effects: EditorView.scrollIntoView(next.index, { y: "center" }) });
  view.focus();
  return true;
}
