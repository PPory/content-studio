/**
 * 面板开着的时候，**那段被选中的字要一直看得出来是被选中的**。
 *
 * 浏览器的原生选区高亮**只在拥有选区的那个元素有焦点时才画**。选区面板底下那条
 * 「使用 AI 编辑」是个真的 `<input>`——点进去打字，焦点离开正文，正文里那片黄色
 * 当场消失。屏幕上于是只剩一个浮着的面板和一个输入框，而「我刚才选的是哪一段」
 * 没有任何痕迹：用户正要为那段字写一条指令，却看不到那段字。
 *
 * 修法不是把 `drawSelection()` 装回来——那个扩展会顺带把光标画成整个行框的高度
 * （见 `docs/ai-experience-redesign.md` 九之五第一条），为了解决一个问题换回另一个。
 * 这里只做一件事：**面板开着期间，给那段区间挂一个自己的底色装饰**，
 * 它是文档装饰，和焦点无关。
 *
 * ⚠️ 同时要把原生选区**关掉**。两层都画的话，编辑器还有焦点时那段字被同一个
 * 半透明黄叠了两次，比松开面板之后更深——同一段字在两个时刻是两种颜色，
 * 看着像是状态变了，而其实什么都没变。
 */
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export const setHeldSelection = StateEffect.define();
export const clearHeldSelection = StateEffect.define();

const HELD = Decoration.mark({ class: "cm-held-selection" });

function decorationsOf(active) {
  return active && active.from < active.to
    ? Decoration.set([HELD.range(active.from, active.to)])
    : Decoration.none;
}

export const heldSelectionField = StateField.define({
  create() {
    return { active: null, deco: Decoration.none };
  },
  update(value, tr) {
    let active = value.active;
    // 正文在面板开着时被改（比如格式按钮加粗了这一段），区间跟着走
    if (tr.docChanged && active) {
      active = { from: tr.changes.mapPos(active.from, -1), to: tr.changes.mapPos(active.to, 1) };
    }
    for (const effect of tr.effects) {
      if (effect.is(setHeldSelection)) active = effect.value;
      if (effect.is(clearHeldSelection)) active = null;
    }
    if (active === value.active) return value;
    return { active, deco: decorationsOf(active) };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.deco),
    // 挂在 `.cm-content` 上，供 CSS 关掉这期间的原生选区
    EditorView.contentAttributes.from(field, (value) => value.active ? { class: "cm-selection-held" } : {}),
  ],
});

export const heldSelectionExtension = [heldSelectionField];
