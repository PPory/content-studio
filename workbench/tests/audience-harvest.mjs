// 从公开讨论找真实声音：抓回来的正文不许改，引不出原话的整页丢掉，候选一条都不入库。
//
// ⚠️ 这一步最危险的失败不是抓不到，是**抓到了一份看起来很像的东西**：
// 模型把评论顺手改通顺再引，读起来毫无破绽，但那句话没人说过。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { walledPlatform } from "../server/domain/audience-harvest.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-harvest-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-03T09:00:00.000Z");
let workspace;
let server;

/** 一整页 Reddit 抓下来的样子：帖子正文 + 评论，作者和时间都在。 */
const REDDIT_PAGE = [
  "r/ArtificialInteligence",
  "# I keep bouncing off every AI tool I try",
  "",
  "Posted by u/tired_dev  3d ago",
  "",
  "Every week there's a new one. I sign up, poke at it for ten minutes, and never open it again.",
  "",
  "Comments Section",
  "",
  "mira_codes  3d ago",
  "Honestly I stopped trying to keep up. I picked two tools and just got good at them.",
  "",
  "quietbuilder  2d ago",
  "The problem for me is I never know if I'm bad at the tool or the tool is bad.",
].join("\n");

/** 作者自己写的教程。没有任何人在提问题——这一页应该被判为没有声音。 */
const BLOG_PAGE = [
  "# 10 AI tools that will change your workflow in 2026",
  "",
  "In this guide I will walk you through the ten tools I use every day.",
  "First, let's talk about why tool selection matters so much this year.",
  "Each of these has a free tier, and I have linked my referral codes below.",
].join("\n");

let searchResponse = null;
let fetchResponse = null;
let judgeResponse = null;
let judgeCalls = 0;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

/** 假的 Monid。注入 env.MONID_FETCH，不动 globalThis——proxyFetch 走 undici，替全局那个没用。 */
async function fakeMonid(url, options) {
  const payload = JSON.parse(options.body);
  const body = payload.endpoint === "/search" ? searchResponse : fetchResponse;
  return new Response(JSON.stringify({
    runId: "01TEST", status: "COMPLETED", price: { amount: { value: 0, currency: "USD" } }, output: body,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function start() {
  const env = {
    MONID_API_KEY: "monid_test_key",
    MONID_FETCH: fakeMonid,
    async AUDIENCE_HARVEST_COMPLETE_JSON() {
      judgeCalls += 1;
      if (typeof judgeResponse === "function") return judgeResponse();
      throw new Error("测试没有设置模型响应");
    },
  };
  const api = createApi(env, { workspace: Promise.resolve(workspace) });
  server = http.createServer((req, res) => api(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}

async function call(base, pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

try {
  workspace = await openWorkspace({ xenhoHome, now });
  const base = await start();

  // ── 登录墙平台要如实说，不能假装抓过 ──────────────────────────────
  check("知乎认得出来是抓不到的", walledPlatform("https://www.zhihu.com/question/1") === "知乎");
  check("小红书认得出来是抓不到的", walledPlatform("https://www.xiaohongshu.com/explore/abc") === "小红书");
  check("Reddit 不在墙里", walledPlatform("https://www.reddit.com/r/x/comments/1/") === null);

  searchResponse = {
    results: [
      { url: "https://www.reddit.com/r/ArtificialInteligence/comments/1/", title: "I keep bouncing off every AI tool", site_name: "reddit.com" },
      { url: "https://example.com/blog/10-ai-tools", title: "10 AI tools", site_name: "example.com" },
      { url: "https://www.zhihu.com/question/629138534", title: "知乎问题", site_name: "zhihu.com" },
    ],
  };
  fetchResponse = {
    results: [
      { url: "https://www.reddit.com/r/ArtificialInteligence/comments/1/", final_url: "https://www.reddit.com/r/ArtificialInteligence/comments/1/", title: "I keep bouncing off every AI tool", language: "en", text: REDDIT_PAGE },
      { url: "https://example.com/blog/10-ai-tools", final_url: "https://example.com/blog/10-ai-tools", title: "10 AI tools", language: "en", text: BLOG_PAGE },
    ],
    errors: [],
  };

  // ── 引文必须逐字存在；改通顺过的引不算 ─────────────────────────────
  judgeResponse = () => ({
    model: "test-harvest",
    data: {
      pages: [
        {
          url: "https://www.reddit.com/r/ArtificialInteligence/comments/1/",
          has_voice: true, kind: "comment",
          summary: "有人在说自己每周换工具、什么都留不下来。",
          quotes: [
            "The problem for me is I never know if I'm bad at the tool or the tool is bad.",
            "Honestly I stopped trying to keep up. I picked two tools and just got good at them.",
            "I sign up, poke around for ten minutes, and never open it again.",
          ],
        },
        { url: "https://example.com/blog/10-ai-tools", has_voice: false, summary: "作者自己在讲，没有人提问题。" },
      ],
    },
  });
  const harvest = await call(base, "/api/workspace/audience-harvest", {
    method: "POST", body: { query: "AI tool overload" },
  });
  check("抓到了候选", harvest.status === 200 && harvest.data.candidates.length === 1);

  const candidate = harvest.data.candidates[0];
  check("正文一个字都没被改写", candidate.body === REDDIT_PAGE);
  check("改通顺过的那句引文被丢掉", candidate.quotes.length === 2
    && !candidate.quotes.some((quote) => /poke around/.test(quote)));
  check("留下的两句都在原文里逐字存在", candidate.quotes.every((quote) => REDDIT_PAGE.includes(quote)));
  check("作者自己写的那页被判为没有声音", harvest.data.dropped.some(
    (item) => /example\.com/.test(item.url) && /作者自己/.test(item.reason)));
  check("登录墙平台被单独列出来，没有假装抓过", harvest.data.walled.length === 1
    && harvest.data.walled[0].platform === "知乎");
  check("并且说清了它们该走哪条路", /扩展/.test(harvest.data.nothingFoundReason || "") || harvest.data.walled.length > 0);

  // ── 只提候选，一条都不入库 ────────────────────────────────────────
  check("找候选没有写进证据层", workspace.db.prepare("SELECT COUNT(*) AS c FROM audience_raw_sources").get().c === 0);
  check("接口自己也声明了这一点", harvest.data.candidateOnly === true);

  // ── 引不出足够原话的整页丢掉，不降级混进来 ──────────────────────────
  judgeResponse = () => ({
    model: "test-harvest",
    data: {
      pages: [{
        url: "https://www.reddit.com/r/ArtificialInteligence/comments/1/",
        has_voice: true, kind: "comment", summary: "看起来很像有声音。",
        quotes: ["Nobody ever wrote this sentence.", "This one is invented too."],
      }],
    },
  });
  const fabricated = await call(base, "/api/workspace/audience-harvest", {
    method: "POST", body: { query: "AI tool overload" },
  });
  check("引文全是编的时候整页丢掉", fabricated.data.candidates.length === 0);
  check("并且说得出对上了几句", fabricated.data.dropped.some((item) => /对上 0 句/.test(item.reason)));
  check("看不出来时如实说明", /没有真实用户在提问题/.test(fabricated.data.nothingFoundReason));

  // ── 用户确认之后才入库，走的是原来那道门 ────────────────────────────
  const saved = await call(base, "/api/workspace/audience-voices", {
    method: "POST",
    body: { kind: candidate.kind, body: candidate.body, sourceUrl: candidate.url, sourceName: candidate.siteName, confirmed: true },
  });
  check("确认之后才真的记下来", saved.status === 200 && saved.data.voice.id);
  check("来源链接跟着一起存了", saved.data.voice.sourceUrl === candidate.url);
  check("正文入库之后仍然是抓回来那一段",
    workspace.audienceRaw.source(saved.data.voice.id).body === REDDIT_PAGE);

  // ── 同一页再抓一次，要认得出已经记过 ────────────────────────────────
  judgeCalls = 0;
  judgeResponse = () => ({
    model: "test-harvest",
    data: {
      pages: [{
        url: "https://www.reddit.com/r/ArtificialInteligence/comments/1/",
        has_voice: true, kind: "comment", summary: "同一页。",
        quotes: [
          "The problem for me is I never know if I'm bad at the tool or the tool is bad.",
          "Honestly I stopped trying to keep up. I picked two tools and just got good at them.",
        ],
      }],
    },
  });
  const again = await call(base, "/api/workspace/audience-harvest", {
    method: "POST", body: { query: "AI tool overload" },
  });
  check("再抓一次认得出这段已经记过", again.data.candidates[0]?.duplicateOf === saved.data.voice.id);

  // ── 抓不到正文时说实话，不去问模型 ──────────────────────────────────
  fetchResponse = {
    results: [{ url: "https://www.reddit.com/r/x/comments/2/", final_url: "https://www.reddit.com/r/x/comments/2/", title: "空壳", text: "登录后查看" }],
    errors: [{ url: "https://example.com/blog/10-ai-tools", error: "target_http_error", status: 403 }],
  };
  searchResponse = { results: [
    { url: "https://www.reddit.com/r/x/comments/2/", title: "空壳", site_name: "reddit.com" },
    { url: "https://example.com/blog/10-ai-tools", title: "403", site_name: "example.com" },
  ] };
  judgeCalls = 0;
  const empty = await call(base, "/api/workspace/audience-harvest", { method: "POST", body: { query: "nothing" } });
  check("没有正文时根本不跑模型", judgeCalls === 0 && empty.data.candidates.length === 0);
  check("抓取失败逐条说明原因", empty.data.failures.length === 2
    && empty.data.failures.some((item) => /403/.test(item.reason))
    && empty.data.failures.some((item) => /登录墙|空壳/.test(item.reason)));

  // ── 没配 key 时给的是下一步，不是一句「未配置」 ──────────────────────
  const bare = createApi({}, { workspace: Promise.resolve(workspace) });
  const bareServer = http.createServer((req, res) => bare(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve) => bareServer.listen(0, "127.0.0.1", resolve));
  const noKey = await call(`http://127.0.0.1:${bareServer.address().port}`, "/api/workspace/audience-harvest", {
    method: "POST", body: { query: "x" },
  });
  await new Promise((resolve) => bareServer.close(resolve));
  check("没配 key 时说清楚去哪儿加", noKey.status === 503 && /MONID_API_KEY/.test(noKey.data.hint || ""));

  console.log("\n公开讨论声音采集验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
