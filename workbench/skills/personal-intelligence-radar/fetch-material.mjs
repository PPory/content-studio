// social-insights 的「搜集」步：三个源各抓一份原始材料，供 skill 读了之后写报告。
//
// 为什么是独立脚本、不进工作台：工作台是无状态阅读器，不抓数据也不存数据。
// 抓取要对抗上游改版、要管预算、随时会失败——塞进 dev server 的中间件里，
// 一次抓取失败就能让整个界面白屏。这里只产出文件，工作台照旧只管读。
//
// 三个源产出三份材料，**不合并**：它们补的是不同的层，揉成一个文件正好把区分抹掉。
//   reddit  观点和分歧（评论区吵起来的地方）      Bright Data，花钱
//   x       名单里的人当天说了什么                Bright Data，花钱
//   aihot   中文事实层和覆盖面（日报）            免费直连
//
// 跑法（在 creator-workbench 根目录）：
//   node skills/social-insights/fetch-material.mjs              # 只打印计划和预估用量
//   node skills/social-insights/fetch-material.mjs --go         # 三个源都抓
//   node skills/social-insights/fetch-material.mjs --go --only aihot
//   node skills/social-insights/fetch-material.mjs --only reddit --from tmp/reddit-raw-xxx.json
//
// **默认是 dry run 不是真跑**：抓取要花钱，而花钱的动作不能藏在「手滑就会触发」
// 的手势里（和阅读区「重跑必须明确点重新生成」是同一条原则）。

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { vaultRoot } from "../../server/lib/vault.mjs";
import { isoWeek, writeMaterial } from "./lib/material.mjs";
import { waitReady, download } from "./lib/brightdata.mjs";
import reddit from "./sources/reddit.mjs";
import x from "./sources/x.mjs";
import aihot from "./sources/aihot.mjs";

// 从脚本自己的位置推项目根，不靠 cwd——skills/ 被 junction 到 ~/.claude/skills/，
// 从哪个路径进来都得能找到 .env 和 server/lib
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const SOURCES = [reddit, x, aihot];

// ── 参数 ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = "") => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const num = (f, d) => {
  const v = val(f);
  return v ? Number(v) : d;
};

const GO = has("--go");
const ONLY = val("--only");
const FROM = val("--from");
// 取回一个已经触发过的 snapshot。轮询中途断了（网络抖动、Ctrl-C、机器休眠）时，
// 服务端那个 job 还在跑、credits 已经花了——这条路是去把结果领回来，不重新花钱。
const SNAPSHOT = val("--snapshot");

const opts = {
  days: num("--days", 7),
  // Reddit
  posts: num("--posts", 10),   // 每个 subreddit 取几条
  show: num("--show", 8),      // 每帖展示几条评论（不花钱）
  top: num("--top", 45),       // 详写上限（防体积失控的安全阀，不是品味判断）
  // X
  xposts: num("--xposts", 10), // 每个账号取几条
  xshow: num("--xshow", 6),    // 每个账号展示几条
  week: isoWeek(),
};

const log = (...a) => console.log(...a);

function die(msg, hint) {
  console.error(`\n✗ ${msg}`);
  if (hint) console.error(`  → ${hint}`);
  process.exit(1);
}

// ── 环境与配置 ─────────────────────────────────────────────────────────
const env = loadEnv("development", ROOT, "");
const KEY = (env.BRIGHTDATA_API_KEY || "").trim();
const cfg = JSON.parse(await fs.readFile(path.join(HERE, "sources.json"), "utf8"));

let active = SOURCES;
if (ONLY) {
  active = SOURCES.filter((s) => s.key === ONLY);
  if (!active.length) die(`没有叫「${ONLY}」的源`, `可选：${SOURCES.map((s) => s.key).join(" / ")}`);
}
if (FROM && active.length !== 1) die("--from 一次只能重放一个源", "配合 --only 用，例：--only reddit --from tmp/reddit-raw-xxx.json");
if (SNAPSHOT && active.length !== 1) die("--snapshot 一次只能取回一个源", "配合 --only 用，例：--only x --snapshot sd_xxx");
if (SNAPSHOT && FROM) die("--snapshot 和 --from 不能一起用", "前者从服务端取回，后者读本地文件");

const needsKey = active.some((s) => s.paid) && !FROM;
if (needsKey && GO && !KEY) {
  die("没有 BRIGHTDATA_API_KEY", "在 creator-workbench/.env 里加一行 BRIGHTDATA_API_KEY=xxx（控制台 Settings → API keys）");
}

// ── 计划 ───────────────────────────────────────────────────────────────
// records 是 Bright Data 的计费单位，1 record = 1 credit，免费额度每月固定。
// 抓之前必须能看见要花多少——跑一次超支，这个月就没得跑了。
if (FROM) {
  log(`\n  离线重放：${FROM} → ${active[0].label}`);
  log(`  不发请求、不花钱。时间窗近 ${opts.days} 天。\n`);
} else if (SNAPSHOT) {
  log(`\n  取回已有 snapshot：${SNAPSHOT} → ${active[0].label}`);
  log("  这次采集的钱之前已经花过了，取回不再计费。\n");
} else {
  const plans = active.map((s) => ({ s, ...s.plan(cfg[s.key] || {}, opts) }));
  const total = plans.reduce((n, p) => n + p.records, 0);

  log("\n  材料抓取计划");
  log("  ─────────────────────────────────────────────");
  for (const p of plans) {
    log(`  【${p.s.label}】${p.s.paid ? "" : " 免费"}`);
    for (const line of p.lines) log(`    ${line}`);
  }
  log(`  时间窗      近 ${opts.days} 天（下载后按发布时间过滤，不依赖上游排序）`);
  log("  ─────────────────────────────────────────────");
  log(`  预估上限    ${total} records（= credits）\n`);

  if (!GO) {
    log("  这是 dry run，没有发出任何请求、没有花钱。");
    log("  确认没问题就加 --go 真跑。\n");
    process.exit(0);
  }
}

// ── 抓 ─────────────────────────────────────────────────────────────────
const root = vaultRoot(env);
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
await fs.mkdir(path.join(ROOT, "tmp"), { recursive: true });

const results = [];

for (const s of active) {
  log(`\n▍${s.label}`);
  try {
    let raw;
    if (FROM) {
      raw = JSON.parse(await fs.readFile(path.resolve(FROM), "utf8"));
      if (!Array.isArray(raw)) throw new Error(`${FROM} 不是一个数组`);
      log(`  · 从文件读到 ${raw.length} 条`);
    } else if (SNAPSHOT) {
      await waitReady(KEY, SNAPSHOT, s.label, log);
      raw = await download(KEY, SNAPSHOT);
      await fs.writeFile(path.join(ROOT, "tmp", `${s.key}-raw-${stamp}.json`), JSON.stringify(raw, null, 2), "utf8");
      log(`  · 取回 ${raw.length} 条 → tmp/${s.key}-raw-${stamp}.json`);
    } else {
      raw = await s.fetch(cfg[s.key] || {}, opts, { key: KEY, log });
      // 原始件留一份：抓一次是要花钱的，留着才能离线重放（--from），
      // 改筛选规则、改排版都不用再抓一遍
      const rawPath = path.join(ROOT, "tmp", `${s.key}-raw-${stamp}.json`);
      await fs.writeFile(rawPath, JSON.stringify(raw, null, 2), "utf8");
      log(`  · 原始 JSON → tmp/${path.basename(rawPath)}`);
    }

    const { md, summary } = s.render(raw, cfg[s.key] || {}, opts);
    const rel = await writeMaterial(root, `${opts.week}-${s.key}.md`, md);
    log(`  ✓ ${summary} → ${rel}`);
    results.push({ s, ok: true, summary });
  } catch (e) {
    // **一个源挂掉不影响其他源**——和热点页同一个态度：有多少显示多少。
    // 尤其是 aihot 免费，不该被两个付费源的失败连累。
    console.error(`  ✗ ${e.message}`);
    if (e.hint) console.error(`    → ${e.hint}`);
    results.push({ s, ok: false, error: e.message });
  }
}

// ── 收尾 ───────────────────────────────────────────────────────────────
const okCount = results.filter((r) => r.ok).length;
log("\n  ─────────────────────────────────────────────");
for (const r of results) log(`  ${r.ok ? "✓" : "✗"} ${r.s.label}：${r.ok ? r.summary : r.error}`);
log("");

if (!okCount) {
  console.error("  三个源全挂了，没有产出任何材料。\n");
  process.exit(1);
}

log("  下一步：在 Claude Code 里说「跑一次社媒洞察」，skill 会读这些材料写报告。\n");
