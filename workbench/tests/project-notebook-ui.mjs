import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-notebook-ui-"));
const screenshots = { desktop: path.join(os.tmpdir(), "xenho-notebook-desktop.png"), mobile: path.join(os.tmpdir(), "xenho-notebook-mobile.png") };
const variables = { XENHO_HOME: path.join(tempRoot, "Xenho"), WB_KEEP_ALIVE: "1", HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1,localhost" };
const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
Object.assign(process.env, variables);
const check = (name, condition) => { assert(condition, name); console.log(` ✓ ${name}`); };
function playwright() {
  const require = createRequire(import.meta.url);
  for (const root of [ROOT, "C:/Users/Lenovo", process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules")].filter(Boolean)) {
    try { return require(require.resolve("playwright", { paths: [root] })); } catch {}
  }
  throw new Error("找不到 playwright");
}
let server, browser, base, page;
async function request(route, body, method = "POST") {
  const response = await fetch(`${base}${route}`, body === undefined ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  assert(response.ok && result.ok, JSON.stringify(result));
  return result;
}
async function until(read, predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待超时：${label}`);
}
try {
  server = await createServer({ root: ROOT, configFile: path.join(ROOT, "vite.config.mjs"), server: { host: "127.0.0.1", port: 5208, strictPort: true, open: false }, logLevel: "error" });
  await server.listen();
  base = "http://127.0.0.1:5208";
  const status = await request("/api/workspace/status");
  check("使用系统临时目录中的独立工作区", status.ready && path.relative(os.tmpdir(), variables.XENHO_HOME).startsWith("xenho-notebook-ui-"));
  const { project } = await request("/api/workspace/projects", { kind: "draft", mode: "blank", title: "只有疑问也能开始", platform: "公众号" });
  const projectRoute = `/api/workspace/projects/${encodeURIComponent(project.id)}`;
  const notebookRoute = `${projectRoute}/notebook`;
  const original = (await request(projectRoute)).project.masterDraft.body;
  const initial = (await request(notebookRoute)).notebook;
  check("空白创作无需 Wiki、受众和方向", initial.thought === "" && initial.audience === "" && initial.agendaId === null);
  browser = await playwright().chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/#/project/${project.id}`);
  const notebook = page.getByRole("region", { name: "这篇的构思" });
  const toggle = notebook.getByRole("button", { name: "构思 · 展开", exact: true });
  await toggle.waitFor();
  await toggle.focus();
  await page.keyboard.press("Enter");
  const thought = notebook.getByLabel("想讲什么", { exact: true });
  await thought.waitFor();
  await notebook.getByRole("button", { name: "补充读者、疑问与依据" }).click();
  await thought.focus();
  await page.keyboard.press("Tab");
  check("键盘展开构思并顺序进入受众输入", await notebook.getByLabel("写给谁", { exact: true }).evaluate((el) => el === document.activeElement));
  await thought.fill("为什么工具买得越多，我反而更难开始？");
  await until(() => request(notebookRoute), (r) => r.notebook.thought.includes("更难开始"), "自动保存构思");
  await notebook.getByText("构思已保存", { exact: true }).waitFor();
  check("构思自动保存进入 SQLite", true);
  await page.reload();
  await thought.waitFor();
  check("刷新恢复同一篇构思", (await thought.inputValue()).includes("更难开始"));
  await page.locator(".nav > .nav-group > button").count();
  const mainLabels = await page.locator(".nav > div > button .nav-item__label").allTextContents();
  check("业务导航只有今日、积累、创作、复盘", JSON.stringify(mainLabels) === JSON.stringify(["今日", "积累", "创作", "复盘"]));
  await page.locator(".nav").getByRole("button", { name: "今日", exact: true }).click();
  await page.goto(`${base}/#/project/${project.id}`);
  await thought.waitFor();
  check("切页恢复构思", (await thought.inputValue()).includes("更难开始"));
  await notebook.locator("summary").filter({ hasText: "比较讲法" }).click();
  await notebook.getByRole("button", { name: "记下另一种讲法" }).click();
  await notebook.getByLabel("讲法 1 名称", { exact: true }).fill("从一个疑问讲起");
  await notebook.getByLabel("讲法 1 内容", { exact: true }).fill("先比较开始行动的条件，不预设自己的经历。 ");
  await until(() => request(notebookRoute), (r) => r.notebook.alternatives[0]?.body.includes("不预设"), "保存备选讲法");
  await notebook.getByRole("button", { name: "用作当前构思" }).click();
  await until(() => request(notebookRoute), (r) => r.notebook.thought.includes("不预设"), "切换讲法");
  check("调整讲法不会覆盖正文", (await request(projectRoute)).project.masterDraft.body === original);
  check("方向可以保持不限定", await notebook.getByLabel("创作方向（可选）").inputValue() === "");
  // 模拟真实保存故障：输入必须留在编辑区，手动重试恢复持久化。
  const failSave = async (route) => route.request().method() === "PUT" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "测试：暂时无法保存构思" }) }) : route.continue();
  await page.route(`**${notebookRoute}`, failSave);
  await thought.fill("保存失败时也不能丢掉这个疑问。");
  await notebook.getByRole("button", { name: "重试", exact: true }).waitFor();
  check("保存失败明确显示重试并保留输入", (await thought.inputValue()).includes("不能丢掉"));
  await page.unroute(`**${notebookRoute}`, failSave);
  await notebook.getByRole("button", { name: "重试", exact: true }).click();
  await until(() => request(notebookRoute), (r) => r.notebook.thought.includes("不能丢掉"), "重试保存");
  // 旧版本写入必须失败，避免另一处编辑被静默覆盖。
  const stale = await fetch(`${base}${notebookRoute}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 0, thought: "过期编辑" }) });
  check("并发版本冲突拒绝覆盖", stale.status === 409 && (await request(notebookRoute)).notebook.thought.includes("不能丢掉"));
  await notebook.getByRole("button", { name: "新建创作方向" }).click();
  check("方向没有名称和认识时不能保存", await notebook.getByRole("button", { name: "保存方向并用于这篇" }).isDisabled());
  await notebook.getByLabel("方向名称", { exact: true }).fill("帮助读者开始行动");
  await notebook.getByLabel("希望读者形成的认识", { exact: true }).fill("先明确任务，再选择工具");
  await notebook.getByRole("button", { name: "保存方向并用于这篇" }).click();
  await until(() => request(notebookRoute), (r) => Boolean(r.notebook.agendaId), "新建并采用可选方向");
  check("方向可以在当前篇内创建和采用", true);
  await notebook.getByLabel("创作方向（可选）").selectOption("");
  await until(() => request(notebookRoute), (r) => r.notebook.agendaId === null, "移除方向限制");
  await page.screenshot({ path: screenshots.desktop, fullPage: true });
  for (const [route, selected] of [["assistant", "研究"], ["entries", "Wiki"], ["bridge", "发现方向"], ["series", "合集"], ["typeset", "排版"]]) {
    await page.goto(`${base}/#/${route}`);
    await page.locator(`.sidebar button[aria-current="page"]`).filter({ hasText: selected }).waitFor();
    check(`旧深链 ${route} 保持可达与高亮`, true);
  }
  await page.route("**/api/assistant/conversation?**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversation: { id: "research-test", title: "持续研究", messages: [{ id: "u1", role: "user", content: "我的真实疑问：为什么难以开始？" }, { id: "a1", role: "assistant", content: "AI 未核实的推测不作为事实。" }], actions: [], attachments: [] } }) }));
  await page.goto(`${base}/#/assistant/research-test`);
  await page.getByRole("button", { name: "从这次研究发展成一篇" }).click();
  const transfer = page.getByLabel("带入创作的想法", { exact: true });
  await transfer.waitFor();
  check("研究转创作只预填用户原话", (await transfer.inputValue()).includes("我的真实疑问") && !(await transfer.inputValue()).includes("AI 未核实"));
  await page.getByRole("button", { name: "保存并进入创作" }).click();
  await page.waitForURL(/#\/project\//);
  const researchProject = page.url().split("#/project/")[1];
  const researchNotes = (await request(`/api/workspace/projects/${researchProject}/notebook`)).notebook;
  check("研究转创作保留原会话引用", researchNotes.discovery.research.conversationId === "research-test");
  check("研究内容不自动写入正文", (await request(`/api/workspace/projects/${researchProject}`)).project.masterDraft.body === "");
  await page.getByRole("button", { name: "回到原研究对话" }).click();
  await page.waitForURL(/#\/assistant\/research-test$/);
  await page.goto(`${base}/#/project/${project.id}`);
  await thought.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".project-assistant[data-collapsed=true]").waitFor({ state: "attached" });
  await page.screenshot({ path: screenshots.mobile, fullPage: true });
  check("小屏构思没有横向溢出", await notebook.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  check("小屏页面没有横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check("浏览器无页面异常", errors.length === 0);
  console.log(`截图保留至人工复核：\n${screenshots.desktop}\n${screenshots.mobile}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(os.tmpdir(), "xenho-notebook-failure.png"), fullPage: true }).catch(() => {});
    console.log("PAGE STATE", await page.locator("body").innerText().catch(() => ""));
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await server?.xenhoClose?.().catch(() => {});
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const relative = path.relative(os.tmpdir(), tempRoot);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "只清理系统临时测试目录");
  await fs.rm(tempRoot, { recursive: true, force: true });
}
