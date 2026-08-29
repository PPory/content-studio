// /api/vault/* → 读写 Obsidian vault。
// 阅读区（书架）和批注写回都走这里；vault 是唯一的存储，工作台自己不留任何副本。

import path from "node:path";
import fs from "node:fs/promises";
import { json, fail, readJsonBody, readRawBody } from "../lib/http.mjs";
import {
  vaultRoot,
  safeJoin,
  listDir,
  listInsights,
  readFile,
  readFileOrEmpty,
  appendNote,
  listBooks,
  createBook,
  trashBook,
  restoreBook,
  searchBook,
  readHighlights,
  writeHighlights,
  writeVaultFile,
  writeDocBody,
  fileStamp,
  parseFrontmatter,
  setFrontmatterField,
  bookKind,
  BOOK_KINDS,
} from "../lib/vault.mjs";
import { DIRS, bookOfPath } from "../lib/vault-dirs.mjs";
import { importBook, safeName, SUPPORTED } from "../lib/books.mjs";
import { parseNotes, applyNoteEdit } from "../lib/notes.mjs";
import { readBookMarks, readRecentMarks } from "../lib/marks.mjs";
import { knowledgeCardLinks, saveKnowledgeCard } from "../lib/knowledge-cards.mjs";

// 目录名的单一真源在 vault-dirs.mjs，这里不再抄第二份。
const SHELF_DIR = DIRS.shelf;
const INSIGHT_DIR = DIRS.insight;
const MEDIA_DIR = DIRS.media;
// 书的 frontmatter（作者/状态/标签）**没有写入端点**：那些字段在 Obsidian 里直接就能改，
// 而工作台这边给的入口挨着「打开这本书」，一次误触改的是 vault 里的文件。
// 唯一的例外是「类型」（资料 / 藏书），见下面的 books/kind——它决定正文能不能改，
// 是**工作台自己的**开关，Obsidian 那边没有对应的概念。

// 图片只放行这几种。**白名单，不是黑名单**——这个端点会把 vault 里任意路径的文件
// 原样吐出来，靠后缀限制住「能被读走什么」是最后一道防线（第一道是 safeJoin）。
/**
 * 正文里能插的**视频**类型。和 `IMAGE_TYPES` 分开列：那张表同时是
 * `/api/vault/image` 的读取白名单，把视频混进去等于让那个端点也能吐视频，
 * 而它设的 `cache-control` 和响应方式都是按图片来的。
 */
const VIDEO_TYPES = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
};

const IMAGE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

function handleVaultError(res, e) {
  fail(res, e.message, { status: e.status || 500, hint: e.hint });
}

/**
 * 一份文档所属那本书的类型（资料 / 藏书）。
 *
 * 类型写在**整本书**的 `book.md` 上，不在章节文件里——一本书里第 5 章能改、
 * 第 6 章不能改是个没有意义的区分。所以这里从章节路径往上找一级的 book.md。
 * 不在书架里的文档（归档、别处的 md）返回空串，按可改处理。
 */
async function kindOfDoc(root, rel) {
  // 书名靠 `bookOfPath` 切，不自己数段数——书架现在是 `99 - 个人工作台/01 - 书架`
  // 两段，写死 `parts[0]` 的话这里会恒等于返回空串，而空串按「可改」处理：
  // **藏书的只读保护会静默失效**，不报错、界面上也看不出来。
  const book = bookOfPath(rel);
  if (!book) return "";
  const { meta } = parseFrontmatter(await readFileOrEmpty(root, `${SHELF_DIR}/${book}/book.md`));
  return bookKind(meta);
}

// 每条路由都套同一层错误转换，省得每个 handler 各写一遍 try/catch
function guard(fn) {
  return async (ctx) => {
    try {
      await fn(ctx);
    } catch (e) {
      handleVaultError(ctx.res, e);
    }
  };
}

export const vaultRoutes = [
  {
    method: "POST",
    path: "/api/vault/knowledge-card",
    handler: guard(async ({ env, req, res }) => {
      const card = await readJsonBody(req);
      json(res, { ok: true, card: await saveKnowledgeCard(vaultRoot(env), card) });
    }),
  },
  {
    method: "POST",
    path: "/api/vault/knowledge-card/links",
    handler: guard(async ({ env, req, res }) => {
      const { refs } = await readJsonBody(req);
      json(res, { ok: true, counts: await knowledgeCardLinks(vaultRoot(env), refs) });
    }),
  },
  {
    method: "GET",
    path: "/api/vault/tree",
    handler: guard(async ({ env, res, url }) => {
      const root = vaultRoot(env);
      const dir = url.searchParams.get("dir") || "";
      json(res, { ok: true, dir, items: await listDir(root, dir) });
    }),
  },
  {
    method: "GET",
    path: "/api/vault/file",
    handler: guard(async ({ env, res, url }) => {
      const root = vaultRoot(env);
      const rel = url.searchParams.get("path");
      if (!rel) return fail(res, "缺少 path 参数", { status: 400 });
      json(res, { ok: true, path: rel, content: await readFile(root, rel) });
    }),
  },
  {
    method: "GET",
    path: "/api/vault/insights",
    handler: guard(async ({ env, res }) => {
      const root = vaultRoot(env);
      const reports = await listInsights(root, INSIGHT_DIR);
      // reports 为 null = 洞察目录还没建，前端据此显示「去跑一次」的引导而不是「空列表」
      json(res, { ok: true, dir: INSIGHT_DIR, exists: reports !== null, reports: reports || [] });
    }),
  },
  {
    method: "GET",
    path: "/api/vault/books",
    handler: guard(async ({ env, res }) => {
      const root = vaultRoot(env);
      const books = await listBooks(root, SHELF_DIR);
      // books 为 null = 书架目录还没建，前端据此显示引导而不是「空书架」
      json(res, { ok: true, shelfDir: SHELF_DIR, exists: books !== null, books: books || [] });
    }),
  },
  {
    method: "POST",
    path: "/api/vault/books",
    handler: guard(async ({ env, req, res }) => {
      const root = vaultRoot(env);
      const { name, content } = await readJsonBody(req);
      json(res, { ok: true, book: await createBook(root, SHELF_DIR, name, content) });
    }),
  },
  {
    // 读一份文档的高亮
    method: "GET",
    path: "/api/vault/highlights",
    handler: guard(async ({ env, res, url }) => {
      const root = vaultRoot(env);
      const rel = url.searchParams.get("path");
      if (!rel) return fail(res, "缺少 path 参数", { status: 400 });
      json(res, { ok: true, path: rel, highlights: await readHighlights(root, rel) });
    }),
  },
  {
    /**
     * 一本书的全部标记（高亮 + 批注），按章排。
     *
     * ⚠️ **和上面那条 `/api/vault/highlights` 不是一回事**：那条读**一份文档**的高亮，
     * 给阅读区渲染正文里的 `<mark>` 用；这条读**一本书**的全部标记，
     * 给书详情页那一栏用。两者的消费者、粒度、以及合不合并批注都不同，
     * 合成一个端点的话，阅读区每开一章都要白读一遍整本书的 notes.md。
     *
     * 聚合规则全在 `lib/marks.mjs`，这里只做参数校验和转发。
     */
    method: "GET",
    path: "/api/vault/book-marks",
    handler: guard(async ({ env, res, url }) => {
      const root = vaultRoot(env);
      const dir = url.searchParams.get("dir");
      if (!dir) return fail(res, "缺少 dir 参数", { status: 400 });
      json(res, { ok: true, dir, ...(await readBookMarks(root, dir)) });
    }),
  },
  {
    /**
     * 跨书的「最近标注」——书架右栏。
     *
     * ⚠️ **只有批注排得出时间，高亮排不出**（高亮文件不记时间）。所以返回值里
     * `at` 为空的那些就是没时间的，**界面照实显示，不许给它编一个「刚刚」**。
     * 排序口径写在 `lib/marks.mjs` 的注释里。
     */
    method: "GET",
    path: "/api/vault/recent-marks",
    handler: guard(async ({ env, res, url }) => {
      const root = vaultRoot(env);
      const books = await listBooks(root, SHELF_DIR);
      // null = 书架目录还不存在。**不是错误**：界面显示建库引导，和 listBooks 同一条约定
      if (!books) return json(res, { ok: true, items: [], total: 0, shelfMissing: true });
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 12));
      json(res, { ok: true, ...(await readRecentMarks(root, books, limit)) });
    }),
  },
  {
    /**
     * 加 / 删一条高亮。**整份重写**，不是追加——删除必须能落地，而追加式写法删不掉东西。
     * 一份文档的高亮撑死几十条，重写一个几 KB 的文件比维护增量便宜得多。
     */
    method: "POST",
    path: "/api/vault/highlights",
    handler: guard(async ({ env, req, res }) => {
      const root = vaultRoot(env);
      const { path: rel, add, remove } = await readJsonBody(req);
      if (!rel) return fail(res, "缺少 path", { status: 400 });
      let list = await readHighlights(root, rel);
      if (add?.text) {
        const text = String(add.text).replace(/\s+/g, " ").trim();
        // 同一句划两次不该出两条：颜色以最后一次为准
        list = list.filter((h) => h.text !== text).concat({ color: add.color || "yellow", text });
      }
      if (remove?.text) {
        const text = String(remove.text).replace(/\s+/g, " ").trim();
        list = list.filter((h) => h.text !== text);
      }
      json(res, { ok: true, highlights: await writeHighlights(root, rel, list) });
    }),
  },
  {
    // 给书换封面。整块二进制原样写进 <书目录>/cover.<ext>
    method: "POST",
    path: "/api/vault/books/cover",
    handler: guard(async ({ env, req, res, url }) => {
      const root = vaultRoot(env);
      const dir = url.searchParams.get("dir") || "";
      const ext = (url.searchParams.get("ext") || ".jpg").toLowerCase();
      if (!dir.startsWith(`${SHELF_DIR}/`)) return fail(res, "只能给书架里的书换封面", { status: 400 });
      if (!IMAGE_TYPES[ext]) return fail(res, `封面只能是 ${Object.keys(IMAGE_TYPES).join(" / ")}`, { status: 400 });
      const bytes = await readRawBody(req, 12_000_000);
      if (!bytes.length) return fail(res, "文件是空的", { status: 400 });
      // 先把旧封面清掉：留着的话目录里会同时有 cover.jpg 和 cover.png，listBooks 取到哪个看运气
      for (const old of Object.keys(IMAGE_TYPES)) {
        await fs.rm(safeJoin(root, `${dir}/cover${old}`), { force: true });
      }
      const rel = await writeVaultFile(root, `${dir}/cover${ext}`, bytes);
      json(res, { ok: true, cover: rel });
    }),
  },
  {
    /**
     * 改一本书的类型（资料 / 藏书）。**写进 `book.md` 的 frontmatter**，不进 localStorage：
     * 这是关于这本书的事实，不是这台机器的偏好——Obsidian 那边也该看得见、也该能改。
     * 只动那一行，书的其余元信息一个字不碰。
     */
    method: "POST",
    path: "/api/vault/books/kind",
    handler: guard(async ({ env, req, res }) => {
      const root = vaultRoot(env);
      const { dir, kind } = await readJsonBody(req);
      if (!dir?.startsWith(`${SHELF_DIR}/`)) return fail(res, "只能改书架里的书", { status: 400 });
      if (!BOOK_KINDS.includes(kind)) return fail(res, `类型只能是 ${BOOK_KINDS.join(" / ")}`, { status: 400 });
      await setFrontmatterField(root, `${dir}/book.md`, "类型", kind);
      json(res, { ok: true, dir, kind });
    }),
  },
  {
    // 在一本书里全文搜。拆成几十章之后，「那句话在哪一章」是刚需
    method: "GET",
    path: "/api/vault/books/search",
    handler: guard(async ({ env, res, url }) => {
      const root = vaultRoot(env);
      const dir = url.searchParams.get("dir") || "";
      const q = url.searchParams.get("q") || "";
      if (!dir.startsWith(`${SHELF_DIR}/`)) return fail(res, "只能搜书架里的书", { status: 400 });
      json(res, { ok: true, q, results: await searchBook(root, dir, q) });
    }),
  },
  {
    // 下架一本书 = 整个目录移进 vault 的 .trash/，和你在 Obsidian 里删它是同一个地方。
    // 只认书架目录底下的路径：这个端点会移动整个目录，越界的代价太大。
    method: "POST",
    path: "/api/vault/books/trash",
    handler: guard(async ({ env, req, res }) => {
      const root = vaultRoot(env);
      const { dir } = await readJsonBody(req);
      if (!dir || !String(dir).startsWith(`${SHELF_DIR}/`)) {
        return fail(res, "只能下架书架里的书", { status: 400 });
      }
      json(res, { ok: true, ...(await trashBook(root, dir)) });
    }),
  },
  {
    // 撤销刚才那次下架。只覆盖「点错了马上反悔」，翻废纸篓是 Obsidian 的活儿
    method: "POST",
    path: "/api/vault/books/restore",
    handler: guard(async ({ env, req, res }) => {
      const root = vaultRoot(env);
      const { from, to } = await readJsonBody(req);
      if (!from || !to) return fail(res, "缺少 from / to", { status: 400 });
      json(res, { ok: true, ...(await restoreBook(root, from, to)) });
    }),
  },
  {
    // 导入一本书：请求体是原始文件字节，书名和文件名走 query。
    // 解析（epub 解 zip、pdf 抽文字、拆章、抽封面）全在服务端做，见 lib/books.mjs。
    method: "POST",
    path: "/api/vault/books/import",
    handler: guard(async ({ env, req, res, url }) => {
      const root = vaultRoot(env);
      const fileName = url.searchParams.get("filename") || "";
      const name = url.searchParams.get("name") || "";
      if (!fileName) return fail(res, "缺少 filename 参数", { status: 400 });
      const bytes = await readRawBody(req);
      if (!bytes.length) return fail(res, "文件是空的", { status: 400 });
      json(res, { ok: true, book: await importBook(root, SHELF_DIR, { fileName, name, bytes }), supported: SUPPORTED });
    }),
  },
  {
    /**
     * 正文里插图片 / 视频 / GIF。**文件落进 vault，正文里只留相对路径。**
     *
     * 为什么落 vault 而不是跟着稿件走云端：这些是你自己的素材，Obsidian 那边也该看得见、
     * 也该能自己整理。**代价要说清楚**——只存本地的图，稿件发布到平台时取不到，
     * 发布链路要单独处理一次（当前还没有）。
     *
     * 路径按年月分子目录：一个目录几万个文件时 Obsidian 的索引会很慢。
     * 文件名带一段随机后缀，避免同名截图互相覆盖。
     */
    method: "POST",
    path: "/api/vault/media",
    handler: guard(async ({ env, req, res, url }) => {
      const root = vaultRoot(env);
      const ext = (url.searchParams.get("ext") || "").toLowerCase();
      const type = IMAGE_TYPES[ext] || VIDEO_TYPES[ext];
      if (!type) return fail(res, `只能插入 ${[...Object.keys(IMAGE_TYPES), ...Object.keys(VIDEO_TYPES)].join(" / ")}`, { status: 400 });
      const bytes = await readRawBody(req, 64_000_000);
      if (!bytes.length) return fail(res, "文件是空的", { status: 400 });
      const stamp = new Date();
      const month = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}`;
      const stem = safeName(url.searchParams.get("name") || "media");
      const unique = `${stem}-${stamp.getTime().toString(36)}${ext}`;
      const rel = await writeVaultFile(root, `${MEDIA_DIR}/${month}/${unique}`, bytes);
      json(res, { ok: true, path: rel, kind: VIDEO_TYPES[ext] ? "video" : "image" });
    }),
  },
  {
    // 封面和正文插图。图片是二进制，走不了 { ok, ... } 那套 JSON 契约，
    // 所以这条路由自己处理错误：失败回 404 空响应，<img> 自己会走 onerror。
    method: "GET",
    path: "/api/vault/image",
    handler: async ({ env, res, url }) => {
      try {
        const rel = url.searchParams.get("path") || "";
        const type = IMAGE_TYPES[path.extname(rel).toLowerCase()];
        if (!type) return res.writeHead(404).end();
        const buf = await fs.readFile(safeJoin(vaultRoot(env), rel));
        res.writeHead(200, { "content-type": type, "cache-control": "private, max-age=3600" });
        res.end(buf);
      } catch {
        res.writeHead(404).end();
      }
    },
  },
  {
    /**
     * 正文里插入的视频。**和 `/api/vault/image` 分开**：那条的白名单只有图片，
     * 而它把 vault 里任意路径的文件原样吐出来——白名单就是最后一道防线，不能掺。
     * 视频要支持 Range 请求，否则浏览器只能整段下完才播。
     */
    method: "GET",
    path: "/api/vault/media-file",
    handler: async ({ env, req, res, url }) => {
      try {
        const rel = url.searchParams.get("path") || "";
        const ext = path.extname(rel).toLowerCase();
        const type = VIDEO_TYPES[ext] || IMAGE_TYPES[ext];
        if (!type) return res.writeHead(404).end();
        const abs = safeJoin(vaultRoot(env), rel);
        const stat = await fs.stat(abs);
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
        if (range && VIDEO_TYPES[ext]) {
          const start = range[1] ? Number(range[1]) : 0;
          const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
          if (start >= stat.size || end < start) {
            return res.writeHead(416, { "content-range": `bytes */${stat.size}` }).end();
          }
          const handle = await fs.open(abs, "r");
          const buf = Buffer.alloc(end - start + 1);
          await handle.read(buf, 0, buf.length, start);
          await handle.close();
          res.writeHead(206, {
            "content-type": type,
            "content-length": buf.length,
            "content-range": `bytes ${start}-${end}/${stat.size}`,
            "accept-ranges": "bytes",
          });
          return res.end(buf);
        }
        const buf = await fs.readFile(abs);
        res.writeHead(200, { "content-type": type, "content-length": buf.length, "accept-ranges": "bytes", "cache-control": "private, max-age=3600" });
        res.end(buf);
      } catch {
        res.writeHead(404).end();
      }
    },
  },
  {
    // 一次把正文和伴生批注都取回来：阅读页两样都要，分两个请求只会让首屏闪一下
    method: "GET",
    path: "/api/vault/doc",
    handler: guard(async ({ env, res, url }) => {
      const root = vaultRoot(env);
      const rel = url.searchParams.get("path");
      if (!rel) return fail(res, "缺少 path 参数", { status: 400 });
      const notePath = url.searchParams.get("notePath") || "";
      const raw = await readFileOrEmpty(root, rel);
      const { meta, body } = parseFrontmatter(raw);
      const notes = notePath ? await readFileOrEmpty(root, notePath) : "";
      json(res, {
        ok: true,
        path: rel,
        meta,
        content: body,
        // 编辑要回带这个版本号：这些 md 同时也在 Obsidian 里开着，
        // 不对一下就整份重写的话，那边刚写的段落会被安静地抹掉
        stamp: await fileStamp(root, rel),
        notePath,
        notes,
        // 切成一条条的，界面才能给每条配「改」和「删」。认不出格式就是空数组，
        // 那时候界面退回只读渲染——不能自作主张把用户手写的文件重排一遍。
        noteItems: parseNotes(notes),
      });
    }),
  },
  {
    /**
     * 改一份文档的正文。**书架里的书就是 vault 里的 md，本来就该能改**——
     * 自己收集整理的资料需要边读边补，而「去 Obsidian 里改」意味着离开正在读的这一屏、
     * 在另一个应用里找到同一个文件、改完再回来刷新。
     *
     * 三条约束：
     * - **frontmatter 原样保留**（`writeDocBody`）。给出去的是去掉 frontmatter 的正文，
     *   存回来的也只有正文；不保留的话，第一次保存就把作者/状态/标签抹了。
     * - **带 stamp 做乐观锁**。这些文件的主编辑器其实是 Obsidian，对不上就 409 让人刷新，
     *   宁可多点一下也不能拿旧内容覆盖新的。
     * - **只改正文，不改文件名**。文件名是章节标题，同时还是阅读进度、高亮伴生文件
     *   （`<同名>.highlights.md`）和 Obsidian 双链的锚点——改名要一起搬这四样东西。
     */
    method: "POST",
    path: "/api/vault/doc",
    handler: guard(async ({ env, req, res }) => {
      const root = vaultRoot(env);
      const { path: rel, content, stamp } = await readJsonBody(req);
      if (!rel) return fail(res, "缺少 path", { status: 400 });
      if (typeof content !== "string") return fail(res, "缺少 content", { status: 400 });
      // 藏书只读。**规则落在服务端**，不只在前端不画按钮——前端那层是给人看的，
      // 这一层才是真的拦得住（开着的旧标签页、以后别的调用方都会经过这里）
      const guardKind = await kindOfDoc(root, rel);
      if (guardKind === "藏书") {
        return fail(res, "这本是藏书，正文只读", {
          status: 403,
          hint: "藏书是别人写的字，改了之后从它摘的引用就不可信了。确实要改的话，去书详情把类型改成「资料」。",
        });
      }
      const now = await fileStamp(root, rel);
      if (stamp && now && stamp !== now) {
        return fail(res, "这份文件在别处改过了", {
          status: 409,
          hint: "多半是 Obsidian 那边动过。关掉编辑重新打开这一章，改动就在了——别拿旧内容盖掉新的。",
        });
      }
      const body = await writeDocBody(root, rel, content);
      json(res, { ok: true, path: rel, content: body, stamp: await fileStamp(root, rel) });
    }),
  },
  {
    method: "POST",
    path: "/api/vault/note",
    handler: guard(async ({ env, req, res }) => {
      const root = vaultRoot(env);
      const body = await readJsonBody(req);
      if (!body.path) return fail(res, "缺少 path（要追加到哪个 notes.md）", { status: 400 });
      const r = await appendNote(root, body.path, body);
      const notes = await readFileOrEmpty(root, body.path);
      json(res, { ok: true, ...r, notes, noteItems: parseNotes(notes) });
    }),
  },
  {
    /**
     * 改一条 / 删一条批注。**整份重写**，和高亮同一个理由：删除必须能落地，
     * 而追加式写法删不掉东西。一份笔记撑死几十条，重写几 KB 比维护增量便宜。
     *
     * 带 `stamp` 做乐观锁：对不上就 409，让人刷新——宁可多点一下，
     * 也不能拿旧的下标去删掉别的段落。
     */
    method: "POST",
    path: "/api/vault/note/edit",
    handler: guard(async ({ env, req, res }) => {
      const root = vaultRoot(env);
      const body = await readJsonBody(req);
      if (!body.path) return fail(res, "缺少 path", { status: 400 });
      if (!Number.isInteger(body.index)) return fail(res, "缺少 index", { status: 400 });
      const before = await readFileOrEmpty(root, body.path);
      const after = applyNoteEdit(before, {
        index: body.index,
        body: body.body,
        remove: !!body.remove,
        expect: body.stamp || "",
      });
      await writeVaultFile(root, body.path, after);
      json(res, { ok: true, notes: after, noteItems: parseNotes(after) });
    }),
  },
];
