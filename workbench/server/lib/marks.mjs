/**
 * 「我在这本书里留下了什么」——把一本书目录下的**高亮**和**批注**聚成一份，按章排。
 *
 * ⚠️ **为什么高亮和批注必须合成一份。**
 * 它们回答的是同一个问题。分成两份的话，界面上就得让人先想「我当时是划的还是写的」
 * 才知道去哪找——而回想起一句话的时候，没有人记得自己当时按的是哪个按钮。
 * 阅读区右栏的「标记」页签早就是这么合的（见 `docs/design-system.md`），
 * 这里只是把同一条规矩搬到书详情和书架上。
 *
 * ⚠️ **两者的落盘位置不一样，这是这个模块存在的全部理由：**
 *   - 高亮：`<章名>.highlights.md`，**一章一个文件**，一行一条（`- [黄] 原文`）
 *   - 批注：`notes.md`，**整本一个文件**，`## 时间戳` 分块
 * 所以「按章聚合」对高亮是天然的、对批注是要现推的：批注块里没有章号，
 * 只能靠它引用的原文去章节文件里找。找不到就归到「未定位」，**不猜**——
 * 猜错的后果是点「跳到原文」跳去了别的章，比不给这个入口更糟。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin, isChapterFile } from "./vault.mjs";
import { parseNotes } from "./notes.mjs";

const HL_COLORS = { 黄: "yellow", 绿: "green", 蓝: "blue", 粉: "pink" };

/** 章节文件名 → 显示用的章名（去掉序号前缀和扩展名） */
const chapterLabel = (name) => name.replace(/\.md$/i, "");

/** 序号前缀（`06 推荐序二…`）用来排序；没有序号的排到最后，但**保持彼此的原顺序** */
const chapterOrder = (name) => {
  const m = name.match(/^\s*(\d+)/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};

const norm = (s) => String(s || "").replace(/\s+/g, "").trim();

/**
 * 读一本书的全部标记。
 *
 * @param root  vault 根
 * @param dir   书目录（相对 vault 根），例如 `99 - 个人工作台/01 - 书架/纳瓦尔宝典`
 * @returns {{ chapters: Array, total: number, highlights: number, notes: number, unplaced: number }}
 */
export async function readBookMarks(root, dir) {
  const abs = safeJoin(root, dir);
  let names;
  try {
    names = (await fs.readdir(abs, { withFileTypes: true })).filter((f) => f.isFile()).map((f) => f.name);
  } catch (e) {
    // 目录不在 = 这本书没了，不是错误：调用方按空处理，界面照实说
    if (e.code === "ENOENT") return { chapters: [], total: 0, highlights: 0, notes: 0, unplaced: 0 };
    throw e;
  }

  // ⚠️ **用 `isChapterFile`，不要在这儿再写一遍判据。**
  // 我第一版自己写了个 `/\.(highlights|notes)\.md$/`，而那个正则要求 `notes` 前面有个点——
  // **目录里正牌的 `notes.md` 漏网，被当成了一章**。这正是 `vault.mjs` 那条注释里
  // 白纸黑字记着的同一个坑，隔了一个模块又踩了一次。判据只写一处，就是它。
  const chapterFiles = names
    .filter(isChapterFile)
    .sort((a, b) => chapterOrder(a) - chapterOrder(b) || a.localeCompare(b, "zh"));

  // ── 1. 高亮：一章一个伴生文件 ──
  const byChapter = new Map();
  for (const file of chapterFiles) {
    const hlName = file.replace(/\.md$/i, ".highlights.md");
    if (!names.includes(hlName)) continue;
    let text = "";
    try {
      text = await fs.readFile(path.join(abs, hlName), "utf8");
    } catch {
      continue;
    }
    const items = text
      .split("\n")
      .map((line) => line.match(/^- \[(.)\]\s+(.+)$/))
      .filter(Boolean)
      .map((m, i) => ({
        kind: "highlight",
        id: `${file}#h${i}`,
        color: HL_COLORS[m[1]] || "yellow",
        quote: m[2].trim(),
        note: "",
        // 高亮文件里没有时间——它不是遗漏，是这个格式本来就不记。
        // **不要伪造一个**（比如拿文件 mtime 当每条的时间）：一整份文件同一个时间戳，
        // 排出来的顺序看着像真的，其实是假的。
        at: "",
      }))
      .filter((h) => h.quote);
    if (items.length) byChapter.set(file, items);
  }

  // ── 2. 批注：整本一个 notes.md，靠引用的原文反查它属于哪一章 ──
  let noteBlocks = [];
  if (names.includes("notes.md")) {
    try {
      noteBlocks = parseNotes(await fs.readFile(path.join(abs, "notes.md"), "utf8"));
    } catch {
      noteBlocks = [];
    }
  }

  // 反查要读章节正文。**只读有批注时才读**：没有批注的书一个文件都不用打开。
  let bodies = null;
  const loadBodies = async () => {
    if (bodies) return bodies;
    bodies = new Map();
    for (const file of chapterFiles) {
      try {
        bodies.set(file, norm(await fs.readFile(path.join(abs, file), "utf8")));
      } catch {
        /* 读不了就当这一章不参与反查，不让整批挂掉 */
      }
    }
    return bodies;
  };

  const unplacedList = [];
  for (const [i, b] of noteBlocks.entries()) {
    const quote = String(b.quote || "").trim();
    const item = {
      kind: "note",
      id: `notes#${i}`,
      color: "",
      quote,
      note: String(b.body || "").trim(),
      at: String(b.stamp || "").trim(),
    };
    let placed = "";
    if (quote.length >= 6) {
      const needle = norm(quote);
      const map = await loadBodies();
      for (const [file, body] of map) {
        if (body.includes(needle)) {
          placed = file;
          break;
        }
      }
    }
    if (placed) {
      if (!byChapter.has(placed)) byChapter.set(placed, []);
      byChapter.get(placed).push(item);
    } else {
      // ⚠️ **定位不到就说定位不到，不猜。** 猜错的后果是「跳到原文」跳去别的章，
      // 比不给这个入口更糟。
      unplacedList.push(item);
    }
  }

  const chapters = chapterFiles
    .filter((f) => byChapter.has(f))
    .map((f) => ({
      file: f,
      path: `${dir}/${f}`,
      label: chapterLabel(f),
      items: byChapter.get(f),
    }));

  if (unplacedList.length) {
    chapters.push({ file: "", path: "", label: "未定位到章节", items: unplacedList });
  }

  const all = chapters.flatMap((c) => c.items);
  return {
    chapters,
    total: all.length,
    highlights: all.filter((x) => x.kind === "highlight").length,
    notes: all.filter((x) => x.kind === "note").length,
    unplaced: unplacedList.length,
  };
}

/**
 * 跨书的「最近标注」——书架右栏那一条。
 *
 * ⚠️ **只有批注排得出时间，高亮排不出**（高亮文件不记时间，见上面那条注释）。
 * 所以「最近」的口径是：**有时间的按时间倒序在前，没时间的按书和章的顺序跟在后面**，
 * 并且**在返回值里说清哪些是没有时间的**（`at` 为空）——界面照实显示，
 * 不给它编一个「刚刚」。
 *
 * @param books 形如 `[{ name, dir }]`，通常来自 `listBooks`
 */
export async function readRecentMarks(root, books, limit = 12) {
  const rows = [];
  for (const b of books || []) {
    if (!b?.dir) continue;
    let one;
    try {
      one = await readBookMarks(root, b.dir);
    } catch {
      continue; // 一本书坏了不能让整栏空掉
    }
    for (const ch of one.chapters) {
      for (const it of ch.items) {
        rows.push({ ...it, book: b.name || "", bookDir: b.dir, chapter: ch.label, path: ch.path });
      }
    }
  }
  rows.sort((x, y) => {
    if (x.at && y.at) return y.at.localeCompare(x.at);
    if (x.at) return -1;
    if (y.at) return 1;
    return 0;
  });
  return { items: rows.slice(0, limit), total: rows.length };
}
