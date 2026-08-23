// 已发布内容的事实层：**一条内容一行**。
//
// 这是数据页的地基。账号级周录（metrics.csv）回答「粉丝涨了没」，这份回答
// 「这个月发了什么、每一篇多少」——总览的发布量、渠道分布、内容明细、复盘的四象限，
// 全是从这一份聚合出来的。
//
// 存 CSV 不存 JSON，理由和 metrics.csv 一样：你可能想直接拖进 Excel 自己看。
// 落在项目的 data/ 而不是 vault——它是运行数据，不是知识库内容。

import path from "node:path";
import fs from "node:fs/promises";
import { readSheet, excelSerialToDate } from "./sheet.mjs";
import { atomicWrite, pruneSnapshots, snapshotFile, snapshotKeepDays } from "./safe-write.mjs";

const FILE = path.resolve(process.cwd(), "data", "posts.csv");
export const COLUMNS = ["date", "platform", "title", "url", "views", "likes", "comments", "collects", "shares", "extra", "doc", "synced"];
const NUMERIC = ["views", "likes", "comments", "collects", "shares"];
export const PLATFORMS = ["小红书", "公众号", "抖音", "视频号", "X", "B站", "YouTube"];

/**
 * 列名同义词表。**匹配的是「这一列叫什么」，不是列的位置**——各家导出的列顺序完全不同，
 * 而且同一家改版就会变；列名反而稳定得多。
 *
 * 认不出来不猜、不静默跳过：`mapColumns` 会把认出来的映射一并回给界面，导入前先给人看一眼。
 * **宁可让人多看一眼，也不要把一列数字安静地放进错误的格子里**——那种错在图表上看不出来，
 * 只会让你按错的数字做决定。
 *
 * 顺序有意义：先匹配到的字段先占坑，一列不会同时喂给两个字段。所以 `collects`（收藏）
 * 必须排在 `views` 前面——公众号有「收藏次数」，而「次数」两个字沾不上 views 的边，
 * 但小红书的「收藏」若被别的规则先吃掉就麻烦了。
 */
const FIELD_PATTERNS = [
  ["date", [/发布时间/, /发表时间/, /首次发布/, /发布日期/, /^时间$/, /^日期$/]],
  ["title", [/标题/, /笔记名称/, /作品名称|视频名称/, /内容名称/, /^名称$/, /^内容$/]],
  ["url", [/链接/, /^地址$/, /url/i, /永久链接/]],
  ["collects", [/收藏/]],
  ["shares", [/分享/, /转发/]],
  ["comments", [/评论/]],
  ["likes", [/点赞/, /^赞$/, /喜欢/]],
  // ⚠️ **顺序就是优先级，`曝光` 必须排在最后。** 小红书同时给「曝光」和「观看量」——
  // 前者是「在别人信息流里露过面」，后者才是真的点进来看了（实测 3434 vs 391，
  // 封面点击率 0.108 正好是两者的商）。拿曝光当阅读量，数字凭空大九倍**而且不报错**。
  // 和「阅读原文次数不能喂给 views」是同一类。留着它是给「只有这一个数」的平台兜底。
  ["views", [/观看/, /播放/, /阅读(?!原文)/, /浏览/, /展现/, /曝光/]],
];

/**
 * 表头 → 字段。回 `{ mapping, unmapped }`，两样都要给界面看：
 * 认出了什么，以及**剩下那些列被扔掉了**（用户可能正指望其中一列）。
 */
export function mapColumns(headers) {
  const mapping = {};
  const used = new Set();
  for (const [field, patterns] of FIELD_PATTERNS) {
    // ⚠️ **外层是模式、内层才是表头**，不能反过来。反着写的话扫的是表头顺序，
    // 同一个字段的几个模式就没有先后可言了——`曝光` 只因为在导出里排得靠前
    // 就抢走了 `观看量` 的位置。字段之间的优先级靠 FIELD_PATTERNS 的顺序，
    // 字段内部的靠这一层，两层都得是模式说了算。
    let hit;
    for (const re of patterns) {
      hit = headers.find((h) => !used.has(h) && re.test(h));
      if (hit) break;
    }
    if (hit) {
      mapping[field] = hit;
      used.add(hit);
    }
  }
  return { mapping, unmapped: headers.filter((h) => !used.has(h)) };
}

/**
 * 各种日期写法 → `YYYY-MM-DD`。认不出来回空字符串，由调用方当「这行不要」处理。
 *
 * Excel 里日期常常是纯数字序列号（45412），所以纯数字且落在合理区间时按序列号解。
 * 区间卡在 2015 年之后：早于那个的多半是别的意思的数字，宁可不认。
 */
export function normalizeDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 42000 && n < 60000) return excelSerialToDate(n).toISOString().slice(0, 10);
  }
  const m = /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * 「1.2万」「18.5万」「1,268」「--」→ 数字。
 *
 * 平台后台**导出文件里也会出现缩写数字**（页面上显示什么就导出什么）。当成字符串存进去，
 * 图上就是一条断线；`Number("1.2万")` 是 NaN，静默变成空值——两种都是安静的错。
 */
export function normalizeNumber(v) {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (!s || /^(-+|—+|\/|N\/A|null)$/i.test(s)) return null;
  const wan = /^(\d+(?:\.\d+)?)\s*万$/.exec(s);
  if (wan) return Math.round(Number(wan[1]) * 10000);
  const yi = /^(\d+(?:\.\d+)?)\s*亿$/.exec(s);
  if (yi) return Math.round(Number(yi[1]) * 1e8);
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(s);
  if (pct) return null; // 比率不是量，别混进求和里
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// 去重键：有链接就认链接（平台自己的唯一标识），没有就退回 平台+日期+标题。
// 标题会被改、日期不会，但只靠日期又区分不了同一天发的两条——所以三样一起。
export const postKey = (r) => (r.url ? `u:${r.url}` : `t:${r.platform}|${r.date}|${normTitle(r.title)}`);

// 比标题时剥掉话题标签和 emoji：小红书标题里挂着 #话题，平台导出和库里的写法常常不一样
export const normTitle = (t) =>
  String(t || "")
    .replace(/#[^\s#]+/g, "")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "")
    .replace(/[\s\p{P}]/gu, "")
    .toLowerCase();

function csvEscape(s) {
  const v = String(s ?? "");
  return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

export async function readPosts() {
  let bytes;
  try {
    bytes = await fs.readFile(FILE);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const { rows } = readSheet(bytes, "posts.csv");
  return rows
    .map((r) => {
      const o = { ...r };
      for (const k of NUMERIC) o[k] = normalizeNumber(r[k]);
      return o;
    })
    .filter((r) => r.date && r.platform)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * **整份重写，不追加。** 导入是「合并」不是「续写」：同一篇再导一次要更新它的数字，
 * 而追加式写法只能长出第二行。几百行几十 KB，重写一次是毫秒级。
 *
 * 整份重写的代价是「写坏了就没有原来那份了」，所以两道保险：
 *  - **改之前先存快照**（`data/.snapshots/posts/`）。这是唯一一份「哪篇发了多少」的
 *    事实层，合并逻辑判错一次就会安静地覆盖掉正确的数字——那种错在图表上看不出来。
 *  - **写入走 atomicWrite**：临时文件 + fsync + 原子替换，中途断电留下的是完整的旧版本，
 *    不是半份新版本。
 */
export async function writePosts(rows) {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const body = sorted.map((r) => COLUMNS.map((c) => csvEscape(r[c] ?? "")).join(",")).join("\n");
  await snapshotFile(process.cwd(), "posts", FILE);
  await atomicWrite(FILE, `${COLUMNS.join(",")}\n${body}${body ? "\n" : ""}`);
  await pruneSnapshots(process.cwd(), "posts", { keepDays: snapshotKeepDays() }).catch(() => 0);
}

/**
 * 合并进来的行。**新数字覆盖旧数字，但 `doc` 永远保留旧的**——
 * 那是用户手动指认过「这条对应哪篇稿子」的结果，平台导出文件里根本没有这个信息，
 * 被覆盖成空就等于每次同步都把人工做过的活儿抹一遍。
 */
export function mergePosts(existing, incoming) {
  const byKey = new Map(existing.map((r) => [postKey(r), { ...r }]));
  let added = 0;
  let updated = 0;
  for (const r of incoming) {
    const k = postKey(r);
    const prev = byKey.get(k);
    if (prev) {
      byKey.set(k, { ...prev, ...r, doc: prev.doc || r.doc || "" });
      updated++;
    } else {
      byKey.set(k, { ...r });
      added++;
    }
  }
  return { rows: [...byKey.values()], added, updated };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// 只比较同平台同口径数据。样本少于 5 条不下结论；超过同平台中位数 25% 才算突出。
export function evaluatePostPerformance(existing, candidate) {
  const peers = existing.filter((row) => row.platform === candidate.platform && row.views != null && row.doc !== candidate.doc);
  const viewBaseline = median(peers.map((row) => row.views));
  const engagementOf = (row) => row.views > 0
    ? (["likes", "comments", "collects", "shares"].reduce((sum, key) => sum + (Number(row[key]) || 0), 0) / row.views)
    : null;
  const engagementBaseline = median(peers.map(engagementOf));
  const engagement = engagementOf(candidate);
  if (peers.length < 5) {
    return { status: "样本不足", summary: `已记录 ${candidate.platform} 发布数据；同平台可比样本 ${peers.length} 条，暂不判断优劣。`, sampleSize: peers.length };
  }
  const viewWin = candidate.views != null && viewBaseline > 0 && candidate.views >= viewBaseline * 1.25;
  const engagementWin = engagement != null && engagementBaseline > 0 && engagement >= engagementBaseline * 1.25;
  const status = viewWin || engagementWin ? "表现突出" : "普通";
  const reasons = [];
  if (candidate.views != null && viewBaseline != null) reasons.push(`阅读/播放 ${candidate.views}，同平台中位数 ${Math.round(viewBaseline)}`);
  if (engagement != null && engagementBaseline != null) reasons.push(`互动率 ${(engagement * 100).toFixed(1)}%，中位数 ${(engagementBaseline * 100).toFixed(1)}%`);
  return { status, summary: `${reasons.join("；") || "已记录发布数据"}。判定：${status}。`, sampleSize: peers.length };
}

/**
 * 一份导出文件 → 可入库的行 + 一份「我是怎么读它的」的自述。
 *
 * 自述（mapping / unmapped / skipped / warnings）不是调试信息，是**导入前必须给用户看的东西**：
 * 解析器只能靠列名猜，猜错了不会报错，只会让你按错的数字做决定。
 */
export function parseExport(bytes, { filename, platform, today }) {
  const { headers, rows } = readSheet(bytes, filename);
  if (!headers.length) throw Object.assign(new Error("这份文件里没读到表头"), { hint: "确认导出的是内容明细表，不是一张图或一份汇总" });

  const { mapping, unmapped } = mapColumns(headers);
  const warnings = [];
  if (!mapping.date) warnings.push("没认出「发布时间」这一列——没有它就排不出每周发布量");
  if (!mapping.title && !mapping.url) warnings.push("既没认出标题也没认出链接，无法区分是哪一篇");
  if (!mapping.views) warnings.push("没认出阅读/播放这一列，这批只能统计发布量");

  const out = [];
  const skipped = [];
  for (const raw of rows) {
    const date = normalizeDate(raw[mapping.date]);
    const title = String(raw[mapping.title] ?? "").trim();
    const url = String(raw[mapping.url] ?? "").trim();
    if (!date) {
      skipped.push({ why: "没有可识别的发布时间", sample: title || url || Object.values(raw)[0] || "" });
      continue;
    }
    if (!title && !url) {
      skipped.push({ why: "没有标题也没有链接", sample: date });
      continue;
    }
    const row = { date, platform, title, url, extra: "", doc: "", synced: today };
    for (const k of NUMERIC) row[k] = mapping[k] ? normalizeNumber(raw[mapping[k]]) : null;
    // 认不出的列不丢掉，原样收进 extra：平台特有的指标（公众号的「在看」）现在没有槽位，
    // 但它就在文件里，扔了就得让人重新导一次
    const rest = {};
    for (const h of unmapped) if (raw[h]) rest[h] = raw[h];
    if (Object.keys(rest).length) row.extra = JSON.stringify(rest);
    out.push(row);
  }
  return { headers, mapping, unmapped, rows: out, skipped, warnings };
}

// 从文件名猜平台。**只是个默认值**，界面上仍然要人确认——猜错了整批数据会挂到别的平台名下。
export function guessPlatform(filename = "") {
  const s = filename.toLowerCase();
  if (/小红书|xiaohongshu|xhs|redbook/.test(s)) return "小红书";
  if (/公众号|weixin|wechat|mp_/.test(s)) return "公众号";
  if (/抖音|douyin|dy_/.test(s)) return "抖音";
  if (/视频号|channels|finder/.test(s)) return "视频号";
  return "";
}
