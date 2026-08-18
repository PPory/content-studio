/**
 * 全局检索。**本地轻量检索，不建搜索平台。**
 *
 * 要回答的是「那个东西在哪」——它可能是一本书里的一句话、一张素材卡、一条已发布作品，
 * 也可能是三周前那份洞察报告。分散在四处（Notion 四库 / vault / posts.csv / 热点快照），
 * 而人不该记得它当初存在哪儿。
 *
 * 三条实现上的取舍：
 *
 *  - **vault 侧建索引、Notion 侧不建。** vault 是本地文件，按 mtime 增量重读，
 *    改过的才重新读；Notion 在网络那头，一次 list 就是一个来回，只能整批缓存一小会儿。
 *  - **索引存正文，不存倒排。** 建倒排要管中文分词、失效和重建，而这里的量级是
 *    几十 MB 文本、几百个文件——`indexOf` 扫一遍是毫秒级。**先量再优化**。
 *  - **结果必须带「怎么继续」**（`go`），不是只给一个标题。搜到之后还要自己想
 *    「这条在哪个页面」的话，检索就只做了一半。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin, vaultRoot, parseFrontmatter } from "./vault.mjs";
import { callWorker } from "./worker.mjs";
import { readPosts } from "./posts.mjs";
import { DIRS, WB_ROOT, bookOfPath } from "./vault-dirs.mjs";

// vault 里值得被搜的目录。**不扫整个 vault**：那里面还有日记、模板、附件，
// 搜出来只会把真正要找的东西挤下去。加目录就在这里加一行。
const VAULT_DIRS = [
  { dir: DIRS.shelf, type: "book", label: "书" },
  { dir: DIRS.insight, type: "insight", label: "洞察" },
  { dir: DIRS.archive, type: "archive", label: "归档" },
  { dir: DIRS.webnote, type: "webnote", label: "网页批注" },
  { dir: DIRS.knowledge, type: "knowledge", label: "知识卡片" },
];

const MAX_FILE_BYTES = 400_000; // 单个文件超过这个就只索引开头，整本书塞进内存不值得
const NOTION_TTL = 90_000;      // Notion 列表缓存。热点是分钟级的，这几个库是小时级的
const NOTION_PAGE = 100;

// path → { mtime, size, title, text, type, dir }
const fileIndex = new Map();
let indexedAt = 0;
const notionCache = new Map(); // view → { at, items }

async function walk(root, rel, out, depth = 0) {
  if (depth > 4) return; // 书架是 书架/<书名>/<章>.md，四层足够；再深多半是附件目录
  let entries;
  try {
    entries = await fs.readdir(safeJoin(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(root, child, out, depth + 1);
    else if (e.name.toLowerCase().endsWith(".md")) out.push(child);
  }
}

/**
 * 增量刷新 vault 索引：只重读 mtime 变过的文件。
 *
 * 每次搜索都全量重读的话，一次搜索就是几百次磁盘 IO，边打字边搜会明显卡；
 * 而只在启动时建一次的话，你刚在 Obsidian 里写的东西搜不到——那正是最想搜到的。
 */
async function refreshVault(root) {
  const seen = new Set();
  for (const { dir, type } of VAULT_DIRS) {
    const files = [];
    await walk(root, dir, files);
    for (const rel of files) {
      seen.add(rel);
      let st;
      try {
        st = await fs.stat(safeJoin(root, rel));
      } catch {
        continue;
      }
      const prev = fileIndex.get(rel);
      if (prev && prev.mtime === st.mtimeMs) continue;
      let text = "";
      try {
        const fh = await fs.open(safeJoin(root, rel), "r");
        const buf = Buffer.alloc(Math.min(st.size, MAX_FILE_BYTES));
        await fh.read(buf, 0, buf.length, 0);
        await fh.close();
        text = buf.toString("utf8");
      } catch {
        continue;
      }
      const { meta, body } = parseFrontmatter(text);
      fileIndex.set(rel, {
        mtime: st.mtimeMs,
        at: st.mtime.toISOString(),
        title: path.basename(rel).replace(/\.md$/i, ""),
        meta,
        text: body,
        type,
        truncated: st.size > MAX_FILE_BYTES,
      });
    }
  }
  // 删掉的文件要从索引里去掉，否则搜出来的是一条打不开的结果
  for (const key of fileIndex.keys()) if (!seen.has(key)) fileIndex.delete(key);
  indexedAt = Date.now();
}

export async function notionList(env, view, q = "") {
  const cacheKey = `${view}:${String(q).trim().toLowerCase()}`;
  const hit = notionCache.get(cacheKey);
  if (hit && Date.now() - hit.at < NOTION_TTL) return hit.items;
  try {
    const search = q
      ? `q=${encodeURIComponent(q)}&limit=${NOTION_PAGE}`
      : `pageSize=${NOTION_PAGE}`;
    const r = await callWorker(env, q ? `search/${view}` : `list/${view}`, { search });
    const items = r.data?.ok ? r.data.items || [] : [];
    notionCache.set(cacheKey, { at: Date.now(), items });
    return items;
  } catch {
    // 上游挂了就用上一次的（哪怕过期），比整块搜不到强
    return hit?.items || [];
  }
}

/**
 * 命中判定。**词与词之间是「都要有」，不要求连着**——中文里「杠杆 复利」这种
 * 两个词分别出现在标题和正文里的情况非常常见，要求连续等于搜不到。
 */
function matcher(q) {
  const terms = String(q || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  if (!terms.length) return null;
  return (hay) => {
    const s = String(hay || "").toLowerCase();
    return terms.every((t) => s.includes(t));
  };
}

/** 命中处前后各截一段，让人一眼看出为什么这条被搜到了。 */
function snippet(text, q, len = 90) {
  // Notion 里有些字段存的是**字面的反斜杠 n 两个字符**（LLM 生成 JSON 时转义了两遍）。
  // 摘要就一行，还原成真换行没意义；但原样留着，句子中间就杵着一串「\nStep 3」。
  // 折成空格即可。正文那边的还原规则在 `src/lib/sources.js`——那儿要保留段落，所以不同。
  const s = String(text || "")
    .replace(/\\[nt]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const first = String(q || "").toLowerCase().split(/\s+/).filter(Boolean)[0] || "";
  const i = first ? s.toLowerCase().indexOf(first) : -1;
  if (i < 0) return s.slice(0, len);
  const from = Math.max(0, i - Math.floor(len / 3));
  return (from ? "…" : "") + s.slice(from, from + len) + (from + len < s.length ? "…" : "");
}

/**
 * 一本书的目录名就是它在书架上的 key。判据在 `vault-dirs.mjs`——
 * 这里原来是 `split("/")[1]`，书架变成两段路径之后那个下标就指到「01 - 书架」上了。
 */
const bookOf = bookOfPath;

export async function searchAll(env, q, { limit = 40 } = {}) {
  const hit = matcher(q);
  if (!hit) return { ok: true, q: "", results: [], sources: [] };

  const results = [];
  const sources = [];

  // ---- vault ----------------------------------------------------------------
  try {
    const root = vaultRoot(env);
    await refreshVault(root);
    sources.push({ key: "vault", ok: true, count: fileIndex.size });
    for (const [rel, f] of fileIndex) {
      const inTitle = hit(f.title);
      if (!inTitle && !hit(f.text)) continue;
      const book = f.type === "book" ? bookOf(rel) : "";
      // 一本书的入口文件（book.md）和它的章节要分开说：搜到章节时要直接开那一章
      const isEntry = f.type === "book" && path.basename(rel) === "book.md";
      results.push({
        id: `vault:${rel}`,
        type: f.type,
        typeLabel: f.type === "book" ? (isEntry ? "书" : "章节") : VAULT_DIRS.find((d) => d.type === f.type)?.label || "文件",
        title: isEntry ? book : f.title,
        // 掐掉工作台那一级：它在每条 vault 结果里都一样，而检索结果那行本来就窄。
        // **只动这个显示串**——`go.open` 和 `path` 必须留完整路径，那两个是要拿去开文件的。
        source: f.type === "book" ? (isEntry ? "书架" : `《${book}》`) : rel.replace(`${WB_ROOT}/`, ""),
        state: f.meta?.状态 || "",
        updatedAt: f.at,
        snippet: snippet(inTitle ? f.text : f.text, q),
        // 书跳书架（详情或直接进正文由书架自己判断），其余走对应的页面
        /**
         * `go` 要能把人送到**那一条**，不只是那一页。
         *  - 书 → 书架，`state` 是书目录（书架自己会认，单篇书直接进正文）
         *  - 洞察 → 洞察页 + `open`（列表里的 key 就是这个相对路径）
         *  - 归档 / 网页批注 → 工作台里**没有**它们的页面，所以给 vault 路径，
         *    由前端开 `obsidian://`。**不画一个点了没反应的行**。
         */
        go:
          f.type === "book"
            ? // 搜到的是某一章时把**章节路径**一起带上：只跳到书详情的话，
              // 人还要在五十九章里再找一遍——那正是他刚才用检索想省掉的那一步。
              { view: "shelf", state: book, ...(isEntry ? {} : { open: rel }) }
            : f.type === "insight"
              ? { view: "insights", open: rel }
              : { vaultPath: rel },
        path: rel,
        truncated: f.truncated,
        score: inTitle ? 3 : 1,
      });
    }
  } catch (e) {
    sources.push({ key: "vault", ok: false, error: e.message });
  }

  // ---- Notion 四库 -----------------------------------------------------------
  const VIEWS = [
    { view: "collections", label: "收件箱" },
    { view: "inbox", label: "灵感库" },
    { view: "materials", label: "素材库" },
    { view: "topics", label: "选题库" },
    { view: "drafts", label: "稿件库" },
  ];
  if ((env.WORKER_URL || "").trim()) {
    const lists = await Promise.all(VIEWS.map((v) => notionList(env, v.view, q)));
    lists.forEach((items, i) => {
      const { view, label } = VIEWS[i];
      sources.push({ key: view, ok: true, count: items.length });
      for (const p of items) {
        const inTitle = hit(p.title);
        const body = [p.note, p.source, p.link, (p.tags || []).join(" ")].filter(Boolean).join(" ");
        if (!inTitle && !hit(body)) continue;
        results.push({
          id: `${view}:${p.id}`,
          type: view,
          typeLabel: label,
          title: p.title || "（无标题）",
          source: p.source || p.platform || p.type || "",
          state: p.status || "",
          updatedAt: p.editedAt || "",
          snippet: snippet(p.note || body, q),
          // **带状态、也带条目 id 跳过去。** 只带状态的话点进去只是一张过滤好的列表，
          // 而你搜的是那一条；不带状态的话会落在那个库的默认档上，你要找的那条
          // 恰好不在默认档里，等于搜了个寂寞。
          go: { view, state: p.status || "", open: p.id },
          score: inTitle ? 3 : 1,
        });
      }
    });
  } else {
    sources.push({ key: "notion", ok: false, error: "未配置 WORKER_URL" });
  }

  // ---- 已发布作品 -------------------------------------------------------------
  try {
    const posts = await readPosts();
    sources.push({ key: "posts", ok: true, count: posts.length });
    for (const p of posts) {
      if (!hit([p.title, p.platform, p.url].filter(Boolean).join(" "))) continue;
      results.push({
        id: `post:${p.url || `${p.platform}-${p.date}-${p.title}`}`,
        type: "post",
        typeLabel: "已发布",
        title: p.title || "（无标题）",
        source: [p.platform, p.date].filter(Boolean).join(" · "),
        state: "已发布",
        updatedAt: p.date || "",
        snippet: [p.views != null && `阅读 ${p.views}`, p.likes != null && `赞 ${p.likes}`].filter(Boolean).join(" · "),
        go: { view: "metrics" },
        url: p.url || "",
        score: 2,
      });
    }
  } catch (e) {
    sources.push({ key: "posts", ok: false, error: e.message });
  }

  // 标题命中排前面，同分按时间新的在前。**不按「相关度」算分**——
  // 那需要一套词频统计，而这里的结果量级是几十条，多一层玄学排序只会让人找不到刚看过的那条。
  results.sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { ok: true, q, results: results.slice(0, limit), total: results.length, sources, indexedAt };
}
