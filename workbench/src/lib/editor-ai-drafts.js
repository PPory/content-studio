/**
 * AI 续写的编辑态：底纹只存在于编辑器里，不写进 Markdown。
 *
 * 原稿和当前位置一起保存在 CodeMirror state 中。用户在这段里增删文字时，区间会跟着
 * 变化；点击采用只撤掉 decoration，原稿仍留在本次编辑的历史里供回看。
 */
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export const addAiDraft = StateEffect.define();
export const confirmAiDraft = StateEffect.define();

function decorationsOf(items) {
  const ranges = items
    .filter((item) => !item.confirmed && item.from < item.to)
    .map((item) => Decoration.mark({
      class: "cm-ai-draft",
      attributes: { "data-ai-draft": item.id },
    }).range(item.from, item.to));
  return Decoration.set(ranges, true);
}

export const aiDraftField = StateField.define({
  create() {
    return { items: [], deco: Decoration.none };
  },
  update(value, tr) {
    const hasEffect = tr.effects.some((effect) => effect.is(addAiDraft) || effect.is(confirmAiDraft));
    if (!hasEffect && (!tr.docChanged || !value.items.length)) return value;

    let items = tr.docChanged
      ? value.items.map((item) => {
          const from = tr.changes.mapPos(item.from, -1);
          const to = tr.changes.mapPos(item.to, 1);
          return {
            ...item,
            // 两端输入都算作对这段续写的修改，让底纹自然包住用户正在改的文字。
            from,
            to,
            // 整段删掉（包括 Ctrl+Z 撤回插入）时不再留一条无内容的“待确认”。
            confirmed: item.confirmed || from === to,
            removed: item.removed || from === to,
          };
        })
      : value.items;

    for (const effect of tr.effects) {
      if (effect.is(addAiDraft)) {
        items = [...items, { ...effect.value, confirmed: false }];
      } else if (effect.is(confirmAiDraft)) {
        items = items.map((item) => item.id === effect.value ? { ...item, confirmed: true } : item);
      }
    }
    return { items, deco: decorationsOf(items) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
});

const aiDraftTheme = EditorView.theme({
  ".cm-ai-draft": {
    backgroundColor: "var(--ai-draft-wash)",
    boxShadow: "inset 0 -1px 0 var(--ai-draft-line)",
    borderRadius: "3px",
    transition: "background-color .14s, box-shadow .14s",
  },
  ".cm-ai-draft:hover": {
    backgroundColor: "var(--ai-draft-wash-strong)",
  },
});

export const aiDraftExtension = [aiDraftField, aiDraftTheme];
