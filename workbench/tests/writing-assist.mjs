/** 写作推动的真实浏览器闭环：新建文章与稿件库正式编辑器都必须能看到、能插入。 */
import { createServer } from "vite";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 5202;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const roots = [ROOT, "C:/Users/Lenovo", process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : ""];
  for (const root of roots.filter(Boolean)) {
    try { return require(require.resolve("playwright", { paths: [root] })); } catch { /* 下一处 */ }
  }
  throw new Error("找不到 playwright");
}

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
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error" && !/Failed to load resource/i.test(message.text())) errors.push(message.text());
});
await page.addInitScript(() => localStorage.removeItem("workbench:creation-draft:v1"));

let nudges = 0;
const requests = [];
await page.route("**/api/pipe/writing-assist", async (route) => {
  const body = route.request().postDataJSON();
  requests.push(body);
  if (body.mode === "nudge") {
    nudges += 1;
    await new Promise((resolve) => setTimeout(resolve, 260));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, mode: "nudge", kind: nudges === 1 ? "问题" : "新角度", text: nudges === 1 ? "你真正改变看法的那个瞬间是什么？" : "如果从读者最可能反对的地方往回写呢？" }),
    });
  }
  const text = body.mode === "finish"
    ? Array.from({ length: 18 }, (_, index) => `第 ${index + 1} 步，把判断落到一个具体选择上。真正的结束不是再总结一次，而是让读者知道明天可以少做什么。`).join("\n\n")
    : "这不是缺少更多方法，而是还没有把眼前的矛盾说透。先把最不愿承认的那个代价写下来，下一步往往就会自己出现。";
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: body.mode, kind: body.mode === "finish" ? "完成全文" : "续写一段", text }) });
});

function assert(value, message) {
  if (!value) throw new Error(message);
}

function editorValue(selector) {
  return page.$eval(selector, (content) => Array.from(content.children, (line) => line.textContent).join("\n"));
}

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.click(".page-header__aside .btn-primary");
  await page.waitForSelector(".creation-mode");
  await page.keyboard.press("1");
  await page.waitForSelector(".creation-editor .cm-content");

  await page.click(".writing-assist__trigger");
  await page.waitForSelector(".writing-assist__result");
  const firstStarter = await page.textContent(".writing-assist__result > p");
  assert((await page.textContent(".writing-assist__result footer")).includes("2,560"), "没有显示真实的起始句库数量");
  await page.click('.writing-assist__result button:has-text("换一句")');
  const secondStarter = await page.textContent(".writing-assist__result > p");
  assert(firstStarter !== secondStarter, "换一句没有换内容");
  await page.click('.writing-assist__result button:has-text("用这句开头")');
  await page.waitForFunction((text) => document.querySelector(".cm-content")?.textContent.includes(text), secondStarter);

  // 光标放在正文中间：请求位置、浮层位置和等待动画必须都以真实界面为准。
  await page.click(".creation-editor .cm-content");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.click(".writing-assist__trigger");
  await page.waitForSelector(".writing-assist__wait");
  const loadingUi = await page.evaluate(() => {
    const card = document.querySelector(".writing-assist__card");
    const spinner = document.querySelector(".writing-assist__wait svg");
    const rect = card.getBoundingClientRect();
    return {
      position: getComputedStyle(card).position,
      centerOffset: Math.abs((rect.left + rect.right) / 2 - innerWidth / 2),
      top: rect.top,
      animation: getComputedStyle(spinner).animationName,
    };
  });
  assert(loadingUi.position === "fixed" && loadingUi.centerOffset < 2 && loadingUi.top < 120, "推动浮层没有固定在页面顶部中央");
  assert(loadingUi.animation !== "none", "等待图标没有播放转动动画");
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("改变看法"));
  assert(requests.find((item) => item.mode === "nudge")?.cursor === 3, "新建文章没有把当前光标位置发给 AI");

  // 连续两次小推动：第二次必须真的再发请求，而不是重复展示第一次缓存。
  await page.click('.writing-assist__result button:has-text("再来一个")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("读者最可能反对"));
  assert(nudges === 2, `小推动请求次数不对：${nudges}`);

  await page.click('.writing-assist__modes button:has-text("帮我写")');
  await page.click('.writing-assist__choice button:has-text("续写一段")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("缺少更多方法"));
  const before = await editorValue(".cm-content");
  assert(!before.includes("缺少更多方法"), "候选在确认前就写进了正文");
  await page.screenshot({ path: path.join(ROOT, "tmp", "writing-assist.png"), fullPage: false });
  await page.click('.writing-assist__result button:has-text("插入光标处")');
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("缺少更多方法"));
  await page.waitForSelector(".writing-assist__card", { state: "detached" });
  const after = await editorValue(".cm-content");
  const paragraph = "这不是缺少更多方法，而是还没有把眼前的矛盾说透。先把最不愿承认的那个代价写下来，下一步往往就会自己出现。";
  assert(after === before.slice(0, 3) + paragraph + before.slice(3), "续写没有精确插入当前光标，或额外添加了换行");

  await page.click(".writing-assist__trigger");
  await page.waitForSelector(".writing-assist__wait");
  await page.waitForSelector(".writing-assist__result");
  await page.click('.writing-assist__modes button:has-text("帮我写")');
  await page.waitForSelector(".writing-assist__choice");
  await page.click('.writing-assist__choice button:has-text("完成全文")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("真正的结束"));
  const overflow = await page.evaluate(() => {
    const card = document.querySelector(".writing-assist__card");
    const content = document.querySelector(".writing-assist__result > p");
    return {
      cardHeight: card.getBoundingClientRect().height,
      scrolls: content.scrollHeight > content.clientHeight,
      overflowY: getComputedStyle(content).overflowY,
    };
  });
  assert(overflow.cardHeight <= 461 && overflow.scrolls && overflow.overflowY === "auto", "长结果没有限制窗口高度并在内部滚动");
  assert(!(await page.textContent(".cm-content")).includes("真正的结束"), "完成全文在确认前就写进了正文");
  await page.click('.writing-assist__result button:has-text("插入光标处")');
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("真正的结束"));

  // 用户日常改稿走的是稿件库覆盖层，不是上面的新建弹层；这里必须单独守住入口。
  await page.goto(`http://127.0.0.1:${PORT}/#/drafts`, { waitUntil: "networkidle" });
  await page.waitForSelector(".wall-card__open, .empty", { timeout: 25000 });
  assert((await page.$$(".wall-card__open")).length > 0, "稿件库没有可用于验证的稿件");
  await page.click(".wall-card__open");
  await page.waitForSelector('.doc-actions button:has-text("编辑")', { timeout: 25000 });
  await page.click('.doc-actions button:has-text("编辑")');
  await page.waitForSelector(".ws-edit .cm-content", { timeout: 8000 });
  assert((await page.$$(".ws-edit .writing-assist__trigger")).length === 1, "正式编辑器里没有推动按钮");
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("ArrowRight");
  const existingBefore = await editorValue(".ws-edit .cm-content");
  await page.click(".ws-edit .writing-assist__trigger");
  await page.waitForSelector(".ws-edit .writing-assist__result");
  const existingNudge = requests.filter((item) => item.mode === "nudge").at(-1);
  assert(existingNudge?.cursor === 12 && existingNudge.cursor < existingNudge.content.length, "正式编辑器仍然按文末而不是当前光标请求");
  await page.click('.ws-edit .writing-assist__modes button:has-text("帮我写")');
  await page.click('.ws-edit .writing-assist__choice button:has-text("续写一段")');
  await page.waitForFunction(() => document.querySelector(".ws-edit .writing-assist__result > p")?.textContent.includes("缺少更多方法"));
  await page.screenshot({ path: path.join(ROOT, "tmp", "writing-assist-existing-editor.png"), fullPage: false });
  await page.click('.ws-edit .writing-assist__result button:has-text("插入光标处")');
  await page.waitForFunction(() => document.querySelector(".ws-edit .cm-content")?.textContent.includes("缺少更多方法"));
  const existingAfter = await editorValue(".ws-edit .cm-content");
  assert(existingAfter === existingBefore.slice(0, 12) + paragraph + existingBefore.slice(12), "正式编辑器没有在当前光标精确插入");
  await page.click('.ws-edit__foot button:has-text("取消")');
  assert(errors.length === 0, `浏览器报错：${errors.join(" | ")}`);
  console.log("✓ 起始句可换、可插入");
  console.log("✓ 连续两次 AI 小推动都返回新结果");
  console.log("✓ 浮层位于页面顶部中央，等待图标实际播放转动动画");
  console.log("✓ AI 续写先预览，并在当前光标精确插入、不额外换行");
  console.log("✓ 长结果限制高度并在浮层内部滚动");
  console.log("✓ 新建文章与稿件库正式编辑器都把当前光标发给 AI");
  console.log("✓ 浏览器控制台 0 错误");
} finally {
  await browser.close();
  await server.close();
}
