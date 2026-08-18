// vault 文件访问的唯一入口。所有路径都必须过 safeJoin。
//
// 红线：绝不要用 `path.join(root, rel)` 直接开文件。rel 来自 HTTP query，
// `../../../Users/Lenovo/.ssh/id_rsa` 或一个绝对路径都能把整台机器的文件读出去——
// 工作台监听的是回环地址，但浏览器里任何一个页面都能对 localhost 发请求。

import path from "node:path";
import fs from "node:fs/promises";
import { atomicWrite } from "./safe-write.mjs";
import { DIRS } from "./vault-dirs.mjs";

export function vaultRoot(env) {
  const root = (env.VAULT_ROOT || "").trim();
  if (!root) throw Object.assign(new Error("未配置 VAULT_ROOT"), { hint: "在设置面板的「知识库」那一段填 Obsidian vault 的绝对路径" });
  return path.resolve(root);
}

export function safeJoin(root, rel) {
  const abs = path.resolve(root, rel || ".");
  const inside = path.relative(root, abs);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw Object.assign(new Error("路径越界，拒绝访问"), { status: 400 });
  }
  return abs;
}

// 列目录：只回目录和 .md 文件，其余（图片、附件）暂不进列表
export async function listDir(root, rel) {
  const abs = safeJoin(root, rel);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // .obsidian、.trash 之类不露出来
    const isDir = e.isDirectory();
    if (!isDir && !e.name.toLowerCase().endsWith(".md")) continue;
    items.push({
      name: e.name,
      path: path.relative(root, path.join(abs, e.name)).split(path.sep).join("/"),
      kind: isDir ? "dir" : "file",
    });
  }
  items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "zh") : a.kind === "dir" ? -1 : 1));
  return items;
}

export async function readFile(root, rel) {
  const abs = safeJoin(root, rel);
  return fs.readFile(abs, "utf8");
}

// 文件不存在时返回空串而不是抛错：伴生笔记 notes.md 在写第一条之前本来就不存在，
// 「还没有批注」是正常状态，不该让整个阅读页报错。
export async function readFileOrEmpty(root, rel) {
  try {
    return await readFile(root, rel);
  } catch (e) {
    if (e.code === "ENOENT") return "";
    throw e;
  }
}

// 列出某目录下指定后缀的文件（listDir 只回 .md，热点快照那类数据文件用这个）
export async function listFiles(root, rel, ext) {
  const abs = safeJoin(root, rel);
  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return null; // null = 目录不存在，跟「空目录」是两回事
    throw e;
  }
  return entries
    .filter((e) => e.isFile() && !e.name.startsWith(".") && e.name.toLowerCase().endsWith(ext))
    .map((e) => e.name)
    .sort();
}

/**
 * 往 vault 写一份文件。**整份重写，而且必须是原子的**（见 ）：
 * 批注、高亮、正文都是「读出来改一遍再整份写回去」， 会先把文件
 * 截成 0 字节——写到一半断掉，磁盘上留下的是半份，而原来那份已经没了。
 * 这些文件的另一个读者是 Obsidian，坏掉的话你是在那边发现的。
 */
export async function writeVaultFile(root, rel, content) {
  const abs = safeJoin(root, rel);
  await atomicWrite(abs, content);
  return path.relative(root, abs).split(path.sep).join("/");
}

/**
 * 文件的「版本号」，用来做乐观锁（和批注编辑的 `stamp` 同一套）。
 *
 * 书架里的 md **同时也在 Obsidian 里开着**——那才是这些文件的主编辑器。
 * 不对一下版本就整份重写的话，工作台会把你刚在 Obsidian 里写的段落安静地抹掉，
 * 而且没有任何地方能看出发生过这件事。取不到文件（还没建）返回空串。
 */
export async function fileStamp(root, rel) {
  try {
    const s = await fs.stat(safeJoin(root, rel));
    return String(Math.round(s.mtimeMs));
  } catch (e) {
    if (e.code === "ENOENT") return "";
    throw e;
  }
}

export async function fileExists(root, rel) {
  try {
    await fs.access(safeJoin(root, rel));
    return true;
  } catch {
    return false;
  }
}

/**
 * 清掉目录下文件名日期早于 keepDays 的快照。
 * 只删文件名形如 YYYY-MM-DD.<ext> 的文件——认不出日期的一律不动，
 * 免得哪天用户往这个目录放了别的东西被顺手删掉。
 */
export async function cleanupSnapshots(root, rel, ext, keepDays = 30) {
  const names = await listFiles(root, rel, ext);
  if (!names) return 0;
  const cutoff = Date.now() - keepDays * 86400_000;
  let removed = 0;
  for (const name of names) {
    const m = name.match(/^(\d{4})-(\d{2})-(\d{2})\./);
    if (!m) continue;
    const t = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).getTime();
    if (Number.isNaN(t) || t >= cutoff) continue;
    await fs.rm(safeJoin(root, `${rel}/${name}`), { force: true });
    removed++;
  }
  return removed;
}

// 极简 frontmatter 解析：只认 `key: value` 一层，够书架用。
// 不引 YAML 库——书的元信息就作者、状态、标签这几项，引一个解析器不划算。
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (!key) continue;
    // 支持 `标签: [认知, 效率]` 和 `标签: 认知、效率` 两种写法
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      meta[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

/**
 * 一本书是**资料**还是**藏书**。这条决定了正文能不能改。
 *
 * 分界不是文件格式，是**「这是谁写的字」**：
 *   - `资料` 自己攒的（收集的片段、自己写的笔记）——不能改反而是残废的
 *   - `藏书` 别人写的（出版物）——改了它，以后从书里摘的每一句引用都不再可信
 *
 * 没写 `类型` 时**按来源文件的后缀推断**，因为九成情况下它是对的，而且 `来源` 是
 * 导入时就记下的，所有已有的书都能直接推断出来、不用迁移也不用挨个问。
 * 推断错的那一成由用户在书详情上一键翻过来——**一本一次，不是一次一次**。
 */
export const BOOK_KINDS = ["资料", "藏书"];

export function bookKind(meta = {}) {
  const explicit = String(meta.类型 || meta.kind || "").trim();
  if (BOOK_KINDS.includes(explicit)) return explicit;
  // 建空书没有「来源」，那一定是自己攒的
  return /\.(epub|pdf)$/i.test(String(meta.来源 || "")) ? "藏书" : "资料";
}

/**
 * 改 frontmatter 里的一个字段，**其余部分一个字都不动**。
 *
 * 不走「解析成对象再序列化回去」那条路：`parseFrontmatter` 只认一层 `key: value`，
 * 重新写出来会把用户手写的引号、注释、嵌套结构按我们的口味重排一遍。
 * 没有 frontmatter 的文件就在最前面补一段。
 */
export async function setFrontmatterField(root, rel, key, value) {
  const raw = await readFileOrEmpty(root, rel);
  const { head, body } = splitFrontmatter(raw);
  const line = `${key}: ${value}`;
  let next;
  if (!head) {
    next = `---\n${line}\n---\n\n${body}`;
  } else if (new RegExp(`^${key}\\s*:.*$`, "m").test(head)) {
    next = head.replace(new RegExp(`^${key}\\s*:.*$`, "m"), line) + body;
  } else {
    // 补在闭合的 --- 之前，保持原有字段的顺序
    next = head.replace(/(\r?\n)---(\r?\n?)$/, `$1${line}$1---$2`) + body;
  }
  await writeVaultFile(root, rel, next);
  return next;
}

/**
 * 把 frontmatter 原样切下来。
 *
 * 编辑正文时**不能拿 `parseFrontmatter` 的 `meta` 重新序列化回去**：那一份是被解析器
 * 简化过的（只认一层 `key: value`，引号、注释、嵌套结构全丢了），写回去等于把用户
 * 在 Obsidian 里手写的元信息按我们的口味重排一遍。原样留着那一段最老实。
 */
export function splitFrontmatter(text) {
  const m = String(text || "").match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? { head: m[0], body: text.slice(m[0].length) } : { head: "", body: String(text || "") };
}

/**
 * 改写一份文档的正文，**frontmatter 原样保留**。
 *
 * `GET /api/vault/doc` 给出去的是去掉 frontmatter 之后的正文，所以存回来的也只有正文；
 * 直接整份写的话，书的作者、状态、标签会在第一次保存时安静地消失。
 */
export async function writeDocBody(root, rel, body) {
  const raw = await readFileOrEmpty(root, rel);
  const { head } = splitFrontmatter(raw);
  const text = String(body ?? "").replace(/\s+$/, "") + "\n";
  const glue = head && !text.startsWith("\n") ? "\n" : "";
  await writeVaultFile(root, rel, head + glue + text);
  return text;
}

/**
 * 列出书架里的书。一本书 = `书架/<书名>/` 一个目录：
 *   - `book.md` 是入口（多章书放目录，单文件书正文就在这里）
 *   - 同目录下其余 `.md` 是章节，按文件名排序（导入时写了 `01 ` 这样的序号前缀）
 *   - `cover.*` 是封面，`notes.md` 是批注，两者都不算章节
 *
 * 目录名就是书名——不从 frontmatter 里取，那样重命名书会导致目录和显示名对不上。
 */
export async function listBooks(root, shelfDir = DIRS.shelf) {
  let entries;
  try {
    entries = await listDir(root, shelfDir);
  } catch (e) {
    if (e.code === "ENOENT") return null; // null = 书架目录还不存在，界面显示建库引导
    throw e;
  }
  const books = [];
  for (const e of entries) {
    if (e.kind !== "dir") continue;
    const bookPath = `${e.path}/book.md`;
    const text = await readFileOrEmpty(root, bookPath);
    const { meta } = parseFrontmatter(text);
    const { chapters, cover } = await readBookDir(root, e.path);
    books.push({
      name: e.name,
      dir: e.path,
      bookPath,
      notePath: `${e.path}/notes.md`,
      author: meta.作者 || meta.author || "",
      status: meta.状态 || meta.status || "",
      tags: [].concat(meta.标签 || meta.tags || []).filter(Boolean),
      source: meta.来源 || "",
      // 资料（自己攒的，可改）还是藏书（别人写的，只读）。没写就按来源后缀推断
      kind: bookKind(meta),
      importedAt: meta.导入 || "",
      hasContent: !!text.trim(),
      cover,
      chapters,
      chapterCount: chapters.length,
      // 卡片墙上要有东西看。取正文前几行（跳过 frontmatter 和一级标题）当摘要。
      excerpt: excerptOf(text),
    });
  }
  return books;
}

/**
 * 洞察报告清单。**不只列文件名**——一张只有标题的卡片和一行列表没区别，
 * 卡片墙就白做了（这条是 CLAUDE.md 里对所有可读源的硬要求）。所以顺手把摘要、
 * 覆盖周期、字数、洞察卡张数一起读出来。
 *
 * 读全文而不是只 stat：报告一周一份、几十 KB，读一遍是毫秒级；建索引就要管失效和重建
 * （和 searchBook 同一个取舍）。
 *
 * ⚠️ **必须排掉伴生文件**，判据复用 `isChapterFile`。不排的话，你给某份报告写下第一条
 * 批注（落 `<同名>.notes.md`）之后，洞察页会凭空多出一张卡，标题是「2026-W33-社媒洞察.notes」——
 * 点开看到的是自己的批注。这和书架那个「正文像凭空消失了」是同一类 bug，只是换了个地方冒出来。
 */
export async function listInsights(root, dir) {
  let entries;
  try {
    entries = await fs.readdir(safeJoin(root, dir), { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return null; // 目录还没建 → 前端给「去跑一次」的引导，不是「空列表」
    throw e;
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !isChapterFile(e.name)) continue;
    const rel = `${dir}/${e.name}`;
    const raw = await readFileOrEmpty(root, rel);
    const { meta, body } = parseFrontmatter(raw);
    const st = await fs.stat(safeJoin(root, rel)).catch(() => null);
    out.push({
      name: e.name,
      path: rel,
      title: e.name.replace(/\.md$/i, ""),
      week: String(meta.week || ""),
      generatedAt: String(meta.generated_at || (st ? new Date(st.mtimeMs).toISOString() : "")),
      period: coverPeriod(body),
      preview: firstParagraph(body),
      // 字数只给原始计数，「多少分钟」由前端的 readStats 算——口径只写一处
      chars: body.replace(/\s/g, "").length,
      cards: (body.match(/^###\s*IC-/gm) || []).length,
    });
  }
  // 新的在前。周报文件名带 `2026-W33` 前缀，numeric 排序对它成立
  out.sort((a, b) => b.name.localeCompare(a.name, "zh", { numeric: true }));
  return out;
}

// 报告开头那行 `> **覆盖周期** 2026-08-05 — 2026-08-12　·　…`。
// 抓不到就返回空串，卡片那一行会退回「生成于 …」——**不猜**，猜错的日期比没有日期更糟。
function coverPeriod(body) {
  const m = body.match(/覆盖周期\D{0,4}(\d{4}-\d{2}-\d{2})\s*[—–\-~至]+\s*(\d{4}-\d{2}-\d{2})/);
  return m ? `${m[1]} — ${m[2]}` : "";
}

/**
 * 摘要 = 第一段**正文**。要跳过 H1、引用块（报告开头那两行是元信息）、表格和分隔线；
 * 标题行也跳过，因为「## 一页结论」这五个字本身不含任何信息。
 * 顺手把 Markdown 记号抹平——卡片上是纯文本，`**` 原样露出来很难看。
 */
function firstParagraph(body) {
  for (const block of String(body).split(/\r?\n\s*\r?\n/)) {
    const t = block.trim();
    if (!t || /^[#>|]/.test(t) || /^([-*_])\1{2,}$/.test(t)) continue;
    const plain = t
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (plain.length >= 20) return plain.slice(0, 200);
  }
  return "";
}

const COVER_RE = /^cover\.(jpe?g|png|webp|gif|avif)$/i;

/**
 * 这个 `.md` 算不算「一章」。
 *
 * **书目录里有三类不是章节的 `.md`**：`book.md`（入口/单篇书的正文）、`notes.md`（批注）、
 * `<章名>.highlights.md`（高亮）。判据必须**逐个文件名列全**，不能只写后缀规则——
 * 上一版只排掉了 `.notes.md`（带点前缀的那种），漏了目录里那个正牌的 `notes.md`，
 * 后果非常具体：
 *
 *   单篇书（只有 book.md）本来 chapterCount = 0，走「单篇」那条路直接打开 book.md。
 *   你在它上面写下第一条批注 → 目录里多了 notes.md → chapterCount 变成 1 →
 *   「唯一的一章」被认成 notes.md → 点开书看到的是自己的批注，**正文像凭空消失了**。
 *
 * 所以这个判据只写一处，`readBookDir` 和 `searchBook` 都用它，不各写各的正则。
 */
export function isChapterFile(name) {
  if (!/\.md$/i.test(name)) return false;
  if (/^(book|notes)\.md$/i.test(name)) return false;
  return !/\.(highlights|notes)\.md$/i.test(name);
}

// 一本书目录里的章节和封面。用 readdir 而不是 listDir：listDir 只回 .md，
// 封面是图片，走那条路永远看不见。
async function readBookDir(root, dir) {
  let entries;
  try {
    entries = await fs.readdir(safeJoin(root, dir), { withFileTypes: true });
  } catch {
    return { chapters: [], cover: "" };
  }
  const cover = entries.find((f) => f.isFile() && COVER_RE.test(f.name))?.name || "";
  // 章节 = 目录里的 `.md` 减去伴生文件（见 isChapterFile）
  const chapters = entries
    .filter((f) => f.isFile() && isChapterFile(f.name))
    .map((f) => f.name)
    // numeric 排序：没有它，「10 xxx」会排在「2 xxx」前面
    .sort((a, b) => a.localeCompare(b, "zh", { numeric: true }))
    .map((file, i) => ({
      order: i + 1,
      file,
      path: `${dir}/${file}`,
      title: file.replace(/\.md$/i, "").replace(/^\d+[\s.\-_]*/, "") || file.replace(/\.md$/i, ""),
    }));
  return { chapters, cover: cover ? `${dir}/${cover}` : "" };
}

// 卡片摘要：跳过 frontmatter 和一级标题，取前三行有字的
function excerptOf(text) {
  return parseFrontmatter(text)
    .body.split("\n")
    .filter((l) => l.trim() && !/^#\s/.test(l))
    .slice(0, 3)
    .join(" ")
    .slice(0, 160);
}

/**
 * 建一本书：目录 + book.md。
 * 传了 `content` 就是**导入**（把已有的 Markdown 放进来），没传就写一份空骨架。
 * 已存在就直接拒绝，不覆盖——用户的笔记不能被一次误点抹掉。
 */
export async function createBook(root, shelfDir, name, content = "") {
  const clean = String(name || "").trim().replace(/[\\/:*?"<>|]/g, "");
  if (!clean) throw Object.assign(new Error("书名不能为空"), { status: 400 });
  const dir = `${shelfDir}/${clean}`;
  const bookPath = `${dir}/book.md`;
  const abs = safeJoin(root, bookPath);
  try {
    await fs.access(abs);
    throw Object.assign(new Error(`「${clean}」已经在书架上了`), { status: 409 });
  } catch (e) {
    if (e.status === 409) throw e;
    if (e.code !== "ENOENT") throw e;
  }
  const body = String(content || "").trim();
  const head = `---\n作者: \n状态: 在读\n标签: []\n---\n\n`;
  // 导入的文件自己带 frontmatter 就别再套一层——套了会变成两块 --- 夹一坨，Obsidian 里直接乱掉
  const text = !body ? `${head}# ${clean}\n\n` : body.startsWith("---") ? `${body}\n` : `${head}${body}\n`;
  await atomicWrite(abs, text);
  return { name: clean, dir, bookPath, notePath: `${dir}/notes.md` };
}

/**
 * 高亮标记。存成 `<同名>.highlights.md`，**一条一行**：
 *
 *     - [黄] 被划过的那句原文
 *
 * 为什么是 Markdown 不是 JSON：这是**知识**，得能在 Obsidian 里搜到、能被双链引用。
 * 一行一条的列表在那边就是普通笔记，人也读得懂。
 *
 * 锚点是**原文文本本身**，不是字符偏移量。偏移量在书被重新导入（换个转换器版本）
 * 之后会整体错位，而那句话还在——按文本找，重导入不会让标记失效。
 */
const HL_COLORS = { 黄: "yellow", 绿: "green", 蓝: "blue", 粉: "pink" };
const HL_NAMES = Object.fromEntries(Object.entries(HL_COLORS).map(([k, v]) => [v, k]));

export async function readHighlights(root, rel) {
  const text = await readFileOrEmpty(root, rel);
  return text
    .split("\n")
    .map((line) => line.match(/^- \[(.)\]\s+(.+)$/))
    .filter(Boolean)
    .map((m, i) => ({ id: `h${i}`, color: HL_COLORS[m[1]] || "yellow", text: m[2].trim() }))
    .filter((h) => h.text);
}

export async function writeHighlights(root, rel, list) {
  const body = list.map((h) => `- [${HL_NAMES[h.color] || "黄"}] ${String(h.text).replace(/\s+/g, " ").trim()}`);
  // 全删光就把文件也收掉，别在 vault 里留一个空文件
  if (!body.length) {
    await fs.rm(safeJoin(root, rel), { force: true });
    return [];
  }
  await writeVaultFile(root, rel, `# 高亮\n\n${body.join("\n")}\n`);
  return readHighlights(root, rel);
}

/**
 * 在一本书里全文搜。
 *
 * 一本书拆成几十个文件之后，「那句关于杠杆的话在哪一章」就成了刚需——这是纸书翻不动、
 * 电子书才有的能力（readest 也把它当核心功能）。**在服务端读文件搜**，不是把整本书
 * 塞进浏览器再 filter：59 章的书几十万字，传过去光解析就卡一下。
 *
 * 不建索引：一本书几十个文件、几百 KB，直接读一遍是毫秒级；建索引就要考虑失效和重建，
 * 为这点数据量不值得。
 */
export async function searchBook(root, dir, query, { maxPerFile = 3, maxFiles = 40 } = {}) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const abs = safeJoin(root, dir);
  let names;
  try {
    names = (await fs.readdir(abs, { withFileTypes: true }))
      // 伴生文件排掉：搜到自己刚划的高亮列表毫无意义
      .filter((f) => f.isFile() && isChapterFile(f.name))
      .map((f) => f.name)
      .sort((a, b) => a.localeCompare(b, "zh", { numeric: true }));
  } catch {
    return [];
  }

  const out = [];
  for (const name of names.slice(0, maxFiles)) {
    const text = await readFileOrEmpty(root, `${dir}/${name}`);
    const hits = [];
    for (const line of text.split("\n")) {
      const i = line.toLowerCase().indexOf(q);
      if (i === -1) continue;
      // 命中处前后各留 40 字：只给一行的开头，看不出这句话在说什么
      const from = Math.max(0, i - 40);
      hits.push({
        text: (from ? "…" : "") + line.slice(from, i + q.length + 40).trim() + (i + q.length + 40 < line.length ? "…" : ""),
        at: i - from + (from ? 1 : 0),
        len: q.length,
      });
      if (hits.length >= maxPerFile) break;
    }
    if (hits.length) {
      out.push({
        file: name,
        path: `${dir}/${name}`,
        title: name.replace(/\.md$/i, "").replace(/^\d+[\s.\-_]*/, ""),
        hits,
      });
    }
  }
  return out;
}

/**
 * 下架一本书 = **整个目录移进 vault 的 `.trash/`**，不是删掉。
 *
 * 为什么不真删：这里面有你自己写的批注。Obsidian 自己的「删除到废纸篓」也是移进
 * `.trash/`，所以这跟你在 Obsidian 里删一本书是同一个动作、同一个地方能找回来——
 * 不用再学第二套规则。带上时间戳是为了同名书删两次不会撞在一起。
 *
 * `.trash` 以点开头，`listDir` 本来就跳过点开头的条目，不会又出现在书架上。
 */
export async function trashBook(root, dir) {
  const abs = safeJoin(root, dir);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (!rel || rel.startsWith("..")) throw Object.assign(new Error("路径不合法"), { status: 400 });
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isDirectory()) throw Object.assign(new Error("这本书不在书架上"), { status: 404 });

  const target = trashTarget(rel);
  const targetAbs = safeJoin(root, target);
  await fs.mkdir(path.dirname(targetAbs), { recursive: true });
  await fs.rename(abs, targetAbs);
  return { from: rel, to: target };
}

/**
 * 废纸篓里的落点。**路径压平成一段文件名 + 时间戳**：`.trash/` 底下不重建目录树，
 * 否则删两次同名的东西会撞在一起，而 Obsidian 的废纸篓也是平铺的。
 */
function trashTarget(rel) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `.trash/${rel.split("/").join("_")}-${stamp}`;
}

/**
 * 把一个**文件**移进 `.trash/`，用于流水线删除时连带清理 vault 里的归档。
 *
 * 和 `trashBook` 同一个落点，理由也一样：这跟你在 Obsidian 里删一个文件是同一个
 * 动作、同一个地方能找回来，不用学第二套规则。而且归档文件上可能有你加的批注和
 * 双链——真删的话，删素材会让引用它的稿件归档里那条 `[[素材]]` 变成死链，
 * 而 Obsidian 不报错，只是点不开。移进废纸篓，这个代价就是可逆的。
 *
 * ⚠️ **找不到文件回 `null`，不抛异常。** 调用方是删除流程，而 D1 那一行**已经删了**
 * ——这时候再抛一个异常出去，界面上就是「删除失败」，用户会再点一次、然后收到
 * 「not found」。归档本来就可能不存在（`vault_path` 为空、归档失败过、
 * 你自己在 Obsidian 里先删了），这些都不是错误。
 */
export async function trashFile(root, rel) {
  const abs = safeJoin(root, rel);
  const clean = path.relative(root, abs).split(path.sep).join("/");
  if (!clean || clean.startsWith("..")) throw Object.assign(new Error("路径不合法"), { status: 400 });
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isFile()) return null;

  const target = trashTarget(clean);
  const targetAbs = safeJoin(root, target);
  await fs.mkdir(path.dirname(targetAbs), { recursive: true });
  await fs.rename(abs, targetAbs);
  return { from: clean, to: target };
}

/**
 * 把刚下架的那本书原样搬回去（回执上的「撤销」）。
 *
 * 只做**刚刚那一次**的撤销，不做通用的「废纸篓管理」：翻废纸篓是 Obsidian 的活儿，
 * 这里只需要覆盖「点错了，马上想反悔」这一种情况。原位置已经被占了就拒绝，
 * 不覆盖——那说明期间又导了一本同名的。
 */
export async function restoreBook(root, from, to) {
  const src = safeJoin(root, to);
  const dst = safeJoin(root, from);
  if (!String(to).startsWith(".trash/")) throw Object.assign(new Error("只能从废纸篓里还原"), { status: 400 });
  if (await fileExists(root, from)) throw Object.assign(new Error("原来的位置已经被占了"), { status: 409 });
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(src, dst);
  return { from: to, to: from };
}

/**
 * 追加一条伴生批注到 <dir>/notes.md。
 * 格式见 docs/design.md 4.3——引用原文片段 + 正文 + 来源，Obsidian 里就是普通笔记。
 * 追加而不是重写：并发或崩溃时最多丢最后一条，不会把整份笔记覆盖掉。
 */
export async function appendNote(root, rel, { quote = "", body, source = "", quoteLimit = 300 }) {
  if (!String(body || "").trim()) throw Object.assign(new Error("批注内容为空"), { status: 400 });
  const abs = safeJoin(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });

  // 本地时区、补零到 2026-08-10 14:32。toLocaleString 给的是 2026-8-10，
  // 月份不补零的话笔记按标题排序会乱（10 月排在 2 月前面）。
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  // 每块之间必须空一行。Markdown 的 lazy continuation 会把紧跟在 `>` 后面的行
  // 一起吸进引用块里——批注正文和来源会看着像是原文的一部分，Obsidian 里也一样错。
  const blocks = [`## ${stamp}`];
  const maxQuote = Math.min(Math.max(Number(quoteLimit) || 300, 1), 4000);
  if (quote.trim()) blocks.push(`> ${quote.trim().slice(0, maxQuote).replace(/\s*\n+\s*/g, " ")}`);
  blocks.push(body.trim());
  if (source.trim()) blocks.push(`来源: ${source.trim()}`);

  await fs.appendFile(abs, `\n${blocks.join("\n\n")}\n`, "utf8");
  return { path: path.relative(root, abs).split(path.sep).join("/") };
}
