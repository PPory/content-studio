/**
 * 初稿里的【待补：……】（2026-09-24，选题流程）。
 *
 * AI 起稿时缺的材料不编，写成【待补：具体缺什么】。这里只把它染成浅橙色，让人一眼看出还有几处空着；
 * 文档一个字节不变——补上之后删掉这几个字就行。点一下交给外面（回到选题流程的「补齐」）。
 */
import { Decoration, EditorView, MatchDecorator, ViewPlugin } from "@codemirror/view";

const matcher = new MatchDecorator({
  regexp: /【待补[:：][^】\n]*】/g,
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
      click(event) {
        if (!onGapClick || !event.target?.closest?.(".cm-gap")) return false;
        onGapClick();
        return false;
      },
    }),
  ];
}
