/**
 * AI 回答卡在正文里的落位。
 *
 * **「生成新内容」和「改写已有文字」是两件事，呈现方式也必须是两种。**
 *
 * - 改写已有文字（润色 / 纠错 / 缩写 / 扩写）→ 就地画 diff，看的是「改完的样子」。
 * - 生成新内容、回答问题（空行的自由指令、续写、想一想、选区上的自由指令）
 *   → **进卡片**，正文一个字都不动。
 *
 * 上一版把后者也塞进了 diff：于是「选中一段问它这段在讲什么」会变成一次改写，
 * 答案直接顶掉了用户的原文。那不是同一件事，不该长成同一个样子。
 *
 * 卡片是**块级 widget**（不是浮层）：它像一个真的段落一样把后面的正文推下去。
 * 浮层会盖住下一段，而这张卡要停留到用户做决定为止，盖着读不了。
 */
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

export const setInlineAnswer = StateEffect.define();
export const clearInlineAnswer = StateEffect.define();

class AnswerHost extends WidgetType {
  constructor(id) {
    super();
    this.id = id;
  }
  eq(other) {
    return other.id === this.id;
  }
  toDOM() {
    const host = document.createElement("div");
    host.className = "cm-inline-answer-host";
    host.dataset.answerHost = this.id;
    return host;
  }
  ignoreEvent() {
    return true;
  }
}

function decorations(active) {
  if (!active) return Decoration.none;
  const ranges = [
    Decoration.widget({ widget: new AnswerHost(active.id), block: true, side: 1 }).range(active.at),
  ];
  /**
   * 提问所依据的那段选区保持一个浅灰底（Notion 图 58 的做法）。
   *
   * 选区高亮本身在失焦后就淡掉了，而这张卡还开着——不留个记号的话，
   * 读完答案已经想不起来「它回答的是哪一段」。
   */
  if (active.from !== undefined && active.to !== undefined && active.from < active.to) {
    ranges.unshift(Decoration.mark({ class: "cm-answer-source" }).range(active.from, active.to));
  }
  return Decoration.set(ranges, true);
}

export const inlineAnswerField = StateField.define({
  create() {
    return { active: null, deco: Decoration.none };
  },
  update(value, tr) {
    let active = value.active;
    if (tr.docChanged && active) {
      active = {
        ...active,
        at: tr.changes.mapPos(active.at, 1),
        ...(active.from === undefined ? {} : { from: tr.changes.mapPos(active.from, -1), to: tr.changes.mapPos(active.to, 1) }),
      };
    }
    for (const effect of tr.effects) {
      if (effect.is(setInlineAnswer)) active = effect.value;
      if (effect.is(clearInlineAnswer)) active = null;
    }
    if (active === value.active) return value;
    return { active, deco: decorations(active) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
});

export const inlineAnswerExtension = [inlineAnswerField];
