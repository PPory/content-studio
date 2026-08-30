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
const seriesShotFile = path.join(os.tmpdir(), "xenho-series-workspace.png");
const seriesOutlineShotFile = path.join(os.tmpdir(), "xenho-series-outline.png");
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

  await page.goto(`http://127.0.0.1:${PORT}/#/series`);
  await page.getByRole("button", { name: "新建合集" }).click();
  const createSeriesDialog = page.getByRole("dialog", { name: "新建合集" });
  await createSeriesDialog.getByLabel("合集名称").fill("本地内容工作台");
  await createSeriesDialog.getByLabel("合集说明").fill("收录与本地内容系统有关的文章");
  await createSeriesDialog.getByRole("button", { name: "建立合集" }).click();
  const seriesTitle = page.getByRole("textbox", { name: "合集名称", exact: true });
  await seriesTitle.waitFor();
  check("新建合集后进入合集工作区", await seriesTitle.inputValue() === "本地内容工作台");
  const emptyCollection = page.getByText("这个合集还是空的。添加已有文章，或者直接新建一篇。", { exact: true });
  await emptyCollection.waitFor({ state: "attached" });
  check("新合集从空文件夹开始", await emptyCollection.count() === 1);

  await page.getByRole("button", { name: "添加已有文章" }).click();
  const linkDialog = page.getByRole("dialog", { name: "添加文章到合集" });
  await linkDialog.getByRole("button", { name: /阶段六隔离稿/ }).click();
  const existingArticle = page.locator(".series-chapter").filter({ hasText: "阶段六隔离稿" });
  await existingArticle.getByRole("button", { name: "打开文章" }).waitFor();
  check("已有文章可以直接放入合集", await existingArticle.isVisible());

  await page.getByRole("button", { name: "在合集中新建" }).click();
  await page.waitForSelector(".md-editor__cm .cm-content");
  await page.getByText("第 2/2 篇 · 本地内容工作台", { exact: true }).waitFor();
  await page.getByLabel("主稿标题").fill("合集内新建稿");
  await page.locator(".cm-content").click();
  await page.keyboard.type("这是一篇直接在合集中建立的文章。");
  await page.waitForTimeout(1800);
  check("在合集中新建仍进入原有单篇编辑器", await page.getByLabel("主稿标题").inputValue() === "合集内新建稿");
  await page.locator(".project-back").click();
  await page.waitForSelector(".series-workspace");
  const newArticle = page.locator(".series-chapter").filter({ hasText: "合集内新建稿" });
  await newArticle.getByRole("button", { name: "上移" }).click();
  await page.getByText("文章顺序已更新", { exact: true }).waitFor();
  await page.reload();
  await seriesTitle.waitFor();
  const chapterTitles = await page.locator(".series-chapter__title strong").allInnerTexts();
  check("合集归类、顺序和新文章刷新后仍然存在", chapterTitles[0] === "合集内新建稿" && chapterTitles[1] === "阶段六隔离稿");
  if (process.argv.includes("--shots")) {
    await page.screenshot({ path: seriesShotFile, fullPage: true });
    await page.locator(".series-outline").screenshot({ path: seriesOutlineShotFile });
  }

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


  const insertFromSlash = async (label) => {
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\n/");
    await page.getByRole("listbox", { name: "可插入的区块" }).waitFor();
    await page.getByRole("option", { name: label, exact: true }).click();
  };

  await insertFromSlash("待办事项");
  await page.keyboard.type("核对文章标题");
  const todoBlock = page.locator(".cm-lp-todo").last();
  await todoBlock.waitFor();
  await todoBlock.click();
  check("待办事项可以在正文里直接勾选", await todoBlock.getAttribute("aria-checked") === "true");

  await insertFromSlash("标注");
  await page.keyboard.type("这是需要读者记住的结论。");
  check("标注插入后直接呈现为可编辑信息块", await page.locator(".cm-lp-callout-label").last().innerText() === "标注");

  await insertFromSlash("引用");
  await page.keyboard.type("真正重要的是把判断讲清楚。");
  check("引用插入后直接呈现引用样式", await page.locator(".cm-line.cm-lp-quote").last().innerText().then((text) => text.includes("真正重要")));

  await insertFromSlash("代码块");
  await page.keyboard.type("const answer = 42;");
  check("代码块隐藏围栏并保留可编辑代码", await page.locator(".cm-line.cm-lp-code-block").allInnerTexts().then((items) => items.some((text) => text.includes("const answer = 42;")) && items.every((text) => !text.includes(String.fromCharCode(96).repeat(3)))));

  await insertFromSlash("表格");
  const tableBlock = page.locator(".cm-lp-table").last();
  await tableBlock.waitFor();
  const tableBox = await tableBlock.boundingBox();
  const tableGridBox = await tableBlock.locator("table").boundingBox();
  check("表格上下不再预留多行空白", tableBox.height - tableGridBox.height <= 24);
  let tableInputs = tableBlock.locator("input");
  const tableValues = [
    "观点", "依据", "结论",
    "先验证", "真实操作", "可复现",
    "后验证", "保存结果", "可追溯",
  ];
  for (const [index, value] of tableValues.entries()) await tableInputs.nth(index).fill(value);
  check("表格默认提供三行三列", await tableInputs.count() === 9);

  const addRow = tableBlock.getByRole("button", { name: "添加一行" });
  const addColumn = tableBlock.getByRole("button", { name: "添加一列" });
  check("新增行入口平时隐藏", await addRow.evaluate((node) => getComputedStyle(node).opacity === "0"));
  await addRow.hover();
  await page.waitForTimeout(150);
  check("只有鼠标到表格下方时才显示新增行入口", await addRow.evaluate((node) => getComputedStyle(node).opacity === "1"));
  if (process.argv.includes("--table-shots")) {
    const output = path.join(ROOT, "output", "playwright");
    await fs.mkdir(output, { recursive: true });
    await tableBlock.screenshot({ path: path.join(output, "table-add-row.png") });
  }
  await addColumn.hover();
  await page.waitForTimeout(150);
  check("鼠标到表格右侧时显示新增列入口", await addColumn.evaluate((node) => getComputedStyle(node).opacity === "1"));
  if (process.argv.includes("--table-shots")) {
    await tableBlock.screenshot({ path: path.join(ROOT, "output", "playwright", "table-add-column.png") });
  }

  await tableBlock.getByRole("button", { name: "移动第 3 行" }).dragTo(
    tableBlock.getByRole("button", { name: "移动第 2 行" }),
  );
  tableInputs = tableBlock.locator("input");
  check("拖动行手柄可以交换行位置",
    await tableInputs.nth(3).inputValue() === "后验证"
    && await tableInputs.nth(6).inputValue() === "先验证");

  await tableBlock.getByRole("button", { name: "移动第 3 列" }).dragTo(
    tableBlock.getByRole("button", { name: "移动第 1 列" }),
  );
  tableInputs = tableBlock.locator("input");
  check("拖动列手柄可以交换列位置",
    await tableInputs.nth(0).inputValue() === "结论"
    && await tableInputs.nth(1).inputValue() === "观点");

  await addRow.click();
  check("表格下方入口可以添加一整行", await tableBlock.locator("input").count() === 12);
  await addColumn.click();
  check("表格右侧入口可以添加一整列", await tableBlock.locator("input").count() === 16);

  await page.waitForTimeout(1800);
  const compactTableSaved = await request("/api/workspace/projects/" + encodeURIComponent(projectId));
  check("插入表格后正文只保留一个续写空行", /\|  \|  \|  \|  \|\n$/.test(compactTableSaved.project.masterDraft.body));

  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/");
  await page.getByRole("listbox", { name: "可插入的区块" }).waitFor();
  await page.getByRole("option", { name: "分隔线", exact: true }).click();
  await page.locator(".cm-lp-rule").last().waitFor();
  await page.waitForTimeout(1800);
  const blocksSaved = await request("/api/workspace/projects/" + encodeURIComponent(projectId));
  const blocksBody = blocksSaved.project.masterDraft.body;
  const fence = String.fromCharCode(96).repeat(3);
  check("内容块仍以可移植 Markdown 保存", [
    "- [x] 核对文章标题",
    "> [!note]\n> 这是需要读者记住的结论。",
    "> 真正重要的是把判断讲清楚。",
    fence + "\nconst answer = 42;\n" + fence,
    "| 结论 | 观点 | 依据 |  |",
    "| 可追溯 | 后验证 | 保存结果 |  |",
    "| 可复现 | 先验证 | 真实操作 |  |",
  ].every((part) => blocksBody.includes(part)));
  check("分割线不会在上方制造多余空行", !/\n{3,}---/.test(blocksBody));

  await page.locator('button[title^="设置："]').click();
  await page.getByRole("dialog", { name: "设置" }).waitFor();
  const settingsText = await page.getByRole("dialog", { name: "设置" }).innerText();
  check("设置只展示本地工作区和本机能力", settingsText.includes("工作区") && settingsText.includes("模型") && !settingsText.includes("流水线") && !settingsText.includes("飞书"));
  await page.keyboard.press("Escape");

  check("真实浏览器没有页面异常", errors.length === 0, errors.join("\n"));
  if (process.argv.includes("--shots")) console.log(` 截图：${shotFile}\n 合集截图：${seriesShotFile}\n 文章列表截图：${seriesOutlineShotFile}`);
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
