// 构思里「还缺什么」清单的读写（2026-09-24）。
//
// 清单存在构思的 `questions` 文字里，一行一项：`- [ ] 待补的事` / `- [x] 已补的事`。
// 清单以外的文字（旧构思里写的疑问、从知识探索带来的用户问题）原样保留，不改一个字。
// 服务端（列表上的「还缺：…」、情报加入选题时预填）和界面（勾选、增删）共用这一份，判据只写这里。

const ITEM = /^(\s*)[-*]\s+\[( |x|X)\]\s+(.*)$/;

/** @returns {{ items: { index: number, line: number, text: string, done: boolean }[], other: string }} */
export function parseChecklist(text = "") {
  const lines = String(text || "").split("\n");
  const items = [], other = [];
  lines.forEach((line, i) => {
    const m = line.match(ITEM);
    if (m && m[3].trim()) items.push({ index: items.length, line: i, text: m[3].trim(), done: m[2] !== " " });
    else other.push(line);
  });
  return { items, other: other.join("\n").trim() };
}

const itemLine = (text, done = false) => `- [${done ? "x" : " "}] ${String(text).replace(/\s*\n+\s*/g, " ").trim()}`;
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

function rewrite(text, index, change) {
  const lines = String(text || "").split("\n");
  let n = -1;
  const out = [];
  for (const line of lines) {
    const m = line.match(ITEM);
    if (m && m[3].trim() && ++n === index) { const next = change(m[3].trim(), m[2] !== " "); if (next !== null) out.push(next); continue; }
    out.push(line);
  }
  return out.join("\n");
}

export const setItemDone = (text, index, done) => rewrite(text, index, (label) => itemLine(label, done));
export const removeItem = (text, index) => rewrite(text, index, () => null);
export const renameItem = (text, index, label) => rewrite(text, index, (_, done) => label.trim() ? itemLine(label, done) : null);

/** 追加待补项；已有同名项（不论是否勾过）不重复加。 */
export function appendItems(text, labels = []) {
  const current = parseChecklist(text).items;
  const fresh = [];
  for (const raw of labels) {
    const label = String(raw || "").replace(/\s*\n+\s*/g, " ").trim();
    if (label && !current.some((item) => same(item.text, label)) && !fresh.some((x) => same(x, label))) fresh.push(label);
  }
  if (!fresh.length) return String(text || "");
  const base = String(text || "").replace(/\s+$/, "");
  return [base, ...fresh.map((label) => itemLine(label))].filter(Boolean).join("\n");
}

/** 旧选题「未解的问题」转成清单：每个非空行一项，已有的「- 」前缀去掉。 */
export function checklistFromLines(text = "") {
  return appendItems("", String(text || "").split("\n").map((line) => line.replace(/^\s*[-*•]\s*(\[[ xX]\]\s*)?/, "")));
}

/** 还没补的项（列表卡片上的「还缺：…」）。 */
export const openItems = (text) => parseChecklist(text).items.filter((item) => !item.done).map((item) => item.text);
