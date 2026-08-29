// 把一本书变成 vault 里的一个目录。
//
// 磁盘布局（**这是唯一的真源，工作台自己不留副本**）：
//
//   书架/<书名>/
//     book.md            元信息 frontmatter + 简介；单文件书的正文也在这里
//     cover.jpg          封面（epub 里带就抽出来，没有就不写）
//     01 章节名.md        章节。序号前缀保证排序，标题就是文件名去掉序号
//     images/00001.jpeg  正文插图（epub 带的）
//     notes.md           批注（appendNote 写，与本文件无关）
//
// 为什么章节是**平铺的 md 文件**而不是一个大文件加锚点：这套东西的另一个读者是
// Obsidian，一章一个文件在那边才是能双链、能搜、能单独打标签的粒度。而且 30 万字
// 的书塞进一个文件，浏览器里每次渲染都要重排整本。
//
// 解析全部在服务端做：epub 是 zip、pdf 要跑 pdfjs，浏览器里做等于把两个解析器
// 打进前端包，而这台机器上本来就有 Node。

import path from "node:path";
import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { safeJoin } from "./vault.mjs";

// 单文件书的上限。超过这个字数还没拆出章节，就按页/按长度硬拆——
// 十几万字灌进一个 Markdown，阅读区每次渲染都要重排整本。
const SINGLE_FILE_MAX = 60_000;
const CHAPTER_TARGET = 20_000; // 硬拆时每章大约多少字

export const SUPPORTED = [".md", ".markdown", ".txt", ".epub", ".pdf"];

/** Windows 文件名非法字符 + 首尾空点。书名和章节名都要过这一层。 */
export function safeName(s, max = 60) {
  return String(s || "")
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, max)
    .trim();
}

/**
 * 导入一本书。
 *
 * @param bytes  Uint8Array，原始文件字节。文本类在这里解码，二进制类交给各自的解析器。
 * @returns { name, dir, bookPath, chapters, cover, kind }
 */
export async function importBook(root, shelfDir, { fileName = "", bytes, name = "" }) {
  const ext = path.extname(fileName).toLowerCase();
  if (!SUPPORTED.includes(ext)) {
    throw Object.assign(new Error(`不支持 ${ext || "这种"} 格式，只能导入 ${SUPPORTED.join(" / ")}`), { status: 400 });
  }

  const parsed =
    ext === ".epub" ? parseEpub(bytes)
    : ext === ".pdf" ? await parsePdf(bytes)
    : parseText(new TextDecoder("utf-8").decode(bytes));

  // 书名优先级：用户手填 > 文件内元信息 > 文件名。
  // 文件名要去掉归档用的日期后缀（`-20260811`）——那是文件管理的信息，不是书名的一部分。
  const title = safeName(name || parsed.title || path.basename(fileName, ext).replace(/[-_ ]?\d{8}$/, ""));
  if (!title) throw Object.assign(new Error("书名不能为空"), { status: 400 });

  const dir = `${shelfDir}/${title}`;
  const absDir = safeJoin(root, dir);
  // 已存在就拒绝，不覆盖——重复导入一本书不该把上一次的批注上下文冲掉
  try {
    await fs.access(absDir);
    throw Object.assign(new Error(`「${title}」已经在书架上了`), { status: 409 });
  } catch (e) {
    if (e.status === 409) throw e;
    if (e.code !== "ENOENT") throw e;
  }
  await fs.mkdir(absDir, { recursive: true });

  // 章节切分：解析器给了章就用章的；没给就按长度决定单文件还是硬拆
  const chapters = parsed.chapters?.length ? parsed.chapters : splitPlain(parsed.text || "");

  const written = [];
  if (chapters.length > 1) {
    for (let i = 0; i < chapters.length; i++) {
      const num = String(i + 1).padStart(2, "0");
      const chTitle = safeName(chapters[i].title || `第 ${i + 1} 节`, 48) || `第 ${i + 1} 节`;
      const file = `${num} ${chTitle}.md`;
      const body = chapters[i].text.trim();
      // 正文自己第一行就是同名标题的话，别再写一遍：现在转换器会还原原书的标题层级，
      // 章名常常已经在正文里了。写两遍的话 Obsidian 里看到的就是重复的一行。
      const head = sameAsTitle(body.split("\n")[0], chTitle) ? "" : `# ${chTitle}\n\n`;
      await fs.writeFile(safeJoin(root, `${dir}/${file}`), `${head}${body}\n`, "utf8");
      written.push({ file, title: chTitle, order: i + 1, chars: chapters[i].text.length });
    }
  }

  // 插图：原样落进 images/，正文里是相对路径 ![](images/xxx)，Obsidian 也认
  for (const img of parsed.images || []) {
    const abs = safeJoin(root, `${dir}/${img.name}`);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, img.bytes);
  }

  let cover = "";
  if (parsed.cover) {
    cover = `cover${path.extname(parsed.cover.name) || ".jpg"}`;
    await fs.writeFile(safeJoin(root, `${dir}/${cover}`), parsed.cover.bytes);
  }

  const head = [
    "---",
    `作者: ${parsed.author || ""}`,
    "状态: 在读",
    "标签: []",
    `来源: ${safeName(path.basename(fileName), 120)}`,
    `导入: ${today()}`,
    "---",
    "",
  ].join("\n");

  // book.md：多章书这里放目录，单文件书这里就是正文。
  // 两种情况都有 book.md，listBooks 才不用分两套逻辑去找「这本书的入口在哪」。
  const body = written.length
    ? `# ${title}\n\n${parsed.intro ? `${parsed.intro.trim()}\n\n` : ""}## 目录\n\n${written
        .map((c) => `- [[${c.title}]]`)
        .join("\n")}\n`
    : `# ${title}\n\n${(chapters[0]?.text || parsed.text || "").trim()}\n`;

  await fs.writeFile(safeJoin(root, `${dir}/book.md`), head + body, "utf8");

  return {
    name: title,
    dir,
    bookPath: `${dir}/book.md`,
    notePath: `${dir}/notes.md`,
    cover,
    chapters: written,
    kind: ext.slice(1),
  };
}

// 「这一行是不是就是章名」。比较时把标记和空白都抹掉——书里的标题常用全角空格，
// 而文件名那边已经被 safeName 折成半角，逐字比永远对不上。
function sameAsTitle(line, title) {
  const norm = (s) => String(s || "").replace(/^#{1,6}\s*/, "").replace(/\s+/g, "").trim();
  return !!norm(line) && norm(line) === norm(title);
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---- 纯文本 / Markdown ------------------------------------------------------

function parseText(text) {
  // 一级标题当章：手写的长文常常就是这么组织的。少于 3 个就不拆，
  // 免得把一篇有两个小标题的文章拆成三个「章节」。
  const parts = text.split(/^\s*#\s+(?=\S)/m);
  const heads = [...text.matchAll(/^\s*#\s+(.+)$/gm)].map((m) => m[1].trim());
  if (heads.length >= 3 && parts.length === heads.length + 1) {
    return {
      intro: parts[0].trim(),
      chapters: heads.map((h, i) => ({ title: h, text: parts[i + 1].replace(/^.*\n/, "") })),
    };
  }
  return { text };
}

/** 没有结构信息时的兜底：短的就一个文件，长的按目标字数硬拆。 */
function splitPlain(text) {
  const body = String(text || "");
  if (body.length <= SINGLE_FILE_MAX) return [{ title: "", text: body }];
  const blocks = body.split(/\n{2,}/);
  const chapters = [];
  let buf = [];
  let size = 0;
  for (const b of blocks) {
    buf.push(b);
    size += b.length;
    if (size >= CHAPTER_TARGET) {
      chapters.push({ title: `第 ${chapters.length + 1} 部分`, text: buf.join("\n\n") });
      buf = [];
      size = 0;
    }
  }
  if (buf.length) chapters.push({ title: `第 ${chapters.length + 1} 部分`, text: buf.join("\n\n") });
  return chapters;
}

// ---- EPUB -------------------------------------------------------------------

/**
 * epub 就是个 zip：container.xml → opf（manifest + spine）→ 一堆 xhtml。
 * 章节顺序**只信 spine**，不信文件名排序——calibre 导出的 part0000.html 这类命名
 * 恰好有序，但很多书的文件名根本无序。章节标题优先从 toc.ncx 的 navMap 取，
 * 因为 xhtml 的 <title> 常常是「未知」。
 */
export function parseEpub(bytes) {
  const files = unzipSync(new Uint8Array(bytes));
  const get = (name) => files[name] || files[name.replace(/^\//, "")];

  const container = strFromU8(get("META-INF/container.xml") || new Uint8Array());
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw Object.assign(new Error("这个 epub 里没有 container.xml，文件可能已损坏"), { status: 400 });
  const opfDir = path.posix.dirname(opfPath) === "." ? "" : `${path.posix.dirname(opfPath)}/`;
  const opf = strFromU8(get(opfPath));

  const title = decodeXml(opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/)?.[1] || "")
    // 中文电子书的标题常带一长串营销副标题，括号里那截对书架毫无用处
    .replace(/[（(][^）)]{8,}[）)]\s*$/, "")
    .trim();
  const author = decodeXml(opf.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/)?.[1] || "").trim();

  // manifest: id -> { href, type }
  const manifest = new Map();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const tag = m[0];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    if (id && href) manifest.set(id, { href: opfDir + decodeXml(href), type: tag.match(/media-type="([^"]+)"/)?.[1] || "" });
  }

  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)]
    .map((m) => manifest.get(m[1]))
    .filter((it) => it && /xhtml|html/.test(it.type));

  // toc.ncx: 正文文件 -> 章节名
  const ncxName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".ncx"));
  const tocTitles = new Map();
  if (ncxName) {
    const ncx = strFromU8(files[ncxName]);
    const ncxDir = path.posix.dirname(ncxName) === "." ? "" : `${path.posix.dirname(ncxName)}/`;
    for (const m of ncx.matchAll(/<navPoint\b[\s\S]*?<\/navPoint>/g)) {
      const label = decodeXml(m[0].match(/<text>([\s\S]*?)<\/text>/)?.[1] || "").trim();
      const src = m[0].match(/<content\b[^>]*src="([^"#]+)/)?.[1];
      if (label && src && !tocTitles.has(ncxDir + decodeXml(src))) tocTitles.set(ncxDir + decodeXml(src), label);
    }
  }

  // 用到的图片才抽出来，整本 epub 的图片一股脑复制会把 vault 撑大一圈
  const usedImages = new Map();
  const chapters = [];
  for (const item of spine) {
    const raw = get(item.href);
    if (!raw) continue;
    const dir = path.posix.dirname(item.href);
    const md = xhtmlToMd(strFromU8(raw), (src) => {
      const abs = path.posix.normalize(`${dir}/${src.split("#")[0]}`);
      if (!files[abs]) return "";
      const name = `images/${path.posix.basename(abs)}`;
      if (!usedImages.has(name)) usedImages.set(name, files[abs]);
      return name;
    });
    if (!md.trim()) continue;   // 空白页、纯样式页直接扔
    // 目录里没登记的正文文件（一章被拆成两个 xhtml 时很常见）：退回正文里的标题，
    // 再退回正文第一行。`titled` 只在**目录里真有这一条**时为真——推断来的名字不算数，
    // 否则那些只有一行献词的小碎片会因为「有名字」而躲过下面的合并。
    const fromToc = tocTitles.get(item.href) || "";
    const label = fromToc || md.match(/^#{1,3}\s+(.+)$/m)?.[1] || firstLineTitle(md);
    chapters.push({ title: label, text: md, titled: !!fromToc });
  }

  // 封面：opf 里 meta[name=cover] 指的那张，退回文件名里带 cover 的
  const coverId = opf.match(/<meta[^>]+name="cover"[^>]+content="([^"]+)"/)?.[1];
  const coverHref =
    (coverId && manifest.get(coverId)?.href) ||
    [...manifest.values()].find((it) => /^image\//.test(it.type) && /cover/i.test(it.href))?.href ||
    "";
  const coverBytes = coverHref ? get(coverHref) : null;

  return {
    title,
    author,
    chapters: mergeTinyChapters(chapters),
    images: [...usedImages.entries()].map(([name, b]) => ({ name, bytes: b })),
    cover: coverBytes ? { name: coverHref, bytes: coverBytes } : null,
  };
}

// 正文第一行当章名：只在它足够短、像个标题的时候。整段话当章名会把目录撑爆。
function firstLineTitle(md) {
  const line = md.split("\n").map((l) => l.trim()).find((l) => l && !/^!\[/.test(l)) || "";
  const clean = line.replace(/^[#>\-*\s]+/, "").replace(/[*`]/g, "").trim();
  return clean.length <= 30 ? clean : "";
}

/**
 * 把过短的片段并进前一章。
 *
 * calibre 导出的书里，一「章」常常被切成「标题页 + 正文 + 空白页」好几个 xhtml，
 * 照单全收的话书架上会出现三十个只有一行字的「章节」，目录直接没法看。
 */
function mergeTinyChapters(list, min = 400) {
  const out = [];
  for (const c of list) {
    if (out.length && c.text.length < min && !c.titled) {
      out[out.length - 1].text += `\n\n${c.text}`;
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

/**
 * XHTML → Markdown。**逐块走一遍，不是一串正则接力。**
 *
 * 上一版是一串 `.replace()` 链，而且顺序是错的：`</h1>` 先被换成了段落分隔，
 * 后面那条 heading 规则就永远匹配不到——《纳瓦尔宝典》里 61 个真标题（8 个 `h2`、
 * 40 个 `h3`）全部退化成普通段落。现象就是用户说的「缺少标题、引用，抓不住重点、
 * 区分不了段落」。正则接力处理嵌套结构本来就靠不住，所以换成一次遍历。
 *
 * 另一半原因是**排版语义写在 class 里，不在标签上**。出版社的 epub（calibre 导出）
 * 大量用 `<p class="subhead">`、`<span class="quotation-s2">` 这种写法，只认标签
 * 就只能看到一片 `<p>`。所以块的语义 = 标签 + 自己的 class + 内部行内 span 的 class，
 * 三者一起判。映射表是数一遍这本书的真实用法定出来的，不是猜的：
 *
 *   h1/h2/h3            → #/##/###
 *   p.subhead / titlequot / 带 title|head 的 class → ####（书里的小标题）
 *   span.quotation-*    → > 引用（纳瓦尔的金句，全书 221 处）
 *   span.bold           → **强调**
 *   p.author / right-info → *署名*
 *   span.super*         → 原样留着（[78] 这类脚注号，Markdown 没有上标语法）
 */
export function xhtmlToMd(html, resolveImage) {
  const src = html
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    /**
     * ⚠️ **`<!DOCTYPE …>` 和注释必须在这儿就拆掉。**
     *
     * 下面那个分词正则只认 `<字母…>`，`<!DOCTYPE` 的 `!` 不是字母；而另一个分支 `[^<]+`
     * 在 `<` 处也匹配不上。于是正则引擎**往前跳一个字符**，从 `!` 开始把剩下的当正文收走——
     * 章节开头于是多出一行 `!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "…dtd">`，
     * `<` 被吃掉、`>` 留着。踩过一次（《平凡的世界》每一章都有）。
     *
     * 注释单独拆是因为**它里面可以有 `>`**（`<!-- a > b -->`），
     * 交给下面那个 `<[^>]*>` 兜底只会截一半、把 ` b -->` 漏成正文。
     * DOCTYPE 用 `[\s\S]` 而不是 `.`：它标准写法就是折成两行的。
     */
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    /**
     * 图片先换成 Markdown 文本。**在走块之前做**——`<img>` 是自闭合标签，走到下面那个
     * 块循环里只会被当成「非块非行内」的标签忽略掉，图就没了。
     *
     * 直接写成 `![](路径)` 而不是占位符：那个循环只吃 `<tag>`、文本原样收，
     * 所以这段 Markdown 会安全地跟着所在的段落走完全程。上一版用了哨兵字符占位、
     * 却忘了写还原那一步，结果 15 张插图全变成了正文里的乱码。
     */
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const s2 = tag.match(/\bsrc="([^"]+)"/i)?.[1] || "";
      const alt = tag.match(/\balt="([^"]*)"/i)?.[1] || "";
      const rel = s2 ? resolveImage(decodeXml(s2)) : "";
      return rel ? `![${decodeXml(alt)}](${rel})` : "";
    });

  const BLOCK = /^(p|div|h[1-6]|blockquote|li|section|article|tr|td)$/;
  const blocks = [];
  const stack = [];       // 打开着的块：{ tag, cls }
  let buf = "";           // 当前块的行内文本
  let inlineCls = [];     // 当前块里出现过的行内 span 的 class
  const spanStack = [];   // 行内标记的闭合动作

  const flush = () => {
    const text = buf.replace(/[^\S\n]+/g, " ").trim();
    buf = "";
    const cls = [...stack.map((b) => b.cls), ...inlineCls].join(" ").toLowerCase();
    const tag = [...stack].reverse().find((b) => /^h[1-6]$/.test(b.tag))?.tag || "";
    inlineCls = [];
    if (!text) return;
    blocks.push(render(text, tag, cls));
  };

  // 第二个分支是**兜底**：任何不是 `<字母…>` 的尖括号（CDATA、漏网的声明、
  // `</3>` 这种畸形闭合）整段丢掉。没有它的话，引擎会跳过那个 `<` 再从下一个字符起
  // 用 `[^<]+` 把里面的内容当正文收走——这就是 DOCTYPE 泄漏进正文的机制。
  const re = /<\/?([a-z][a-z0-9]*)\b([^>]*)>|<[^>]*>|([^<]+)/gi;
  let m;
  while ((m = re.exec(src))) {
    const [, rawTag, attrs, text] = m;
    if (text != null) {
      buf += text;
      continue;
    }
    // 兜底分支命中：三个捕获组都是 undefined，整段跳过（不能往下走，rawTag 是空的）
    if (rawTag == null) continue;
    const tag = rawTag.toLowerCase();
    const closing = m[0][1] === "/";
    const cls = closing ? "" : (attrs.match(/class="([^"]*)"/) || [, ""])[1];

    if (tag === "br") {
      buf += "\n";
    } else if (BLOCK.test(tag)) {
      // 块的开与闭都断句：`<div><p>` 这种嵌套里，内层 p 才是真正的段落
      flush();
      if (closing) stack.pop();
      else stack.push({ tag, cls });
    } else if (/^(b|strong|i|em|span|sup|a)$/.test(tag)) {
      if (closing) buf += spanStack.pop() || "";
      else {
        const c = cls.toLowerCase();
        if (c) inlineCls.push(c);
        // 引用类的 span 只做标记，不加行内语法——整段会被 render 包成引用块
        const mark = /^(b|strong)$/.test(tag) || /\bbold\b/.test(c) ? "**"
          : /^(i|em)$/.test(tag) ? "*"
          : "";
        buf += mark;
        spanStack.push(mark);
      }
    }
    // 其余标签（html/body/link/...）忽略，文字照收
  }
  flush();

  return tidy(blocks)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 块序列的收尾清理。三条都是「原书用一种手段表达，Markdown 已经有另一种手段」时
 * 该去掉哪一个的问题：
 *
 *  1. **两段引用之间的分隔线删掉**。原书靠居中的「∨」区分连着的两条金句，而 Markdown
 *     的引用块本身就是分开的——两样都留着，一屏里三十条横杠比金句还显眼。
 *  2. 连着的分隔线合成一条。
 *  3. 标题后面紧跟分隔线的，分隔线删掉：标题已经断章了。
 */
function tidy(blocks) {
  const isQuote = (b) => b?.startsWith("> ");
  const isRule = (b) => b === "---";
  const out = [];
  let keepApart = false;   // 上一条分隔线说过「这两段引用是两回事」

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

    if (isRule(b)) {
      const prev = out[out.length - 1];
      const next = blocks.slice(i + 1).find((x) => !isRule(x));
      if (!prev || isRule(prev)) continue;                  // 开头的、连着的
      if (/^#{1,6} /.test(prev)) continue;                  // 紧跟在标题后面：标题已经断章了
      if (next === undefined) continue;                     // 结尾的
      if (isQuote(prev) && isQuote(next)) {
        // 夹在两段引用中间：线本身不画（引用块已经是分开的），但要**记住这个边界**，
        // 好让下面的合并不把两条独立的金句粘成一段。
        keepApart = true;
        continue;
      }
    }

    /**
     * 连着的引用并进同一个引用块。
     *
     * 原书里一份「专长举例」是十几个 `<p><span class="quotation">` 并排，各自成块的话
     * 屏幕上就是十几个孤立的小引用条，中间全是空档。但**隔过装饰符的两条要留着分开**——
     * 那是原书在说「这是两条独立的金句」（纳瓦尔的推特风暴就是这样）。
     */
    if (isQuote(b) && isQuote(out[out.length - 1]) && !keepApart) {
      out[out.length - 1] += `\n${b}`;
      continue;
    }
    keepApart = false;
    out.push(b);
  }
  return out;
}

// class 里带这些词的块是**小标题**。`titlequot` 实测是「推文和推特风暴」这类小标题，
// 不是引用——所以判 title 要排在判 quot 前面。
const HEADISH = /\b(sub)?head|title|chapter|section-?t/;
const QUOTISH = /\bquot|\bcite|\bepigraph/;
const BYLINE = /\bauthor|byline|right-info|copyright-text/;

function render(text, tag, cls) {
  const md = fixEmphasis(decodeXml(text));
  const deco = decorativeToRule(md.trim());
  if (deco !== md.trim()) return "---";

  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Math.min(3, +tag[1]))} ${flat(md)}`;
  if (HEADISH.test(cls)) return `#### ${flat(md)}`;
  // 引用可能有多行（原书里一段引言被拆成几个 <p>），每行都要带 >
  if (QUOTISH.test(cls)) return md.split("\n").map((l) => `> ${l.trim()}`).join("\n");
  if (BYLINE.test(cls)) return `*${flat(md)}*`;
  return md.replace(/\n{2,}/g, "\n");
}

// 标题和署名必须压成一行：里面留着换行的话，`# ` 只作用于第一行，剩下的掉出来变成正文
const flat = (s) => s.replace(/\s+/g, " ").trim();

/**
 * 把标点从强调标记**里面**挪到外面。中文书里这一条是必须的，不是洁癖。
 *
 * CommonMark 判断 `**` 能不能开合，看的是它两侧的字符（flanking rules）：闭合的 `**`
 * 不能「前面是标点、后面是字母」。而中文原书里到处是
 *
 *     **第一种是劳动力杠杆，**也就是让别人给你打工。
 *
 * 闭合的 `**` 前面是全角逗号、后面是汉字——正好踩中，于是**整段不加粗，两个星号
 * 原样显示在正文里**。同理 `**“复制边际成本为零的产品”**` 的开标记后面跟着全角引号。
 *
 * 挪成 `**第一种是劳动力杠杆**，也就是……` 之后两边都合法，而且排版上本来就更对：
 * 标点属于句子，不属于被强调的那个词。
 *
 * ⚠️ 前端 `Reader.jsx` 里有一份同样的处理，那是给库里的正文和历史文件兜底的
 * （LLM 写的中文同样会踩）。改这条规则时两边一起改。
 */
/**
 * ⚠️ **开标记后面不能跟空白，而这一条是硬伤不是洁癖。**
 *
 * 少了它，**列表记号会被当成强调的开头**：
 *
 *     *   **写作中：9 个**
 *
 * 里第一个 `*` 会跟 `**` 的前一半配成对，匹配到 `*   *`，中间全是空格 →
 * 整段被替换成那几个空格。于是**记号连同一个星号一起消失**，剩下
 * `   *写作中：9 个**`：这一行不再是列表项，星号原样印在正文里，
 * 下面缩进的子项也跟着散架，一整块回复退回成一坨带星号的纯文本。
 *
 * CommonMark 本来就规定开标记后面跟空白不能开启强调，补上这条前瞻既修了 bug，
 * 也更贴近真实解析（顺带让 `2 * 3 * 4` 这种乘号不再被误当强调）。
 */
export function fixEmphasis(text) {
  // 代码里的星号是代码不是排版：围栏和行内代码原样跳过
  return String(text || "")
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((seg, i) => i % 2 ? seg : seg.replace(/(\*{1,2})(?!\s)([^*\n]+?)\1/g, (whole, mark, inner) => {
      const lead = inner.match(/^[\s\p{P}]+/u)?.[0] || "";
      // 尾部在**去掉头之后的那截**里找：直接在整段上各找一次的话，`**——**` 这种
      // 全是标点的会让头尾匹配到同一段字符，拼回去凭空多一份
      const rest = inner.slice(lead.length);
      if (!rest) return lead;
      const trail = rest.match(/[\s\p{P}]+$/u)?.[0] || "";
      const core = rest.slice(0, rest.length - trail.length);
      // 整段都是标点就别强调了，去掉标记比留个空的强调更干净
      return core ? `${lead}${mark}${core}${mark}${trail}` : `${lead}${trail}`;
    }))
    .join("");
}

/**
 * 书里那些**纯装饰的行**。calibre 导出的《纳瓦尔宝典》在每两段引言之间放一个
 * `<p class="center">∨</p>`，转成 Markdown 就是一行孤零零的「∨」自成一段——
 * 一章几十个，读起来满屏空档夹着符号，正文被切得七零八落。
 *
 * 它在原书里的作用是「分隔」，所以翻译成 Markdown 的分隔线 `---`，**不是删掉**：
 * 删了两段引言会粘成一段，原书的节奏也跟着没了。
 */
const DECORATIVE = /^[∧∨◆◇★☆※＊*·•‧・…⋯—–~～=＝_＿+＋\s]{1,4}$/;
function decorativeToRule(line) {
  return line && DECORATIVE.test(line) ? "\n---\n" : line;
}

function stripTags(s) {
  return decodeXml(String(s).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// ---- PDF --------------------------------------------------------------------

/**
 * pdf 里没有段落，只有一行行摆在坐标上的字。所以这里做两件事：
 *   1. 把被排版切断的行拼回段落（`joinLines`）
 *   2. 找章节标题；找不到就按长度硬拆（`splitPlain` 兜底）
 *
 * 扫描件（没有文字层）会得到空文本——照实报错，不要写一本空书上架。
 */
export async function parsePdf(bytes) {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text: pages } = await extractText(pdf, { mergePages: false });
  const meta = await pdf.getMetadata().catch(() => null);

  const cleaned = pages.map((p) => joinLines(p));
  const all = cleaned.join("\n\n").trim();
  if (all.length < 50) {
    throw Object.assign(new Error("这个 PDF 里没有可提取的文字（多半是扫描件）"), {
      status: 400,
      hint: "先用 OCR 转成有文字层的 PDF 或 Markdown 再导入",
    });
  }

  const info = meta?.info || {};
  const title = String(info.Title || "").trim();
  const author = /^(apache poi|wps|microsoft|adobe)/i.test(String(info.Author || "")) ? "" : String(info.Author || "").trim();

  const chapters = splitByHeadings(all);
  return {
    title,
    author,
    chapters: chapters.length > 2 ? chapters.map((c) => ({ ...c, text: markHeadings(c.text) })) : null,
    text: markHeadings(all),
  };
}

/**
 * 拼回段落：pdf 的换行是排版换行，不是段落换行。
 *
 * 判据是**上一行末尾**——中文段落收尾一定有句号问号引号之类；停在一个普通汉字上，
 * 说明这一行是被页宽切断的，下一行接着读。反过来用「下一行是否缩进」判断在中文 pdf
 * 里几乎不可用，很多书正文根本没有首行缩进的坐标差异。
 */
function joinLines(pageText) {
  const lines = String(pageText || "").split("\n").map((l) => l.replace(/\s+$/g, ""));
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      out.push("");
      continue;
    }
    const prev = out[out.length - 1];
    const prevOpen = prev && prev.trim() && !/[。！？；：”」』）】.!?:;]$/.test(prev.trim()) && prev.trim().length >= 20;
    const startsNew = /^(\d{1,4}[.、 ]|第[\d零〇一二三四五六七八九十百千]+[章讲节篇]|[#>-])/.test(t);
    if (prevOpen && !startsNew) out[out.length - 1] = prev.trimEnd() + t;
    else out.push(t);
  }
  /**
   * **每个段落之间空一行。** 这一步不是排版洁癖：上面拼完之后每一行都已经是一个完整段落，
   * 用单换行连起来的话 Markdown 会当成同一段里的软换行（工作台开了 `breaks: true`，
   * 渲染成 `<br>`），几百行字挤成一大坨没有段距的墙——《明智创富指南》第一版导进来
   * 就是这样，一眼看过去根本找不到从哪读起。
   */
  return out.filter((l) => l.trim()).join("\n\n").trim();
}

/**
 * pdf 里没有标题标签，只能从形状认。**判据要严，宁可漏也不能错**——把一句正常的短句
 * 误判成标题，读者会以为那里开了新的一节，比没有标题更坏。
 *
 * 两条：显式的章节标记（第 X 章 / Chapter N），或者「短 + 不以标点收尾 + 不以数字开头」。
 *
 * **「1. xxx」这种不算标题**，尽管 `HEADING_RE` 认它——那条分支是给 `splitByHeadings`
 * 用的，在「全书散落三处以上」的语境下它才是章节号；单独一行的 `1. 建议多读几遍。`
 * 就是个列表项，标成标题会凭空劈出一节。（而且它本来就是合法的 Markdown 有序列表语法，
 * 什么都不做反而渲染得正好。）同理排除数字开头的 `002 打造个人品牌，……` 编号条目。
 *
 * 实测《明智创富指南》289 段里只命中 3 条，条条都对。
 */
const PDF_HEAD = /^(?:第[\d零〇一二三四五六七八九十百千]+[章讲节篇][^\n]{0,40}|Chapter\s+\d+[^\n]{0,40})$/;

function markHeadings(text) {
  return String(text || "")
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return line;
      const shapely = t.length <= 20 && !/^\d/.test(t) && !/[。！？；：，、）】.!?;,]$/.test(t);
      return PDF_HEAD.test(t) || shapely ? `## ${t}` : line;
    })
    .join("\n");
}

const HEADING_RE = /^(?:第[\d零〇一二三四五六七八九十百千]+[章讲节篇][^\n]{0,40}|Chapter\s+\d+[^\n]{0,40}|\d{1,2}[.、]\s*\S[^\n]{0,38})$/;

function splitByHeadings(text) {
  const lines = text.split("\n");
  const marks = [];
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.length <= 42 && HEADING_RE.test(t)) marks.push({ i, title: t });
  });
  if (marks.length < 3) return [];
  const chapters = [];
  if (marks[0].i > 0) chapters.push({ title: "开始之前", text: lines.slice(0, marks[0].i).join("\n").trim() });
  marks.forEach((m, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].i : lines.length;
    chapters.push({ title: m.title, text: lines.slice(m.i + 1, end).join("\n").trim() });
  });
  return chapters.filter((c) => c.text.length > 80);
}
