// AI HOT（https://aihot.virxact.com）客户端。
//
// 为什么要单独接它：newsnow 那批源给的是**标题**，AI HOT 给的是「已经读过一遍的结果」——
// 中文摘要、多信源合并、事件时间线。同样一条消息，newsnow 给你 20 个字的标题，
// AI HOT 给你 150 字的摘要 + 「3 个独立信源正在跟进」。后者才够你判断要不要点进去。
//
// 接口公开只读、不需要 key。上游文档：https://aihot.virxact.com/agent?tab=api
//
// 两个端点各司其职：
//   /api/v1/hot-topics                多源热点事件（带 sourceCount / sourceNames，证据强度）
//   /api/v1/items?mode=selected       24 小时精选（带中文 summary）
//   /api/v1/stories/{id}              事件综述（digest / latest），只给多源事件补，省请求

import { proxyFetch } from "./fetch.mjs";

const ORIGIN = "https://aihot.virxact.com";
const TIMEOUT_MS = 15_000;
// 只给「多源事件」补综述。全量补的话一次要发十几个请求，而单源事件本来也没什么可综述的。
const STORY_BUDGET = 6;

async function getJson(path) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await proxyFetch(`${ORIGIN}${path}`, {
      headers: { Accept: "application/json" },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function storyId(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[0] === "story" && parts[1] ? parts[1] : null;
  } catch {
    return null;
  }
}

const clean = (v) => String(v ?? "").replace(/[ \t]+/g, " ").trim();

// 上游分类只作条目标记，**不改变阅读顺序**（AI HOT 自己的 agent 文档也是这么说的）。
// 按分类重排会让「最新」这个最重要的信号消失。
const CATEGORY_LABELS = {
  "ai-models": "模型",
  "ai-products": "产品",
  industry: "行业",
  paper: "论文",
  tip: "教程",
};

// 上游的 source.name 长成「IT之家（RSS）」「X：通义千问 / Qwen (@Alibaba_Qwen)」
// 「The Decoder：AI News（RSS）」这样，直接当标签铺出来又长又吵。
//
// 顺序有讲究：先摘平台前缀（公众号：/ X：），再摘括号后缀，最后才按「：」取前半段——
// 反过来的话「公众号：千问APP」会被截成没信息量的「公众号」。
function shortSource(name) {
  let s = clean(name)
    .replace(/^(公众号|X|微博|知乎|B站)\s*[：:]\s*/, "")
    .replace(/[（(][^）)]*[）)]\s*$/g, "")
    .trim();
  // 还带栏目名的（The Decoder：AI News）只留刊物名
  const colon = s.split(/\s*[：:]\s*/);
  if (colon.length > 1 && colon[0].length >= 2) s = colon[0];
  s = s.replace(/\s*\/\s*.*$/, "").trim(); // 「通义千问 / Qwen」只留前一个名字
  if (!s) return "AI HOT";
  // 截断也要让人看出是被截了，别造出「Mark Zuckerber」这种看着像拼错的标签
  return s.length > 16 ? `${s.slice(0, 15)}…` : s;
}

/**
 * 拉一批 AI HOT 的条目，归一成热点流水线用的形状。
 *
 * 失败**不抛**：热点页是「有多少显示多少」，一个源挂掉不该让整页红掉。
 * @returns {{ok:boolean, error?:string, count:number, items:Array}}
 */
export async function fetchAiHot({ limit = 50 } = {}) {
  try {
    const [hot, selected] = await Promise.all([
      getJson("/api/v1/hot-topics").catch(() => ({ items: [] })),
      getJson(`/api/v1/items?mode=selected&window=24h&limit=${Math.min(limit, 100)}`).catch(() => ({ items: [] })),
    ]);

    const hotItems = Array.isArray(hot?.items) ? hot.items : [];
    const selectedItems = Array.isArray(selected?.items) ? selected.items : [];
    if (!hotItems.length && !selectedItems.length) throw new Error("两个端点都返回空");

    // 只给排前面的多源事件补综述
    const needStory = hotItems.filter((it) => (it.sourceCount || 0) >= 2).slice(0, STORY_BUDGET);
    const stories = new Map();
    await Promise.all(
      needStory.map(async (it) => {
        const id = storyId(it?.links?.story);
        if (!id) return;
        try {
          const r = await getJson(`/api/v1/stories/${encodeURIComponent(id)}`);
          if (r?.story) stories.set(it.id, r.story);
        } catch {
          /* 综述拿不到就不显示综述，事件本身照常出 */
        }
      })
    );

    const byId = new Map();
    const push = (item) => {
      const key = item.link || item.title;
      const exist = byId.get(key);
      // 同一条同时出现在热点和精选里：保留信息更全的那份（有摘要 / 信源更多）
      if (exist) {
        if (!exist.summary && item.summary) exist.summary = item.summary;
        if (!exist.category && item.category) exist.category = item.category;
        if (item.sources.length > exist.sources.length) exist.sources = item.sources;
        return;
      }
      byId.set(key, item);
    };

    for (const it of hotItems) {
      const story = stories.get(it.id);
      const sources = (it.sourceNames?.length ? it.sourceNames : [it.source?.name]).map(shortSource);
      push({
        title: clean(it.title),
        link: it?.links?.original || it?.links?.aihot || "",
        aihot: it?.links?.story || it?.links?.aihot || "",
        summary: clean(story?.digest) || "",
        latest: clean(story?.latest) || "",
        sources: [...new Set(sources)].filter(Boolean),
        sourceCount: Number(it.sourceCount) || 1,
        at: it.latestAt || null,
        category: "",
        origin: "aihot",
      });
    }

    for (const it of selectedItems) {
      push({
        title: clean(it.title),
        link: it?.links?.original || it?.links?.aihot || "",
        aihot: it?.links?.aihot || "",
        // 摘要里的换行是有意义的（上游按段落写），只压空格不压换行
        summary: String(it.summary ?? "").replace(/[ \t]+/g, " ").trim(),
        latest: "",
        sources: [shortSource(it?.source?.name)],
        sourceCount: 1,
        at: it.discoveredAt || it.publishedAt || null,
        category: CATEGORY_LABELS[it.category] || "",
        origin: "aihot",
      });
    }

    const items = [...byId.values()].filter((it) => it.title);
    return { ok: true, count: items.length, items };
  } catch (e) {
    return {
      ok: false,
      error: e.name === "AbortError" ? "超时" : e.message,
      count: 0,
      items: [],
    };
  }
}

/**
 * AIHOT 大模型排行榜。
 *
 * ⚠️ **这一条不是公开 API，是解析它自己那个页面。**
 * AI HOT 的 public API v1 只有 8 个端点（items / hot-topics / stories / dailies /
 * selected 那几个），模型榜不在里面——探过一圈，`/api/v1/models` 之类全是 404，
 * 而 `/leaderboard` 是服务端渲染好的 HTML，类名（`lb-row` / `lb-score` …）语义清楚且稳定。
 *
 * 所以这是**有意的例外**，代价也写清楚：**它会随着对方改版而失效**。
 * 因此三条：解析不出来就整块不显示（不报错、不占版面）、界面上如实标注来源和口径、
 * 永远留一个「去官网看」的出口。和热榜同一个态度——best-effort，挂了不修。
 */
const LEADERBOARD_URL = `${ORIGIN}/leaderboard`;

// 厂商 logo：**抓下来内联成 data URI**，不在前端直接引对方的图片地址。
//
// 三个理由，第一个是决定性的：
//   1. **浏览器未必够得着那个站**。这台机器的出站靠 `HTTPS_PROXY`，而 Node 侧已经统一走
//      `proxyFetch` 了；前端 `<img src="https://aihot…">` 走的是浏览器自己的网络栈，
//      通不通是另一回事——而失败的样子是「一列破图」，看着像工作台坏了。
//   2. **快照里就带着图**。模型榜挂掉时会退回最近一次成功的快照，图跟着快照走才不会
//      出现「文字是旧的、图标是空的」这种半份数据。
//   3. 不必为此新开一个图片代理端点（那等于开一个要防 SSRF 的口子）。
//
// 代价是抓一次榜单多发十来个请求（去重后就是厂商数），约 20KB。抓不到就没有图标，
// 榜单照常显示——和这整块「best-effort，挂了不修」是同一个态度。
const LOGO_PREFIX = "/model-providers/";
const LOGO_MAX_BYTES = 32 * 1024;
const LOGO_BUDGET = 16;

/**
 * 取一个厂商 logo，成功返回 data URI，失败返回空串。
 *
 * ⚠️ **只认对方 `/model-providers/` 底下的 `.svg`**：`src` 是从对方页面里读出来的字符串，
 * 拿它去拼请求就等于让上游决定我们打谁——判据写死在这儿，改版改成别的路径就是没有图标，
 * 不是「跟着去抓一个陌生地址」。
 */
async function fetchLogo(src) {
  if (!src.startsWith(LOGO_PREFIX) || !src.endsWith(".svg") || src.includes("..")) return "";
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await proxyFetch(`${ORIGIN}${src}`, { headers: { Accept: "image/svg+xml" }, signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return "";
    const svg = await res.text();
    // 图最终是喂给 `<img>` 的（那个上下文里 SVG 的脚本和外链本来就不执行），
    // 但外来内容进这个项目一律要有一条说得清的线，所以这三条都验：像不像 svg、有多大、带不带脚本
    if (svg.length > LOGO_MAX_BYTES) return "";
    if (!/^\s*(<\?xml|<svg)/i.test(svg)) return "";
    if (/<script|\son\w+\s*=/i.test(svg)) return "";
    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  } catch {
    return "";
  }
}

export async function fetchModels({ limit = 20 } = {}) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await proxyFetch(LEADERBOARD_URL, { headers: { Accept: "text/html" }, signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { parseHTML } = await import("linkedom");
    const { document } = parseHTML(await res.text());

    const rows = [...document.querySelectorAll(".lb-row")].slice(0, limit).map((row) => {
      const cell = (cls) => row.querySelector(`.${cls}`);
      // 每格都是「小字标签 + 值」两段，标签要剥掉：`评测73.8%` 里我们只要 73.8%
      const valueOf = (cls) => cell(cls)?.querySelector("strong")?.textContent?.trim() || "";
      const money = [...(cell("lb-pricing")?.querySelectorAll("strong") || [])].map((e) => e.textContent.trim());
      const href = row.getAttribute("href") || "";
      const logoBox = cell("lb-brand-logo");
      return {
        rank: Number(cell("lb-rank")?.textContent?.trim()) || 0,
        name: cell("lb-model")?.querySelector("strong")?.textContent?.trim() || "",
        vendor: cell("lb-model")?.querySelector("small")?.textContent?.trim() || "",
        logoSrc: logoBox?.querySelector("img")?.getAttribute("src") || "",
        // 对方自己标出来的「这个 logo 是纯黑的，暗色下要反色」（OpenAI / xAI 那种 currentColor 图）。
        // 不认这一条的话，暗色主题下那两枚图标就是**黑底上的黑块**——不报错，纯粹看不见
        logoInvert: (logoBox?.getAttribute("class") || "").includes("invert-on-dark"),
        // 同理另一头：Moonshot 那种**画在深色底块上**的白色 logo，底块是对方用 CSS 补的、不在 svg 里。
        // 不补底块的话白色部分在白底上直接消失，Kimi 那一行只剩一个孤零零的蓝点（踩过，截图才看见）
        logoTile: (logoBox?.getAttribute("class") || "").includes("dark-tile"),
        released: valueOf("lb-release-date"),
        completeness: valueOf("lb-completeness"),
        inPrice: money[0] || "",
        outPrice: money[1] || "",
        score: cell("lb-score")?.textContent?.trim() || "",
        link: href ? (href.startsWith("http") ? href : `${ORIGIN}${href}`) : "",
      };
    });

    const items = rows.filter((m) => m.name && m.score);
    if (!items.length) throw new Error("页面结构变了，一行都没解析出来");

    // 一个厂商只抓一次：20 条榜单里通常只有十来个厂商，逐行抓就是同一张图抓五遍
    const srcs = [...new Set(items.map((m) => m.logoSrc).filter(Boolean))].slice(0, LOGO_BUDGET);
    const logos = new Map(await Promise.all(srcs.map(async (s) => [s, await fetchLogo(s)])));
    for (const m of items) {
      m.logo = logos.get(m.logoSrc) || "";
      delete m.logoSrc; // 前端用的是内联那份，留着原地址只会诱人回头去直连
    }

    return { ok: true, count: items.length, items, source: LEADERBOARD_URL };
  } catch (e) {
    return {
      ok: false,
      error: e.name === "AbortError" ? "超时" : e.message,
      count: 0,
      items: [],
      source: LEADERBOARD_URL,
    };
  }
}
