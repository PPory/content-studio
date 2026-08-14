// 近期热点：两个互不相干的视角，各自独立抓取、独立刷新。
//
//   平台热榜（/api/hot/boards）  60s API 的六个大众榜，**不过滤**，保留各平台原始排名。
//                               它回答的是「现在大众在关心什么」——拿你的关注词去筛它
//                               等于把它筛没了（实测 50 条剩不到 1 条）。
//   AI 情报（/api/hot/ai）       AI HOT 精选，按日期分组。**这一侧才过滤**：默认只留
//                               命中关注词的，界面上一键可看全部。
//   模型榜（/api/hot/models）     AIHOT 大模型共识分。**这条是解析对方页面来的，不是公开
//                               API**（他们的 v1 里没有这个端点），所以会随改版失效——
//                               解析不出来就整块不显示，并留一个去官网的出口。
//
// 分成两个端点而不是一个大对象：两个 tab 的刷新节奏差一个数量级（热搜按分钟变，
// AI 精选按天变），合在一起就只能迁就快的那个，每次打开都白等六个榜。
//
// 两侧都是 best-effort：每个源独立失败并如实标注。上游挂了不修。

import { json, fail, readJsonBody } from "../lib/http.mjs";
import { fetchAiHot, fetchModels } from "../lib/aihot.mjs";
import { fetchBoards } from "../lib/sixty.mjs";
import { vaultRoot, readFileOrEmpty, writeVaultFile, listFiles, cleanupSnapshots } from "../lib/vault.mjs";
import { traceLinks } from "../lib/trace.mjs";
import { loadAttention, compileDomain, matchDomain } from "../lib/attention.mjs";
import { readArticle } from "../lib/article.mjs";
import { DIRS } from "../lib/vault-dirs.mjs";

const DIR = DIRS.hot;
const KEEP_DAYS = 30;

// 内存缓存的存活时间。热搜按分钟变，但也不能每次切 tab 都重抓六个榜；
// AI 精选上游自己就按 15 分钟缓存，这里比它长一点没意义。
// 模型榜按天变，抓一次管很久——而且它是解析页面来的，抓得越少越不打扰人家
const TTL = { boards: 10 * 60_000, ai: 30 * 60_000, models: 6 * 60 * 60_000 };
const cache = { boards: null, ai: null, models: null };

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const dayOf = (iso) => (iso ? new Date(iso).toLocaleDateString("sv-SE") : "");

// 快照按天一个文件，两个视角各占一个键。写的时候要先读回来再合并——
// 只刷新了热榜就整份覆盖的话，AI 那半边会被清空。
async function saveSnapshot(root, key, payload) {
  const file = `${DIR}/${today()}.json`;
  let all = {};
  try {
    all = JSON.parse((await readFileOrEmpty(root, file)) || "{}");
  } catch { /* 坏了就重建 */ }
  all[key] = payload;
  await writeVaultFile(root, file, JSON.stringify(all, null, 1));
  await cleanupSnapshots(root, DIR, ".json", KEEP_DAYS).catch(() => 0);
}

async function latestSnapshot(root, key) {
  const names = await listFiles(root, DIR, ".json");
  if (!names?.length) return null;
  // 从新往旧找，取第一份该视角有数据的
  for (const name of [...names].reverse()) {
    try {
      const all = JSON.parse(await readFileOrEmpty(root, `${DIR}/${name}`));
      if (all?.[key]) return all[key];
    } catch { /* 跳过坏文件 */ }
  }
  return null;
}

async function buildBoards(env) {
  const boards = await fetchBoards(env);
  return {
    date: today(),
    fetchedAt: new Date().toISOString(),
    boards,
    stats: {
      total: boards.reduce((n, b) => n + b.count, 0),
      live: boards.filter((b) => b.ok).length,
      dead: boards.filter((b) => !b.ok).length,
    },
  };
}

async function buildAi() {
  const r = await fetchAiHot();
  // 新的排前面。上游给的顺序不保证按时间，而「最新」是这一页最重要的信号。
  const items = [...r.items].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return {
    date: today(),
    fetchedAt: new Date().toISOString(),
    ok: r.ok,
    error: r.error || "",
    items,
  };
}

// 过滤在**读的时候**做，不在抓的时候做：关注词一改就该立刻生效，
// 不该等到下次抓取。快照里存的永远是全量。
function applyAttention(items, attention) {
  const compiled = attention.domains.map(compileDomain);
  const out = [];
  for (const item of items) {
    // 匹配标题 + 摘要：很多关键词只出现在摘要里，只看标题会白白漏掉一批
    const text = `${item.title}\n${item.summary}`;
    const hits = [];
    for (const dom of compiled) {
      const word = matchDomain(text, dom);
      if (word) hits.push({ domain: dom.name, word });
    }
    if (hits.length) out.push({ ...item, hits });
  }
  return out;
}

// 按日期分组呈现：AI 情报是「每天过一遍」的东西，日期是天然的阅读单位
function groupByDay(items) {
  const map = new Map();
  for (const item of items) {
    const day = dayOf(item.at) || "更早";
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(item);
  }
  return [...map.entries()].map(([day, list]) => ({ day, items: list }));
}

async function serve(res, { key, root, build, fallbackMsg, decorate }) {
  const fresh = cache[key] && Date.now() - cache[key].at < TTL[key];
  let payload = fresh ? cache[key].payload : null;

  if (!payload) {
    payload = await build();
    const anyOk = key === "boards" ? payload.boards.some((b) => b.ok) : payload.ok;
    if (anyOk) {
      cache[key] = { at: Date.now(), payload };
      await saveSnapshot(root, key, payload).catch(() => {});
    } else {
      // 全挂了就退回最近一次成功的快照，并如实标注
      const fb = await latestSnapshot(root, key);
      if (fb) return json(res, { ok: true, ...decorate(fb), stale: true, staleHint: fallbackMsg });
    }
  }
  json(res, { ok: true, ...decorate(payload), stale: false, cached: fresh });
}

export const hotRoutes = [
  {
    /**
     * 一条热点后来怎么样了：未处理 → 已收藏 → 已形成选题 → 已成稿 → 已发布。
     *
     * **POST 而不是 GET**：一屏热点有几十条链接，塞进 query 会顶爆 URL 长度；
     * 而且这里没有副作用，POST 只是用来带一个大 body。
     */
    method: "POST",
    path: "/api/hot/trace",
    async handler({ env, req, res }) {
      try {
        const b = await readJsonBody(req);
        const links = Array.isArray(b.links) ? b.links.slice(0, 200) : [];
        json(res, await traceLinks(env, links));
      } catch (e) {
        fail(res, e.message, { hint: e.hint });
      }
    },
  },
  {
    method: "GET",
    path: "/api/hot/boards",
    async handler({ env, res, url }) {
      try {
        if (url.searchParams.get("refresh") === "1") cache.boards = null;
        await serve(res, {
          key: "boards",
          root: vaultRoot(env),
          build: () => buildBoards(env),
          fallbackMsg: "六个榜今天都没抓到，显示的是上一次成功的快照",
          decorate: (p) => p,
        });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
  {
    method: "GET",
    path: "/api/hot/ai",
    async handler({ env, res, url }) {
      try {
        if (url.searchParams.get("refresh") === "1") cache.ai = null;
        const attention = await loadAttention();
        // all=1 是界面上「显示全部」那个开关：过滤只是默认，不是牢笼
        const showAll = url.searchParams.get("all") === "1";
        await serve(res, {
          key: "ai",
          root: vaultRoot(env),
          build: buildAi,
          fallbackMsg: "AI HOT 这次没抓到，显示的是上一次成功的快照",
          decorate: (p) => {
            const matched = applyAttention(p.items, attention);
            const shown = showAll ? p.items.map((it) => ({ ...it, hits: [] })) : matched;
            return {
              date: p.date,
              fetchedAt: p.fetchedAt,
              error: p.error,
              groups: groupByDay(shown),
              attention,
              filtered: !showAll,
              stats: { total: p.items.length, matched: matched.length, shown: shown.length },
            };
          },
        });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
  {
    /**
     * 大模型排行榜。**这条不是公开 API，是解析 AI HOT 自己那个页面**（见 aihot.mjs 的说明）。
     * 所以它和热榜一样是 best-effort：拿不到就如实说、给个去官网的出口，不让整页红掉。
     *
     * 走快照缓存那一套：榜单按天变，没必要每次打开都去抓一遍。
     */
    method: "GET",
    path: "/api/hot/models",
    async handler({ env, res, url }) {
      try {
        if (url.searchParams.get("refresh") === "1") cache.models = null;
        await serve(res, {
          key: "models",
          root: vaultRoot(env),
          // 补上抓取时间：`serve` 把 payload 原样缓存并回给前端，
          // 而页头那句「检查于」要靠它——不补的话永远显示「尚未抓取」
          build: async () => ({ ...(await fetchModels({ limit: 20 })), date: today(), fetchedAt: new Date().toISOString() }),
          fallbackMsg: "模型榜这次没抓到，显示的是上一次成功的快照",
          decorate: (p) => p,
        });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
  {
    /**
     * 把一条热点的原文读成 Markdown，**在工作台里看完**。
     *
     * 热点这一页的动线是「扫一眼 → 觉得有用 → 入库」，中间那步「点开看看」原来要跳出去，
     * 看完跳回来时滚到哪儿全丢了。正文进了工作台之后，划词存素材就是顺手的事。
     *
     * 不做缓存：热点条目点开一次多半就不再点了，缓存的收益抵不上「读到的是旧版本」的困惑。
     */
    method: "GET",
    path: "/api/hot/read",
    async handler({ env, res, url }) {
      try {
        const target = url.searchParams.get("url") || "";
        if (!target) return fail(res, "缺少 url 参数", { status: 400 });
        // env 里可能有 Firecrawl 的 key：直取失败时用它兜底（配了才走，见 article.mjs）
        json(res, { ok: true, article: await readArticle(target, env) });
      } catch (e) {
        fail(res, e.message, { status: e.status || 502, hint: e.hint });
      }
    },
  },
];
