// 把 MediaCrawler 抓下来的 jsonl 转成「中文站内探针」。
//
// 它不是第四个洞察源。洞察源答「这周发生了什么」，探针答三件别的事：
//   供给面（笔记）—— 这个话题被切成了哪几个角度？哪个角度挤、哪个空？写透了没？读者买账吗？
//   需求面（评论）—— 读者卡在哪？谁的话引爆了讨论？他们自己摸出了什么解法？
//   对标面（creator 模式）—— 我盯的这些人在发什么、什么反响？
// 所以输出落 tmp/insight-work/<week>/web/（核实工件），不落 洞察/_material/
// ——后者是洞察源的位置，放错了 skill 会把它当第四份周材料读，而它的采样方式
// （按关键词搜历史热帖）根本不是「本周」。
//
// **「有没有人写过」是个会得出错误结论的问法**：答案几乎永远是「有」，
// 于是这个审计退化成恒等于「别写」的函数。所以这里产出的是一张**角度地图**：
// 角度 × 密度 × 深度 × 反响 × 新鲜度。最值钱的那格不是「没人写」——
// 没人写往往意味着没需求——而是**有人写了但读者没买账**：角度对、执行不对，最好切入。
//
// 脚本只归一化、排序、打机械标记，**不分类、不筛选、不下判断**。
// 角度、覆盖层级、评论四分类都留空给 skill 填：脚本一旦开始猜，
// 「这个角度没人写」就可能是脚本自己造出来的。
//
//   node scripts/social-probe.mjs                          # 小红书搜索，最新一批
//   node scripts/social-probe.mjs --platform dy            # 抖音（只答「爆没爆过」）
//   node scripts/social-probe.mjs --type creator           # 对标博主
//   node scripts/social-probe.mjs --date 2026-08-12 --week 2026-W33

import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "vite";

const env = loadEnv("development", process.cwd(), "");
const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

// 平台适配器。加平台只写一项，不动下面的流程。
const PLATFORMS = {
  xhs: {
    label: "小红书",
    dir: "xhs",
    id: "note_id",
    url: "note_url",
    time: "time",
    fk: "note_id",
    // 小红书笔记正文是完整的（图文笔记动辄上千字），所以「写到多深」看得出来。
    showBody: true,
    angleMap: true,
    sortNote: "热度（popularity_descending）",
  },
  dy: {
    label: "抖音",
    // ⚠️ 落盘目录是 data/douyin/，不是命令行那个 --platform dy。
    // 两处名字不一致，猜错了脚本会报「找不到目录」——这条只有真跑一次才知道。
    dir: "douyin",
    id: "aweme_id",
    url: "aweme_url",
    time: "create_time",
    fk: "aweme_id",
    // 抖音存的 title 就是 desc（实测 41/41 完全相同），而**视频里说了什么拿不到**。
    // 但「文案里什么都没有」是错的：实测长度分布 [22,32,48,52,61,94,138,223,971]，
    // 知识类账号会把整个脚本贴进文案。所以**文案照显示**（`showBody`），
    // 但**角度地图不画**（`angleMap: false`）——多数文案是钩子加标签，
    // 拿它判断「这个角度写到多深」会得出假结论，而**画一个填不满的分区比不画更糟**。
    showBody: true,
    angleMap: false,
    sortNote: "综合",
  },
};

const platform = argOf("platform") || "xhs";
const P = PLATFORMS[platform];
if (!P) {
  console.error(`不认识的平台 ${platform}，现有：${Object.keys(PLATFORMS).join(" / ")}`);
  process.exit(1);
}
const crawlType = argOf("type") || "search";

// MediaCrawler 是同级目录的独立项目（跟 wechat-typeset 一个接法）：默认找同级，
// 用 .env 的 MEDIACRAWLER_DIR 覆盖。不 fork、不改它一行。
const crawlerDir = path.resolve(
  (env.MEDIACRAWLER_DIR || "").trim() || path.join(process.cwd(), "..", "MediaCrawler")
);
const jsonlDir = path.join(crawlerDir, "data", P.dir, "jsonl");
if (!fs.existsSync(jsonlDir)) {
  console.error(`找不到 ${jsonlDir}`);
  console.error(`先跑一次抓取，或在 .env 里设 MEDIACRAWLER_DIR。`);
  process.exit(1);
}

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}

/** 平台返回可能是「1.2万」「18,592」「--」。Number() 得到 NaN 会静默变成空值，所以原始串也留一份。 */
function num(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "--" || s === "None") return null;
  const m = s.match(/^([\d.,]+)\s*(万|w|W|千|k|K)?$/);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  return Math.round(base * ({ 万: 1e4, w: 1e4, W: 1e4, 千: 1e3, k: 1e3, K: 1e3 }[m[2]] || 1));
}

/** 缩写过的数字只有两位有效数字：「1.6万」真值在 1.55–1.65 万之间。 */
const isApprox = (v) => /[万wW千kK]/.test(String(v ?? ""));

/** 小红书给毫秒、抖音给秒。按量级判断，不靠平台写死——写死的话换个源就静默差 1000 倍。 */
function ts(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e11 ? n * 1000 : n;
}
const day = (v) => (ts(v) ? new Date(ts(v)).toISOString().slice(0, 10) : "");

/** 抖音的 aweme_type 是数字码，铺出来是一列没人看得懂的「0」。 */
const AWEME_TYPE = { 0: "视频", 68: "图文", 51: "视频", 61: "视频" };

/** 求助迹象词。宁可多标不可漏标——它只是个标记，标错了不会丢东西。 */
const ASK_WORDS = /怎么办|怎么破|求解|求助|求建议|求推荐|请问|有没有人|有没有什么|该怎么|如何才能|为什么会|该不该|值不值|有什么办法|谁能|想问/;

const median = (xs) => {
  const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

const readJsonl = (f) =>
  fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

function pickDate() {
  const want = argOf("date");
  const dates = [
    ...new Set(
      fs
        .readdirSync(jsonlDir)
        .map((f) => f.match(new RegExp(`^${crawlType}_(?:contents|comments)_(\\d{4}-\\d{2}-\\d{2})\\.jsonl$`))?.[1])
        .filter(Boolean)
    ),
  ].sort();
  if (want) {
    if (!dates.includes(want)) {
      console.error(`没有 ${want} 这批。现有：${dates.join(" / ") || "（空）"}`);
      process.exit(1);
    }
    return want;
  }
  if (!dates.length) {
    console.error(`${jsonlDir} 里没有 ${crawlType}_contents_*.jsonl`);
    process.exit(1);
  }
  return dates[dates.length - 1];
}

const date = pickDate();
const week = argOf("week") || isoWeek();
const contentsFile = path.join(jsonlDir, `${crawlType}_contents_${date}.jsonl`);
const commentsFile = path.join(jsonlDir, `${crawlType}_comments_${date}.jsonl`);
const rawNotes = readJsonl(contentsFile);
// 评论可选：没开 --get_comment 时只有供给面，那也是一份有效的探针。
const rawComments = fs.existsSync(commentsFile) ? readJsonl(commentsFile) : [];

const byNote = new Map();
for (const c of rawComments) {
  const k = c[P.fk];
  if (!byNote.has(k)) byNote.set(k, []);
  byNote.get(k).push(c);
}

const items = rawNotes.map((n) => {
  const liked = num(n.liked_count);
  const collected = num(n.collected_count);
  const commented = num(n.comment_count);
  const shared = num(n.share_count);
  const comments = (byNote.get(n[P.id]) || [])
    .map((c) => {
      const content = String(c.content || "");
      return {
        content,
        likes: num(c.like_count) ?? 0,
        // 赞 = 有多少人有同感；回复数 = 有多少人有话要说。
        // 后者才标识争议点和真问题，所以它是这里的主排序键。
        replies: num(c.sub_comment_count) ?? 0,
        date: day(c.create_time),
        // 楼主自己补的那条常常才是这篇真正想问的问题，和路人评论不是一类东西。
        // 脱敏哈希认不出「是谁」，但认得出「是不是同一个人」。
        isAuthor: c.creator_hash === n.creator_hash,
        // 求助迹象。**只认问号是不够的**：实测最值钱的那条楼主追问
        // （「我不知道怎么办，求解答」）一个问号都没有，而它正是这批数据里
        // 唯一直接指向选题的评论。所以问号 + 一张求助词表一起认。
        // 它是**标记不是筛子**——标错了也不会有东西被丢掉。
        asks: /[?？]/.test(content) || ASK_WORDS.test(content),
        chars: content.replace(/\s+/g, "").length,
        hasImage: Boolean(c.pictures),
      };
    })
    .sort((a, b) => b.replies - a.replies || b.likes - a.likes);

  return {
    group: crawlType === "creator" ? n.creator_hash : n.source_keyword || "",
    groupLabel: crawlType === "creator" ? n.nickname || n.creator_hash : n.source_keyword || "",
    id: n[P.id],
    title: n.title || "",
    // 抖音的 title 就是 desc（实测 41/41 相同）——而那串文案最长有 971 字。
    // 清空 desc 的话逐条会显示「（无正文）」，把唯一的文字内容丢掉；
    // 所以正文照留，标题那边改成只取第一行（见 `head()`）。
    desc: n.desc || "",
    kind: n.type || AWEME_TYPE[n.aweme_type] || (n.aweme_type ? `type${n.aweme_type}` : ""),
    date: day(n[P.time]),
    url: n[P.url],
    tags: String(n.tag_list || "").split(",").filter(Boolean),
    liked,
    collected,
    commented,
    shared,
    likedRaw: n.liked_count,
    // 平台把大数缩写成「2.1万」，两位有效数字。由它算出的比率误差可达 ±6%——
    // 「1.6万/1.6万」显示成精确的 100.0% 就是假精度，只能分档不能分高下。
    approx: isApprox(n.liked_count) || isApprox(n.collected_count),
    // 反响必须用比率不能用绝对值：不同时间发的内容进的流量池不是一个量级，
    // 绝对赞数跨条比没有意义。比率是自归一化的，所以能比。
    collectRate: liked && collected != null ? collected / liked : null,
    replyRate: liked && commented != null ? commented / liked : null,
    shareRate: liked && shared != null ? shared / liked : null,
    comments,
  };
});

// ---- 分组统计。每条只和同一批（同关键词/同博主）的中位数比，不跨组比。----
const groups = [];
for (const g of [...new Set(items.map((i) => i.group))]) {
  const list = items.filter((i) => i.group === g);
  const medLiked = median(list.map((i) => i.liked));
  const medCR = median(list.map((i) => i.collectRate));
  const dates = list.map((i) => i.date).filter(Boolean).sort();
  const within = (n) =>
    list.filter((i) => i.date && Date.now() - new Date(i.date).getTime() < n * 86400000).length;
  for (const i of list) {
    // 四象限：高赞高藏=存下来了 · 高赞低藏=刷过就走 · 低赞高藏=小众但被存 · 低赞低藏=没接住。
    // 「有人写了但读者没买账」就落在「刷」和「冷」这两格——那是最好切入的位置。
    const hot = i.liked != null && medLiked != null && i.liked >= medLiked;
    const sticky = i.collectRate != null && medCR != null && i.collectRate >= medCR;
    i.echo = i.collectRate == null ? "—" : hot ? (sticky ? "存" : "刷") : sticky ? "冷存" : "冷";
  }
  groups.push({
    key: g,
    label: list[0]?.groupLabel || g,
    count: list.length,
    medLiked,
    medCollectRate: medCR,
    medReplyRate: median(list.map((i) => i.replyRate)),
    first: dates[0] || "",
    last: dates[dates.length - 1] || "",
    within30: within(30),
    within90: within(90),
    approx: list.some((i) => i.approx),
    kinds: list.reduce((m, i) => ((m[i.kind || "?"] = (m[i.kind || "?"] || 0) + 1), m), {}),
    items: list,
  });
}

const outDir = argOf("out") || path.join(process.cwd(), "tmp", "insight-work", week, "web");
fs.mkdirSync(outDir, { recursive: true });
const stem = `${platform}-${crawlType}-probe-${date}`;

const coverageLimit =
  crawlType === "creator"
    ? `指定博主主页的最近 N 条（受 CRAWLER_MAX_NOTES_COUNT 限制），非该博主全部作品；只有公开数据，没有播放量/曝光/完播率等后台指标`
    : `${P.label}站内搜索第一页（平台按${P.sortNote}排序、无时间筛选），不代表站内全量，也不代表其他中文平台；评论只取每条前 N 条（平台自己的热度序，非全部）`;

fs.writeFileSync(
  path.join(outDir, `${stem}.json`),
  JSON.stringify(
    {
      schema_version: 2,
      week,
      platform,
      crawl_type: crawlType,
      source: `mediacrawler/${P.dir}/${crawlType}`,
      crawled_date: date,
      note_count: items.length,
      comment_count: rawComments.length,
      coverage_limit: coverageLimit,
      groups: groups.map(({ items: _i, ...g }) => g),
      items,
    },
    null,
    2
  ),
  "utf8"
);

// ---- Markdown：给人和 skill 读的那一份 ----
// 缩写数字算出来的比率带 ~：提醒它只精确到个位百分点，不能拿来分高下。
const pct = (r, approx = false) =>
  r == null ? "—" : approx ? `~${Math.round(r * 100)}%` : `${(r * 100).toFixed(1)}%`;
const n2 = (v, raw) => (v == null ? String(raw ?? "—") : v.toLocaleString("en-US"));
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n+/g, " ");
// 抖音的「标题」就是整段文案，最长 971 字，直接当小标题会铺满屏。取第一行就够认出是哪一条。
const head = (t) => (String(t).split("\n")[0] || "").slice(0, 48) || "（无标题）";

const L = [];
L.push(`# ${P.label}站内探针 · ${crawlType === "creator" ? "对标博主" : "关键词"} · ${date}`);
L.push("");
L.push(`> ${items.length} 条内容 · ${rawComments.length} 条一级评论 · 周次 ${week}`);
L.push(`> **覆盖边界**：${coverageLimit}`);
L.push("");
L.push(`## 怎么读这份文件`);
L.push("");
L.push(
  `**「有没有人写过」是个会得出错误结论的问法**——答案几乎永远是「有」。这份文件要答的是：`
);
L.push(`同一个话题被切成了哪几个角度、哪个角度挤哪个空、挤的那个写透了没、读者到底买不买账。`);
L.push("");
L.push(`- **反响看比率不看绝对值。** 不同时间发的内容流量池不是一个量级，绝对赞数跨条比没有意义。`);
L.push(
  `  \`收藏率 = 藏/赞\`（高 = 被存下来反复看的工具性内容，低 = 刷过就走）、\`评赞比 = 评/赞\`（高 = 引发讨论）。`
);
L.push(
  `- **反响列是四象限**，和**同一批**的中位数比（不跨批比）：\`存\`=高赞高藏 · \`刷\`=高赞低藏 · \`冷存\`=低赞高藏 · \`冷\`=低赞低藏。`
);
L.push(
  `  **最值钱的一格不是「没人写」**——没人写往往意味着没需求——**而是有人写了却落在「刷」或「冷」**：角度对、执行不对，最好切入。`
);
// 这两条只在对应的分区真的存在时才讲。讲一套本文件里没有的规则，
// 和画一个填不满的分区是同一个毛病——读的人会去找那个并不存在的东西。
if (rawComments.length) {
  L.push(`- **评论按回复数排，不按赞排。** 赞 = 有多少人有同感；回复数 = 有多少人有话要说。`);
  L.push(
    `  按赞筛会筛掉最值钱的：实测最关键的一条楼主追问只有 ♥27，而点赞过千的多是「太真实了」这类无信息量的共鸣。`
  );
}
const blanks = [P.angleMap && "角度、覆盖层级", rawComments.length && "评论分类"].filter(Boolean);
if (blanks.length) {
  L.push(`- **${blanks.join("、")}表脚本一律留空**，由 skill 填。脚本一旦开始猜，`);
  L.push(`  「这个角度没人写」就可能是脚本自己造出来的。`);
}
if (!P.angleMap) {
  L.push("");
  L.push(
    `⚠️ **${P.label}拿到的是文案，不是视频内容。** 文案长度实测从 22 到 971 字不等——知识类账号会把整个脚本贴进去，但多数只是钩子加标签，**视频里说了什么一个字都没有**。所以这份主要回答**「这个选题在短视频侧爆过没有」**；角度地图不画，拿钩子判断深度会得出假结论。文案照原样列在下面，值不值得看你自己判断。`
  );
}
L.push("");

for (const g of groups) {
  L.push(`---`);
  L.push("");
  L.push(`## ${crawlType === "creator" ? "博主" : "关键词"}：${g.label}`);
  L.push("");
  L.push(`### 供给面`);
  L.push("");
  L.push(
    `**${g.count} 条** · 发布跨度 \`${g.first}\` → \`${g.last}\`（近 30 天 ${g.within30} 条 / 近 90 天 ${g.within90} 条） · ` +
      Object.entries(g.kinds).map(([k, v]) => `${k} ${v}`).join(" · ")
  );
  L.push("");
  L.push(
    `中位数：赞 ${n2(g.medLiked)} · 收藏率 ${pct(g.medCollectRate, g.approx)} · 评赞比 ${pct(g.medReplyRate, g.approx)}`
  );
  L.push("");
  L.push(`| 反响 | 标题 | 日期 | 赞 | 藏 | 收藏率 | 评 | 评赞比 | 转 |`);
  L.push(`|---|---|---|---:|---:|---:|---:|---:|---:|`);
  for (const i of [...g.items].sort((a, b) => (b.liked ?? 0) - (a.liked ?? 0))) {
    L.push(
      `| ${i.echo} | [${esc(head(i.title)).slice(0, 36)}](${i.url}) | ${i.date} | ${n2(i.liked, i.likedRaw)} | ${n2(i.collected)} | ${pct(i.collectRate, i.approx)} | ${n2(i.commented)} | ${pct(i.replyRate, i.approx)} | ${n2(i.shared)} |`
    );
  }
  L.push("");

  if (P.angleMap) {
    L.push(`#### 角度地图（skill 填，脚本不猜）`);
    L.push("");
    L.push(`| 角度 | 条数 | 收藏率中位 | 最新一条 | 覆盖层级 | 缺口判断 |`);
    L.push(`|---|---:|---:|---|---|---|`);
    L.push(`| | | | | | |`);
    L.push("");
    L.push(
      `覆盖层级：\`news_rewrite\` / \`basic_explanation\` / \`mechanism\` / \`framework\` / \`practice\` / \`synthesis\`。`
    );
    L.push(
      `缺口判断：几乎无供给 / 有转述缺解释 / 有解释缺框架 / 有观点缺实操 / 英文全中文缺 / **有人写但反响差** / 已被说透不值得写。`
    );
    L.push("");
  }

  const all = g.items.flatMap((i) => i.comments.map((c) => ({ ...c, note: i.title, url: i.url })));
  if (all.length) {
    L.push(`### 需求面（${all.length} 条评论）`);
    L.push("");
    const asks = all.filter((c) => c.asks).length;
    const authored = all.filter((c) => c.isAuthor).length;
    L.push(`有求助迹象 ${asks} 条 · 楼主自己发的 ${authored} 条 · 引发过回复的 ${all.filter((c) => c.replies > 0).length} 条`);
    L.push("");
    L.push(`#### 最引发讨论的（每篇取前 2 条，再按回复数排）`);
    L.push("");
    // **回复数和赞一样，跨笔记不可比**：3000 条评论的帖子回复数天然在几百，
    // 20 条评论的帖子只有个位数。直接全局排序，排出来的是「哪篇评论多」，
    // 而那一篇会用它的梗霸占整个榜单（实测前 13 有 8 条来自同一篇玩梗帖）。
    // 先在每篇内部取头部再合并，换来的是横向铺开——要的是「哪句话引爆了讨论」。
    const perNote = g.items.flatMap((i) =>
      i.comments.slice(0, 2).map((c) => ({ ...c, note: i.title, url: i.url }))
    );
    for (const c of perNote.sort((a, b) => b.replies - a.replies).slice(0, 20)) {
      L.push(`- 💬${c.replies} ♥${c.likes}${c.isAuthor ? " · **楼主**" : ""}${c.asks ? " · ❓" : ""} · ${esc(c.content) || "（图片）"}`);
      L.push(`  <sub>《${esc(c.note).slice(0, 24)}》</sub>`);
    }
    L.push("");
    const q = all.filter((c) => c.asks).sort((a, b) => b.replies - a.replies || b.likes - a.likes);
    if (q.length) {
      L.push(`#### 有求助迹象的评论（${q.length} 条，问号或求助词，按回复数）`);
      L.push("");
      for (const c of q.slice(0, 25)) {
        L.push(`- 💬${c.replies} ♥${c.likes}${c.isAuthor ? " · **楼主**" : ""} · ${esc(c.content)}`);
      }
      L.push("");
    }
    L.push(`#### 评论分类（skill 填，脚本不猜）`);
    L.push("");
    L.push(`| 类型 | 条数 | 代表评论 | 喂给报告哪一节 |`);
    L.push(`|---|---:|---|---|`);
    L.push(`| 求助型（提出没被解决的问题） | | | 读者问题 / 内容机会 |`);
    L.push(`| 反驳型（挑战笔记的主张） | | | 认知冲突与反共识 |`);
    L.push(`| 经验型（给出自己摸出的解法） | | | 写作时的靶子，**不能当新东西讲** |`);
    L.push(`| 共鸣型（"太真实了"） | | | 情绪证据，计数即可 |`);
    L.push("");
  }
}

// ---- 逐条正文。抖音没有正文，这一整节不画。----
if (P.showBody) {
  L.push(`---`);
  L.push("");
  L.push(`## 逐条：正文与评论`);
  L.push("");
  L.push(`<sub>每条只列前 8 条评论（按回复数），**全量在同名 .json 里**。</sub>`);
  L.push("");
  for (const g of groups) {
    for (const i of [...g.items].sort((a, b) => (b.liked ?? 0) - (a.liked ?? 0))) {
      L.push(`### ${head(i.title)}`);
      L.push("");
      L.push(
        `\`${i.date}\` · ${i.echo} · ♥${n2(i.liked, i.likedRaw)} · 藏${n2(i.collected)}（${pct(i.collectRate, i.approx)}） · 评${n2(i.commented)} · [原文](${i.url})`
      );
      if (i.tags.length) L.push(`标签：${i.tags.map((t) => `#${t}`).join(" ")}`);
      L.push("");
      // 正文原样给出不截断：判断「这个角度写到多深」靠的就是正文本身。
      L.push(i.desc || "（无正文）");
      L.push("");
      for (const c of i.comments.slice(0, 8)) {
        L.push(
          `- 💬${c.replies} ♥${c.likes}${c.isAuthor ? " · **楼主**" : ""}${c.asks ? " · ❓" : ""} · ${esc(c.content) || (c.hasImage ? "（图片）" : "（空）")}`
        );
      }
      if (i.comments.length > 8) L.push(`- <sub>…另有 ${i.comments.length - 8} 条，见 .json</sub>`);
      L.push("");
    }
  }
}

fs.writeFileSync(path.join(outDir, `${stem}.md`), L.join("\n"), "utf8");

console.log(`${P.label}探针 · ${crawlType} · ${date} · 周次 ${week}`);
for (const g of groups) {
  const c = g.items.reduce((s, i) => s + i.comments.length, 0);
  console.log(
    `  ${g.label}　${g.count} 条 · 评论 ${c} · 收藏率中位 ${pct(g.medCollectRate, g.approx)} · ${g.first}→${g.last}`
  );
}
console.log(`  ${path.relative(process.cwd(), path.join(outDir, `${stem}.md`))}`);
console.log(`  ${path.relative(process.cwd(), path.join(outDir, `${stem}.json`))}`);
