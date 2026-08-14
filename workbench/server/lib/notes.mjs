// 伴生批注 notes.md 的解析与改写。
//
// **批注写下之后必须能改、能删。** 写错一个字就只能去 Obsidian 里翻文件改，
// 这在自己的工作台里说不过去——「读 → 批注 → 摘素材」这条链里，批注是唯一一个
// 原来只能追加不能回头的环节。
//
// 格式是 appendNote 写出来的（见 vault.mjs）：
//
//     ## 2026-08-11 18:12
//
//     > 被划中的原文
//
//     我的想法
//
//     来源: [[书架/纳瓦尔宝典/book.md]]
//
// 三条硬约束，都是为了「绝不弄坏用户手写的东西」：
//
// 1. **改写只动那一段**。记下每条在原文里的起止位置，替换时只 splice 那一截——
//    你在 Obsidian 里往这个文件里加的别的段落原样留着。
// 2. **认不出格式就整份只读**。用户可能在 Obsidian 里把它改成了自由格式；那时候
//    界面上照实说「这份笔记不是工作台写的格式」，而不是自作主张重排一遍。
// 3. **改之前先对时间戳**（`expect`）。对不上说明文件在别处变过了，宁可让人刷新一次，
//    也不能拿旧的下标去删别人的段落。

/** 把 notes.md 切成一条条批注。认不出任何 `## ` 块时返回空数组（调用方据此退回只读）。 */
export function parseNotes(text) {
  const src = String(text || "");
  const heads = [];
  const re = /^## (.+)$/gm;
  let m;
  while ((m = re.exec(src))) heads.push({ at: m.index, after: re.lastIndex, stamp: m[1].trim() });

  return heads.map((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].at : src.length;
    const chunk = src.slice(h.after, end);
    const lines = chunk.split("\n");

    // 引用是**开头**连续的 `>` 行。写在中间的 `>` 属于正文（人会在自己的想法里引别人的话）
    const quote = [];
    let i0 = 0;
    while (i0 < lines.length && !lines[i0].trim()) i0++;
    while (i0 < lines.length && /^\s*>/.test(lines[i0])) quote.push(lines[i0].replace(/^\s*>\s?/, "")), i0++;

    // 来源是**最后**一行 `来源: `。写在中间的不算——那就是正文的一部分
    let i1 = lines.length - 1;
    while (i1 > i0 && !lines[i1].trim()) i1--;
    let source = "";
    if (i1 > i0 && /^来源[:：]/.test(lines[i1].trim())) {
      source = lines[i1].trim().replace(/^来源[:：]\s*/, "");
      i1--;
    }

    return {
      index: i,
      stamp: h.stamp,
      quote: quote.join("\n").trim(),
      body: lines.slice(i0, i1 + 1).join("\n").trim(),
      source,
      at: h.at,
      end,
    };
  });
}

/** 一条批注 → Markdown。块之间必须空行，否则 `>` 后面的正文会被 lazy continuation 吸进引用块。 */
function renderNote({ stamp, quote, body, source }) {
  const blocks = [`## ${stamp}`];
  if (quote.trim()) blocks.push(quote.trim().split("\n").map((l) => `> ${l.replace(/^>\s?/, "")}`).join("\n"));
  blocks.push(body.trim());
  if (source.trim()) blocks.push(`来源: ${source.trim()}`);
  return `${blocks.join("\n\n")}\n`;
}

/**
 * 改一条 / 删一条，返回新的整份文本。
 * `expect` 是那条的时间戳；对不上就抛 409——文件在别处被改过，下标已经不指原来那条了。
 */
export function applyNoteEdit(text, { index, body, remove = false, expect = "" }) {
  const items = parseNotes(text);
  const it = items[index];
  if (!it) throw Object.assign(new Error("找不到这条批注"), { status: 404 });
  if (expect && it.stamp !== expect) {
    throw Object.assign(new Error("这条批注在别处被改过了"), {
      status: 409,
      hint: "刷新一下再改——多半是刚在 Obsidian 里动过同一个文件",
    });
  }
  if (!remove && !String(body || "").trim()) {
    throw Object.assign(new Error("批注内容不能为空"), { status: 400, hint: "想清掉这一条就用删除" });
  }

  const src = String(text || "");
  const next = remove ? "" : renderNote({ ...it, body });
  // 前后各留一个空行，删到最后一条时不留下一串空行
  const head = src.slice(0, it.at).replace(/\n{2,}$/, "\n\n");
  const tail = src.slice(it.end).replace(/^\n+/, "");
  const joined = `${head}${next}${next && tail ? "\n" : ""}${tail}`;
  return joined.replace(/\n{3,}/g, "\n\n").trimStart() ? `\n${joined.replace(/\n{3,}/g, "\n\n").trim()}\n` : "";
}
