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
      body: "# 阶段六隔离稿\n\n这是临时工作区里的初稿。\n\n## 后续章节\n\n这段内容在图片后面。",
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
  await page.locator(".cm-line").first().click();
  check("选中标题行仍只显示排版结果", await page.locator(".cm-line").first().innerText().then((text) => !text.includes("#")));

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\n刷新后仍然存在的修改。");
  await page.waitForTimeout(1800);
  let saved = await request(`/api/workspace/projects/${encodeURIComponent(projectId)}`);
  check("编辑器自动保存写入隔离 SQLite", saved.project.masterDraft.body.includes("刷新后仍然存在的修改"));

  const lines = page.locator(".cm-line");
  const secondHeadingIndex = (await lines.allInnerTexts()).findIndex((text) => text.includes("后续章节"));
  check("找到两段正文之间的插图位置", secondHeadingIndex > 0);
  await lines.nth(secondHeadingIndex - 1).click();
  await page.keyboard.type("/");
  await page.getByRole("listbox", { name: "可插入的区块" }).waitFor();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("option", { name: "图片" }).click();
  await (await chooser).setFiles({
    name: "正文] 配图.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByText("正在插入图片…").waitFor({ state: "hidden" });
  const inlineImage = page.locator(".cm-lp-media img").last();
  await inlineImage.waitFor();
  check("插入图片后正文就地显示预览", await inlineImage.evaluate((image) => image.complete && image.naturalWidth > 0));
  await page.keyboard.press("Backspace");
  await inlineImage.waitFor();
  check("删除图片后的空行且光标停在图片行时仍保持预览", await page.locator(".cm-content").innerText().then((text) => !text.includes("asset://")));
  await page.waitForTimeout(1800);
  saved = await request(`/api/workspace/projects/${encodeURIComponent(projectId)}`);
  const assetId = saved.project.masterDraft.body.match(/!\[正文 配图\]\(asset:\/\/([^\s)]+)\)/)?.[1];
  check("正文只保存稳定的图片资源引用", Boolean(assetId));
  check("删除图片后的空行不会删除图片", saved.project.masterDraft.body.includes(`asset://${assetId})\n## 后续章节`));
  const imageResponse = await fetch(`http://127.0.0.1:${PORT}/api/workspace/assets/${encodeURIComponent(assetId)}`);
  check("图片读取端点返回真实图片类型", imageResponse.headers.get("content-type") === "image/png");

  // 模拟旧交互已经误删最后一个右括号的正文，只验证容错显示，不由界面静默修正文。
  const malformedBody = saved.project.masterDraft.body.replace(`asset://${assetId})`, `asset://${assetId}`);
  await request(`/api/workspace/drafts/${encodeURIComponent(saved.project.masterDraft.id)}/save`, {
    method: "POST",
    body: JSON.stringify({
      title: saved.project.masterDraft.title,
      body: malformedBody,
      expectedVersion: saved.project.masterDraft.version,
    }),
  });

  if (process.argv.includes("--shots")) await page.screenshot({ path: shotFile, fullPage: true });
  await page.reload();
  await page.waitForSelector(".md-editor__cm .cm-content");
  check("刷新后从 SQLite 重新读到正文", await page.locator(".cm-content").innerText().then((text) => text.includes("刷新后仍然存在的修改")));
  const restoredImage = page.locator(".cm-lp-media img").last();
  await restoredImage.waitFor();
  check("缺少右括号的历史图片引用仍能显示", await restoredImage.evaluate((image) => image.complete && image.naturalWidth > 0));
  const unchanged = await request(`/api/workspace/projects/${encodeURIComponent(projectId)}`);
  check("容错显示不会静默改写正文", unchanged.project.masterDraft.body.includes(`asset://${assetId}\n## 后续章节`));

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
