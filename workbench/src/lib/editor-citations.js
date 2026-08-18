/**
 * 引用标注：正文里的哪一句来自哪条素材。
 *
 * ## 为什么脚标不是正文里的字符
 *
 * 这份正文的成品是发到公众号的**正文本身**。`[^1]` 一旦真的写进文档，用户发布前就得
 * 手动删一遍——留底、导出、复制到公众号编辑器几条路还得各自记得删。所以这里用
 * CodeMirror 的 decoration：**看起来是上标脚注，文档里一个字节都没多**。全选复制出去
 * 是干净的。
 *
 * ## 位置会跟着编辑走，但「还准不准」不装懂
 *
 * `StateField.map` 让区间跟着增删自动挪，所以你在前面插一段字，标注不会错位。
 * 但你**改写了被标注的那一句**时，位置还在、内容已经不是那条素材了——这时把它
 * 标成 `stale`（虚线、问号），而不是继续举着一个可能已经不成立的出处。
 * **宁可显示「我不确定了」，也别显示一个过时的出处。** 要拿准的，点「重新核对」
 * 走一次 `/wb/cite`。
 */

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, hoverTooltip, tooltips } from "@codemirror/view";

/** 换一批标注（起稿完成、或重新核对之后）。传空数组就是全清掉。 */
export const setCitations = StateEffect.define();

/**
 * 此刻在看哪一条素材的哪一处：`{id, seq}`。
 *
 * **两级而不是一级**，因为同一条素材常常在正文里用了好几处。只标「这条素材相关的
 * 都亮起来」的话，点了卡片你还得自己在三处高亮里找刚跳到的是哪一处；只标「就这一处」
 * 的话，又看不出这条素材总共影响了正文的哪些地方。所以同一条的全部标成 `active`
 * （中等），当前这一处再加 `focus`（重）。
 */
export const setCiteFocus = StateEffect.define();

class NumWidget extends WidgetType {
  constructor(num, stale) {
    super();
    this.num = num;
    this.stale = stale;
  }
  eq(other) {
    return other.num === this.num && other.stale === this.stale;
  }
  toDOM() {
    const el = document.createElement("sup");
    el.className = "cm-cite-num";
    el.dataset.stale = String(this.stale);
    el.textContent = this.stale ? `${this.num}?` : String(this.num);
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function decorationsOf(items, doc, focus) {
  const marks = [];
  let seq = 0;
  for (const item of items) {
    if (item.from >= item.to || item.to > doc.length) continue;
    const active = focus?.id === item.id;
    const at = active ? seq++ : -1;
    const attributes = { "data-cite": item.id, "data-stale": String(item.stale) };
    if (active) attributes["data-active"] = "true";
    if (active && at === focus.seq) attributes["data-focus"] = "true";
    marks.push(
      Decoration.mark({ class: "cm-cite", attributes }).range(item.from, item.to),
      Decoration.widget({ widget: new NumWidget(item.num, item.stale), side: 1 }).range(item.to)
    );
  }
  // RangeSet 要求按位置有序，而 mark 和 widget 是交替 push 进去的
  return Decoration.set(marks, true);
}

/** 被改写过的标注不再声称自己准确——判据只有一条：这段文字还是不是当初标的那段。 */
function withStale(items, doc) {
  return items.map((item) => ({
    ...item,
    stale: item.from >= item.to || item.to > doc.length || doc.sliceString(item.from, item.to) !== item.text,
  }));
}

export const citationField = StateField.define({
  create() {
    return { items: [], focus: null, deco: Decoration.none };
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCitations)) {
        const items = withStale(
          (effect.value || []).map((c) => ({ ...c, from: c.start, to: c.end })),
          tr.state.doc
        );
        // 换了一批标注，旧的焦点多半已经不存在了；留着会亮在一个不相干的地方
        return { items, focus: null, deco: decorationsOf(items, tr.state.doc, null) };
      }
      if (effect.is(setCiteFocus)) {
        const focus = effect.value?.id ? { id: effect.value.id, seq: effect.value.seq || 0 } : null;
        return { ...value, focus, deco: decorationsOf(value.items, tr.state.doc, focus) };
      }
    }
    if (!tr.docChanged) return value;
    // 位置跟着编辑挪；`assoc` 取 1/-1 让区间在两端插入时不会莫名其妙地吞掉新字
    const moved = value.items.map((item) => ({
      ...item,
      from: tr.changes.mapPos(item.from, 1),
      to: tr.changes.mapPos(item.to, -1),
    }));
    const items = withStale(moved, tr.state.doc);
    return { ...value, items, deco: decorationsOf(items, tr.state.doc, value.focus) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
});

/** 悬停浮出素材原话。用 CodeMirror 自己的 tooltip 而不是 `title`：原生提示要等一秒才出来。 */
const citationTooltip = hoverTooltip((view, pos) => {
  const hit = view.state.field(citationField).items.find((item) => pos >= item.from && pos <= item.to);
  if (!hit) return null;
  return {
    pos: hit.from,
    end: hit.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-cite-tip";
      const head = document.createElement("div");
      head.className = "cm-cite-tip__head";
      head.textContent = hit.stale ? `素材 ${hit.num} · 这句改过了，出处待核对` : `素材 ${hit.num} · ${hit.label || "原话"}`;
      const body = document.createElement("div");
      body.className = "cm-cite-tip__body";
      body.textContent = hit.quote || "";
      dom.append(head, body);
      return { dom };
    },
  };
});

const citationTheme = EditorView.theme({
  ".cm-cite": {
    backgroundColor: "var(--cite-wash)",
    borderRadius: "2px",
    boxShadow: "inset 0 -1px 0 var(--cite-line)",
    transition: "background-color .12s",
  },
  ".cm-cite:hover": { backgroundColor: "var(--cite-wash-strong)" },
  // 同一条素材的其他几处：跟着亮一档，让「这条素材影响了正文的哪些地方」一眼看全
  ".cm-cite[data-active='true']": { backgroundColor: "var(--cite-wash-strong)" },
  // 当前这一处：加一圈实线。**不能只靠底色深浅区分**——同一条有三处时，
  // 三块深浅相近的蓝里挑出「刚跳到的是哪一块」，等于没定位
  ".cm-cite[data-focus='true']": {
    backgroundColor: "var(--cite-wash-strong)",
    boxShadow: "inset 0 0 0 1.5px var(--cite-line)",
    borderRadius: "3px",
  },
  // 改写过的：底色撤掉，只留一条虚线——「这儿曾经有出处」和「这儿有出处」得看得出区别
  ".cm-cite[data-stale='true']": {
    backgroundColor: "transparent",
    boxShadow: "none",
    borderBottom: "1px dashed var(--border-strong)",
  },
  ".cm-cite-num": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.62em",
    lineHeight: "1",
    verticalAlign: "super",
    fontWeight: "700",
    color: "var(--cite-num)",
    padding: "0 1px 0 2px",
    userSelect: "none",
  },
  ".cm-cite-num[data-stale='true']": { opacity: "0.55" },
  ".cm-cite-tip": {
    maxWidth: "320px",
    padding: "9px 11px",
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--r-ctl, 6px)",
    boxShadow: "0 6px 20px rgba(0,0,0,.12)",
  },
  ".cm-cite-tip__head": {
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    letterSpacing: ".04em",
    color: "var(--text-3)",
    marginBottom: "5px",
  },
  ".cm-cite-tip__body": { fontSize: "13px", lineHeight: "1.65", color: "var(--text-2)" },
});

export const citationExtension = [
  citationField,
  citationTooltip,
  // 弹层用 fixed 定位：编辑器挂在一个会滚动的面板里，默认的绝对定位会被裁成一条缝
  tooltips({ position: "fixed" }),
  citationTheme,
];

/**
 * 从右侧面板点某条素材 → 正文滚到它第 `seq` 处引用（从 0 数，超了就绕回第一处）。
 *
 * **不 `view.focus()`**：点的是右边的卡片，把光标抢进编辑器会让你下一次按方向键
 * 或敲字落在一个没预期的地方。滚过去 + 亮起来就够了，要编辑再自己点进去。
 *
 * @returns {number} 这条素材在正文里一共有几处（0 = 没用上，调用方据此决定要不要给动作）
 */
export function revealCitation(view, materialId, seq = 0) {
  const state = view?.state.field(citationField, false);
  if (!state) return 0;
  const hits = state.items.filter((item) => item.id === materialId);
  if (!hits.length) return 0;
  const hit = hits[((seq % hits.length) + hits.length) % hits.length];
  view.dispatch({
    effects: [
      setCiteFocus.of({ id: materialId, seq: ((seq % hits.length) + hits.length) % hits.length }),
      EditorView.scrollIntoView(hit.from, { y: "center" }),
    ],
  });
  return hits.length;
}

/**
 * 在正文里点了某处 → 记下「是哪条素材的第几处」，右侧据此高亮。
 *
 * **点在没标注的地方就是取消选中**，回 null。这一条不是可有可无的补充：
 * 选中态一旦只能「换到别的」不能「退出」，用户想安静读一遍正文时，
 * 右边永远有一张卡亮着、正文里永远有一处描着框——那是他没法关掉的干扰。
 * 点空白退出，是所有选中态的默认约定。
 */
export function focusCitationAt(view, pos) {
  const state = view?.state.field(citationField, false);
  if (!state) return null;
  const hit = pos == null ? null : state.items.find((item) => pos >= item.from && pos <= item.to);
  if (!hit) {
    // 本来就没选中就别发事务：每点一下正文都推一个空 effect，纯属噪音
    if (state.focus) view.dispatch({ effects: setCiteFocus.of(null) });
    return null;
  }
  const seq = state.items.filter((item) => item.id === hit.id).indexOf(hit);
  view.dispatch({ effects: setCiteFocus.of({ id: hit.id, seq }) });
  return { id: hit.id, seq };
}
