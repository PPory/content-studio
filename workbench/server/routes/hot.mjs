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
import { fetchBoards, sixtyConfigured } from "../lib/sixty.mjs";
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
// 全挂之后的冷静期。**失败也要缓存**：不缓存的话每切一次 tab 就重抓一遍六个榜，
// 每个榜等满 10 秒超时，用户看到的是「打开热点页要转十几秒然后还是旧数据」。
// 手动点刷新会清掉缓存，所以这条不挡「我现在就想重试」。
const FAIL_TTL = 60_000;
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

// 六个榜挂掉的原因往往是同一个（整个实例连不上）。**去重后只说前两种**：
// 逐榜铺一遍就是同一句话印六遍，而那句提示只有一行的位置。
function topReasons(boards) {
  const seen = [...new Set(boards.filter((b) => !b.ok).map((b) => b.reason || b.error).filter(Boolean))];
  return seen.slice(0, 2).join("、") + (seen.length > 2 ? " 等" : "");
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

/**
 * @param fallbackMsg 一句「为什么没有新数据 + 下一步」。可以是函数，**参数是这次失败的
 *   payload**——「没配地址」和「上游全挂」得说不同的话，而只有拿到 payload 才分得出来。
 *   ⚠️ **这句话里不要再说一遍「显示的是上一次成功的快照」**：界面上那条提示的标题
 *   已经在说这件事了，两句叠在一起就是同一句话印两遍（踩过，截图上一眼就能看见）。
 */
async function serve(res, { key, root, build, fallbackMsg, decorate }) {
  const hit = cache[key];
  // 失败的缓存活得短得多：上游多半几分钟就回来了，不该让它锁住十分钟
  const fresh = hit && Date.now() - hit.at < (hit.failed ? FAIL_TTL : TTL[key]);
  let payload = fresh ? hit.payload : null;
  let failed = fresh ? hit.failed : false;
  let checkedAt = fresh ? hit.at : Date.now();

  if (!payload) {
    payload = await build();
    failed = key === "boards" ? !payload.boards.some((b) => b.ok) : !payload.ok;
    checkedAt = Date.now();
    cache[key] = { at: checkedAt, payload, failed };
    if (!failed) await saveSnapshot(root, key, payload).catch(() => {});
  }

  if (failed) {
    // 全挂了就退回最近一次成功的快照，并如实标注。**`checkedAt` 不能省**：
    // 快照自己的 `fetchedAt` 是「这份数据多老」，而用户还要知道「刚才试过没有」——
    // 少了后半句，一份 23 小时前的快照看着就像「工作台一天没干活」
    const fb = await latestSnapshot(root, key);
    const hint = typeof fallbackMsg === "function" ? fallbackMsg(payload) : fallbackMsg;
    if (fb) {
      return json(res, {
        ok: true,
        ...decorate(fb),
        stale: true,
        staleHint: hint,
        checkedAt: new Date(checkedAt).toISOString(),
      });
    }
    // 一份快照都没有：把这次失败原样交出去，界面据此画空态（它要读每个源的失败原因）
    return json(res, { ok: true, ...decorate(payload), stale: false, staleHint: hint, cached: fresh });
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
          // 不写「六个榜」：BOARDS 加一行这句话就悄悄成了假话。这里干脆不提数量——
          // 「一个都没读到」已经把话说完了，而数量在界面上本来就写着
          fallbackMsg: (p) =>
            sixtyConfigured(env)
              ? `刚才一个榜都没读到（${topReasons(p.boards)}）。这类免费聚合接口随时会挂，过一会儿再点刷新。`
              : "还没填热榜的数据源地址（SIXTY_SECONDS_API_BASE_URL）。去设置面板「能力 → 可选能力 → 热榜数据源」填上你那个 60s API 实例的地址，这一栏才会有今天的数据。",
          // ⚠️ **`configured` 在这儿盖上去，不写进 payload。** 写进 payload 就等于写进快照，
          // 而 `decorate` 也作用在**读回来的快照**上——那份说的是「上次成功那天配没配」。
          // 这一栏整个 bug 的根源就是拿旧事实当现状用，别在修它的代码里再种一个。
          decorate: (p) => ({ ...p, configured: sixtyConfigured(env) }),
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
          fallbackMsg: (p) => `AI HOT 这次没抓到${p.error ? `（${p.error}）` : ""}，过一会儿再点刷新。`,
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
          fallbackMsg: "模型榜这次没解析出来。它是解析 AI HOT 的页面来的，对方改版就会失效。",
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
