import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

export const startTextRevision = StateEffect.define();
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

function decorations(active) {
  if (!active || active.from >= active.to) return Decoration.none;
  return Decoration.set([
    Decoration.mark({ class: "cm-text-revision-original", attributes: { "data-revision-original": active.id } }).range(active.from, active.to),
    Decoration.widget({ widget: new RevisionHost(active.id), block: true, side: 1 }).range(active.to),
  ], true);
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
      if (effect.is(startTextRevision)) active = effect.value;
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
