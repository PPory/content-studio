/**
 * 修订对比的编辑器态：**在正文原位置画 diff，而不是在旁边并排两个版本。**
 *
 * 上一版是「整段划掉 + 下方一个 textarea 装新文本」。问题出在信息单位上：用户要判断的是
 * 「这个改动好不好」，而界面给的是「这里有两坨字，你自己比」。一段 800 字的改写里换了三处
 * 措辞，并排读根本读不出来，只能整段重读两遍。
 *
 * 现在原文里只有**真正被删掉的字**带删除线，新增的字就地插在它该在的位置——一眼读下去
 * 就是改完之后的文章。
 *
 * ⚠️ **新增只能是 widget。** 采纳之前正文一个字节都不能改（这是产品硬约束），所以
 * `ins` 在文档里没有对应区间，只能用零宽 widget 挂在那个位置上；`del` 才是真区间，用 mark。
 * 这条决定了下面 `decorations()` 为什么要一边走 parts 一边自己累加位置。
 */
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

export const startTextRevision = StateEffect.define();
export const setTextRevisionDiff = StateEffect.define();
export const clearTextRevision = StateEffect.define();

class RevisionHost extends WidgetType {
  constructor(id) {
    super();
    this.id = id;
  }
  eq(other) {
    return other.id === this.id;
  }
  toDOM() {
    const host = document.createElement("div");
    host.className = "cm-text-revision-host";
    host.dataset.revisionHost = this.id;
    return host;
  }
  ignoreEvent() {
    return true;
  }
}

/** 新增的字。零宽挂在原文位置上，不进文档。 */
class InsertedText extends WidgetType {
  constructor(text, id) {
    super();
    this.text = text;
    this.id = id;
  }
  eq(other) {
    return other.text === this.text && other.id === this.id;
  }
  toDOM() {
    const node = document.createElement("span");
    node.className = "cm-diff-ins";
    node.dataset.revisionIns = this.id;
    node.textContent = this.text;
    return node;
  }
  ignoreEvent() {
    return true;
  }
}

function decorations(active) {
  if (!active || active.from > active.to) return Decoration.none;
  const ranges = [Decoration.widget({ widget: new RevisionHost(active.id), block: true, side: 1 }).range(active.to)];

  // 还没有 diff（正在生成）时退回整段划掉：这时候「改成什么」还没定，
  // 逐字上色会跟着流式输出每几十毫秒重排一次，读起来是花屏。
  if (!active.parts?.length) {
    if (active.from < active.to) {
      ranges.unshift(Decoration.mark({
        class: "cm-text-revision-original",
        attributes: { "data-revision-original": active.id },
      }).range(active.from, active.to));
    }
    return Decoration.set(ranges, true);
  }

  let pos = active.from;
  for (const part of active.parts) {
    if (part.type === "ins") {
      // 落在区间末尾时贴着后面（side 1），其余贴在当前位置——都在被保护的区间内，位置稳定
      ranges.push(Decoration.widget({ widget: new InsertedText(part.text, active.id), side: 1 }).range(Math.min(pos, active.to)));
      continue;
    }
    const end = Math.min(pos + part.text.length, active.to);
    if (part.type === "del" && pos < end) {
      ranges.push(Decoration.mark({
        class: "cm-diff-del",
        attributes: { "data-revision-original": active.id },
      }).range(pos, end));
    }
    pos = end;
  }
  return Decoration.set(ranges, true);
}

export const textRevisionField = StateField.define({
  create() {
    return { active: null, deco: Decoration.none };
  },
  update(value, tr) {
    let active = value.active;
    if (tr.docChanged && active) {
      active = {
        ...active,
        from: tr.changes.mapPos(active.from, -1),
        to: tr.changes.mapPos(active.to, 1),
      };
    }
    for (const effect of tr.effects) {
      if (effect.is(startTextRevision)) active = { parts: null, ...effect.value };
      if (effect.is(setTextRevisionDiff) && active?.id === effect.value.id) active = { ...active, parts: effect.value.parts };
      if (effect.is(clearTextRevision)) active = null;
    }
    if (active === value.active) return value;
    return { active, deco: decorations(active) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
});

/** 对比期间原文是冻结的；正文其他位置仍可继续写，区间会自动跟着移动。 */
const protectOriginal = EditorState.transactionFilter.of((tr) => {
  const active = tr.startState.field(textRevisionField, false)?.active;
  if (!active || !tr.docChanged || tr.effects.some((effect) => effect.is(clearTextRevision))) return tr;
  let overlaps = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if ((fromA < active.to && toA > active.from) || (fromA === toA && fromA > active.from && fromA < active.to)) overlaps = true;
  });
  return overlaps ? [] : tr;
});

export const textRevisionExtension = [textRevisionField, protectOriginal];
