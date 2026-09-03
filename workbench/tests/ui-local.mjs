import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { createBookRecord } from "../server/routes/books-local.mjs";
import { applyWikiCompile, captureWikiSourceSnapshot } from "../server/domain/wiki-pages.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-ui-local-"));
const xenhoHome = path.join(tempRoot, "Xenho");
const shotFile = path.join(tempRoot, "project-workspace.png");
const seriesShotFile = path.join(os.tmpdir(), "xenho-series-workspace.png");
const seriesOutlineShotFile = path.join(os.tmpdir(), "xenho-series-outline.png");
const seriesReadShotFile = path.join(os.tmpdir(), "xenho-series-read.png");
const seriesListShotFile = path.join(os.tmpdir(), "xenho-series-list.png");
const wikiHomeShotFile = path.join(os.tmpdir(), "xenho-wiki-home.png");
const wikiArticleShotFile = path.join(os.tmpdir(), "xenho-wiki-article.png");
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

  const workspace = await server.xenhoWorkspace;
  const evidenceQuote = "知识来源跳转必须打开准确章节，并高亮用户正在核对的逐字原文。";
  const evidenceBook = await createBookRecord(workspace, {
    title: "UI 证据来源", kind: "藏书", sourceKind: "文章",
    chapters: [{ title: "证据章节", text: `# 证据章节\n\n${evidenceQuote}\n\n这是隔离浏览器测试的后续段落。` }],
  });
  const evidenceDocId = workspace.db.prepare("SELECT id FROM book_documents WHERE book_id=?").get(evidenceBook.id).id;
  const evidenceSnapshot = captureWikiSourceSnapshot(workspace, evidenceDocId);
  applyWikiCompile(workspace, {
    proposal: {
      sourceId: evidenceDocId,
      sourceSnapshotId: evidenceSnapshot.id,
      sourceContentSha256: evidenceSnapshot.contentSha256,
      sourceLocator: "UI 证据来源 · 证据章节",
      title: "编译 UI 证据来源",
      compilationSummary: "建立来源资料卡，并把来源精准跳转编入可持续维护的 Wiki 页面。",
      pages: [
        {
          action: "create", title: "来源：UI 证据来源 · 证据章节", pageType: "source_summary",
          summary: "记录准确打开并核对 Raw 来源的测试资料。",
          bodyMarkdown: `# 来源：UI 证据来源 · 证据章节\n\n${evidenceQuote}\n\n这份资料用于验证 Wiki 页面能够回到准确的原始章节。`,
          changeSummary: "为 Raw 建立来源资料卡", citations: [{ quote: evidenceQuote, contribution: "支撑准确定位" }],
          links: [{ toTitle: "来源精准跳转", relation: "支撑", why: "原文说明准确定位要求" }],
        },
        {
          action: "create", title: "来源精准跳转", pageType: "method",
          summary: "从 Wiki 页面回到准确 Raw 章节并高亮逐字证据的方法。",
          bodyMarkdown: `# 来源精准跳转\n\nWiki 的结论必须能够回到 AI 当时读过的原文，而不是只显示一个模糊来源名。\n\n## 验收标准\n\n${evidenceQuote}\n\n返回时应回到刚才阅读的 Wiki 页面。`,
          changeSummary: "把来源核对方式编成可复用页面", citations: [{ quote: evidenceQuote, contribution: "定义来源跳转要求" }],
          links: [{ toTitle: "来源：UI 证据来源 · 证据章节", relation: "依据来自", why: "方法由该 Raw 支撑" }],
        },
      ],
    },
  });
  const reviewPage = workspace.db.prepare(`SELECT id,title,page_type AS pageType,summary,body_markdown AS bodyMarkdown,current_revision AS revision
    FROM wiki_pages WHERE title='来源精准跳转'`).get();
  const sourceReviewCandidate = workspace.domain.actions.propose({
    actionType: "wiki.pages.apply", targetId: evidenceDocId, proposedBy: "ai",
    payload: {
      kind: "wiki.compile", sourceId: evidenceDocId, sourceSnapshotId: evidenceSnapshot.id,
      sourceContentSha256: evidenceSnapshot.contentSha256, sourceLocator: "UI 证据来源 · 证据章节",
      title: "编译 UI 证据来源", compilationSummary: "把新的来源导航建议编入既有页面。",
      readMode: "full", chunksRead: 1, model: "ui-test",
      pages: [{
        pageId: reviewPage.id, expectedRevision: reviewPage.revision, action: "update",
        title: reviewPage.title, pageType: reviewPage.pageType, summary: reviewPage.summary,
        bodyMarkdown: `${reviewPage.bodyMarkdown}\n\n## 审阅候选\n\n这段内容只有确认后才会进入页面。`,
        beforeBodyMarkdown: reviewPage.bodyMarkdown, changeSummary: "验证来源页可以直达对应审阅候选",
        citations: [{ sourceId: evidenceDocId, sourceSnapshotId: evidenceSnapshot.id, sourceContentSha256: evidenceSnapshot.contentSha256, quote: evidenceQuote, contribution: "支撑准确定位" }],
        links: [{ toTitle: "来源：UI 证据来源 · 证据章节", relation: "依据来自", why: "方法由该 Raw 支撑" }],
      }], rejected: [],
    },
  });
  workspace.db.prepare(`INSERT INTO source_ingests(source_entity_id,status,candidate_id,source_content_sha256,run_at)
    VALUES (?,'proposed',?,?,?) ON CONFLICT(source_entity_id) DO UPDATE SET status='proposed',candidate_id=excluded.candidate_id,
      source_content_sha256=excluded.source_content_sha256,error='',run_at=excluded.run_at`)
    .run(evidenceDocId, sourceReviewCandidate.id, evidenceSnapshot.contentSha256, new Date().toISOString());
  const wikiPagesBeforeReview = workspace.db.prepare("SELECT COUNT(*) AS count FROM wiki_pages").get().count;
  workspace.domain.actions.propose({
    actionType: "wiki.lint.review", targetId: null, proposedBy: "ai",
    payload: {
      kind: "wiki.lint.report", mode: "network", model: "ui-test",
      deterministic: { orphans: 0, missingCitations: 0 },
      findings: [
        {
          type: "missing_link", pages: ["来源精准跳转", "来源：UI 证据来源 · 证据章节"],
          problem: "两个页面共同描述来源核对流程，但缺少明确的双向导航。",
          suggestion: "后续生成具体页面修订候选，再由用户确认是否写入。",
        },
        {
          type: "source_gap", pages: ["来源精准跳转"],
          problem: "一项可能随版本变化的能力描述缺少新的官方依据。",
          suggestion: "补充可靠的新来源后再修订页面。",
        },
      ],
    },
  });
  const researchReviewCandidate = workspace.domain.actions.propose({
    actionType: "wiki.sources.import", targetId: null, proposedBy: "ai",
    payload: {
      kind: "wiki.research", reportCandidateId: "", selectedFindingIndexes: [1],
      selectedFindings: [{ type: "source_gap", pages: ["来源精准跳转"], suggestion: "补充可靠的新来源" }],
      sources: [{
        sourceKey: "source:0", findingIndexes: [1], title: "来源精准跳转官方说明",
        url: "https://example.com/wiki-source", author: "示例作者", siteName: "Example",
        publishedAt: "2026-09-01", words: 680, excerpt: "这是一份等待人工确认的公开网页摘要，确认前不会进入 Raw，也不会修改 Wiki。",
        bodyMarkdown: "# 来源精准跳转官方说明\n\n完整公开网页正文。",
        why: "补充可靠的新来源",
      }],
      failures: [],
    },
  });

  const { chromium } = playwright();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/i.test(message.text())) errors.push(message.text());
  });

  // ── 今日：四条链的值班台 ─────────────────────────────────────────
  //
  // ⚠️ 这一页原来只读 projects，也就是只覆盖内容和运营两条链。
  // 验的是**四条链都在屏幕上**，以及**没事的那条如实说没事**——
  // 后者比前者更容易退化：为了让屏幕不空而硬凑一件待办，是这块板唯一的死法。
  await page.goto(`http://127.0.0.1:${PORT}/#/today`);
  const board = page.getByRole("region", { name: "四条链的下一步" });
  await board.waitFor();
  for (const name of ["知识", "内容", "情报", "运营"]) {
    check(`值班台上有「${name}」这条链`, await board.getByText(name, { exact: true }).count() === 1);
  }

  // 有事的那两条：给的是动作，不是库存
  check("知识那条先说等着点头的，不是那个更大的「还没提炼」",
    await board.getByText("条提炼候选等着你点头").count() === 1
    && await board.getByRole("button", { name: /去审/ }).count() === 1);
  check("内容那条在证据层薄的时候直接说出来",
    await board.getByText(/扫描还看不出反复/).count() === 1);

  // ⚠️ 没事的那两条：**这块板唯一的死法是为了不空而硬凑一件待办**
  check("没事的链如实说没事，不硬凑", await board.getByText("现在没事").count() === 2);
  check("没事的时候改说这条链是干什么的",
    await board.getByText("我知道外面在发生什么").count() === 1);
  // ⚠️ 整张卡就是按钮：卡里再放一颗按钮，等于同一格里有两个可点的东西，
  // 而它们干的是同一件事——键盘走一遍会停两次。
  check("整张卡可点，不是卡里再塞一颗按钮",
    await board.getByRole("button").count() === 4);

  // 一级导航按四条链命名：情报不叫「发现」，运营不叫「复盘」
  check("侧栏用四条链的名字", await page.getByRole("link", { name: "情报" }).count()
    + await page.getByRole("button", { name: "情报" }).count() >= 1);

  // ── 合集：建 → 从文章列表归类 → 在合集中新建 → 排序 → 分节 → 通读 ──
  //
  // ⚠️ **归类走的是文章列表那条路**，不是「进合集再添加」。那条新路径正是这次
  // 重做要修的东西；只测老路的话，改坏了也测不出来。
  await page.goto(`http://127.0.0.1:${PORT}/#/series`);
  await page.getByRole("button", { name: "新建合集" }).click();
  const createSeriesDialog = page.getByRole("dialog", { name: "新建合集" });
  await createSeriesDialog.getByLabel("合集名称").fill("本地内容工作台");
  await createSeriesDialog.getByRole("button", { name: "建立合集" }).click();
  const seriesTitle = page.getByRole("textbox", { name: "合集名称", exact: true });
  await seriesTitle.waitFor();
  check("新建合集后进入合集目录页", await seriesTitle.inputValue() === "本地内容工作台");
  check("目录页不再有「保存合集」按钮", await page.getByRole("button", { name: "保存合集" }).count() === 0);
  await page.getByText("这个合集还是空的。把已有文章放进来，或者直接在这里开始写第一篇。").waitFor();

  await page.goto(`http://127.0.0.1:${PORT}/#/content`);
  await page.getByRole("button", { name: "把「阶段六隔离稿」放进合集" }).click();
  const filePicker = page.getByRole("dialog", { name: "把这篇文章放进合集" });
  await filePicker.getByRole("checkbox").first().check();
  await filePicker.getByRole("button", { name: "确认" }).click();
  await page.getByText("已放进 1 个合集").waitFor();
  check("从文章列表就能归类，并在行上显示所属合集", await page.locator(".ptable__series").filter({ hasText: "本地内容工作台" }).count() === 1);

  await page.goto(`http://127.0.0.1:${PORT}/#/series`);
  await page.locator(".series-card__open").filter({ hasText: "本地内容工作台" }).click();
  await seriesTitle.waitFor();
  await page.getByRole("button", { name: "在合集中新建" }).click();
  await page.waitForSelector(".md-editor__cm .cm-content");
  await page.locator(".project-collection").filter({ hasText: "本地内容工作台" }).waitFor();
  await page.getByLabel("主稿标题").fill("合集内新建稿");
  await page.locator(".cm-content").click();
  await page.keyboard.type("这是一篇直接在合集中建立的文章。");
  await page.waitForTimeout(1800);
  check("在合集中新建仍进入原有单篇编辑器", await page.getByLabel("主稿标题").inputValue() === "合集内新建稿");

  await page.locator(".project-back").click();
  await page.waitForSelector(".series-outline");
  await page.getByRole("button", { name: "「合集内新建稿」的操作" }).click();
  await page.getByRole("menuitem", { name: /上移/ }).click();
  await page.waitForTimeout(600);

  // 分节：教程知识库要能分「入门 / 进阶」
  await page.getByRole("button", { name: "插入分节" }).click();
  await page.getByLabel("新分节标题").fill("入门");
  await page.getByLabel("新分节标题").blur();
  await page.getByText("已插入分节").waitFor();

  await page.reload();
  await seriesTitle.waitFor();
  const outlineTitles = await page.locator(".series-row__title").allInnerTexts();
  check("合集归类、顺序、分节刷新后仍然存在",
    outlineTitles[0] === "合集内新建稿"
    && outlineTitles[1] === "阶段六隔离稿"
    && await page.locator(".series-row__section").innerText() === "入门");

  // 通读：把整个合集拼成一条连续正文，空正文的那一篇要留下痕迹
  await page.getByRole("button", { name: "通读" }).click();
  const reader = page.getByRole("dialog", { name: /通读/ });
  await reader.waitFor();
  const readerText = await reader.innerText();
  check("通读按顺序拼出整个合集，并标出还没写正文的那一篇",
    readerText.includes("这是一篇直接在合集中建立的文章。")
    && readerText.includes("这是临时工作区里的初稿")
    && readerText.includes("入门"));
  if (process.argv.includes("--shots")) await page.screenshot({ path: seriesReadShotFile, fullPage: true });
  await reader.getByRole("button", { name: "关闭通读" }).click();

  if (process.argv.includes("--shots")) {
    await page.screenshot({ path: seriesShotFile, fullPage: true });
    await page.locator(".series-outline").screenshot({ path: seriesOutlineShotFile });
    // 合集列表页以前没有截图目标，而它正是这次改动最大的一块
    await page.goto(`http://127.0.0.1:${PORT}/#/series`);
    await page.locator(".series-card").first().waitFor();
    await page.screenshot({ path: seriesListShotFile, fullPage: true });
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

  // 后半段用常见的 1600×640 桌面窗口验收长列表；默认测试窗口下样本来源太少，页面没有滚动空间。
  await page.setViewportSize({ width: 1600, height: 640 });
  await page.goto(`http://127.0.0.1:${PORT}/#/entries`);
  await page.goto("http://127.0.0.1:" + PORT + "/#/sources");
  const sourceName = page.getByRole("button", { name: "UI 证据来源", exact: true });
  await sourceName.waitFor();
  await page.getByRole("button", { name: "添加来源", exact: true }).click();
  const importPanel = page.locator(".src-import");
  await importPanel.waitFor();
  check("来源面板只保留文件、链接和文字三种入口", await importPanel.getByRole("button", { name: "上传文件", exact: true }).count() === 1
    && await importPanel.getByRole("button", { name: "粘贴链接", exact: true }).count() === 1
    && await importPanel.getByRole("button", { name: "粘贴文字", exact: true }).count() === 1
    && !/作者|平台|发布时间|显示名称/.test(await importPanel.innerText()));
  await importPanel.getByRole("button", { name: "粘贴链接", exact: true }).click();
  check("粘贴链接会进入自动读取网页正文的单一输入", await importPanel.getByPlaceholder("https://…").count() === 1
    && (await importPanel.innerText()).includes("自动读取网页正文"));
  await importPanel.getByRole("button", { name: "粘贴文字", exact: true }).click();
  check("粘贴文字明确保持为一份完整来源", await importPanel.getByPlaceholder("粘贴文章、笔记或课程章节全文…").count() === 1
    && (await importPanel.innerText()).includes("正文保持为一份完整来源"));
  await page.getByRole("button", { name: "添加来源", exact: true }).click();
  const sourceHeaderBox = await page.getByRole("columnheader", { name: "名称" }).boundingBox();
  const sourceNameBox = await sourceName.boundingBox();
  check("来源表头名称与内容名称处在同一列", sourceHeaderBox && sourceNameBox && Math.abs(sourceHeaderBox.x - sourceNameBox.x) < 2);
  await page.getByRole("button", { name: "删除来源 UI 证据来源" }).click();
  const sourceDeleteDialog = page.getByRole("dialog", { name: /删除.*UI 证据来源/ });
  await sourceDeleteDialog.waitFor();
  check("来源删除必须二次确认并说明 Wiki 与证据保留", (await sourceDeleteDialog.innerText()).includes("已有 Wiki 页面不会被删除")
    && (await sourceDeleteDialog.innerText()).includes("历史证据快照会保留"));
  await sourceDeleteDialog.getByRole("button", { name: "取消" }).click();
  await page.getByRole("button", { name: "添加来源", exact: true }).click();
  await page.locator(".main").evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  const sourceToTop = page.getByRole("button", { name: "返回来源顶部" });
  await sourceToTop.waitFor();
  await sourceToTop.click();
  await page.waitForFunction(() => document.querySelector(".main")?.scrollTop < 10);
  check("来源列表滚动后提供悬浮返回顶部按钮", await sourceToTop.count() === 0);
  await page.getByRole("button", { name: "添加来源", exact: true }).click();

  const selectAllArticles = page.getByRole("checkbox", { name: "全选文章" });
  await selectAllArticles.click();
  check("来源表头可全选当前分组", await selectAllArticles.isChecked()
    && (await page.getByText(/已选 1 份/).count()) === 1);
  await selectAllArticles.click();

  await page.getByRole("button", { name: "审阅 UI 证据来源 的 Wiki 编译候选" }).click();
  await page.waitForURL((url) => decodeURIComponent(url.hash) === `#/entries/review:${evidenceBook.id}`);
  const focusedCandidate = page.locator(`[id="knowledge-candidate-${sourceReviewCandidate.id}"]`);
  await focusedCandidate.waitFor();
  await focusedCandidate.locator(".ing__body").waitFor();
  check("来源的待审阅状态可以直达并展开对应候选", await focusedCandidate.locator(".ing__title").getAttribute("aria-expanded") === "true");
  await page.goto("http://127.0.0.1:" + PORT + "/#/sources");
  await sourceName.waitFor();

  // ⚠️ **这份来源只有一节，所以点标题直接进阅读器**，没有「先展开再点章节」那一步。
  // 展开只会得到一行同名、同字数、同状态的自己，那次点击不产生任何信息。
  check("单节来源不摆展开箭头", await sourceName.getAttribute("aria-expanded") === null);
  await sourceName.click();
  const returnToSources = page.getByRole("button", { name: "返回来源" });
  await returnToSources.waitFor();
  await returnToSources.click();
  await page.waitForURL((url) => url.hash === "#/sources");
  check("从来源打开正文后会返回来源页", page.url().endsWith("#/sources"));

  await page.goto("http://127.0.0.1:" + PORT + "/#/entries");
  /**
   * ⚠️ **不再等「我的 Wiki」那个大标题——它连同整块 hero 一起撤了。**
   * 页名由外壳页头给（「知识 / Wiki」），页面数进页头的计数位，
   * 其余数字退成索引上方那一行注脚（`.wiki-bar__facts`）。
   * 这里量的仍然是同一件事：**编译之后页面数和连接数都真的涨了**。
   */
  await page.locator(".wiki-bar").waitFor();
  check("Wiki 页面数进外壳页头的计数位", (await page.locator(".view-head__count").innerText()).includes("2 张页面"));
  const wikiFacts = await page.locator(".wiki-bar__facts").innerText();
  check("Wiki 首页展示持续编译后的完整页面与知识连接", /2\s*条连接/.test(wikiFacts));
  check("Wiki 搜索复用统一搜索框并提供清空能力", await page.getByLabel("搜索 Wiki").count() === 1);
  await page.getByLabel("搜索 Wiki").fill("不存在的页面");
  check("Wiki 搜索没有结果时给出明确反馈", await page.getByText(/没有找到“不存在的页面”/).count() === 1);
  await page.getByRole("button", { name: "清空搜索" }).click();

  /**
   * ⚠️ **待审阅从 Wiki 首页搬到了 `#/entries/review`。**
   * 首页只留一行入口（`.wiki-todo`）——审阅要整页宽度读 diff，索引要一条能扫的长列表，
   * 两件事挤在一屏时两边都不好用。这里顺带验一次那行入口真的能进去。
   */
  const wikiTodo = page.locator(".wiki-todo");
  await wikiTodo.waitFor();
  check("Wiki 首页只留一行待审阅入口，列表已搬走", (await wikiTodo.innerText()).includes("候选等你审阅")
    && await page.locator(".ing__row").count() === 0);
  await wikiTodo.click();
  await page.waitForURL((url) => url.hash === "#/entries/review");
  await page.locator(".ing__row").first().waitFor();

  const researchCandidateCard = page.locator(`[id="knowledge-candidate-${researchReviewCandidate.id}"]`);
  await researchCandidateCard.getByRole("button", { name: /补充来源候选/ }).click();
  /**
   * ⚠️ **来源名要在**展开后的来源卡**里找，不能在整条候选里数「出现一次」。**
   * 折叠那一行现在会先把这条候选会碰到的东西列出来（补充来源候选列的就是来源名），
   * 所以同一个标题在一条候选里合法地出现两次：一次是概览，一次是可核对的卡片。
   * 这条断言要的是后者——「确认前能逐条核对」——所以范围限定在 `.ing__sources`。
   */
  check("搜索结果以可核对来源卡片展示，确认前不会写入", await researchCandidateCard.locator(".ing__sources").getByText("来源精准跳转官方说明", { exact: true }).count() === 1
    && await researchCandidateCard.getByRole("link", { name: "查看原文" }).count() === 1
    && await researchCandidateCard.getByRole("button", { name: "导入所选并开始编译（1）" }).count() === 1
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM books WHERE source_url=?").get("https://example.com/wiki-source").count === 0);
  await page.getByRole("button", { name: /全库体检报告/ }).click();
  check("体检报告把问题、影响页面和建议分开呈现", await page.locator(".ing__finding").count() === 2
    && (await page.locator(".ing__findings").innerText()).includes("可选优化")
    && (await page.locator(".ing__findings").innerText()).includes("建议"));
  check("直接修订与搜索补充来源是两个明确动作", await page.getByRole("button", { name: "生成页面修订（1）" }).count() === 1
    && await page.getByRole("button", { name: "同意发送页面名称并搜索（1）" }).count() === 1
    && await page.locator(".ing__item--lint input[type=checkbox]").count() === 2
    && (await page.locator(".ing__findings").innerText()).includes("先查来源"));
  await page.route("**/api/workspace/knowledge/candidates/*/research", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, queued: 1, selected: 1, status: "queued" }),
  }));
  await page.getByRole("button", { name: "同意发送页面名称并搜索（1）" }).click();
  check("搜索操作明确显示只生成待确认来源候选", await page.getByRole("button", { name: "正在搜索来源…" }).count() === 1
    && await page.getByText(/完成后会出现来源卡片，未经确认不会导入/).count() === 1);
  await page.unroute("**/api/workspace/knowledge/candidates/*/research");
  await page.reload();
  await page.getByRole("button", { name: /全库体检报告/ }).click();
  await page.route("**/api/workspace/knowledge/candidates/*/repair", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, queued: 1, selected: 1, status: "queued" }),
  }));
  await page.getByRole("button", { name: "生成页面修订（1）" }).click();
  check("生成修订后会显示真实进行状态并说明完成后仍需确认", await page.getByRole("button", { name: "正在生成修订…" }).count() === 1
    && await page.getByText(/完成后这里会出现可逐页确认的候选/).count() === 1);
  check("生成体检修订候选不会直接改动 Wiki 页面", workspace.db.prepare("SELECT COUNT(*) AS count FROM wiki_pages").get().count === wikiPagesBeforeReview);
  await page.unroute("**/api/workspace/knowledge/candidates/*/repair");
  await page.goto(`http://127.0.0.1:${PORT}/#/entries/review:missing-candidate`);
  check("审阅候选不存在时给出原因和返回来源入口", await page.getByText("这份来源当前没有可审阅内容", { exact: true }).count() === 1
    && await page.getByRole("link", { name: "返回来源" }).count() === 1);
  await page.goto("http://127.0.0.1:" + PORT + "/#/entries");
  await page.route("**/api/workspace/knowledge/lint/run", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, queued: 1, mode: "network" }),
  }));
  await page.getByRole("button", { name: "全库体检", exact: true }).click();
  await page.getByText("体检已加入队列", { exact: true }).waitFor();
  check("体检提示只说明已入队并明确不会自动修改", await page.getByText("体检已加入队列", { exact: true }).count() === 1
    && await page.getByText("完成后会在这里生成诊断报告，不会自动修改 Wiki。", { exact: true }).count() === 1);
  await page.unroute("**/api/workspace/knowledge/lint/run");
  if (process.argv.includes("--shots")) await page.screenshot({ path: wikiHomeShotFile, fullPage: true });
  await page.getByRole("button", { name: /来源精准跳转/ }).click();
  await page.locator(".wiki-article__body").waitFor();
  check("Wiki 详情展示完整正文、连接、来源和演化版本", (await page.locator(".wiki-article").innerText()).includes("验收标准")
    && (await page.getByRole("heading", { name: "连接" }).count()) === 1
    && (await page.getByRole("heading", { name: "依据" }).count()) === 1
    && (await page.getByRole("heading", { name: "演化" }).count()) === 1);
  await page.locator(".main").evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  const wikiToTop = page.getByRole("button", { name: "返回 Wiki 页面顶部" });
  await wikiToTop.waitFor();
  await wikiToTop.click();
  await page.waitForFunction(() => document.querySelector(".main")?.scrollTop < 10);
  check("Wiki 页面滚动后提供悬浮返回顶部按钮", await wikiToTop.count() === 0);
  await page.getByRole("button", { name: "删除页面", exact: true }).click();
  const deleteDialog = page.getByRole("dialog", { name: /删除“?「?来源精准跳转/ });
  await deleteDialog.waitFor();
  check("删除 Wiki 必须二次确认并明确不删除 Raw", (await deleteDialog.innerText()).includes("Raw 来源不会被删除")
    && await deleteDialog.getByRole("button", { name: "移入回收站" }).count() === 1);
  await deleteDialog.getByRole("button", { name: "取消" }).click();
  if (process.argv.includes("--shots")) await page.screenshot({ path: wikiArticleShotFile, fullPage: true });
  await page.getByText("UI 证据来源 · 证据章节", { exact: true }).click();
  await page.getByRole("button", { name: "打开并定位到 Raw" }).click();
  const evidenceHit = page.locator(".evidence-hit");
  await evidenceHit.waitFor();
  check("Wiki 来源会打开准确章节并高亮逐字原文", page.url().endsWith("#/shelf")
    && (await evidenceHit.innerText()).includes("知识来源跳转必须打开准确章节"));
  await page.getByRole("button", { name: "返回 Wiki" }).click();
  await page.waitForURL((url) => url.hash.startsWith("#/entries/"));
  check("从 Raw 返回时回到刚才的 Wiki 页面", page.url().includes("#/entries/"));

  await page.goto("http://127.0.0.1:" + PORT + "/#/assistant");
  const assistantInput = page.getByPlaceholder("问任何问题，或直接输入本地项目路径");
  await assistantInput.waitFor();
  await page.getByRole("button", { name: "添加附件、知识库、文章、专家或 Skill" }).click();
  const knowledgeMenuItem = page.getByRole("menuitem", { name: /知识库.*检索持续维护的 Wiki 页面/ });
  await knowledgeMenuItem.waitFor();
  await knowledgeMenuItem.click();
  const knowledgeReference = page.locator(".assistant-references").getByText("知识库", { exact: true });
  check("AI 助手可从 + 菜单调用知识库并像专家一样显示引用标签", await knowledgeReference.count() === 1
    && await page.getByRole("button", { name: "移除引用 知识库" }).count() === 1
    && await assistantInput.inputValue() === "");

  check("真实浏览器没有页面异常", errors.length === 0, errors.join("\n"));
  if (process.argv.includes("--shots")) console.log(` 截图：${shotFile}\n 合集列表：${seriesListShotFile}\n 合集目录：${seriesShotFile}\n 目录局部：${seriesOutlineShotFile}\n 合集通读：${seriesReadShotFile}\n Wiki 首页：${wikiHomeShotFile}\n Wiki 页面：${wikiArticleShotFile}`);
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
