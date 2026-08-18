/** 写作推动的真实浏览器闭环：起始句 → 两次小推动 → 续写候选 → 手动插入。 */
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
await page.route("**/api/pipe/writing-assist", async (route) => {
  const body = route.request().postDataJSON();
  if (body.mode === "nudge") {
    nudges += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, mode: "nudge", kind: nudges === 1 ? "问题" : "新角度", text: nudges === 1 ? "你真正改变看法的那个瞬间是什么？" : "如果从读者最可能反对的地方往回写呢？" }),
    });
  }
  const text = body.mode === "finish"
    ? "接下来，把判断落到一个具体选择上。真正的结束不是再总结一次，而是让读者知道明天可以少做什么。"
    : "这不是缺少更多方法，而是还没有把眼前的矛盾说透。先把最不愿承认的那个代价写下来，下一步往往就会自己出现。";
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: body.mode, kind: body.mode === "finish" ? "完成全文" : "续写一段", text }) });
});

function assert(value, message) {
  if (!value) throw new Error(message);
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

  // 连续两次小推动：第二次必须真的再发请求，而不是重复展示第一次缓存。
  await page.click(".writing-assist__trigger");
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("改变看法"));
  await page.click('.writing-assist__result button:has-text("再来一个")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("读者最可能反对"));
  assert(nudges === 2, `小推动请求次数不对：${nudges}`);

  await page.click('.writing-assist__modes button:has-text("帮我写")');
  await page.click('.writing-assist__choice button:has-text("续写一段")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("缺少更多方法"));
  const before = await page.textContent(".cm-content");
  assert(!before.includes("缺少更多方法"), "候选在确认前就写进了正文");
  await page.screenshot({ path: path.join(ROOT, "tmp", "writing-assist.png"), fullPage: false });
  await page.click('.writing-assist__result button:has-text("插入光标处")');
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("缺少更多方法"));
  const after = await page.textContent(".cm-content");
  assert(after.includes(secondStarter) && after.includes("缺少更多方法"), "插入续写时覆盖了已有正文");

  await page.click(".writing-assist__trigger");
  await page.waitForSelector(".writing-assist__card");
  await page.click('.writing-assist__modes button:has-text("帮我写")');
  await page.click('.writing-assist__choice button:has-text("完成全文")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("真正的结束"));
  assert(!(await page.textContent(".cm-content")).includes("真正的结束"), "完成全文在确认前就写进了正文");
  await page.click('.writing-assist__result button:has-text("插入光标处")');
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("真正的结束"));
  assert(errors.length === 0, `浏览器报错：${errors.join(" | ")}`);
  console.log("✓ 起始句可换、可插入");
  console.log("✓ 连续两次 AI 小推动都返回新结果");
  console.log("✓ AI 续写先预览，确认后才插入且不覆盖上文");
  console.log("✓ 完成全文同样先预览再插入");
  console.log("✓ 浏览器控制台 0 错误");
} finally {
  await browser.close();
  await server.close();
}
