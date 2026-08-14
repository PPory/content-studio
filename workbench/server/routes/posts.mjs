// /api/posts → 已发布内容的事实层（一条内容一行）。
//
// 三个口子：读全部、导一份平台导出文件、手录一条。
// **导入分两步**（`?dry=1` 先看，再真写），因为解析器只能靠列名认字段，认错了不会报错。

import fs from "node:fs/promises";
import { json, fail, readJsonBody, readRawBody } from "../lib/http.mjs";
import { PLATFORMS, evaluatePostPerformance, guessPlatform, mergePosts, normalizeDate, normalizeNumber, parseExport, readPosts, writePosts } from "../lib/posts.mjs";
import { resolveInboxFile, scanInbox } from "../lib/inbox.mjs";
import { callWorker } from "../lib/worker.mjs";

const today = () => new Date().toISOString().slice(0, 10);

// 导入的公共部分：解析 → 合并 →（非预览时）写盘 → 回一份「我是怎么读它的」的自述。
// 拖进来的和从下载目录发现的走同一条路，不写两遍——两条路解析结果不一致才是最难查的 bug。
async function runImport(bytes, { filename, platform, dry }) {
  const parsed = parseExport(bytes, { filename, platform, today: today() });
  if (!parsed.rows.length) {
    throw Object.assign(new Error("这份文件里没有能用的行"), {
      status: 400,
      hint: `读到的表头是：${parsed.headers.slice(0, 8).join(" / ") || "（空）"}`,
    });
  }
  const { rows, added, updated } = mergePosts(await readPosts(), parsed.rows);
  if (!dry) await writePosts(rows);
  return {
    ok: true,
    dry,
    platform,
    added,
    updated,
    total: parsed.rows.length,
    mapping: parsed.mapping,
    unmapped: parsed.unmapped,
    warnings: parsed.warnings,
    skipped: parsed.skipped.slice(0, 5),
    skippedCount: parsed.skipped.length,
    // 预览给前 6 行：够看出「日期和标题有没有对上号」，又不至于把响应撑大
    preview: parsed.rows.slice(0, 6),
    rows: dry ? undefined : rows,
  };
}

export const postsRoutes = [
  {
    method: "GET",
    path: "/api/posts",
    async handler({ res }) {
      try {
        json(res, { ok: true, platforms: PLATFORMS, rows: await readPosts() });
      } catch (e) {
        fail(res, e.message);
      }
    },
  },
  {
    method: "POST",
    path: "/api/posts/publish",
    async handler({ env, req, res }) {
      try {
        const b = await readJsonBody(req);
        const date = normalizeDate(b.publishedAt);
        const platform = String(b.platform || "").trim();
        const title = String(b.title || "").trim();
        const url = String(b.url || "").trim();
        const doc = String(b.draftId || "").trim();
        if (!date || !platform || !title || !/^https?:\/\//i.test(url) || !doc) {
          return fail(res, "发布链接、时间、平台和稿件都不能为空", { status: 400 });
        }
        const row = { date, platform, title, url, extra: "", doc, synced: today() };
        for (const key of ["views", "likes", "comments", "collects", "shares"]) row[key] = normalizeNumber(b[key]);
        const existing = await readPosts();
        const performance = evaluatePostPerformance(existing, row);
        const worker = await callWorker(env, "publish", {
          method: "POST",
          body: {
            draftId: doc,
            url,
            publishedAt: new Date(b.publishedAt).toISOString(),
            metrics: Object.fromEntries(["views", "likes", "comments", "collects", "shares"].map((key) => [key, row[key]])),
            performance,
          },
        });
        if (!worker.data?.ok) return json(res, worker.data || { ok: false, error: "流水线没有确认发布记录" }, worker.status || 502);
        const merged = mergePosts(existing, [row]);
        await writePosts(merged.rows);
        json(res, { ok: true, rows: merged.rows, performance, feedbackStatus: worker.data.feedbackStatus, feedbackCreated: worker.data.feedbackCreated || 0 });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
  {
    // 导入一份导出文件。请求体是原始字节（和导入书籍同一套：只有一个文件，
    // 文件名和平台走 query 就够了，不值得为它引一个 multipart 解析器）。
    method: "POST",
    path: "/api/posts/import",
    async handler({ req, res, url }) {
      try {
        const filename = url.searchParams.get("filename") || "";
        const dry = url.searchParams.get("dry") === "1";
        const platform = (url.searchParams.get("platform") || guessPlatform(filename)).trim();
        if (!platform) {
          return fail(res, "不知道这份文件是哪个平台的", { status: 400, hint: "在上面的平台里选一个再导入" });
        }
        const bytes = await readRawBody(req, 40_000_000);
        if (!bytes.length) return fail(res, "文件是空的", { status: 400 });
        json(res, await runImport(bytes, { filename, platform, dry }));
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
  {
    // 下载文件夹里有什么还没导进来的。**只读、只看两个目录、只认表格文件。**
    method: "GET",
    path: "/api/posts/inbox",
    async handler({ env, res }) {
      try {
        json(res, { ok: true, ...(await scanInbox(env)) });
      } catch (e) {
        fail(res, e.message);
      }
    },
  },
  {
    // 导入下载文件夹里的某一份。**认 id 不认路径**：路径当参数等于开了个任意文件读取的口子。
    method: "POST",
    path: "/api/posts/inbox/import",
    async handler({ env, req, res, url }) {
      try {
        const b = await readJsonBody(req);
        const dry = url.searchParams.get("dry") === "1";
        const file = await resolveInboxFile(env, String(b.id || ""));
        if (!file) {
          return fail(res, "这个文件已经不在了", { status: 404, hint: "刷新一下重新扫描——多半是被移走或改名了" });
        }
        const platform = String(b.platform || guessPlatform(file.name) || "").trim();
        if (!platform) return fail(res, "不知道这份文件是哪个平台的", { status: 400, hint: "在卡片上选一个平台再导入" });
        json(res, await runImport(await fs.readFile(file.abs), { filename: file.name, platform, dry }));
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
  {
    method: "POST",
    path: "/api/posts",
    async handler({ req, res }) {
      try {
        const b = await readJsonBody(req);
        const date = normalizeDate(b.date);
        const platform = String(b.platform || "").trim();
        const title = String(b.title || "").trim();
        if (!date) return fail(res, "日期格式要是 YYYY-MM-DD", { status: 400 });
        if (!platform) return fail(res, "平台不能为空", { status: 400 });
        if (!title && !b.url) return fail(res, "标题和链接至少填一个", { status: 400, hint: "不然对不上是哪一篇" });

        const row = { date, platform, title, url: String(b.url || "").trim(), extra: "", doc: "", synced: today() };
        for (const k of ["views", "likes", "comments", "collects", "shares"]) row[k] = normalizeNumber(b[k]);

        const { rows } = mergePosts(await readPosts(), [row]);
        await writePosts(rows);
        json(res, { ok: true, platforms: PLATFORMS, rows });
      } catch (e) {
        fail(res, e.message);
      }
    },
  },
];
