import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { createUlid } from "../server/storage/ids.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-product-ui-"));
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
  server = await createServer({ root: ROOT, configFile: path.join(ROOT, "vite.config.mjs"), server: { host: "127.0.0.1", port: 5210, strictPort: true, open: false }, logLevel: "error" });
  await server.listen(); base = "http://127.0.0.1:5210";
  const shotDir = path.join(ROOT, "output", "playwright"); await fs.mkdir(shotDir, { recursive: true });
  browser = await playwright().chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#/today`);
  await page.getByRole("heading", { name: "接着做", exact: true }).waitFor();
  check("首页仅保留工作入口", JSON.stringify(await page.locator(".nav .nav-item__label").allTextContents()) === JSON.stringify(["首页", "研究", "内容", "资料库"]));
  await page.getByRole("button", { name: "记一下", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "记一下" });
  await dialog.getByLabel("想留下什么", { exact: true }).fill("我的真实经历：今天关掉多余工具后，终于写完第一段。");
  await dialog.getByRole("button", { name: "保存记录", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.locator(".nav").getByRole("button", { name: "资料库", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索资料" }).fill("关掉多余工具");
  await page.locator(".library-results article").first().waitFor();
  await page.locator(".library-results article > button").first().click();
  check("快速记录原话无需AI保存并可读回", (await page.locator(".library-original pre").innerText()).includes("终于写完第一段"));
  await page.locator(".nav").getByRole("button", { name: "研究", exact: true }).click();
  await page.getByLabel("你想弄明白什么", { exact: true }).fill("为什么工具越多越难开始？");
  await page.getByRole("button", { name: "开始研究", exact: true }).click();
  await page.waitForURL(/#\/research\//);
  const id = page.url().split("#/research/")[1];
  const pathResearch = `/api/workspace/researches/${id}`;
  await page.getByLabel("目前的理解", { exact: true }).fill("可能是选择成本增加了。先确定任务，再选工具，这个解释还需要更多依据。");
  await until(() => request(pathResearch), (r) => r.research.notes.includes("选择成本"), "研究笔记自动保存");
  await page.reload();
  await page.getByLabel("目前的理解", { exact: true }).waitFor();
  check("研究刷新恢复原笔记", (await page.getByLabel("目前的理解", { exact: true }).inputValue()).includes("选择成本"));
  await page.getByRole("button", { name: "资料", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索资料" }).fill("关掉多余工具");
  await page.getByRole("button", { name: "关联资料", exact: true }).first().click();
  await until(() => request(pathResearch), (r) => r.research.references.length === 1, "资料关联");
  check("研究能关联真实原文", true);
  await page.getByRole("button", { name: "研究笔记", exact: true }).click();
  const workspace = await server.xenhoWorkspace;
  const sessionIds = [];
  for (const [title, reply] of [["第一轮讨论", "这是第一轮的未核实解释"], ["第二轮讨论", "这是第二轮的不同假设"]]) {
    const cid = `chat-${createUlid()}`; sessionIds.push(cid); workspace.repository.createEntity({ id: cid, type: "ai_conversation" });
    workspace.db.prepare("INSERT INTO ai_conversations(id,title,scope_type,scope_id,record_json) VALUES(?,?,'global',?,?)").run(cid, title, `research:${id}`, JSON.stringify({ id: cid, title, messages: [{ id: "u", role: "user", text: "请帮我分析", createdAt: new Date().toISOString() }, { id: "a", role: "assistant", text: reply, createdAt: new Date().toISOString() }] }));
  }
  await page.reload();
  await page.getByRole("button", { name: "讨论", exact: true }).click();
  await page.locator(".research-discussion > details > summary").click();
  await page.getByRole("button", { name: "第一轮讨论", exact: true }).click();
  await page.getByText("这是第一轮的未核实解释", { exact: true }).waitFor();
  await page.getByRole("button", { name: "第二轮讨论", exact: true }).click();
  await page.getByText("这是第二轮的不同假设", { exact: true }).waitFor();
  check("同一研究保留多次独立讨论", true);
  const beforeCandidate = (await request(pathResearch)).research.notes;
  await page.getByRole("button", { name: "查看可留下的回答", exact: true }).click();
  await page.getByLabel("研究笔记候选", { exact: true }).waitFor();
  check("预览AI回答不改变研究笔记", (await request(pathResearch)).research.notes === beforeCandidate);
  await page.getByRole("button", { name: "不采用", exact: true }).click();
  await page.getByRole("button", { name: "研究笔记", exact: true }).click();
  const failure = async (route) => route.request().method() === "PUT" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "模拟保存失败" }) }) : route.continue();
  await page.route(`**${pathResearch}`, failure);
  await page.getByLabel("目前的理解", { exact: true }).fill(beforeCandidate + " 保存失败也保留这句话。");
  await page.getByRole("button", { name: "重试", exact: true }).waitFor();
  check("保存失败时研究输入仍在", (await page.getByLabel("目前的理解", { exact: true }).inputValue()).includes("保留这句话"));
  await page.unroute(`**${pathResearch}`, failure);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await until(() => request(pathResearch), (r) => r.research.notes.includes("保留这句话"), "研究重试保存");
  const before = (await request(pathResearch)).research;
  await page.getByRole("button", { name: "写成一篇", exact: true }).click();
  await page.getByLabel("带入文章的内容", { exact: true }).fill("先确定任务，再选工具。");
  await page.getByRole("button", { name: "创建文章", exact: true }).click();
  await page.waitForURL(/#\/project\//);
  const projectId = page.url().split("#/project/")[1];
  await page.locator(".cm-editor").waitFor();
  check("正文在首屏可见", (await page.locator(".cm-editor").boundingBox()).y < 500);
  check("默认不展示构思表单", !(await page.getByLabel("想讲什么", { exact: true }).isVisible()));
  const project = (await request(`/api/workspace/projects/${projectId}`)).project;
  check("研究转文章不自动改写正文", project.masterDraft.body === "");
  check("带入的是用户确认的部分", (await request(`/api/workspace/projects/${projectId}/notebook`)).notebook.thought === "先确定任务，再选工具。");
  check("原研究与原文引用保留", (await request(pathResearch)).research.notes === before.notes && (await request(pathResearch)).research.references.length === 1);
  const editor = page.locator(".cm-content");
  await editor.fill("这是一段用于恢复光标位置的正文。");
  await until(() => request(`/api/workspace/projects/${projectId}`), (r) => r.project.masterDraft.body.includes("恢复光标位置"), "正文自动保存");
  await editor.focus(); await page.keyboard.press("Control+End");
  for (let n = 0; n < 4; n++) await page.keyboard.press("ArrowLeft");
  await new Promise((resolve) => setTimeout(resolve, 350));
  await page.reload(); await editor.waitFor(); await editor.focus();
  await page.waitForFunction(() => {
    const selection = window.getSelection();
    return selection?.anchorNode?.nodeType === Node.TEXT_NODE && selection.anchorOffset === 12;
  });
  await page.keyboard.insertText("再次");
  await until(() => request(`/api/workspace/projects/${projectId}`), (r) => r.project.masterDraft.body.includes("位置再次的正文"), "刷新后在原光标位置继续写");
  check("重新打开可在原光标位置继续写", true);
  await page.screenshot({ path: path.join(shotDir, "product-writing-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "构思", exact: true }).click();
  await page.getByLabel("想讲什么", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭写作辅助", exact: true }).click();
  check("桌面辅助面板可直接关闭", !(await page.getByLabel("想讲什么", { exact: true }).isVisible()));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "构思", exact: true }).click();
  await page.getByLabel("想讲什么", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(shotDir, "product-companion-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "关闭写作辅助", exact: true }).click();
  check("手机辅助面板可直接关闭", !(await page.getByLabel("想讲什么", { exact: true }).isVisible()));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".nav").getByRole("button", { name: "首页", exact: true }).click();
  await page.locator(".work-list article").first().waitFor();
  const researchCard = page.locator(".work-list article").filter({ hasText: "为什么工具越多" });
  await researchCard.getByRole("button", { name: "置顶", exact: true }).click();
  await until(() => request("/api/workspace/recent-work"), (r) => r.items[0]?.id === id && r.items[0].pinned, "置顶");
  await page.screenshot({ path: path.join(shotDir, "product-home-desktop.png"), fullPage: true });
  await researchCard.getByRole("button", { name: "暂时收起", exact: true }).click();
  await researchCard.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "查看暂时收起的工作" }).click();
  await page.getByRole("button", { name: "放回最近", exact: true }).click();
  check("暂时收起后可以恢复", !(await request("/api/workspace/recent-work?includeHidden=1")).items.find((r) => r.id === id).hidden);
  await page.goto(`${base}/#/research/${id}`);
  await page.getByLabel("目前的理解", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(shotDir, "product-research-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(shotDir, "product-research-mobile.png"), fullPage: true });
  check("手机没有横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check("没有浏览器异常", errors.length === 0);
  console.log("产品核心流程验收通过");
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(os.tmpdir(), "xenho-product-failure.png"), fullPage: true }).catch(() => {});
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
