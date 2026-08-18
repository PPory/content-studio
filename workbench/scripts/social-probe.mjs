// 中文站内探针。**它不是第四个洞察源。**
//
// 洞察源答「这周发生了什么」，探针答三件别的事：
//   供给面 —— 这个话题被切成了哪几个角度？哪个挤哪个空？写透了没？读者买账吗？
//   需求面 —— 读者卡在哪？谁的话引爆了讨论？他们自己摸出了什么解法？
//   对标面 —— 我盯的这些人在发什么、什么反响？
// 所以输出落 tmp/insight-work/<week>/web/（核实工件），不落 洞察/_material/
// ——后者是洞察源的位置，放错了 skill 会把它当第四份周材料读，而它的采样方式
//（按关键词搜历史热帖）根本不是「本周」。
//
// ## 两条腿怎么分工
//
// 两个数据源不是二选一，它们的短板正好互补：
//   Museon       精确数字 · 真实作者 · 能按周筛 · 不碰你账号 ┊ 正文只有 60 字预览 · 无评论 · 无抖音
//   MediaCrawler 全文 · 评论 · 抖音                        ┊ 作者打码 · 数字缩写 · 无时间筛选 · **烧你小号**
//
// 所以正确的用法是串联而不是并列——**Museon 选，MediaCrawler 取**：
//
//   1. node scripts/social-probe.mjs --source museon --keywords "A,B,C"
//        → 扫出候选，给出精确反响和真实作者，并打印下一步的深取命令
//   2. 你自己在 MediaCrawler 里跑那条命令（只抓选中的 8–10 条，不是盲扫 20 条）
//   3. node scripts/social-probe.mjs --merge <上一步的 json> --date <深取那天>
//        → 合并全文和评论，重新出报告
//
// 这比原来盲扫的请求量低一半以上——账号被盯上过两次，那是请求量堆出来的。
//
// ## 其他用法
//
//   node scripts/social-probe.mjs                              # MediaCrawler 小红书，最新一批（老路子，不变）
//   node scripts/social-probe.mjs --platform dy                # 抖音（只答「爆没爆过」）
//   node scripts/social-probe.mjs --source museon --keywords "AI 安全" --vision 5
//   node scripts/social-probe.mjs --source museon --type creator --creators "<user_id>,<user_id>"

import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "vite";
import { isoWeek } from "./probe/ir.mjs";
import {
  Museon, collectKeywords, collectCreators, readImages, visionCandidates,
} from "./probe/from-museon.mjs";
import {
  PLATFORMS, collect as collectMC, availableDates, jsonlDir, detailCommand, mergeDetail,
} from "./probe/from-mediacrawler.mjs";
import { render, toJson } from "./probe/render.mjs";
import { mediacrawlerDir } from "../server/lib/settings-schema.mjs";

const env = loadEnv("development", process.cwd(), "");
const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const list = (n) => (argOf(n) || "").split(",").map((s) => s.trim()).filter(Boolean);
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

// MediaCrawler 是工作区里的独立 clone，用 .env 的 MEDIACRAWLER_DIR 覆盖。**不 fork、不改它一行。**
//
// 路径解析走 `settings-schema.mjs` 的 `mediacrawlerDir()`，**不在这里自己拼一份**：
// 这个脚本原来内联了 `../MediaCrawler`，工作台从 creator-workbench 搬进 content-studio/workbench
// 之后就少了一级——而 settings-schema 那份已经改成 `../../`。两份实现里有一份是错的，
// 且错的那份不会报错，只会告诉你「找不到目录」。规则只能有一份。
const crawlerDir = mediacrawlerDir(env);

const week = argOf("week") || isoWeek();
const outDirOf = (w) => argOf("out") || path.join(process.cwd(), "tmp", "insight-work", w, "web");

function write(items, ctx) {
  const outDir = outDirOf(ctx.week);
  fs.mkdirSync(outDir, { recursive: true });
  const stem = `${ctx.platform}-${ctx.stem}-${ctx.date}`;
  const { md, groups } = render(items, ctx);
  fs.writeFileSync(path.join(outDir, `${stem}.md`), md, "utf8");
  fs.writeFileSync(path.join(outDir, `${stem}.json`), toJson(items, groups, ctx), "utf8");
  console.log(`${ctx.platformLabel}探针 · ${ctx.stem} · ${ctx.date} · 周次 ${ctx.week}`);
  for (const g of groups) {
    const c = g.items.reduce((s, i) => s + (i.comments?.length ?? 0), 0);
    console.log(
      `  ${g.label}　${g.count} 条 · 全文 ${g.withFullBody} · 评论 ${c} · 收藏率中位 ${g.medCollectRate == null ? "—" : (g.medCollectRate * 100).toFixed(1) + "%"} · ${g.first}→${g.last}`
    );
  }
  for (const f of [`${stem}.md`, `${stem}.json`]) {
    console.log(`  ${path.relative(process.cwd(), path.join(outDir, f))}`);
  }
  return { outDir, stem, groups };
}

/**
 * 深取一次最多碰多少条笔记。
 *
 * **这个上限管的是总数，不是每组数**——危险的量是总请求数。
 * 实测：一次会话跑到约 570 次评论请求就被判「登录已过期」。
 * 每组 10 条 × 4 个关键词 × 15 条评论 = 600 次，正好踩线；而命令行上看到的
 * 只是一个人畜无害的 `--pick 10`。**要用户自己去算这个乘法，就是设计的失败。**
 */
const MAX_DETAIL_NOTES = 20;
const COMMENTS_PER_NOTE = 15;

/**
 * 打印「把该读的几条交给 MediaCrawler 深取」的命令。
 *
 * **每组各取前 N 条**，不是全局取前 N——供给审计是按关键词做的，
 * 全局排序会让一个热门关键词把名额全占走，另外三个一条都轮不到。
 * 超出总上限时按组轮流削，保证每个关键词都还有代表。
 */
function printDetailNextStep(items, pick) {
  const groups = [...new Set(items.map((i) => i.group))];
  const perGroup = groups.map((g) =>
    items.filter((i) => i.group === g).sort((a, b) => (b.liked ?? 0) - (a.liked ?? 0)).slice(0, pick)
  );

  // 轮流取，取满总上限就停——这样削的是每组的尾巴，不是把最后一组整个砍掉。
  const picked = [];
  for (let r = 0; r < pick && picked.length < MAX_DETAIL_NOTES; r++) {
    for (const list of perGroup) {
      if (picked.length >= MAX_DETAIL_NOTES) break;
      if (list[r]) picked.push(list[r]);
    }
  }
  const wanted = perGroup.reduce((s, l) => s + l.length, 0);

  const dc = detailCommand(picked, { maxComments: COMMENTS_PER_NOTE });
  if (!dc) return;
  console.log("");
  if (wanted > picked.length) {
    console.log(
      `⚠️ ${groups.length} 个关键词 × 每组 ${pick} 条 = ${wanted} 条，约 ${wanted * COMMENTS_PER_NOTE} 次评论请求——` +
        `实测约 570 次就会被判「登录已过期」。`
    );
    console.log(`   已削到 ${picked.length} 条（各组轮流取，每个关键词都有代表），约 ${picked.length * COMMENTS_PER_NOTE} 次请求。`);
  }
  console.log(`下一步：深取这 ${dc.count} 条的全文和评论（用小号，约 ${dc.count * COMMENTS_PER_NOTE} 次请求）`);
  console.log(`  cd ${path.relative(process.cwd(), crawlerDir)}`);
  console.log(`  ${dc.cmd}`);
}

// ---------------------------------------------------------------- 重新渲染
// 改了渲染层或数据规则之后，从已存的 json 重出报告。**不重新采集，不花 credit。**
// 采集和渲染分开的直接好处就是这个：调呈现不用再付一次采集的钱。
if (argOf("rerender")) {
  const src = path.resolve(argOf("rerender"));
  if (!fs.existsSync(src)) die(`找不到 ${src}`);
  const prev = JSON.parse(fs.readFileSync(src, "utf8"));
  write(prev.items, {
    ...prev,
    date: prev.crawled_date,
    platformLabel: prev.platform === "dy" ? "抖音" : "小红书",
    crawlType: prev.crawl_type,
    stem: path.basename(src, ".json").replace(new RegExp(`^${prev.platform}-`), "").replace(/-\d{4}-\d{2}-\d{2}$/, ""),
    representative: prev.representative_sample,
    angleMap: prev.platform !== "dy",
    coverageLimit: prev.coverage_limit,
  });
  // 「下一步」也一起重出：重新渲染的语义是「从这份 json 重新产出全部输出」，
  // 深取命令是其中之一。不重出的话你得回去翻上一次运行的终端记录。
  printDetailNextStep(prev.items, Number(argOf("pick") || 10));
  process.exit(0);
}

// ---------------------------------------------------------------- 合并模式
// 深取回来之后把全文和评论并进已有的 Museon 结果。
if (argOf("merge")) {
  const src = path.resolve(argOf("merge"));
  if (!fs.existsSync(src)) die(`找不到 ${src}`);
  const prev = JSON.parse(fs.readFileSync(src, "utf8"));
  const date = argOf("date") || availableDates(jsonlDir(crawlerDir, "xhs"), "detail").pop();
  if (!date) die(`没有 detail 批次。先跑上一步打印出来的深取命令。`);

  const { items: detail } = collectMC({ crawlerDir, platform: "xhs", crawlType: "detail", date });
  const merged = mergeDetail(prev.items, detail);
  if (!merged) {
    die(
      `深取的 ${detail.length} 条和原有 ${prev.items.length} 条一条都没对上（按 note_id）。\n` +
        `多半是 --date 选错了批次，现有：${availableDates(jsonlDir(crawlerDir, "xhs"), "detail").join(" / ")}`
    );
  }

  write(prev.items, {
    ...prev,
    week: prev.week,
    date: prev.crawled_date,
    platform: "xhs",
    platformLabel: "小红书",
    crawlType: prev.crawl_type,
    stem: `${prev.crawl_type}-merged`,
    sources: ["museon+mediacrawler"],
    representative: prev.representative_sample,
    angleMap: true,
    // 重写而不是追加：原文里那句「正文只有 60 字预览，评论未采集」在合并后
    // 已经只对一部分成立，直接接一句「其中 N 条已补全」会让读的人自己去对账。
    coverageLimit:
      `小红书站内搜索第一页（Museon 发现 + MediaCrawler 深取），不代表站内全量，也不代表其他中文平台；` +
      `**${merged}/${prev.items.length} 条有全文和评论，其余仍只有 60 字预览**`,
  });
  console.log(`  合并了 ${merged}/${prev.items.length} 条的全文与评论`);
  process.exit(0);
}

// ---------------------------------------------------------------- Museon 模式
if (argOf("source") === "museon") {
  const crawlType = argOf("type") || "search";
  const museon = new Museon();
  const date = new Date().toISOString().slice(0, 10);
  // 按收藏排序会毁掉四象限（见 ir.mjs 的说明），所以默认 popular，
  // 用了 collects 就把样本标成无代表性，下游不画那一列。
  const sort = argOf("sort") || "popular";
  const representative = sort !== "collects";
  // 默认**不筛时间**。供给审计问的是「这个角度被占了没」，而三个月前写透的文章
  // 今天照样占着那个位置——用一周窗口做供给审计，会把「没人写」这个假结论造出来。
  // 新鲜度另有出口：表里的「近 30 天 / 近 90 天」两列。
  // 要问「这周有没有新东西」是另一个问题，那时才传 `--time-window week`。
  const timeWindow = argOf("time-window") || "any";
  const limit = Number(argOf("limit") || 20);

  let items;
  if (crawlType === "creator") {
    const ids = list("creators");
    if (!ids.length) die(`--type creator 需要 --creators "<user_id>,<user_id>"（小红书主页 URL 里那串 id）`);
    items = collectCreators(museon, ids, { limit });
  } else {
    const kws = list("keywords");
    if (!kws.length) die(`--source museon 需要 --keywords "关键词1,关键词2"`);
    items = collectKeywords(museon, kws, { limit, sort, timeWindow });
  }
  if (!items.length) die(`一条都没搜到。换个关键词，或把 --time-window 放宽到 six-months。`);

  // 读图：2 credits 一条，所以先筛掉只有封面的（那张写的是标题的变体，读了没信息），
  // 再在**有内页的**里面按收藏取头部。
  const visionN = Number(argOf("vision") || 0);
  if (visionN > 0) {
    const cands = visionCandidates(items);
    const picked = [...cands].sort((a, b) => (b.collected ?? 0) - (a.collected ?? 0)).slice(0, visionN);
    const skipped = items.length - cands.length;
    console.log(
      `读图 ${picked.length} 条（${picked.length * 2} credits）` +
        (skipped ? `，跳过 ${skipped} 条只有封面的` : "") + `…`
    );
    if (!picked.length) console.log(`  这批没有图文笔记（都只有封面），读图跳过。`);
    readImages(museon, picked);
  }

  const ctx = {
    week, date, platform: "xhs", platformLabel: "小红书", crawlType,
    stem: `museon-${crawlType}`,
    sources: ["museon"],
    representative, angleMap: true,
    credits: museon.report(),
    coverageLimit:
      crawlType === "creator"
        ? `指定博主主页最近 ${limit} 条（非全部作品）；只有公开数据，没有播放量/曝光/完播率等后台指标`
        : `小红书站内搜索第一页（Museon 代理，sort=${sort}、time-window=${timeWindow}），不代表站内全量，也不代表其他中文平台；**正文只有 60 字预览，评论未采集**`,
  };
  const { outDir, stem } = write(items, ctx);

  const r = museon.report();
  console.log(`  credits 花了 ${r.credits}（${Object.entries(r.calls).map(([k, v]) => `${k}×${v}`).join(" · ")}）`);

  // 下一步：把该读的几条交给 MediaCrawler 深取。
  // **脚本不自己跑它**——那一步用的是你的小号，账号被风控盯上过两次，
  // 「这次先不跑」必须是一个随时可选的选项，而不是一个已经跑起来的进程。
  printDetailNextStep(items, Number(argOf("pick") || 10));
  console.log("");
  console.log(`跑完回来合并：`);
  console.log(`  node scripts/social-probe.mjs --merge ${path.relative(process.cwd(), path.join(outDir, `${stem}.json`))}`);
  process.exit(0);
}

// ---------------------------------------------------------------- MediaCrawler 模式（老路子）
const platform = argOf("platform") || "xhs";
const P = PLATFORMS[platform];
if (!P) die(`不认识的平台 ${platform}，现有：${Object.keys(PLATFORMS).join(" / ")}`);
const crawlType = argOf("type") || "search";

const dir = jsonlDir(crawlerDir, platform);
if (!fs.existsSync(dir)) {
  die(`找不到 ${dir}\n先跑一次抓取，或在 .env 里设 MEDIACRAWLER_DIR。`);
}
const dates = availableDates(dir, crawlType);
const want = argOf("date");
if (want && !dates.includes(want)) die(`没有 ${want} 这批。现有：${dates.join(" / ") || "（空）"}`);
if (!dates.length) die(`${dir} 里没有 ${crawlType}_contents_*.jsonl`);
const date = want || dates[dates.length - 1];

const { items, hasComments } = collectMC({ crawlerDir, platform, crawlType, date });
write(items, {
  week, date, platform, platformLabel: P.label, crawlType,
  stem: crawlType,
  sources: ["mediacrawler"],
  representative: true,
  angleMap: P.angleMap,
  coverageLimit:
    crawlType === "creator"
      ? `指定博主主页的最近 N 条（受 CRAWLER_MAX_NOTES_COUNT 限制），非该博主全部作品；只有公开数据，没有播放量/曝光/完播率等后台指标`
      : `${P.label}站内搜索第一页（平台按${P.sortNote}排序、无时间筛选），不代表站内全量，也不代表其他中文平台` +
        (hasComments ? `；评论只取每条前 N 条（平台自己的热度序，非全部）` : `；**未采集评论**`),
});
