/**
 * 实时预览：**Markdown 记号始终隐去，正文始终保持排版后的样子。**
 *
 * 这是“所见即源码”编辑器一直缺的那一块——
 * 上一版靠一颗「预览」按钮在「能改但难看」和「好看但不能改」之间切，
 * 而**一个「看排版后的样子」的开关，等于承认平时看的不是那个样子**。
 *
 * ⚠️ **文档本身一个字节都没变。** 隐藏是 `Decoration.replace`（把 `#`、`**` 那几个字符
 * 换成零宽），渲染是 widget。存回去的仍然是原字节的 Markdown——`[[双链]]`、脚注、
 * `> [!note]` 这类扩展语法不会被任何一次「保存」重写。这条是这个编辑器
 * 选 CodeMirror 而不是富文本内核的全部理由，实时预览不能把它换掉。
 *
 * 光标和选区只编辑内容，不再让当前行突然切回源码。格式变化由菜单和快捷键完成。
 */
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { decodeMarkdownPath } from "./markdown-path.js";

/** 图片。`src` 由外面给的 `resolveUrl` 解析——相对路径怎么变成可取的地址不是这一层的事。 */
class ImageWidget extends WidgetType {
  constructor({ url, alt, raw }) {
    super();
    this.url = url;
    this.alt = alt;
    this.raw = raw;
  }
  eq(other) {
    return other.url === this.url && other.alt === this.alt;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-media";
    const kind = mediaKind(this.url);
    if (kind === "video") {
      const video = document.createElement("video");
      video.src = this.url;
      video.controls = true;
      video.preload = "metadata";
      wrap.append(video);
    } else {
      const img = document.createElement("img");
      img.src = this.url;
      img.alt = this.alt || "";
      img.loading = "lazy";
      // 取不到就退回显示原始那行 Markdown——**不要显示一个碎图图标**，
      // 那个图标既不说明发生了什么，也没给下一步
      img.addEventListener("error", () => {
        wrap.textContent = this.raw;
        wrap.dataset.broken = "true";
      });
      wrap.append(img);
    }
    if (this.alt) {
      const caption = document.createElement("small");
      caption.textContent = this.alt;
      wrap.append(caption);
    }
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}


class TodoWidget extends WidgetType {
  constructor({ checked, checkAt }) {
    super();
    this.checked = checked;
    this.checkAt = checkAt;
  }
  eq(other) {
    return other.checked === this.checked && other.checkAt === this.checkAt;
  }
  toDOM(view) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-lp-todo";
    button.setAttribute("role", "checkbox");
    button.setAttribute("aria-checked", String(this.checked));
    button.setAttribute("aria-label", this.checked ? "标记为未完成" : "标记为已完成");
    button.textContent = this.checked ? "✓" : "";
    button.addEventListener("click", () => {
      view.dispatch({ changes: { from: this.checkAt, to: this.checkAt + 1, insert: this.checked ? " " : "x" } });
      view.focus();
    });
    return button;
  }
  ignoreEvent() {
    return true;
  }
}

class CalloutHeaderWidget extends WidgetType {
  constructor(label) {
    super();
    this.label = label;
  }
  eq(other) {
    return other.label === this.label;
  }
  toDOM() {
    const label = document.createElement("span");
    label.className = "cm-lp-callout-label";
    label.textContent = this.label;
    return label;
  }
  ignoreEvent() {
    return true;
  }
}

class CodeLabelWidget extends WidgetType {
  constructor(language = "") {
    super();
    this.language = language;
  }
  eq(other) {
    return other.language === this.language;
  }
  toDOM() {
    const label = document.createElement("span");
    label.className = "cm-lp-code-label";
    label.textContent = this.language || "代码";
    return label;
  }
  ignoreEvent() {
    return true;
  }
}

function splitTableCells(text) {
  const source = String(text || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  let escaped = false;
  for (const char of source) {
    if (char === "|" && !escaped) {
      cells.push(cell.trim().replace(/\\\|/g, "|"));
      cell = "";
      continue;
    }
    if (char === "\\" && !escaped) {
      escaped = true;
      cell += char;
      continue;
    }
    escaped = false;
    cell += char;
  }
  cells.push(cell.trim().replace(/\\\|/g, "|"));
  return cells;
}

function tableBlockAt(doc, lineNumber) {
  if (lineNumber >= doc.lines) return null;
  const headerLine = doc.line(lineNumber);
  const dividerLine = doc.line(lineNumber + 1);
  if (!headerLine.text.includes("|") || !dividerLine.text.includes("|")) return null;
  const headers = splitTableCells(headerLine.text);
  const dividers = splitTableCells(dividerLine.text);
  if (headers.length < 2 || headers.length !== dividers.length || !dividers.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const rows = [headers];
  let lastLine = dividerLine;
  let lastNumber = lineNumber + 1;
  for (let number = lineNumber + 2; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    if (!line.text.includes("|")) break;
    const cells = splitTableCells(line.text);
    if (cells.length < 2) break;
    rows.push(Array.from({ length: headers.length }, (_, index) => cells[index] || ""));
    lastLine = line;
    lastNumber = number;
  }
  if (rows.length === 1) rows.push(headers.map(() => ""));
  return { from: headerLine.from, to: lastLine.to, rows, lastNumber };
}

function escapeTableCell(value) {
  return String(value || "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function tableMarkdown(rows) {
  const width = Math.max(2, ...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => escapeTableCell(row[index])));
  const header = normalized[0] || Array.from({ length: width }, () => "");
  const body = normalized.slice(1);
  return [
    "| " + header.join(" | ") + " |",
    "| " + Array.from({ length: width }, () => "---").join(" | ") + " |",
    ...body.map((row) => "| " + row.join(" | ") + " |"),
  ].join("\n");
}

function tableRowsFromDOM(dom) {
  const rowCount = Number(dom.dataset.rows);
  const columnCount = Number(dom.dataset.columns);
  return Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columnCount }, (_, column) =>
      dom.querySelector('input[data-row="' + row + '"][data-column="' + column + '"]')?.value || ""
    )
  );
}

function writeTable(dom, view, rows) {
  const from = Number(dom.dataset.from);
  const to = Number(dom.dataset.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return;
  view.dispatch({ changes: { from, to, insert: tableMarkdown(rows) } });
}

class TableWidget extends WidgetType {
  constructor({ from, to, rows }) {
    super();
    this.from = from;
    this.to = to;
    this.rows = rows;
  }
  eq(other) {
    return this.from === other.from && this.to === other.to && JSON.stringify(this.rows) === JSON.stringify(other.rows);
  }
  toDOM(view) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-table";
    this.syncMeta(wrap);
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    this.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      row.forEach((value, columnIndex) => {
        const cell = document.createElement(rowIndex === 0 ? "th" : "td");
        const input = document.createElement("input");
        input.type = "text";
        input.value = value;
        input.dataset.row = String(rowIndex);
        input.dataset.column = String(columnIndex);
        input.setAttribute("aria-label", (rowIndex === 0 ? "表头" : "第 " + rowIndex + " 行") + "，第 " + (columnIndex + 1) + " 列");
        input.addEventListener("input", () => writeTable(wrap, view, tableRowsFromDOM(wrap)));
        cell.append(input);
        tr.append(cell);
      });
      body.append(tr);
    });
    table.append(body);
    wrap.append(table);

    const controls = document.createElement("div");
    controls.className = "cm-lp-table__controls";
    const addRow = document.createElement("button");
    addRow.type = "button";
    addRow.textContent = "+ 添加一行";
    addRow.addEventListener("click", () => {
      const rows = tableRowsFromDOM(wrap);
      rows.push(Array.from({ length: Number(wrap.dataset.columns) }, () => ""));
      writeTable(wrap, view, rows);
      requestAnimationFrame(() => view.dom.querySelectorAll(".cm-lp-table input")[rows.length * rows[0].length - rows[0].length]?.focus());
    });
    const addColumn = document.createElement("button");
    addColumn.type = "button";
    addColumn.textContent = "+ 添加一列";
    addColumn.addEventListener("click", () => {
      const rows = tableRowsFromDOM(wrap).map((row) => [...row, ""]);
      writeTable(wrap, view, rows);
      requestAnimationFrame(() => view.dom.querySelector(".cm-lp-table th:last-child input")?.focus());
    });
    controls.append(addRow, addColumn);
    wrap.append(controls);
    return wrap;
  }
  updateDOM(dom) {
    if (Number(dom.dataset.rows) !== this.rows.length || Number(dom.dataset.columns) !== this.rows[0].length) return false;
    this.syncMeta(dom);
    this.rows.flat().forEach((value, index) => {
      const input = dom.querySelectorAll("input")[index];
      if (input && input !== document.activeElement) input.value = value;
    });
    return true;
  }
  syncMeta(dom) {
    dom.dataset.from = String(this.from);
    dom.dataset.to = String(this.to);
    dom.dataset.rows = String(this.rows.length);
    dom.dataset.columns = String(this.rows[0].length);
  }
  ignoreEvent() {
    return true;
  }
}

const VIDEO_EXT = /\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i;

export function mediaKind(url) {
  return VIDEO_EXT.test(String(url || "")) ? "video" : "image";
}

/**
 * 整行就是一张图（`![alt](src)` 独占一行）时，才换成 widget。
 *
 * ⚠️ **目标里可以有空格。** 上一版写的是 `[^)\s]+`，于是
 * `![](导入目录/附件/x.jpg)` 这种带空格的相对路径**一条都匹配不上**，
 * 现象是正文里只显示那行链接文字。整行必须以 `)` 收尾，所以贪婪匹配到最后一个 `)` 是安全的。
 * `<...>` 是 CommonMark 给「目标里有空格」的正式写法，一并认。
 */
const IMAGE_LINE = /^!\[([^\]]*)\]\(\s*(.+?)\s*\)\s*$/;
const INCOMPLETE_ASSET_IMAGE_LINE = /^!\[([^\]]*)\]\(\s*(asset:\/\/[^\s)]+)\s*$/;
const imageLineOf = (text) => text.match(IMAGE_LINE) || text.match(INCOMPLETE_ASSET_IMAGE_LINE);

/**
 * 行内记号：`**粗**`、`*斜*`、`~~删~~`、`` `码` ``。
 *
 * 用正则而不是语法树：`@codemirror/lang-markdown` 的树里这些标记是
 * `EmphasisMark` / `CodeMark` 节点，遍历更准，但也更容易在嵌套和中文标点边界上
 * 出现「隐了一半」的怪样子。这里只隐**成对且同一行内**的记号，
 * 判不准的一律不隐——**宁可露出记号，也不能让文字缺一块**。
 */
const INLINE_MARKS = [
  { re: /(\*\*)(?=\S)([\s\S]*?\S)(\*\*)/g, cls: "cm-lp-strong" },
  { re: /(~~)(?=\S)([\s\S]*?\S)(~~)/g, cls: "cm-lp-strike" },
  { re: /(`)(?=[^`])([^`\n]*?)(`)/g, cls: "cm-lp-code" },
];

function decorateInlineMarks(builder, line, text) {
  for (const { re, cls } of INLINE_MARKS) {
    re.lastIndex = 0;
    let match = re.exec(text);
    while (match) {
      const start = line.from + match.index;
      const openEnd = start + match[1].length;
      const closeStart = start + match[0].length - match[3].length;
      builder.push(Decoration.replace({}).range(start, openEnd));
      builder.push(Decoration.mark({ class: cls }).range(openEnd, closeStart));
      builder.push(Decoration.replace({}).range(closeStart, start + match[0].length));
      match = re.exec(text);
    }
  }
}

function buildDecorations(view, resolveUrl) {
  const builder = [];
  const atomic = [];
  const doc = view.state.doc;
  let codeFence = null;

  for (let number = 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    const text = line.text;
    const fence = text.match(/^(~~~+|\x60{3,})\s*([A-Za-z0-9_+-]*)\s*$/);

    if (codeFence) {
      if (fence && fence[1][0] === codeFence) {
        const range = Decoration.replace({}).range(line.from, line.to);
        builder.push(Decoration.line({ class: "cm-lp-code-block cm-lp-code-block--last" }).range(line.from));
        builder.push(range);
        atomic.push(range);
        codeFence = null;
      } else {
        builder.push(Decoration.line({ class: "cm-lp-code-block" }).range(line.from));
      }
      continue;
    }

    if (fence) {
      codeFence = fence[1][0];
      const range = Decoration.replace({ widget: new CodeLabelWidget(fence[2]) }).range(line.from, line.to);
      builder.push(Decoration.line({ class: "cm-lp-code-block cm-lp-code-block--first" }).range(line.from));
      builder.push(range);
      atomic.push(range);
      continue;
    }

    const table = tableBlockAt(doc, number);
    if (table) {
      const hostRange = Decoration.replace({
        widget: new TableWidget(table),
        block: false,
      }).range(line.from, line.to);
      builder.push(Decoration.line({ class: "cm-lp-table-host" }).range(line.from));
      builder.push(hostRange);
      atomic.push(hostRange);
      for (let sourceNumber = number + 1; sourceNumber <= table.lastNumber; sourceNumber += 1) {
        const sourceLine = doc.line(sourceNumber);
        const sourceRange = Decoration.replace({}).range(sourceLine.from, sourceLine.to);
        builder.push(Decoration.line({ class: "cm-lp-table-source-hidden" }).range(sourceLine.from));
        builder.push(sourceRange);
        atomic.push(sourceRange);
      }
      number = table.lastNumber;
      continue;
    }
    const callout = text.match(/^>\s*\[!([^\]]+)\]\s*(.*)$/i);
    if (callout) {
      let lastNumber = number;
      while (lastNumber < doc.lines && /^>\s?/.test(doc.line(lastNumber + 1).text)) lastNumber += 1;
      const labels = { note: "标注", tip: "提示", info: "信息", warning: "注意", important: "重要" };
      for (let itemNumber = number; itemNumber <= lastNumber; itemNumber += 1) {
        const itemLine = doc.line(itemNumber);
        const classes = [
          "cm-lp-callout",
          itemNumber === number ? "cm-lp-callout--first" : "",
          itemNumber === lastNumber ? "cm-lp-callout--last" : "",
        ].filter(Boolean).join(" ");
        builder.push(Decoration.line({ class: classes }).range(itemLine.from));
        if (itemNumber === number) {
          const label = callout[2].trim() || labels[callout[1].toLowerCase()] || "标注";
          const range = Decoration.replace({ widget: new CalloutHeaderWidget(label) }).range(itemLine.from, itemLine.to);
          builder.push(range);
          atomic.push(range);
        } else {
          const prefix = itemLine.text.match(/^>\s?/)?.[0] || "";
          if (prefix) {
            const range = Decoration.replace({}).range(itemLine.from, itemLine.from + prefix.length);
            builder.push(range);
            atomic.push(range);
          }
          decorateInlineMarks(builder, itemLine, itemLine.text);
        }
      }
      number = lastNumber;
      continue;
    }

    if (!text) continue;

    const image = imageLineOf(text);
    if (image) {
      const url = resolveUrl(decodeMarkdownPath(image[2]));
      const range = Decoration.replace({
        widget: new ImageWidget({ url, alt: image[1], raw: text }),
        block: false,
      }).range(line.from, line.to);
      builder.push(range);
      atomic.push(range);
      continue;
    }

    if (/^(\s*)(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
      builder.push(Decoration.replace({ widget: new RuleWidget() }).range(line.from, line.to));
      continue;
    }

    const todo = text.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+/);
    if (todo) {
      const checkAt = line.from + text.indexOf("[") + 1;
      const range = Decoration.replace({
        widget: new TodoWidget({ checked: todo[2].toLowerCase() === "x", checkAt }),
      }).range(line.from + todo[1].length, line.from + todo[0].length);
      builder.push(Decoration.line({
        class: "cm-lp-todo-line" + (todo[2].toLowerCase() === "x" ? " is-checked" : ""),
      }).range(line.from));
      builder.push(range);
      atomic.push(range);
      decorateInlineMarks(builder, line, text);
      continue;
    }

    const heading = text.match(/^(#{1,6})\s/);
    if (heading) builder.push(Decoration.replace({}).range(line.from, line.from + heading[0].length));

    const quote = text.match(/^(>\s?)+/);
    if (quote) {
      builder.push(Decoration.replace({}).range(line.from, line.from + quote[0].length));
      builder.push(Decoration.line({ class: "cm-lp-quote" }).range(line.from));
    }

    const bullet = text.match(/^(\s*)([-*+])\s/);
    if (bullet) {
      builder.push(Decoration.replace({ widget: new BulletWidget() }).range(line.from + bullet[1].length, line.from + bullet[0].length));
    }

    decorateInlineMarks(builder, line, text);
  }

  builder.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const set = new RangeSetBuilder();
  for (const range of builder) set.add(range.from, range.to, range.value);
  atomic.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const atomicSet = new RangeSetBuilder();
  for (const range of atomic) atomicSet.add(range.from, range.to, range.value);
  return { decorations: set.finish(), atomic: atomicSet.finish() };
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-lp-rule";
    return rule;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-lp-bullet";
    dot.textContent = "•";
    return dot;
  }
  ignoreEvent() {
    return true;
  }
}

/**
 * `resolveUrl(src)` 把正文里的相对路径变成能取的地址。
 * 编辑器不知道导入源或资产库在哪、也不该知道——这一层只管画。
 */
export function livePreview({ resolveUrl = (src) => src } = {}) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      const built = buildDecorations(view, resolveUrl);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        const built = buildDecorations(update.view, resolveUrl);
        this.decorations = built.decorations;
        this.atomic = built.atomic;
      }
    }
  }, {
    decorations: (value) => value.decorations,
  });
  return [
    plugin,
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic || Decoration.none),
  ];
}
