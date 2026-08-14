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
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const shot = (name, full = true) => page.screenshot({ path: path.join(ROOT, "tmp", `smoke-${name}.png`), fullPage: full });

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });

  // 1. 渲染了，不是白屏
  await page.waitForSelector(".brand-name", { timeout: 8000 });
  check("界面渲染", (await page.textContent(".brand-name")) === "Xenho OS");

  // 2. 侧栏是一天的动线：看外面 → 做内容 → 发出去 → 看反馈。
  //    流水线四段**不占四个侧栏项**，它们是「创作」页内的 tab。
  const nav = await page.$$eval(".nav-item", (els) => els.map((e) => e.textContent.replace(/\d+$/, "").trim()));
  check(
    "侧栏按一天的动线排",
    nav.join("/") === "总览/热点/创作/洞察/书架/排版/数据",
    nav.join("/")
  );
  check("标签一律两个字", nav.every((n) => n.length === 2), nav.join("/"));

  /**
   * 侧栏能收起，而且**记得住**。
   *
   * 收起态只剩一列图标：文字是 `display:none` 而不是换一套 DOM——同一批节点两种形态，
   * 加一个导航项才不会要改两处。**测完必须展开回去**：后面几段用的是
   * `.nav-item:has-text("创作")` 这种按文字点的选择器，收起态下文字不可见，一点就超时。
   */
  await page.click(".rail-toggle");
  await page.waitForTimeout(250);
  const railW = await page.$eval(".sidebar", (e) => Math.round(e.getBoundingClientRect().width));
  check("收起后只剩一列图标的宽度", railW <= 64, `${railW}px`);
  check("收起后文字不占位", (await page.$eval(".nav-item", (e) => e.innerText.trim())) === "", await page.$eval(".nav-item", (e) => e.innerText));
  check("收起后图标还在", (await page.$$(".nav-item .nav-icon")).length === 7);
  // 收起后收放按钮让位给 logo：60px 一条里摆两个方块太挤，而 logo 已经在最顺手的位置
  check("收起后收放按钮不出现", !(await page.isVisible(".rail-toggle")));
  // logo 要和下面那一列图标块等宽：小一圈的话它看着像还没加载完，左右边缘也连不成一条竖线
  const [logoW, itemW] = await page.evaluate(() => [
    Math.round(document.querySelector(".brand-mark").getBoundingClientRect().width),
    Math.round(document.querySelector(".nav-item").getBoundingClientRect().width),
  ]);
  check("收起态 logo 和导航项等宽", Math.abs(logoW - itemW) <= 2, `${logoW} vs ${itemW}`);
  // 角标退成一颗点：60px 里放不下数字，而「这儿有没有事」才是这一刻要回答的
  const dotOk = await page.evaluate(() => {
    const d = document.querySelector(".nav-item__dot");
    return !d || getComputedStyle(d).display !== "none";
  });
  check("角标退成一颗点", dotOk);
  /**
   * 收起态的搜索**只剩一个图标，不要容器**。
   *
   * 展开态那个方框有用（让「搜索」看起来像输入框）；收起后框里只剩一个放大镜，
   * 而放大镜本身就是全世界都认得的记号，框不再解释任何东西，只是在一列**没有框**的
   * 图标上面多出一个有框的——看着像它和下面那些不是一类东西。
   */
  const findBox = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".rail-find"));
    const nav = getComputedStyle(document.querySelector(".nav-item"));
    return { border: cs.borderTopColor, bg: cs.backgroundColor, r: cs.borderTopLeftRadius, navR: nav.borderTopLeftRadius };
  });
  check(
    "收起态搜索没有容器",
    /(, ?0\)|transparent)$/.test(findBox.border) && /(, ?0\)|transparent)$/.test(findBox.bg),
    `边框 ${findBox.border} / 底色 ${findBox.bg}`
  );
  check("收起态搜索的圆角和导航项一致", findBox.r === findBox.navR, `${findBox.r} vs ${findBox.navR}`);

  /**
   * 收起态下**设置入口不能消失**：它是「工作台没配好」时唯一那条能走的路，
   * 而收起侧栏是个会一直保持的状态——藏了的话，收着侧栏的人永远看不见它。
   *
   * 状态点这时退成齿轮右上角的角标（和 `.nav-item__dot` 同一条规则），
   * 靠的是绝对定位而不是第二套 DOM。量 `position` 就是在量这一条。
   */
  check("收起态齿轮还在", await page.isVisible(".conn__gear"));
  const gearBox = await page.evaluate(() => {
    const gear = document.querySelector(".conn__gear").getBoundingClientRect();
    const dot = document.querySelector(".conn > .dot");
    return {
      w: Math.round(gear.width),
      pos: dot ? getComputedStyle(dot).position : "",
      inside: dot ? dot.getBoundingClientRect().left >= gear.left && dot.getBoundingClientRect().top >= gear.top - 4 : false,
    };
  });
  check("收起态齿轮和导航项等宽", Math.abs(gearBox.w - itemW) <= 2, `${gearBox.w} vs ${itemW}`);
  check("收起态状态点退成角标", gearBox.pos === "absolute" && gearBox.inside, `${gearBox.pos} / 落在齿轮上 ${gearBox.inside}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".nav-item", { timeout: 8000 });
  check(
    "刷新后记得收着",
    (await page.$eval(".sidebar", (e) => Math.round(e.getBoundingClientRect().width))) <= 64
  );
  // 收起态下**点 logo 展开**——收放按钮这时是藏着的，点它只会超时
  await page.click(".brand-mark");
  await page.waitForTimeout(250);
  check("点 logo 能再展开回去", (await page.$eval(".sidebar", (e) => Math.round(e.getBoundingClientRect().width))) > 150);
  // 展开后 logo 退回纯标识：点它既不收侧栏也不跳页，省掉一次「点了会怎样」的犹豫
  check("展开后 logo 不再抢点击", await page.$eval(".brand-mark", (e) => getComputedStyle(e).pointerEvents === "none"));

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
      await page.click(".conn__gear");
      await page.waitForSelector(".set-overlay .set-nav__item", { timeout: 8000 });

      const groups = await page.$$eval(".set-nav__title", (els) => els.map((e) => e.textContent));
      const navs = await page.$$eval(".set-nav__item", (els) => els.map((e) => e.innerText.trim()));
      check("左栏分四组", groups.join("/") === "连接/能力/提示词/其他", groups.join("/"));
      check("左栏八项", navs.length === 8, navs.join("/"));
      // 右边一次只画一段：默认那段只有 vault 一个字段，不是十五个全铺出来
      check("右边一次只画一段", (await page.$$(".set-pane .set-field")).length === 1);
      check("非密钥字段带出当前值", (await page.$eval("#set-VAULT_ROOT", (e) => e.value)).length > 0);
      // 长说明默认收起——这正是上一版「一大坨」的根因
      const whyOpen = await page.$$eval(".set-pane .set-why", (els) => els.filter((e) => e.open).length);
      check("「为什么」默认是收起的", whyOpen === 0, `${whyOpen} 个展开着`);

      /**
       * ⚠️ **等的是自检结果，不是自检那个容器。** 上一版直接数 `.set-check` 就断言完了，
       * 那时候全是 `--wait`（转圈占位），断言照样全绿而它一次都没看到真正的结论。
       * 八条是同一个请求一起回来的，只要有一条落地，其余也都落地了。
       */
      await page.waitForSelector(".set-check--ok, .set-check--bad, .set-check--warn, .set-check--off", { timeout: 40000 });
      check("自检真的出了结论", !!(await page.$(".set-pane .set-check:not(.set-check--wait)")));
      // 左栏的记号是这一版加左导航的全部理由：不逐段翻就知道哪一段出了事
      const marks = (await page.$$(".set-nav__mark")).length;
      check("左栏项上挂了状态记号", marks >= 3, `${marks} 枚`);

      await go("optional");
      await page.waitForSelector("#set-DEEPL_API_KEY", { timeout: 5000 });
      const secret = await page.$eval("#set-DEEPL_API_KEY", (e) => ({ type: e.type, value: e.value, ph: e.placeholder }));
      check("密钥框是 password 且不回显", secret.type === "password" && secret.value === "", `${secret.type} / "${secret.value}"`);
      check("密钥框说清楚留空会怎样", /留空则不改|未配置/.test(secret.ph), secret.ph);

      /**
       * ⚠️ **切段不能丢改动。** draft 挂在覆盖层顶层，左栏切的只是「右边画哪一段」。
       * 丢了的话「改 A → 去 B 改一下 → A 白改了」，而且不报错、屏幕上也看不出来。
       */
      await page.fill("#set-FIRECRAWL_BASE_URL", "http://127.0.0.1:3002");
      await go("links");
      await page.waitForSelector("#set-NOTION_INBOX_URL", { timeout: 5000 });
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
      await page.waitForSelector(".set-pp__item, .note-title", { timeout: 8000 });
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
      check("焦点回到齿轮上", await page.evaluate(() => document.activeElement?.classList.contains("conn__gear")));
    } finally {
      page.off("request", countWrites);
    }
  }

  // 3. 总览要么给数据、要么给引导——两种状态都不能是空白。
  const workerReady = await page.evaluate(() => fetch("/api/config").then((r) => r.json()).then((c) => c.worker.configured));
  if (workerReady) {
    await page.waitForSelector(".todo-card", { timeout: 20000 });
    const labels = await page.$$eval(".todo-card__label", (els) => els.map((e) => e.textContent));
    check("等你动手的只有两张大卡", labels.length === 2, labels.join("/"));
    const nums = await page.$$eval(".todo-card__value", (els) => els.map((e) => e.textContent));
    check("计数是数字", nums.every((n) => /^\d+$/.test(n)), nums.join("/"));

    // Worker 自己会消化的三段压成一条细横条。它们的 0 是**正常态**，和「等你动手」的 0
    // 含义正好相反——摊成同样大的卡片，首屏最贵的一整行就会有大半在展示「没有事」。
    const autos = await page.$$eval(".auto-card__item", (els) => els.map((e) => e.textContent));
    check("自动环节收进一张卡", autos.length === 3, autos.join("/"));
    check("每条都有图标", (await page.$$(".auto-card__item svg")).length === 3);
    // 外壳一样，层次全靠内容——那边一个 46px 的数字，这边三行小字
    const [cardPx, stripPx] = await page.evaluate(() => [
      parseFloat(getComputedStyle(document.querySelector(".todo-card__value")).fontSize),
      parseFloat(getComputedStyle(document.querySelector(".auto-card__n")).fontSize),
    ]);
    check("两类数字的字号差得出层次", cardPx >= stripPx * 2.5, `${cardPx} vs ${stripPx}`);
    // 三张卡的标题必须在同一条线上：外壳一样了，第一行还错开就更刺眼
    const heads = await page.$$eval(".todo-card__label, .auto-card__label", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    check("三张卡的标题在同一条线上", Math.max(...heads) - Math.min(...heads) <= 1, heads.join("/"));

    // 「N 件事等你」只数等你动手的两项。把 Worker 正在跑的活也算进去，
    // 会让人以为自己欠着事——「撰写中 3」并不需要你做任何动作。
    const badge = await page.textContent(".page-header__aside").catch(() => "");
    const sum = nums.reduce((n, x) => n + Number(x), 0);
    check(
      "待办数只算等你动手的",
      sum ? badge.includes(`${sum} 件事`) : badge.includes("没有待办"),
      `${badge} / ${nums.join("+")}`
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

  // 6. 内容工作台：四段做成页内 tab，浏览是卡片墙，点开才进阅读区。
  await page.goto(`http://127.0.0.1:${PORT}/#/topics`, { waitUntil: "networkidle" });
  await page.waitForSelector(".pill-tabs", { timeout: 10000 });
  /**
   * **选题默认只看「待写」。** 这一库里绝大多数条目是已成稿和已发布的历史，
   * 而打开这一页的意图基本只有一个：看接下来要写什么。
   * 断言里连**筛选条上那颗芯片是亮的**一起验——默认状态必须写进 URL，
   * 偷偷过滤的话用户看不出自己正在被过滤、也点不回「全部」。
   */
  await page.goto("about:blank");
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".nav-item", { timeout: 10000 });
  await page.click('.nav-item:has-text("创作")');
  await page.waitForSelector(".pill-tabs", { timeout: 10000 });
  await page.click('.pill-tab:has-text("选题库")');
  await page.waitForTimeout(600);
  check("选题默认落在「待写」", decodeURIComponent(page.url()).endsWith("/topics/待写"), decodeURIComponent(page.url()).split("#")[1] || "");
  const onChip = await page.$$eval('.chips .chip[aria-pressed="true"]', (els) => els.map((e) => e.textContent.trim()));
  check("筛选条上「待写」是亮的", onChip.some((t) => t.includes("待写")), onChip.join("/") || "(没有选中项)");

  const tabs = await page.$$eval(".pill-tab", (els) => els.map((e) => e.textContent.replace(/\d+$/, "").trim()));
  check("流水线四库名称统一", tabs.join("/") === "灵感库/素材库/选题库/稿件库", tabs.join("/"));
  // 侧栏那一项要覆盖四段，否则点进选题会发现「自己不在任何一个导航项里」
  const activeNav = await page.textContent('.nav-item[aria-current="true"]');
  check("侧栏高亮覆盖四段", activeNav.includes("创作"), activeNav.trim());
  check("浏览是卡片墙不是三栏", !!(await page.$(".panel-block")) && !(await page.$(".reader-overlay")));

  if (workerReady) {
    await page.waitForSelector(".kanban-col, .wall-card, .empty, .note-title", { timeout: 25000 });

    // **默认是卡片墙**。看板回答的是「卡在哪一步」，那是偶尔问一次的问题；
    // 日常进来是找内容的，默认给看板等于每次都先看一屏光标题。
    check("默认是卡片墙不是看板", !(await page.$(".kanban-col")), (await page.$$(".wall-card")).length + " 张卡");

    /**
     * **一排卡片里，每一行都要落在同一条线上。**
     * 标题有一行的也有三行的、有的有副标题有的没有，摘要和标签就会在每张卡上落在不同高度——
     * 扫一排卡片时眼睛得上下找，卡片墙那点「一眼扫十几条」的效率就是这么丢的。
     */
    const rowsAligned = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".wall-card")].slice(0, 3);
      if (cards.length < 2) return { skip: true };
      const topOf = (card, sel) => {
        const el = card.querySelector(sel);
        return el ? Math.round(el.getBoundingClientRect().top - card.getBoundingClientRect().top) : null;
      };
      const line = (sel) => cards.map((c) => topOf(c, sel)).filter((v) => v !== null);
      const spread = (xs) => (xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0);
      return { title: spread(line("h3")), sub: spread(line(".wall-card__sub")), note: spread(line(".wall-card__note")) };
    });
    if (!rowsAligned.skip) {
      check(
        "卡片里每一行都对齐",
        rowsAligned.title <= 1 && rowsAligned.sub <= 1 && rowsAligned.note <= 1,
        `标题差 ${rowsAligned.title}px / 副标题差 ${rowsAligned.sub}px / 摘要差 ${rowsAligned.note}px`
      );
    }


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
    const kanbanNotes = await page.$$eval(".kanban-card__note", (els) => els.length);
    check("看板卡片带摘要", kanbanNotes > 0, `${kanbanNotes} 张有摘要`);
    // 看板天生是横向的，不该被正文栏的 1320 上限切掉
    const wide = await page.$eval(".main", (el) => getComputedStyle(el).maxWidth);
    check("看板下正文栏放开宽度限制", wide === "none", wide);
    await shot("board");

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
        check("弹平台选择时一个字都没写回 Notion", writes === 0, `${writes} 次写请求`);
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

    // 切回卡片墙看浏览层那几件事
    await page.click('.seg button:has-text("卡片")');
    await page.waitForSelector(".wall-card, .empty", { timeout: 8000 });
    const n = await page.$$eval(".wall-card", (els) => els.length);
    check("选题卡片墙出条目", n > 0, `${n} 张`);
    if (n > 0) {
      const stateChips = await page.$$eval(".chips-sm .chip", (els) => els.map((e) => e.textContent.trim()));
      check("状态筛选条", stateChips.includes("待写") && stateChips.includes("撰写中"), stateChips.join("/"));
      // 卡片要有摘要，否则和一行标题的列表没区别，卡片墙就白做了
      const previews = await page.$$eval(".wall-card__note", (els) => els.map((e) => e.textContent.trim()));
      check("卡片带摘要", previews.length > 0 && previews[0].length > 10, `${previews.length} 张有摘要`);
      // 删除要有入口、而且**必须点两下**：第一下只是把按钮换成写清去向的确认按钮
      check("卡片上有删除入口", (await page.$$(".wall-card__del")).length === n, `${(await page.$$(".wall-card__del")).length}/${n}`);
      await page.click(".wall-card__del");
      const confirmText = await page.textContent(".wall-card .btn-danger").catch(() => "");
      check("删除要二次确认且说清去向", confirmText.includes("废纸篓"), confirmText.trim());
      // 反悔的路必须一直在：少了「取消」，点错第一下就只剩「删」和「离开这一页」两条路
      await page.click('.wall-card:has(.btn-danger) button:has-text("取消")');
      await page.waitForSelector(".wall-card .btn-danger", { state: "detached", timeout: 4000 });
      check("删除确认能取消", true);
      await shot("wall");

      // 点开 → 阅读覆盖层
      await page.click(".wall-card__open");
      await page.waitForSelector(".reader-overlay .reader .prose", { timeout: 25000 });
      check("点开进阅读区", !!(await page.$(".reader-overlay")));
      check("阅读区有面包屑", (await page.textContent(".reader-overlay__crumb")).includes("选题库"));
      check("阅读区有批注台", !!(await page.$(".reader-overlay .rail")));
      check("有状态下拉（可直接改 Notion）", !!(await page.$(".select__btn")));
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
       */
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
      check("Esc 回到卡片墙", !!(await page.$(".wall-card")));

      // 搜索过滤
      const first = await page.textContent(".wall-card h3");
      await page.fill(".search-box input", first.slice(0, 4));
      await page.waitForTimeout(400);
      const filtered = await page.$$eval(".wall-card", (els) => els.length);
      check("搜索能过滤", filtered > 0 && filtered <= n, `${filtered}/${n}`);
      await page.fill(".search-box input", "");
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

  // 6c. 排版现在是工作台里的一个页面，不用另开浏览器标签
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

    // 导入：书架的入口是「导入书籍」+「建空书」，两个都得常驻。
    // 之前只在书架目录已存在时才显示，目录没建时按钮藏在引导文案里，两头都不顺手。
    const shelfBtns = await page.$$eval(".page-header__aside button", (els) => els.map((e) => e.textContent.trim()));
    check("书架有导入和新建两个入口", shelfBtns.some((b) => b.includes("导入")) && shelfBtns.some((b) => b.includes("建空书")), shelfBtns.join("/"));

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
     */
    check("阅读区开着时锁住了页面滚动", (await page.evaluate(() => document.body.style.overflow)) === "hidden");

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
      const shownMode = (await page.textContent(".rail .ai-result .rail-label")).trim();
      check("跑完直接停在新问的那一段上", shownMode === "展开", shownMode);
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
      const back = await page.textContent(".rail .ai-result .rail-label");
      page.off("request", countAi);
      check("点回问过的模式不重新花 token", calls === 0, `${calls} 次请求`);
      check("点回去看到的是那一段", back.trim() === "解释", back.trim());
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
    await page.click('.book-detail button:has-text("返回书架"), .main button:has-text("返回书架")');
    await page.waitForSelector(".book-card", { timeout: 15000 });

    await page.click(`.book-card:has-text("${mdBook}") .book-card__del`);
    const trashText = await page.textContent(".book-card--confirm").catch(() => "");
    check("下架要二次确认且说清去哪", trashText.includes(".trash") && trashText.includes("批注"), trashText.replace(/\s+/g, " ").slice(0, 46));
    await page.click('.book-card--confirm button:has-text("移到废纸篓")');
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
    };
  });
  check("六个榜都在信源清单里", boards.ids.join(",") === "weibo,zhihu,douyin,bili,toutiao,rednote", boards.ids.join(","));
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
  if (boards.dead.length) {
    const note = await page.textContent(".panel-note").catch(() => "");
    check("挂掉的源在底部如实说明", boards.dead.every((d) => note.includes(d.split(":")[0])), note.slice(0, 70));
    // 原始异常（Unexpected token '<'…）不能直接铺到界面上
    check("失败原因是人话不是异常栈", !/DOCTYPE|Unexpected token|undefined/.test(note), note.slice(0, 60));
  }
  const boardTitles = await page.$$eval(".board__title", (els) => els.map((e) => e.textContent.trim()));
  check("热榜按平台分栏且未被过滤", boardTitles.length >= 10, `${boardTitles.length} 条`);
  await shot("hot-boards");

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
    // 它是解析来的，会随对方改版失效——版面上必须如实说，并且留一个去官网的出口
    const note = await page.textContent(".hot-footnote");
    check("如实标注来源和失效风险", note.includes("解析") && note.includes("AIHOT"), note.replace(/\s+/g, " ").slice(0, 60));
  } else {
    check("模型榜挂了也给出口", (await page.textContent(".empty")).includes("官网"));
  }

  // 8b. 灵感库：同一套卡片墙，点开有完整正文和批注台（这是它从阅读器搬过来的东西）
  await page.goto(`http://127.0.0.1:${PORT}/#/inbox`, { waitUntil: "networkidle" });
  await page.waitForSelector(".wall-card, .empty, .note-title", { timeout: 25000 });
  const ideas = await page.$$eval(".wall-card", (els) => els.length);
  if (ideas > 0) {
    check("灵感库是卡片墙", ideas > 0, `${ideas} 张`);
    await page.click(".wall-card__open");
    // 等批注台真的挂上来，不是等覆盖层出现——正文还在取的时候右栏是不渲染的
    await page.waitForSelector(".reader-overlay .rail-tabs", { timeout: 25000 });
    check("灵感也能进阅读区", !!(await page.$(".reader-overlay .rail")));
    const ideaTabs = await page.$$eval(".reader-overlay .rail-tabs button", (els) => els.map((e) => e.textContent.trim()));
    check("灵感能划词批注/问 AI", ideaTabs.join("/") === "标记/衍生/对话", ideaTabs.join("/"));
    await page.keyboard.press("Escape");
    await page.waitForSelector(".reader-overlay", { state: "detached", timeout: 5000 });
  }
  check("有新增入口", (await page.textContent(".panel-head")).includes("新增"));

  // **状态值里带斜杠的那个筛选**。灵感库有「初筛失败/需人工」，而路由是 `#/view/state`——
  // 整串先 decodeURIComponent 再 split 的话，`%2F` 被还原成真斜杠，状态被劈成两半，
  // 只剩「初筛失败」送去 Notion，库里直接回 400。这条守的就是那个 bug。
  const slashChip = await page.$('.chips-sm .chip:has-text("初筛失败/需人工")');
  if (slashChip) {
    await slashChip.click();
    await page.waitForTimeout(1500);
    const err = await page.textContent(".note-danger").catch(() => "");
    check("带斜杠的状态筛选不炸", !err.includes("validation_error") && !err.includes("not found for property"), err.slice(0, 80) || "无报错");
    check("斜杠状态完整进了 hash", decodeURIComponent(page.url().split("#")[1] || "").includes("初筛失败/需人工"), page.url().split("#")[1] || "");
    await page.click('.chips-sm .chip:has-text("全部")');
    await page.waitForTimeout(600);
  }
  await shot("ideas");

  // 8c. 素材库按类型分面。素材库在 Notion 侧没有状态字段（Worker 的 statusProp 是 null），
  //     所以这个筛是在已加载的条目里做的，选项也从真实数据里现算——写死一张表的话，
  //     Notion 里新加一个类型就会在界面上凭空消失。
  await page.goto(`http://127.0.0.1:${PORT}/#/materials`, { waitUntil: "networkidle" });
  await page.waitForSelector(".wall-card, .empty, .note-title", { timeout: 25000 });
  const matAll = await page.$$eval(".wall-card", (els) => els.length);
  //     分面是**一个下拉**不是第二排芯片：两排芯片摞在一起分不出哪排是什么，
  //     而且第二排会随选项数量变长，把卡片墙一路往下顶。
  const facetBtn = await page.$(".filter-bar .select__btn");
  if (matAll > 0 && facetBtn) {
    const label = (await facetBtn.textContent()).trim();
    check("素材库能按类型筛", label.includes("类型"), label);
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
    await page.click(".select__pop button >> nth=1");
    await page.waitForTimeout(300);
    const filtered = await page.$$eval(".wall-card", (els) => els.length);
    check("类型筛真的收窄了", filtered > 0 && filtered <= matAll, `${filtered}/${matAll}`);
    // 回头路必须有：没有「全部」的筛选等于把人锁在一个子集里
    await page.click(".filter-bar .select__btn");
    await page.click(".select__pop button >> nth=0");
    await page.waitForTimeout(300);
    check("能筛回全部", (await page.$$eval(".wall-card", (els) => els.length)) === matAll);
  }
  if (matAll > 0) {
    const materialCards = await page.$$eval(".wall-card", (cards) => cards.map((card) => ({
      type: card.querySelector(".wall-card__sub")?.textContent.trim() || "",
      badge: card.querySelector(".tag--state")?.textContent.trim() || "",
      warning: card.querySelector(".wall-card__warning")?.textContent.trim() || "",
    })));
    const sensitive = materialCards.filter((card) => ["金句/原话", "数据/事实", "金句·原话", "数据·事实"].includes(card.type));
    const pending = sensitive.filter((card) => card.badge === "待核验");
    check("待核验金句和数据在卡片上有警告", pending.every((card) => card.warning.includes("暂勿用于成稿")), JSON.stringify(pending));
    const ordinary = materialCards.filter((card) => !["金句/原话", "数据/事实", "金句·原话", "数据·事实"].includes(card.type));
    check("普通素材卡不堆核验徽标", ordinary.every((card) => !card.badge), JSON.stringify(ordinary.slice(0, 4)));

    await page.click(".wall-card__open");
    await page.waitForSelector(".reader-overlay .doc-meta", { timeout: 25000 });
    const materialMeta = await page.textContent(".reader-overlay .doc-meta");
    check(
      "素材详情展示核验和证据链",
      ["核验状态", "核验说明", "来源灵感", "关联选题"].every((label) => materialMeta.includes(label)),
      materialMeta.slice(0, 180),
    );
    if (materialCards[0].warning) {
      const detailWarning = await page.textContent(".reader-overlay .note-danger").catch(() => "");
      check("待核验素材详情有明确警告", detailWarning.includes("暂勿用于成稿"), detailWarning.slice(0, 120));
    }
    // **不给 `.catch(() => Escape)` 兜底。** 这句原来带着兜底，而选择器其实一直没匹配上
    // （那时按钮的名字是「关闭 Esc」）——兜底让它看起来一直在工作。
    // 关不掉就该让测试红，那正是要知道的事。
    await page.click('.reader-overlay__bar button[aria-label="关闭"]');
  }

  /**
   * 8d. 稿件库：**筛选条只占一行，卡片上平台只出现一次**。
   *
   * 这一页同时有状态（4 档）和分面（平台），是全工作台筛选最重的一页。
   * 两条都是**会安静退化**的东西：状态和分面各画一排芯片时功能完全正常，只是看着分不出
   * 哪排是什么；平台在副标题和标签里各写一遍也不报错，只是同一张卡上说了两遍。
   */
  await page.goto(`http://127.0.0.1:${PORT}/#/drafts`, { waitUntil: "networkidle" });
  await page.waitForSelector(".wall-card, .empty, .note-title", { timeout: 25000 });
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
  const draftCards = await page.$$eval(".wall-card", (cards) =>
    cards.map((c) => ({
      sub: c.querySelector(".wall-card__sub")?.textContent.trim() || "",
      tags: [...c.querySelectorAll(".wall-card__tags .tag")].map((t) => t.textContent.trim()),
    }))
  );
  if (draftCards.length) {
    check(
      "卡片上平台只出现一次",
      draftCards.every((c) => !c.sub || !c.tags.includes(c.sub)),
      draftCards.map((c) => `${c.sub || "（空）"}|${c.tags.join("/")}`).slice(0, 3).join("  ")
    );
    // 副标题那一行**空着也要占位**：不占的话，摘要在各张卡上的高度就不一样了
    const subH = await page.$$eval(".wall-card__sub", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    check("空副标题仍占位，卡片才对得齐", new Set(subH).size === 1 && subH[0] > 0, `高度 ${[...new Set(subH)].join("/")}px`);
  }

  // 9. 数据页。两份 CSV 测完都还原，不留测试数据。
  const csv = path.join(ROOT, "data", "metrics.csv");
  const postsCsv = path.join(ROOT, "data", "posts.csv");
  const csvBefore = fs.existsSync(csv) ? fs.readFileSync(csv, "utf8") : null;
  const postsBefore = fs.existsSync(postsCsv) ? fs.readFileSync(postsCsv, "utf8") : null;
  try {
    await page.goto(`http://127.0.0.1:${PORT}/#/metrics`, { waitUntil: "networkidle" });
    await page.waitForSelector(".pill-tabs", { timeout: 8000 });

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
    await page.click('.pill-tab:has-text("数据来源")');
    await page.waitForSelector(".inbox__row", { timeout: 8000 });
    const card = await page.textContent(".inbox__row");
    check("自动发现下载好的导出文件", card.includes("小红书-内容分析-smoke.csv"), card.replace(/\s+/g, " ").slice(0, 70));
    // 点之前就知道会不会白点——多数时候答案是「已经导过了」
    check("卡片上先说清会新增几条", /新增 2/.test(card), card.replace(/\s+/g, " ").slice(0, 90));
    await page.click('.inbox__row .btn-primary');
    await page.waitForTimeout(900);
    check("一键导入真的写进去了", fs.readFileSync(postsCsv, "utf8").includes("冒烟自动发现甲"));
    // 导过之后按钮要改口，不能还写着「导入 2 条」
    const after = await page.textContent(".inbox__row").catch(() => "");
    check("导过的文件不再劝你再导一次", /已导过/.test(after), after.replace(/\s+/g, " ").slice(0, 80));
    fs.rmSync(inboxFile, { force: true });

    /* 9a. 导入：**先 dry 看一眼、再确认写盘**。这两步存在的全部理由是解析器只能靠列名
     *     认字段——认错了不报错，只会让一列数字安静地进错格子。所以断言钉的是
     *     「界面上真的把映射摊开给人看了」，不只是「导入成功了」。 */
    await page.click('.pill-tab:has-text("数据来源")');
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
    await page.click('.pill-tab:has-text("月度总览")');
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
    // 小红书没有「分享」这一列 → 那一格整个不出现，不是显示 0
    check("没有数据的指标整格不出现", !chan.includes("分享"), chan.replace(/\s+/g, " ").slice(0, 80));

    // 9c. 幂等：同一份文件再导一次不能多出三行
    await page.click('.pill-tab:has-text("数据来源")');
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
  await page.waitForSelector(".panel-block .empty, .panel-block .wall-card, .panel-block .note-title", { timeout: 20000 });
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
    insightsText.includes("社媒洞察") || insightsText.includes("还没有洞察报告") || (await page.$(".wall-card"));
  check("洞察页说的是洞察自己的话", !!insightsOk && !insightsText.includes("一本书"), insightsText.replace(/\s+/g, " ").slice(0, 50));

  /**
   * 卡片墙的硬要求：**一张只有标题的卡和一行列表没区别，卡片墙就白做了**。
   * 洞察源以前正是这样——list 只走 vaultTree，拿不到正文，卡上除了标题什么都没有。
   * 现在走 /api/vault/insights，摘要/覆盖周期/字数都在服务端读出来。
   */
  if (await page.$(".wall-card")) {
    const card = await page.evaluate(() => {
      const c = document.querySelector(".wall-card");
      return {
        preview: c.querySelector(".wall-card__note")?.textContent.trim() || "",
        sub: c.querySelector(".wall-card__sub")?.textContent.trim() || "",
        tags: [...c.querySelectorAll(".wall-card__tags .tag")].map((t) => t.textContent.trim()),
      };
    });
    check("洞察卡片有摘要，不是只有一个标题", card.preview.length > 20, card.preview.slice(0, 36));
    check(
      "洞察卡片说清覆盖周期和篇幅",
      /覆盖|生成于/.test(card.sub) && card.tags.some((t) => /字$/.test(t)),
      `${card.sub} · ${card.tags.join(" / ")}`
    );
    // 伴生文件不能冒充报告：给报告写过批注之后会多出 <同名>.notes.md，
    // 上一版没排掉它，列表里就会凭空多一张卡（同书架那个「正文像凭空消失了」是一类 bug）
    const titles = await page.$$eval(".wall-card h3", (els) => els.map((e) => e.textContent.trim()));
    check("批注文件没被当成报告列出来", !titles.some((t) => /\.(notes|highlights)$/.test(t)), titles.join(" / ").slice(0, 60));
  }

  /**
   * 小标题的底衬。洞察报告是全工作台小标题最密的文档（实测每千字一个），拿它验最合适。
   *
   * 真正会**安静**坏掉的是那个负 margin：去掉之后底衬照样在、颜色照样对，
   * 只是每个标题都比正文缩进 12px——一眼看不出来，但整篇正文的左边缘就不齐了。
   * 所以量的是**字的左边缘**（底衬左边 + 内边距），不是盒子的左边缘。
   */
  if (await page.$(".wall-card")) {
    await page.click(".wall-card__open");
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
  await page.waitForSelector(".wall-card", { timeout: 20000 });
  await page.click(".wall-card__open");
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

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
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
  check("备份面板列出三份工作台数据", bk.rows.length === 3, bk.rows.join(" / "));
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
  await page.waitForSelector(".rail-find", { timeout: 8000 });
  // 快捷键不能是唯一入口：看不见的功能没人会去猜它存不存在
  check("侧栏有看得见的搜索入口", await page.isVisible(".rail-find"));
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
  // 背景对键盘和读屏整块消失
  check(
    "背景被 inert 掉了",
    await page.evaluate(() => document.querySelector(".sidebar")?.inert === true)
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
    const el = [...document.querySelectorAll(".field-hint, .empty, .page-sub")].find((e) => e.offsetParent);
    if (!el) return null;
    const s = getComputedStyle(el);
    const [a, b] = [L(s.color), L(getComputedStyle(document.body).backgroundColor)].sort((x, y) => y - x);
    return { ratio: +((a + 0.05) / (b + 0.05)).toFixed(2), color: s.color, size: parseFloat(s.fontSize) };
  });
  if (contrast) {
    check("辅助文字过 WCAG AA（4.5:1）", contrast.ratio >= 4.5, `${contrast.ratio}:1 · ${contrast.color}`);
    check("辅助文字不小于 13px", contrast.size >= 13, `${contrast.size}px`);
  } else {
    check("辅助文字能量到", false, "这一页上没有 .field-hint / .empty / .page-sub");
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
