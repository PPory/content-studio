// 读到哪儿了。存 localStorage，不进 vault。
//
// 为什么不写进 vault：进度是**这台机器上这个浏览器**的状态，不是知识。写进 vault 会
// 让每次滚动都产生一次文件改动，Obsidian 的同步和 git 记录会被这种噪音淹掉。
// 丢了也无所谓——最坏情况是重新翻到那一章。

const KEY = "workbench:reading:v1";
const MAX = 120; // 记住最近这么多本，再多就把最旧的挤掉

/**
 * 数字数。中文按**非空白字符**数算，不按词——`split(/\s+/)` 在中文上
 * 会把一整段算成一个词。
 *
 * **口径只写这一处**：阅读区左栏、洞察卡片、创作编辑器底部的实时字数都从它出去，
 * 各写一份的话同一篇文档会在两个地方显示两个数。传字符串会自己数，传数字就是
 * 已经数好的（洞察清单在服务端数完再给）。
 */
export function countWords(text) {
  return typeof text === "number" ? text : String(text || "").replace(/\s/g, "").length;
}

/**
 * 字数 / 预计读完。400 字/分钟是中文默读的常见口径，取整到分钟就够。
 *
 * 太短的（一句话素材卡）返回 null——给它报「预计 1 分钟」只是噪音。
 * **要的只是字数本身就直接用 `countWords`**，别为了绕开这条 80 字下限而另数一遍。
 */
export function readStats(text) {
  const words = countWords(text);
  if (words < 80) return null;
  return { words, minutes: Math.max(1, Math.round(words / 400)) };
}

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    return raw && typeof raw.books === "object" ? raw.books : {};
  } catch {
    return {};
  }
}

export function loadReading() {
  return read();
}

export function readingOf(bookDir) {
  return read()[bookDir] || null;
}

/**
 * 记一条进度。
 * `progress` 是**本章**读了多少，不是整本——整本进度要靠字数加权，
 * 而 59 章的书里各章长短差十倍，算出来的百分比反而误导。
 */
export function saveReading(bookDir, { docPath, title, scrollTop = 0, progress = 0 }) {
  if (!bookDir || !docPath) return;
  try {
    const books = read();
    books[bookDir] = {
      docPath,
      title: title || "",
      scrollTop: Math.max(0, scrollTop),
      progress: Math.min(1, Math.max(0, progress)),
      updatedAt: Date.now(),
    };
    const trimmed = Object.fromEntries(
      Object.entries(books)
        .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
        .slice(0, MAX)
    );
    localStorage.setItem(KEY, JSON.stringify({ version: 1, books: trimmed }));
  } catch {
    /* 隐私模式下 localStorage 会抛，读书不该因为记不住进度而报错 */
  }
}

/** 最近在读的那本。书架顶部的「继续阅读」用它。 */
export function latestReading(books) {
  return recentReadings(books, 1)[0] || null;
}

/**
 * 最近在读的前 n 本，新的在前。总览那格「接着读」用它。
 *
 * **有几本给几本，不凑数**：只读过一本时就只显示一本，剩下的空着。拿书架上没动过的书
 * 去填那块空白，等于把「你正在读这些」变成「书架上有这些」——后者书架页自己就是。
 */
export function recentReadings(books, n = 2) {
  const all = read();
  return (books || [])
    .map((book) => ({ book, reading: all[book.dir] }))
    .filter((x) => x.reading)
    .sort((a, b) => (b.reading.updatedAt || 0) - (a.reading.updatedAt || 0))
    .slice(0, n);
}

/**
 * 上次读的是哪一份文档（章节 / 单篇书的正文）。
 *
 * 抽出来是因为两处都要：书架顶部的「继续阅读」卡，和总览那条「接着读」。
 * **进度指的那份文件可能已经不在这本书里了**（书重新导入过），那时候返回 null——
 * 宁可不显示，也不能给一个点了打不开的入口。
 */
export function resumeEntry(book, reading) {
  if (!book || !reading) return null;
  return (
    book.chapters?.find((c) => c.path === reading.docPath) ||
    (reading.docPath === book.bookPath ? { path: book.bookPath, title: book.name, order: 1 } : null)
  );
}

export function pct(p) {
  return `${Math.round(Math.min(1, Math.max(0, p || 0)) * 100)}%`;
}

/**
 * 整本读到哪儿了 = （读完的章数 + 当前这章的进度）/ 总章数。
 *
 * **按章数算，不按字数加权。** 加权更"准"，但准得没用：各章长短差十倍时，读完
 * 三个短章会显示 4%，人的直觉是「我读了三章了」。这个数字是给人看的，不是给统计用的。
 */
export function bookProgress(book, reading) {
  const chapters = book?.chapters || [];
  if (!reading) return 0;
  if (!chapters.length) return reading.progress || 0;   // 单篇书就是本篇进度
  const i = chapters.findIndex((c) => c.path === reading.docPath);
  if (i === -1) return 0;
  return Math.min(1, (i + (reading.progress || 0)) / chapters.length);
}

// ---- 书签 ------------------------------------------------------------------

/**
 * 书签存 localStorage，**不进 vault**。
 *
 * 和阅读进度同一条理由：它是导航状态不是知识。高亮和批注是你对内容说了什么，
 * 值得进 vault、值得被 Obsidian 搜到；书签只是「等会儿再回这儿」，
 * 写进 vault 只会让每次点一下都产生一次文件改动。
 */
const BM_KEY = "workbench:bookmarks:v1";

function readBookmarks() {
  try {
    const raw = JSON.parse(localStorage.getItem(BM_KEY) || "null");
    return Array.isArray(raw?.list) ? raw.list : [];
  } catch {
    return [];
  }
}

export function bookmarksOf(bookDir) {
  return readBookmarks().filter((b) => b.dir === bookDir);
}

export function isBookmarked(docPath) {
  return readBookmarks().some((b) => b.docPath === docPath);
}

export function toggleBookmark(bookDir, docPath, title) {
  const list = readBookmarks();
  const i = list.findIndex((b) => b.docPath === docPath);
  const next = i >= 0 ? list.filter((_, k) => k !== i) : [...list, { dir: bookDir, docPath, title, at: Date.now() }];
  try {
    localStorage.setItem(BM_KEY, JSON.stringify({ version: 1, list: next.slice(-300) }));
  } catch {
    /* 隐私模式下写不了 */
  }
  return i < 0;
}

/**
 * 取选中处**前后各一段原文**当上下文喂给 AI。
 *
 * 只给孤零零一句话，模型只能泛泛而谈——它不知道这句在讲什么的上下文里。
 * 找不到就退回开头一段：那也比没有强。
 *
 * **三份合成一份。** 原来 `pages/Shelf.jsx`、`pages/Studio.jsx` 各有一份逐字相同的，
 * `components/Reader.jsx` 里还有一份写法略不同的（少一层 `String()` 兜底）。
 * 放 `lib/` 不放 `components/`：页面和组件两边都要用，而 components 引 pages 是把层反了
 * （和 `readStats` 同一条理由）。
 */
export function contextOf(content, text) {
  const src = String(content || "");
  const i = src.indexOf(text);
  if (i === -1) return src.slice(0, 1200);
  return src.slice(Math.max(0, i - 600), i + text.length + 600);
}
