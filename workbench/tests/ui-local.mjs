import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-ui-local-"));
const xenhoHome = path.join(tempRoot, "Xenho");
const shotFile = path.join(tempRoot, "project-workspace.png");
const PORT = 5204;
const oldHome = process.env.XENHO_HOME;
const oldProxy = { HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY };
const oldLifecycle = { WB_LAUNCHER: process.env.WB_LAUNCHER, WB_KEEP_ALIVE: process.env.WB_KEEP_ALIVE };
process.env.XENHO_HOME = xenhoHome;
// 测试自己负责关闭 Vite；即使本机 .env 带有桌面启动标记，也不能让自动退出计时中断验收。
process.env.WB_KEEP_ALIVE = "1";
process.env.HTTP_PROXY = "http://127.0.0.1:9";
process.env.HTTPS_PROXY = "http://127.0.0.1:9";
process.env.NO_PROXY = "127.0.0.1,localhost";

function playwright() {
  const require = createRequire(import.meta.url);
  const roots = [ROOT, "C:/Users/Lenovo", process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : ""];
  for (const root of roots.filter(Boolean)) {
    try {
      return require(require.resolve("playwright", { paths: [root] }));
    } catch {}
  }
  throw new Error("找不到 playwright");
}

const check = (name, pass, detail = "") => {
  assert(pass, detail || name);
  console.log(` ✓ ${name}`);
};

async function request(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

let server;
let browser;
try {
  server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, "vite.config.mjs"),
    server: { port: PORT, strictPort: true, open: false },
    logLevel: "error",
  });
  await server.listen();

  const status = await request("/api/workspace/status");
  check("服务读取隔离 SQLite 工作区", status.ready && status.workspaceId);
  check("没有触碰真实工作区", path.resolve(xenhoHome).startsWith(path.resolve(os.tmpdir())));

  const created = await request("/api/workspace/projects", {
    method: "POST",
    body: JSON.stringify({
      kind: "draft",
      title: "阶段六隔离稿",
      body: "# 阶段六隔离稿\n\n这是临时工作区里的初稿。",
      viewpoint: "本地优先必须能离线持续写作",
      audience: "个人内容创作者",
      platform: "公众号",
    }),
  });
  const projectId = created.project.id;

  const { chromium } = playwright();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/i.test(message.text())) errors.push(message.text());
  });

  await page.goto(`http://127.0.0.1:${PORT}/#/project/${encodeURIComponent(projectId)}`);
  await page.waitForSelector(".md-editor__cm .cm-content");
  await page.getByText("阶段六隔离稿", { exact: true }).first().waitFor();
  check("项目页渲染 SQLite 中的初稿", await page.locator(".cm-content").innerText().then((text) => text.includes("这是临时工作区里的初稿")));

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\n刷新后仍然存在的修改。");
  await page.waitForTimeout(1800);
  const saved = await request(`/api/workspace/projects/${encodeURIComponent(projectId)}`);
  check("编辑器自动保存写入隔离 SQLite", saved.project.masterDraft.body.includes("刷新后仍然存在的修改"));

  if (process.argv.includes("--shots")) await page.screenshot({ path: shotFile, fullPage: true });
  await page.reload();
  await page.waitForSelector(".md-editor__cm .cm-content");
  check("刷新后从 SQLite 重新读到正文", await page.locator(".cm-content").innerText().then((text) => text.includes("刷新后仍然存在的修改")));

  await page.locator('button[title^="设置："]').click();
  await page.getByRole("dialog", { name: "设置" }).waitFor();
  const settingsText = await page.getByRole("dialog", { name: "设置" }).innerText();
  check("设置只展示本地工作区和本机能力", settingsText.includes("工作区") && settingsText.includes("模型") && !settingsText.includes("流水线") && !settingsText.includes("飞书"));
  await page.keyboard.press("Escape");

  check("真实浏览器没有页面异常", errors.length === 0, errors.join("\n"));
  if (process.argv.includes("--shots")) console.log(` 截图：${shotFile}`);
  console.log("\n阶段 6 本地 UI 验证通过。");
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await server?.xenhoClose?.().catch(() => {});
  if (oldHome == null) delete process.env.XENHO_HOME;
  else process.env.XENHO_HOME = oldHome;
  for (const [key, value] of Object.entries(oldProxy)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  for (const [key, value] of Object.entries(oldLifecycle)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  if (process.env.XENHO_KEEP_TEST_TEMP !== "1") await fs.rm(tempRoot, { recursive: true, force: true });
}
