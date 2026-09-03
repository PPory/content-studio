/**
 * 从公开讨论里找真实用户声音，提成候选。
 *
 * 这条通路补的是证据层唯一的入口：在这之前，`audience_raw_sources` 只能靠手动粘贴，
 * 于是「AI 负责寻找」在整条链的**第一步**就断了。
 *
 * ⚠️ **抓回来的正文一个字都不许改。** 证据层的全部价值在于「这句话确实是这么说的」；
 * 只要正文经过模型转述，后面所有逐字校验都在校验一份二手材料。所以模型在这里
 * 只回答一个问题——**这一页里有没有真实的人在提问题**——并且必须用原文引证，
 * 引不出来的整页丢掉。
 *
 * ⚠️ **这里不写库。** 返回的是候选，入库仍然走 `POST /api/workspace/audience-voices`
 * 那道确认闸。抓取本身不构成「用户认可这是证据」。
 */

import crypto from "node:crypto";
import { completeJson } from "../lib/model-json.mjs";
import { tinyfishFetch, tinyfishSearch, monidConfigured } from "../lib/tinyfish.mjs";
import { sourceContainsVerbatim } from "./integrity.mjs";
import { AUDIENCE_RAW_KINDS, normalizeRawBody } from "./audience-raw.mjs";

const clean = (value, max = 4_000) => String(value ?? "").trim().slice(0, max);

/** 一页正文的上限。太长的页面多半是聚合页，不是一场讨论。 */
const PAGE_LIMIT = 60_000;
/** 一页至少要引得出这么多条原话，才算「这里有人在说话」。 */
const MIN_PROOF = 2;
/** 一次最多抓几页。TinyFish 单次上限是 10，留出余量给失败重试。 */
const DEFAULT_PAGES = 5;

const KIND_SET = new Set(AUDIENCE_RAW_KINDS.map((item) => item.key));

/**
 * 已知能抓到评论的站点。
 *
 * ⚠️ **这不是偏好，是实测边界。** 知乎问题页回 403，知乎专栏和小红书只回登录墙——
 * API 这条路在中文平台上是走不通的，那些要走浏览器扩展（你自己的登录态）。
 * 把这件事写成常量而不是提示词，是为了让「哪些平台现在拿不到」有一个可以被检验的答案。
 */
export const HARVEST_DOMAINS = Object.freeze({
  discussion: "reddit.com,news.ycombinator.com,x.com,quora.com,stackexchange.com",
});

/** API 抓不到、只能靠扩展的站点。命中时如实说明，不要假装抓了。 */
const WALLED = [
  { pattern: /(^|\.)zhihu\.com$/i, label: "知乎" },
  { pattern: /(^|\.)xiaohongshu\.com$/i, label: "小红书" },
  { pattern: /(^|\.)weibo\.(com|cn)$/i, label: "微博" },
  { pattern: /(^|\.)douyin\.com$/i, label: "抖音" },
  { pattern: /(^|\.)bilibili\.com$/i, label: "B 站" },
];

export function walledPlatform(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  return WALLED.find((item) => item.pattern.test(host))?.label || null;
}

function contentHash(text) {
  return crypto.createHash("sha256").update(normalizeRawBody(text)).digest("hex");
}

/** 这段正文是不是已经记过了。让界面能照实说「这条之前就在库里」，而不是重复入库。 */
function existingVoice(db, text) {
  return db.prepare(`SELECT r.id, r.ingested_at AS ingestedAt FROM audience_raw_sources r
    JOIN entities e ON e.id = r.id AND e.deleted_at IS NULL
    WHERE r.content_sha256 = ? LIMIT 1`).get(contentHash(text)) || null;
}

function completionFor(env) {
  return typeof env?.AUDIENCE_HARVEST_COMPLETE_JSON === "function"
    ? env.AUDIENCE_HARVEST_COMPLETE_JSON
    : completeJson;
}

function judgeSystemPrompt() {
  return [
    "你在判断一个网页里有没有**真实的人在提出他们自己的问题、困惑或抱怨**。",
    "",
    "⚠️ 作者本人写的文章、教程、产品介绍、新闻报道都**不算**。那是供给面，不是需求面。",
    "⚠️ 算的是：评论区、论坛回帖、提问、吐槽——某个具体的人说出他自己的处境。",
    `⚠️ 每一页你必须从**原文里逐字摘出至少 ${MIN_PROOF} 句**作为证据，一个字都不能改、不能翻译、不能省略中间。`,
    "⚠️ 摘不出来就把 has_voice 设成 false。这是合格结果，不要为了凑数去转述。",
    "",
    "kind 从这里选：comment（评论/回帖）、post（帖子正文本身就是求助或吐槽）、feedback（针对某个东西的反馈）、other。",
    "summary 用一句中文说这一页里的人在为什么发愁。",
    "只输出 JSON。",
    JSON.stringify({
      pages: [{ url: "", has_voice: true, kind: "comment", summary: "", quotes: [""] }],
    }),
  ].join("\n");
}

function describePages(pages) {
  return pages.map((page, index) => [
    `## 第 ${index + 1} 页`,
    `url: ${page.url}`,
    `title: ${page.title}`,
    "正文：",
    page.text,
  ].join("\n")).join("\n\n---\n\n");
}

/**
 * 收一页的判断。
 *
 * ⚠️ **引文必须在抓回来的正文里逐字存在。** 这一步是整条通路的硬闸：
 * 模型很容易把评论顺手改通顺再引，读起来毫无破绽，但那句话没人说过。
 */
function normalizePageJudgement(item, byUrl) {
  const url = clean(item?.url, 2_000);
  const page = byUrl.get(url);
  if (!page) return { dropped: { url: url || "（无 url）", reason: "指向一个没有抓取过的链接" } };
  if (item?.has_voice === false) {
    return { dropped: { url, reason: clean(item?.summary, 200) || "这一页没有真实用户在提问题" } };
  }

  const quotes = (Array.isArray(item?.quotes) ? item.quotes : [])
    .map((quote) => clean(quote, 1_000))
    .filter((quote) => quote && sourceContainsVerbatim(page.text, quote));
  const unique = [...new Set(quotes)];
  if (unique.length < MIN_PROOF) {
    return { dropped: { url, reason: `引不出 ${MIN_PROOF} 句原文里真实存在的话（对上 ${unique.length} 句）` } };
  }

  const kind = clean(item?.kind, 40);
  return {
    candidate: {
      url,
      title: page.title,
      siteName: page.siteName,
      language: page.language,
      kind: KIND_SET.has(kind) ? kind : "comment",
      summary: clean(item?.summary, 500),
      quotes: unique.slice(0, 5),
      /** 要存进证据层的正文。就是抓回来那一段，没有经过任何改写。 */
      body: page.text,
      length: page.text.length,
      duplicateOf: page.duplicateOf,
    },
  };
}

/**
 * 找候选：搜 → 抓 → 判断有没有人在说话。
 *
 * 返回的每一条都可以直接送进 `POST /api/workspace/audience-voices`，
 * 但送不送、送哪几条，是用户的决定。
 */
export async function harvestVoiceCandidates(env, workspace, {
  query, includeDomains = HARVEST_DOMAINS.discussion, language = "", location = "", pages = DEFAULT_PAGES,
} = {}) {
  if (!monidConfigured(env)) {
    throw Object.assign(new Error("还没有配置公开讨论的抓取通路"), {
      status: 503,
      hint: "在 workbench/.env 里加 MONID_API_KEY。TinyFish 的搜索和抓取不计费。",
    });
  }
  const q = clean(query, 400);
  if (!q) throw Object.assign(new Error("要先说找什么"), { status: 400 });
  const wanted = Math.max(1, Math.min(8, Number(pages) || DEFAULT_PAGES));

  const search = await tinyfishSearch(env, {
    query: q,
    purpose: "找真实用户在公开讨论里说出的问题和困惑，用于内容选题的证据",
    includeDomains, language, location,
  });

  const walled = [];
  const targets = [];
  for (const row of search.results) {
    const label = walledPlatform(row.url);
    if (label) { walled.push({ url: row.url, title: row.title, platform: label }); continue; }
    if (targets.length < wanted) targets.push(row);
  }
  if (!targets.length) {
    return {
      candidates: [], dropped: [], walled, failures: [], charged: search.charged,
      nothingFoundReason: walled.length
        ? "搜到的都是 API 抓不到的平台（登录墙），这些要用浏览器扩展顺手采。"
        : "这个搜索词没有找到公开讨论页面。",
    };
  }

  const fetched = await tinyfishFetch(env, { urls: targets.map((row) => row.url) });
  const meta = new Map(targets.map((row) => [row.url, row]));
  const usable = fetched.pages.map((page) => {
    const text = String(page.text || "").slice(0, PAGE_LIMIT);
    const source = meta.get(page.requestedUrl) || meta.get(page.url) || {};
    return {
      url: page.url,
      title: page.title || source.title || "",
      siteName: source.siteName || "",
      language: page.language,
      text,
      duplicateOf: text ? existingVoice(workspace.db, text)?.id || "" : "",
    };
  }).filter((page) => page.text.trim().length >= 200);

  const failures = [
    ...fetched.errors.map((row) => ({ url: row.url, reason: `抓取失败 HTTP ${row.status || "?"}：${row.error}` })),
    ...fetched.pages.filter((page) => String(page.text || "").trim().length < 200)
      .map((page) => ({ url: page.url, reason: "抓回来几乎没有正文，多半是登录墙或空壳页" })),
  ];

  if (!usable.length) {
    return {
      candidates: [], dropped: [], walled, failures, charged: search.charged + fetched.charged,
      nothingFoundReason: "搜到的页面都没抓到正文。",
    };
  }

  const completion = await completionFor(env)(env, {
    system: judgeSystemPrompt(),
    user: describePages(usable),
    maxTokens: 8_000,
  });
  const data = completion.data;
  if (!data || typeof data !== "object" || !Array.isArray(data.pages)) throw new Error("模型没有返回 pages 数组");

  const byUrl = new Map(usable.map((page) => [page.url, page]));
  const candidates = [];
  const dropped = [];
  for (const item of data.pages.slice(0, 12)) {
    const { candidate, dropped: reject } = normalizePageJudgement(item, byUrl);
    if (candidate) candidates.push(candidate); else if (reject) dropped.push(reject);
  }

  return {
    candidates,
    dropped,
    walled,
    failures,
    charged: search.charged + fetched.charged,
    model: completion.model || "",
    nothingFoundReason: candidates.length ? "" : "抓到的这些页面里没有真实用户在提问题，只有作者自己在讲。",
  };
}
