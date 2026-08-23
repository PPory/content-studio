// 数据页的聚合层。**纯函数，不碰 DOM 也不发请求**——因为这里算错了没人看得出来：
// 一个数字就是一个数字，不会报错、不会白屏，只会让你按错的数字做决定。放在这儿才能被单测钉住。

// 平台自己怎么叫，界面就怎么叫。同一个槽位在小红书是「观看」、在公众号是「阅读数」——
// 强行统一成一套词，等于逼人在自己的后台和这里之间做一次翻译。
const LABELS = {
  小红书: { views: "观看", likes: "点赞", comments: "评论", collects: "收藏", shares: "分享" },
  公众号: { views: "阅读数", likes: "点赞数", comments: "评论数", collects: "收藏数", shares: "分享数" },
  抖音: { views: "播放", likes: "点赞", comments: "评论", collects: "收藏", shares: "分享" },
  视频号: { views: "播放", likes: "点赞", comments: "评论", collects: "收藏", shares: "转发" },
};
const DEFAULT_LABELS = { views: "阅读", likes: "点赞", comments: "评论", collects: "收藏", shares: "分享" };
export const METRIC_KEYS = ["views", "likes", "comments", "collects", "shares"];
export const metricLabel = (platform, key) => LABELS[platform]?.[key] || DEFAULT_LABELS[key];

// 大数用「万」，四位以内保留千分位。1.2 万比 12000 好读，而 8,432 比 0.8 万准确。
export function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 100000) return `${Math.round(n / 10000)}万`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString("zh-CN");
}

export const monthOf = (date) => String(date || "").slice(0, 7);
export const inMonth = (rows, ym) => rows.filter((r) => monthOf(r.date) === ym);

// 有数据的月份，新的在前。月份选择器只给真有内容的月，空月翻过去只会看到四个 0。
export const monthsOf = (rows) => [...new Set(rows.map((r) => monthOf(r.date)).filter(Boolean))].sort().reverse();

export const fmtMonth = (ym) => (ym ? `${ym.slice(0, 4)} 年 ${Number(ym.slice(5, 7))} 月` : "");

/**
 * 一个月切成几周，周一起算，**掐头去尾只留落在这个月里的天**。
 *
 * 所以第一段常常不满七天（`4/1-4/5`）——那正是对的：这张图回答「这个月每周发了几篇」，
 * 把上个月的尾巴算进来会让第一根柱子凭空变高。
 */
export function weeksOf(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  let start = 1;
  while (start <= last) {
    const dow = (new Date(Date.UTC(y, m - 1, start)).getUTCDay() + 6) % 7; // 0=周一
    const end = Math.min(start + (6 - dow), last);
    const pad = (n) => String(n).padStart(2, "0");
    out.push({
      key: `${ym}-${pad(start)}`,
      label: `${m}/${start}-${m}/${end}`,
      from: `${ym}-${pad(start)}`,
      to: `${ym}-${pad(end)}`,
    });
    start = end + 1;
  }
  return out;
}

/**
 * 每周 × 每平台的**发布篇数**。
 *
 * 图上画柱不画线：发布量是整数，量级又只有 0~4，折线会在 1 和 2 之间画一条斜线，
 * 等于宣称「周三发了 1.5 篇」——那个数不存在。
 */
export function weeklyPublish(rows, ym) {
  const platforms = platformsIn(rows);
  return weeksOf(ym).map((w) => {
    const hit = rows.filter((r) => r.date >= w.from && r.date <= w.to);
    const byPlatform = {};
    for (const p of platforms) byPlatform[p] = hit.filter((r) => r.platform === p).length;
    return { ...w, byPlatform, total: hit.length };
  });
}

// 出现过的平台，按首次出现的顺序稳定下来（不按当月篇数排——排名会跳，颜色和顺序跟着跳）
export const platformsIn = (rows) => [...new Set(rows.map((r) => r.platform).filter(Boolean))];

/**
 * 按平台汇总。**某个指标一条都没有值时，那一格整个不出现**，不显示 0。
 *
 * 公众号没有「收藏」这一说，摆一个 0 在那儿会被读成「收藏了 0 次」——那是个假消息，
 * 真相是「这个平台压根没有这个指标」。
 */
export function platformSummary(rows) {
  return platformsIn(rows).map((platform) => {
    const mine = rows.filter((r) => r.platform === platform);
    const metrics = [];
    for (const key of METRIC_KEYS) {
      const vals = mine.map((r) => r[key]).filter((v) => v != null && !Number.isNaN(v));
      if (vals.length) {
        metrics.push({ key, label: metricLabel(platform, key), total: vals.reduce((a, b) => a + b, 0), n: vals.length });
      }
    }
    return { platform, count: mine.length, metrics, missing: mine.filter((r) => r.views == null).length };
  });
}

/**
 * 首屏那四格。第四格**不写「可分析」这种模糊词，直接写缺口**——
 * 「小红书缺 3 篇的数据」既说明了状态，也顺手说明了下一步该干什么。
 */
export function overview(rows, ym) {
  const mine = inMonth(rows, ym);
  const platforms = platformsIn(mine);
  const missing = mine.filter((r) => r.views == null);
  const synced = mine.map((r) => r.synced).filter(Boolean).sort().pop() || "";
  const byPlatformMissing = platforms
    .map((p) => ({ platform: p, n: missing.filter((r) => r.platform === p).length }))
    .filter((x) => x.n);
  return { count: mine.length, platforms, synced, missing: missing.length, byPlatformMissing };
}

/** 最近发了什么。跨月取，因为月初打开时这个月可能才一两条，而你想看的是「最近」。 */
export const recent = (rows, n = 5) => [...rows].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n);

/* ---------- 平台特有指标：`extra` 那一列 ---------------------------------
 *
 * posts.csv 的五个数字槽（views/likes/comments/collects/shares）是**跨平台可比的那部分**，
 * 而每个平台还各有几个只有它自己有的数：小红书给曝光和封面点击率，公众号给完读率和在看。
 * 导入时认不出来的列原样收进 `extra`（一个 JSON 串），**这儿是唯一把它读回来的地方**。
 *
 * ⚠️ **不要把它们提升成 posts.csv 的正式列。** 每加一个平台就要加几列，
 * 而那几列对别的平台永远是空的——表会越来越宽，空格越来越多，
 * 「这一格是没有还是没取到」也就再也分不出来了。
 */

/** `extra` 是字符串（CSV 里就是一格）。**坏了要当成没有，不能让一行脏数据把整页掀翻**。 */
export function parseExtra(row) {
  const raw = row?.extra;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

/**
 * 平台特有指标里，**哪几个值得摆到明细行上**，以及怎么显示。
 *
 * ⚠️ **以「率」结尾的按百分比显示。** 导出里它们是 0.108 这种小数，
 * 原样印出来会被读成「10.8 个」还是「0.108 次」谁也说不清；而 10.8% 一眼就懂。
 * 判据写成后缀而不是列一张白名单，是因为**下一个平台的比率列我们还不知道叫什么**，
 * 而漏掉一个的后果是屏幕上出现一个 0.466667。
 */
export const isRate = (name) => /率$/.test(String(name));

/** 一个平台特有指标 → `{ label, text }`。认不出的数原样给，不猜、不丢。 */
export function fmtExtra(name, value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isNaN(n)) return { label: name, text: s };
  if (isRate(name)) return { label: name, text: `${(n * 100).toFixed(1)}%` };
  return { label: name, text: fmtNum(n) };
}

/**
 * 明细行上要显示的平台特有指标。**恒为 0 的整列不显示。**
 *
 * 小红书每条都带「弹幕 0」「涨粉 0」，公众号每条都带「赞赏 0」——
 * 一行挂四个 0 会把真有值的那两个（曝光、点击率）淹掉，而那两个才是这一屏的信息。
 * ⚠️ 判据是**这一批里它有没有非零值**，不是「这一条是不是 0」：
 * 按条判的话同一列在不同行时有时无，一列扫下去是锯齿，而且看不出谁缺了数。
 */
export function extraColumns(rows) {
  const seen = new Map();
  for (const r of rows) {
    for (const [k, v] of Object.entries(parseExtra(r))) {
      const n = Number(v);
      if (!seen.has(k)) seen.set(k, false);
      if (String(v).trim() && (Number.isNaN(n) ? true : n !== 0)) seen.set(k, true);
    }
  }
  return [...seen].filter(([, live]) => live).map(([k]) => k);
}

/**
 * 内容明细：一条内容一行，按发布时间倒序。
 *
 * ⚠️ **筛选是「与」不是「或」**，而且**空条件不参与**——写成 `r.platform === platform`
 * 而 platform 为空时会一条都不剩，那看起来和「这个月没发过东西」一模一样。
 */
export function detailRows(rows, { platform = "", q = "" } = {}) {
  const kw = String(q).trim().toLowerCase();
  return rows
    .filter((r) => (!platform || r.platform === platform) && (!kw || String(r.title || "").toLowerCase().includes(kw)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * 趋势图值不值得画。
 *
 * ⚠️ **一根柱子不是趋势。** 这个月只有一周有内容时，图上就是一根孤零零的柱子加几周空白——
 * 它没有回答任何问题，却占着这一屏最大的一块。「样本不够就说不够」那条在这儿的落地是：
 * **不画，并且说清要攒到什么程度才会出现**。
 */
export const trendWorthDrawing = (weeks) => weeks.filter((w) => w.total > 0).length >= 2;

/**
 * 这一批内容里，有多少条**对得上工作台里的稿子**（posts.csv 的 `doc` 列）。
 *
 * ⚠️ **对不上不是错误，是常态**：从平台后台导进来的内容，工作台压根不知道它是谁写的。
 * 但它决定了复盘能说到什么程度——对得上才能把「数字」和「当初想说什么」放在一起看。
 */
export const docMatch = (rows) => ({
  matched: rows.filter((r) => String(r.doc || "").trim()).length,
  total: rows.length,
});
