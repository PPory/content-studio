/**
 * 冒烟测试：自己起 Vite（连带 API 插件）、开浏览器、断言界面真的渲染出来了。
 * 跑法：node tests/smoke.mjs
 *
 * 它守的是一条具体的红线——**Worker 没配好时不能白屏**。这个项目的每个数据区块
 * 都依赖外部（Worker / Notion / vault / 第三方热榜），最容易出的事故不是报错，
 * 是整页崩成空白而用户不知道该干什么。所以断言里既查「有没有渲染」，也查「有没有给下一步」。
 *
 * **断言尽量写成「二选一」**（连上就出数据、没连上就出引导），别写死某一种外部状态——
 * 写死的话外部一变测试就红，红着的测试等于没有测试。
 *
 * playwright 不装进本项目依赖，用本机全局那份（同 wechat-typeset 的做法）。
 */

import { createServer, loadEnv } from "vite";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIRS } from "../server/lib/vault-dirs.mjs";
import { DATA_FILES } from "../server/lib/backup.mjs";
// 分面的名字从适配器里读，测试不抄第二份——抄了的话改名字要改两处，
// 而漏掉的那一处表现成「测试红了」，读起来像功能坏了（踩过：facet 从「类型」改叫「分类」）
import { MATERIAL_WORKSPACE } from "../src/lib/material-workspace.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 5199;
const VAULT_ROOT = path.resolve(loadEnv("development", ROOT, "").VAULT_ROOT || "");
// 书架在 vault 里的位置从服务端那份单一真源里拿，不在测试里抄第二份——
// 抄了的话改布局时测试会连绿两次：一次是真的过了，一次是它在量一个没人用的旧路径。
const SHELF = DIRS.shelf;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const roots = [ROOT, "C:/Users/Lenovo", process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : ""];
  for (const r of roots.filter(Boolean)) {
    try {
      return require(require.resolve("playwright", { paths: [r] }));
    } catch {
      /* 换下一个 */
    }
  }
  throw new Error("找不到 playwright，装一个：npm i -g playwright");
}

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass, detail });
}

// 中途抛错时，前面已经跑过的检查结果不能跟着丢——那正是定位问题最需要的信息。
let fatal = null;

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, "vite.config.mjs"),
  server: { port: PORT, strictPort: true, open: false },
  logLevel: "error",
});
await server.listen();

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 只收 JS 异常，不收「Failed to load resource」。后者是浏览器对 HTTP 非 2xx 的自动记录，
// 而 503（未配置 Worker）正是本项目预期内的返回——把它算成失败，测试就永远红着，
// 真正的 JS 报错反而淹没在噪音里。
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/Failed to load resource/i.test(t)) return;
  consoleErrors.push(t);
});
/**
 * ⚠️ **内嵌工具（`/tools/typeset/`）里的报错不算工作台的报错。**
 *
 * 排版页是把 wechat-typeset 整个 iframe 嵌进来的，而「那个项目一行不改」正是这个接法的
 * 前提——它自己的 JS 异常（实测有一处 `activeCfg is not defined`）我们既不该改也改不了。
 * 算进来的话，这条断言会为**另一个项目的 bug** 长期红着，而真正属于工作台的报错会被淹没。
 *
 * `pageerror` 事件带不出是哪个 frame 抛的，所以按**时间段**排除：进排版页前记一个位置，
 * 离开时截回去。范围小、也说得清——只有那一段里的报错被无视。
 */
const ignoreErrorsDuring = async (fn) => {
  const before = consoleErrors.length;
  try {
    await fn();
  } finally {
    consoleErrors.length = before;
  }
};
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const shot = (name, full = true) => page.screenshot({ path: path.join(ROOT, "tmp", `smoke-${name}.png`), fullPage: full });

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });

  // 1. 渲染了，不是白屏
  // 首次冷启动要转译编辑器和中文字体，8 秒在 Windows 上偶尔只截到空白首帧。
  await page.waitForSelector(".topbar__name", { timeout: 20000 });
  check("界面渲染", (await page.textContent(".topbar__name")) === "Xenho OS");

  // 2. 侧栏只放用户任务。数据库对象、后台状态和单个工具都不再抢一级入口。
  const nav = await page.$$eval(".nav-item", (els) => els.map((e) => e.textContent.replace(/\d+$/, "").trim()));
  /**
   * ⚠️ **和 `NAV_LABELS` 常量比，不写死那一串。**
   * 写死的话改一次名字这条就红，而代码完全正确——旁边那条「一律两个字」
   * 才是真正的规矩，它不会因为改名而红。这个文件里已经为同一件事栽过两次
   *（内容二级导航那两条）。
   */
  const { NAV_LABELS } = await import("../src/lib/views.js");
  const wantNav = Object.values(NAV_LABELS);
  check(
    "侧栏按内容任务排",
    nav.join("/") === wantNav.join("/"),
    `${nav.join("/")}（常量 ${wantNav.join("/")}）`
  );
  check("标签一律两个字", nav.every((n) => n.length === 2), nav.join("/"));
  check("默认进入今日", (await page.textContent(".crumbs")).trim() === "今日", await page.textContent(".crumbs"));

  /**
   * ⚠️ **底色关系：框架白、工作区浅灰、卡片白。**
   *
   * 上一版是反的——侧栏透明（露出浅灰的应用底色）、正文是一整块**白**面板浮在上面，
   * 于是**白卡片压在白底上**，只能靠一圈边框勉强分出来。「卡片太丑」的根因就在这儿，
   * 底色不翻过来的话，卡片的圆角、投影、边框怎么调都白搭。
   *
   * 量的是**渲染出来的三个颜色的关系**，不是「样式表里写了哪个变量」：
   * 侧栏和卡片同色、正文区比它们暗（浅色）或亮（暗色），三者两两不同。
   */
  const ground = await page.evaluate(() => {
    const lum = (s) => {
      const [r, g, b] = (getComputedStyle(document.querySelector(s)).backgroundColor.match(/[\d.]+/g) || []).map(Number);
      const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const card = document.querySelector(".stat, .act-card");
    return { side: lum(".sidebar"), main: lum(".main"), card: card ? lum(".stat, .act-card") : null };
  });
  check(
    "侧栏和卡片同色，正文区和它们分得开",
    Math.abs(ground.side - (ground.card ?? ground.side)) < 0.01 && Math.abs(ground.main - ground.side) > 0.005,
    `侧栏 ${ground.side.toFixed(3)} · 正文 ${ground.main.toFixed(3)} · 卡片 ${ground.card == null ? "(这一页没有卡)" : ground.card.toFixed(3)}`
  );

  /**
   * 首屏那一排数字。⚠️ **四个数不能都取自流水线计数**——那四个平时全是 0
   *（流水线自己会消化），首屏最大的四个数字大多数时候在展示「没事」。
   * 所以判据是**至少有一半的格子拿到了非零的真实值**，而不是「画了四个格子」。
   */
  const stats = await page.$$eval(".stat", (els) =>
    els.map((e) => ({ label: e.querySelector(".stat__label")?.textContent.trim(), v: e.querySelector(".stat__value")?.textContent.trim() }))
  );
  if (stats.length) {
    check("首屏一排四个数", stats.length === 4, stats.map((s) => `${s.label}=${s.v}`).join(" · "));
    const real = stats.filter((s) => s.v && s.v !== "—" && s.v !== "0").length;
    check("这几个数不是一排 0", real >= 2, `${real}/${stats.length} 个有真实值`);
    // 每个数都要带上让它有意义的那个参照：一个孤零零的数字回答不了「这算多还是少」
    const withNote = await page.$$eval(".stat__note", (els) => els.filter((e) => e.textContent.trim()).length);
    check("每个数都带一句参照", withNote === stats.length, `${withNote}/${stats.length}`);
  }

  /**
   * 首屏是**三层**，各答一问：数字说「现在什么状态」、图说「最近趋势」、
   * 表说「具体是哪几条」。
   *
   * ⚠️ **卡片那一栏和图那一栏底边必须齐平。** 写过一版 `align-items: start`，
   * 左边三张卡 640px、右边那张图 380px——底边差一大截，右边那块看着像**还没加载完**。
   * 齐平不是装饰：这两块是同一个问题的两半（该不该现在推这一篇，
   * 取决于这个月已经发了几篇）。
   */
  const home = await page.evaluate(() => {
    const l = document.querySelector(".today-split .act-cards");
    const r = document.querySelector(".today-chart");
    return {
      split: !!l && !!r,
      gap: l && r ? Math.abs(Math.round(l.getBoundingClientRect().bottom - r.getBoundingClientRect().bottom)) : -1,
      /**
        * ⚠️ **图那一栏不能只在上半截画柱子、下半截空着。**
        * 柱高一度写死 168px（`WeeklyBars` 里的常量），而这一栏的高度是左边三张卡给的——
        * 高出来的那一大片就是块空地，看着和「还没加载完」一模一样。
        * 量的是**柱区底边到图例顶边**的距离：这才是那片空地本身，
        * 量「柱子有多高」会随数据变，量整栏高度又量不出空的是哪一段。
        */
      dead: (() => {
        const plot = document.querySelector(".today-chart .bars__plot");
        const foot = document.querySelector(".today-chart .bars__foot");
        if (!plot || !foot) return -1;
        return Math.round(foot.getBoundingClientRect().top - plot.getBoundingClientRect().bottom);
      })(),
      table: document.querySelectorAll(".rtable__row").length,
      tableHead: [...document.querySelectorAll(".rtable__head span")].map((e) => e.textContent.trim()),
      // ⚠️ 清单撤了：上半部已经全是待办，手写清单是同一屏里的**第三份**待办
      plan: !!document.querySelector(".day-plan"),
    };
  });
  if (home.split) {
    check("卡片那栏和图那栏底边齐平", home.gap <= 1, `底边差 ${home.gap}px`);
    if (home.dead >= 0) check("图那一栏里没有一大片空地", home.dead <= 24, `柱区底下空了 ${home.dead}px`);
  }
  check("首屏最下面是一张表，不是第三份待办", home.table > 0 && !home.plan, `${home.table} 行 · ${home.tableHead.join("/")}`);

  /**
   * **今日顶部是三张等大的卡，不是「一张大卡 + 三行小条」。**
   *
   * 上一版左边那张 `min-height: 278px` 的卡里只装了三四行字、中段大片留白；
   * 而右边三条只剩标题和一句「阶段 · 下一步」——**同一批数据在一屏上两种详略**，
   * 扫的时候得切换两次读法。
   *
   * ⚠️ **上限是硬的**：卡片是给「要动手的少数」的，没有上限它就退化成第二个卡片墙，
   * 而全集本来就在「内容」那一页。超出的收成一句**可点的**「还有 N 篇」。
   */
  await page.waitForSelector(".act-card, .today-clear, .project-setup", { timeout: 20000 });
  const todayTop = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".act-card")];
    const h = cards.map((e) => Math.round(e.getBoundingClientRect().height));
    return {
      n: cards.length,
      /**
       * ⚠️ **三张卡的边框必须一模一样，不许有一张被描重。**
       * 做过一版「第一张描边重一档」，撤了：卡片本来就按优先级排序，第一张就在第一个
       * 位置、上面还顶着「先做这一件」——那道边框是同一件事说第三遍，而它是这一屏里
       * 最重的一道线，**看着像那张卡被选中了**。量的是渲染后的边框色有几种。
       */
      borders: [...new Set(cards.map((c) => getComputedStyle(c).borderTopColor))].length,
      /**
       * ⚠️ **判据是「同一行里的卡等高」，不是「三张都等高」。**
       * 上一版钉的是后者，而首页现在把卡片**竖排**在左栏（右栏是那张图）——
       * 竖排时每张自己一行，高度本来就该由内容决定，那些为横排设的 `min-height`
       * 反而让每张凭空高出三四十像素。按行分组之后，横排竖排两种形态都验得对。
       */
      spread: (() => {
        const byRow = new Map();
        for (const c of cards) {
          const top = Math.round(c.getBoundingClientRect().top);
          byRow.set(top, [...(byRow.get(top) || []), Math.round(c.getBoundingClientRect().height)]);
        }
        return Math.max(0, ...[...byRow.values()].map((hs) => Math.max(...hs) - Math.min(...hs)));
      })(),
      // pill 里必须有图标：形状是主编码，不辨色一样能用
      pillsWithIcon: cards.filter((c) => c.querySelector(".pill svg")).length,
      pills: cards.filter((c) => c.querySelector(".pill")).length,
      // 每张卡要么给进度、要么给阻塞——两者都没有的话，这张卡只剩标题
      told: cards.filter((c) => c.querySelector(".meter, .act-card__warn")).length,
      /**
       * ⚠️ **卡住的原因和那条阻塞常常是同一句话**（「缺少目标读者」既是原因也是要办的事），
       * 照直画就是同一句话在一张卡上印两遍——一遍灰字一遍红框，看着像界面出了什么错。
       */
      echoed: cards.filter((c) => {
        const n = (c.querySelector(".act-card__note")?.textContent || "").trim();
        const w = (c.querySelector(".act-card__warn")?.textContent || "").trim();
        return n && w && n === w;
      }).length,
      more: document.querySelector(".today-more")?.tagName || "",
      // 那颗动作得是**真按钮**，键盘要够得着
      go: cards.filter((c) => c.querySelector("button.act-card__go")).length,
      /**
       * ⚠️ **按钮上写的是下一步本身**（「去排版发布」「继续写作」），不是泛指的「去处理」。
       * 泛指的那一版读完还得往左看一眼才知道要去干嘛，而按钮上的字要说清会发生什么。
       */
      vague: cards.filter((c) => (c.querySelector(".act-card__go")?.textContent || "").trim() === "去处理").length,
    };
  });
  if (todayTop.n) {
    check("今日顶部最多三张卡", todayTop.n <= 3, `${todayTop.n} 张`);
    check("没有哪一张被描重", todayTop.borders === 1, `${todayTop.borders} 种边框色`);
    check("同一行里的卡片等高", todayTop.spread <= 1, `同行高度差 ${todayTop.spread}px`);
    check("每张卡都有状态 pill，且 pill 里有图标", todayTop.pills === todayTop.n && todayTop.pillsWithIcon === todayTop.n, `${todayTop.pillsWithIcon}/${todayTop.n}`);
    check("每张卡要么给进度要么给阻塞", todayTop.told === todayTop.n, `${todayTop.told}/${todayTop.n}`);
    check("同一句话不在一张卡上印两遍", todayTop.echoed === 0, `${todayTop.echoed} 张重了`);
    check("卡片上那颗动作是真按钮不是一行字", todayTop.go === todayTop.n, `${todayTop.go}/${todayTop.n}`);
    check("按钮上写的是下一步本身，不是「去处理」", todayTop.vague === 0, `${todayTop.vague} 颗写着「去处理」`);
    // ⚠️ 「还有 N 篇」必须**点得动**，否则它只是个说了不算的数字
    check("超出的那几篇收成一句可点的话", !todayTop.more || todayTop.more === "BUTTON", todayTop.more || "(没有超出)");
  } else {
    check("今日没有待推进的项目，顶部卡这一段跳过", true, "空态或未连接");
  }

  /**
   * ⚠️ **后台那三个计数从 `views.js` 的 `AUTO_CARDS` 来，不许再抄一份。**
   * 原来是三行硬编码，跳转目标和那份常量逐字相同——以后往 `AUTO_CARDS` 里加一档，
   * 这儿会安静地少一个，而谁也不报错。断言的判据是**条数对得上**，不是文案。
   */
  const autoN = await page.$$eval(".today-background button", (els) => els.length);
  if (autoN) {
    const autoSrc = await fs.promises.readFile(new URL("../src/lib/views.js", import.meta.url), "utf8");
    const want = (autoSrc.match(/export const AUTO_CARDS = \[([\s\S]*?)\];/)?.[1].match(/\{ key:/g) || []).length;
    check("后台计数条数跟着 AUTO_CARDS 走", autoN === want, `界面 ${autoN} 个 / 常量 ${want} 条`);
  }

  // 一级任务展开后，稳定目的地直接出现在左栏；不再先进入一张页内中转页。
  await page.click('.nav-item:has-text("内容")');
  await page.waitForSelector(".crumbs", { timeout: 8000 });
  check("内容成为独立任务页", /^内容/.test((await page.textContent(".crumbs")).trim()), (await page.textContent(".crumbs")).trim());

  /**
   * 内容项目页：**顶上「需要你处理的」三张卡（要动手的少数）+ 下面一张全量表**。
   *
   * ⚠️ 上一版是九个阶段各一条泳道、每条两列卡——把**全集**画成了卡片，
   * 一张卡 218px 高却只装三四行字，三个项目就占掉两屏。
   */
  await page.waitForSelector(".ptable__row, .kanban-col, .empty, .project-setup, .project-error", { timeout: 25000 }).catch(() => {});
  const contentPage = await page.evaluate(() => ({
    cards: document.querySelectorAll(".project-attention .act-card").length,
    rows: document.querySelectorAll(".ptable__row").length,
    heads: [...document.querySelectorAll(".ptable__head span")].map((e) => e.textContent.trim()),
    lanes: document.querySelectorAll(".project-lane, .project-stage-filter").length,
    seg: !!document.querySelector(".seg"),
  }));
  if (contentPage.rows) {
    check("顶上最多三张「需要你处理的」卡", contentPage.cards <= 3, `${contentPage.cards} 张`);
    /**
     * ⚠️ 内容页那三张是**横排**的，所以这儿要验等高——
     * 一排卡片里标题一行还是两行会让下面每一行落在不同高度，扫的时候眼睛得上下找。
     * （首页那三张是竖排的，判据不同，见那边的注释。）
     */
    const rowSpread = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".project-attention .act-card")];
      if (cards.length < 2) return 0;
      const h = cards.map((c) => Math.round(c.getBoundingClientRect().height));
      return Math.max(...h) - Math.min(...h);
    });
    check("横排的那几张卡等高", rowSpread <= 1, `高度差 ${rowSpread}px`);
    check("全集是一张表不是卡片墙", contentPage.heads.length >= 5, contentPage.heads.join("/"));

    /**
     * ⚠️ **表头和行的列要对齐。**
     * 行末尾多了一颗删除按钮，表头就得留同宽的一格——不留的话整条表头
     * 右移一个按钮宽，列名和列全错位。`.doc-rows__head` 那次一模一样。
     */
    const cols = await page.evaluate(() => {
      // 表头的网格在 .ptable__headgrid 里（外面那层是给删除按钮留位的 flex 壳）
      const head = document.querySelector(".ptable__headgrid");
      const row = document.querySelector(".ptable__row");
      if (!head || !row) return null;
      const at = (el) => [...el.children].map((c) => Math.round(c.getBoundingClientRect().left));
      return { head: at(head), row: at(row) };
    });
    if (cols) {
      const off = Math.max(...cols.row.map((x, i) => Math.abs(x - (cols.head[i] ?? x))));
      check("表头和行的列对齐", off <= 1, `最大偏差 ${off}px`);
    } else {
      check("这会儿没有项目行，列对齐量不了", true, "空态");
    }

    /**
     * ⚠️ **删除要点两下，而且第二下的按钮上写的是「删的是什么」。**
     * 这一下**连级删掉这个项目底下所有稿子**，而且真删没有废纸篓——
     * 写「确定吗」是没用的。**这一段一个字都不能真删**：只点第一下，然后数写请求。
     */
    let delWrites = 0;
    const countDel = (req) => { if (req.method() === "POST" && /\/delete/.test(req.url())) delWrites += 1; };
    page.on("request", countDel);
    const delBtn = await page.$(".ptable__del");
    check("项目行上有删除入口", !!delBtn || !cols, delBtn ? "有" : "这会儿没有行");
    if (delBtn) {
      await delBtn.click();
      await page.waitForTimeout(250);
      const armed = (await page.textContent(".ptable__del.is-armed").catch(() => "")) || "";
      check("第一下只进确认态，按钮上写清删的是什么", /删掉/.test(armed), armed.trim() || "(没有确认态)");
      await page.mouse.click(8, 8);
      await page.waitForTimeout(250);
    }
    page.off("request", countDel);
    check("确认之前一行都没删", delWrites === 0, `${delWrites} 次删除请求`);
    check("泳道和那个十格筛选网格都撤了", contentPage.lanes === 0, `${contentPage.lanes} 个残留`);
    check("有列表/看板切换", contentPage.seg);
  } else {
    check("内容项目页是空的或没连上，这一段跳过", true, "没有项目行");
  }

  /**
   * 项目详情页。**这一页此前一条断言都没有**（截图脚本里也没有它），
   * 于是改样式看不见后果——这一轮把它重做成「中间正文 + 右边事实」两栏时才发现，
   * 那一栏的类名 `.prefs` 早被阅读设置面板占了，而 CSS 一个字都不报。
   *
   * ⚠️ **点进去要挑一条真能打开的**：表格第一行不一定有主稿，
   * 而这一段要验的东西（正文、右栏、流程线）在没有主稿的空态下本来就不存在。
   */
  if (contentPage.rows) {
    await page.click(".ptable__row");
    /* ⚠️ **等的是页面本身，不是那个加载壳。** `.project-workspace-load` 在项目还在取的
       时候就渲染好了，等它等于「等容器不等内容」——下面整段会安静地跳过去，
       而跳过去的输出和「这一段通过了」长得一模一样。这个坑这一轮已经踩到第三次。 */
    await page.waitForSelector(".project-workspace, .project-workspace-load .note-danger", { timeout: 25000 }).catch(() => {});
    const proj = await page.evaluate(() => {
      const ws = document.querySelector(".project-workspace");
      if (!ws) return null;
      const pill = document.querySelector(".project-bar .pill");
      return {
        // ⚠️ **左边那条 245px 的简报栏撤了**：中间是你动手的东西，右边才是关于它的事实
        oldBrief: document.querySelectorAll(".project-brief, .project-materials, .pfacts").length,
        cols: getComputedStyle(document.querySelector(".project-workspace__grid")).gridTemplateColumns.split(" ").length,
        // 标题在这一页只有一份，而且是能改的那一份
        titles: document.querySelectorAll(".project-workspace h1, .project-draft__title").length,
        editable: document.querySelectorAll("input.project-draft__title").length,
        // 还没有主稿的项目（`kind: "topic"` 建出来的选题）正文区是一个空态，本来就没有标题框
        noDraft: !!document.querySelector(".project-draft__empty"),
        /**
         * ⚠️ **七段流程线整条撤了。** 它画的是 Worker 的状态机不是用户动线，
         * 七段里三段用户根本不出现；而且它会骗人——一篇 0 字的空稿子照样能走到第 4 格
         * 并显示"三段已完成"，**进度条画的是流程走了多远，不是内容写了多少**。
         */
        flow: document.querySelectorAll(".project-flow, .project-flow li").length,
        // 顶栏那颗 pill 是三档之一（判据在 `projectPhase` 一处）
        phase: pill ? pill.textContent.trim() : "",
        /**
         * ⚠️ **右栏是二选一，不能钉死其中一种。**
         * 「待发布」那一档右栏换成发布准备（`ProjectReleaseRail`），这是对的行为；
         * 只断言其中一种的话，库里第一条恰好走到那一档时测试当场变红而代码没问题——
         * 「写死外部状态的断言等于没有断言」在这个文件里已经栽过三次。
         */
        rail: document.querySelector(".project-rail .pmat") ? "素材"
          : document.querySelector(".project-publish") ? "发布准备" : "",
        /* ⚠️ 撞名检查：`.prefs` 是阅读设置面板的，项目素材那一栏必须叫别的 */
        clash: document.querySelectorAll(".project-rail .prefs").length,
        /* 「待诊断」那一档撤了：不许在这一页任何地方长回来 */
        ghost: ws.textContent.includes("诊断"),
        /**
         * 种子块：**这一篇是从哪句话来的**。
         * ⚠️ **二选一，不能钉死其中一种**——库里第一条恰好不是种子长出来的时候，
         * 钉死「必须有」当场变红而代码没问题。要量的是：**有种子就有那句话，
         * 没种子就整块不画**（不是画一个写着「无来源」的空壳）。
         */
        seed: document.querySelector(".pseed") ? (document.querySelector(".pseed__take")?.textContent.trim().length || 0) : -1,
        /* 「找相关素材」那颗：只在素材那一档出现（发布准备那一档换了整个右栏） */
        find: document.querySelectorAll(".pmat__find-btn").length,
        /* 挂上的候选**不能**混在已挂的列表里——两者语义不同 */
        cands: document.querySelectorAll(".pmat__list .pmat__cands").length,
      };
    });
    if (proj) {
      check("项目详情页是两栏，不是三栏", proj.cols === 2 && proj.oldBrief === 0, `${proj.cols} 栏 · ${proj.oldBrief} 处旧简报栏`);
      /**
       * ⚠️ **二选一，不能写死「一定有标题」。**
       * 库里第一条恰好是个**还没有主稿的选题**时（`kind: "topic"` 建出来的），
       * 正文区本来就是一个空态——写死的话测试当场变红而代码没问题。
       * 有主稿时钉的仍然是那条：**标题只有一份，而且是能改的那一份**
       *（上一版顶栏一份、简报栏一份、正文顶上一份，其中两份还不能改）。
       */
      check("标题只有一份，而且是能改的那一份",
        proj.noDraft ? proj.titles === 0 : (proj.titles === 1 && proj.editable === 1),
        proj.noDraft ? "这个项目还没有主稿，正文区是空态" : `${proj.titles} 个标题 · ${proj.editable} 个可改`);
      check("七段流程线撤干净了", proj.flow === 0, `还剩 ${proj.flow} 个节点`);
      check("顶栏那颗 pill 是三档之一", ["在写", "写完了", "发出去了", "已搁置", "需处理"].includes(proj.phase), proj.phase || "(没有 pill)");
      check("「诊断」在这一页一个字都没有", !proj.ghost, proj.ghost ? "正文里还写着「诊断」" : "");
      check("右栏要么是素材，要么是发布准备", !!proj.rail, proj.rail || "两种都不是");
      check("项目素材那一栏没占用阅读设置的类名", proj.clash === 0, `${proj.clash} 处 .prefs`);
      /**
       * ⚠️ **二选一：有种子就得看得见那句话，没种子就整块不画。**
       * `-1` = 没画（没有种子），`>0` = 画了而且真有字。**`0` 必须红**——
       * 那是「画了一个空壳」，比不画更糟：屏幕上多了一块什么都不说的东西。
       */
      check("有种子就摆出那句话，没有就整块不画", proj.seed === -1 || proj.seed > 0,
        proj.seed === -1 ? "这个项目不是种子长出来的" : `${proj.seed} 字`);
      // 素材那一档才有「找相关素材」；发布准备那一档整个右栏都换掉了，没有它是对的。
      // ⚠️ 它现在是标题行右上角一枚图标（原来是铺满整栏的按钮，和下面那列素材抢重量）
      check("素材栏上有「找相关素材」", proj.rail !== "素材" || proj.find === 1, `${proj.find} 颗`);
      // ⚠️ 候选和已挂上的必须分开画：混在一起你会以为它们已经算进「已用 N 条」了
      check("AI 候选没混进已挂上的那份清单", proj.cands === 0, `${proj.cands} 处混在里面`);

      /**
       * ⚠️ **两种右栏都要钉得住，而且都要能自己滚。**
       * 上一版只给 `.project-rail` 加了 sticky，而「待发布」那一档右栏换成的是**兄弟节点**
       * `.project-publish`——它是 `position: static`，实测滚 900px 跟着走了 900px。
       * 而且光 sticky 不够：`.project-rail` 实测 975px 高、视口 852px，
       * **比视口还高的 sticky 会钉在顶上、然后你永远看不到它的底部**。
       * 量的是**滚动前后那一栏的 top 差**，不是"样式表里写了 sticky"。
       */
      const stuck = await page.evaluate(async () => {
        const rail = document.querySelector(".project-rail, .project-publish");
        const main = document.querySelector(".main");
        if (!rail || !main) return null;
        const cs = getComputedStyle(rail);
        const out = {
          which: rail.className, position: cs.position, scrolls: cs.overflowY, drift: -1,
          /**
           * ⚠️ **横向被撑破和 sticky 失效是同一个根因。**
           * grid 子项默认 `min-width: auto`——右栏里一条 `nowrap` 的长标题
           * 就能把整栏顶出去；栏一被顶宽，祖先多出一个横向滚动容器，
           * **`position: sticky` 跟着失效**。只量其中一个会以为修好了。
           */
          overhang: Math.round(rail.scrollWidth - rail.clientWidth),
          /**
           * ⚠️ **右栏的底边必须在视口里。**
           *
           * 它是 `position: sticky` + 定高 + 自己滚，而定高那个公式用的是
           * `100vh` 减去操作条——**从来没减顶栏**。于是它比可视区高出一个顶栏，
           * 最后一条永远露不出来：栏内滚到底了，可那个「底」在窗口下面。
           * 量渲染后的 `bottom` 和视口高度的差，不看公式写了什么。
           */
          /**
           * ⚠️ **量的是「栏满高时会不会掉出视口」，不是「此刻的底边在哪」。**
           * 后者完全看这个项目有几条素材——素材少的时候栏根本到不了定高，
           * 断言绿着而公式是错的（真踩过：这条第一版就是那么写的）。
           * 所以拿**解析出来的 `max-height`** 和「从它当前顶边到视口底还剩多少」比。
           */
          roomShort: (() => {
            const maxH = parseFloat(getComputedStyle(rail).maxHeight);
            if (!Number.isFinite(maxH)) return -1;
            return Math.round(maxH - (window.innerHeight - rail.getBoundingClientRect().top));
          })(),
          topbar: Math.round(document.querySelector(".topbar")?.getBoundingClientRect().height || 0),
          topbarVar: parseFloat(getComputedStyle(document.querySelector(".app")).getPropertyValue("--topbar-h")) || 0,
          // 子项自己溢出也算——外壳没被撑破，不代表里面那一行没跑出去
          childOverhang: Math.max(0, ...[...rail.children].map((el) => Math.round(el.scrollWidth - el.clientWidth))),
          /**
           * ⚠️ **点名真的戳出右栏边界的那个元素。**
           *
           * 量的是 `getBoundingClientRect().right` 超没超过右栏的右边界，
           * **不是 `scrollWidth - clientWidth`**——后者在 `overflow:hidden + ellipsis`
           * 的元素上恒为正（那正是省略号在工作），拿它当判据会报出一堆假阳性，
           * 而屏幕上什么事都没有。用户看见的「被截断」是**戳出去**，不是「内部被裁」。
           */
          worst: (() => {
            const edge = rail.getBoundingClientRect().right;
            let hit = null;
            for (const el of rail.querySelectorAll("*")) {
              const out = Math.round(el.getBoundingClientRect().right - edge);
              if (out > 1 && (!hit || out > hit.out)) {
                hit = { out, cls: el.className.toString().slice(0, 40), tag: el.tagName };
              }
            }
            return hit ? `${hit.tag}.${hit.cls} 戳出右栏 ${hit.out}px` : "";
          })(),
        };
        /**
         * ⚠️ **量的是「吸住之后还动不动」，不是「一滚就不许动」。**
         *
         * 右栏起始位置在顶栏下面，`top: 14px` 意味着**头一段滚动它本来就该跟着走**，
         * 直到它的上沿顶到 14px 才吸住。拿「滚 600px 之后位移是不是 0」当判据，
         * 会把这段完全正常的位移判成失效——而它在这一页够长之前一直量不到，
         * 所以那条判据错了很久都没露出来。
         *
         * 正确的判据：**滚到吸住之后再滚一次，位置不该再变**。
         */
        if (main.scrollHeight > main.clientHeight + 900) {
          const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          main.scrollTop = 600;
          await settle();
          const stuckAt = rail.getBoundingClientRect().top;
          main.scrollTop = 1200;
          await settle();
          out.drift = Math.abs(Math.round(stuckAt - rail.getBoundingClientRect().top));
          /**
           * ⚠️ **「右栏不动」和「右栏那一行还看得见」是两件事。**
           * 位移是 0，但如果右栏**自己内部**被滚过了，你看到的仍然是「跟着跑了」——
           * 顶上那块（从这句话开始 / 项目素材）没了。所以两样都量：
           * 栏的位置有没有变、栏内部的滚动位置有没有变。
           */
          out.innerScroll = Math.round(rail.scrollTop);
          /**
           * ⚠️ **吸住之后右栏的上沿必须在那条操作条下面。**
           * 项目页顶上那条也是吸顶的——右栏吸得太高的话会整个滑到它底下，
           * **位移仍然是 0**（它确实停住了），只是停的位置被盖住了。
           * 这正是「位移 0 却看着像跟着滚」的那个假绿。
           */
          /**
           * ⚠️ **「没有操作条」和「重叠量是负的」不能都用 -1。**
           * 负的重叠量恰恰是**对的**（右栏在操作条下面），而 -1 又表示「量不到」——
           * 混成一个数之后，断言绿着、消息却在说「这一页没有操作条」。
           * 这就是这个文件里反复出现的那种假绿，用 `null` 把两件事分开。
           */
          out.underBar = (() => {
            const bar = document.querySelector(".project-bar");
            if (!bar) return null;
            return Math.round(bar.getBoundingClientRect().bottom - rail.getBoundingClientRect().top);
          })();
          out.headTop = (() => {
            const head = rail.querySelector(".pmat__head");
            if (!head) return -1;
            return Math.round(head.getBoundingClientRect().top - rail.getBoundingClientRect().top);
          })();
          main.scrollTop = 0;
          await settle();
        }
        return out;
      });
      if (stuck) {
        /* ⚠️ **两种右栏都要 sticky。** 上一版只给 `.project-rail` 加了，
           而「待发布」那一档换成的是**兄弟节点** `.project-publish`，它是 `static`——
           实测滚 900px 跟着走了 900px。量的是渲染后的 `position`，两种形态各跑到一次。 */
        check("右栏是钉住的", stuck.position === "sticky", `${stuck.which} → position: ${stuck.position}`);
        /* 光 sticky 不够：比视口还高的 sticky 会钉在顶上、然后你永远看不到它的底部 */
        check("右栏比视口高时自己能滚", ["auto", "scroll"].includes(stuck.scrolls), `overflow-y: ${stuck.scrolls}`);
        // 正文够长时才量得到真实位移；量不到就照实说，别回一个 0 冒充「钉住了」
        check("吸住之后再滚，右栏不动", stuck.drift < 0 || stuck.drift <= 1,
          stuck.drift < 0 ? "这一页不够长，位移量不到" : `吸住之后又滑了 ${stuck.drift}px`);
        /**
         * ⚠️ **滚正文不该带动右栏自己的滚动条。**
         * 右栏是独立滚动区，它的内部位置只该由「鼠标在右栏上滚」来改——
         * 被正文带着走的话，你回头看右栏，顶上那块已经不见了。
         */
        check("滚正文没带动右栏自己的滚动", stuck.innerScroll < 0 || stuck.innerScroll === 0,
          `右栏内部滚到了 ${stuck.innerScroll}px`);
        check("吸住之后右栏没滑到操作条底下", stuck.underBar === null || stuck.underBar <= 1,
          stuck.underBar === null ? "这一页没有操作条" : `离操作条底 ${-stuck.underBar}px`);
        // 「项目素材」那一行吸在右栏顶上，滚完还得在那儿
        check("滚完「项目素材」那一行还在右栏顶上", stuck.headTop < 0 || Math.abs(stuck.headTop) <= 2,
          stuck.headTop < 0 ? "这一档右栏是发布准备，没有那一行" : `离右栏顶 ${stuck.headTop}px`);
        /**
         * ⚠️ **右栏不许横向被撑破。** 这条和上面那条是同一个根因的两个症状——
         * 修完只量 sticky 的话，下次某个 `nowrap` 的长标题回来时，
         * 你会先看到「右栏又跟着滚了」，而真正坏的是这一条。
         */
        /**
         * ⚠️ **判据是「有没有东西戳出右栏」，不是「有没有元素内部被裁」。**
         * `.pseed__from` 那种 `overflow:hidden + ellipsis` 的元素**天生内部被裁**——
         * 拿 `scrollWidth` 当判据的话这条会一直红（或者更糟：绿着却在消息里
         * 报一个吓人的数字，那是这个项目最熟的一种假绿）。
         */
        check("右栏没被内容撑破", stuck.overhang <= 1 && !stuck.worst,
          stuck.worst || `外壳溢出 ${stuck.overhang}px`);
        /**
         * ⚠️ **定高公式里那个数是猜不得的，所以钉住结果。**
         * 只要它没把顶栏算进去，这一条就红——而错的时候屏幕上的样子是
         * 「最后一条怎么都划不出来」，不像一个高度算错了。
         */
        check("右栏撑满时也不掉出视口", stuck.roomShort < 0 || stuck.roomShort <= 2,
          `满高时超出 ${stuck.roomShort}px`);
        // 顶栏高度写死在 `--topbar-h` 里给那个公式用——内容撑高了它，公式就该跟着改
        check("顶栏的实际高度和 --topbar-h 对得上", Math.abs(stuck.topbar - stuck.topbarVar) <= 1,
          `实际 ${stuck.topbar}px · 变量 ${stuck.topbarVar}px`);
      }
      /**
       * ⚠️ **正文那一栏要吃满宽度**（`.main__inner:has(.project-workspace)` 解掉 1320 的上限）。
       * 不解的话正文和右栏一起被压到 900 出头，编辑器一行只剩三十来个字。
       * 量的是**渲染后的宽度**，不是样式表里写了 `max-width: none`。
       */
      const wide = await page.evaluate(() => {
        const inner = document.querySelector(".main__inner");
        const main = document.querySelector(".main");
        return inner && main ? Math.round(main.clientWidth - inner.getBoundingClientRect().width) : -1;
      });
      check("项目详情页吃满正文栏宽度", wide >= 0 && wide <= 1, `比容器窄 ${wide}px`);
      /**
       * ⚠️ **这一页也只准有一颗实心黑。**
       * 发布准备那一栏的版本切换器原来选中即涂成实心黑，而右上角还有一颗黑的「去排版」——
       * 黑在这套界面里的意思是「点这儿」，一屏两处就等于没说。
       * 量的是**渲染后有几个元素的底色等于正文黑**，不是「样式表里写了几次 --accent」。
       */
      const solids = await page.evaluate(() => {
        const ink = getComputedStyle(document.body).color;
        return [...document.querySelectorAll(".project-workspace *")]
          .filter((el) => getComputedStyle(el).backgroundColor === ink)
          .map((el) => el.className.toString().slice(0, 40));
      });
      check("这一页只有一颗实心黑", solids.length <= 1, solids.join(" · ") || "(一颗都没有)");
    } else {
      /* 打不开就照实说是**哪一种**打不开，别写成一句「跳过」——
         「没连上流水线」和「页面本身坏了」在输出里必须分得开 */
      const why = (await page.textContent(".project-workspace-load .note-danger").catch(() => "")).replace(/\s+/g, " ").trim();
      check("项目详情页没打开", !!why, why || "既没有页面也没有错误提示");
    }
    await page.goBack();
    await page.waitForSelector(".ptable__row, .kanban-col, .empty, .project-setup", { timeout: 25000 }).catch(() => {});
  }

  /**
   * 找题：**我现在想写，但还没有种子**。
   *
   * ⚠️ **这一页不产出选题，它产出候选。** 使用者问过「是不是应该一键获取选题」——
   * 不应该：一键产出的选题**不带你的判断**，而那正是这条链要问出来的东西。
   *
   * ⚠️ **这一段同样不许真写库**：数写请求次数（`writes === 0`）。
   */
  await page.goto(`http://127.0.0.1:${PORT}/#/ideas`, { waitUntil: "networkidle" });
  await page.waitForSelector(".ideas__sec", { timeout: 25000 }).catch(() => {});
  /**
   * ⚠️ **等的是「真有卡了」，不是那个壳。** 这一周第一次打开要跑一次出卡（LLM），
   * 等 `.ideas__sec` 会在还在转圈的时候就返回——量到 0 条，看着像功能坏了。
   * 出完会缓存，所以只有一周里的第一次会等这么久。
   */
  await page.waitForSelector(".idea, .ideas__sec .empty", { timeout: 90000 }).catch(() => {});

  /**
   * ⚠️ **三个来源站在同一排，而且都要在首屏。**
   * 上一版三段并列，洞察那 8 张卡把另外两个入口挤到了屏外——你得滚很久才看得到
   * 「从素材里找」和「拆争点」，而那两个恰恰是「我主动想找点什么写」时最该按的。
   * 量的是**渲染后的位置**，不是「元素存在」——存在但在第三屏等于不存在。
   */
  const srcChips = await page.evaluate(() => {
    const chips = [...document.querySelectorAll(".filter-head .chip")];
    return {
      labels: chips.map((c) => c.textContent.trim()),
      // 最后一颗芯片的底边还在视口内，才算「都在首屏」
      lastBottom: chips.length ? Math.round(chips[chips.length - 1].getBoundingClientRect().bottom) : -1,
      viewport: window.innerHeight,
    };
  });
  check("三个来源在同一排芯片上", srcChips.labels.length === 3, srcChips.labels.join(" / "));
  /**
   * ⚠️ **芯片在说明的上面，不是下面。**
   * 这两页打开时你要先做一个选择（看哪一类候选 / 看哪一档种子），
   * 那排芯片才是第一件事，说明是它的注脚——反过来的话你得先读完一句
   * 早就知道的话，才看到真正要点的东西。
   */
  const headOrder = await page.evaluate(() => {
    const row = document.querySelector(".filter-head__row");
    const desc = document.querySelector(".filter-head__desc");
    if (!row || !desc) return null;
    return Math.round(desc.getBoundingClientRect().top - row.getBoundingClientRect().bottom);
  });
  check("芯片在上、说明在它正下方", headOrder === null || headOrder >= 0,
    headOrder === null ? "这一页没有说明" : `说明在芯片下方 ${headOrder}px`);
  check("三个入口都在首屏", srcChips.lastBottom > 0 && srcChips.lastBottom < srcChips.viewport,
    `最后一颗在 ${srcChips.lastBottom}px / 视口 ${srcChips.viewport}px`);

  /**
   * 洞察那段的条数**和本地 registry 里的候选数相等**。
   * ⚠️ 钉这条是因为界面**不许按 `queue_status` 过滤**：「还要查资料」的那些
   * 也可能正是你想写的，偷偷过滤的界面看不出自己在过滤。
   * ⚠️ 二选一：还没跑过洞察时本来就没有 registry，那时该出空态引导。
   */
  const { latestCandidates } = await import("../server/lib/insight-candidates.mjs");
  const reg = await latestCandidates();
  const ideaCards = await page.$$eval(".idea", (els) => els.length);
  const ideaEmpty = !!(await page.$(".ideas__sec .empty"));
  check("洞察候选一条不漏地摆出来", reg.items.length ? ideaCards === reg.items.length : ideaEmpty,
    reg.items.length ? `界面 ${ideaCards} / registry ${reg.items.length}` : "还没跑过洞察，给的是空态引导");

  if (ideaCards) {
    let ideaWrites = 0;
    let expandReqs = 0;
    const countIdeaWrites = (req) => {
      if (req.method() === "POST" && /\/api\/pipe\/seeds/.test(req.url())) ideaWrites += 1;
    };
    const countAny = () => { expandReqs += 1; };
    page.on("request", countIdeaWrites);

    /**
     * ⚠️ **展开不许发任何请求。** 卡片在「出候选的那一刻」就写好了——
     * 这是那次重做的**全部意义**。哪天这儿开始点开才去算，说明设计被绕回去了。
     */
    const more = await page.$(".idea__more");
    if (more) {
      page.on("request", countAny);
      await more.click();
      await page.waitForTimeout(700);
      page.off("request", countAny);
      const detail = await page.$$eval(".idea__detail dd", (els) => els.map((e) => e.textContent.trim()).filter(Boolean));
      check("展开就能看到卡片内容", detail.length > 0, `${detail.length} 项`);
      check("展开一个请求都不发", expandReqs === 0, `${expandReqs} 个请求`);
    } else {
      check("这批候选还没写成完整的卡，展开这一段量不了", true, "没有可展开的");
    }

    await page.click(".idea__seed");
    await page.waitForSelector(".rpick", { timeout: 8000 }).catch(() => {});
    /**
     * ⚠️ **候选不能一键落库。** 点「记成种子」弹出来的必须是反应选择器——
     * 它问的正是「你能加什么」，而那个问题的答案只存在你脑子里。
     */
    check("候选不能一键变成种子，得先问你一句", !!(await page.$(".rpick")));
    /**
     * ⚠️ **take 已经预填成这条卡的角度。**
     * 使用者说「暂时没想法但觉得可以写，应该可以直接记」——预填之后
     * 你可以直接按「记下来」。**规则没松**：种子仍然必须有一句话。
     */
    const prefilled = await page.inputValue(".rpick__take").catch(() => "");
    check("从候选进来时那句话已经预填好了", prefilled.trim().length > 4, prefilled.slice(0, 40));
    // 反应清单分三个 tab：十条平铺时输入框被挤到屏幕最下面，而那句话才是主角
    const picked = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll(".rpick__tab")].map((e) => e.textContent.trim()),
      // ⚠️ 带上选项数：tabs 和 opts 同时为 0 说明**清单压根没送到**（不是 tab 没画出来），
      //    那是两个完全不同的毛病，只报 tabs 的话得自己去猜
      opts: document.querySelectorAll(".rpick__opt").length,
    }));
    check("反应清单分成 tab，不是一长条", picked.tabs.length >= 2,
      `${picked.tabs.join(" / ") || "没有 tab"} · ${picked.opts} 个选项`);

    await page.keyboard.press("Escape");
    await page.waitForSelector(".rpick", { state: "detached", timeout: 5000 }).catch(() => {});
    page.off("request", countIdeaWrites);
    check("找题这一段没往库里写一行", ideaWrites === 0, `${ideaWrites} 次写请求`);
  } else {
    check("洞察那段这会儿是空的，记成种子这一段量不了", true, "空态");
  }

  /**
   * 种子：这条链的新起点（`docs/工作流.md`）。
   * **种子 = 你看到的东西 + 你对它的一句话**，它解决的是「看到一个观点想写，
   * 但不知道自己能加什么」——而「能加什么」的答案几乎总是你自己的经历和判断。
   *
   * ⚠️ **这一段一个字都不能真存。** 建种子会往线上库里写行。所以走法是
   * 「打开选择器 → 填字 → 不提交」，并且**数写请求次数**（`writes === 0`）——
   * 只断言「弹层出来了」抓不住问题，弹层和写入可以同时发生（`askPlatformsOn` 的教训）。
   */
  await page.goto(`http://127.0.0.1:${PORT}/#/seeds`, { waitUntil: "networkidle" });
  await page.waitForSelector(".seeds, .empty, .note-danger", { timeout: 25000 }).catch(() => {});

  let seedWrites = 0;
  const countSeedWrites = (req) => {
    if (req.method() === "POST" && /\/api\/pipe\/seeds/.test(req.url())) seedWrites += 1;
  };
  page.on("request", countSeedWrites);

  // ⚠️ 「记一句」现在是紧挨着芯片的一颗 `+`（`.filter-head__add`），不再是右上角那条长按钮
  await page.click(".filter-head__add");
  await page.waitForSelector(".rpick", { timeout: 8000 });

  const picker = await page.evaluate(() => {
    const opts = [...document.querySelectorAll(".rpick__opt")];
    // 组名现在画成 tab（十条平铺时输入框被挤到屏幕最下面，而那句话才是主角）
    const groups = [...document.querySelectorAll(".rpick__tab")].map((g) => g.textContent.trim());
    const save = document.querySelector(".rpick .btn-primary");
    return {
      count: opts.length,
      // ⚠️ 七行一样的提示语等于没有提示——量的是**文案逐条不同**
      unique: new Set(opts.map((o) => o.textContent.replace(/^\s*\d\s*/, "").trim())).size,
      // take 空着时保存点不动，**而且屏幕上要写出原因**（灰按钮自己说不了话）
      disabled: !!save?.disabled,
      hint: document.querySelector(".rpick__hint")?.textContent.trim() || "",
      groups,
      // 有没有一组是冲着「一件事/一个发布」去的——发布类的东西全靠它
      hasEvent: groups.some((g) => /事|发布/.test(g)),
      // 当前 tab 里看得见几条：分 tab 之后一屏只该出现一组
      shownNow: [...document.querySelectorAll(".rpick__opt")].length,
    };
  });
  /**
   * ⚠️ **文案的真源在 Worker 的 `values.js`，前端一个字都不写死。**
   * 所以这儿不钉具体措辞——钉了的话 Worker 那边调一个字这条就红，而代码完全正确。
   */
  /**
   * ⚠️ **不钉条数。** 钉了的话以后补一条反应这条就红，而代码完全正确。
   * 要钉的是**不变量**：逐条不同、分了组、而且有一组是对着「一件事」的。
   *
   * 最后那条不是凑数：第一版七条**全都假设触发物是「一个观点」**，
   * 于是「DeepSeek 发布了 V4-Flash，我想写」一条都选不上——你没法「同意」一件事实。
   * 而热点里大量是发布和事件。**没有那一组，这个清单对一半的触发物就是空的。**
   */
  check("反应逐条不同", picker.count > 0 && picker.count === picker.unique, `${picker.count} 条 / ${picker.unique} 种`);
  check("反应分成 tab，不是一长条平铺", picker.groups.length >= 2, picker.groups.join(" / "));
  check("有一组是对着「一件事 / 一个发布」的", picker.hasEvent, picker.groups.join(" / "));
  /**
   * ⚠️ **一次只画一组。** 十条平铺那一版整屏被按钮占满，
   * **而要你打的那句话才是这一屏的主角**——输入框被挤到了屏幕最下面。
   */
  check("一次只画当前那一组", picker.shownNow > 0 && picker.shownNow < 7, `${picker.shownNow} 条`);
  check("没写看法时保存点不动，而且说了为什么", picker.disabled && /看法/.test(picker.hint), `${picker.disabled ? "灰的" : "能点"} · ${picker.hint.slice(0, 30)}`);

  // 填上字，按钮该活过来——但**仍然不提交**
  await page.click(".rpick__opt >> nth=1");
  await page.fill(".rpick__take", "冒烟测试：这句话不会被提交");
  const ready = await page.evaluate(() => !document.querySelector(".rpick .btn-primary")?.disabled);
  check("写了看法之后就能存了", ready);

  await page.keyboard.press("Escape");
  await page.waitForSelector(".rpick", { state: "detached", timeout: 5000 }).catch(() => {});
  page.off("request", countSeedWrites);
  check("整段没往库里写一行", seedWrites === 0, `${seedWrites} 次写请求`);

  /**
   * ⚠️ **热点页那颗「我有反应」和「收录」不是一回事。**
   * 收录 = 这东西以后可能有用（进灵感库）；有反应 = **我此刻有话说**。
   * 判据是「你有没有话说」，两条出口在工作流文档里是并列的——合并成一颗就没了那个区别。
   */
  await page.goto(`http://127.0.0.1:${PORT}/#/hot`, { waitUntil: "networkidle" });
  await page.click('.pill-tab:has-text("AI 情报")', { timeout: 8000 }).catch(() => {});
  await page.waitForSelector(".ai-item, .empty", { timeout: 40000 }).catch(() => {});
  const hotSeed = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".ai-item")];
    if (!items.length) return null;
    return {
      items: items.length,
      // 每条要么给「我有反应」、要么显示「说过了」——两者恰好一个
      entries: items.filter((it) => /我有反应/.test(it.textContent) || /说过了/.test(it.textContent)).length,
      collect: items.filter((it) => it.querySelector(".collect, [class*=collect]")).length,
    };
  });
  if (hotSeed) {
    check("AI 情报每条都能记一句反应", hotSeed.entries === hotSeed.items, `${hotSeed.entries}/${hotSeed.items}`);
  } else {
    check("AI 情报这会儿没抓到内容，反应入口这一段量不到", true, "空态");
  }

  /* ⚠️ **走之前把路由放回「内容」。** 这一段为了验热点页那颗入口跳去了 `#/hot`，
     而紧接着的几条量的是**内容的二级导航**——不归位的话它们量到的是「发现」那一组，
     红的是断言不是界面。跨页面的测试段落必须自己收拾干净。 */
  await page.goto(`http://127.0.0.1:${PORT}/#/content`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => [...document.querySelectorAll(".subnav-item")].some((e) => e.textContent.includes("项目")),
    null,
    { timeout: 8000 },
  ).catch(() => {});

  check("内容页不再把五个库画成主 Tab", !(await page.$(".main > .pill-tabs")));
  /**
   * ⚠️ **顺序有意义**：这一排是按流程从左往右排的，不是按重要性——
   * 还没有想写的 → 找题；已经有话说的 → 种子；开始写了 → 项目。
   *
   * ⚠️ **和 `App.jsx` 的 NAV 常量比，不写死那一串。**
   * 写死的话加一页这条就红，而代码完全正确（这个文件里已经栽过，
   * 旁边那条「每项两个字」就是当时留下的正确写法）。
   */
  const navSrc = await fs.promises.readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const wantSubnav = [...(navSrc.match(/key: "content"[\s\S]*?children: \[([\s\S]*?)\]/)?.[1] || "")
    .matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  const contentSubnav = (await page.$$eval(".subnav-item", (els) => els.map((e) => e.textContent.trim()))).join("/");
  // ⚠️ 带上量到的值：这条原来一个诊断信息都没有，红了只能靠猜
  check("内容二级导航可直接进入", wantSubnav.length > 0 && contentSubnav === wantSubnav.join("/"),
    `${contentSubnav}（常量 ${wantSubnav.join("/")}）`);
  await page.click('.nav-item:has-text("发现")');
  /* ⚠️ **等的是面包屑里真的写上「热点」，不是 `.crumbs` 这个壳。**
     那个壳每一页都在，`waitForSelector` 立刻就返回——读到的是上一页的面包屑。
     「等容器不等内容」在这个文件里已经记过三次，这是第四处。 */
  await page.waitForFunction(() => /热点/.test(document.querySelector(".crumbs")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
  check("发现直接进入热点而非中转页", /热点/.test(await page.textContent(".crumbs")));
  /**
   * ⚠️ **跟 `App.jsx` 的 NAV 常量比，不写死那一串。**
   * 这个文件已经为「钉了一个本来就会变的名字」红过四次了
   *（一级导航、内容二级两处、这儿）。旁边那条「每项两个字」才是真规矩。
   */
  const wantDiscover = [...(navSrc.match(/key: "discover"[\s\S]*?children: \[([\s\S]*?)\]/)?.[1] || "")
    .matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  const gotDiscover = await page.$$eval(".subnav-item", (els) => els.map((e) => e.textContent.trim()));
  check("发现二级导航可直接进入", wantDiscover.length > 0 && gotDiscover.join("/") === wantDiscover.join("/"),
    `${gotDiscover.join("/")}（常量 ${wantDiscover.join("/")}）`);
  await page.click('.subnav-item:has-text("书架")');
  await page.waitForSelector(".bookshelf, .empty, .note-title", { timeout: 8000 });
  const shelfHash = await page.evaluate(() => location.hash);
  check("二级导航能直接打开书架", shelfHash.startsWith("#/shelf"), shelfHash);
  /**
   * ⚠️ **素材现在是「发现」的二级，不再是一级。**
   * 发现回答的是「东西从哪儿来」（热点 / 洞察 / 书架），而素材是
   * **已经收下来并拆好的那些**——同一类，只是更靠后一步。
   * 放进「内容」会把那条链插断：素材不在链上，它是链**旁边**的储备。
   */
  await page.click('.subnav-item:has-text("素材")');
  await page.waitForSelector(".mflow, .empty, .note-title", { timeout: 25000 });
  check("素材归到「发现」底下", /素材/.test(await page.textContent(".crumbs")), await page.textContent(".crumbs"));
  // 素材自己仍然是**一整页**（链路那一排就是筛选器），没有再往下分二级
  check("素材没有再拆成三个入口", !(await page.$(".main > .pill-tabs")));
  await page.click('.nav-item:has-text("今日")');
  await page.waitForSelector(".crumbs", { timeout: 8000 });

  /**
   * 侧栏能收起，而且**记得住**。
   *
   * 收起态只剩一列图标：文字是 `display:none` 而不是换一套 DOM——同一批节点两种形态，
   * 加一个导航项才不会要改两处。**测完必须展开回去**：后面还要按可见标签点击导航。
   */
  /**
   * 收起侧栏。
   *
   * ⚠️ **这一段整个重写过。** 上一版验的是「收起后 logo 兼职当展开按钮」「收起态搜索
   * 只剩一个图标」「收起态齿轮不能消失」——那三条的前提是**搜索、设置、收放按钮都长在
   * 侧栏里**，而 60px 宽的一条里塞不下它们。这些东西现在都在**顶栏**，
   * 顶栏的宽度不受侧栏收放影响，所以那三个问题连同那套绕法一起没有了。
   *
   * 换来的是一条**更该钉的**：收侧栏时顶栏必须纹丝不动。那才是把它们搬上去的理由。
   */
  const topBefore = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().left) : -1; };
    return { find: r(".topbar__find"), gear: r(".topbar__icon"), crumb: r(".crumbs") };
  });
  await page.click(".topbar__rail");
  await page.waitForTimeout(250);
  const railW = await page.$eval(".sidebar", (e) => Math.round(e.getBoundingClientRect().width));
  check("收起后只剩一列图标的宽度", railW <= 64, `${railW}px`);
  check("收起后文字不占位", (await page.$eval(".nav-item", (e) => e.innerText.trim())) === "", await page.$eval(".nav-item", (e) => e.innerText));
  check("收起后图标还在", (await page.$$(".nav-item .nav-icon")).length === 5);
  // 角标退成一颗点：60px 里放不下数字，而「这儿有没有事」才是这一刻要回答的
  const dotOk = await page.evaluate(() => {
    const d = document.querySelector(".nav-item__dot");
    return !d || getComputedStyle(d).display !== "none";
  });
  check("角标退成一颗点", dotOk);

  const topAfter = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().left) : -1; };
    return { find: r(".topbar__find"), gear: r(".topbar__icon"), crumb: r(".crumbs") };
  });
  check(
    "收侧栏时顶栏纹丝不动",
    topAfter.find === topBefore.find && topAfter.gear === topBefore.gear && topAfter.crumb === topBefore.crumb,
    `搜索 ${topBefore.find}→${topAfter.find} · 齿轮 ${topBefore.gear}→${topAfter.gear} · 面包屑 ${topBefore.crumb}→${topAfter.crumb}`
  );
  // ⚠️ **设置入口在收起态下不能消失**：工作台没配好时它是唯一那条能走的路，
  // 而收起是个会一直保持的状态。搬去顶栏之后这条是天然成立的，但仍要钉着。
  check("收起态设置入口还在", await page.isVisible(".topbar__icon"));
  check("收起态搜索框还在", await page.isVisible(".topbar__find"));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".nav-item", { timeout: 8000 });
  check(
    "刷新后记得收着",
    (await page.$eval(".sidebar", (e) => Math.round(e.getBoundingClientRect().width))) <= 64
  );
  // 收放按钮**两种状态都在顶栏上**，不再需要「收起后 logo 兼职」那套
  check("收起态收放按钮仍在", await page.isVisible(".topbar__rail"));
  await page.click(".topbar__rail");
  await page.waitForTimeout(250);
  check("再点一下展开回去", (await page.$eval(".sidebar", (e) => Math.round(e.getBoundingClientRect().width))) > 150);

  /**
   * 2.5 设置：整屏覆盖层，左栏分类、右栏一段。
   *
   * ⚠️ **这一段一个字都不能真存**：写 `.env` 会让 Vite 重启整个 dev server，而这个测试
   * 跑的就是它自己起的那一个；写提示词更糟——那改的是 content-pipeline 的真文件。
   * 所以这里数的是**写请求的次数**，`writes === 0` 才算过。
   *
   * 只断言「确认态出来了」是抓不住的：确认和写入可以同时发生。这条教训来自
   * `askPlatformsOn` 那次——弹窗照弹，Worker 照样在五分钟内领走选题跑了三遍 LLM。
   */
  {
    let writes = 0;
    const countWrites = (r) => {
      const u = r.url();
      if (r.method() !== "POST") return;
      if (u.includes("/api/settings") && !u.endsWith("/verify")) writes++;
      if (u.includes("/api/prompts")) writes++;
    };
    page.on("request", countWrites);
    // 按 data-key 点，不按文字点：左栏有**两项都叫「流水线」**（连接的和它的提示词），
    // 而且标签本来就会改字——按文字点的选择器在这个项目里已经栽过一次（收起态的「创作」）
    const go = (key) => page.click(`.set-nav__item[data-key="${key}"]`);
    try {
      await page.click(".topbar__icon");
      await page.waitForSelector(".set-overlay .set-nav__item", { timeout: 8000 });

      const groups = await page.$$eval(".set-nav__title", (els) => els.map((e) => e.textContent));
      const navs = await page.$$eval(".set-nav__item", (els) => els.map((e) => e.innerText.trim()));
      check("左栏分五组", groups.join("/") === "连接/能力/模型/提示词/其他", groups.join("/"));
      check("左栏八项", navs.length === 8, navs.join("/"));
      // 右边一次只画一段：默认那段只有 vault 一个字段，不是十五个全铺出来
      check("右边一次只画一段", (await page.$$(".set-pane .set-field")).length === 1);
      check("非密钥字段带出当前值", (await page.$eval("#set-VAULT_ROOT", (e) => e.value)).length > 0);
      // 长说明默认收起——这正是上一版「一大坨」的根因
      const whyOpen = await page.$$eval(".set-pane .set-why", (els) => els.filter((e) => e.open).length);
      check("「为什么」默认是收起的", whyOpen === 0, `${whyOpen} 个展开着`);
      /**
       * ⚠️ **「为什么」不许自己占一行。** 它单独成行时，一个字段底下就是
       * 「说明 / 为什么 / 自检」三行灰字——正是被说「一大坨」的那个形状。
       * 判据是那句一行说明本身就是 `<summary>`：点整句都能展开。
       */
      const why = await page.evaluate(() => {
        const s = document.querySelector(".set-pane .set-why > summary");
        return s ? { text: s.textContent.trim(), more: !!s.querySelector(".set-why__more") } : null;
      });
      check(
        "「为什么」挂在说明句尾，不另起一行",
        why && why.more && why.text.endsWith("为什么") && why.text !== "为什么",
        JSON.stringify(why)
      );

      /**
       * 各环节模型这一段：数据在 **Worker 的 D1** 里，所以断言写成二选一——
       * 连得上就该列出环节，连不上（或 Worker 还没部署这个端点）就该给一条**带下一步**的话。
       * 写死其中一种的话，外部状态一变测试就红，而红着的测试等于没有测试。
       */
      await go("models");
      await page.waitForSelector(".set-models .set-models__row, .set-models .note-danger, .set-pane .note-danger", { timeout: 20000 }).catch(() => {});
      const modelPane = (await page.textContent(".set-pane")).replace(/\s+/g, " ");
      const rows = (await page.$$(".set-models__row")).length;
      check(
        "模型这一段要么列出环节、要么给下一步",
        rows > 0 || /wrangler deploy|Worker/.test(modelPane),
        rows ? `${rows} 个环节` : modelPane.slice(60, 140)
      );
      // ⚠️ 这一段写的是 Worker 的库，不是本机 .env——底部那颗「写入 .env」不能看着像也管它
      check("模型这一段说清了自己单独存", modelPane.includes("单独保存") || modelPane.includes("立刻生效"), "");
      /**
       * ⚠️ **提示框不许再长出左边那道竖线。**
       * 一道彩色竖线 + 一句加粗标题是所有界面里最不假思索的形状，撤过一次；
       * 而它属于「加回去也不报错、只有肉眼看得见」那一类，所以在这儿钉住：四边一样粗。
       */
      const noteBorder = await page.evaluate(() => {
        const el = document.querySelector(".note");
        if (!el) return null;
        const s = getComputedStyle(el);
        return { l: s.borderLeftWidth, t: s.borderTopWidth };
      });
      if (noteBorder) check("提示框四边一样粗，没有左侧竖线", noteBorder.l === noteBorder.t, `左 ${noteBorder.l} / 上 ${noteBorder.t}`);
      await go("vault");

      /**
       * ⚠️ **等的是自检结果，不是自检那个容器。** 上一版直接数 `.set-check` 就断言完了，
       * 那时候全是 `--wait`（转圈占位），断言照样全绿而它一次都没看到真正的结论。
       * 八条是同一个请求一起回来的，只要有一条落地，其余也都落地了。
       */
      await page.waitForSelector(".set-field__dot:not(.set-field__dot--wait), .set-check--ok, .set-check--bad, .set-check--warn, .set-check--off", { timeout: 40000 });
      /**
       * ⚠️ **配好了只在标题旁边留一枚绿点，字段底下一行都不占。**
       *
       * 走到这一版走了两步：先是整段的自检堆在段尾，三条并排全写「已配」——每一条说的话
       * 都等于没说；绑进字段之后仍然是一行小字，而它和输入框里那句「已配置」说的是
       * 同一件事。现在 ok / off 收成标题旁边一枚 `.dot`（结论进 `title`，那是核对信息，
       * 想起来才看一眼），块面留给 bad / warn——那时候要占地方的是**下一步做什么**，
       * 而一个要悬停才找得到的提示等于没有。
       */
      const okLook = await page.evaluate(() => {
        const f = document.querySelector(".set-pane .set-field");
        const dot = f?.querySelector(".set-field__label .set-field__dot");
        return {
          cls: dot ? [...dot.classList].join(" ") : null,
          title: dot?.title || "",
          rows: f ? f.querySelectorAll(".set-check").length : -1,
        };
      });
      check("配好了在标题旁边给一枚绿点", !!okLook.cls?.includes("dot-ok"), JSON.stringify(okLook));
      check("结论收进那枚点里，底下不再占一行", okLook.rows === 0 && okLook.title.length > 4, JSON.stringify(okLook));
      // 左栏的记号是这一版加左导航的全部理由：不逐段翻就知道哪一段出了事
      const marks = (await page.$$(".set-nav__mark")).length;
      check("左栏项上挂了状态记号", marks >= 3, `${marks} 枚`);

      await go("optional");
      await page.waitForSelector("#set-DEEPL_API_KEY", { timeout: 5000 });
      // 段尾只剩**没有字段可挂**的那几条（对话引擎压根没有输入框，Worker / Firecrawl
      // 各自跨两个字段）。它们通了时仍然是一行小字，不画块面
      const tailFlat = await page.$$eval(".set-pane > .set-check", (els) =>
        els.map((e) => ({
          loud: e.classList.contains("set-check--bad") || e.classList.contains("set-check--warn"),
          bg: getComputedStyle(e).backgroundColor,
        }))
      );
      check(
        "段尾那几条通了的也不画块面",
        tailFlat.every((t) => t.loud || /(, ?0\)|transparent)$/.test(t.bg)),
        JSON.stringify(tailFlat)
      );
      const secret = await page.$eval("#set-DEEPL_API_KEY", (e) => ({ type: e.type, value: e.value, ph: e.placeholder }));
      check("密钥框是 password 且不回显", secret.type === "password" && secret.value === "", `${secret.type} / "${secret.value}"`);
      check("密钥框说清楚留空会怎样", /留空则不改|未配置/.test(secret.ph), secret.ph);

      /**
       * ⚠️ **切段不能丢改动。** draft 挂在覆盖层顶层，左栏切的只是「右边画哪一段」。
       * 丢了的话「改 A → 去 B 改一下 → A 白改了」，而且不报错、屏幕上也看不出来。
       */
      await page.fill("#set-FIRECRAWL_BASE_URL", "http://127.0.0.1:3002");
      await go("data");
      await page.waitForSelector("#set-SNAPSHOT_KEEP_DAYS", { timeout: 5000 });
      await go("optional");
      await page.waitForSelector("#set-FIRECRAWL_BASE_URL", { timeout: 5000 });
      check(
        "切段不丢改动",
        (await page.$eval("#set-FIRECRAWL_BASE_URL", (e) => e.value)) === "http://127.0.0.1:3002"
      );
      // 计数是**跨段总数**：改了三段之后底下写「保存这 1 项」是骗人的
      check("底部计数跨段", /保存这 1 项/.test(await page.$eval(".set-overlay__foot .btn-primary", (e) => e.innerText)));

      // 提示词分两段，因为它们生效的方式不同
      await go("prompts-local");
      await page.waitForSelector("#p-chat\\.role", { timeout: 5000 });
      check("工作台提示词能改", (await page.$eval("#p-chat\\.role", (e) => e.value)).length > 20);
      // 安全约束只读展示：藏起来的话用户以为自己改的那段就是全部
      const guard = await page.$eval(".set-guard", (e) => e.innerText).catch(() => "");
      const guardEditable = await page.$(".set-guard textarea, .set-guard input");
      check("安全约束只读摆出来", /改不掉/.test(guard) && !guardEditable, guard.slice(0, 40));

      await go("prompts-worker");
      // 「今日」背景页自己也可能有 note-title，不能拿它冒充设置面板加载完成。
      await page.waitForSelector(".set-pp__item, .set-pane .note-title", { timeout: 8000 });
      // 二选一：content-pipeline 找得到就列文件、找不到就给引导
      const files = await page.$$eval(".set-pp__item", (els) => els.map((e) => e.innerText.trim()));
      if (files.length) {
        check("列出了流水线提示词", files.length >= 5, files.join("/"));
        await page.click(".set-pp__item");
        await page.waitForSelector(".set-pp__editor .cm-content", { timeout: 8000 });
        check("提示词能打开来改", (await page.$eval(".set-pp__editor .cm-content", (e) => e.innerText)).length > 30);
        // 没改动时那个按钮不该是能点的：它写的是另一个项目的文件
        check("没改动时存不了", await page.$eval(".set-pp__head .btn", (e) => e.disabled));
        // 「打开的是哪一个」必须看得出来。当前项是实心黑块（暗色下翻成白），
        // 和侧栏、页内 tab 同一个记号——一列十三个文件名里认不出选中的那个，这一段就白做了
        const picked = await page.evaluate(() => {
          const els = [...document.querySelectorAll(".set-pp__item")];
          const on = els.find((e) => e.getAttribute("aria-current") === "true");
          const off = els.find((e) => e !== on);
          return { on: getComputedStyle(on).backgroundColor, off: getComputedStyle(off).backgroundColor };
        });
        check("选中的文件看得出来", picked.on !== picked.off, `${picked.on} vs ${picked.off}`);
        // ⚠️ 这一段只能有**一条**滚动条（编辑器自己那条）。右栏也滚的话就是两层套在一起，
        // 鼠标在哪滚的是哪——「不要为了少一条滚动条去套 max-height」那条坑的同一种
        const scrolls = await page.evaluate(() => {
          const pane = document.querySelector(".set-pane");
          return pane.scrollHeight - pane.clientHeight;
        });
        check("右栏不跟着一起滚", scrolls <= 2, `右栏多出 ${scrolls}px`);
      } else {
        check("找不到 content-pipeline 时给引导", /content-pipeline/.test(await page.$eval(".note-title", (e) => e.textContent)));
      }

      /**
       * ⚠️ **焦点陷阱要真按 Tab。** 在 evaluate 里循环读 activeElement 只是在看焦点有没有
       * 自己动，那什么都测不出来。背后那一页上有「下架这本书」这类按钮，
       * 焦点走出去 + 一个回车就是一次误删。
       */
      let escaped = false;
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press("Tab");
        if (!(await page.evaluate(() => !!document.activeElement?.closest(".set-overlay")))) escaped = true;
      }
      check("Tab 走不出设置面板", !escaped);

      // 第一下：只进确认态，**一个字都不许写**
      await page.click(".set-overlay__foot .btn-primary");
      await page.waitForTimeout(400);
      const confirmText = await page.$eval(".set-overlay__foot .btn-primary", (e) => e.innerText.trim());
      check("第二下的按钮上写清东西去哪", /\.env/.test(confirmText), confirmText);
      check("第一下一个字都没写", writes === 0, `${writes} 次写请求`);
      // 确认态必须配一个退路：少了它，点错第一下就只剩「存」和「关掉这一页」两条路
      const foot = await page.$$eval(".set-overlay__foot .btn", (els) => els.map((e) => e.innerText.trim()));
      check("确认态有取消", foot.some((t) => t === "取消"), foot.join("/"));

      await page.click(".set-overlay__foot .btn:has-text('取消')");
      await page.waitForTimeout(200);
      check("取消之后也没写", writes === 0, `${writes} 次写请求`);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      check("Esc 关得掉设置面板", !(await page.isVisible(".set-overlay")));
      // 关闭后焦点回到打开它的那个按钮上，不掉回 body
      check("焦点回到齿轮上", await page.evaluate(() => document.activeElement?.classList.contains("topbar__icon")));
    } finally {
      page.off("request", countWrites);
    }
  }

  // 3. 兼容期的旧总览仍要完整可用，直到新今日页覆盖完这些能力。
  await page.goto(`http://127.0.0.1:${PORT}/#/overview`, { waitUntil: "networkidle" });
  const workerReady = await page.evaluate(() => fetch("/api/config").then((r) => r.json()).then((c) => c.worker.configured));
  if (workerReady) {
    await page.waitForSelector(".todo-card", { timeout: 20000 });

    // 一排三张卡，**分两组**。这是这块唯一真正要守住的东西：
    // 「待初筛 / 待整理 / 撰写中」是 Worker 自己会消化的队列，它们的 0 是正常态；
    // 「选题待写 / 初稿待修改」不点就永远不会动。两组画成一样重，你就分不出哪个欠着你。
    const labels = await page.$$eval(".todo-card__label", (els) => els.map((e) => e.textContent));
    check("等你动手的只有两张大卡", labels.length === 2, labels.join("/"));
    const nums = await page.$$eval(".todo-card__value", (els) => els.map((e) => e.textContent));
    check("计数是数字", nums.every((n) => /^\d+$/.test(n)), nums.join("/"));

    /**
     * ⚠️ 流水线那三段画成**一条有三个节点的流程线**，摆在两张卡底下。
     *
     * **不是装饰**：灵感进来先「待初筛」，筛完成「待整理」，整理成选题之后「撰写中」——
     * 本来就是一条链的三段，前一段的产出是后一段的输入。
     *
     * **不能删掉**：这是首页上唯一一处能看出「流水线卡住了」的地方（Worker 挂了、
     * LLM key 过期了，表现就是「待初筛」一路往上涨）。删了的话，坏掉是看不见的。
     */
    const autos = await page.$$eval(".pipe-flow__node", (els) => els.map((e) => e.textContent));
    check("流水线画成三个节点", autos.length === 3, autos.join("/"));
    // 节点之间要有连接线，否则就是三个孤立的点，看不出这是一条链
    check("节点之间有连接线", (await page.$$(".pipe-flow__line")).length === 2);
    // 横贯一整行才读得出「这是一条贯穿的流水线」——量的是它和正文列同宽
    const span = await page.evaluate(() => {
      const t = document.querySelector(".pipe-flow__track").getBoundingClientRect();
      const l = document.querySelector(".day-plan").getBoundingClientRect();
      return { track: Math.round(t.width), col: Math.round(l.width) };
    });
    check("流程线铺满正文宽度", span.track >= span.col - 8, `${span.track} / ${span.col}`);
    // ⚠️ 两端的名字不能挂到内容区外面（圆点贴边、名字还按圆点居中就会）
    const spill = await page.evaluate(() => {
      const box = document.querySelector(".pipe-flow__track").getBoundingClientRect();
      return [...document.querySelectorAll(".pipe-flow__name")]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1; }).length;
    });
    check("两端的名字不出界", spill === 0, `${spill} 个`);
    // ⚠️ **排在页头正下方、清单之前**：它是唯一能看出流水线卡住的地方，得每次打开都扫得到。
    // 「显眼」和「安静」是两件事——位置管前者（所以排在最前），视觉重量管后者（所以只占一行）。
    const order = await page.evaluate(() => {
      const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? NaN;
      return { flow: y(".pipe-flow"), list: y(".day-plan"), cards: y(".todo-grid") };
    });
    check("流程线排在清单之前", order.flow < order.list && order.list < order.cards, JSON.stringify(order));
    // 标题去掉了：三个节点名加上串成一条线，已经把它是什么说完了
    check("流程线没有多余的标题", !(await page.$(".pipe-flow__label")));
    // 层次全靠内容：那边一个 46px 的数字，这边一圈 12px 的小字
    const [cardPx, dotPx] = await page.evaluate(() => [
      parseFloat(getComputedStyle(document.querySelector(".todo-card__value")).fontSize),
      parseFloat(getComputedStyle(document.querySelector(".pipe-flow__dot")).fontSize),
    ]);
    check("两类数字的字号差得出层次", cardPx >= dotPx * 2.5, `${cardPx} vs ${dotPx}`);
    // 两张卡的标题必须在同一条线上
    const heads = await page.$$eval(".todo-card__label", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    check("两张卡的标题在同一条线上", Math.max(...heads) - Math.min(...heads) <= 1, heads.join("/"));

    /**
     * ⚠️ **0 的节点空心、非 0 才变实心。**
     * 这三段的 0 是**正常态**（Worker 自己会消化），给正常态加视觉重量等于每天都在提醒你
     * 一件不用做的事。真实数据多数时候全是 0，所以这里**直接改 DOM 属性验 CSS**——
     * 等一个真的堆起来的队列来测，这条规则就永远测不到。
     */
    // ⚠️ 翻完属性要**等过渡跑完再读**：`.pipe-flow__dot` 上有 `transition`，
    // 立刻读 `getComputedStyle` 拿到的还是过渡的起始值，断言会假红。
    const dotBg = () => page.$eval(".pipe-flow__dot", (e) => getComputedStyle(e).backgroundColor);
    const beforeBg = await dotBg();
    const wasBusy = await page.$eval(".pipe-flow__node", (e) => {
      const was = e.dataset.busy;
      e.dataset.busy = "true";
      return was;
    });
    await page.waitForTimeout(300);
    const afterBg = await dotBg();
    await page.$eval(".pipe-flow__node", (e, was) => { e.dataset.busy = was; }, wasBusy);
    check("堆了东西的节点才变实心", beforeBg !== afterBg, `${beforeBg} → ${afterBg}`);



    /**
     * ⚠️ **「其中最该先做的那一条」长在待办卡里，不再是一个独立的「系统建议」区块。**
     * 那两块说的是同一件事的两个层次（有几条 / 该先做哪条），分开摆就是说了两遍。
     * 而且旧那份的四条队列里有两条引的状态在 D1 的 CHECK 约束里根本不存在
     * （`drafts/待发布`、`inbox/需处理`），**永远取不到东西也永远不报错**。
     */
    /**
     * ⚠️ **计数和列表是两个请求，别在中间那一刻量。**
     * 卡上的数字来自计数接口（快），下面几行来自列表接口（慢）。两者之间有一段时间
     * 卡片是「数字 1、一条没列」——那正是这条断言要抓的**坏状态**，但它此刻只是**还没到**。
     * 所以先等不变量成立再量：真的坏了的话等不到，超时之后断言照样红。
     */
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll(".todo-card")].every(
            (c) => c.dataset.empty === "true" || c.querySelectorAll(".todo-card__row").length > 0
          ),
        null,
        { timeout: 10000 }
      )
      .catch(() => {});
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".todo-card")].map((c) => ({
        empty: c.dataset.empty === "true",
        n: c.querySelectorAll(".todo-card__row").length,
      }))
    );
    check(
      "非空的待办卡都列出了几条",
      rows.every((r) => (r.empty ? r.n === 0 : r.n > 0)),
      rows.map((r) => `${r.empty ? "空" : "有"}:${r.n}`).join("/")
    );
    // 最多列 TOP_N 条，**卡里不开滚动区**（项目否决过「为了少一条滚动条套 max-height」）
    check("一张卡最多列三条", rows.every((r) => r.n <= 3), rows.map((r) => r.n).join("/"));
    const scrollers = await page.evaluate(() =>
      [...document.querySelectorAll(".todo-card__list")].filter((e) => e.scrollHeight > e.clientHeight + 1).length
    );
    check("卡里没有自己滚的区域", scrollers === 0, `${scrollers} 个`);

    // ⚠️ **一行文字不能撑破卡片。** grid / flex 的子项默认 `min-width: auto`，少写一处
    // `min-width: 0` 那行字就跑到边框外面去，`text-overflow: ellipsis` 根本轮不到生效。
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll(".todo-card")].filter((c) => {
        const box = c.getBoundingClientRect();
        return [...c.querySelectorAll(".todo-card__row")].some((r) => r.getBoundingClientRect().right > box.right + 1);
      }).length
    );
    check("条目不撑破卡片", overflow === 0, `${overflow} 张溢出`);

    // 卡里有两个按钮（加进今天 / 去看看），所以外壳不能是 button——button 套 button 是非法结构
    const cardTag = await page.$eval(".todo-card", (e) => e.tagName);
    check("待办卡的外壳不是按钮", cardTag !== "BUTTON", cardTag);
    // 动作行贴底，三张卡的按钮才落在同一条线上
    const acts = await page.$$eval(".todo-card__acts", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    if (acts.length > 1) check("两张卡的动作行在同一条线上", Math.max(...acts) - Math.min(...acts) <= 1, acts.join("/"));

    if (rows.some((r) => r.n)) {
      // 每一行都能单独进清单——这是「库里有什么」和「我今天要做什么」之间那条路。
      // 按钮只有图标，所以断言读 aria-label（图标按钮必须有名字，这也是本套件另一条断言）
      const addLabel = await page.getAttribute(".todo-card__add", "aria-label").catch(() => "");
      check("卡里每条都能加进清单", /加进(今天|明天)|已在清单/.test(addLabel || ""), addLabel);
      /**
       * ⚠️ **加进清单之后那一条不从卡里消失。**
       * 卡片是库的镜子、清单是你的承诺——「选题待写 2」数的是库里真实处于「待写」的条数，
       * 你把它抄进清单那条选题**还是待写**。移掉它，上面那个数字和下面的列表当场对不上。
       * 它真正消失是等库里状态变了（选题 → 撰写中），那时计数自己会减 1。
       */
      const marked = await page.$$('.todo-card__row[data-on="true"]');
      if (marked.length) {
        const dim = await page.$eval('.todo-card__row[data-on="true"] .todo-card__top', (e) => getComputedStyle(e).color);
        const normal = await page.$eval('.todo-card__row:not([data-on="true"]) .todo-card__top', (e) => getComputedStyle(e).color).catch(() => "");
        check("已在清单的那条留在原位、只变灰", !normal || dim !== normal, `${dim} vs ${normal}`);
      }
    }

    /**
     * 首页要有创作入口。和侧栏常驻的「入库」**不是一回事**：入库是存一条已经有的素材，
     * 新建是开一篇还不存在的。同一个动作两个入口才该合并，这是两个动作。
     * ⚠️ 用的是和「创作」页右上角**同一个弹层**（`CreationDialog`）——复制一份简化版的话，
     * 以后加一种创建方式会漏掉这一处。
     */
    const createBtn = await page.$('.page-bar__end .btn-primary');
    check("首页有新建入口", !!createBtn);
    if (createBtn) {
      /**
       * ⚠️ **「新建」现在是个下拉，起点在点之前就摊开了。**
       *
       * 上一版这三条测的是弹层里那一屏「起点选择」——整屏只干一件事：问你三选一。
       * 下拉把那个问题提到了点击之前，选完直接进对应那一屏，**同一个决定少一次全屏切换**。
       * 那一屏本身还在（弹层内部「← 起稿方式」退回来时要用），只是不再是主路。
       *
       * ⚠️ **三条起点的真源是 `CreationDialog` 的 `MODES`**，下拉不抄第二份——
       * 所以这里断言的条数直接跟那份常量比，抄漏一条会红。
       */
      await createBtn.click();
      await page.waitForSelector(".menu-btn__pop", { timeout: 6000 });

      /**
       * 菜单摊开的是**平台 + 两条准备起点**，分两节。
       *
       * ⚠️ **「空白文章」展开成平台，不是一颗按钮。** 主稿的平台建完就改不了
       *（Worker 的 `EDITABLE.drafts` 里没有 `platform`，只能再加平台变体），
       * 所以必须在点下去之前问清楚——默认一个「大概是公众号吧」的代价是
       * 你写完才发现，只能重开一篇。
       *
       * 两份清单的真源都在别处（平台在 `lib/platforms.js`、起点在 `MODES`），
       * **这儿跟常量比条数，不写死数字**——写死的话加一个平台这条就红，而代码是对的。
       */
      const dialogSrc = await fs.promises.readFile(new URL("../src/components/CreationDialog.jsx", import.meta.url), "utf8");
      const platformSrc = await fs.promises.readFile(new URL("../src/lib/platforms.js", import.meta.url), "utf8");
      const wantModes = (dialogSrc.match(/export const MODES = \[([\s\S]*?)\];/)?.[1].match(/\{ key:/g) || []).length;
      const wantPlatforms = (platformSrc.match(/PLATFORMS = \[([^\]]+)\]/)?.[1].match(/"/g) || []).length / 2;
      const rows = await page.$$eval(".menu-btn__row b", (els) => els.map((e) => e.textContent.trim()));
      const sections = await page.$$eval(".menu-btn__section", (els) => els.map((e) => e.textContent.trim()));
      check("新建下拉里是平台 + 准备起点", wantPlatforms > 0 && rows.length === wantPlatforms + (wantModes - 1),
        `${rows.join("/")}（平台 ${wantPlatforms} + 起点 ${wantModes - 1}）`);
      check("菜单分了节，不是十条平铺", sections.length === 2, sections.join(" / "));

      /**
       * ⚠️ **这一条是这一轮的核心：选一个平台**不开弹层**，直接落在项目页上。**
       *
       * 写作只有一个地方（`#/project/:id`）。同一件事（写字）曾经有两个界面，
       * 而那两个界面的能力还不一样——项目页有素材栏、发布准备、阶段推进，弹层没有。
       *
       * ⚠️ **建项目那一发要拦掉。** 真让它建的话，每跑一次冒烟测试就往线上库里
       * 塞一个空项目。拦掉之后量的仍然是**真实的路由决定**（跳没跳、跳去哪），
       * 而那正是这一轮改的东西。
       */
      let created = 0;
      await page.route("**/api/pipe/create", (route) => {
        created += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, draft: { id: "smoke-draft", topicId: "smoke-topic" }, project: { id: "smoke-topic" } }),
        });
      });
      await page.click(".menu-btn__row");
      await page.waitForFunction(() => location.hash.startsWith("#/project/"), { timeout: 8000 }).catch(() => {});
      const landed = await page.evaluate(() => location.hash);
      check("选平台直接落在项目页，不开弹层", landed.startsWith("#/project/") && created === 1, `${landed} · ${created} 次建项目`);
      check("空白文章这条路上没有弹层", !(await page.$(".creation")));
      await page.unroute("**/api/pipe/create").catch(() => {});

      /**
       * 回首页继续测准备屏那两条。
       * ⚠️ **回来之后不能再用 `createBtn` 那个句柄**——整页重挂过了，
       * 旧句柄指向的元素已经脱离 DOM（`Element is not attached to the DOM`）。
       * 后面一律用选择器现点。
       */
      // ⚠️ **回的是总览页，不是首页**——这一整块跑在 `#/overview` 上（待办卡、
      //    流水线流程线、底部那条系统行都只在那儿）。回错页的话后面几条量的是另一页。
      await page.goto(`http://127.0.0.1:${PORT}/#/overview`, { waitUntil: "networkidle" });
      await page.waitForSelector(".page-bar__end .btn-primary", { timeout: 15000 }).catch(() => {});
      const openCreate = async () => {
        await page.click(".page-bar__end .btn-primary");
        await page.waitForSelector(".menu-btn__pop", { timeout: 6000 });
      };

      /**
       * 访谈欢迎区**不能被聊天气泡的样式串台**。
       *
       * 踩过一次：消息行的样式是按位置写的（`.creation-chat__log > div > span/p`），而欢迎区
       * 也是这个容器的直接子 div——于是那枚圆形图标被涂成灰色小标签、还被 `display:block`
       * 顶掉了居中，正文被套上聊天气泡的灰底。**代码在跑、测试全绿，只有肉眼看得见。**
       * 量的是渲染后的颜色和背景，不是有没有加 class。
       */
      // ⚠️ 从**下拉的第三条**进访谈，不再是起点屏上按数字键——那一屏已经不是主路了
      await page.keyboard.press("Escape");
      await page.waitForSelector(".creation", { state: "detached", timeout: 4000 }).catch(() => {});
      await openCreate();
      // ⚠️ **按文字点，不按序号。** 菜单里现在是「五个平台 + 两条准备起点」，
      //    按序号点的话加一个平台就会错位——而错位之后点开的是另一屏，测试却照跑。
      await page.click('.menu-btn__row:has-text("访谈起稿")');
      await page.waitForSelector(".creation-interview-welcome", { timeout: 6000 }).catch(() => {});
      const welcome = await page.evaluate(() => {
        const svg = document.querySelector(".creation-interview-welcome > span svg");
        const p = document.querySelector(".creation-interview-welcome > p");
        const box = svg?.getBoundingClientRect();
        return {
          icon: svg ? getComputedStyle(svg).color : "",
          square: box ? Math.abs(box.width - box.height) < 1 : false,
          bubble: p ? getComputedStyle(p).backgroundColor : "",
        };
      });
      check("欢迎区的图标是白的、不是聊天里那个灰标签", /255,\s*255,\s*255/.test(welcome.icon) && welcome.square, `${welcome.icon} · 正方 ${welcome.square}`);
      check("欢迎区的正文没被套上聊天气泡", /rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(welcome.bubble), welcome.bubble);

      /**
       * 访谈屏的版面：两条**只有量矩形才看得出来**的。
       *
       * 1. **开场不撑成一栋空房子。** 上一版弹层写死 720px 高，而这时屏上只有一句引导、
       *    三颗起手句和一个输入框——上半屏整片空白。现在开场不设高度，由内容决定。
       * 2. **欢迎区和输入框要同轴。** 这条**栽过两次**，而两次的断言都是绿的——只有量才抓得住。
       * 3. **发送键在输入盒子里面**，不是贴在旁边的第二个块。上一版是 76px 的框挨着 42px 的
       *    方按钮，两个尺寸不一样的东西并排，看着就是拼上去的；而且正是它逼出了第 2 条那个
       *    25px 的差值。所以这里量的是「它真的在盒子里」，不是「它俩底边齐平」——
       *    **底边齐平的写法能被那个并排的旧版满足**，等于没测。
       */
      const layout = await page.evaluate(() => {
        const box = (sel) => document.querySelector(sel)?.getBoundingClientRect() || null;
        const mid = (r) => (r ? r.left + r.width / 2 : null);
        const w = box(".creation-interview-welcome");
        const shell = box(".creation-chat__composer");
        const ta = box(".creation-chat__composer textarea");
        const send = box(".creation-composer__send");
        return {
          dialog: Math.round(box(".creation")?.height || 0),
          axis: w && ta ? Math.abs(mid(w) - mid(ta)) : null,
          inside: !!(shell && send && send.right <= shell.right && send.bottom <= shell.bottom && send.left >= shell.left),
        };
      });
      check("开场的访谈弹层不撑成空房子", layout.dialog > 0 && layout.dialog < 620, `${layout.dialog}px`);
      check("欢迎区和输入框同轴", layout.axis !== null && layout.axis <= 1, `差 ${layout.axis}px`);
      check("发送键长在输入盒子里", layout.inside);

      /**
       * **返回只有一个位置：标题旁边。** 原来三屏各放各的（素材在左栏底部、访谈在右栏底部、
       * 编辑器在页脚），同一个动作换一屏就要重新找一次。这条钉的是「三屏都在同一处、
       * 而且别处不再有第二个」——只断言「有返回按钮」的话，旧的那几个留在原地也照样绿。
       */
      /**
       * ⚠️ **从下拉直接进的那一屏不画返回。**
       * 「起点选择」那一屏用户根本没经过——给一个「← 起稿方式」，点下去会把人
       * 退到一屏他从没见过的地方。这条和「`preset` 指定的入口屏不画返回」是同一条，
       * 只是入口从「首页那颗按钮」换成了「下拉里的那一条」。
       */
      check("从下拉直接进的访谈屏不画返回", !(await page.$(".creation__head .creation__crumb")));
      const strayInterview = await page.$$eval(".creation-interview button", (els) => els.filter((e) => e.textContent.includes("返回")).length);
      check("访谈屏别处没有第二个返回", strayInterview === 0, `${strayInterview} 个`);

      // 换一条起点：素材屏。同样从下拉进，同样是入口屏
      await page.keyboard.press("Escape");
      await page.waitForSelector(".creation", { state: "detached", timeout: 4000 }).catch(() => {});
      await openCreate();
      await page.click('.menu-btn__row:has-text("从素材开始")');
      await page.waitForSelector(".creation-material-workspace", { timeout: 8000 }).catch(() => {});
      check("从下拉直接进的素材屏也不画返回", !(await page.$(".creation__head .creation__crumb")));
      const strayMaterial = await page.$$eval(".creation-material-workspace button", (els) => els.filter((e) => e.textContent.includes("返回")).length);
      check("素材屏别处没有第二个返回", strayMaterial === 0, `${strayMaterial} 个`);
      // 已选素材空着时只占一行：那句「选中的素材会留在这里…」原来占了 128px 去讲一件做一次就懂的事
      check("没选素材时只留一行小字", !!(await page.$(".creation-picked[data-empty='true']")));

      /**
       * 目标读者是 combobox：能选预设，也能自己打。
       * ⚠️ **Esc 只收菜单，不能把整个弹层一起关掉**——和 `ui.jsx` 的 `Select` 同一条，
       * 不在捕获阶段吞掉这一下的话，用户以为自己只是收了个下拉，结果整篇没保存的东西没了。
       */
      const audienceToggle = await page.$(".creation-audience__toggle");
      check("目标读者能选预设", !!audienceToggle);
      if (audienceToggle) {
        await audienceToggle.click();
        await page.waitForSelector(".creation-audience__pop", { timeout: 5000 }).catch(() => {});
        const first = (await page.textContent(".creation-audience__pop button")).trim();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);
        check("Esc 收菜单但不关弹层", !(await page.$(".creation-audience__pop")) && !!(await page.$(".creation")));
        await audienceToggle.click();
        await page.waitForSelector(".creation-audience__pop", { timeout: 5000 }).catch(() => {});
        await page.click(".creation-audience__pop button >> nth=0");
        check("选完就填进那一格", (await page.inputValue(".creation-audience input")) === first, first);
      }

      // 关键词搜不到不是终点：AI 那条路必须一直露在外面（真跑它要打一次 LLM，这里只验入口）
      await page.fill(".creation-material-search input", "zzz这个词不可能出现zzz");
      await page.waitForTimeout(900);
      const dead = (await page.textContent(".creation-material-empty").catch(() => "")) || "";
      check("搜不到时给的是下一步不是「换个词试试」", dead.includes("让 AI 按意思找"), dead.replace(/\s+/g, " ").slice(0, 60));

      /**
       * 引用标注：正文里哪一句来自哪条素材。
       *
       * 起稿那一步 mock 掉（真跑要打一次 LLM、几十秒），但 mock 的**只有内容**——
       * 编号、底纹、脚标、跳转、改写后变灰这几件事全是界面自己算的，测的正是它们。
       *
       * ⚠️ **脚标必须不在文档里。** 它是 CodeMirror 的 widget，不是正文字符；
       * 一旦真写进去，用户发布前得手动删一遍。这条断言就是钉这件事的。
       */
      const CITED = "信息过载导致的结果不仅是处理不过来，更深层的问题是人们会停止自己的思考。";
      const CITED2 = "大脑想要舒服的答案，和真正的答案，从来就不是同一个东西。";
      // 两条素材而不是一条：只有一条时，「点正文 → 右侧那条亮起来」会因为它本来就亮着而白过
      const mocks = [
        { id: "01HZZZZZZZZZZZZZZZZZZZZZZA", title: "信息过载的本质是替代思考", type: "核心观点", verificationStatus: "不适用", note: CITED },
        { id: "01HZZZZZZZZZZZZZZZZZZZZZZB", title: "大脑想要舒服的答案", type: "核心观点", verificationStatus: "不适用", note: CITED2 },
      ];
      const MOCK_BODY = [
        "# 你的脑子什么时候开始替别人转的", "", "有一个现象，你可能已经习惯到察觉不到了。", "",
        CITED, "", CITED2, "", "说白了，你不是被信息淹没了，你是把思考这件事外包了。",
      ].join("\n");
      const citeOf = (id, text) => ({
        id, start: MOCK_BODY.indexOf(text), end: MOCK_BODY.indexOf(text) + text.length,
        score: 0.98, quote: text, text,
      });
      await page.route("**/api/pipe/search/materials*", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items: mocks }) }));
      await page.route("**/api/pipe/draft/material", (route) =>
        route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({
            ok: true, body: MOCK_BODY, used: 2, skipped: [],
            citations: [citeOf(mocks[0].id, CITED), citeOf(mocks[1].id, CITED2)],
          }),
        }));

      // ⚠️ 按标题等，别等 `.creation-material-list button`——上一步搜「zzz」时留下的
      // 「让 AI 按意思找」也是这个选择器，会让 waitForSelector 立刻返回，然后点错按钮
      await page.fill(".creation-material-search input", "信息过载");
      await page.waitForSelector(`.creation-material-list button:has-text("${mocks[0].title}")`, { timeout: 6000 }).catch(() => {});
      for (const m of mocks) await page.click(`.creation-material-list button:has-text("${m.title}")`).catch(() => {});
      const picked = await page.$$eval(".creation-picked .creation-chip", (els) => els.length).catch(() => -1);
      check("点素材就进右栏的已选", picked === 2, `${picked} 条`);
      await page.fill(".creation-brief-field--grow textarea", "想说清楚信息过载真正的代价是什么");
      /**
       * ⚠️ **生成完停在这一屏，不跳走。**
       *
       * 待核验的金句和数据不进稿——挑了 2 条只用了 1 条这件事，
       * **跳进项目页就没地方说了**（那一页没有「刚才生成时发生了什么」这个概念，
       * Worker 也不存它）。所以这一屏在这儿停一下，把结果说清楚再走。
       *
       * mock 里故意剔掉一条，量的就是那句话真的出现在屏幕上。
       */
      await page.unroute("**/api/pipe/draft/material").catch(() => {});
      await page.route("**/api/pipe/draft/material", (route) =>
        route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ ok: true, body: MOCK_BODY, used: 1, skipped: [{ id: mocks[1].id, title: mocks[1].title }] }),
        }));
      await page.click('.creation-writing-paths button:has-text("让 AI 生成初稿")');
      await page.waitForSelector(".creation-generated", { timeout: 10000 }).catch(() => {});

      const gen = await page.evaluate(() => ({
        panel: !!document.querySelector(".creation-generated"),
        skip: document.querySelector(".creation-generated__skip")?.textContent.trim() || "",
        // 写完了要给字数：屏幕上唯一说明「它真写出东西了」的地方
        words: document.querySelector(".creation-generated__head em")?.textContent.trim() || "",
        // ⚠️ 弹层里**不能**有编辑器——写作只在 #/project/:id
        editor: document.querySelectorAll(".creation .cm-content").length,
        go: document.querySelector(".creation-generated__acts .btn-primary")?.textContent.trim() || "",
      }));
      check("生成完停在素材屏，给出结果", gen.panel && !!gen.words, `${gen.words}`);
      check("剔掉的素材在跳走之前就说了", gen.skip.includes(mocks[1].title), gen.skip.slice(0, 50));
      /**
       * ⚠️ **这条是这一轮的另一半：弹层里一个编辑器都没有。**
       * 同一件事（写字）曾经有两个界面，而那两个界面的能力还不一样——
       * 项目页有素材栏、发布准备、阶段推进，弹层没有。
       */
      check("弹层里没有编辑器", gen.editor === 0, `${gen.editor} 个`);
      check("结果条上那颗是「去写」", /去写/.test(gen.go), gen.go);

      await page.unroute("**/api/pipe/draft/material").catch(() => {});
      await page.unroute("**/api/pipe/search/materials*").catch(() => {});

      /**
       * ⚠️ **「起点选择」那一屏整个撤了。**
       * 它的全部作用是问三选一，而那个问题已经在页头那颗下拉里问完了
       *（`NewContentButton`）——留着等于同一个问题问两遍。
       * 这条钉的是它**没有偷偷长回来**：源码里不该再有 `"choose"` 这个屏。
       */
      const dialogNow = await fs.promises.readFile(new URL("../src/components/CreationDialog.jsx", import.meta.url), "utf8");
      check("起点选择那一屏撤干净了", !/screen === "choose"/.test(dialogNow));
      const todaySrc = await fs.promises.readFile(new URL("../src/pages/Today.jsx", import.meta.url), "utf8");
      check("首页空态那颗也走同一颗按钮", !/setCreation\("choose"\)/.test(todaySrc) && /NewContentButton/.test(todaySrc));

      await page.keyboard.press("Escape");
      await page.waitForSelector(".creation", { state: "detached", timeout: 4000 }).catch(() => {});
      check("Esc 关得掉创作弹层", !(await page.$(".creation")));
    }

    // 「N 件事等你」只数等你动手的两项。把 Worker 正在跑的活也算进去，
    // 会让人以为自己欠着事——「撰写中 3」并不需要你做任何动作。
    /**
     * ⚠️ **两个数必须同一刻采样。**
     * 这一块中间跳去过项目页再回来（测「选平台直接落在项目页」），页面重挂过——
     * 拿跳转之前那份 `nums` 去比现在的角标，差的是**时间**不是代码。
     */
    const badge = await page.textContent(".page-bar__end").catch(() => "");
    const numsNow = await page.$$eval(".todo-card__value", (els) => els.map((e) => e.textContent));
    const sum = (numsNow.length ? numsNow : nums).reduce((n, x) => n + Number(x), 0);
    check(
      "待办数只算等你动手的",
      sum ? badge.includes(`${sum} 件事`) : badge.includes("没有待办"),
      `${badge} / ${(numsNow.length ? numsNow : nums).join("+")}`
    );
  } else {
    const guide = await page.textContent(".note-title").catch(() => "");
    check("未连接时有引导", guide.includes("还没连上"), guide);
    const hasCommand = await page.$$eval(".note code", (els) => els.some((e) => e.textContent.includes("wrangler")));
    check("引导里给了具体命令", hasCommand);
  }

  // 4. vault 读到了真实路径（本地服务 → 文件系统这条链是通的）。
  //    路径正常时它在底部那条系统行里，出错/没配时是一个显眼的 Note——两种都算通过，
  //    写死其中一种的话，换台机器测试就红了。
  const sysText = await page.evaluate(
    () => (document.querySelector(".sysrow") || document.querySelector(".note"))?.textContent || ""
  );
  check("vault 路径或配置引导二选一", /obsidian-vault/.test(sysText) || /VAULT_ROOT/.test(sysText), sysText.slice(0, 60));

  // 4b. 我的清单：手写任务落 vault 的 `05 - 计划/<日期>.md`。
  //
  // ⚠️ **这一段真的会写 vault**（清单本来就只有这一条路），所以它加的那条任务带时间戳、
  // 而且走完必须自己删掉。留下的只有一份当天的空计划文件——那本来也是你今天会建的东西。
  // vault 没配时整块不画，此时跳过（写死「一定有清单」的话，换台机器测试就红了）。
  if (await page.$(".day-plan")) {
    const days = await page.$$eval(".plan-day", (els) => els.map((e) => e.textContent.trim()));
    // 「明天」这一档不能少：用户的动线是「今晚列明天的」，只给今天等于砍掉主要写入时机
    check("清单能切到明天", days.join("/") === "今天/明天", days.join("/"));

    // 输入框**默认不在**，点「明天」后面那个「+」才展开。常驻的话，空清单那一屏就是
    // 「一句说明 + 一个空输入框 + 一行路径」三样东西在说同一件事。
    check("输入框默认不占地方", !(await page.$(".plan-add input")));
    await page.click(".plan-plus");
    await page.waitForSelector(".plan-add input", { timeout: 4000 });

    const label = `冒烟测试-${Date.now()}`;
    await page.fill(".plan-add input", label);
    await page.click(".plan-add button[type=submit]");
    const row = `.plan-task:has-text("${label}")`;
    await page.waitForSelector(row, { timeout: 8000 });
    check("加得进一条任务", true);
    // 加完一条不收起：晚上列明天的清单是一口气写五六条，每条都要重点一次「+」的话，
    // 这个入口就成了收费站
    check("加完一条还能接着加", !!(await page.$(".plan-add input")));

    try {
      // 打钩后**变灰 + 删除线两样都要**：只变灰在暗色下几乎看不出，只划线又太吵
      await page.click(`${row} .plan-task__main`);
      await page.waitForSelector(`${row}[data-done="true"]`, { timeout: 8000 });
      const deco = await page.$eval(`${row} .plan-task__text`, (e) => {
        const s = getComputedStyle(e);
        return { line: s.textDecorationLine, color: s.color };
      });
      check("打完钩有删除线", deco.line.includes("line-through"), deco.line);

      // 进度环的分母是清单条数——这也是它能存在的理由：不用编任何数字
      const ring = await page.textContent(".plan-ring__label").catch(() => "");
      check("进度环按清单条数走", /^\d+\/\d+$/.test(ring.replace(/\s/g, "")), ring);

      // 打钩落进文件的方式必须是标准 Markdown 复选框，Obsidian 那边才认得
      const raw = await page.evaluate(() => fetch("/api/plan").then((r) => r.json()));
      check("清单存在 05 - 计划 底下", /05 - 计划\/\d{4}-\d{2}-\d{2}\.md$/.test(raw.path || ""), raw.path);
    } finally {
      await page.click(`${row} .plan-task__del`);
      await page.waitForSelector(row, { state: "detached", timeout: 8000 }).catch(() => {});
    }
    check("测试加的任务已经删干净", !(await page.$(row)));

    // ⚠️ **一条任务都没有时不画环。** 画出来的是个满圈的灰环加 `0/0`：既不报告进度、
    // 也不指引下一步，只是把「你还没开始」放大成这一屏最大的图形。
    // 这条只在清单真的空了的时候才验得到——上面刚把测试加的那条删掉，所以时机就在这儿。
    if (!(await page.$(".plan-task"))) {
      check("空清单不画进度环", !(await page.$(".plan-ring")));
    }
  }

  // 「接着上次」三块的出口固定在底部，必须落在同一条水平线上——各摆各的话，
  // 一行三个按钮会因为内容长短各在各的高度上，眼睛得上下找。
  const goTops = await page.$$eval(".resume-panel__go", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  if (goTops.length > 1) {
    check("三块的出口在同一条线上", Math.max(...goTops) - Math.min(...goTops) <= 1, goTops.join("/"));
  }

  // 排版是侧栏就有的一页，总览不该再放一个把人带出工作台的外链
  check("排版不在总览里另开标签页", !(await page.$('.main a[href="/tools/typeset/"]')));

  // 5. 入库抽屉能开能关——它是「万物皆可入库」的唯一入口，坏了整个打通机制就断了
  await page.click(".sidebar-foot .btn-primary");
  await page.waitForSelector(".drawer", { timeout: 4000 });
  check("入库抽屉打开", true);
  /**
   * **默认目标是「稍后整理」，不是「直接作为素材」**——先收起来、不惊动 AI 是最常见的那一次。
   * 素材类型芯片因此只在切到「直接作为素材」之后才存在，下面这两条断言都得先切过去。
   * （原来这里直接数芯片，加了收藏之后就一直是空数组。）
   *
   * ⚠️ **断言的是屏幕上那三个字，而抽屉的文案改过一次**（收件箱 / 素材库 →
   * 稍后整理 / 记下想法 / 直接作为素材），底层 target 值 collection/inbox/material 没变。
   * 上一次改文案时这里漏了，测试红了一整个 commit——**按文字点的选择器每次改文案都要回头看这儿**，
   * 和「收起态文字 display:none，:has-text() 点不中」是同一类坑。
   */
  const defaultTarget = await page.textContent('.drawer .seg button[aria-pressed="true"]');
  check("默认落在稍后整理", defaultTarget.trim() === "稍后整理", defaultTarget.trim());
  await page.click('.drawer .seg button:has-text("直接作为素材")');
  const typeBtns = await page.$$eval(".drawer .chip", (els) => els.map((e) => e.textContent.trim()));
  check("入库类型齐全", typeBtns.includes("自动判断") && typeBtns.includes("金句"), typeBtns.join("/"));
  /**
   * **打标的选中态是标记黄，不是实心黑。** 黑块在这套设计里的意思是「你现在在这儿」
   * （当前页 / 当前视图 / 主按钮）；而「这条是金句」是我给它贴的标，不是我所在的位置。
   * 两件事共用一个视觉，界面上就分不出「当前」和「已选」。
   */
  const chipBg = await page.$eval('.drawer .chip[aria-pressed="true"]', (el) => getComputedStyle(el).backgroundColor);
  const markYellow = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--mark-yellow").trim());
  check("打标的选中态用标记黄", chipBg.replace(/\s/g, "") === markYellow.replace(/\s/g, ""), `${chipBg} vs ${markYellow}`);
  // 正文最先出现：点「入库」的意图只有一个，分流和打标是顺手做的事
  const firstField = await page.$eval(".drawer .field label", (el) => el.textContent.trim());
  check("入库表单先问内容", firstField === "内容", firstField);
  check("底部有退路也有主动作", (await page.textContent(".drawer-foot")).includes("取消"));
  // 快捷键提示不刻在按钮上：`n` 学一次就记住了，而那枚小方块要跟着最显眼的按钮出现在每一屏
  check("入库按钮上没有常驻的快捷键角标", !(await page.$(".sidebar-foot .btn-primary kbd")));
  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer", { state: "detached", timeout: 4000 });
  check("Esc 关闭抽屉", true);

  /**
   * 6. 内容工作台。
   *
   * ⚠️ **选题页现在只有深链能到**（`#/topics`），二级导航里没有它了：
   * `getContentProject` 以 topic 为项目根，所以每个选题就是一个项目，
   * 「选题」那一页是同一批东西的第二个入口。**页面和路由都留着**，
   * 所以这一段照测——只是不再从导航点进来。
   *
   * **选题默认只看「待写」。** 这一库里绝大多数条目是已成稿和已发布的历史，
   * 而打开这一页的意图基本只有一个：看接下来要写什么。
   * 断言里连**筛选条上那颗芯片是亮的**一起验——默认状态必须写进 URL，
   * 偷偷过滤的话用户看不出自己正在被过滤、也点不回「全部」。
   */
  await page.goto("about:blank");
  await page.goto(`http://127.0.0.1:${PORT}/#/topics`, { waitUntil: "networkidle" });
  await page.waitForSelector(".doc-row, .empty, .note-title, .kanban-col", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(600);
  check("选题默认落在「待写」", decodeURIComponent(page.url()).endsWith("/topics/待写"), decodeURIComponent(page.url()).split("#")[1] || "");
  const onChip = await page.$$eval('.chips .chip[aria-pressed="true"]', (els) => els.map((e) => e.textContent.trim()));
  check("筛选条上「待写」是亮的", onChip.some((t) => t.includes("待写")), onChip.join("/") || "(没有选中项)");

  const subnav = await page.$$eval(".subnav-item", (els) => els.map((e) => e.textContent.trim()));
  // 同上：跟 `App.jsx` 的常量比，不写死那一串
  check("内容二级导航名称统一", subnav.join("/") === wantSubnav.join("/"), `${subnav.join("/")}（常量 ${wantSubnav.join("/")}）`);
  // 导航标签一律两个字——写死那一串会在加页时红，这条不会，而它钉的是真正的规矩
  check("二级导航每项都是两个字", subnav.every((n) => n.length === 2), subnav.join("/"));
  check("页面内部不再重复跨页面 Tab", !(await page.$(".main > .pill-tabs")));
  /**
   * ⚠️ **深链进来的页面，一级导航仍然要高亮到它所属的那一档。**
   * 靠的是 `CONTENT_VIEWS` 里还留着 `topics`——从导航里拿掉一个入口时
   * **别顺手把它从那个集合里删掉**，删了的话深链进来整个侧栏一个亮的都没有，
   * 看着像走丢了。
   */
  const activeNav = await page.textContent('.nav-item[data-current="true"]');
  check("深链进选题页，一级导航仍然指着「内容」", activeNav.includes("内容"), activeNav.trim());
  check("浏览是卡片墙不是三栏", !!(await page.$(".panel-block")) && !(await page.$(".reader-overlay")));

  /**
   * ⚠️ **一屏只有一个「选题库」，而且列表不再装在一个框里。**
   *
   * 上一版是：页头写「选题库」，正下方那个白框里再写一遍「TOPICS / 选题库 1 条」——
   * 同一个名字一屏出现两次、中间只隔一行描述，而 `TOPICS` 正是设计系统里否决过的
   * 那种眉标（标题的英文转写）。外面那个框更糟：`.main` 本身已经是浮在底色上的
   * 白面板，里面再套一张白框就是**白框套白框**，两层的边框圆角投影全在争同一件事。
   *
   * 三条一起钉，因为它们是同一个毛病的三种长法，各修一处都会留下另外两处。
   */
  // ⚠️ **等列表真的出内容再量条数**：条数是 `list` 回来才有的，
  // navigate 完立刻量到的必然是空——那不是「没画」，是「还没到」
  await page
    .waitForFunction(() => !!document.querySelector(".doc-row, .empty, .note-title, .kanban-col"), null, { timeout: 25000 })
    .catch(() => {});
  const nest = await page.evaluate(() => {
    const pb = document.querySelector(".panel-block");
    const cs = pb && getComputedStyle(pb);
    // ⚠️ 页名现在**只在顶栏的面包屑里**，正文区一个标题都不该有
    const crumb = document.querySelector(".crumbs")?.innerText.replace(/\s+/g, "") || "";
    return {
      crumb,
      h1s: document.querySelectorAll(".main h1").length,
      // 正文里还有几处在复述面包屑上那个词
      echoes: [...document.querySelectorAll(".main h2")].filter((e) => crumb.includes(e.textContent.trim())).length,
      border: cs?.borderTopWidth,
      shadow: cs?.boxShadow,
      count: document.querySelector(".page-bar__count")?.textContent.trim() || "",
      // Worker 连不上时列表是空的、条数本来就没有——断言要写成二选一，
      // 不能写死「一定有条数」，那样外部一挂测试就红
      loaded: !!document.querySelector(".doc-row, .kanban-col"),
      // 筛选条和工具条在同一行
      oneRow: (() => {
        const f = document.querySelector(".list-bar .filter-bar");
        const t = document.querySelector(".list-bar .list-tools");
        if (!f || !t) return null;
        return Math.abs(f.getBoundingClientRect().top - t.getBoundingClientRect().top) < 30;
      })(),
    };
  });
  /**
   * ⚠️ **页名一屏只出现一次，而且只在顶栏。**
   * 走过三版：①「页头大标题 + 正文里 TOPICS/选题库 的小标题」两遍；
   * ② 撤掉小标题，只剩页头那个 38px 的大标题；
   * ③ 顶栏有了面包屑之后，那个大标题又成了第二遍——而且它拿走首屏最大的一块地方，
   * 去说这一屏信息量最低的一件事（你自己点进来的，你知道这是哪儿）。
   * 所以判据是**正文区一个 `h1` 都没有**，且没有 `h2` 在复述面包屑上那个词。
   */
  check("页名只在顶栏，正文里不再重复", nest.h1s === 0 && nest.echoes === 0, `正文 h1 ${nest.h1s} 个 · 复述 ${nest.echoes} 处 · 面包屑「${nest.crumb}」`);
  check(
    "条数挂在动作条上",
    !nest.loaded || /条$/.test(nest.count),
    nest.loaded ? nest.count || "(列表有内容却没有条数)" : "(列表是空的，这一条不适用)"
  );
  check("列表不再套在一个框里", nest.border === "0px" && nest.shadow === "none", `border=${nest.border} shadow=${nest.shadow}`);
  check("筛选条和工具条并排一行", nest.oneRow !== false, nest.oneRow === null ? "(这一页没有筛选条)" : "同一行");

  /**
   * ⚠️ **实心黑只留给主操作一颗。** 稿件库上曾经有两颗：页头的「新建」和工具条的
   * 「新稿」——而它们点下去是**同一个调用**（`onCreate("choose")`）。
   * 看到两颗的人第一反应是去猜区别，而答案是没有区别。
   */
  const primaries = await page.$$eval(".main .btn-primary", (els) =>
    els.map((e) => ({ text: e.textContent.trim(), bg: getComputedStyle(e).backgroundColor }))
  );
  check("主操作一屏只有一颗", primaries.length <= 1, primaries.map((p) => p.text).join("/") || "(一颗都没有)");
  /**
   * ⚠️ **顺带钉住颜色：`.btn-primary` 是实心黑，不是墨绿。**
   * 做过一版墨绿的，撤了：「新建」这类是一页里最该被点的那颗，而黑是这套界面里
   * 最重的色；墨绿再深也是个彩色，摆在一屏彩色状态 pill 中间就不再是最重的那一块。
   * **绿说「走到哪儿了」，黑说「点这儿」。**
   * 量的是**渲染后的颜色**，不是「样式表里写了 var(--accent)」。
   */
  if (primaries.length) {
    const [r, g, b] = (primaries[0].bg.match(/[\d.]+/g) || []).map(Number);
    check("主按钮是实心黑不是彩色", r < 60 && g < 60 && b < 60 && Math.max(r, g, b) - Math.min(r, g, b) < 12, primaries[0].bg);
  }

  if (workerReady) {
    await page.waitForSelector(".kanban-col, .doc-row, .empty, .note-title", { timeout: 25000 });

    // **默认是卡片墙**。看板回答的是「卡在哪一步」，那是偶尔问一次的问题；
    // 日常进来是找内容的，默认给看板等于每次都先看一屏光标题。
    check("默认是列表不是看板", !(await page.$(".kanban-col")), (await page.$$(".doc-row")).length + " 张卡");

    /**
     * **一列行里，每一行都要一样高、标题起点在同一条竖线上。**
     *
     * ⚠️ 这条断言换过一次判据。卡片时代量的是「三张卡上标题/副标题/摘要各自的顶边差」——
     * 因为卡片的高度由内容决定，标题一行还是三行会把下面的东西推到不同高度。
     * 行不会有那个问题（高度是定的），行会有**另一个**问题：
     * 有状态图标的行和没有的行，标题会左右差出一个图标的宽度，一列看着是锯齿。
     * 所以现在量两件事：**行高一致**（摘要那行没内容也得占位）、**标题左缘一致**
     *（`.doc-row__state` 没状态也占格）。判据变了，但要防的东西没变：
     * 扫一列的时候眼睛不用来回找。
     */
    const rowsAligned = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".doc-row")].slice(0, 4);
      if (rows.length < 2) return { skip: true };
      const spread = (xs) => (xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0);
      return {
        height: spread(rows.map((r) => Math.round(r.getBoundingClientRect().height))),
        titleLeft: spread(
          rows.map((r) => Math.round(r.querySelector(".doc-row__title").getBoundingClientRect().left))
        ),
      };
    });
    if (!rowsAligned.skip) {
      check(
        "一列行等高、标题左缘对齐",
        rowsAligned.height <= 1 && rowsAligned.titleLeft <= 1,
        `行高差 ${rowsAligned.height}px / 标题左缘差 ${rowsAligned.titleLeft}px`
      );
    }


    /**
     * ⚠️ **看板这一段只在真有条目时才验。**
     * 上一版直接 `waitForSelector(".kanban-col")`，而库里一条「待写」都没有的那天，
     * 它等满 30 秒然后把**后面整条流水线一起中断**——报出来的是一句超时，
     * 和「看板坏了」长得一模一样。这正是「别写死某一种外部状态」那条：
     * 写死的话外部一变测试就红，而红着的测试等于没有测试。
     *
     * **跳过要出声**：显式记一条，不能静默 return——那样报告全绿而这一段根本没跑。
     */
    const hasTopicRows = (await page.$$(".doc-row")).length > 0;
    if (!hasTopicRows) {
      check("选题库这会儿是空的，看板这一段跳过", true, "0 条 · 有条目时才验得了分列");
    } else {
      // 切过去之前先量列表侧：这一档此刻**有没有条目真带摘要**。
      // 看板那条断言要跟它对齐，见下面。
      const listPreviews = await page.$$eval(".doc-row__excerpt", (els) => els.filter((e) => e.textContent.trim().length > 10).length);
      await page.click('.seg button:has-text("看板")');
      await page.waitForSelector(".kanban-col", { timeout: 8000 });
      const cols = await page.$$eval(".kanban-col__name", (els) => els.map((e) => e.textContent.trim()));
      check("看板按状态分列", cols.includes("待写") && cols.includes("撰写中"), cols.join("/"));
      check("每列都有计数", (await page.$$(".kanban-col__count")).length === cols.length, `${cols.length} 列`);
      // 「搁置」是成稿全失败的落点，正常永远是空的——空着就不该占一列的宽度。
      // 但**不能直接删掉**，真掉进去的选题得看得见，所以有内容时它必须出现。
      const quietCount = await page.$$eval(".kanban-col", (els) =>
        els.filter((e) => e.getAttribute("aria-label") === "搁置").map((e) => e.querySelectorAll(".kanban-card").length)
      );
      check("空的「搁置」不占列，有内容才出现", quietCount.length === 0 || quietCount[0] > 0, quietCount.length ? `有 ${quietCount[0]} 条` : "空着，已隐藏");
      // 看板的卡片要有摘要，否则它就只是「竖着排的标题列表」，换视图没意义
      /**
       * 看板的卡片要有摘要，否则它就只是「竖着排的标题列表」，换视图没意义。
       *
       * ⚠️ **但判据要跟列表侧对齐，不能写死「一定有」。**
       * `Board.jsx` 只在 `it.preview` 有值时才画那一行——某一档里恰好全是
       * 刚建的空选题（没写正文）时，看板上一条摘要都没有是**对的**。
       * 写死的话，那种再正常不过的数据会让这条变红而代码没问题。
       */
      const kanbanNotes = await page.$$eval(".kanban-card__note", (els) => els.length);
      check("列表里有摘要的，看板上也有", listPreviews === 0 ? kanbanNotes === 0 : kanbanNotes > 0,
        `列表 ${listPreviews} 条有摘要 · 看板 ${kanbanNotes} 张`);
      // 看板天生是横向的，不该被正文栏的 1320 上限切掉
      const wide = await page.$eval(".main", (el) => getComputedStyle(el).maxWidth);
      check("看板下正文栏放开宽度限制", wide === "none", wide);
      await shot("board");
    }

    // **闸门必须拦住写入**。这条守的是一个真事故：`askPlatformsOn` 只写进了 TOPICS 的配置、
    // 漏了 `notionSource()` 的参数解构，于是 `source.askPlatformsOn` 恒为 undefined，
    // 闸门整个失效——状态被直接写回 Notion，Worker 五分钟内领走选题、按三个平台各跑了一遍 LLM。
    // 断言必须是两半：弹窗要出来，**而且这期间一个写请求都不许发出去**。只断言弹窗是抓不住的。
    let writes = 0;
    const countWrites = (r) => {
      if (r.method() === "POST" && /\/api\/pipe\/(update|content|delete)\b/.test(r.url())) writes++;
    };
    page.on("request", countWrites);
    const gateCard = await page.$('.kanban-col:not([aria-label="撰写中"]) .kanban-card__open');
    if (gateCard) {
      await gateCard.click();
      await page.waitForSelector(".reader-overlay .rail-tabs", { timeout: 25000 });
      const cur = (await page.textContent(".select__btn").catch(() => "")).trim();
      if (cur && cur !== "撰写中") {
        // 自绘下拉：点开再点那一项。原生 select 在这套界面里是唯一跟着操作系统走的控件
        await page.click(".select__btn");
        await page.click('.select__pop button:has-text("撰写中")');
        await page.waitForSelector(".pick-grid", { timeout: 8000 });
        check("改成「撰写中」先问平台", true, `从「${cur}」改起`);
        check("弹平台选择时一个字都没写回库里", writes === 0, `${writes} 次写请求`);
        const picks = await page.$$eval(".pick__name", (els) => els.map((e) => e.textContent.trim()));
        check("平台选项和流水线一致", picks.join("/") === "公众号/X/小红书/视频号/YouTube", picks.join("/"));
        await page.click('.modal button:has-text("取消")');
        await page.waitForSelector(".pick-grid", { state: "detached", timeout: 5000 });
        check("取消不写任何东西", writes === 0, `${writes} 次写请求`);
      } else {
        check("改成「撰写中」先问平台", true, "打开的这条已经是撰写中，跳过");
      }
      await page.keyboard.press("Escape");
      await page.waitForSelector(".reader-overlay", { state: "detached", timeout: 5000 });
    }
    page.off("request", countWrites);

    // 切回列表看浏览层那几件事。
    // ⚠️ **按文字点的选择器**：视图切换从「卡片」改名成「列表」时这里漏了一次，
    // 症状是整轮冒烟在这一步超时 30 秒然后中断——和抽屉那三个目标改名是同一类坑。
    await page.click('.seg button:has-text("列表")');
    await page.waitForSelector(".doc-row, .empty", { timeout: 8000 });
    const n = await page.$$eval(".doc-row", (els) => els.length);
    /**
     * ⚠️ **二选一：出条目，或者出一句说清「是哪一档空了」的空态。**
     *
     * 写死「一定有条目」的那一版，在库里 5 条选题全都不在**默认那一档**（待写）的那天红了——
     * 而那不是坏，是真实的库状态。进选题库默认落在「待写」是用户点名要的，
     * 空态本来就该出现。
     *
     * 但空态**必须说清是哪一档空了**（「没有『待写』的条目」），不能只说「暂无数据」——
     * 否则用户看到的是「我的选题库空了」，而其实只是被默认筛选挡住了。
     */
    const emptyText = n ? "" : (await page.textContent(".empty").catch(() => "")).trim();
    check(
      "选题列表出条目，或空态说清是哪一档空的",
      n > 0 || /待写/.test(emptyText),
      n > 0 ? `${n} 条` : `0 条 · 空态说「${emptyText.slice(0, 20)}」`
    );
    if (n > 0) {
      const stateChips = await page.$$eval(".chips-sm .chip", (els) => els.map((e) => e.textContent.trim()));
      check("状态筛选条", stateChips.includes("待写") && stateChips.includes("撰写中"), stateChips.join("/"));
      // 行要有摘要，否则这一列就只是一份目录，浏览层「一眼扫十几条」的价值没了
      const previews = await page.$$eval(".doc-row__excerpt", (els) => els.map((e) => e.textContent.trim()));
      /**
       * ⚠️ **看的是「有没有一行真带摘要」，不是「第一行带不带」。**
       * 库里排最前的可能是一条刚建的空选题（没写正文，摘要自然是空的）——
       * 钉 `previews[0]` 的话，那种再正常不过的数据会让这条变红而代码没问题。
       * 每行都要有摘要**位**（哪怕空着）那条在别处单独钉着。
       */
      /**
       * ⚠️ **钉的是「每行都有摘要位」，不是「此刻有没有字」。**
       * 浏览层不能退化成一份目录——所以摘要那一格**行行都要在**（空着也占高，
       * 否则一列扫下去是锯齿）。而某一档里恰好全是刚建的空选题是**再正常不过的数据**，
       * 拿它当失败条件的话，这条会在库里没问题的时候变红。
       */
      const rowCount = await page.$$eval(".doc-rows .doc-row", (els) => els.length);
      check("每行都有摘要位", rowCount > 0 && previews.length === rowCount, `${previews.length}/${rowCount} 行有摘要位`);
      // 删除要有入口、而且**必须点两下**：第一下只是把按钮换成写清去向的确认按钮
      check("行上有删除入口", (await page.$$(".doc-row__del")).length === n, `${(await page.$$(".doc-row__del")).length}/${n}`);
      // 入口为了不抢主动作，鼠标场景下只在卡片 hover 后显形。Playwright 直接 click
      // 一个 opacity:0 + pointer-events:none 的节点会一直等到超时；先模拟真实用户把鼠标
      // 移进卡片，测到的才是界面约定，而不是用 force 绕过界面状态。
      await page.hover(".doc-row");
      await page.click(".doc-row__del");
      const confirmText = await page.textContent(".doc-row .btn-danger").catch(() => "");
      // ⚠️ 断言的是**「说清了不可恢复」**，不是某个具体词。Notion 时代删除是 archived:true
      // （进废纸篓、30 天可捞），文案写的是「移到 Notion 废纸篓」；换 D1 之后那一层没了，
      // 文案必须照实说「永久删除」。这条断言当时钉的是「废纸篓」三个字，于是迁移之后
      // **代码对了、测试红了**——测试反过来在要求把对的文案改回去。
      check("删除要二次确认且说清不可恢复", /永久删除|删了就没|不可恢复/.test(confirmText), confirmText.trim());
      // 反悔的路必须一直在：少了「取消」，点错第一下就只剩「删」和「离开这一页」两条路
      await page.click('.doc-row:has(.btn-danger) button:has-text("取消")');
      await page.waitForSelector(".doc-row .btn-danger", { state: "detached", timeout: 4000 });
      check("删除确认能取消", true);
      await shot("wall");

      // 点开 → 阅读覆盖层
      /**
       * ⚠️ **挑一条真有正文的打开，别盲点第一条。**
       * 后面这一整段测的是**阅读区的能力**（面包屑、批注台、状态下拉、排版/封面入口、
       * 元信息行）——它们里有几样只在稿子真有内容时才画。而列表排最前的可能是一条
       * 刚建的空选题，那时后面十几条全会挂在超时上，看着像阅读区坏了。
       * 空正文本身另有一条断言（就在下面），不靠这一段覆盖。
       */
      // ⚠️ **先切到「全部」。** 默认那一档（待写）里可能一条有正文的都没有——
      //    刚建的空选题就落在那儿。后面十几条量的是阅读区的能力，需要一篇真有字的。
      await page.click('.chips-sm .chip:has-text("全部")').catch(() => {});
      await page.waitForTimeout(900);
      const pickRow = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".doc-row")];
        const withBody = rows.find((r) => (r.querySelector(".doc-row__excerpt")?.textContent || "").trim().length > 10);
        return rows.indexOf(withBody || rows[0]);
      });
      await page.click(`.doc-row__open >> nth=${Math.max(pickRow, 0)}`);
      /**
       * ⚠️ **等的是「这一层真的有东西了」，不是正文本身。**
       * 等 `.prose` 的话，点开一条**还没写正文的选题**（刚建的空选题就是这样）
       * 会一直等到超时——而那是再正常不过的数据，不是缺陷。
       * `.rail-tabs` 是这一层加载完的标志，正文有没有字另说。
       */
      await page.waitForSelector(".reader-overlay .rail-tabs", { timeout: 25000 });
      check("点开进阅读区", !!(await page.$(".reader-overlay")));
      // 正文有字就渲染成 `.prose`，一个字都没有时给空态——两种都算通过
      const bodyOrEmpty = await page.evaluate(() => ({
        prose: (document.querySelector(".reader-overlay .reader .prose")?.textContent || "").trim().length,
        empty: !!document.querySelector(".reader-overlay .reader .reader-empty"),
      }));
      check("正文渲染出来了，或者照实说这篇还没写", bodyOrEmpty.prose > 0 || bodyOrEmpty.empty,
        `正文 ${bodyOrEmpty.prose} 字 · 空态 ${bodyOrEmpty.empty}`);
      check("阅读区有面包屑", (await page.textContent(".reader-overlay__crumb")).includes("选题库"));
      check("阅读区有批注台", !!(await page.$(".reader-overlay .rail")));
      check("有状态下拉（可直接改库里的状态）", !!(await page.$(".select__btn")));
      const actionText = await page.textContent(".doc-actions");
      check("接上了排版和封面工具", actionText.includes("去排版") && actionText.includes("配封面"), actionText.slice(0, 60));
      /**
       * 元信息行：**每项都有图标，字段名不用等宽字体**。
       * 等宽包里没有中文字形，「适配平台」四个字会掉进系统回退，和旁边的值字重、
       * 字宽都对不上——那正是「字体都不一样」的来源。
       */
      const metaLook = await page.evaluate(() => {
        const items = [...document.querySelectorAll(".doc-meta__item")];
        const one = items[0];
        const gaps = one
          ? {
              // 一项是「标签 + 值」两拍：图标和字段名贴紧，值离得远。
              // 三个间隔一样宽的话，一项看着像三项——那正是这一行显得挤的来源。
              label: parseFloat(getComputedStyle(one.querySelector(".doc-meta__label")).columnGap),
              item: parseFloat(getComputedStyle(one).columnGap),
            }
          : null;
        const draftLabel = document.querySelector(".draft-links__label");
        return {
          n: items.length,
          withIcon: items.filter((e) => e.querySelector("svg")).length,
          labelFont: one ? getComputedStyle(one.querySelector("b")).fontFamily : "",
          iconColor: one ? getComputedStyle(one.querySelector("svg")).color : "",
          labelColor: one ? getComputedStyle(one.querySelector("b")).color : "",
          valueColor: one ? getComputedStyle(one.querySelector(".doc-meta__val")).color : "",
          gaps,
          // 「成稿去向」就贴在这一行下面，各画各的就是同一个界面里两种元信息语言。
          // 它原来是等宽 + 大写字距的眉标样式，而里面是四个汉字——整块掉进系统回退。
          draftFont: draftLabel ? getComputedStyle(draftLabel).fontFamily : "",
        };
      });
      if (metaLook.n) {
        check("元信息每项都有图标", metaLook.withIcon === metaLook.n, `${metaLook.withIcon}/${metaLook.n}`);
        check("字段名不用等宽字体", !/mono/i.test(metaLook.labelFont), metaLook.labelFont.slice(0, 40));
        check(
          "标签和值是两拍，不是三个等距",
          metaLook.gaps.label < metaLook.gaps.item,
          `图标↔字段名 ${metaLook.gaps.label}px / 标签↔值 ${metaLook.gaps.item}px`
        );
        /**
         * **图标和字段名同色**（它们是同一样东西：这一项的标签），值另有颜色、更深。
         * 试过给图标上暖色，撤了：13px 的线条撑不住饱和色，而且**暖色是给内容的、
         * 不是给界面骨架的**——骨架也染上，内容里的暖色就不再意味着「这里被强调了」。
         */
        check(
          "图标和字段名同色，值比它们重",
          metaLook.iconColor === metaLook.labelColor && metaLook.valueColor !== metaLook.iconColor,
          `图标 ${metaLook.iconColor} / 字段名 ${metaLook.labelColor} / 值 ${metaLook.valueColor}`
        );
      }
      if (metaLook.draftFont) {
        check("成稿去向和元信息用同一套字", !/mono/i.test(metaLook.draftFont), metaLook.draftFont.split(",")[0]);
      }
      /**
       * ⚠️ **等宽栈里必须夹一层中文字体。**
       *
       * JetBrains Mono 没有中文字形，套了等宽的中文会掉进**系统默认字体**（Windows 上是
       * 微软雅黑）——同一行里数字是 JetBrains、汉字是雅黑，字重字宽全对不上。这是这个项目
       * 反复出现的「字体看着都不一样」的总根源。逐处去掉等宽是治标：漏一处、或者以后新加
       * 一处，它就又冒出来。夹一层 Noto Sans SC 之后，兜底回落的是**正文同款**。
       */
      const monoStack = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--font-mono")
      );
      check("等宽栈里兜着中文字体", /Noto Sans SC/.test(monoStack), monoStack.trim().slice(0, 60));
      /**
       * 阅读区外壳里那几处**内容本来就是中文**的小标签，不该套等宽 + 大写字距：
       * 面包屑是「库名 / 状态」，右栏分区标题是「批注 3」。
       * （左栏的 `ON THIS PAGE` 是英文，等宽眉标在那儿才成立，所以不在这条里。）
       */
      const chromeFonts = await page.evaluate(() =>
        [".reader-overlay__crumb", ".rail-label", ".prose th"].map((s) => {
          const el = document.querySelector(s);
          return [s, el ? getComputedStyle(el).fontFamily : ""];
        })
      );
      check(
        "中文的小标签没套等宽",
        chromeFonts.every(([, f]) => !f || !/mono/i.test(f)),
        chromeFonts.map(([s, f]) => `${s}=${(f || "—").split(",")[0]}`).join(" ")
      );
      // 面包屑要短：它答的是「我在哪」。不给 crumb 的话会一路退到 sub，
      // 洞察那边就成了「覆盖 2026-08-05 — 2026-08-12」一整条日期区间
      const crumb = (await page.textContent(".reader-overlay__crumb"))?.trim() || "";
      check("面包屑是短的落点不是一段元信息", crumb.length <= 24, crumb);
      // 原生 select 是这套界面里唯一跟着操作系统走的控件（直角白底、蓝色高亮），换成自绘的
      check("状态下拉是自绘的不是原生 select", !(await page.$(".doc-meta select")));
      /**
       * 下拉菜单：**一行一个图标 + 名字，当前项打勾**。
       * 图标靠形状区分不靠颜色——这套界面只有一档功能色（标记黄，含义是「我圈中的」），
       * 再加一档状态色会互相抢；形状还不依赖辨色。
       */
      await page.click(".select__btn");
      await page.waitForSelector(".select__pop", { timeout: 4000 });
      const menu = await page.$$eval(".select__pop button", (els) =>
        els.map((e) => ({ text: e.querySelector("span")?.textContent.trim(), icons: e.querySelectorAll("svg").length }))
      );
      check("每一项都有状态图标", menu.length > 1 && menu.every((m) => m.icons >= 1), JSON.stringify(menu.slice(0, 3)));
      check("当前项多一个勾", (await page.$$('.select__pop button[aria-selected="true"] .select__tick')).length === 1);
      // 不同阶段要用**不同的**图标，否则等于没有图标
      const shapes = await page.$$eval(".select__pop button svg:first-child", (els) =>
        els.map((e) => e.getAttribute("class") || e.innerHTML.slice(0, 40))
      );
      check("不同阶段的图标不一样", new Set(shapes).size > 1, `${new Set(shapes).size} 种 / ${shapes.length} 项`);
      await page.keyboard.press("Escape");
      await page.waitForSelector(".select__pop", { state: "detached", timeout: 4000 });
      /**
       * **这一行里的东西要在同一条中线上。** 它混着三种高度：状态那个 26px 的药丸、
       * 纯文字的字段、22px 的「原文」链接按钮。按基线对齐时，有边框的和没边框的会
       * 错开一两像素——那就是「没对齐」的来源。量的是各自的**垂直中心**。
       */
      const centers = await page.evaluate(() => {
        const row = document.querySelector(".doc-meta");
        if (!row) return null;
        const first = row.getBoundingClientRect().top;
        const mid = (el) => {
          const r = el.getBoundingClientRect();
          // 只比第一行的：长值会换行，第二行本来就该在下面
          return r.top - first < 8 ? Math.round(r.top + r.height / 2) : null;
        };
        const els = [...row.querySelectorAll(".select__btn, .doc-meta__item, .doc-meta__link")];
        return els.map(mid).filter((v) => v !== null);
      });
      if (centers?.length > 1) {
        check("元信息行在同一条中线上", Math.max(...centers) - Math.min(...centers) <= 1, `中心差 ${Math.max(...centers) - Math.min(...centers)}px`);
      }
      // 正文里不该出现字面的 \n——Notion 里有些字段存的是转义过两遍的换行
      check("正文没有字面 \\n", !/\\n/.test(await page.textContent(".reader .prose")));

      // 编辑器：打开 → 正文已填充 → 取消。**故意不在测试里保存**：
      // 写回 Notion 会改动真实数据，而且改选题状态会触发流水线自动成稿。
      await page.click('.doc-actions button:has-text("编辑")');
      await page.waitForSelector(".md-editor .cm-content", { timeout: 8000 });
      check("编辑器带出正文", (await page.textContent(".md-editor .cm-content")).length > 20);
      check("编辑器带出标题", (await page.inputValue(".edit-title")).length > 0);
      /**
       * 源码高亮：**标题在编辑区里就该是大的**，否则这个编辑器和原来那个 textarea 没区别。
       * 量的是渲染后的字号，不是有没有加 class——CodeMirror 的高亮是运行时算的，
       * 语法树没跑起来（比如 lang-markdown 忘了挂）时 class 照样在、字号却是默认的。
       *
       * ⚠️ **标题由测试自己敲进去，不指望库里第一条正好有一个。** 原来是直接量当前正文里
       * 有没有更大的 span——那等于把断言押在「今天排在第一的那篇恰好写了 `#`」上。
       * 列表排序一改（`id DESC` → `updated_at DESC`），第一条换了人、正文里没有标题行，
       * **测试当场变红而编辑器一点毛病没有**。这正是本文件开头那条规矩说的：
       * 别把断言写死在某一种外部状态上。
       *
       * 敲完不保存，下面走的还是「取消」那条路——写回流水线库会改真实数据。
       */
      await page.click(".md-editor .cm-content");
      await page.keyboard.press("Control+End");
      await page.keyboard.type("\n# 冒烟测试的标题行\n");
      await page.waitForTimeout(300); // 等语法树重算，量的是渲染后的字号
      const cmSizes = await page.evaluate(() => {
        const body = getComputedStyle(document.querySelector(".cm-content")).fontSize;
        const h = [...document.querySelectorAll(".cm-content .cm-line span")].find(
          (s) => parseFloat(getComputedStyle(s).fontSize) > parseFloat(body) + 1
        );
        const strong = [...document.querySelectorAll(".cm-content .cm-line span")].find(
          (s) => getComputedStyle(s).fontWeight >= 700
        );
        return { body, big: h ? getComputedStyle(h).fontSize : "", bold: !!strong };
      });
      check(
        "编辑区里的标题比正文大",
        !!cmSizes.big && parseFloat(cmSizes.big) > parseFloat(cmSizes.body),
        `正文 ${cmSizes.body} / 标题 ${cmSizes.big || "没找到"}`
      );
      /**
       * 预览必须**盖掉**编辑器，不是接在它下面。
       * 踩过一次：`.md-editor__body` 上写了 `display:flex`，而 `hidden` 属性靠的是浏览器
       * 默认样式表里的 `[hidden]{display:none}`——作者样式一定压过它，于是同一份内容
       * 在一屏里出现两遍（上面是源码、下面是渲染稿）。
       */
      await page.click(".md-editor__preview");
      await page.waitForSelector(".md-editor__preview-body .prose", { timeout: 5000 });
      const cmHidden = await page.evaluate(() => {
        const el = document.querySelector(".md-editor__cm");
        return !el || el.getBoundingClientRect().height === 0;
      });
      check("预览态下编辑器是藏起来的，不是排在下面", cmHidden);
      await page.click(".md-editor__preview");
      await page.waitForSelector(".md-editor .cm-content", { timeout: 5000 });
      await page.click('.ws-edit__foot button:has-text("取消")');
      await page.waitForSelector(".reader .prose", { timeout: 6000 });

      // 阅读区里 j 切下一条，Esc 回卡片墙
      const before = await page.textContent(".reader-title");
      await page.keyboard.press("j");
      await page.waitForTimeout(900);
      check("键盘 j 切换条目", n < 2 || before !== (await page.textContent(".reader-title")), before?.slice(0, 12));
      await page.keyboard.press("Escape");
      await page.waitForSelector(".reader-overlay", { state: "detached", timeout: 5000 });
      check("Esc 回到列表", !!(await page.$(".doc-row")));

      /**
       * 搜索过滤。
       *
       * ⚠️ **等的是结果，不是一个固定的毫秒数。** 这条原来是 `fill` 之后 `waitForTimeout(400)`
       * 就断言，而搜索是「250ms 防抖 + 一次 Worker 全库检索」——400ms 里网络那一程根本没回来，
       * 列表当时是空的，于是断言读到 0 条。**测试红了，代码是对的**，而红着的测试等于没有测试。
       *
       * 两个方向一起测才说明它真的在筛：搜自己那一条要**搜得到**，搜一个不存在的词要**空**。
       * 只测前者的话，「搜索坏掉、列表原样铺着」同样能过。
       */
      const first = (await page.textContent(".doc-row__title")).trim();
      const q = first.slice(0, 4);
      await page.fill(".search-box input", q);
      await page
        .waitForFunction((word) => {
          const titles = [...document.querySelectorAll(".doc-row__title")].map((e) => e.textContent);
          return titles.some((t) => t.includes(word));
        }, q, { timeout: 15000 })
        .catch(() => {});
      const filtered = await page.$$eval(".doc-row", (els) => els.length);
      const stillThere = await page.$$eval(".doc-row__title", (els) => els.map((e) => e.textContent.trim()));
      check("搜得到自己那一条", stillThere.some((t) => t.includes(q)) && filtered <= n, `${filtered}/${n} · ${q}`);

      await page.fill(".search-box input", "zzz这个词不可能出现zzz");
      await page
        .waitForFunction(() => document.querySelectorAll(".doc-row").length === 0, null, { timeout: 15000 })
        .catch(() => {});
      check("搜不到时是真的空，不是原样铺着", (await page.$$(".doc-row")).length === 0);
      await page.fill(".search-box input", "");
      await page.waitForTimeout(500);
    }
  } else {
    const listErr = await page.textContent(".note-title").catch(() => "");
    check("列表降级提示", listErr.includes("加载列表失败"), listErr);
  }

  // 6a2. 翻译：**没配 key 时要给引导不是报错**。这条守的是本项目的错误契约——
  //      每个失败都得带着「下一步做什么」，不然用户只能回终端翻日志。
  const tr = await page.evaluate(() =>
    fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hello world" }),
    }).then((r) => r.json())
  );
  if (tr.ok) {
    check("翻译能用", typeof tr.text === "string" && tr.text.length > 0, tr.text?.slice(0, 30));
  } else {
    check("没配翻译 key 时给引导", /DEEPL_API_KEY/.test(tr.hint || ""), tr.hint || tr.error);
  }

  // 6b. 排版工具由本地服务托管，并且挡得住路径穿越
  const typeset = await page.evaluate(async () => {
    const r = await fetch("/tools/typeset/");
    const t = await r.text();
    const bad = await fetch("/tools/typeset/..%2f..%2f..%2fCLAUDE.md").then((x) => x.text());
    return { status: r.status, isTypeset: t.includes("微信排版"), blocked: bad.includes("路径越界") };
  });
  check("排版工具已托管", typeset.status === 200 && typeset.isTypeset, `HTTP ${typeset.status}`);
  check("排版工具挡住路径穿越", typeset.blocked);

  // 6c. 排版现在是工作台里的一个页面，不用另开浏览器标签。
  //     ⚠️ 整段包在 `ignoreErrorsDuring` 里：iframe 里跑的是**另一个项目**，它自己的
  //     JS 异常不该记到工作台账上（理由见文件开头那段注释）。
  await ignoreErrorsDuring(async () => {
  await page.goto(`http://127.0.0.1:${PORT}/#/typeset`, { waitUntil: "networkidle" });
  await page.waitForSelector(".embed iframe", { timeout: 10000 });
  const framed = await page.frameLocator(".embed iframe").locator("body").textContent();
  check("排版嵌进工作台", framed.includes("公众号") || framed.includes("Markdown"), framed.slice(0, 40));
  // 排版工具自己的工具栏在窄容器里会挤成三行（「公众号预览」竖着断开）。
  // 它是个完整的应用，不该被正文栏的阅读宽度卡住。断言查的是**限制有没有解开**，
  // 不是具体像素——测试视口才 1440，1320 的上限本来就没生效，写死像素等于没测。
  const embedMax = await page.$eval(".main", (el) => getComputedStyle(el).maxWidth);
  check("排版页放开宽度限制", embedMax === "none", embedMax);
  // **这一页没有页头**：三段式页头是给「一屏内容 + 一段解释」的页面设计的，
  // 工具页放上去只是重复地说一遍它自己标题栏里已经写着的话，还吃掉 130px 操作空间
  check("排版页不占页头", (await page.$$(".main .page-header")).length === 0);
  await shot("typeset");
  });

  // 7. 阅读工作区的完整链路：建书 → 读到正文 → 划词 → 批注 → 落盘 → 界面上就地可见。
  //    测完把书删掉，不在用户的真实 vault 里留垃圾。
  const BOOK = `__smoke_${Date.now()}`;
  const bookDir = path.join(VAULT_ROOT, SHELF, BOOK);
  try {
    await page.goto(`http://127.0.0.1:${PORT}/#/shelf`, { waitUntil: "networkidle" });
    await page.waitForSelector(".panel-block", { timeout: 8000 });

    const made = await page.evaluate(
      (name) => fetch("/api/vault/books", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }).then((r) => r.json()),
      BOOK
    );
    check("建书", made.ok, made.error || "");

    /**
     * 加书的入口是**封面墙末尾那个 `＋` 格**，两条路（导入书籍 / 建空书）都在它的菜单里。
     *
     * ⚠️ **`＋` 只有一个，不是每组一个。** 一本书导进来落在「藏书」还是「资料」由
     * `类型` 决定（epub / pdf 一定是藏书），不由你点了哪个组的 `＋` 决定——
     * 每组一个的话，位置本身在暗示一个它保证不了的去处。
     *
     * ⚠️ **页头右上角只留搜索框。** 加书那两颗按钮连同「支持 .md / .txt / …」那行说明
     * 挤在页头里，会把这一行撑到换行、把搜索框顶下去。
     */
    const shelfHead = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll(".page-bar__end button")].map((e) => e.textContent.trim()),
      search: !!document.querySelector(".page-bar__end .search-box input"),
      tiles: document.querySelectorAll(".add-book__tile").length,
    }));
    check("页头右上角只有搜索框", shelfHead.search && shelfHead.buttons.length === 0, shelfHead.buttons.join("/") || "(没有按钮)");
    check("墙尾只有一个加书格", shelfHead.tiles === 1, `${shelfHead.tiles} 个`);

    /**
     * 「正在阅读」列**两条**：同时读两本是常态（一本正经书 + 一本随手翻的），
     * 只给最近那一条的话，另一本每次都要去墙上找。
     *
     * ⚠️ **但有几本给几本，不凑数**——拿书架上没动过的书填那块空白，等于把
     * 「你正在读这些」变成「书架上有这些」，而后者下面那面墙自己就是。
     * 所以断言写成双向的：条数不超过 2，**而且「有没有标题」必须和「有没有条目」一致**。
     * 只断言上限的话，一个「永远画着标题的空栏」照样能过。
     */
    const cont = await page.evaluate(() => ({
      rows: document.querySelectorAll(".continue").length,
      label: [...document.querySelectorAll(".shelf-top__label")].some((e) => e.textContent.includes("正在阅读")),
    }));
    check(
      "「正在阅读」最多两条，一条都没有时标题也不画",
      cont.rows <= 2 && cont.rows > 0 === cont.label,
      `${cont.rows} 条 · 标题${cont.label ? "在" : "不在"}`
    );

    // ⚠️ **格子和封面一样高**，否则那一排会缺一角
    const tileFit = await page.evaluate(() => {
      const t = document.querySelector(".add-book__tile").getBoundingClientRect();
      const c = document.querySelector(".book-card__cover .cover").getBoundingClientRect();
      return { d: Math.abs(t.height - c.height), h: Math.round(t.height) };
    });
    check("加书格和封面一样高", tileFit.d <= 2, `差 ${tileFit.d.toFixed(1)}px（${tileFit.h}px 高）`);

    await page.click(".add-book__tile");
    await page.waitForSelector(".add-book__pop", { timeout: 4000 });
    const pop = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".add-book__row b")].map((e) => e.textContent.trim());
      const p = document.querySelector(".add-book__pop").getBoundingClientRect();
      const t = document.querySelector(".add-book__tile").getBoundingClientRect();
      const wall = document.querySelector(".bookshelf").getBoundingClientRect();
      return { rows, up: p.bottom <= t.top + 1, inViewport: p.top >= 0, rightOk: p.right <= wall.right + 1 };
    });
    check("两条加书的路都在菜单里", pop.rows.join("/") === "导入书籍/建空书", pop.rows.join("/"));
    /**
     * ⚠️ **菜单必须向上弹。** 这个格子永远在整面墙的末尾，也就是页面内容的**最底部**——
     * 向下弹的话它必然掉在视口外，实测第二项「建空书」直接看不见，
     * 而用户根本不知道还有第二项。
     */
    check("加书菜单向上弹且在视口内", pop.up && pop.inViewport, `up=${pop.up} inViewport=${pop.inViewport}`);
    check("加书菜单没向右出界", pop.rightOk, pop.rightOk ? "在墙内" : "超出墙的右缘");
    await page.keyboard.press("Escape");

    /**
     * 封面底边那条进度**压在一张任意颜色的图上**，所以它的两个颜色都不能取自主题 token。
     *
     * ⚠️ 上一版是 30% 黑的槽 + 白填充：**在浅色封面上整条等于没画**——槽是一层几乎
     * 看不见的浅灰，白填充和封面本身一个色。用户圈出来说「看不出来」的就是这个。
     *
     * 断言量的是**槽和填充在白底上的对比度**，不是「背景色等于某个字符串」：
     * 写死颜色的话，改成另一个同样看不清的值照样能过。3:1 是非文字图形的下限。
     */
    // 进度存 localStorage，所以这条得自己造一条——**书架上现有哪本书都行**，
    // 从接口现取，不依赖这个文件里别处的夹具（那些常量在这一行还没声明）
    const seeded = await page.evaluate(async () => {
      const r = await (await fetch("/api/vault/books")).json();
      const bk = (r.books || []).find((b) => b.chapters?.length) || (r.books || [])[0];
      if (!bk) return null;
      const doc = bk.chapters?.[0]?.path || bk.bookPath;
      localStorage.setItem(
        "workbench:reading:v1",
        JSON.stringify({ version: 1, books: { [bk.dir]: { docPath: doc, title: "x", scrollTop: 100, progress: 0.4, updatedAt: Date.now() } } })
      );
      // ⚠️ **挑一本多章的**：封面上那条画的是**整本**进度，单章书里
      // 「本章」和「全书」是同一个数，区分不出来
      return { name: bk.name, chapters: bk.chapters?.length || 0 };
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".book-card__prog", { timeout: 8000 });
    const bar = await page.evaluate(() => {
      const el = document.querySelector(".book-card__prog");
      const px = (c) => (c.match(/[\d.]+/g) || []).map(Number);
      const onWhite = (c) => {
        const v = px(c), a = v.length > 3 ? v[3] : 1;
        return v.slice(0, 3).map((x) => x * a + 255 * (1 - a));
      };
      const lum = ([r, g, b]) => {
        const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const track = onWhite(getComputedStyle(el).backgroundColor);
      const fill = onWhite(getComputedStyle(el.querySelector("i")).backgroundColor);
      const [hi, lo] = [lum(track), lum(fill)].sort((a, b) => b - a);
      return { ratio: (hi + 0.05) / (lo + 0.05), h: getComputedStyle(el).height, w: el.querySelector("i").style.width };
    });
    check("封面上的进度条在浅色封面上也分得出来", bar.ratio >= 3, `槽 vs 填充 ${bar.ratio.toFixed(2)}:1 · ${bar.h} · 用《${seeded?.name}》`);
    /**
     * ⚠️ **封面上那条画的是「整本」，不是「本章」**（`bookProgress`）。
     * 造的这条是「第 1 章读了 40%」，所以它该显示 `0.4 / 章数`，不是 40%。
     * 两者差一个数量级，画错了会让人以为一本刚开头的书快读完了——
     * 而「本章百分之多少」在「正在阅读」那一栏的文字里已经说了。
     */
    const want = seeded?.chapters ? (0.4 / seeded.chapters) * 100 : 40;
    check(
      "封面上的进度画的是整本不是本章",
      Math.abs(parseFloat(bar.w) - want) < 0.6,
      `${bar.w}，${seeded?.chapters} 章时应为 ${want.toFixed(1)}%`
    );
    await page.evaluate(() => localStorage.removeItem("workbench:reading:v1"));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".add-book__tile", { timeout: 8000 });

    /**
     * ⚠️ **搜索框只有一份实现**（`ui.jsx` 的 `SearchBox`），三处调用方共用。
     * 各写各的直接后果已经出过：**书架那处既没有 Esc 也没有清空按钮**，
     * 搜完只能把字一个个删掉，而另外两处有 Esc——同一个控件三种脾气，还不报错。
     *
     * 两条退路都要有：**× 是看得见的那条，Esc 是快的那条。**
     * 只给 Esc 不够——框里有字、旁边没有任何清除的记号，人不会去猜快捷键。
     */
    const box = ".page-bar__end .search-box";
    check("没输入时不画清空按钮", (await page.$(`${box} .search-box__clear`)) === null);
    await page.fill(`${box} input`, "内容");
    await page.waitForSelector(`${box} .search-box__clear`, { timeout: 4000 });
    await page.click(`${box} .search-box__clear`);
    check("点 × 能清空", (await page.inputValue(`${box} input`)) === "", await page.inputValue(`${box} input`));
    await page.fill(`${box} input`, "内容");
    await page.keyboard.press("Escape");
    check("按 Esc 能清空", (await page.inputValue(`${box} input`)) === "", await page.inputValue(`${box} input`));
    // ⚠️ Esc 清空**不能顺手把别的层收掉**：书架这一层要还在
    check("Esc 清空不会把这一页也退掉", !!(await page.$(".bookshelf")));

    // 导入走的是**原始字节 + 服务端解析**那条路，不是把文本塞进 JSON。
    // 三个以上一级标题就该自动拆章，拆完在磁盘上是一个个独立文件（Obsidian 里才能双链、能单独打标签）。
    const mdBook = `${BOOK}_md`;
    const importedMd = await page.evaluate(async (name) => {
      const md = ["前言一句话。", "# 第一章", "内容甲。", "# 第二章", "内容乙。", "# 第三章", "内容丙。"].join("\n\n");
      const r = await fetch(`/api/vault/books/import?filename=${encodeURIComponent(`${name}.md`)}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Blob([md]),
      });
      return r.json();
    }, mdBook);
    check("导入 Markdown", importedMd.ok, importedMd.error || "");
    check("多标题的 Markdown 自动拆章", (importedMd.book?.chapters || []).length === 3, `${(importedMd.book?.chapters || []).length} 章`);
    check(
      "章节落成了独立文件",
      fs.existsSync(path.join(VAULT_ROOT, SHELF, mdBook, "01 第一章.md")),
      `${SHELF}/${mdBook}/01 第一章.md`
    );

    // 不认识的格式要**明确拒绝**，不能默默存一本乱码书上架
    const badFormat = await page.evaluate(async () => {
      const r = await fetch("/api/vault/books/import?filename=x.docx", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Blob(["x"]),
      });
      return r.json();
    });
    check("不支持的格式被挡下", badFormat.ok === false && /不支持/.test(badFormat.error || ""), badFormat.error || "");

    fs.writeFileSync(
      path.join(bookDir, "book.md"),
      `---\n作者: 测试作者\n状态: 在读\n---\n\n# ${BOOK}\n\n深度工作是在无干扰状态下专注进行职业活动。\n`,
      "utf8"
    );

    await page.reload({ waitUntil: "networkidle" });

    // 多章书：书详情 → 书内全文搜 → 点命中直接进那一章。
    // 一本书拆成几十个文件之后，「那句话在哪一章」就是刚需（readest 也把它当核心功能）。
    await page.click(`.book-card:has-text("${mdBook}")`);
    await page.waitForSelector(".book-hero", { timeout: 8000 });
    check("多章书先进书详情", (await page.$$(".chapter-row")).length === 3, `${(await page.$$(".chapter-row")).length} 章`);

    /**
     * ⚠️ **这一页的主角会变，判据是「这本书里有没有标记」。**
     * 这本刚导进来、一条标记都没有，所以章节目录**占满整栏**——还没读过的书，
     * 章节就是它的全部内容，给它画一个空的「我的标记」大栏是把版面让给了一句
     * 「这里什么都没有」。等下划了高亮再回来，两边要换位（见下面那组断言）。
     *
     * 两个方向都要钉：只钉「有标记时是标记主导」的话，「一直都是标记主导」这种
     * 实现照样能过，而那正是要避免的那一版。
     */
    check(
      "还没有标记时，章节目录占满整栏",
      (await page.$$(".marks")).length === 0 && (await page.$$(".chapter-list[data-rail]")).length === 0,
      `.marks=${(await page.$$(".marks")).length} 右栏=${(await page.$$(".chapter-list[data-rail]")).length}`
    );
    check("没有标记时页头说的是章节", (await page.textContent(".panel-head__main h2")).includes("章节目录"), await page.textContent(".panel-head__main h2"));

    /**
     * 书详情的元信息和阅读区**是同一套**（`.doc-meta` + `MetaItem`）。
     *
     * 上一版是等宽大写的小药丸，而等宽包里没有中文字形——「在读」两个字直接掉进系统
     * 回退，字重字宽和整页所有字都对不上，那正是「字体看着都不一样」的来源。
     * 所以这里量的是两件事：**每项都有图标 + 字段名**（不是一颗光秃秃的药丸），
     * 以及**中文没落在等宽字体上**。
     */
    const heroMeta = await page.$$eval(".book-hero .doc-meta__item", (els) =>
      els.map((e) => ({
        name: e.querySelector("b")?.textContent || "",
        icon: !!e.querySelector("svg"),
        mono: /mono/i.test(getComputedStyle(e.querySelector("b")).fontFamily),
      }))
    );
    check("书详情的元信息和阅读区同一套", heroMeta.length >= 3 && heroMeta.every((m) => m.icon && m.name), `${heroMeta.length} 项`);
    check("元信息里的中文不落在等宽字体上", heroMeta.length > 0 && heroMeta.every((m) => !m.mono), heroMeta.map((m) => m.name).join("/"));
    check("作者收进了元信息行，不再自己占一行", heroMeta.some((m) => m.name === "作者") && (await page.$$(".book-hero__author")).length === 0);
    // 「正文在 书架/xxx/」那行删了：路径就是上面那个大标题，等于把标题又说一遍；
    // 批注去哪由阅读区的 annotateLabel 在**真正要写批注的时候**说。
    check("书详情不再重复一遍 vault 路径", !(await page.textContent(".book-hero")).includes("正文在"));

    /**
     * 元信息和动作**贴着封面底边**，不跟着书名长短上下浮动。
     *
     * 书名有一行的也有三行的（中文书名动辄二十几个字），跟在标题后面排的话，
     * 「继续读」这个每次都要点的按钮在每本书里都落在不同高度。量的是两个底边的差。
     */
    const heroBottoms = await page.evaluate(() => {
      const cover = document.querySelector(".book-hero .cover").getBoundingClientRect();
      const foot = document.querySelector(".book-hero__foot").getBoundingClientRect();
      return { gap: Math.abs(cover.bottom - foot.bottom), ratio: cover.height / cover.width };
    });
    check("元信息和动作贴着封面底边", heroBottoms.gap <= 2, `差 ${heroBottoms.gap.toFixed(1)}px`);
    // 封面得 align-self: flex-start，不然会被 stretch 拉高、3:4 的比例直接没了
    check("封面没有被拉伸变形", Math.abs(heroBottoms.ratio - 4 / 3) < 0.02, `比例 ${heroBottoms.ratio.toFixed(2)}`);
    // 书详情的封面是张图不是按钮：这一页最常做的是读书，误触换来的是个文件对话框
    check("书详情的封面不再是换封面的按钮", (await page.$$(".book-hero button.cover-pick__btn")).length === 0);

    /**
     * **资料 / 藏书**：这条界线决定正文能不能改，而它不是文件格式，是「这是谁写的字」。
     * 资料是自己攒的（不能改反而是残废的），藏书是别人写的（改了它，从书里摘的每一句
     * 引用都不再可信）。没写类型时按来源后缀推断——这本是 .md 导进来的，所以默认是资料。
     */
    check("md 导进来的默认是资料", (await page.textContent(".book-hero .select__btn")).includes("资料"), await page.textContent(".book-hero .select__btn"));
    await page.click(".book-hero .select__btn");
    await page.click('.book-hero .select__pop button:has-text("藏书")');
    await page.waitForFunction(
      () => document.querySelector(".book-hero .select__btn")?.textContent.includes("藏书"),
      null,
      { timeout: 6000 }
    );
    // 落点是 book.md 的 frontmatter，不是 localStorage：这是关于这本书的事实，
    // 不是这台机器的偏好，Obsidian 那边也该看得见、也该能改
    const kindMd = fs.readFileSync(path.join(VAULT_ROOT, SHELF, mdBook, "book.md"), "utf8");
    check("类型写进了 book.md 的 frontmatter", /^类型: 藏书$/m.test(kindMd), kindMd.split("\n").slice(0, 6).join("⏎"));
    await page.click(".chapter-row");
    await page.waitForSelector(".reader .prose", { timeout: 8000 });
    // 只读时**不画那个按钮**，而不是画一个点了报错的
    check("藏书不画编辑按钮", (await page.$$('.doc-actions button:has-text("编辑")')).length === 0);
    // **规则要落在服务端**，前端不画按钮只是给人看的；开着的旧标签页、以后别的调用方
    // 都会经过这个端点。403 还得给出下一步，不能只说「不行」
    const readonly = await page.evaluate(async (p) => {
      const r = await fetch("/api/vault/doc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: p, content: "不该写进去" }),
      });
      return { status: r.status, body: await r.json() };
    }, `${SHELF}/${mdBook}/01 第一章.md`);
    check("藏书在服务端也拦得住", readonly.status === 403 && /资料/.test(readonly.body.hint || ""), `${readonly.status} ${readonly.body.error || ""}`);
    check("被拦下之后文件没动", fs.readFileSync(path.join(VAULT_ROOT, SHELF, mdBook, "01 第一章.md"), "utf8").includes("内容甲"));
    await page.keyboard.press("Escape");
    await page.waitForSelector(".book-hero", { timeout: 8000 });
    // 翻回资料，编辑入口跟着回来——一本一次的开关，不是一次一次的解锁
    await page.click(".book-hero .select__btn");
    await page.click('.book-hero .select__pop button:has-text("资料")');
    await page.waitForFunction(
      () => document.querySelector(".book-hero .select__btn")?.textContent.includes("资料"),
      null,
      { timeout: 6000 }
    );
    await page.click(".chapter-row");
    await page.waitForSelector(".reader .prose", { timeout: 8000 });
    check("翻回资料后编辑入口回来了", (await page.$$('.doc-actions button:has-text("编辑")')).length === 1);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".book-hero", { timeout: 8000 });

    await page.fill(".panel-head__aside .search-box input", "内容乙");
    await page.waitForSelector(".booksearch__hit, .empty", { timeout: 8000 });
    const hitText = await page.textContent(".booksearch__hit").catch(() => "");
    check("能在一本书里全文搜", hitText.includes("第二章") && hitText.includes("内容乙"), hitText.replace(/\s+/g, " ").slice(0, 50));
    await page.click(".booksearch__hit");
    await page.waitForSelector(".reader .prose", { timeout: 8000 });
    check("点搜索结果直接进那一章", (await page.textContent(".reader-title")).includes("第二章"), await page.textContent(".reader-title"));

    // 高亮：划一段 → 点高亮 → 正文里出现标记 + 落进 vault 的 .highlights.md。
    // **锚点是原文文本不是偏移量**：书重新导入之后偏移会整体错位，而那句话还在。
    await page.evaluate(() => {
      // 测试书的章节很短（「内容乙。」四个字），别按长度挑——挑不到就是 undefined
      const el = document.querySelector(".reader .prose p");
      const r = document.createRange();
      r.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForSelector(".sel-bar", { timeout: 4000 });
    await page.click('.sel-bar button[aria-label="高亮"]');
    await page.waitForSelector(".prose mark[data-hl]", { timeout: 6000 });
    check("高亮画到了正文上", (await page.$$(".prose mark[data-hl]")).length === 1);
    const hlFile = path.join(VAULT_ROOT, SHELF, mdBook, "02 第二章.highlights.md");
    check("高亮落进了 vault 的 Markdown", fs.existsSync(hlFile) && fs.readFileSync(hlFile, "utf8").includes("- [黄]"), "02 第二章.highlights.md");
    // 「标记」页签把高亮和批注放在一起：分成两个页签的话，你得先想「我当时是划的还是写的」
    await page.click('.rail-tabs button:has-text("标记")');
    await page.waitForSelector(".mark-item", { timeout: 4000 });
    check("高亮出现在标记清单里", (await page.$$(".mark-item")).length === 1);

    /**
     * **阅读区开着时，底下那一层不该还能滚。**
     * 覆盖层是 fixed 全屏，列表页并没有消失——不锁的话窗口右边挂着一条
     * 滚了也什么都不会动的滚动条，屏幕上同时四条，其中一条是纯噪音。
     *
     * ⚠️ **断言量的是效果（正文面板真的不滚了），不是机制。**
     * 上一版写死 `document.body.style.overflow === "hidden"`，容器结构改版之后
     * 滚的从 body 换成了 `.main`，那句断言就变成了在考「有没有用那一行代码」——
     * 换个正确的实现照样红。量 computed 的话，以后锁法再变一次这条还成立。
     */
    const locked = await page.evaluate(() => ({
      attr: document.documentElement.hasAttribute("data-scroll-lock"),
      mainOverflow: getComputedStyle(document.querySelector(".main")).overflow,
    }));
    check(
      "阅读区开着时锁住了背后那一层的滚动",
      locked.attr && locked.mainOverflow === "hidden",
      `attr=${locked.attr} · .main overflow=${locked.mainOverflow}`
    );

    // 两侧栏都能收起：读长文时正文该能吃满屏
    await page.click('button[title="收起目录"]');
    await page.click('button[title="收起批注台"]');
    await page.waitForTimeout(300);
    check("两侧栏能收起", (await page.$$(".doc-rail")).length === 0 && (await page.$$(".rail")).length === 0);
    await page.click('button[title="展开目录"]');
    await page.click('button[title="展开批注台"]');
    await page.waitForSelector(".rail", { timeout: 4000 });

    // 阅读设置：改一次字号，正文的 CSS 变量要跟着变（readest 那条「没有一套排版适合所有人」）
    const sizeBefore = await page.$eval(".prose", (el) => getComputedStyle(el).fontSize);
    await page.click('.reader-overlay__bar .prefs button[aria-expanded]');
    await page.waitForSelector(".prefs__pop", { timeout: 4000 });
    // 数值是一格一格调的，不是三档——三档之间跨度太大，中间那个刚好不合适
    await page.click('.prefs__num:has-text("字号") .prefs__step button:last-child');
    await page.waitForTimeout(200);
    const sizeAfter = await page.$eval(".prose", (el) => getComputedStyle(el).fontSize);
    check("阅读设置能改字号", parseFloat(sizeAfter) > parseFloat(sizeBefore), `${sizeBefore} → ${sizeAfter}`);
    // 取的是对中文长文真正有感的那几项，**不抄分页阅读器才需要的**（分栏、页眉页脚、剩余页数）
    const prefRows = await page.$$eval(".prefs__name, .prefs__switch span", (els) =>
      els.map((e) => e.firstChild?.textContent?.trim() || e.textContent.trim())
    );
    check(
      "阅读设置项齐全",
      prefRows.join("/") === "字号/行宽/行距/段距/字重/中文字体/拉丁字体/纸色/首行缩进/两端对齐",
      prefRows.join("/")
    );
    /**
     * 字体分两组，因为它们管的**不是同一件事**：中文字体管中文书里 99% 的字；
     * 拉丁那几个 @fontsource 包**只有拉丁字形**，中文一律回落到系统字体。
     * 默认必须是黑体——那是原来的默认值，不能因为加了几个拉丁字体就被挤掉。
     */
    const fonts = await page.$$eval(".prefs__fonts button", (els) => els.map((e) => e.textContent));
    check(
      "中文和拉丁字体都能选",
      fonts.join("/") === "黑体/苹方/微软雅黑/宋体/Lexend/Inter/Source Sans/Literata/Georgia",
      fonts.join("/")
    );
    const picked = await page.$$eval('.prefs__fonts button[aria-pressed="true"]', (els) => els.map((e) => e.textContent));
    check("默认字体是黑体", picked.join("/") === "黑体", picked.join("/") || "(没有选中项)");
    // 这台机器上没装的（苹方是 macOS 的）留在原位但点不动，并在 title 里说清为什么——
    // 直接藏掉的话用户会以为是自己看错了
    const missing = await page.$$eval(".prefs__fonts button:disabled", (els) =>
      els.map((e) => `${e.textContent}:${e.title}`)
    );
    check("本机没装的字体标成不可选并说明原因", missing.every((m) => m.includes("没装")), missing.join(" | ") || "(本机都装了)");
    await page.click(".prefs__reset");
    // 第一下 Esc 关的是设置面板（它 stopPropagation 了），关阅读区得再来一下。
    // 这是对的：面板开着时 Esc 应该只收面板，不该把整篇文章也关掉。
    await page.keyboard.press("Escape");
    await page.waitForSelector(".prefs__pop", { state: "detached", timeout: 4000 });
    check("设置面板开着时 Esc 只收面板", !!(await page.$(".reader-overlay")));
    await page.keyboard.press("Escape");
    await page.waitForSelector(".reader-overlay", { state: "detached", timeout: 5000 });
    // 书架是三层，Esc 一层一层退：阅读区 → 书详情 → 书架。
    // 这也是断言——退一下就直接回书架的话，说明中间那层被跳过了。
    check("Esc 退回的是书详情不是书架", !!(await page.$(".book-hero")));

    /**
     * 刚才那条高亮落进了 `02 第二章.highlights.md`，所以退回书详情时**主角换人了**：
     * 标记翻到主栏、章节退到右边那条 300px 上。
     *
     * 这一组是新版书详情**唯一**被覆盖到的路径——上面那本测试书一条标记都没有，
     * 走的是「章节占满」那一支。少了这一组，整个标记栏可以完全不渲染而测试全绿。
     */
    await page.waitForSelector(".marks", { timeout: 8000 });
    const flipped = await page.evaluate(() => ({
      head: document.querySelector(".panel-head__main h2")?.innerText.replace(/\s+/g, " ").trim(),
      quote: document.querySelector(".mark__q")?.textContent.trim(),
      chapter: document.querySelector(".marks__ch")?.textContent.trim(),
      when: document.querySelector(".mark__f time")?.textContent.trim(),
      railCount: document.querySelector(".chapter-list[data-rail] .chapter-row__marks")?.textContent.trim(),
      chapters: document.querySelectorAll(".chapter-list[data-rail] .chapter-row").length,
      // 高亮没有正文（我没写字），批注有——**这才是分得开两者的东西**，
      // 不是竖线的颜色（那一版量出来在白底上只有 1.17:1，而且库里所有高亮都是黄的）
      body: document.querySelectorAll(".mark .mark__n").length,
    }));
    check("划了高亮之后，标记翻到主栏", /我的标记/.test(flipped.head || "") && /1 条/.test(flipped.head || ""), flipped.head);
    check("标记就是刚划的那句", (flipped.quote || "").includes("内容乙"), flipped.quote);
    check("标记按章分组", (flipped.chapter || "").includes("第二章"), flipped.chapter);
    /**
     * ⚠️ **高亮文件的格式里不记时间，所以这儿只能照实说「只划了线」。**
     * 钉这条是因为最省事的写法就是拿文件 mtime 顶上——一整份文件同一个时间戳，
     * 排出来的顺序看着像真的，其实是假的。
     */
    check("高亮没有时间就照实说，不编一个", flipped.when === "只划了线", flipped.when);
    check("章节退到右栏但一章不少", flipped.chapters === 3, `${flipped.chapters} 章`);
    check("右栏那一章挂着标记数", flipped.railCount === "1", flipped.railCount || "(没有)");
    /**
     * ⚠️ **高亮和批注靠内容分，不靠颜色分。** 这条钉的是一个撤掉的方案不要长回来：
     * 按 `--mark-*` 给竖线上色的那一版，在白底上量出来只有 1.17:1（看不见），
     * 而且划词工具条根本不给选颜色——它区分的是一个不存在的差别。
     * 这一条只划了线、没写字，所以正文块应该是 0 个。
     */
    check("高亮没有正文块，批注才有", flipped.body === 0, `${flipped.body} 个`);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".book-card", { timeout: 8000 });

    /**
     * 作者在卡片上**只显示，不给改**。
     *
     * 这条钉的是一个已经撤掉的功能不要被顺手加回来：`book.md` 的 frontmatter 在
     * Obsidian 里本来就能编辑，而这一格挨着「打开这本书」，做成可点即改的话，
     * 一次误触改的是 vault 里的文件。**同一件事有两个入口时，留那个不会误触的。**
     *
     * 断言 tagName 而不是「找不到 input」：光断言 input 不存在的话，把它做成
     * contenteditable 或者一个点开弹窗的按钮照样能过。
     */
    {
      const card = `.book-card:has-text("${BOOK}")`;
      const tag = await page.$eval(`${card} .book-card__author`, (el) => el.tagName);
      check("作者只显示不给改（要改去 Obsidian）", tag === "SPAN", tag);
    }

    // 单篇书从书架直接进正文——中间那层「书详情」只有一个按钮，是白点的一次鼠标
    await page.click(`${`.book-card:has-text("${BOOK}")`} .book-card__open`);
    await page.waitForSelector(".reader .prose", { timeout: 8000 });
    check("书能打开并渲染正文", (await page.textContent(".reader .prose")).includes("深度工作"));

    /**
     * ⚠️ **epub 插图要真的能显示出来**，走完「消毒 → 改写相对路径 → 图片接口」整条链。
     *
     * 光断言 `<img>` 在不在是抓不住这个 bug 的：DOMPurify 把不在白名单里的 `src`
     * **整个删掉**（img 还在，只是没了 src），页面上留下一个只有 alt 的破图框。
     * 所以量的是 `naturalWidth`——图真的解码出来了才不为 0。
     * 这条要用**书架上真实的书**（测试书没有插图），所以是「有插图就验、没有就说没验到」。
     */
    const imgs = await page.evaluate(async () => {
      const list = [...document.querySelectorAll(".reader .prose img")];
      if (!list.length) return null;
      await Promise.all(
        list.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))
      );
      return {
        n: list.length,
        ok: list.filter((i) => i.naturalWidth > 0).length,
        src: list[0].getAttribute("src") || "（src 被消毒掉了）",
      };
    });
    check(
      imgs ? "正文插图真的显示出来了" : "这一章没有插图，图片链路没验到",
      imgs ? imgs.ok === imgs.n : true,
      imgs ? `${imgs.ok}/${imgs.n} · ${imgs.src.slice(0, 60)}` : ""
    );
    check("frontmatter 解析成元信息", (await page.textContent(".doc-meta")).includes("测试作者"));

    /**
     * **书架里的书就是 vault 里的 md，本来就该能改。**
     * 自己收集整理的资料要边读边补，而「去 Obsidian 里改」意味着离开正在读的这一屏、
     * 在另一个应用里找到同一个文件、改完再回来刷新。
     *
     * 三条断言各钉一个会安静出错的地方：编辑器带出的是**原文**（不是去掉标题那份，
     * 拿它存回去等于删掉 `# 标题`）、界面上说的是 **vault**（不是 Notion）、
     * 存完 **frontmatter 还在**（不接回去的话，第一次保存就把作者/状态抹了）。
     */
    await page.click('.doc-actions button:has-text("编辑")');
    await page.waitForSelector(".md-editor .cm-content", { timeout: 4000 });
    // CodeMirror 是 contenteditable，`inputValue` / `fill` 都不适用。
    // ⚠️ `innerText` 只拿得到**渲染出来的行**——CodeMirror 对长文档是虚拟滚动的。
    // 这里成立是因为测试书很短；真正的落盘校验在下面读文件那两条上。
    const cmText = () => page.evaluate(() => document.querySelector(".cm-content")?.innerText || "");
    const draft0 = await cmText();
    check("编辑器带出的是原文不是渲染稿", draft0.includes("# ") && draft0.includes("深度工作"), draft0.slice(0, 30).replace(/\n/g, "⏎"));
    check("编辑器说清写回的是 vault", (await page.textContent(".ws-edit .eyebrow")).includes("VAULT"), await page.textContent(".ws-edit .eyebrow"));
    // 文件名就是标题，而文件名同时是阅读进度、高亮伴生文件和 Obsidian 双链的锚点。
    // 给一个改了却不生效的输入框比不给更糟
    check("书的标题不给改", (await page.$$(".ws-edit input.edit-title")).length === 0);
    await page.click(".md-editor .cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\n冒烟测试补写的一段。");
    await page.click('.ws-edit button:has-text("保存到 vault")');
    await page.waitForFunction(
      () => document.querySelector(".reader .prose")?.textContent.includes("冒烟测试补写的一段"),
      null,
      { timeout: 8000 }
    );
    check("存完正文就地更新", true);
    const bookMd = fs.readFileSync(path.join(bookDir, "book.md"), "utf8");
    check("正文写回了 vault 的 md", bookMd.includes("冒烟测试补写的一段"));
    check("frontmatter 原样保留", /^---\r?\n作者: 测试作者/.test(bookMd), bookMd.slice(0, 20).replace(/\n/g, "⏎"));
    check("元信息还在（说明 frontmatter 没被写没）", (await page.textContent(".doc-meta")).includes("测试作者"));

    /**
     * **这些 md 的主编辑器其实是 Obsidian**，所以整份重写前要对一下版本号。
     * 不对的话，工作台会把你刚在 Obsidian 里写的段落安静地抹掉，而且没有任何地方
     * 看得出发生过这件事。拿一个过时的 stamp 打过去必须 409 + 给出下一步。
     */
    const stale = await page.evaluate(async (p) => {
      const r = await fetch("/api/vault/doc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: p, content: "不该被写进去", stamp: "1" }),
      });
      return { status: r.status, body: await r.json() };
    }, `${SHELF}/${BOOK}/book.md`);
    check("文件在别处改过时不硬覆盖", stale.status === 409 && !!stale.body.hint, `${stale.status} ${stale.body.error || ""}`);
    check("被挡下之后文件原样没动", fs.readFileSync(path.join(bookDir, "book.md"), "utf8").includes("冒烟测试补写的一段"));

    // 划词：选中正文里的一句，工具条应该弹出来
    const select = () => page.evaluate(() => {
      const p = document.querySelector(".reader .prose p");
      const r = document.createRange();
      r.selectNodeContents(p);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await select();
    await page.waitForSelector(".sel-bar", { timeout: 4000 });
    // 工具条是**图标**不是文字：它浮在正文上，五个中文词一排要 300 多像素，
    // 盖住的正好是你刚读的那一行。所以断言读 title，不读 textContent。
    const acts = await page.$$eval(".sel-bar button", (els) => els.map((e) => e.getAttribute("aria-label")));
    check(
      "划词工具条",
      acts.join("/") === "高亮/批注/解释/展开/反驳/翻译/去对话/选题/存素材",
      acts.join("/")
    );
    check("工具条按性质分了组", (await page.$$(".sel-bar__sep")).length === 2);
    // 八个图标 = 八个谜语，除非每个都带说明。自绘 tooltip 而不是原生 title：
    // 后者要悬停一秒才出，等于每次都要等
    const tips = await page.$$eval(".sel-bar__tip", (els) => els.length);
    check("每个图标都有悬浮说明", tips === acts.length, `${tips}/${acts.length}`);

    // **选区必须活到工具条出现之后**。这条守的是一个真事故：工具条一出现就是一次
    // setState，React 顺手把 dangerouslySetInnerHTML 那一坨重写了一遍，DOM 全换新的，
    // 浏览器选区当场消失——现象是「弹出菜单了，但不知道自己选中了哪几句」。
    // 光测 ::selection 的颜色是测不出来的，必须测选区还在不在。
    const alive = await page.evaluate(async () => {
      await new Promise((f) => setTimeout(f, 300));
      return window.getSelection().toString().length;
    });
    check("选区活到工具条出现之后", alive > 10, `${alive} 字`);

    // 批注 → 右栏编辑器 → 保存 → 落盘
    const tabsRail = await page.$$eval(".rail-tabs button", (els) => els.map((e) => e.textContent.trim()));
    check("批注台三个页签", tabsRail.join("/") === "标记/衍生/对话", tabsRail.join("/"));
    await page.click('.sel-bar button[aria-label="批注"]');
    await page.waitForSelector(".rail textarea", { timeout: 4000 });
    check("批注引用了原文", (await page.textContent(".rail-quote")).includes("深度工作"));
    await page.fill(".rail textarea", "冒烟测试写的批注");
    await page.click('.rail button:has-text("保存批注")');
    await page.waitForSelector(".rail .prose-sm", { timeout: 8000 });
    check("批注就地可见", (await page.textContent(".rail .prose-sm")).includes("冒烟测试写的批注"));

    const onDisk = fs.readFileSync(path.join(bookDir, "notes.md"), "utf8");
    check("批注真的写进了 notes.md", onDisk.includes("冒烟测试写的批注") && onDisk.includes("> 深度工作"), onDisk.split("\n")[1] || "");
    // 引用块和正文之间必须空一行，否则 Markdown 会把正文并进引用（Obsidian 里也一样错）
    check("批注块之间有空行", /^> .+\n\n冒烟测试写的批注$/m.test(onDisk), JSON.stringify(onDisk.slice(-120)));
    const railQuotes = await page.$$eval(".rail .prose-sm blockquote", (els) => els.map((e) => e.textContent.trim()));
    check("渲染时正文没被吸进引用", railQuotes.every((q) => !q.includes("冒烟测试写的批注")), railQuotes.join(" | "));
    await shot("reader", false);

    /**
     * **批注写下之后必须能改、能删。** 写错一个字就只能去 Obsidian 翻文件改，
     * 这在自己的工作台里说不过去。落地是整份重写那个 notes.md，所以这里要一路验到磁盘：
     * 改完文件里是新内容、删完文件里那一条没了。
     */
    check("批注切成了可操作的条目", (await page.$$(".note-item")).length === 1);
    await page.click('.note-item .icon-btn[title="改这条批注"]');
    await page.fill(".note-item textarea", "改过的批注");
    await page.click('.note-item button:has-text("保存")');
    await page.waitForFunction(() => document.querySelector(".note-item .prose-sm")?.textContent.includes("改过的批注"), null, { timeout: 8000 });
    const edited = fs.readFileSync(path.join(bookDir, "notes.md"), "utf8");
    check("改批注真的落到了 notes.md", edited.includes("改过的批注") && !edited.includes("冒烟测试写的批注"), edited.replace(/\s+/g, " ").slice(0, 60));
    check("改完引用还在", edited.includes("> 深度工作"), edited.replace(/\s+/g, " ").slice(0, 60));

    // 在右栏里划词：AI 答出来的东西里最常有的就是能直接用的句子，
    // 上一版只能整条「存为笔记」，想要其中一段就得手动复制再去别处粘。
    await page.evaluate(() => {
      const el = document.querySelector(".note-item .prose-sm p");
      const r = document.createRange();
      r.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForSelector(".sel-bar--fixed", { timeout: 4000 });
    const railActs = await page.$$eval(".sel-bar--fixed button", (els) => els.map((e) => e.getAttribute("aria-label")));
    check("右栏里也能划词", railActs.join("/") === "存为笔记/存素材/选题/复制", railActs.join("/"));
    // **和正文那条是同一个工具条**：同一套类名、同一套自绘 tooltip。
    // 划词这个动作在哪儿做都是一回事，长两个样子只会让人以为功能不同。
    check("右栏工具条和正文那条同款", (await page.$$(".sel-bar--fixed .sel-bar__tip")).length === 4);
    /**
     * **工具条弹出来之后，选区必须还在。**
     * 右栏里随便一次 setState（弹工具条就是一次）都会让父组件重渲染，
     * 而 `dangerouslySetInnerHTML` 一重跑，DOM 节点全换新的、浏览器选区当场消失——
     * 现象是「弹出菜单了，但看不出选中了哪几句，点按钮也没反应」。正文那边踩过一次，
     * 右栏这边又踩了一次，所以两边都要有断言。测的是**选区还在不在**，不是颜色。
     */
    const aliveInRail = await page.evaluate(() => window.getSelection().toString().trim().length);
    check("右栏弹出工具条后选区还在", aliveInRail > 3, `${aliveInRail} 字`);
    // 点工具条上的按钮真的要起作用（上一版因为选择器写错，点了等于取消）
    await page.click('.sel-bar--fixed button[aria-label="复制"]');
    /**
     * **等「说复制的那条 toast」，不是等「有 toast」，而且只读一次。**
     *
     * 上一版是 `waitForSelector(".toast")` 之后 `textContent(".toast")` 读两次
     * （一次当断言、一次当详情）。两个坑叠在一起：等到的可能是上一步遗留的那条 toast，
     * 而两次读之间它又被换掉了——于是断言用的是旧文案、打印出来的是新文案，
     * 失败信息看着自相矛盾（「✗ … ← 复制失败」，而 `复制失败` 明明含「复制」）。
     *
     * 断言只要求「点下去真的发生了一件事」：headless 里剪贴板写不进去是正常的
     * （没有焦点权限），那时应用会给「复制失败，手动选中拷一下吧」——这同样证明
     * 按钮起了作用。这一条防的是「选择器写错、点了等于取消」那种回归。
     */
    const copyToast = await page
      .waitForFunction(
        // **返回文本，不是布尔**：`includes(...) || null` 会让 handle 的值是 `true`，
        // 打印出来就是「✗ … ← true」，看不出到底弹的是哪条 toast。
        () => {
          const t = document.querySelector(".toast")?.textContent || "";
          return t.includes("复制") ? t : null;
        },
        null,
        { timeout: 5000 }
      )
      .then((h) => h.jsonValue())
      .catch(() => "");
    check("右栏工具条的按钮真的能用", String(copyToast).includes("复制"), String(copyToast) || "(没等到 toast)");
    // 收掉工具条再往下走。**不能按 Esc**——那一下会把整个阅读区关掉（Esc 是退一层的键）；
    // 也不能随手点右栏，点着页签就换了一栏。直接走它自己的收起路径最稳。
    await page.evaluate(() => {
      window.getSelection().removeAllRanges();
      document.querySelector(".rail-panel__body").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await page.waitForSelector(".sel-bar--fixed", { state: "detached", timeout: 4000 });

    await page.click('.note-item .icon-btn[title="删掉这条批注"]');
    await page.click('.note-item button:has-text("从 notes.md 里删掉")');
    await page.waitForFunction(() => !document.querySelector(".note-item"), null, { timeout: 8000 });
    check("删批注真的从 notes.md 里去掉了", !fs.readFileSync(path.join(bookDir, "notes.md"), "utf8").includes("改过的批注"));

    // 「衍生」页签**永远可点**。它以前在没划词时是禁用的灰按钮，点不动又不说为什么，
    // 看着就像 AI 功能坏了。现在进去先告诉你怎么用。
    await page.click('.rail-tabs button:has-text("衍生")');
    await page.waitForTimeout(200);
    const aiGuide = await page.textContent(".rail");
    check("衍生页签不是死按钮", aiGuide.includes("选中一段话") || aiGuide.includes("AI"), aiGuide.slice(0, 40));

    // 划词 AI：LLM 通就该出内容，不通就该出带 hint 的错误——两种都行，白屏或卡死不行。
    await select();
    await page.waitForSelector(".sel-bar", { timeout: 4000 });

    await page.click('.sel-bar button[aria-label="解释"]');
    await page.waitForSelector(".rail .prose-sm, .rail .note-danger", { timeout: 60000 });

    // 五个模式都要在。**必须放在第一次跑完之后**——没跑过时右栏是空态引导，
    // 模式按钮压根还没渲染（早一步断言拿到的是空数组，踩过一次）。
    //
    // **只断言按钮在，不点「选题」**：那是一次真实 LLM 调用、输出上限 2400 token，
    // 为一条断言烧这些不值。
    //
    // ⚠️ 这条**证明不了 Worker 认得这个模式**：content-pipeline 的 EXPLAIN_MODES
    // 是白名单，漏了就静默退回「解释」——不报错、HTTP 200、只是给回来的东西不对。
    // 跨仓库，这里测不到，Worker 改完必须手点一次真的看输出。
    const modes = await page.$$eval(".rail .ai-mode", (els) => els.map((e) => e.textContent.trim()));
    // **翻译不在这一行里**（它走 DeepL，确定性且便宜，不需要「回读不重跑」那套机制），
    // 但它仍在划词工具条上。这条断言跟着 AI_MODES 走，不包含翻译。
    check("衍生的四个模式都在", modes.join("/") === "解释/展开/反驳/选题", modes.join("/"));

    const aiErr = await page.textContent(".rail .note-danger").catch(() => "");
    const aiText = await page.textContent(".rail .prose-sm").catch(() => "");
    if (aiErr) {
      check("AI 失败时给了引导", aiErr.includes("LLM") || aiErr.includes("hint") || aiErr.length > 10, aiErr.slice(0, 90));
    } else if (!aiText.trim()) {
      /**
       * **第三种状态：没报错，也一个字都没回来。**
       *
       * 上游偶尔会这样（流开了又空着关掉）。它确实是个坏体验，所以照旧记一条失败；
       * 但**不能让它把后面一百多条检查一起带走**——上一版这里直接往下点
       * 「展开」，于是一次上游打嗝 = 整个套件在中途中断，真正要看的东西全没跑到。
       * 依赖外部的断言可以红，不可以炸。
       */
      check("AI 出内容", false, "没报错但一个字都没回来（上游这次是空的），跳过后面几条衍生检查");
    } else {
      check("AI 出内容", aiText.trim().length > 0, aiText.slice(0, 60));
      /**
       * **同一段话上再问一次，前一次不能消失。** 用户原话：「点击了解释获得了解释后，
       * 再点击展开或反驳，那之前的解释就消失了」。先看它讲什么、再看它往下推，
       * 这两段本来就该对着看；覆盖掉等于逼人重跑（还要再花一次 token）。
       */
      await page.click('.rail .ai-mode:has-text("展开")');
      await page.waitForFunction(
        () =>
          document.querySelector(".rail .ai-result .rail-label")?.textContent.includes("展开") ||
          document.querySelector(".rail .note-danger"),
        null,
        { timeout: 60000 }
      );
      /**
       * ⚠️ **这里的 `.catch` 不是防御性编程，是上面那条规矩往下走一步。**
       *
       * 第一次调用打嗝有人管（`aiErr` / 空回复两个分支），第二次没人管——而它一样会打嗝
       * （实测撞到过一次 `连不上 Worker: fetch failed`）。那时右栏渲染的是 `.note-danger`，
       * `.ai-result` 压根不存在，`page.textContent` 会**等满 30 秒然后抛**：
       * 一次上游打嗝 = 整套在中途中断，后面一百多条全没跑到（177/180 就是这么来的）。
       *
       * 所以照旧记一条红的，但不许炸。**依赖外部的断言可以红，不可以炸。**
       */
      const shownMode = (await page.textContent(".rail .ai-result .rail-label").catch(() => "")).trim();
      check("跑完直接停在新问的那一段上", shownMode === "展开", shownMode || "上游这次没回来（右栏是错误提示）");
      // 问过的模式要**看得出来**。上一版四个按钮长得一模一样、谁也不「当前」，
      // 只靠一个小圆点暗示，等于没有状态。现在问过的打勾 + 标记黄垫底。
      const done = await page.$$eval(".rail .ai-mode[data-done]", (els) => els.map((e) => e.textContent.trim()));
      check("问过的模式标出来了", done.join("/") === "解释/展开", done.join("/") || "一个都没标");

      /**
       * **点回已经问过的模式是回读，不是重跑。**
       * 让「再点一次」等于重跑的话，一次手滑就是一次 token；而且四段全堆在一栏里
       * 会把右栏变成一条几千字的长卷。所以一次只显示一段，重跑要明确点「重新生成」。
       */
      let calls = 0;
      const countAi = (r) => r.url().includes("/api/ai/explain") && calls++;
      page.on("request", countAi);
      await page.click('.rail .ai-mode:has-text("解释")');
      await page.waitForTimeout(700);
      // 同上：上游没回来时这一条也读不到 `.ai-result`，照旧红，不许炸
      const back = (await page.textContent(".rail .ai-result .rail-label").catch(() => "")).trim();
      page.off("request", countAi);
      check("点回问过的模式不重新花 token", calls === 0, `${calls} 次请求`);
      check("点回去看到的是那一段", back === "解释", back || "上游这次没回来（右栏是错误提示）");
      check("一次只显示一段", (await page.$$(".rail .ai-result")).length === 1);
      check("重跑要明确点「重新生成」", !!(await page.$('.rail .ai-result button:has-text("重新生成")')));
      // 存哪一段是分开的决定，所以「存为笔记」跟着当前这一段走
      check("当前这段有自己的存为笔记", !!(await page.$('.rail .ai-result__head button:has-text("存为笔记")')));

      /**
       * AI 答出来的东西最常见的去处是「拷走贴到别处」，而在有这个按钮之前只能手动划选——
       * 输出带标题和列表时，划全一段本身就很难。
       *
       * 断言量的是**它是个方的图标按钮**，不只是「存在」：`.btn-sm` 左右各 11px 内边距，
       * 不压成正方形的话，一个 13px 的图标会坐在 35px 宽的横条里，跟旁边的文字按钮排在
       * 一起像是那一个没写完。宽高差 ≤2px 就够钉住这件事。
       */
      const copyBtn = await page.$eval('.rail .ai-result__head button[aria-label*="复制"]', (el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), text: el.textContent.trim(), svg: el.querySelectorAll("svg").length };
      }).catch(() => null);
      check("AI 结果能一键复制", !!copyBtn && copyBtn.svg === 1, JSON.stringify(copyBtn));
      check("复制是个方的图标按钮", !!copyBtn && Math.abs(copyBtn.w - copyBtn.h) <= 2 && copyBtn.text === "", copyBtn && `${copyBtn.w}×${copyBtn.h} 「${copyBtn.text}」`);

      /**
       * **引用要么完整显示，要么给一个点得着的「展开」。**
       * 上一版把展开按钮写在了 blockquote 里面，而它挂着 `-webkit-line-clamp: 3`——
       * clamp 按行裁，按钮被裁成半截，现象就是「内容显示不全，底下挂着个残缺方块」。
       * 所以这里断言的是：按钮在引用**外面**，而且点完之后引用真的不再被裁。
       */
      const q = await page.$eval(".rail-quote", (el) => {
        const text = el.querySelector(".rail-quote__text > span");
        const box = el.querySelector(".rail-quote__text");
        const more = el.querySelector(".rail-quote__more");
        return {
          clipped: text.scrollHeight > text.clientHeight + 1,
          hasMore: !!more,
          // 按钮必须是引用的**兄弟**，不能在它里面——在里面就会跟着被 clamp 裁成半截
          outside: more ? !box.contains(more) : true,
          // clamp 得裁在整行上：裁在有内边距的块上时，底部会露出下一行的上半截
          halfLine: Math.abs(box.clientHeight - (text.clientHeight + 16)) > 2,
        };
      });
      check("引用要么完整、要么给个展开", !q.clipped || q.hasMore, JSON.stringify(q));
      check("展开按钮没被 clamp 裁掉", q.outside, JSON.stringify(q));
      check("引用没有露出半行", !q.halfLine, JSON.stringify(q));
      if (q.hasMore) {
        await page.click(".rail-quote__more");
        const shown = await page.$eval(".rail-quote__text", (el) => el.scrollHeight <= el.clientHeight + 1);
        check("展开之后引用完整可见", shown);
      }
    }
    // 下架：整个目录移进 vault 的 .trash/，不是删掉——里面有你自己写的批注。
    // 单篇书是从书架直接打开的，所以一下 Esc 就回到书架（没经过书详情那一层）。
    await page.keyboard.press("Escape");
    await page.waitForSelector(".book-card", { timeout: 8000 });

    /**
     * **写完批注之后，正文不能变成批注。**
     *
     * notes.md 是伴生文件不是章节。漏排它的后果非常具体：单篇书本来 0 章、直接打开
     * book.md；写下第一条批注后目录里多出 notes.md，被当成「唯一的一章」，
     * 点开书看到的是自己的批注——正文像凭空消失了。这时候 notes.md 已经真的写出来了，
     * 正是验这条的时候。
     */
    check("测试书确实已经有批注文件", fs.existsSync(path.join(bookDir, "notes.md")));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".book-card", { timeout: 15000 });
    const soloCard = await page.textContent(`.book-card:has-text("${BOOK}")`);
    check("有批注的单篇书还是「单篇」", soloCard.includes("单篇"), soloCard.replace(/\s+/g, " ").slice(0, 40));
    // 点封面 = 打开这本书（换封面是压在角上的小按钮），进去看到的必须是正文不是批注
    await page.click(`.book-card:has-text("${BOOK}") .book-card__cover`);
    await page.waitForSelector(".reader .prose", { timeout: 15000 });
    const bodyText = await page.textContent(".reader .prose");
    check("点封面进的是正文不是批注", bodyText.includes("深度工作") && !bodyText.includes("冒烟测试写的批注"), bodyText.replace(/\s+/g, " ").slice(0, 40));
    await page.keyboard.press("Escape");
    await page.waitForSelector(".book-card", { timeout: 8000 });
    // 换封面的入口还在，只是从「整块封面」缩成了角标——没封面的常驻显示
    const coverBtn = await page.textContent(`.book-card:has-text("${BOOK}") .book-card__coverbtn`).catch(() => null);
    check("封面上仍有换封面的入口", coverBtn !== null, coverBtn || "(找不到)");
    /**
     * ---- 7.9 书架侧的对话链路、换文档清场、关掉时中止 ----------------------
     *
     * 补这一段的直接原因：**书架里那 104 行对话代码，冒烟测试一条都没跑过。**
     * 完整的一轮（换引擎 / msg-sys / 重开一轮）只在 `#/materials`（内容工作台）跑，
     * 而书架里是**另一份几乎一样的实现**——两份各写各的，坏了一份没人知道。
     *
     * 这三条正好是「把这两份合成一个 hook」时最容易弄坏的地方，所以先在**现在的代码上**
     * 立好基线：合并之后它们必须还是绿的。
     *
     * **这一轮不真打 CLI，拦下来给假流。** 理由和「只断言选题按钮在、不点它」一样：
     * 真跑一轮 agent 要几十秒和一把 token，而这里要验的是**接线**——
     * 请求体里的 docTitle/docPath 从哪儿来、换引擎清不清会话、关掉时中不中止。
     * 那条真实链路已经由内容工作台那一轮盖住了，不必再烧一次。
     */
    let chatBody = null;
    let chatAborted = false;
    const onFailed = (r) => {
      if (r.url().includes("/api/agent/chat")) chatAborted = true;
    };
    page.on("requestfailed", onFailed);
    const mockChat = async (route) => {
      chatBody = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        status: 200,
        // 必须不是 application/json：`agentStream` 靠这个判断「这是流不是报错」
        headers: { "content-type": "text/plain; charset=utf-8", "x-session-id": "smoke-session" },
        body: "收到",
      });
    };
    await page.route("**/api/agent/chat", mockChat);
    try {
      await page.click(`.book-card:has-text("${mdBook}") .book-card__body`);
      await page.waitForSelector(".chapter-row", { timeout: 8000 });
      await page.click(".chapter-row");
      await page.waitForSelector(".reader .prose", { timeout: 10000 });
      await page.click('.rail-tabs button:has-text("对话")');
      await page.waitForSelector(".composer textarea", { timeout: 5000 });
      check("书架的阅读区也能选引擎", (await page.$$(".chat-engine button")).length === 2);

      await page.fill(".composer textarea", "只回答两个字：收到");
      await page.click(".composer .btn-primary");
      await page.waitForSelector(".msg-agent .prose-sm", { timeout: 10000 });
      check("书架里能发出一轮对话", (await page.textContent(".msg-agent .prose-sm")).includes("收到"));
      /**
       * **请求体里的 docTitle / docPath 正是两份实现唯一的差别**（书架取章节，
       * 内容工作台取条目），也正是以后抽成 hook 之后要靠参数传进去的东西。
       * 钉住它，合并之后传错了参数这里就会红。
       */
      check(
        "对话带上了这一章的身份",
        String(chatBody?.docPath || "").includes(mdBook) && !!String(chatBody?.docTitle || "").trim(),
        `${chatBody?.docTitle} | ${chatBody?.docPath}`
      );

      // 换引擎必须清掉上一家的会话号，并且**留一条痕迹**——不说的话只会像「它突然失忆了」
      await page.click('.chat-engine button:has-text("Codex")');
      await page.waitForSelector(".msg-sys", { timeout: 4000 });
      check("书架换引擎也会说明上下文不带过去", (await page.textContent(".msg-sys")).includes("不带过去"));
      await page.click('.chat-engine button:has-text("Claude Code")');

      /**
       * **换一篇文档，右栏必须清空。** 不清的话就是「上一篇的对话挂在这一篇上」，
       * 而屏幕上看不出那几条消息说的是另一篇——这类串台 CLAUDE.md 记过一次。
       */
      await page.click('.reader-overlay__bar button[aria-label="关闭"]');
      await page.waitForSelector(".chapter-row", { timeout: 8000 });
      await (await page.$$(".chapter-row"))[1].click();
      await page.waitForSelector(".reader .prose", { timeout: 10000 });
      await page.click('.rail-tabs button:has-text("对话")');
      await page.waitForSelector(".composer textarea", { timeout: 5000 });
      check("换一章之后对话是空的，不带上一章的消息", (await page.$$(".msg-agent, .msg-user")).length === 0);

      /**
       * **关掉阅读区要把在跑的请求掐掉。** 不掐的话它在后台接着烧 token，
       * 而回来的字已经没有地方可去了。这里换一个**永远不返回**的拦截，
       * 发出去之后立刻关掉阅读区，看浏览器有没有真的 abort 这条请求。
       */
      await page.unroute("**/api/agent/chat", mockChat);
      await page.route("**/api/agent/chat", () => {}); // 挂住不响应
      chatAborted = false;
      await page.fill(".composer textarea", "这一条会被中止");
      await page.click(".composer .btn-primary");
      await page.waitForSelector(".composer .btn-primary[disabled], .chat-log .skeleton", { timeout: 5000 }).catch(() => {});
      await page.click('.reader-overlay__bar button[aria-label="关闭"]');
      await page.waitForSelector(".chapter-row", { timeout: 8000 });
      await page.waitForTimeout(600);
      check("关掉阅读区会中止还在跑的对话", chatAborted, chatAborted ? "" : "请求还挂着，没被 abort");
    } finally {
      // **一定要收干净**：后面第 11 段要真打一轮 agent，路由留着的话那一轮全是假的，
      // 而它看起来会「通过」——最坏的一种绿。
      await page.unroute("**/api/agent/chat").catch(() => {});
      page.off("requestfailed", onFailed);
    }
    /**
     * 回书架走**书详情自己的返回按钮**，不要 `page.goto`。
     * 这时地址栏已经是 `#/shelf`，goto 到一个**完全相同的 URL** 是同文档导航，
     * 页面根本不重新渲染——人还站在书详情上，而 `.book-card` 只在书架墙上有。
     * （CLAUDE.md 记过同一个坑：「goto 到只有 hash 不同的地址不会重新加载」。）
     */
    /**
     * ⚠️ **这两行原来引着一个从不存在的类名。**
     *
     * 原写法是 `page.click('.book-detail button:has-text("返回书架"), .main button:has-text("返回书架")')`。
     * `BookDetail` 是个 fragment，**根本没有 `.book-detail` 这个元素**——那半个选择器
     * 从写下那天起就是死的。真正干活的一直是后半个。而它一旦也点不中，
     * 报出来的只有一句「click 超时 30 秒」：看不出是按钮改名了、是页面不对、
     * 还是选择器本来就指着空气。
     *
     * 现在：判据用**真实存在的** `.book-hero`（书详情的第一块），点击用不带死选择器的
     * 文本 locator。断言先跑，页面不对时它红在前面，不会退化成一次静默的长等待。
     */
    const backHere = await page.evaluate(() => ({
      detail: !!document.querySelector(".book-hero"),
      overlay: !!document.querySelector(".reader-overlay"),
      chapters: document.querySelectorAll(".chapter-row").length,
    }));
    check(
      "关掉阅读区之后回到书详情",
      backHere.detail && !backHere.overlay,
      JSON.stringify(backHere)
    );
    await page.getByRole("button", { name: "返回书架" }).first().click();
    await page.waitForSelector(".book-card", { timeout: 15000 });

    /**
     * ⚠️ **确认发生在那本书原来待的那一格上，墙不重排。**
     * 上一版是 `grid-column: 1 / -1` 的整行横条：点一下删除，后面的书全部挪位置，
     * 而要删的那本从原地消失、变成一条横在中间的长条——你只是想删一本书。
     * 断言量的是**这一格的矩形有没有变**，不是类名。
     */
    // ⚠️ **量 `offset*` 不量 `getBoundingClientRect`**：点击会把目标滚进视野，
    // 视口坐标于是跟着变——那是滚动，不是版面动了。offset 是相对于定位父级的，不受滚动影响。
    const cell = (name) =>
      page.evaluate((n) => {
        const e = [...document.querySelectorAll(".book-card")].find((x) => x.textContent.includes(n));
        return { w: e.offsetWidth, h: e.offsetHeight, x: e.offsetLeft, y: e.offsetTop };
      }, name);
    const cellBefore = await cell(mdBook);
    const wallBefore = await page.$$eval(".bookshelf .book-card", (els) => els.map((e) => `${e.offsetLeft},${e.offsetTop}`));
    await page.click(`.book-card:has-text("${mdBook}") .book-card__del`);
    await page.waitForSelector(".book-card__del--confirm", { timeout: 4000 });
    const after = await cell(mdBook);
    const wallAfter = await page.$$eval(".bookshelf .book-card", (els) => els.map((e) => `${e.offsetLeft},${e.offsetTop}`));
    check(
      "确认就在那本书原来那一格上",
      after.w === cellBefore.w && after.h === cellBefore.h && after.x === cellBefore.x && after.y === cellBefore.y,
      `${cellBefore.w}×${cellBefore.h}@${cellBefore.x},${cellBefore.y} → ${after.w}×${after.h}@${after.x},${after.y}`
    );
    check("确认时整面墙不重排", wallAfter.join(" ") === wallBefore.join(" "), `${wallBefore.length} 张卡都没挪`);
    /**
     * ⚠️ **确认时这一格上只剩两条路：删，或者取消。**
     * 封面上那三颗（接着读 / 查看章节 / 加封面）各自 `stopPropagation` 自己带路，
     * 掐掉整卡点击拦不住它们——留着的话，一个「你确定要删这本书吗」的时刻，
     * 屏幕上同时还有三个会**打开**这本书的入口。
     */
    const live = await page.evaluate((n) => {
      const card = [...document.querySelectorAll(".book-card")].find((x) => x.textContent.includes(n));
      return [...card.querySelectorAll("button")]
        .filter((b) => b.offsetParent !== null && getComputedStyle(b).pointerEvents !== "none")
        .map((b) => (b.textContent.trim() || b.getAttribute("aria-label") || "?").slice(0, 8));
    }, mdBook);
    check("确认时这一格上只剩删和取消两条路", live.length === 2, live.join("/"));
    // ⚠️ **书名要「显示但点不动」，不能藏**——藏掉就看不出在删哪一本，而那正是要确认的
    const nameVisible = await page.evaluate((n) => {
      const card = [...document.querySelectorAll(".book-card")].find((x) => x.textContent.includes(n));
      const el = card.querySelector(".book-card__open");
      return { shown: !!el && el.offsetParent !== null, dead: el && getComputedStyle(el).pointerEvents === "none" };
    }, mdBook);
    check("确认时书名还看得见但点不动", nameVisible.shown && nameVisible.dead, `显示=${nameVisible.shown} 点不动=${nameVisible.dead}`);
    const trashText = await page.textContent(".book-card__del--confirm").catch(() => "");
    /**
     * ⚠️ **按钮上的字要写清东西去哪**，不写「确定吗」。
     * 完整那句（正文 + 批注一起进 `.trash/`、能找回来）在 25px 的角标里放不下，
     * 挂在 `title` 上；书详情那一层的下架确认里是完整写出来的。
     * 三重保护仍在：要点两下、按钮写清去哪、回执 toast 带撤销。
     */
    const trashTip = await page.getAttribute(".book-card__del-go", "title");
    check("下架按钮上写清去哪", /废纸篓/.test(trashText), trashText.replace(/\s+/g, " ").slice(0, 24));
    check("完整说明没丢，挂在提示里", /\.trash/.test(trashTip || "") && /批注/.test(trashTip || ""), (trashTip || "").slice(0, 40));
    await page.click(".book-card__del-go");
    await page.waitForTimeout(1500);
    check("下架后书架上没了", !(await page.$(`.book-card:has-text("${mdBook}")`)));
    check("下架是移进 .trash 不是删掉", fs.readdirSync(path.join(VAULT_ROOT, ".trash")).some((n) => n.includes(mdBook)));
  } finally {
    fs.rmSync(bookDir, { recursive: true, force: true });
    fs.rmSync(`${bookDir}_md`, { recursive: true, force: true });
    // 测试自己丢进 .trash 的那份也收掉，不留在用户的废纸篓里
    try {
      for (const n of fs.readdirSync(path.join(VAULT_ROOT, ".trash"))) {
        if (n.includes("__smoke_")) fs.rmSync(path.join(VAULT_ROOT, ".trash", n), { recursive: true, force: true });
      }
    } catch {
      /* .trash 不存在就算了 */
    }
    // 顺手把测试自己建出来的空 书架/ 收掉。rmdir 只删空目录——真有书的时候会失败，正是我们要的。
    try {
      fs.rmdirSync(path.join(VAULT_ROOT, SHELF));
    } catch {
      /* 非空或不存在都不用管 */
    }
  }

  // 8. 近期热点：两个视角各测一遍。
  //    第三方免费接口随时会挂，所以断言的是「有东西出来 + 挂掉的如实标出」，
  //    而不是「六个榜全通」。（2026-08-10 实测：B 站和小红书就是长期 500。）
  await page.goto(`http://127.0.0.1:${PORT}/#/hot`, { waitUntil: "networkidle" });
  await page.waitForSelector(".board, .empty, .note-title", { timeout: 60000 });

  const boards = await page.evaluate(async () => {
    const r = await fetch("/api/hot/boards").then((x) => x.json());
    return {
      ids: (r.boards || []).map((b) => b.id),
      live: (r.boards || []).filter((b) => b.ok).map((b) => b.label),
      dead: (r.boards || []).filter((b) => !b.ok).map((b) => `${b.label}:${b.reason}`),
      total: r.stats?.total ?? 0,
      stale: !!r.stale,
    };
  });
  // 顺序也一起钉住：`BOARDS` 的数组顺序就是界面上的顺序，前端不再排一次。
  // 改这条之前先确认改的是 `server/lib/sixty.mjs`，别在别处补一个排序把它绕过去。
  check("六个榜都在信源清单里且顺序没变", boards.ids.join(",") === "weibo,douyin,toutiao,zhihu,bili,rednote", boards.ids.join(","));
  check("至少一个榜读到了内容", boards.live.length > 0 && boards.total > 0, `${boards.live.join("/")} 共 ${boards.total} 条`);
  // 挂掉的榜不占版面，但也不能装作不存在
  const chips = await page.$$eval(".src-chip", (els) => els.map((e) => e.textContent.trim()));
  check("只铺读到的源", chips.length === boards.live.length, `${chips.length} 枚 / ${boards.live.length} 个在线`);
  // 芯片上不写「已刷新」：每一枚都是同一句话，等于没说。那颗绿点已经答完「这个源通不通」
  check("信源芯片不重复写「已刷新」", !chips.some((t) => t.includes("已刷新")), chips.join(" / ").slice(0, 60));
  // 每个榜名前都要有图标——**有的有有的没有**比都没有更糟
  const headIcons = await page.$$eval(".board", (els) =>
    els.map((e) => !!e.querySelector(".board__head .board__icon"))
  );
  check("每个榜名前都有图标", headIcons.length > 0 && headIcons.every(Boolean), `${headIcons.filter(Boolean).length}/${headIcons.length}`);
  /**
   * 这一页的小字**不许套等宽**。等宽包里没有中文字形，「条」「热度」「刚刚」「万」
   * 会掉进系统回退——同一行里数字是 JetBrains Mono、汉字是系统字体，字重字宽全对不上。
   * 这几处没有一个是真·机读信息，等宽在这儿只有坏处。
   */
  const microFonts = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).fontFamily : "";
    };
    return [".panel-head__count", ".panel-head__time", ".board__head em", ".board__hot"].map((s) => [s, pick(s)]);
  });
  check(
    "面板小字没落在等宽字体上",
    microFonts.every(([, f]) => !f || !/mono/i.test(f)),
    microFonts.map(([s, f]) => `${s}=${f.split(",")[0]}`).join(" ")
  );
  // ⚠️ **stale 的时候底部那行故意不画**（它说的是快照里哪个榜挂了，而此刻是全挂），
  //    所以这段断言只在拿到真数据时才成立——写死的话上游一挂测试就红
  if (boards.dead.length && !boards.stale) {
    const note = await page.textContent(".panel-note").catch(() => "");
    check("挂掉的源在底部如实说明", boards.dead.every((d) => note.includes(d.split(":")[0])), note.slice(0, 70));
    // 原始异常（Unexpected token '<'…）不能直接铺到界面上
    check("失败原因是人话不是异常栈", !/DOCTYPE|Unexpected token|undefined/.test(note), note.slice(0, 60));
  }
  const boardTitles = await page.$$eval(".board__title", (els) => els.map((e) => e.textContent.trim()));
  check("热榜按平台分栏且未被过滤", boardTitles.length >= 10, `${boardTitles.length} 条`);
  await shot("hot-boards");

  /**
   * 快照态：**界面同时说两句相反的话**是这一页最容易出的事故，而它一个错都不报。
   * 真实发生过的样子：上面一条「六个榜今天都没抓到」，下面五枚绿点「这五个是通的」，
   * 页头还写着「检查于 23 小时前」——三处各说各的，而绿点最显眼，人只会信绿点。
   *
   * 上游是好是坏由不得测试，所以这里**伪造一个 stale 响应**，测的是界面怎么表达它。
   */
  const fakeFetchedAt = new Date(Date.now() - 23 * 3600_000).toISOString();
  await page.route("**/api/hot/boards*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        date: "2026-01-01",
        fetchedAt: fakeFetchedAt,
        configured: false,
        stale: true,
        staleHint: "还没填热榜的数据源地址（SIXTY_SECONDS_API_BASE_URL）。去设置面板填上就有今天的数据。",
        checkedAt: new Date().toISOString(),
        stats: { total: 1, live: 1, dead: 1 },
        boards: [
          { id: "weibo", label: "微博热搜", ok: true, count: 1, items: [{ rank: 1, title: "快照里的一条", link: "https://example.com/stale-probe", hot: "1.0万" }] },
          { id: "bili", label: "哔哩哔哩热搜", ok: false, reason: "上游返回了网页，多半被风控", count: 0, items: [] },
        ],
      }),
    })
  );
  await page.goto("about:blank");
  await page.goto(`http://127.0.0.1:${PORT}/#/hot`, { waitUntil: "networkidle" });
  await page.waitForSelector(".src-chip", { timeout: 30000 });
  const staleUi = await page.evaluate(() => ({
    title: document.querySelector(".note-title")?.textContent.trim() || "",
    hint: document.querySelector(".note-hint")?.textContent.trim() || "",
    time: document.querySelector(".panel-head__time")?.textContent.trim() || "",
    chips: [...document.querySelectorAll(".src-chip")].map((e) => e.className),
    deadNote: !!document.querySelector(".panel-note"),
  }));
  // 标题说「这是什么」，正文说「为什么 + 下一步」。**同一句话不能印两遍**
  check("快照提示的标题和正文不是同一句话", staleUi.title && staleUi.hint && !staleUi.hint.includes(staleUi.title), `${staleUi.title} || ${staleUi.hint.slice(0, 30)}`);
  check("快照提示写明了这份数据多老", /小时前|分钟前|天前|刚刚/.test(staleUi.title), staleUi.title);
  check("快照态的信源芯片不装成实时的", staleUi.chips.length > 0 && staleUi.chips.every((c) => c.includes("src-chip--stale")), staleUi.chips.join(" | "));
  check("页头写的是快照来自，不是检查于", staleUi.time.includes("快照来自") && !staleUi.time.includes("检查于"), staleUi.time);
  // 底部那行说的是快照里哪个榜挂了，此刻却是全挂——旧事实盖住新事实
  check("快照态不再拿旧的失败清单说话", !staleUi.deadNote);
  await page.unroute("**/api/hot/boards*").catch(() => {});
  await page.goto("about:blank");
  await page.goto(`http://127.0.0.1:${PORT}/#/hot`, { waitUntil: "networkidle" });
  await page.waitForSelector(".board, .empty, .note-title", { timeout: 60000 });

  // AI 情报这一侧才过滤，而且过滤是个**看得见的开关**，不是一句状态说明
  await page.click('.pill-tab:has-text("AI 情报")');
  await page.waitForSelector(".ai-item, .empty", { timeout: 60000 });
  const switchBtns = await page.$$eval(".switch button", (els) => els.map((e) => e.textContent.trim()));
  check("过滤是两段式开关", switchBtns.length === 2 && switchBtns[1].startsWith("全部"), switchBtns.join(" | "));
  const ai = await page.evaluate(async () => {
    const r = await fetch("/api/hot/ai").then((x) => x.json());
    return { total: r.stats?.total ?? 0, matched: r.stats?.matched ?? 0, filtered: r.filtered, groups: (r.groups || []).length };
  });
  check("AI 情报默认按关注词过滤", ai.filtered === true, JSON.stringify(ai));
  if (ai.matched > 0) {
    check("按日期分组", ai.groups > 0, `${ai.groups} 组`);
    const summaries = await page.$$eval(".ai-item__summary", (els) => els.map((e) => e.textContent.trim()));
    check("条目带中文摘要", summaries.length > 0 && summaries[0].length > 20, `${summaries.length} 条带摘要`);
    const hits = await page.$$eval(".ai-item__meta .strong", (els) => els.map((e) => e.textContent.trim()));
    check("命中词是可读的", !hits.some((w) => w.includes("\\b")), hits.find((w) => w.includes("\\b")) || "ok");
  } else {
    check("没命中时给了下一步", (await page.textContent(".empty")).includes("全部"));
  }
  // 切到「全部」应该拿到更多条，说明这个开关真的在做事
  await page.click('.switch button:has-text("全部")');
  await page.waitForTimeout(1200);
  const allCount = await page.$$eval(".ai-item", (els) => els.length);
  check("「全部」开关真的放宽了", allCount >= ai.matched, `${allCount} ≥ ${ai.matched}`);
  await shot("hot-ai");

  /**
   * **在工作台里读原文。** 这一页的动线是「扫一眼 → 觉得有用 → 入库」，中间那步
   * 「点开看看」原来要跳去浏览器新标签，回来时滚到哪儿全丢了。
   *
   * 断言写成**二选一**：抓得到就出正文，抓不到就出带 hint 的错误 + 原网页入口。
   * 写死「一定抓得到」的话，热点列表第一条换成公众号链接（挡爬虫）测试就红了——
   * 而那恰恰是设计里明确接受的失败。
   */
  const readBtn = await page.$('.ai-item__acts button:has-text("在这里读")');
  if (readBtn) {
    await readBtn.click();
    await page.waitForSelector(".reader-overlay .prose, .reader-overlay .note-danger", { timeout: 90000 });
    const got = await page.$(".reader-overlay .prose");
    if (got) {
      const len = (await page.textContent(".reader-overlay .prose")).replace(/\s/g, "").length;
      check("热点原文能在工作台里读", len > 200, `${len} 字`);
      check("读原文时也能划词存素材", (await page.$$(".reader-overlay .doc-meta__item")).length > 0);
      // 链接**不单独占一行**：它是「这条从哪来的」的一部分，长成一个小按钮跟在后面就够了
      check("原文链接是个按钮不是一整行", !!(await page.$(".reader-overlay .doc-meta__link")));
      /**
       * **右栏只给「衍生」。** 这篇文章不在 vault 里：没有 notes.md 可写、没有
       * .highlights.md 可锚，「标记」在这儿是个永远空的页签；「对话」的价值是能读整个
       * vault，而这篇不在里面。画一个点了没落点的页签，比不画更糟。
       */
      await page.click('.reader-overlay__bar button[aria-label*="AI 面板"]');
      await page.waitForSelector(".reader-overlay .rail-tabs", { timeout: 5000 });
      const railTabs = await page.$$eval(".reader-overlay .rail-tabs button", (els) => els.map((e) => e.textContent.trim()));
      check("热点原文的右栏只给「衍生」", railTabs.join("/") === "衍生", railTabs.join("/"));
      // 按钮上的字要说实话：这儿的「存」落进的是素材库，不是 notes.md
      check("这儿的存说的是素材不是笔记", !(await page.textContent(".reader-overlay .rail")).includes("存为笔记"));
    } else {
      const why = await page.textContent(".reader-overlay .note-danger");
      check("抓不到时说清原因并给回原网页", why.length > 8 && !!(await page.$('.reader-overlay a:has-text("原网页")')), why.replace(/\s+/g, " ").slice(0, 70));
    }
    // 原网页的入口一直留着：提取出来的正文不一定完整，图表和交互都在原页面上
    check("原网页的入口一直在", (await page.$$('.reader-overlay a[target="_blank"]')).length > 0);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".reader-overlay", { state: "detached", timeout: 5000 });
  }

  /**
   * 8c. 模型榜。**这一条的数据是解析 AI HOT 的页面来的，不是公开 API**——他们的 v1 里
   * 没有这个端点。所以断言写成二选一：解析出来就有表，解析不出来就有一句说明 + 去官网的出口。
   * 写死「一定有数据」的话，对方改一次版这里就红，而那恰恰是设计里明确接受的失败。
   */
  await page.goto("about:blank");
  await page.goto(`http://127.0.0.1:${PORT}/#/hot`, { waitUntil: "networkidle" });
  await page.click('.pill-tab:has-text("模型榜")');
  await page.waitForSelector(".lb__row, .empty", { timeout: 60000 });
  const models = await page.$$eval(".lb__row", (els) => els.length);
  if (models) {
    check("模型榜读到了", models > 3, `${models} 个模型`);
    const first = await page.$eval(".lb__row", (el) => ({
      name: el.querySelector(".lb__model strong")?.textContent.trim(),
      score: el.querySelector(".lb__score")?.textContent.trim(),
      href: el.getAttribute("href"),
    }));
    check("每行有模型名、分数和详情链接", !!first.name && /^\d/.test(first.score || "") && /^https?:/.test(first.href || ""), JSON.stringify(first));
    /**
     * 厂商图标那一格**每行都在，宽度一致**——图是抓来的，抓不到就是空格子，
     * 但格子不能少：少一枚图标只是缺个装饰，而一列模型名忽左忽右会看着像排版坏了。
     * 断言量的是**渲染后的宽度**（不是「有没有 img」），所以图抓不到时这条照样该绿。
     */
    const logoW = await page.$$eval(".lb__row .lb__logo", (els) => [...new Set(els.map((e) => e.getBoundingClientRect().width))]);
    check("图标位每行都占着，宽度一致", logoW.length === 1 && logoW[0] > 0, `${models} 行 · ${logoW.join("/")}px`);
    // 它是解析来的，会随对方改版失效——版面上必须如实说，并且留一个去官网的出口
    const note = await page.textContent(".hot-footnote");
    check("如实标注来源和失效风险", note.includes("解析") && note.includes("AIHOT"), note.replace(/\s+/g, " ").slice(0, 60));
  } else {
    check("模型榜挂了也给出口", (await page.textContent(".empty")).includes("官网"));
  }

  // 8b. 三个旧库只保留兼容跳转；用户看到的是同一个素材工作区与同一条处理链。
  await page.goto(`http://127.0.0.1:${PORT}/#/inbox`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mflow, .empty, .note-title", { timeout: 25000 });
  check("旧灵感入口自动归到素材", decodeURIComponent(page.url()).includes("#/materials"), page.url());
  check("素材链路把四个主要环节说清", (await page.$$(".mflow__steps li")).length === 4);
  /**
   * ⚠️ **链路那一排就是状态筛选器，下面不许再画一排状态芯片。**
   * 上一版两者同时在屏幕上：链路里写着「已收纳 8 / 可用素材 14 / 已进入项目 18」，
   * 下面一行芯片又写一遍同样三个数字，而点哪一份效果完全一样。
   * 量的是「素材页的筛选条里没有状态芯片」，不是「芯片总数是几」——
   * 别的库还在用它，写死数量的话改别的库这条会跟着红。
   */
  check("链路和状态芯片不同时出现", (await page.$$(".mflow ~ * .chips[aria-label*='状态']")).length === 0);
  /**
   * ⚠️ **筛到某一段之后要有一条明摆着的退路。**
   * 唯一的退路本来是「再点一次那一格」——那是个没人猜得到的动作，
   * 而屏幕上也看不出自己正被过滤。
   */
  check("链路上有一颗「全部」能退回来", !!(await page.$(".mflow__all")));
  /**
   * ⚠️ **核验下拉的三项要有三种图标。**
   * `Select` 里是 `renderIcon ? renderIcon(o) : null`——**不传就一枚都没有**，
   * 三项只剩三行字。而这三项恰恰最该靠形状分：盾牌=核过了、减号=压根不需要核、
   * 虚线圈=等你去核。量的是 svg 第一条 path 的 `d`，比数 class 靠谱（class 都一样）。
   */
  const vBtns = await page.$$(".filter-bar .select__btn");
  if (vBtns.length >= 2) {
    await vBtns[vBtns.length - 1].click();
    await page.waitForSelector(".select__pop", { timeout: 4000 });
    const vShapes = await page.$$eval(".select__pop button svg path", (els) =>
      els.map((e) => e.getAttribute("d")).filter(Boolean)
    );
    check("核验下拉三项的图标不一样", new Set(vShapes).size >= 3, `${new Set(vShapes).size} 种形状 / ${vShapes.length} 条路径`);
    await page.keyboard.press("Escape");
  }

  /**
   * ⚠️ **先等列表真的有行，再量下面这几条。**
   * `waitForSelector(".mflow")` 等到的是**链路那一块**，它在列表还在取的时候就渲染好了——
   * 这一节后面几条量的却是行。踩过一次而且骗过了我：那几条写成
   * `xs.length > 1 ? 最大差 : 0`，**一行都没有的时候返回 0，输出是「相差 0px」，看着全绿**。
   * 「等容器不等内容」在这个文件里已经记过两次，这是第三次。
   */
  await page.waitForSelector(".doc-row, .empty", { timeout: 25000 });

  /**
   * ⚠️ **右侧那几列要真的对齐。**
   * 上一版是个右对齐的 flex 簇，每行内容长短不同（「来源 → 尚未拆成素材」比「来源 1」
   * 宽一倍），同一列的东西在每行落在不同的横坐标——一列扫下去是锯齿，
   * 而这一层的全部价值就是「一眼扫十几条」。量的是**渲染后每行时间列的左缘**，
   * 不是「样式表里写了 grid」。
   */
  const colDrift = await page.evaluate(() => {
    const xs = [...document.querySelectorAll(".doc-row .doc-row__time")].map((e) => Math.round(e.getBoundingClientRect().left));
    // ⚠️ 量不到就说量不到（-1），别回一个 0 冒充「对齐」
    return xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : -1;
  });
  check("列表右侧那几列真的对齐", colDrift >= 0 && colDrift <= 1, colDrift < 0 ? "这一屏行数不够，量不到" : `时间列左缘相差 ${colDrift}px`);
  /**
   * ⚠️ **有没有外链是逐条不同的，那一格空着也要占位。**
   * 上面那条量的是时间列左缘，能抓到这个毛病——**但只有当这一屏里正好既有带链接的行、
   * 又有不带的**。所以这儿直接量那一格本身：它必须每行一样宽，和列表里有几条带链接无关。
   */
  const slotDrift = await page.evaluate(() => {
    const ws = [...document.querySelectorAll(".doc-row .doc-row__srcslot")].map((e) => Math.round(e.getBoundingClientRect().width));
    return ws.length > 1 ? Math.max(...ws) - Math.min(...ws) : -1;
  });
  check("「打开来源」那一格空着也占位", slotDrift >= 0 && slotDrift <= 1, slotDrift < 0 ? "这一屏行数不够，量不到" : `宽度相差 ${slotDrift}px`);

  /**
   * ⚠️ **拆出来的素材要能跳回它那一篇。**
   * 初筛把一篇文章拆成原子素材（一条只讲一件事），好处是可复用、可逐字核验，
   * 代价是**每条素材都不带它成立的前提**——而写作恰恰需要前提。原文一直在库里，
   * 之前界面上没有一条路走回去。
   *
   * ⚠️ **判据是「有来源的才画」**：手动入库的素材（`/金句` 那类）本来就没有来源，
   * 给它一个点了没反应的入口比不给更糟。所以这儿量的是**两者的关系**，
   * 不是「有几颗按钮」——写死数量的话，库里的素材构成一变这条就红。
   */
  const backlink = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".doc-row")];
    let withSource = 0;
    let withButton = 0;
    for (const row of rows) {
      // 「来源 N」＝这条是从某一篇里拆出来的；「独立素材」「来源 → …」＝没有可回的原文
      const trace = row.querySelector(".doc-row__trace")?.textContent || "";
      const has = /^来源\s*\d/.test(trace.trim());
      if (has) withSource += 1;
      if (row.querySelector('button[aria-label="看原文"]')) withButton += 1;
    }
    return { rows: rows.length, withSource, withButton };
  });
  check(
    "有来源的素材才画「看原文」，没有的不画",
    backlink.withButton === backlink.withSource,
    `${backlink.rows} 行 · 有来源 ${backlink.withSource} · 有按钮 ${backlink.withButton}`
  );

  /**
   * ⚠️ **表头那几格必须真的落在它说的那一列上。**
   * 一个指错列的表头比没有表头更糟。所以量的是「表头『类别』那一格」和
   * 「行里类别那一格」的左缘差，不是「有没有一个表头」。
   *
   * ⚠️ **找不到表头要红，不能安静跳过。** 上一版写成 `if (headAlign >= 0) check(...)`，
   * 于是「表头压根没渲染」和「表头对齐」在输出里长得一模一样——**一条被跳过的断言
   * 和一条不存在的断言是同一回事**，而它跳过的时候正是最该报警的时候。
   */
  const headAlign = await page.evaluate(() => {
    /* ⚠️ 表头故意**不叫** `.doc-row__open`：共用那个类名的话它会算进「行的主动作」里，
       所有按序号点行的地方全部错位一位（冒烟测试里当场点开了上一条素材）。 */
    const head = document.querySelector(".doc-rows__head");
    const row = document.querySelector(".doc-row");
    if (!head || !row) return { ok: false, why: head ? "没有数据行" : "没有表头" };
    const pick = (root, cls) => root.querySelector(cls)?.getBoundingClientRect().left;
    const drift = [".doc-row__trace", ".doc-row__kind", ".doc-row__tag", ".doc-row__time"]
      .map((c) => [c, pick(head, c), pick(row, c)])
      .filter(([, a, b]) => a != null && b != null)
      .reduce((m, [, a, b]) => Math.max(m, Math.abs(Math.round(a - b))), 0);
    return { ok: true, drift, cols: document.querySelector(".doc-rows")?.dataset.cols || "" };
  });
  check(
    "表头每一格都落在它那一列上",
    headAlign.ok && headAlign.drift <= 1,
    headAlign.ok ? `最大偏差 ${headAlign.drift}px · 列 ${headAlign.cols}` : headAlign.why
  );

  /**
   * ⚠️ **下面这两条要先筛到「已收纳」再量**，而且必须**等它真的选中了**再读样式。
   *
   * 不筛的话，默认那一屏三十行全是「可复用素材」——**类别只有一种，颜色分不分得开
   * 这件事根本量不到**，而断言会安静地跳过去（上一版就是这样，看着是绿的）。
   * 不等的话，`aria-pressed` 还没翻过来，读到的是「一个都没选中」。
   */
  await page.click('.mflow__steps button:has-text("已收纳")', { timeout: 8000 }).catch(() => {});
  await page.waitForSelector('.mflow__steps button[aria-pressed="true"]', { timeout: 8000 }).catch(() => {});
  // 同上：等的是**行**，不是那一格按下没有
  await page.waitForSelector(".doc-row, .empty", { timeout: 20000 }).catch(() => {});

  /**
   * ⚠️ **链路那几格选中时不画黑框。**
   * 黑在这套界面里只留给「点这儿」那一颗主操作；给一张白卡片描一道最重的黑边之后，
   * 选中态比页头那颗按钮还抢眼。量的是**选中那一格渲染后的边框色**，不是样式表里写了什么。
   */
  const picked = await page.evaluate(() => {
    const el = document.querySelector('.mflow__steps button[aria-pressed="true"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { border: cs.borderTopColor, ink: getComputedStyle(document.body).color, bg: cs.backgroundColor };
  });
  check("链路那一排选得中", !!picked, picked ? "有一格是按下的" : "一格都没按下");
  if (picked) {
    check("链路选中态不是一道黑框", picked.border !== picked.ink, `边框 ${picked.border} · 正文 ${picked.ink}`);
    check("链路选中态靠底色说话", picked.bg !== "rgba(0, 0, 0, 0)", picked.bg);
  }

  /**
   * ⚠️ **类别那一列要有颜色，而且各类别不同色。**
   * 上一版是一列一模一样的灰描边芯片，那一列等于只在重复「这是一条素材」。
   * 量的是**渲染后的底色**，不是样式表里写了哪个变量。
   */
  const kindTints = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll(".doc-row__kind .pill")) {
      seen.set(el.textContent.trim(), getComputedStyle(el).backgroundColor);
    }
    return [...seen.entries()];
  });
  check(
    "类别那一列上了色，而且各类别不同色",
    kindTints.length > 1 && new Set(kindTints.map(([, c]) => c)).size === kindTints.length,
    kindTints.length > 1 ? kindTints.map(([k, c]) => `${k}=${c}`).join(" · ") : `这一屏只有 ${kindTints.length} 种类别，量不到`
  );

  // 量完退回全部，后面几段要的是全量列表
  await page.click(".mflow__all").catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.mflow__steps button[aria-pressed="true"]'), { timeout: 8000 }).catch(() => {});

  const ideaIndex = await page.$$eval(".doc-row", (cards) => cards.findIndex((card) => card.querySelector(".tag--kind")?.textContent.includes("灵感来源")));
  if (ideaIndex >= 0) {
    await page.locator(".doc-row__open").nth(ideaIndex).click();
    // 等批注台真的挂上来，不是等覆盖层出现——正文还在取的时候右栏是不渲染的
    await page.waitForSelector(".reader-overlay .rail-tabs", { timeout: 25000 });
    check("灵感来源仍能进阅读区", !!(await page.$(".reader-overlay .rail")));
    const ideaTabs = await page.$$eval(".reader-overlay .rail-tabs button", (els) => els.map((e) => e.textContent.trim()));
    check("灵感来源仍能划词批注/问 AI", ideaTabs.join("/") === "标记/衍生/对话", ideaTabs.join("/"));
    await page.keyboard.press("Escape");
    await page.waitForSelector(".reader-overlay", { state: "detached", timeout: 5000 });
  }
  /* ⚠️ 这里原来写的是 `.page-head`，而共用页头件（`ui.jsx` 的 `PageHeader`）的类名一直是
     `.page-header`——**选择器指着一个不存在的类**，于是这条恒红，而按钮从头到尾都在。
     `.catch(() => "")` 把「找不到元素」和「按钮文案不对」抹成了同一种结果，所以看不出是哪种。 */
  const collectAction = (await page.textContent(".page-bar__end .btn-primary").catch(() => "")).trim();
  check("统一素材页保留收集入口", collectAction.includes("收集"), collectAction || "（没有这颗按钮）");
  await shot("ideas");

  // 8c. 统一素材区按处理阶段、类型、证据核验组合筛选；阶段与数量由 Worker 返回。
  await page.goto(`http://127.0.0.1:${PORT}/#/materials`, { waitUntil: "networkidle" });
  await page.waitForSelector(".doc-row, .empty, .note-title", { timeout: 25000 });
  const matAll = await page.$$eval(".doc-row", (els) => els.length);
  //     分面是**一个下拉**不是第二排芯片：两排芯片摞在一起分不出哪排是什么，
  //     而且第二排会随选项数量变长，把卡片墙一路往下顶。
  const facetBtn = await page.$(".filter-bar .select__btn");
  if (matAll > 0 && facetBtn) {
    const label = (await facetBtn.textContent()).trim();
    check("素材工作区能按类型筛", label.includes(MATERIAL_WORKSPACE.facet.label), `${label} · 适配器说是「${MATERIAL_WORKSPACE.facet.label}」`);
    await facetBtn.click();
    await page.waitForSelector(".select__pop", { timeout: 4000 });
    /**
     * **每一项要有自己的图标。** 做过一版整列用同一枚字段图标，七行长得一模一样——
     * 那时候图标不提供任何信息，只在每行左边占 15px。量的是 svg 里第一条 path 的 `d`：
     * 图标不同则路径不同，比数 class 靠谱（class 都是一样的）。
     */
    const shapes = await page.$$eval(".select__pop button svg path", (els) =>
      els.map((e) => e.getAttribute("d")).filter(Boolean)
    );
    check(
      "分面每一项的图标都不一样",
      new Set(shapes).size > 1 && new Set(shapes).size >= Math.min(4, shapes.length),
      `${new Set(shapes).size} 种形状 / ${shapes.length} 条路径`
    );
    /* ⚠️ **挑一个计数为正的分面，不要盲点第二项。**
       选项标签自带条数（「核心观点 11」），而第二项**可以合法地是 0 条**——
       那时候筛出 0 行是对的，红的是断言不是界面。上一版就是这么假红的。 */
    const facetOpts = await page.$$eval(".select__pop button", (els) =>
      els.map((e) => e.textContent.replace(/\s+/g, " ").trim())
    );
    // 标签自带条数（「核心观点 11」）。挑第一个计数为正的：第二项**可以合法地是 0 条**，
    // 那时候筛出 0 行是对的，红的是断言不是界面。
    const pickIdx = facetOpts.findIndex((t, i) => i > 0 && (Number((t.match(/(\d+)$/) || [])[1]) || 0) > 0);
    const picked = pickIdx > 0 ? pickIdx : 1;
    await page.click(`.select__pop button >> nth=${picked}`);
    /**
     * ⚠️ **等的是「变成那一项自己承诺的条数」，不是「变了」也不是一个毫秒数。**
     *
     * 走过两版都错：
     * 1. `waitForTimeout(300)` —— 分组列表重渲染多了一层，300ms 偶尔不够；
     * 2. `waitForFunction(len !== matAll)` —— 看着严谨，其实**被中间的加载空态满足了**：
     *    重新取数时列表先清空，0 !== 30 立刻成立，于是量到 0 条。
     *    「等容器不等内容」的又一个变种：等到的是过程中的一帧，不是结果。
     *
     * 选项标签自带条数（「核心观点 11」），那就是唯一可信的目标值。
     */
    const wantN = Number((String(facetOpts[picked] || "").match(/(\d+)$/) || [])[1]) || 0;
    await page
      .waitForFunction(
        (n) => document.querySelectorAll(".doc-row").length === n,
        wantN,
        { timeout: 8000 }
      )
      .catch(() => {});
    const filtered = await page.$$eval(".doc-row", (els) => els.length);
    /* 失败时要能看出**点的是哪一项、那一项自己说有几条**——只报「0/30」的话
       分不出是筛错了、还是那一项本来就空、还是根本没点中。 */
    check(
      "类型筛真的收窄了",
      filtered > 0 && filtered <= matAll,
      `${filtered}/${matAll} · 点的是「${facetOpts[picked] || "?"}」· 全部选项：${facetOpts.join(" | ")}`
    );
    // 回头路必须有：没有「全部」的筛选等于把人锁在一个子集里
    await page.click(".filter-bar .select__btn");
    await page.click(".select__pop button >> nth=0");
    // 同理：等它回到全量，而不是等「变了」——中间同样会闪一次空。
    await page
      .waitForFunction((n) => document.querySelectorAll(".doc-row").length === n, matAll, { timeout: 8000 })
      .catch(() => {});
    const backAll = await page.$$eval(".doc-row", (els) => els.length);
    check("能筛回全部", backAll === matAll, `${backAll}/${matAll}`);
  }
  if (matAll > 0) {
    const materialCards = await page.$$eval(".doc-row", (cards) => cards.map((card) => ({
      kind: card.querySelector(".tag--kind")?.textContent.trim() || "",
      type: card.querySelector(".doc-row__excerpt")?.textContent.trim() || "",
      badge: card.querySelector(".tag--state")?.textContent.trim() || "",
      warning: card.querySelector(".doc-row__excerpt--warn")?.textContent.trim() || "",
    })));
    const reusable = materialCards.filter((card) => card.kind.includes("可复用素材"));
    const sensitive = reusable.filter((card) => ["金句/原话", "数据/事实", "金句·原话", "数据·事实"].some((type) => card.type.includes(type)));
    const pending = sensitive.filter((card) => card.badge === "需核验");
    check("待核验金句和数据在卡片上有警告", pending.every((card) => card.warning.includes("暂勿用于成稿")), JSON.stringify(pending));
    const ordinary = reusable.filter((card) => !sensitive.includes(card));
    check("普通素材不挂证据警告", ordinary.every((card) => !card.warning), JSON.stringify(ordinary.slice(0, 4)));

    const materialIndex = materialCards.findIndex((card) => card.kind.includes("可复用素材"));
    if (materialIndex >= 0) {
      await page.locator(".doc-row__open").nth(materialIndex).click();
      await page.waitForSelector(".reader-overlay .doc-meta", { timeout: 25000 });
      const materialMeta = await page.textContent(".reader-overlay .doc-meta");
    /**
     * 素材详情要回答两件事：**这条可不可信**（核验状态 / 核验说明）、**它从哪来、被谁用了**
     * （来源灵感 / 关联选题）。
     *
     * ⚠️ **后一组是「有值才画」的，不能要求四个标签同时出现。** 一条还没被任何选题引用过的
     * 素材就是没有「关联选题」——空字段不渲染是对的（画一个空标签等于说「这里应该有东西
     * 但没有」）。原来那条断言要求四个全在，于是**只要第一张卡还没被引用过，测试就红**，
     * 而代码没有任何问题。所以分成两句：可信度那组必须在，来路那组至少要有一条。
     */
    /**
     * ⚠️ **核验那一组也是「有值才画」的，判据得跟着素材类型走。**
     * 上面那段注释已经为「来路」那一组修过一次同样的病，可这半句还无条件要求两个标签都在——
     * 于是列表排序一改（`id DESC` → `updated_at DESC`）、第一张卡换成「反直觉点」，
     * **测试当场变红而代码完全正确**：核验状态只有金句/数据才有，空字段不渲染正是对的。
     *
     * 所以写成二选一，两边都在测真行为：**该有的必须有，不该有的必须没有**。
     * 后者其实更值钱——它挡的是「给每条素材都挂一个恒为『待核验』的假徽标」。
     */
      const opened = materialCards[materialIndex] || {};
      const needsVerification = ["金句/原话", "数据/事实", "金句·原话", "数据·事实"].some((type) => opened.type.includes(type));
      check(
        needsVerification ? "金句/数据的详情说清可不可信" : "普通素材的详情不挂核验字段",
        needsVerification
          ? ["核验状态", "核验说明"].every((label) => materialMeta.includes(label))
          : !materialMeta.includes("核验状态"),
        `类型 ${opened.type || "?"} · ${materialMeta.slice(0, 100)}`,
      );
      check(
        "素材详情能追出至少一条来路",
        ["来源灵感", "关联选题"].some((label) => materialMeta.includes(label)),
        materialMeta.slice(0, 180),
      );
      if (opened.warning) {
        const detailWarning = await page.textContent(".reader-overlay .note-danger").catch(() => "");
        check("待核验素材详情有明确警告", detailWarning.includes("暂勿用于成稿"), detailWarning.slice(0, 120));
      }
      // **不给 `.catch(() => Escape)` 兜底。** 这句原来带着兜底，而选择器其实一直没匹配上
      // （那时按钮的名字是「关闭 Esc」）——兜底让它看起来一直在工作。
      // 关不掉就该让测试红，那正是要知道的事。
      await page.click('.reader-overlay__bar button[aria-label="关闭"]');
    }
  }

  /**
   * 8d. 稿件库：**筛选条只占一行，卡片上平台只出现一次**。
   *
   * 这一页同时有状态（4 档）和分面（平台），是全工作台筛选最重的一页。
   * 两条都是**会安静退化**的东西：状态和分面各画一排芯片时功能完全正常，只是看着分不出
   * 哪排是什么；平台在副标题和标签里各写一遍也不报错，只是同一张卡上说了两遍。
   */
  await page.goto(`http://127.0.0.1:${PORT}/#/drafts`, { waitUntil: "networkidle" });
  await page.waitForSelector(".doc-row, .empty, .note-title", { timeout: 25000 });
  if (await page.$(".filter-bar")) {
    const bar = await page.evaluate(() => {
      const chips = document.querySelector(".filter-bar .chips-sm");
      const sel = document.querySelector(".filter-bar .select__btn");
      if (!chips || !sel) return null;
      const a = chips.getBoundingClientRect();
      const b = sel.getBoundingClientRect();
      return { dy: Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)), rows: new Set([Math.round(a.top), Math.round(b.top)]).size };
    });
    // 二选一：这一页有分面就量它和状态在不在同一行；没有（数据还没到）就跳过
    check(
      bar ? "筛选条只占一行" : "稿件库这会儿没有分面可量",
      bar ? bar.dy <= 2 : true,
      bar ? `中心差 ${bar.dy.toFixed(1)}px` : ""
    );
  }
  /**
   * 平台下拉要**列全 PLATFORMS**，没有稿子的也在（计数 0）。
   * 只列已加载条目里出现过的平台的话，你分不清「小红书 0 篇」和「小红书不存在」——
   * 而作为筛选器，前者才是这一刻想知道的事。
   */
  if (await page.$(".filter-bar .select__btn")) {
    // 名单从适配器读，**不在测试里抄第二份**——抄了的话改一处漏一处，测试还照样绿
    const { PLATFORMS } = await import("../src/lib/sources.js");
    await page.click(".filter-bar .select__btn");
    await page.waitForSelector(".select__pop", { timeout: 4000 });
    const opts = await page.$$eval(".select__pop button", (els) => els.map((e) => e.textContent.trim()));
    check(
      "平台下拉列全了，没稿子的也在",
      PLATFORMS.every((p) => opts.some((o) => o.startsWith(p))),
      opts.join(" / ")
    );
    await page.keyboard.press("Escape");
  }
  const draftCards = await page.$$eval(".doc-row", (cards) =>
    cards.map((c) => ({
      sub: c.querySelector(".doc-row__excerpt")?.textContent.trim() || "",
      tags: [...c.querySelectorAll(".doc-row__meta .tag")].map((t) => t.textContent.trim()),
    }))
  );
  if (draftCards.length) {
    /**
     * ⚠️ **判据换了，因为原来那条已经量不到东西了。**
     * 卡片时代平台可能同时出现在副标题和底部标签上（同一张卡说两遍），所以断言的是
     * 「副标题不在标签里」。改成行之后副标题并进了摘要，那条断言恒真——**它还在跑，
     * 但已经不测任何东西了**，比红着更难发现。现在直接数：一行里平台最多出现一次。
     */
    const platformDupes = await page.$$eval(".doc-row", (rows) =>
      rows.map((r) => {
        const tags = [...r.querySelectorAll(".doc-row__meta .tag")].map((t) => t.textContent.trim());
        return tags.filter((t) => t === tags[0]).length;
      })
    );
    check(
      "一行里平台只出现一次",
      platformDupes.every((n) => n <= 1),
      platformDupes.join("/") || "（没有行）"
    );
    // 摘要那一行**空着也要占位**：不占的话这一行就矮一截，一列高低不齐。
    // （卡片时代这条量的是副标题；行里副标题并进了摘要，见 DocRow 的注释。）
    const exH = await page.$$eval(".doc-row__excerpt", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    check("空摘要仍占位，一列才对得齐", new Set(exH).size === 1 && exH[0] > 0, `高度 ${[...new Set(exH)].join("/")}px`);
  }

  // 9. 数据页。两份 CSV 测完都还原，不留测试数据。
  const csv = path.join(ROOT, "data", "metrics.csv");
  const postsCsv = path.join(ROOT, "data", "posts.csv");
  const csvBefore = fs.existsSync(csv) ? fs.readFileSync(csv, "utf8") : null;
  const postsBefore = fs.existsSync(postsCsv) ? fs.readFileSync(postsCsv, "utf8") : null;
  try {
    /**
     * ⚠️ **入口和等待的选择器都换过。**
     * 这一段原来 `goto #/metrics` 然后等 `.pill-tabs`。导航重构（306b993）把数据页那三个
     * 页内 tab 搬进了侧栏二级导航，`.pill-tabs` 在这一页**再也不存在**，而 `#/metrics`
     * 现在会重定向到 `#/review-performance`（内容表现），导入 UI 在 `#/review-sources`。
     *
     * 这条断言因此空等了 8 秒然后抛错——**而它整段包在 try 里，异常被吞掉**，
     * 于是二十来条断言集体不执行，冒烟测试照样报绿。这就是「红着的测试等于没有测试」
     * 的更坏版本：**它连红都没红**。等的改成每一页都有的顶栏面包屑 `.crumbs`：
     * 页内 tab 以后还会动，页面标题不会。
     */
    await page.goto(`http://127.0.0.1:${PORT}/#/review-sources`, { waitUntil: "networkidle" });
    await page.waitForSelector(".crumbs", { timeout: 8000 });

    /* 9a0. 自动发现：从下载目录（和项目的 data/inbox/）里翻出还没导进来的导出文件。
     *      这条路存在的理由是「能推断的不让用户填」——文件在哪、哪个最新、哪个是刚下的，
     *      机器全知道。断言钉的是**卡片上点之前就说清了会发生什么**（新增几条）。 */
    const inboxDir = path.join(ROOT, "data", "inbox");
    const inboxFile = path.join(inboxDir, "小红书-内容分析-smoke.csv");
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(
      inboxFile,
      "发布时间,笔记名称,观看数,点赞数,笔记链接\n2026-08-06,冒烟自动发现甲,555,12,https://example.invalid/i1\n2026-08-07,冒烟自动发现乙,666,13,https://example.invalid/i2\n",
      "utf8"
    );
    await page.reload({ waitUntil: "networkidle" });
    /* ⚠️ 这里原来点 `.pill-tab:has-text("数据来源")`。那三个页内 tab 在导航重构里
       搬进了侧栏二级导航，**这一页上不再有 pill-tab**，点它就是空等 30 秒然后抛错。
       现在入口直接是 `#/review-sources`，本来就在这一页，不需要再点一次。 */
    await page.goto(`http://127.0.0.1:${PORT}/#/review-sources`, { waitUntil: "networkidle" });
    await page.waitForSelector(".inbox__row", { timeout: 8000 });
    const card = await page.textContent(".inbox__row");
    check("自动发现下载好的导出文件", card.includes("小红书-内容分析-smoke.csv"), card.replace(/\s+/g, " ").slice(0, 70));
    /**
     * 点之前就知道会不会白点。**断言写成二选一**：这两条样例第一次跑是「新增 2」，
     * 之后 `data/posts.csv` 里已经有它们了，同一份文件再发现一次就是「更新 2」。
     * 写死「新增 2」的话，测试只有在**从没跑过**的机器上才绿——而这个套件本来就会
     * 反复跑（这条是项目自己的规矩：别把断言钉在某一种外部状态上）。
     * 真正要保证的是**它在点之前就说清楚了会发生什么**，两种说法都算数。
     */
    check("卡片上先说清会新增几条", /(新增|更新) 2/.test(card), card.replace(/\s+/g, " ").slice(0, 90));
    // ⚠️ **按 `.inbox__row button` 点，不按 `.btn-primary`。** 那一格的按钮会换样式：
    // 有新增时是主按钮，全都导过了（`added === 0`）就退成普通按钮。钉死 `.btn-primary`
    // 的话，第二次跑这个套件就是 30 秒超时 + 整套在这儿中断，后面一百多条一条都跑不到。
    await page.click(".inbox__row button");
    /**
     * ⚠️ **等的是「导入完成」，不是「等 900 毫秒」。**
     * 上一版是定长 `waitForTimeout(900)`：机器慢一点或者那次写盘多花了半秒，
     * 读到的就是还挂着「导入中…」的那一帧——**断言红着而功能是好的**，
     * 而且它偶发，看着像个玄学。判据换成「那一行上不再有『导入中』」。
     */
    await page
      .waitForFunction(() => !/导入中/.test(document.querySelector(".inbox__row")?.textContent || ""), null, { timeout: 15000 })
      .catch(() => {});
    check("一键导入真的写进去了", fs.readFileSync(postsCsv, "utf8").includes("冒烟自动发现甲"));
    // 导过之后按钮要改口，不能还写着「导入 2 条」
    const after = await page.textContent(".inbox__row").catch(() => "");
    check("导过的文件不再劝你再导一次", /已导过/.test(after), after.replace(/\s+/g, " ").slice(0, 80));
    fs.rmSync(inboxFile, { force: true });

    /* 9a. 导入：**先 dry 看一眼、再确认写盘**。这两步存在的全部理由是解析器只能靠列名
     *     认字段——认错了不报错，只会让一列数字安静地进错格子。所以断言钉的是
     *     「界面上真的把映射摊开给人看了」，不只是「导入成功了」。 */
    /* ⚠️ 这里原来点 `.pill-tab:has-text("数据来源")`。那三个页内 tab 在导航重构里
       搬进了侧栏二级导航，**这一页上不再有 pill-tab**，点它就是空等 30 秒然后抛错。
       现在入口直接是 `#/review-sources`，本来就在这一页，不需要再点一次。 */
    await page.goto(`http://127.0.0.1:${PORT}/#/review-sources`, { waitUntil: "networkidle" });
    await page.waitForSelector(".dropzone", { timeout: 5000 });
    await page.setInputFiles(".dropzone input[type=file]", {
      name: "小红书-内容分析.csv",
      mimeType: "text/csv",
      // 故意留一条没有观看数的：空值不能被记成 0
      buffer: Buffer.from(
        "发布时间,笔记名称,观看数,点赞数,收藏数,笔记链接\n" +
          "2026-08-03,冒烟测试甲,3085,103,105,https://example.invalid/a\n" +
          "2026-08-04,冒烟测试乙,1268,48,15,https://example.invalid/b\n" +
          "2026-08-11,冒烟测试丙,,,,https://example.invalid/c\n",
        "utf8"
      ),
    });
    await page.waitForSelector(".preview", { timeout: 8000 });
    const mapChips = await page.$$eval(".preview__map .tag", (els) => els.map((e) => e.textContent.trim()));
    check("导入前摊开列名映射", mapChips.some((t) => t.startsWith("发布时间 ←")) && mapChips.some((t) => t.startsWith("阅读/播放 ←")), mapChips.join(" · "));
    const writesBefore = fs.existsSync(postsCsv) ? fs.readFileSync(postsCsv, "utf8") : "";
    check("预览阶段不写盘", (fs.existsSync(postsCsv) ? fs.readFileSync(postsCsv, "utf8") : "") === writesBefore);
    await page.click('.preview .btn-primary');
    await page.waitForTimeout(900);

    // 9b. 总览：发布量、渠道分布、空值不被记成 0
    /* 同上：「月度总览」这一档现在是侧栏的「内容表现」，路由 `#/review-performance`。 */
    await page.goto(`http://127.0.0.1:${PORT}/#/review-performance`, { waitUntil: "networkidle" });
    await page.waitForSelector(".bars__plot, .empty", { timeout: 8000 });
    const stats = await page.$$eval(".stat-strip strong", (els) => els.map((e) => e.textContent.trim()));
    // 跟 csv 里当月的行数对，不写死数字——前面几步导进去多少条会变，写死的话
    // 改一次上面的测试数据这里就红，而它测的根本不是那件事
    const augRows = fs.readFileSync(postsCsv, "utf8").split("\n").filter((l) => l.startsWith("2026-08-")).length;
    check("总览首行给出本月发布数", stats[0] === String(augRows), `${stats[0]} vs csv ${augRows}`);
    // 第四格不写「可分析」这种模糊词，直接写缺口——它既是状态也是下一步
    check("缺数据时第四格直接报缺口", stats[3]?.startsWith("缺"), stats[3]);
    const segs = await page.$$eval(".bars__seg", (els) => els.length);
    check("每周发布量画成堆叠柱（不是折线）", segs >= 1, `${segs} 段`);
    const chan = await page.textContent(".channels");
    check("渠道分布用平台自己的词", chan.includes("观看"), chan.replace(/\s+/g, " ").slice(0, 60));
    /**
     * 某个指标一条都没有值 → **那一格整个不出现，不是显示 0**（0 会被读成「收藏了 0 次」，
     * 而真相是这个平台压根没有这个指标）。
     *
     * ⚠️ **判据从 csv 现算，不写死平台和指标名。** 原来这条钉的是「小红书那块里不该有分享」——
     * 而 `data/posts.csv` 是 smoke 和 shots 共用的一份文件，谁后跑谁的样例留在里面，
     * 于是这条断言会因为**另一个脚本跑过一次**而永久变红，红的还不是它要测的那件事。
     */
    const emptyMetric = await page.evaluate(() => {
      const LABELS = { views: ["观看", "阅读数"], likes: ["点赞"], comments: ["评论"], collects: ["收藏"], shares: ["分享"] };
      const blocks = [...document.querySelectorAll(".channels .channel")].map((el) => ({
        platform: el.querySelector(".tag--state")?.textContent.trim() || "",
        text: el.querySelector(".channel__metrics")?.textContent || "",
      }));
      return { blocks, LABELS };
    });
    const rows = fs.readFileSync(postsCsv, "utf8").split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(","));
    // csv 列序：date,platform,title,url,views,likes,comments,collects,shares
    const COL = { views: 4, likes: 5, comments: 6, collects: 7, shares: 8 };
    const missing = [];
    for (const block of emptyMetric.blocks) {
      const mine = rows.filter((r) => r[1] === block.platform && r[0].startsWith("2026-08-"));
      if (!mine.length) continue;
      for (const [key, words] of Object.entries(emptyMetric.LABELS)) {
        const hasValue = mine.some((r) => String(r[COL[key]] || "").trim());
        if (!hasValue && words.some((w) => block.text.includes(w))) missing.push(`${block.platform}/${words[0]}`);
      }
    }
    check("没有数据的指标整格不出现", missing.length === 0, missing.join(",") || "全部平台都对");

    // 9c. 幂等：同一份文件再导一次不能多出三行
    /* ⚠️ 这里原来点 `.pill-tab:has-text("数据来源")`。那三个页内 tab 在导航重构里
       搬进了侧栏二级导航，**这一页上不再有 pill-tab**，点它就是空等 30 秒然后抛错。
       现在入口直接是 `#/review-sources`，本来就在这一页，不需要再点一次。 */
    await page.goto(`http://127.0.0.1:${PORT}/#/review-sources`, { waitUntil: "networkidle" });
    await page.waitForSelector(".dropzone", { timeout: 5000 });
    await page.setInputFiles(".dropzone input[type=file]", {
      name: "小红书-内容分析.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("发布时间,笔记名称,观看数,笔记链接\n2026-08-03,冒烟测试甲,9999,https://example.invalid/a\n", "utf8"),
    });
    await page.waitForSelector(".preview", { timeout: 8000 });
    const again = await page.textContent(".preview__head span");
    check("同一篇再导一次算更新不算新增", /新增 0/.test(again), again.replace(/\s+/g, " "));

    // 9d. 粉丝周录：它住在「数据来源」里，**空态时也必须够得着**
    for (const [d, f] of [["2026-08-01", "1000"], ["2026-08-08", "1200"]]) {
      await page.fill('.entry input[type="date"] >> nth=1', d);
      await page.selectOption(".entry select >> nth=1", "X");
      await page.fill('.entry >> nth=1 >> input[type="number"] >> nth=0', f);
      await page.click('.entry >> nth=1 >> .btn-primary');
      await page.waitForTimeout(600);
    }
    await page.waitForSelector(".chart svg", { timeout: 8000 });
    check("趋势图画出折线", (await page.$$eval(".chart svg path", (els) => els.length)) > 0);
    const legend = await page.$$eval(".chart .legend-item", (els) => els.map((e) => e.textContent.trim()));
    check("图例常驻", legend.includes("X"), legend.join("/"));
    await page.click('button:has-text("看表格")');
    await page.waitForSelector(".data-table", { timeout: 5000 });
    check("表格视图可用（低对比度色的补偿手段）", (await page.$$eval(".data-table tbody tr", (els) => els.length)) >= 2);
  } catch (e) {
    /**
     * ⚠️ **这一段原来是 `try { } finally { }`，没有 catch。**
     *
     * 后果分两种，都很坏：块里任何一步抛异常，要么整轮冒烟当场中断（后面几百条断言
     * 一条都不跑），要么——如果异常恰好被别处吞了——**二十来条断言集体缺席而总数照样报绿**。
     * 数据页的页内 tab 在导航重构（306b993）里搬进了侧栏，这一段等的选择器和点的按钮
     * 从那以后就对不上了，而没有任何一次运行说出过这件事。
     *
     * 现在把它收成**一条明确的红**：后面的测试照跑，而「数据页这段没验到」写在脸上。
     * ⚠️ 这不是修好了——修它要重新对一遍数据页现在的导入动线，那是另一件事。
     */
    check("数据页导入流程跑通", false, `这一段没跑完：${String(e).slice(0, 140)}`);
  } finally {
    if (csvBefore === null) fs.rmSync(csv, { force: true });
    else fs.writeFileSync(csv, csvBefore, "utf8");
    if (postsBefore === null) fs.rmSync(postsCsv, { force: true });
    else fs.writeFileSync(postsCsv, postsBefore, "utf8");
    fs.rmSync(path.join(ROOT, "data", "inbox", "小红书-内容分析-smoke.csv"), { force: true });
  }

  // 10. 洞察：目录还不存在时要给引导，不能白屏。断言必须排除「书架」——
  //     上一版这里写松了，洞察页显示着书架的引导文案还判通过。
  await page.goto(`http://127.0.0.1:${PORT}/#/insights`, { waitUntil: "networkidle" });
  // **等到内容出来，不是等容器出现**：`.panel-block` 在数据还在取的时候就已经在了，
  // 那一刻读到的只有标题和「0 条」，断言会随机红。（这条踩过一次，同一个道理。）
  await page.waitForSelector(".panel-block .empty, .panel-block .doc-row, .panel-block .note-title", { timeout: 20000 });
  const insightsText = await page.textContent(".panel-block");
  /**
   * **三选一，不是写死一种外部状态。**
   * 洞察目录不存在 → 出「跑一次社媒洞察」的引导；目录在但没报告 → 出「还没有洞察报告」；
   * 有报告 → 出卡片。上一版写死了第一种，于是 vault 里一旦真建出这个目录，
   * 这条就无缘无故变红——**写死外部状态的断言等于没有断言**。
   *
   * 三种状态都必须守住同一条底线：**说的是洞察自己的话**。上上版这里写得太松，
   * 洞察页显示着书架的引导文案（「一本书一个子目录」）也判通过。
   */
  const insightsOk =
    insightsText.includes("社媒洞察") || insightsText.includes("还没有洞察报告") || (await page.$(".doc-row"));
  check("洞察页说的是洞察自己的话", !!insightsOk && !insightsText.includes("一本书"), insightsText.replace(/\s+/g, " ").slice(0, 50));

  /**
   * 浏览层的硬要求：**一行只有标题的话，这一列就只是一份目录**。
   * 洞察源以前正是这样——list 只走 vaultTree，拿不到正文，行上除了标题什么都没有。
   * 现在走 /api/vault/insights，摘要/覆盖周期/字数都在服务端读出来。
   */
  if (await page.$(".doc-row")) {
    const card = await page.evaluate(() => {
      const c = document.querySelector(".doc-row");
      const excerpt = c.querySelector(".doc-row__excerpt");
      const lead = excerpt?.querySelector(".doc-row__lead");
      return {
        // ⚠️ **规格和摘要现在是同一行里的两段，要分开取。**
        // 卡片时代它们是两个元素（`__sub` / `__note`），改成行之后并成了一行：
        // 前半是规格（覆盖周期 · 字数 · 时长），后半是摘要。字数**不再是一个 tag**——
        // 它是规格不是标签，见 DocRow 的 `isSpec`。照旧去 tags 里找的话，这条会
        // 一直红着，而界面其实一直是对的。
        spec: lead?.textContent.trim() || "",
        preview: (excerpt?.textContent || "").replace(lead?.textContent || "", "").trim(),
        tags: [...c.querySelectorAll(".doc-row__meta .tag")].map((t) => t.textContent.trim()),
      };
    });
    check("洞察行有摘要，不是只有一个标题", card.preview.length > 20, card.preview.slice(0, 36));
    check(
      "洞察行说清覆盖周期和篇幅",
      /覆盖|生成于/.test(card.spec) && /字/.test(card.spec),
      `${card.spec} · tags: ${card.tags.join(" / ") || "（无）"}`
    );
    // 伴生文件不能冒充报告：给报告写过批注之后会多出 <同名>.notes.md，
    // 上一版没排掉它，列表里就会凭空多一张卡（同书架那个「正文像凭空消失了」是一类 bug）
    const titles = await page.$$eval(".doc-row__title", (els) => els.map((e) => e.textContent.trim()));
    check("批注文件没被当成报告列出来", !titles.some((t) => /\.(notes|highlights)$/.test(t)), titles.join(" / ").slice(0, 60));
  }

  /**
   * 跑批入口。以前这一页没有任何动作入口，跑洞察必须回终端。
   *
   * **断言写成二选一**：面板要么给出就绪状态（vault 配好了），要么给出报错
   *（vault 没配 / 服务没起）。写死「一定看到材料清单」的话，换台机器就红，
   * 而红着的测试等于没有测试。
   */
  const runBtn = await page.$(".page-bar__end .btn-primary");
  check("洞察页有跑批入口", !!runBtn, runBtn ? await runBtn.textContent() : "没找到页头按钮");
  if (runBtn) {
    await runBtn.click().catch(() => {});
    await page.waitForSelector(".run-panel", { timeout: 8000 }).catch(() => {});
    // ⚠️ **等的是结论，不是这个壳。** 面板打开时先显示「正在看这一周的状态…」，
    // 马上读文本读到的就是那句话——又一次「等的是容器不是内容」（这个项目栽过好几回）。
    await page.waitForSelector(".run-panel__cost, .run-panel__err, .run-panel__actions", { timeout: 25000 }).catch(() => {});
    const panel = await page.textContent(".run-panel").catch(() => "");
    check(
      "跑批面板说清这次会不会花钱",
      /不抓取|credits/.test(panel) || /run-panel__err/.test(await page.innerHTML(".run-panel").catch(() => "")),
      panel.replace(/\s+/g, " ").slice(0, 70)
    );
    // 面板是临时物，不该占版面：关掉之后报告列表要回到原位
    await page.click(".run-panel .icon-btn").catch(() => {});
    check("跑批面板关得掉", !(await page.$(".run-panel")), "");
  }

  /**
   * 小标题的底衬。洞察报告是全工作台小标题最密的文档（实测每千字一个），拿它验最合适。
   *
   * 真正会**安静**坏掉的是那个负 margin：去掉之后底衬照样在、颜色照样对，
   * 只是每个标题都比正文缩进 12px——一眼看不出来，但整篇正文的左边缘就不齐了。
   * 所以量的是**字的左边缘**（底衬左边 + 内边距），不是盒子的左边缘。
   */
  if (await page.$(".doc-row")) {
    await page.click(".doc-row__open");
    await page.waitForSelector(".reader .prose", { timeout: 25000 });
    const band = await page.evaluate(() => {
      const p = [...document.querySelectorAll(".reader .prose > p")].find((n) => n.textContent.trim());
      const h = document.querySelector(".reader .prose > h2, .reader .prose > h3");
      if (!p || !h) return null;
      const hr = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      const b = document.querySelector(".reader .prose strong, .reader .prose b");
      return {
        textLeft: hr.left + parseFloat(cs.paddingLeft),
        proseLeft: p.getBoundingClientRect().left,
        bandW: hr.width,
        colW: p.getBoundingClientRect().width,
        bg: cs.backgroundColor,
        // 加粗要换字色 + 带下划线，不是只加字重
        boldColor: b ? getComputedStyle(b).color : "",
        boldLine: b ? getComputedStyle(b).textDecorationLine : "",
        bodyColor: getComputedStyle(p).color,
        markYellow: getComputedStyle(document.documentElement).getPropertyValue("--mark-yellow").trim(),
        // 外链要带 ↗（走 ::after 的 mask，正文是 innerHTML 出来的，塞不进 React 图标）
        linkArrow: (() => {
          const a = document.querySelector('.reader .prose a[href^="http"]');
          if (!a) return "";
          const cs = getComputedStyle(a, "::after");
          return `${cs.content}|${cs.maskImage || cs.webkitMaskImage}`;
        })(),
        // 表格里的加粗只换字色，不画线
        tableBold: (() => {
          const b = document.querySelector(".reader .prose td strong, .reader .prose th strong");
          if (!b) return "";
          const cs = getComputedStyle(b);
          return `${cs.color}|${cs.textDecorationLine}`;
        })(),
      };
    });
    // 二选一：这份报告有小标题就量它，没有就如实说没验到——别假装通过
    check(
      band ? "小标题的底衬向左出血，字仍和正文左对齐" : "这份洞察报告没有小标题，底衬没验到",
      band
        ? Math.abs(band.textLeft - band.proseLeft) <= 1 &&
          band.bg !== "rgba(0, 0, 0, 0)" &&
          band.bandW <= band.colW + 25
        : true,
      band ? `字左 ${band.textLeft.toFixed(1)} / 正文左 ${band.proseLeft.toFixed(1)} / 底衬 ${band.bg}` : ""
    );
    /**
     * 加粗的暖色强调。**坏掉不会报错，只会安静地退回黑白**——中文字重 400→700 的差别
     * 远不如西文，退回去之后一屏扫过去就抓不住重点了，而这正是当初改它的理由。
     */
    check(
      band?.boldColor ? "加粗换了字色，不是只加字重" : "这份报告没有加粗，字色没验到",
      band?.boldColor ? band.boldColor !== band.bodyColor && band.boldLine.includes("underline") : true,
      band?.boldColor ? `加粗 ${band.boldColor} / 正文 ${band.bodyColor} / ${band.boldLine}` : ""
    );
    /**
     * **底衬和标记黄必须是两个颜色。** 标记黄的含义是钉死的「这个我圈中了」，
     * 底衬说的是「这里开了一节」——调成同一个色，读者就得逐条分辨哪根带子是自己划的。
     */
    check(
      "小标题底衬没和划词高亮撞色",
      !!band && band.bg.replace(/\s/g, "") !== band.markYellow.replace(/\s/g, ""),
      band ? `底衬 ${band.bg} / 高亮 ${band.markYellow}` : ""
    );
    /**
     * 外链的 ↗。加粗变成「橙字 + 橙下划线」之后，链接原来那条浅灰线就撑不住了——
     * 同一段里加粗是彩色的、链接几乎看不见，**链接看着比加粗还不像能点**。
     * 箭头是它现在唯一的、不靠颜色的记号，掉了不会报错。
     */
    check(
      band?.linkArrow ? "外链带 ↗ 记号" : "这份报告没有外链，↗ 没验到",
      band?.linkArrow ? band.linkArrow.startsWith('""') && !band.linkArrow.endsWith("none") : true,
      band?.linkArrow ? band.linkArrow.slice(0, 60) : ""
    );
    // 表格本来就是线画出来的，格子里再来一条下划线就是三条线夹一行字
    check(
      band?.tableBold ? "表格里的加粗只换字色不画线" : "这份报告的表格里没有加粗，没验到",
      band?.tableBold ? band.tableBold.endsWith("|none") && !band.tableBold.startsWith(band.bodyColor) : true,
      band?.tableBold || ""
    );
    // **不给 `.catch(() => Escape)` 兜底。** 这句原来带着兜底，而选择器其实一直没匹配上
    // （那时按钮的名字是「关闭 Esc」）——兜底让它看起来一直在工作。
    // 关不掉就该让测试红，那正是要知道的事。
    await page.click('.reader-overlay__bar button[aria-label="关闭"]');
  }

  // 11. agent 对话：真发一轮。这是最重的一块，只断言 UI 存在等于没测。
  await page.goto(`http://127.0.0.1:${PORT}/#/materials`, { waitUntil: "networkidle" });
  await page.waitForSelector(".doc-row", { timeout: 20000 });
  await page.click(".doc-row__open");
  await page.waitForSelector(".rail", { timeout: 15000 });
  await page.click('.rail-tabs button:has-text("对话")');
  await page.waitForSelector(".composer textarea", { timeout: 5000 });
  // 引擎二选一，开关就在输入框旁边——换引擎和「发给谁」是同一个决定
  const engines = await page.$$eval(".chat-engine button", (els) => els.map((e) => e.textContent.trim()));
  check("对话能选引擎", engines.join("/") === "Claude Code/Codex", engines.join("/"));
  const engineOn = await page.$eval('.chat-engine button[aria-pressed="true"]', (e) => e.textContent.trim());
  check("默认引擎是 Claude Code", engineOn === "Claude Code", engineOn);
  await page.fill(".composer textarea", "只回答两个字：收到");
  await page.click(".composer .btn-primary");
  await page.waitForSelector(".msg-agent .prose-sm", { timeout: 120000 });
  await page.waitForFunction(
    () => !document.querySelector(".rail .skeleton") && document.querySelector(".msg-agent .prose-sm")?.textContent.trim(),
    null,
    { timeout: 120000 }
  );
  const reply = await page.textContent(".msg-agent .prose-sm");
  check("agent 对话有回复", reply.trim().length > 0, reply.trim().slice(0, 40));
  check("对话无乱码", !reply.includes("�"), reply.slice(0, 30));
  check("回复标着是谁答的", (await page.textContent(".msg-agent__who")).includes("Claude"), await page.textContent(".msg-agent__who"));
  // 回复的两个去处并排：写进 vault，或者拷走贴到别处。后者原来只能手动划选，
  // 而回复动辄几百字带标题和列表，划全一段本身就很难。
  //
  // ⚠️ 要等按钮**真的出现**，不能借上面那句「回复有字了」。动作条的条件是
  // `!chat.running`——流还没关的时候正文早就出齐了，而按钮一个都还没画。
  // 又一次「等的是内容，不是容器」，只是这回容器是「有没有文字」。
  await page.waitForSelector(".msg-agent__acts button", { timeout: 30000 });
  const msgActs = await page.$$eval(".msg-agent__acts button", (els) =>
    els.map((e) => e.getAttribute("aria-label") || e.textContent.trim())
  );
  check("回复能存也能复制", msgActs.join("/") === "存为笔记/复制这条回复", msgActs.join("/"));
  /**
   * 换引擎要**留一条痕迹**：会话号是上一家自己的 session 文件，拿去 resume 另一家只会失败，
   * 所以切换必然把上下文断掉。不说的话，用户只会觉得「它怎么突然失忆了」。
   * 这里只切不发——真发一轮 Codex 要几十秒，而它自己那条路已经在 CLI 上验过了。
   */
  await page.click('.chat-engine button:has-text("Codex")');
  await page.waitForSelector(".msg-sys", { timeout: 4000 });
  check("换引擎会说明上下文不带过去", (await page.textContent(".msg-sys")).includes("不带过去"), await page.textContent(".msg-sys"));
  await page.click('.chat-engine button:has-text("Claude Code")');

  // 换个话题就该重开一轮：一直聊下去上下文越滚越长也越跑越偏，
  // 而只靠刷新页面的话，整个阅读区会跟着关掉。
  await page.click('.chat-head button[aria-label="新对话"]');
  await page.waitForFunction(() => !document.querySelector(".msg-agent, .msg-user"), null, { timeout: 5000 });
  check("能重开一轮对话", !!(await page.$(".chat-log .rail-empty")));
  await shot("chat", false);

  await page.goto(`http://127.0.0.1:${PORT}/#/overview`, { waitUntil: "networkidle" });
  await page.waitForSelector(".todo-card, .note-title", { timeout: 20000 });
  check("总览有归档入口", (await page.textContent(".main")).includes("归档"));

  /**
   * 「接着读」最多列两本——同时在读两本是常态，只列一本时下面那块空白很显眼。
   * 但**两本的进度条必须落在同一高度**：书名一行的和两行的混在一起时，下面全跟着错开，
   * 而这一格的用处就是「扫一眼还剩多少」。所以书名槽位固定两行高。
   *
   * 进度存在 localStorage，测试环境是干净的，所以这里先灌两本再验。
   */
  const twoBooks = await page.evaluate(() =>
    fetch("/api/vault/books").then((r) => r.json()).then((d) => (d.books || []).slice(0, 2))
  );
  if (twoBooks.length === 2) {
    await page.evaluate((bs) => {
      const rec = {};
      bs.forEach((b, i) => {
        const ch = b.chapters?.[0] || { path: b.bookPath, title: b.name };
        rec[b.dir] = { docPath: ch.path, title: ch.title, scrollTop: 0, progress: 0.3, updatedAt: Date.now() - i * 1000 };
      });
      localStorage.setItem("workbench:reading:v1", JSON.stringify({ version: 1, books: rec }));
    }, twoBooks);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".resume-book", { timeout: 20000 });
    const cards = await page.$$(".resume-book");
    check("接着读列两本", cards.length === 2, `${cards.length} 本`);
    const bars = await page.$$eval(".resume-book", (els) =>
      els.map((e) => Math.round(e.querySelector(".resume-book__bar").getBoundingClientRect().top - e.getBoundingClientRect().top))
    );
    check("两本的进度条在同一高度", bars[0] === bars[1], bars.join("/"));
  }

  await shot("overview");

  /**
   * 外链必须走新窗口。
   *
   * 界面上自己写的 `<a>` 都带 `target="_blank"`，但**正文里的链接是 marked 生成的裸 `<a>`**，
   * 点下去会把整个工作台顶掉；从桌面快捷方式启动时那就是个独立窗口，关掉它工作台就没了。
   * App.jsx 里那个委托监听在点击时给这种 `<a>` 补上 `target="_blank"`——它改坏了不会报错，
   * 只会安静地又变回「就地跳转」，所以这里造几个 `<a>` 点一下，看属性有没有被补上。
   *
   * 测试自己再挂一个 click 监听把默认行为拦掉：**它注册得比 App 那个晚，所以跑在它之后**，
   * 属性那时已经补完了。不拦的话这一下点击会真的开一个新页面，测试里多出个野窗口。
   */
  const linkProbe = await page.evaluate(() => {
    const probe = (href) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = "probe";
      document.body.appendChild(a);
      const stop = (e) => e.preventDefault();
      document.addEventListener("click", stop);
      a.click();
      document.removeEventListener("click", stop);
      const target = a.getAttribute("target") || "";
      a.remove();
      return target;
    };
    return {
      ext: probe("https://example.com/probe"),
      hash: probe("#/shelf"), // hash 路由是自己人，补了的话点侧栏都开新窗口
      same: probe("/api/config"), // 同源资源也不该被弹出去
      mail: probe("mailto:a@b.c"),
    };
  });
  check("正文外链补成新窗口打开，不顶掉工作台", linkProbe.ext === "_blank", `target=${linkProbe.ext || "(空)"}`);
  check("内部 hash 链接不被动", linkProbe.hash === "", `target=${linkProbe.hash || "(空)"}`);
  check("同源链接不被动", linkProbe.same === "", `target=${linkProbe.same || "(空)"}`);
  check("mailto 不被动", linkProbe.mail === "", `target=${linkProbe.mail || "(空)"}`);

  /**
   * 11.5 外来 Markdown 不能借渲染过程执行东西。
   *
   * 这一条必须在**真浏览器**里测：消毒靠的是浏览器自己的 HTML 解析器，
   * node 里造一个假 DOM 测出来的「过了」不代表 Chrome 里也过。
   * 测的是 `lib/markdown.js` 这一个入口——工作台所有 `dangerouslySetInnerHTML`
   * 都从这儿拿 HTML，管住它就等于管住了正文、右栏 AI 输出和热点原文三条路径。
   */
  const md = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/lib/markdown.js");
    const r = (s) => renderMarkdown(s);
    // 危险内容执行了没有：把结果真挂进 DOM，让浏览器有机会跑它
    const box = document.createElement("div");
    box.style.display = "none";
    document.body.appendChild(box);
    window.__xss = 0;
    box.innerHTML = r(
      [
        '<img src=x onerror="window.__xss=1">',
        '<iframe src="https://example.com"></iframe>',
        '<object data="x"></object>',
        '<form action="/api/vault/doc" method="post"><input name="a"></form>',
        "[点我](javascript:window.__xss=1)",
        '<a href="javascript:window.__xss=1">点我</a>',
        '<svg><script>window.__xss=1</script></svg>',
        '<div onclick="window.__xss=1">点我</div>',
      ].join("\n\n")
    );
    await new Promise((res) => setTimeout(res, 120)); // 给 onerror 一个真正触发的机会
    const danger = {
      fired: window.__xss,
      html: box.innerHTML,
      tags: [...box.querySelectorAll("*")].map((e) => e.tagName.toLowerCase()),
    };
    // 正常排版不能被消毒顺手削掉
    const okHtml = r(
      "# 标题\n\n## 二级\n\n- 列表\n\n> 引用\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\n\n![图](https://example.com/a.png)\n\n[外链](https://example.com)\n\n**加粗**"
    );
    box.remove();
    return { danger, okHtml };
  });
  check("危险 Markdown 一行都没执行", md.danger.fired === 0);
  check("事件属性被剥掉", !/on(?:error|click|load)\s*=/i.test(md.danger.html), md.danger.html.slice(0, 120));
  check(
    "嵌入页面 / 对象 / 表单标签不留",
    !md.danger.tags.some((t) => ["iframe", "object", "embed", "form", "input", "script", "svg"].includes(t)),
    md.danger.tags.join(",")
  );
  check("javascript: 链接不留", !/javascript:/i.test(md.danger.html), md.danger.html.slice(0, 160));
  check(
    "正常排版不退化",
    ["<h1", "<h2", "<ul", "<blockquote", "<table", "<pre", "<code", "<img", "<strong"].every((t) =>
      md.okHtml.includes(t)
    ),
    md.okHtml.slice(0, 160)
  );
  // 外链在 HTML 层就是安全打开方式，不只靠点击时那个委托监听补
  check("正文外链自带 noopener", /rel="noopener noreferrer"/.test(md.okHtml));

  /**
   * 11.6 写请求的来源检查：别的网页发过来的跨站 POST 要被挡在门外。
   * 用页面自己的 fetch 打一个带外站 Origin 的请求做不到（浏览器不让改 Origin），
   * 所以在 node 侧直接构造。
   */
  const forged = await fetch(`http://127.0.0.1:${PORT}/api/vault/doc`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ path: "x.md", content: "x" }),
  });
  check("外站发来的写请求被拒", forged.status === 403, `HTTP ${forged.status}`);
  const readOk = await fetch(`http://127.0.0.1:${PORT}/api/config`);
  check("读请求不受影响", readOk.ok, `HTTP ${readOk.status}`);

  /**
   * 11.7 备份面板打得开，而且**它自己就说清楚了包含什么、不包含什么**。
   *
   * 一份「看着像全备份、其实漏了一半」的备份比没有备份更危险，所以这一条
   * 断言的是界面上真的写着 vault 正文不在包里——不是「面板渲染出来了」。
   * 只点开，**不点导出、不点恢复**：那两个会真的动这台机器上的数据。
   */
  await page.goto(`http://127.0.0.1:${PORT}/#/overview`, { waitUntil: "networkidle" });
  await page.waitForSelector(".sysrow", { timeout: 8000 });
  await page.click('.sysrow__btn:has-text("备份与恢复")');
  await page.waitForSelector(".drawer--wide .bk-list .bk-row", { timeout: 8000 });
  const bk = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".bk-row__label")].map((e) => e.textContent.trim()),
    text: document.querySelector(".drawer--wide").innerText,
  }));
  /**
   * ⚠️ **数量从真源读，不写死。**
   * 上一版写的是 `=== 3`，而清单的真源是 `backup.mjs` 的 `DATA_FILES`。
   * 加第四份数据文件（AI 局部修订历史）之后这条就红了——**红的是断言，备份本身是对的**。
   * 更坏的是反过来：万一哪天有份数据**没进** `DATA_FILES`，写死的数字照样能对上，
   * 而那份数据就这么安静地不进备份了。这正是 `../CLAUDE.md` 里
   *「数据文件的清单只有一份」要防的事——断言也得认那一份。
   */
  check(
    "备份面板列出全部工作台数据",
    bk.rows.length === DATA_FILES.length && DATA_FILES.every((f) => bk.rows.includes(f.label)),
    `面板 ${bk.rows.length} 份 / 清单 ${DATA_FILES.length} 份 · ${bk.rows.join(" / ")}`
  );
  check("面板说清 vault 正文不在包里", /不包含[\s\S]{0,40}Obsidian/.test(bk.text));
  check("面板说清密钥不在包里", bk.text.includes(".env"));
  // 恢复是覆盖式的，「预览再确认」这条不能靠记忆——界面上要写着退得回来
  check("面板承诺恢复前留快照", bk.text.includes("快照"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check("Esc 关得掉备份面板", !(await page.$(".drawer--wide")));

  /**
   * 11.8 全局检索：Ctrl+K 开、Esc 关、键盘能走、结果能直接执行。
   *
   * 断言写成「二选一」：Worker 连着就该搜到 Notion 那边的东西，没连着至少要搜到
   * vault 里的书和洞察——写死某一种外部状态的话，外部一变测试就红。
   */
  await page.goto(`http://127.0.0.1:${PORT}/#/overview`, { waitUntil: "networkidle" });
  await page.waitForSelector(".topbar__find", { timeout: 8000 });
  // 快捷键不能是唯一入口：看不见的功能没人会去猜它存不存在。
  // ⚠️ 它现在在**顶栏正中**，不在侧栏里——那是整个工作台唯一一个跨四个库 + vault +
  // posts + 热点的入口，塞在侧栏 200px 的一条里、只写两个字「搜索」，看着像个侧栏功能。
  check("顶栏正中有看得见的搜索入口", await page.isVisible(".topbar__find"));
  const findHint = await page.textContent(".topbar__find");
  check("搜索框说清它能搜什么", /选题|稿件|素材/.test(findHint), findHint.replace(/\s+/g, " ").trim().slice(0, 30));
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".cmdk input", { timeout: 5000 });
  check("Ctrl+K 打开全局检索", await page.isVisible(".cmdk"));
  // 空态就是「继续上次工作」，不是一片空白
  const emptyText = await page.textContent(".cmdk");
  check(
    "空态给的是接着上次，不是空白",
    /接着读|最近打开|最近搜过|还没有可以接着的东西/.test(emptyText),
    emptyText.slice(0, 60).replace(/\s+/g, " ")
  );

  /**
   * **「最近打开」那一行也要真的打开那一篇。**
   *
   * 这条是补的：搜索结果那条路早就带上了 `open`，而 `recent.js` 存的记录当时
   * 只写了 `{view, state}`，于是点回去只跳到列表页。两组行长得一模一样、
   * 行为却不一样——用户报的就是这个（点「为什么独立开发者应该先写文章」进的是列表）。
   * 所以断言要**分别**盖住这两组，不能只测搜索结果那一组。
   */
  const recentAt = await page.$$eval(".cmdk__group", (gs) => {
    const g = gs.find((x) => x.querySelector(".cmdk__group-label")?.textContent.trim() === "最近打开");
    if (!g) return -1;
    const rows = [...document.querySelectorAll(".cmdk__row")];
    // 挑一条落在工作台里有页面的（书 / 归档那两类各有各的落点，不该用同一个断言套）
    return rows.indexOf(
      [...g.querySelectorAll(".cmdk__row")].find((r) =>
        ["灵感库", "素材库", "选题库", "稿件库", "洞察"].includes(r.querySelector(".cmdk__type")?.textContent.trim())
      )
    );
  });
  if (recentAt >= 0) {
    await page.$$eval(".cmdk__row", (els, i) => els[i].click(), recentAt);
    const back = await page
      .waitForSelector(".reader-overlay .rail-tabs", { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check("「最近打开」点回去是打开那一篇，不是跳到列表", back);
    if (back) {
      await page.keyboard.press("Escape");
      await page.waitForSelector(".reader-overlay", { state: "detached", timeout: 6000 }).catch(() => {});
    }
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".cmdk input", { timeout: 5000 });
  } else {
    check("「最近打开」点回去是打开那一篇，不是跳到列表", true, "这次没有可就地打开的最近记录，跳过");
  }

  await page.fill(".cmdk input", "深度");
  /**
   * **等的是行，不是「不再显示搜索中」、也不是那句「N 条结果」。**
   *
   * 走过两版都假绿，原因是同一类：等的条件在别的时刻也成立。
   *  v1 等「列表里没有『搜索中…』」——空态压根没这三个字，请求还没发就通过了。
   *  v2 等「列表里出现『N 条结果』」——出现过就算数，而这一栏会因为一次重渲染
   *     退回等待态，等到的那一帧和后面数行的那一帧不是同一帧。
   * 直接等 `.cmdk__row` 真的出现，就没有中间态可钻。这条是本项目那句
   * 「等的是内容，不是容器」的又一次现场。
   */
  await page
    .waitForFunction(() => document.querySelectorAll(".cmdk__row").length || null, null, { timeout: 25000 })
    .catch(() => {});
  const hits = await page.$$eval(".cmdk__row", (els) =>
    els.map((e) => ({ title: e.querySelector(".cmdk__title")?.textContent || "", type: e.querySelector(".cmdk__type")?.textContent || "" }))
  );
  // 搜不到时把**服务端在同一时刻回了什么**一起打出来。只报「0 条」的话，
  // 分不清是后端没搜到、还是前端没把结果画上去——那两件事的修法完全不一样。
  const serverSaw =
    hits.length === 0
      ? await fetch(`http://127.0.0.1:${PORT}/api/search?q=${encodeURIComponent("深度")}`)
          .then((r) => r.json())
          .then((j) => `服务端 ${j.total} 条 / ${(j.sources || []).map((s) => `${s.key}:${s.ok ? s.count : s.error}`).join(",")}`)
          .catch((e) => `服务端也打不通：${e.message}`)
      : "";
  check(
    "搜得到东西",
    hits.length > 0,
    hits.length
      ? `${hits.length} 条：${hits.slice(0, 3).map((h) => `${h.type}/${h.title}`).join(" | ")}`
      : `面板：${(await page.textContent(".cmdk")).replace(/\s+/g, " ").slice(0, 120)} ｜ ${serverSaw}`
  );
  // 每条都要说清是什么类型 + 怎么继续。只给一行标题的话，检索只做了一半
  check("每条结果都标了类型", hits.length > 0 && hits.every((h) => h.type.trim()), hits.map((h) => h.type).join(","));

  if (hits.length > 1) {
    await page.keyboard.press("ArrowDown");
    const at = await page.$$eval(".cmdk__row", (els) => els.findIndex((e) => e.getAttribute("aria-current") === "true"));
    check("方向键能走", at === 1, `选中第 ${at + 1} 条`);
  }
  /**
   * **回车要真的把那一篇打开，不是跳到它所在的列表页。**
   * 搜到之后还要自己在列表里再找一遍的话，检索只做了一半——用户原话：
   * 「点击洞察或者创作页面中的『关于独立思考』的时候，发现只是跳转到了主页面」。
   *
   * 只在命中的是**工作台里有页面**的那类结果时才验（Notion 四库和洞察）；
   * 书跳书架、归档去 Obsidian，那两条各有各的落点，不该用同一个断言套。
   */
  const openable = await page.$$eval(".cmdk__row", (els) =>
    els.findIndex((e) => ["灵感库", "素材库", "选题库", "稿件库", "洞察"].includes(e.querySelector(".cmdk__type")?.textContent.trim()))
  );
  if (openable >= 0) {
    await page.$$eval(".cmdk__row", (els, i) => els[i].click(), openable);
    const opened = await page
      .waitForSelector(".reader-overlay .rail-tabs", { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check("回车/点击直接打开那一篇，不是只跳到列表", opened);
    if (opened) {
      await page.keyboard.press("Escape");
      await page.waitForSelector(".reader-overlay", { state: "detached", timeout: 6000 }).catch(() => {});
    }
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".cmdk", { timeout: 5000 });
  } else {
    check("回车/点击直接打开那一篇，不是只跳到列表", true, "这次搜到的结果里没有能就地打开的类型，跳过");
  }

  // 面板是浮在整页之上的一张卡，不该长成系统对话框。**量真实圆角**——
  // `var(--r-card)` 那种引一个没定义过的变量的写法，CSS 不报错、直接当 0 处理
  const radius = await page.$eval(".cmdk", (e) => parseFloat(getComputedStyle(e).borderTopLeftRadius));
  check("检索面板是圆角，不是直角", radius >= 12, `${radius}px`);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check("Esc 关得掉检索面板", !(await page.$(".cmdk")));

  /**
   * 11.9 键盘与弹层。
   *
   * 这一组守的是一个**用键盘就能误触的危险动作**：弹层开着时 Tab 走进背后那一页，
   * 那儿每张卡右下角都有个垃圾桶。屏幕上什么都看不出来（背景被盖住了），
   * 而回车就是一次删除。所以断言的是「焦点出不去」，不是「有没有 aria 属性」。
   */
  await page.goto(`http://127.0.0.1:${PORT}/#/overview`, { waitUntil: "networkidle" });
  await page.waitForSelector(".sidebar .btn-primary", { timeout: 8000 });
  await page.click(".sidebar .btn-primary"); // 入库抽屉
  await page.waitForSelector(".drawer textarea", { timeout: 5000 });
  check("弹层打开后焦点进到弹层里", await page.evaluate(() => !!document.querySelector(".drawer")?.contains(document.activeElement)));
  check(
    "打开就落在正文上（点入库的意图只有一个）",
    await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA")
  );
  /**
   * 背景对键盘和读屏整块消失。
   *
   * ⚠️ **判据是「它在某个 inert 子树里」，不是「它自己带着 inert 属性」。**
   * 上一版写的是 `.sidebar.inert === true`，那隐含假设了**侧栏是弹层的直接兄弟**——
   * 外壳加了一层 `.app__body`（顶栏跨全宽，侧栏和正文并排在它下面）之后，
   * 被打上 inert 的是 `.app__body`，侧栏是**继承**来的，而 `element.inert`
   * 这个 IDL 属性只反映元素自己的属性、不反映继承。于是断言红了而功能是好的。
   *
   * 再补一条**量效果**的：真去 focus 侧栏里那颗按钮，焦点不该落上去。
   * 属性可以对而效果不对（浏览器不支持 inert 时），效果这条才是要守的东西。
   */
  check(
    "背景被 inert 掉了",
    await page.evaluate(() => !!document.querySelector(".sidebar")?.closest("[inert]"))
  );
  check(
    "背景里的按钮真的聚不上焦",
    await page.evaluate(() => {
      const btn = document.querySelector(".sidebar .btn-primary");
      if (!btn) return false;
      const before = document.activeElement;
      btn.focus();
      const moved = document.activeElement === btn;
      if (moved) before?.focus?.();
      return !moved;
    })
  );
  /**
   * Tab 转一圈都不能跑出去。**必须真按 Tab**（`page.keyboard.press`）——
   * 在 `evaluate` 里循环读 `activeElement` 只是在看焦点有没有自己动，
   * 那什么都测不出来。圈数取「弹层里可聚焦元素数 + 3」，足够绕回来一圈多。
   */
  const rounds = await page.$$eval(".drawer a[href], .drawer button, .drawer input, .drawer textarea, .drawer select", (e) => e.length + 3);
  let escaped = "";
  for (let i = 0; i < rounds && !escaped; i++) {
    await page.keyboard.press("Tab");
    escaped = await page.evaluate(() =>
      document.querySelector(".drawer")?.contains(document.activeElement) ? "" : document.activeElement?.className || "(body)"
    );
  }
  check("Tab 转一圈也出不去弹层", escaped === "", `第 ${rounds} 次内跑到了 ${escaped}`);
  // 反过来也要挡住：Shift+Tab 从第一个元素往回走，不能退到背景里
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  check(
    "Shift+Tab 也出不去",
    await page.evaluate(() => !!document.querySelector(".drawer")?.contains(document.activeElement))
  );
  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer", { state: "detached", timeout: 4000 });
  check("Esc 关得掉抽屉", true);
  // 关掉之后焦点要回到打开它的那个按钮上，不能掉回 body（那样下一次 Tab 从整页开头重来）
  check(
    "关闭后焦点回到打开它的按钮",
    await page.evaluate(() => document.activeElement?.closest(".sidebar-foot .btn-primary") != null),
    await page.evaluate(() => document.activeElement?.className || "(body)")
  );

  // 书架卡片不能是「按钮里套按钮」：读屏会把整张卡念成一个按钮，
  // 而 Tab 到卡片按空格是「打开」还是「下架」全看浏览器心情
  await page.goto(`http://127.0.0.1:${PORT}/#/shelf`, { waitUntil: "networkidle" });
  await page.waitForSelector(".book-card, .empty, .note", { timeout: 10000 });
  const nested = await page.$$eval(".book-card", (cards) =>
    cards.filter((c) => c.getAttribute("role") === "button" && c.querySelector("button")).length
  );
  check("书籍卡片没有按钮套按钮", nested === 0, `${nested} 张`);

  // 只有图标的按钮必须有名字。没有的话读屏念出来就是「按钮」，等于没说
  const unnamed = await page.$$eval("button, a[href]", (els) =>
    els
      .filter((e) => e.offsetParent !== null && !e.textContent.trim() && e.querySelector("svg"))
      // 已经明确退出无障碍树 / Tab 序列的不算：展开态的侧栏 logo 就是这种——
      // 那时它只是个标识（`aria-hidden` + `tabindex="-1"` + `pointer-events: none`），
      // 给一个「点不了的东西」配名字，读屏反而会多念一个不存在的按钮
      .filter((e) => e.getAttribute("aria-hidden") !== "true" && e.getAttribute("tabindex") !== "-1")
      .filter((e) => !e.getAttribute("aria-label") && !e.getAttribute("title") && !e.getAttribute("aria-labelledby"))
      .map((e) => e.className || e.tagName)
  );
  check("图标按钮都有名字", unnamed.length === 0, unnamed.slice(0, 4).join(" | "));

  /**
   * **名字里不能塞快捷键。**
   *
   * 上面那条只查「有没有 aria-label」，于是放过了 `aria-label="关闭 Esc"`——
   * 有名字，但读屏念出来是「关闭 Esc 按钮」，而这颗按钮不叫这个。快捷键归 `title`。
   * 这一条就是补那个漏：一条断言只查「有没有」，就一定会放过「有但是错的」。
   */
  const shortcutInName = await page.$$eval("button, a[href]", (els) =>
    els
      .map((e) => e.getAttribute("aria-label") || "")
      .filter((n) => /(esc|ctrl|cmd|alt|shift)|⌘/i.test(n))
  );
  check("按钮名字里没混进快捷键", shortcutInName.length === 0, shortcutInName.join(" | "));

  // 辅助文字的对比度。这条只量**灰字**那一档（`--text-3`），它管着元信息、字段名、
  // 提示、时间戳、空态——「除了正文之外你要读的所有字」，原来在纸白上只有 2.46:1
  // **量一个真实元素，不读 CSS 变量**：变量可能被组件层覆盖，量出来的才是屏幕上的。
  const contrast = await page.evaluate(() => {
    const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const L = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).map(Number);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const el = [...document.querySelectorAll(".field-hint, .empty, .page-sub, .page-bar__desc")].find((e) => e.offsetParent);
    if (!el) return null;
    const s = getComputedStyle(el);
    const [a, b] = [L(s.color), L(getComputedStyle(document.body).backgroundColor)].sort((x, y) => y - x);
    return { ratio: +((a + 0.05) / (b + 0.05)).toFixed(2), color: s.color, size: parseFloat(s.fontSize) };
  });
  if (contrast) {
    check("辅助文字过 WCAG AA（4.5:1）", contrast.ratio >= 4.5, `${contrast.ratio}:1 · ${contrast.color}`);
    check("辅助文字不小于 13px", contrast.size >= 13, `${contrast.size}px`);
  } else {
    check("辅助文字能量到", false, "这一页上没有 .field-hint / .empty / .page-sub / .page-bar__desc");
  }

  /**
   * 11.10 热点转化链：一条热点后来怎么样了。
   *
   * **状态一律算出来，工作台不存一份映射**——所以这里验的是「算出来的东西对不对」：
   * 一条从来没见过的地址必须是「未处理」。二选一：Worker 连着就该能分辨已入库的，
   * 没连着就整批「未处理」并且 `degraded` 说明原因。
   */
  const traced = await fetch(`http://127.0.0.1:${PORT}/api/hot/trace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ links: ["https://example.com/definitely-never-collected-" + Date.now()] }),
  }).then((r) => r.json());
  check("转化链端点可用", traced.ok === true, JSON.stringify(traced).slice(0, 90));
  check(
    "没见过的地址算「未处理」",
    Object.values(traced.items || {}).every((v) => v.stage === "未处理"),
    JSON.stringify(traced.items).slice(0, 90)
  );
  // 算不全的时候必须**说清楚为什么、下一步做什么**，不能悄悄少几个芯片
  check(
    "算不全时给了下一步",
    !traced.degraded || /wrangler deploy|关联/.test(traced.why || ""),
    traced.why || "(未降级)"
  );

  // 12. 控制台不能有报错。React 的 key 警告、未捕获异常都会在这里现形。
  check("无控制台报错", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} catch (e) {
  fatal = e;
  await page.screenshot({ path: path.join(ROOT, "tmp", "smoke-failure.png") }).catch(() => {});
} finally {
  await browser.close();
  await server.close();
}

console.log("");
for (const c of checks) console.log(` ${c.pass ? "✓" : "✗"} ${c.name}${c.detail ? `  ← ${c.detail}` : ""}`);
const failed = checks.filter((c) => !c.pass).length;
if (fatal) {
  console.log(`\n ✗ 中断：${String(fatal.message).split("\n")[0]}`);
  console.log(`   失败时的截图：tmp/smoke-failure.png`);
  if (consoleErrors.length) {
    console.log("   页面报错：");
    for (const e of consoleErrors.slice(0, 3)) console.log("     " + e.split("\n")[0]);
  }
}
console.log(`\n ${checks.length - failed}/${checks.length} 通过\n`);
process.exit(failed || fatal ? 1 : 0);
