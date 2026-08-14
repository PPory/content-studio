/**
 * 截图脚本：跑法 node tests/shots.mjs [宽度] [dark]
 * 用来肉眼验收视觉，不做断言。产物进 tmp/shot-*.png（不入库）。
 *
 * 冒烟测试只保证「渲染出来了」，保证不了「好不好看」。改完样式必须跑这个、真去看图。
 */

import { createServer } from "vite";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 端口可以从环境变量改：`strictPort` 下被别的进程占着就直接起不来，
// 而这台机器上跑着别的东西是常态（踩过一次：一个 python 服务占了 5198，
// 截图脚本整个挂掉，报错只有一句 "Port 5198 is already in use"）。
const PORT = Number(process.env.SHOTS_PORT) || 5198;
const WIDTH = Number(process.argv[2]) || 1600;
const DARK = process.argv.includes("dark");
const SUFFIX = DARK ? "-dark" : "";

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [ROOT, "C:/Users/Lenovo"] }));

/**
 * 数据页要有数据才看得出好不好看——空着的图只能验收空态。
 *
 * 所以这里**临时**塞一份样例，截完原样还原（本来没有文件就删掉）。样例里故意留了
 * 三种真实的脏：有几条没有观看数、公众号没有「收藏」这一列、月中有一周一篇没发——
 * 缺口提示、空指标整格消失、0 篇的那根柱子，都得在图上看得见。
 */
const DATA = path.join(ROOT, "data");
const SEED = [
  ["posts.csv", `date,platform,title,url,views,likes,comments,collects,shares,extra,doc,synced
2026-08-02,小红书,用 AI 帮朋友做了个很急的项目，分享一些思路,https://example.invalid/1,3085,103,7,105,17,,,2026-08-12
2026-08-03,公众号,2026 年，广告人应该如何开始学 AI,https://example.invalid/2,229,2,0,,24,,,2026-08-12
2026-08-04,小红书,警惕成为 AI 时代的信息蠢货,https://example.invalid/3,1268,48,4,15,6,,,2026-08-12
2026-08-05,抖音,10 分钟跑一套调性一致的详情页,https://example.invalid/4,12800,342,23,88,41,,,2026-08-12
2026-08-10,小红书,企业没办法逼每个人都学 AI,https://example.invalid/5,3200,89,7,68,12,,,2026-08-12
2026-08-11,小红书,一个 skill 解决四大业务场景,https://example.invalid/6,2173,102,8,90,17,,,2026-08-12
2026-08-11,抖音,把重复三遍的事情自动化,https://example.invalid/7,8600,201,14,52,33,,,2026-08-12
2026-08-12,小红书,今天刚发的，还没有数据,https://example.invalid/8,,,,,,,,
`],
  ["metrics.csv", `date,platform,followers,views,note
2026-07-14,小红书,4120,,
2026-07-21,小红书,4310,,
2026-07-28,小红书,4680,,起量
2026-08-04,小红书,5020,,
2026-08-11,小红书,5240,,
2026-07-14,公众号,860,,
2026-07-28,公众号,905,,
2026-08-11,公众号,980,,
`],
];
const saved = SEED.map(([f]) => {
  const p = path.join(DATA, f);
  return [p, fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null];
});
fs.mkdirSync(DATA, { recursive: true });
for (const [f, body] of SEED) fs.writeFileSync(path.join(DATA, f), body, "utf8");
const restore = () => {
  for (const [p, before] of saved) {
    if (before === null) fs.rmSync(p, { force: true });
    else fs.writeFileSync(p, before, "utf8");
  }
};
process.on("exit", restore);

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, "vite.config.mjs"),
  server: { port: PORT, strictPort: true, open: false },
  logLevel: "error",
});
await server.listen();

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: 1000 },
  deviceScaleFactor: 1.5,
  colorScheme: DARK ? "dark" : "light",
});

// [文件名, hash, 等这个出现, 进页面后再做点什么]
const shots = [
  ["overview", "/", ".todo-card, .note-title"],
  ["hot-boards", "/#/hot", ".board, .empty, .note-title"],
  ["hot-ai", "/#/hot", ".board, .empty, .note-title", async () => {
    await page.click('.pill-tab:has-text("AI 情报")', { timeout: 8000 }).catch(() => {});
    await page.waitForSelector(".ai-item, .empty", { timeout: 40000 }).catch(() => {});
  }],
  // 设置面板。**只开不存**：写 .env 会让这个脚本自己起的 dev server 重启，
  // 而写提示词改的是 content-pipeline 的真文件
  ["settings", "/", ".todo-card, .note-title", async () => {
    await page.click(".conn__gear").catch(() => {});
    // 等的是自检真的出了结论，不是覆盖层这个壳——壳里全是转圈的话，截出来的是一张加载图
    await page.waitForSelector(".set-check--ok, .set-check--bad, .set-check--warn, .set-check--off", { timeout: 40000 }).catch(() => {});
  }],
  // 提示词那一段：左边文件清单 + 右边编辑器，这是这一版最要看的一屏
  ["settings-prompts", "/", ".todo-card, .note-title", async () => {
    await page.click(".conn__gear").catch(() => {});
    await page.click('.set-nav__item[data-key="prompts-worker"]').catch(() => {});
    await page.waitForSelector(".set-pp__item, .note-title", { timeout: 15000 }).catch(() => {});
    await page.click(".set-pp__item").catch(() => {});
    await page.waitForSelector(".set-pp__editor .cm-content", { timeout: 15000 }).catch(() => {});
  }],
  // 工作台自己的那两段 + 改不掉的安全约束
  ["settings-local-prompts", "/", ".todo-card, .note-title", async () => {
    await page.click(".conn__gear").catch(() => {});
    await page.click('.set-nav__item[data-key="prompts-local"]').catch(() => {});
    await page.waitForSelector(".set-guard", { timeout: 15000 }).catch(() => {});
  }],
  ["ideas", "/#/inbox", ".wall-card, .empty, .note-title"],
  ["topics-wall", "/#/topics", ".wall-card, .empty, .note-title"],
  ["topics-board", "/#/topics", ".wall-card, .empty, .note-title", async () => {
    await page.click('.seg button:has-text("看板")').catch(() => {});
    await page.waitForSelector(".kanban-col", { timeout: 15000 }).catch(() => {});
  }],
  ["gate", "/#/topics", ".wall-card, .empty", async () => {
    // 平台闸门：挑一条不在「撰写中」的选题，模拟改状态
    await page.click(".wall-card__open").catch(() => {});
    await page.waitForSelector(".reader .prose, .ws-main", { timeout: 25000 }).catch(() => {});
    await page.click(".select__btn").catch(() => {});
    await page.click('.select__pop button:has-text("撰写中")').catch(() => {});
    await page.waitForSelector(".pick-grid", { timeout: 8000 }).catch(() => {});
  }],
  ["reader", "/#/drafts", ".wall-card, .empty, .note-title", async () => {
    await page.click(".wall-card__open").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
  }],
  // 洞察报告是这套界面里**信息最密**的一份文档（十几个分区、几十张表、卡片带元信息表），
  // 排版出问题只有看图才发现得了——之前一版把 frontmatter 里三个 sha256 整整齐齐
  // 铺在第一屏，冒烟测试全绿。
  ["insight", "/#/insights", ".wall-card, .empty, .note-title", async () => {
    await page.click(".wall-card__open").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
  }],
  // 第二张滚到第一张 Insight Card：卡片元信息那张表和一堆分区小标题都在下面，
  // 只截第一屏的话，正文密度到底怎么样一张也看不见。
  ["insight-card", "/#/insights", ".wall-card, .empty, .note-title", async () => {
    await page.click(".wall-card__open").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
    await page.evaluate(() => {
      document.querySelector(".reader .prose h3")?.scrollIntoView({ block: "start" });
    });
  }],
  ["shelf", "/#/shelf", ".book-card, .empty, .note-title"],
  // 挑一本**多章**的书：单篇书直接进正文，看不到书详情那一层
  ["book", "/#/shelf", ".book-card, .empty", async () => {
    await page.click('.book-card:has-text("章")').catch(() => {});
    await page.waitForSelector(".book-hero, .empty", { timeout: 15000 }).catch(() => {});
  }],
  ["book-reader", "/#/shelf", ".book-card, .empty", async () => {
    await page.click('.book-card:has-text("章")').catch(() => {});
    await page.waitForSelector(".book-hero", { timeout: 15000 }).catch(() => {});
    await page.click(".chapter-row:nth-child(6)").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
  }],
  // 阅读设置面板：字体分中文/拉丁两组、字号行宽这些是数值步进——这一屏光靠断言看不出好不好用
  ["prefs", "/#/shelf", ".book-card, .empty", async () => {
    await page.click('.book-card:has-text("章")').catch(() => {});
    await page.waitForSelector(".book-hero", { timeout: 15000 }).catch(() => {});
    await page.click(".chapter-row:nth-child(6)").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
    await page.click(".reader-overlay__bar .prefs button[aria-expanded]").catch(() => {});
    await page.waitForSelector(".prefs__pop", { timeout: 6000 }).catch(() => {});
  }],
  // 对话区：引擎开关在输入框旁边，空态要说清现在发给谁
  ["rail-chat", "/#/shelf", ".book-card, .empty", async () => {
    await page.click('.book-card:has-text("章")').catch(() => {});
    await page.waitForSelector(".book-hero", { timeout: 15000 }).catch(() => {});
    await page.click(".chapter-row:nth-child(6)").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
    await page.click('.rail-tabs button:has-text("对话")').catch(() => {});
    await page.waitForSelector(".composer", { timeout: 6000 }).catch(() => {});
  }],
  // 「理解」栏：模式芯片的三态（没问过 / 问过了 / 正在跑）+ 结果是叠着的。
  // 会真打一次 AI，但**不写任何东西**（划词 AI 默认不落盘），符合截图脚本的规矩。
  ["rail-ai", "/#/shelf", ".book-card, .empty", async () => {
    await page.click('.book-card:has-text("章")').catch(() => {});
    await page.waitForSelector(".book-hero", { timeout: 15000 }).catch(() => {});
    await page.click(".chapter-row:nth-child(6)").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".reader .prose p")].find((p) => p.textContent.length > 40);
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }).catch(() => {});
    await page.waitForSelector(".sel-bar", { timeout: 5000 }).catch(() => {});
    await page.click('.sel-bar button[aria-label="解释"]').catch(() => {});
    await page.waitForSelector(".rail .prose-sm, .rail .note-danger", { timeout: 60000 }).catch(() => {});
  }],
  // 入库抽屉：全工作台最常用的一个入口，值得每次改完都看一眼
  ["intake", "/", ".todo-card, .note-title", async () => {
    await page.click(".sidebar-foot .btn-primary").catch(() => {});
    await page.waitForSelector(".drawer", { timeout: 6000 }).catch(() => {});
    await page.fill(".drawer textarea", "复利不是利滚利，是「同一件事做久了，别人再进来就追不上」。").catch(() => {});
  }],
  // 在工作台里读热点原文：抓得到出正文、抓不到出带引导的错误，两种都要能看
  ["hot-read", "/#/hot", ".board, .empty, .note-title", async () => {
    await page.click('.pill-tab:has-text("AI 情报")').catch(() => {});
    await page.waitForSelector(".ai-item", { timeout: 40000 }).catch(() => {});
    await page.click('.ai-item__acts button:has-text("在这里读")').catch(() => {});
    await page.waitForSelector(".reader-overlay .prose, .reader-overlay .note-danger", { timeout: 90000 }).catch(() => {});
  }],
  // 模型榜：一张表，数字要右对齐、小数点要对得上，光靠断言看不出来
  ["hot-models", "/#/hot", ".board, .empty, .note-title", async () => {
    await page.click('.pill-tab:has-text("模型榜")').catch(() => {});
    await page.waitForSelector(".lb__row, .empty", { timeout: 60000 }).catch(() => {});
  }],
  // 状态下拉：一行一个图标的浮层菜单，圆角和行高这些光靠断言看不出来
  ["select", "/#/drafts", ".wall-card, .empty, .note-title", async () => {
    await page.click(".wall-card__open").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
    await page.click(".select__btn").catch(() => {});
    await page.waitForSelector(".select__pop", { timeout: 5000 }).catch(() => {});
  }],
  ["typeset", "/#/typeset", ".embed iframe"],
  ["metrics", "/#/metrics", ".stat-strip, .dropzone"],
  ["metrics-sources", "/#/metrics", ".stat-strip, .dropzone", async () => {
    await page.click('.pill-tab:has-text("数据来源")').catch(() => {});
    await page.waitForSelector(".dropzone", { timeout: 8000 }).catch(() => {});
  }],
];

for (const [name, hash, waitFor, after] of shots) {
  // 先回空白页再进：goto 到只有 hash 不同的地址**不会重新加载**，
  // 上一张图点出来的状态（切成卡片视图、打开了阅读区）会原样留到下一张图里。
  await page.goto("about:blank");
  await page.goto(`http://127.0.0.1:${PORT}${hash}`, { waitUntil: "networkidle" });
  await page.waitForSelector(waitFor, { timeout: 60000 }).catch(() => {});
  if (after) await after();
  await page.waitForTimeout(700);
  // 阅读覆盖层和内嵌工具是整屏布局，fullPage 会把 100vh 拉成一张怪图
  const inReader = ["reader", "insight", "insight-card", "book-reader", "gate", "typeset", "prefs", "rail-chat", "rail-ai", "intake", "hot-read", "select", "settings", "settings-prompts", "settings-local-prompts"].includes(name);
  await page.screenshot({ path: path.join(ROOT, "tmp", `shot-${name}${SUFFIX}.png`), fullPage: !inReader });
  console.log("→", `tmp/shot-${name}${SUFFIX}.png`);
}

await browser.close();
await server.close();
restore();
