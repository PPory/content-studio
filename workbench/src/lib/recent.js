/**
 * 最近打开过什么。存 localStorage。
 *
 * 和阅读进度、书签同一类：**这是「这台机器上这个人干到哪了」的导航状态，不是内容**，
 * 所以不违反「工作台无状态」那条红线（那条管的是内容）。丢了最坏就是回想一下。
 *
 * 为什么需要它：`最近修改` 是 Notion 那边的时间戳，回答的是「哪条被动过」；
 * 而「我上次在看什么」只有这台机器知道——你可能只是读了一遍没改任何东西，
 * 那条恰恰是最该能一键回去的。
 */

/**
 * ⚠️ v1 → v2：v1 存下来的记录**没有 `go.open`**，点回去只跳到列表页而不打开那一篇。
 * 一行看着一模一样、行为却不一样，是最难查的那种毛病——所以换个键让旧记录整批失效，
 * 代价只是「最近打开」空一次，下次打开什么就有什么。
 */
const KEY = "workbench:recent:v2";
const MAX = 24;

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    return Array.isArray(raw?.list) ? raw.list : [];
  } catch {
    return [];
  }
}

export function recentOpened(n = 8) {
  return read().slice(0, n);
}

/**
 * 记一条。`go` 是「怎么回到这儿」——**存的是动作不是位置**：
 * 只存标题的话，点回去还得自己想它在哪个页面，那就等于没记。
 *
 * 同一条再打开时提到最前面（按 id 去重），不留两行一模一样的。
 */
export function noteOpened({ id, type, typeLabel, title, source = "", go }) {
  if (!id || !title) return;
  try {
    const list = read().filter((x) => x.id !== id);
    list.unshift({ id, type, typeLabel, title, source, go, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify({ version: 1, list: list.slice(0, MAX) }));
  } catch {
    /* 隐私模式下写不了；记不住最近打开不该让阅读区报错 */
  }
}

// ---- 上次搜过什么 -----------------------------------------------------------

const Q_KEY = "workbench:recent-queries:v1";
const Q_MAX = 8;

export function recentQueries() {
  try {
    const raw = JSON.parse(localStorage.getItem(Q_KEY) || "null");
    return Array.isArray(raw?.list) ? raw.list : [];
  } catch {
    return [];
  }
}

export function noteQuery(q) {
  const s = String(q || "").trim();
  if (s.length < 2) return; // 一个字的查询记下来没有意义，只会把真正搜过的挤掉
  try {
    const list = recentQueries().filter((x) => x !== s);
    list.unshift(s);
    localStorage.setItem(Q_KEY, JSON.stringify({ version: 1, list: list.slice(0, Q_MAX) }));
  } catch {
    /* 同上 */
  }
}
