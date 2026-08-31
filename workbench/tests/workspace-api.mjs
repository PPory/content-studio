import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi, requestAllowed } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-workspace-api-"));
const xenhoHome = path.join(root, "Xenho");
let workspace = await openWorkspace({ xenhoHome });
let server;

function check(name, pass) {
  assert(pass, name);
  console.log(` ✓ ${name}`);
}

async function start() {
  const api = createApi({}, { workspace: Promise.resolve(workspace) });
  server = http.createServer((req, res) => api(req, res, () => {
    res.writeHead(404);
    res.end();
  }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function stop() {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server = null;
}

async function call(base, pathname, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined && !Buffer.isBuffer(body) ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { origin: base } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") || "";
  const value = contentType.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { response, value };
}

try {
  check("缺少或伪造 Host 的读取请求会被拒绝", !requestAllowed({ method: "GET", headers: {} }) && !requestAllowed({ method: "GET", headers: { host: "evil.example" } }));
  check("回环 Host 的读取请求被允许", requestAllowed({ method: "GET", headers: { host: "127.0.0.1:5180" } }));

  let base = await start();
  const created = await call(base, "/api/workspace/projects", {
    method: "POST",
    body: { title: "隔离测试稿", body: "第一版正文", platform: "公众号" },
  });
  assert.equal(created.response.status, 200, JSON.stringify(created.value));
  const projectId = created.value.project.id;
  const draftId = created.value.project.masterDraft.id;
  const initialVersion = created.value.project.masterDraft.version;
  check("本地项目和主稿通过工作区 API 创建", Boolean(projectId && draftId && initialVersion));

  const invalidSeries = await call(base, "/api/workspace/series", { method: "POST", body: { title: "" } });
  check("合集名称为空时由服务端拒绝", invalidSeries.response.status === 400 && invalidSeries.value.ok === false);
  const createdSeries = await call(base, "/api/workspace/series", {
    method: "POST",
    body: {
      title: "隔离文章合集",
      description: "只保存在临时 SQLite 的合集说明",
    },
  });
  assert.equal(createdSeries.response.status, 200, JSON.stringify(createdSeries.value));
  const seriesId = createdSeries.value.series.id;
  const withExistingProject = await call(base, `/api/workspace/series/${seriesId}/articles`, { method: "POST", body: { projectIds: [projectId] } });
  const existingItemId = withExistingProject.value.series.entries[0].id;
  const withNewProject = await call(base, `/api/workspace/series/${seriesId}/articles/new`, { method: "POST", body: { platform: "公众号", audience: "测试读者" } });
  const newProjectId = withNewProject.value.projectId;
  const newItemId = withNewProject.value.series.entries.find((item) => item.projectId === newProjectId).id;
  const invalidOrder = await call(base, `/api/workspace/series/${seriesId}/entries/reorder`, { method: "POST", body: { entryIds: [existingItemId] } });
  assert.equal(invalidOrder.response.status, 400);
  const reordered = await call(base, `/api/workspace/series/${seriesId}/entries/reorder`, { method: "POST", body: { entryIds: [newItemId, existingItemId] } });
  assert.equal(reordered.value.series.entries[0].id, newItemId);
  const removedFromCollection = await call(base, `/api/workspace/series/${seriesId}/entries/${newItemId}/remove`, { method: "POST", body: {} });
  const preservedProject = await call(base, `/api/workspace/projects/${newProjectId}`);
  check("合集支持加入旧文章、直接新建、排序和移出且不删除文章", removedFromCollection.value.series.entries.length === 1 && removedFromCollection.value.preservedArticle === true && preservedProject.response.status === 200 && preservedProject.value.project.collections.length === 0);

  // ⚠️ 归属是多对多的。这条以前断言的是反面（「已经属于其他合集」被拒），
  // 而那条全局 UNIQUE 正是「已归属的文章在选择器里静默消失」的根。
  const secondSeries = await call(base, "/api/workspace/series", { method: "POST", body: { title: "第二个合集" } });
  await call(base, `/api/workspace/series/${secondSeries.value.series.id}/articles`, { method: "POST", body: { projectIds: [projectId] } });
  const multiHomed = await call(base, `/api/workspace/projects/${projectId}`);
  const duplicate = await call(base, `/api/workspace/series/${seriesId}/articles`, { method: "POST", body: { projectIds: [projectId] } });
  check("一篇文章可同时属于多个合集，重复加入同一合集被明确拒绝",
    multiHomed.value.project.collections.length === 2
    && multiHomed.value.project.collections.every((item) => item.previous === null && item.next === null)
    && duplicate.response.status === 400);

  // 分节 + 通读 + 导出：教程知识库真正要的那三下
  const sectioned = await call(base, `/api/workspace/series/${seriesId}/sections`, { method: "POST", body: { heading: "入门" } });
  const readBack = await call(base, `/api/workspace/series/${seriesId}/read`);
  const exported = await call(base, `/api/workspace/series/${seriesId}/export`, { method: "POST", body: {} });
  check("合集可分节、按顺序通读并导出成一份 Markdown",
    sectioned.value.series.entries.some((entry) => entry.kind === "section" && entry.heading === "入门")
    && readBack.value.read.sections.some((section) => section.kind === "section")
    && exported.value.markdown.startsWith("# 隔离文章合集")
    && exported.value.markdown.includes("## 入门"));

  // 文章那一侧改归属：一次写定，不是前端拼多次调用
  const refiled = await call(base, `/api/workspace/projects/${projectId}/series`, { method: "POST", body: { seriesIds: [seriesId] } });
  check("从文章一侧改归属会一次写定两边", refiled.value.project.collections.length === 1 && refiled.value.project.collections[0].id === seriesId);

  const addedBack = await call(base, `/api/workspace/series/${seriesId}/articles`, { method: "POST", body: { projectIds: [newProjectId] } });
  const addedBackItemId = addedBack.value.series.entries.find((item) => item.projectId === newProjectId).id;
  assert(addedBackItemId);
  await call(base, `/api/workspace/projects/${newProjectId}/trash`, { method: "POST", body: {} });
  const seriesWithRecycledArticle = await call(base, `/api/workspace/series/${seriesId}`);
  const recycledEntry = seriesWithRecycledArticle.value.series.entries.find((entry) => entry.id === addedBackItemId);
  check("合集保留回收文章的归类关系但不再提供打开入口，且不计入篇数",
    recycledEntry.deleted === true && recycledEntry.stage === "在回收站" && recycledEntry.projectId === null
    && seriesWithRecycledArticle.value.series.progress.recycled === 1
    && seriesWithRecycledArticle.value.series.progress.total === 1);

  const saved = await call(base, `/api/workspace/drafts/${draftId}/save`, {
    method: "POST",
    body: { title: "隔离测试稿", body: "第二版正文", expectedVersion: initialVersion },
  });
  assert.equal(saved.response.status, 200);
  check("正文一次保存并返回新版本", saved.value.project.masterDraft.body === "第二版正文" && saved.value.project.masterDraft.version > initialVersion);

  const stale = await call(base, `/api/workspace/drafts/${draftId}/save`, {
    method: "POST",
    body: { title: "隔离测试稿", body: "过期覆盖", expectedVersion: initialVersion },
  });
  check("过期版本保存被 409 拒绝", stale.response.status === 409 && stale.value.ok === false);

  const disposable = await call(base, "/api/workspace/projects", { method: "POST", body: { title: "待回收项目", body: "回收后不应出现在稿件列表", platform: "公众号" } });
  const disposableDraftId = disposable.value.project.masterDraft.id;
  await call(base, `/api/workspace/projects/${disposable.value.project.id}/trash`, { method: "POST", body: {} });
  const visibleDrafts = await call(base, "/api/workspace/items/drafts");
  check("回收项目后子稿不再出现在活动稿件列表", !visibleDrafts.value.items.some((item) => item.id === disposableDraftId));
  const seedCatalog = await call(base, "/api/workspace/seeds");
  check("本地种子接口返回分组反应真源", seedCatalog.value.reactionGroups.length === 3 && seedCatalog.value.reactions.length === 10);

  const audiences = await call(base, "/api/audiences", { method: "POST", body: { value: "隔离工作区读者" } });
  assert.equal(audiences.value.items[0], "隔离工作区读者");
  const writingProfile = await call(base, "/api/writing-profile", { method: "POST", body: { profile: { audience: "隔离工作区读者", platform: "小红书", styleId: "" } } });
  check("目标读者和写作偏好写入 SQLite", writingProfile.value.profile.platform === "小红书" && workspace.repository.getSetting("writing-profile").audience === "隔离工作区读者");

  const emptyMetrics = await call(base, "/api/workspace/account-metrics");
  assert.equal(emptyMetrics.value.rows.length, 0);
  const savedMetric = await call(base, "/api/workspace/account-metrics", { method: "POST", body: { date: "2026-08-29", platform: "公众号", followers: 123, views: 456, note: "隔离记录" } });
  const readMetrics = await call(base, "/api/workspace/account-metrics");
  check("账号指标通过本地 SQLite 保存并读回", savedMetric.value.rows.length === 1 && readMetrics.value.rows[0]?.followers === 123 && readMetrics.value.platforms.includes("公众号"));

  const revision = { id: "revision-local-1", mode: "rewrite", label: "改写", instruction: "更清楚", original: "旧句子", candidate: "新句子", generations: [], status: "pending" };
  const savedRevision = await call(base, "/api/revisions", { method: "POST", body: { scope: draftId, item: revision } });
  assert.equal(savedRevision.value.items[0].id, revision.id);
  const movedRevision = await call(base, "/api/revisions/move", { method: "POST", body: { from: draftId, to: `${draftId}:published` } });
  check("编辑器修订历史写入并可迁移本地 scope", movedRevision.value.items.length === 1 && (await call(base, `/api/revisions?scope=${encodeURIComponent(`${draftId}:published`)}`)).value.items[0].candidate === "新句子");

  const today = new Date().toLocaleDateString("sv-SE");
  const addedTask = await call(base, "/api/plan", { method: "POST", body: { date: today, action: "add", text: "只写进隔离 SQLite" } });
  const toggledTask = await call(base, "/api/plan", { method: "POST", body: { date: today, action: "toggle", index: 0, done: true, stamp: addedTask.value.stamp } });
  const staleTask = await call(base, "/api/plan", { method: "POST", body: { date: today, action: "remove", index: 0, stamp: addedTask.value.stamp } });
  check("每日计划使用 SQLite 版本锁", toggledTask.value.tasks[0].done === true && staleTask.response.status === 409);

  const cardPreview = await call(base, "/api/workspace/ai/knowledge-card", { method: "POST", body: { source: { title: "本地知识", selection: "这是可核对的原文证据。" }, messages: [{ role: "assistant", content: "结论候选" }] } });
  const savedCard = await call(base, "/api/workspace/knowledge-cards", { method: "POST", body: cardPreview.value.card });
  check("知识卡预览和确认保存进入当前工作区", savedCard.value.card.path.startsWith("workspace:knowledge-card:") && workspace.repository.search("结论候选", { limit: 10 }).some((item) => item.id === savedCard.value.card.id));
  const localMaterial = await call(base, "/api/workspace/intake", { method: "POST", body: { target: "material", title: "本地洞察素材", content: "只依据隔离 SQLite 生成报告。", cmd: "核心观点" } });
  assert.equal(localMaterial.response.status, 200);
  const beforeUpdateVersion = workspace.repository.getEntity(localMaterial.value.id).version;
  await call(base, `/api/workspace/items/materials/${localMaterial.value.id}/update`, { method: "POST", body: { fields: { title: "更新后的本地洞察素材" }, markdown: "更新后仍只保存在隔离 SQLite。" } });
  check("通用实体编辑增加版本并写入审计", workspace.repository.getEntity(localMaterial.value.id).version > beforeUpdateVersion && workspace.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE entity_id=? AND event_type='material.updated'").get(localMaterial.value.id).count === 1);
  const insightReady = await call(base, "/api/insights/ready");
  const insightRun = await call(base, "/api/insights/run", { method: "POST", body: { week: insightReady.value.week } });
  assert.equal(insightRun.response.status, 200, JSON.stringify(insightRun.value));
  const insights = await call(base, "/api/workspace/insights");
  const insight = await call(base, `/api/workspace/insights/${insightRun.value.report.id}`);
  check("洞察只依据本地素材生成并写入 SQLite", insightReady.value.localOnly === true && insightRun.value.run.status === "done" && insights.value.reports.length === 1 && insight.value.content.includes("当前本地工作区"));
  const csv = Buffer.from("发布时间,标题,链接,阅读量\n2026-08-28,隔离导入,https://example.com/post,123\n", "utf8");
  const dryImport = await call(base, "/api/workspace/external-publications/import?filename=posts.csv&platform=小红书&dry=1", { method: "POST", body: csv, headers: { "content-type": "application/octet-stream" } });
  assert.equal(dryImport.response.status, 200, JSON.stringify(dryImport.value));
  assert.equal(workspace.db.prepare("SELECT COUNT(*) AS count FROM external_publication_records").get().count, 0);
  const committedImport = await call(base, "/api/workspace/external-publications/import?filename=posts.csv&platform=小红书", { method: "POST", body: csv, headers: { "content-type": "application/octet-stream" } });
  check("发布文件先预览再写入本地发布记录", dryImport.value.dry === true && committedImport.value.added === 1 && workspace.db.prepare("SELECT COUNT(*) AS count FROM external_publication_records").get().count === 1);
  const archive = await call(base, "/api/workspace/publications/reconcile", { method: "POST", body: {} });
  const backupStatus = await call(base, "/api/backup/status");
  const portableBackup = await call(base, "/api/backup/export", { method: "POST", body: { kind: "portable" } });
  const backupPreview = await call(base, "/api/backup/restore?dry=1", {
    method: "POST",
    body: portableBackup.value,
    headers: { "content-type": "application/octet-stream" },
  });
  const rejectedRestore = await call(base, "/api/backup/restore?confirm=wrong", {
    method: "POST",
    body: portableBackup.value,
    headers: { "content-type": "application/octet-stream" },
  });
  check("发布记录核对和阶段 5 备份只操作隔离工作区", archive.value.localOnly === true && backupStatus.value.ready === true && portableBackup.response.status === 200 && backupPreview.value.dry === true && rejectedRestore.response.status === 409);
  const expertStarted = await call(base, "/api/expert-runs", { method: "POST", body: { kind: "quality-review", scopeId: `project:${projectId}`, document: { id: draftId, title: "隔离测试稿", body: "这是一段需要检查的正文。", platform: "公众号", audience: "测试读者" } } });
  assert.equal(expertStarted.response.status, 202, JSON.stringify(expertStarted.value));
  let expertState = expertStarted.value.run;
  for (let attempt = 0; attempt < 20 && ["queued", "running"].includes(expertState.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    expertState = (await call(base, `/api/expert-runs/${expertState.id}`)).value.run;
  }
  check("专家任务状态写入 SQLite，运行文件只在隔离工作区暂存", workspace.repository.getSetting(`expert-run:${expertState.id}`)?.id === expertState.id && expertState.status === "failed" && workspace.paths.stagingDir.startsWith(xenhoHome));
  const imageBytes = Buffer.from([0, 1, 2, 3, 250, 255]);
  const uploaded = await call(base, "/api/workspace/assets/images?name=bytes.png", {
    method: "POST",
    body: imageBytes,
    headers: { "content-type": "image/png" },
  });
  assert.equal(uploaded.response.status, 200);
  const downloaded = await call(base, `/api/workspace/assets/${uploaded.value.asset.id}`);
  check("资源上传与读取保持原始字节", downloaded.response.status === 200 && Buffer.compare(downloaded.value, imageBytes) === 0);

  // ---- 单篇导出：Markdown / Word / 纯文本 ----
  const exportProject = await call(base, "/api/workspace/projects", { method: "POST", body: { title: "导出测试稿", body: "占位", platform: "公众号" } });
  const exportProjectId = exportProject.value.project.id;
  const exportDraftId = exportProject.value.project.masterDraft.id;
  const exportBody = [
    "# 一级标题",
    "",
    "正文里有**粗体**、*斜体* 和 `代码`。",
    "",
    "- 第一条",
    "- 第二条",
    "",
    "> 一段引用",
    "",
    `![示意图](asset://${uploaded.value.asset.id})`,
    "",
    "| 列 1 | 列 2 |",
    "| --- | --- |",
    "| a | b |",
  ].join("\n");
  const savedForExport = await call(base, `/api/workspace/drafts/${exportDraftId}/save`, {
    method: "POST",
    body: { title: "导出测试稿", body: exportBody, expectedVersion: exportProject.value.project.masterDraft.version },
  });
  assert.equal(savedForExport.response.status, 200, JSON.stringify(savedForExport.value));

  const exportedMarkdown = await call(base, `/api/workspace/projects/${exportProjectId}/export`, { method: "POST", body: { format: "md" } });
  assert.equal(exportedMarkdown.response.status, 200, JSON.stringify(exportedMarkdown.value));
  const { unzipSync, strFromU8 } = await import("fflate");
  const bundle = unzipSync(new Uint8Array(exportedMarkdown.value));
  const bundleNames = Object.keys(bundle);
  const bundleMarkdown = strFromU8(bundle[bundleNames.find((name) => name.endsWith(".md"))]);
  const bundledImage = bundle[bundleNames.find((name) => name.includes("/assets/"))];
  check(
    "Markdown 导出带 frontmatter，正文里的图打包进 zip 且字节一致",
    /^---\ntitle: 导出测试稿\n/.test(bundleMarkdown)
    && bundleMarkdown.includes("![示意图](assets/bytes.png)")
    && !bundleMarkdown.includes("asset://")
    && Buffer.compare(Buffer.from(bundledImage), imageBytes) === 0,
  );

  // 没有图的那一篇必须回单个 .md，不能一律打成 zip
  const plainExport = await call(base, `/api/workspace/projects/${projectId}/export`, { method: "POST", body: { format: "md" } });
  check(
    "没有插图时 Markdown 导出是单个文件",
    plainExport.response.status === 200
    && /filename\*=UTF-8''/.test(plainExport.response.headers.get("content-disposition") || "")
    && decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(plainExport.response.headers.get("content-disposition"))[1]).endsWith(".md")
    && plainExport.value.toString("utf8").includes("第二版正文"),
  );

  const exportedDocx = await call(base, `/api/workspace/projects/${exportProjectId}/export`, { method: "POST", body: { format: "docx" } });
  assert.equal(exportedDocx.response.status, 200);
  const docx = unzipSync(new Uint8Array(exportedDocx.value));
  const documentXml = strFromU8(docx["word/document.xml"]);
  const mediaName = Object.keys(docx).find((name) => name.startsWith("word/media/"));
  check(
    "Word 导出是可解开的 OOXML，标题、表格和内嵌图片都在",
    Boolean(docx["[Content_Types].xml"] && docx["word/styles.xml"] && docx["word/_rels/document.xml.rels"])
    && documentXml.includes("一级标题")
    && documentXml.includes("<w:tbl>")
    && documentXml.includes("<w:b/>")
    && Boolean(mediaName)
    && Buffer.compare(Buffer.from(docx[mediaName]), imageBytes) === 0,
  );

  const exportedText = await call(base, `/api/workspace/projects/${exportProjectId}/export`, { method: "POST", body: { format: "txt" } });
  const plainText = exportedText.value.toString("utf8");
  check(
    "纯文本导出剥掉 Markdown 记号和 frontmatter，图片降级成一行说明",
    exportedText.response.status === 200
    && plainText.startsWith("导出测试稿\n")
    && plainText.includes("一级标题")
    && plainText.includes("[图片：示意图]")
    && !plainText.includes("**")
    && !/^#/m.test(plainText)
    // frontmatter 必须整段不见：`---` 会被渲染成分隔线，`title:` 会原样漏出来
    && !plainText.includes("title:")
    && !plainText.includes("————")
    && !plainText.includes("asset://"),
  );

  const unknownFormat = await call(base, `/api/workspace/projects/${exportProjectId}/export`, { method: "POST", body: { format: "epub" } });
  const missingProject = await call(base, "/api/workspace/projects/01NOTAREALPROJECT000000000/export", { method: "POST", body: { format: "md" } });
  check("未知格式和不存在的项目都由服务端拒绝", unknownFormat.response.status === 400 && missingProject.response.status === 404);

  const extensionOrigin = "chrome-extension://xenho-test";
  const status = await call(base, "/api/extension/status", { headers: { origin: extensionOrigin, "x-xenho-extension": "1" } });
  assert.equal(status.response.status, 200);
  const extensionHeaders = { origin: extensionOrigin, "x-xenho-extension": "1", "x-xenho-token": status.value.pairToken };
  const intakeBody = { clientRequestId: "capture-api-1", target: "collection", title: "离线收藏", content: "同一内容只写一次", url: "https://example.com/a" };
  const firstIntake = await call(base, "/api/extension/intake", { method: "POST", body: intakeBody, headers: extensionHeaders });
  const replayIntake = await call(base, "/api/extension/intake", { method: "POST", body: intakeBody, headers: extensionHeaders });
  assert.equal(firstIntake.response.status, 200);
  assert.equal(replayIntake.response.status, 200);
  check("扩展离线重试按请求编号只写一次", firstIntake.value.id === replayIntake.value.id && replayIntake.value.duplicate === true && workspace.db.prepare("SELECT COUNT(*) AS count FROM captures WHERE capture_bucket='collection'").get().count === 1);

  const otherExtension = await call(base, "/api/extension/status", { headers: { origin: "chrome-extension://other", "x-xenho-extension": "1" } });
  check("配对令牌绑定首次扩展来源", otherExtension.response.status === 403);

  const createdBook = await call(base, "/api/workspace/books", { method: "POST", body: { name: "本地资料", content: "# 本地资料\n\n只写进隔离 SQLite。" } });
  assert.equal(createdBook.response.status, 200, JSON.stringify(createdBook.value));
  const book = createdBook.value.book;
  const bookDoc = book.bookPath;
  const readBook = await call(base, `/api/workspace/doc?path=${encodeURIComponent(bookDoc)}&notePath=${encodeURIComponent(book.notePath)}`);
  const savedBook = await call(base, "/api/workspace/doc", { method: "POST", body: { path: bookDoc, content: "# 本地资料\n\n更新后的正文。", stamp: readBook.value.stamp } });
  assert.equal(savedBook.response.status, 200, JSON.stringify(savedBook.value));
  const staleBook = await call(base, "/api/workspace/doc", { method: "POST", body: { path: bookDoc, content: "过期覆盖", stamp: readBook.value.stamp } });
  check("本地书架正文使用 SQLite 版本冲突保护", staleBook.response.status === 409);
  const highlight = await call(base, "/api/workspace/highlights", { method: "POST", body: { path: bookDoc, add: { text: "更新后的正文", color: "yellow" } } });
  assert.equal(highlight.value.highlights.length, 1);
  const note = await call(base, "/api/workspace/note", { method: "POST", body: { path: book.notePath, quote: "更新后的正文", body: "本地批注" } });
  assert.equal(note.value.noteItems.length, 1);
  const marks = await call(base, `/api/workspace/book-marks?dir=${encodeURIComponent(book.dir)}`);
  check("书籍、高亮和批注全部写入隔离 SQLite", marks.value.total === 2 && workspace.db.prepare("SELECT COUNT(*) AS count FROM book_marks").get().count === 2);

  const originalNote = note.value.noteItems[0];
  const editedNote = await call(base, "/api/workspace/note/edit", { method: "POST", body: { path: book.notePath, index: originalNote.index, stamp: originalNote.stamp, body: "更新后的本地批注" } });
  assert.equal(editedNote.response.status, 200);
  const staleNote = await call(base, "/api/workspace/note/edit", { method: "POST", body: { path: book.notePath, index: originalNote.index, stamp: originalNote.stamp, body: "过期批注" } });
  check("本地批注使用实体版本阻止过期覆盖", staleNote.response.status === 409);

  await call(base, "/api/workspace/highlights", { method: "POST", body: { path: bookDoc, remove: { text: "更新后的正文" } } });
  await call(base, "/api/workspace/highlights", { method: "POST", body: { path: bookDoc, add: { text: "本地资料", color: "blue" } } });
  const trashedBook = await call(base, "/api/workspace/books/trash", { method: "POST", body: { dir: book.dir } });
  assert.equal(trashedBook.response.status, 200);
  const hiddenBookDoc = await call(base, `/api/workspace/doc?path=${encodeURIComponent(bookDoc)}`);
  check("书籍回收会隐藏章节、批注和高亮", hiddenBookDoc.response.status === 404 && workspace.repository.search("更新后的本地批注", { limit: 10 }).length === 0);
  const restoredBook = await call(base, "/api/workspace/books/restore", { method: "POST", body: { from: book.dir, to: book.dir } });
  assert.equal(restoredBook.response.status, 200);
  const restoredMarks = await call(base, `/api/workspace/book-marks?dir=${encodeURIComponent(book.dir)}`);
  check("恢复书籍只恢复同次回收的子项", restoredMarks.value.total === 2 && restoredMarks.value.highlights === 1 && restoredMarks.value.notes === 1 && restoredMarks.value.chapters.flatMap((item) => item.items).some((item) => item.quote === "本地资料"));
  const newChat = await call(base, "/api/assistant/new", { method: "POST", body: { scopeId: "global-test", permissionMode: "daily" } });
  assert.equal(newChat.response.status, 200, JSON.stringify(newChat.value));
  const chatId = newChat.value.conversation.id;
  const attachmentBytes = Buffer.from("只在隔离工作区保存的附件", "utf8");
  const attachment = await call(base, `/api/assistant/attachment?scope=global-test&conversationId=${encodeURIComponent(chatId)}&filename=note.txt`, { method: "POST", body: attachmentBytes, headers: { "content-type": "text/plain" } });
  assert.equal(attachment.response.status, 200, JSON.stringify(attachment.value));
  check("AI 会话写入 SQLite，附件字节写入 AssetStore", workspace.db.prepare("SELECT COUNT(*) AS count FROM ai_conversations WHERE id=?").get(chatId).count === 1 && workspace.db.prepare("SELECT COUNT(*) AS count FROM conversation_assets WHERE conversation_id=?").get(chatId).count === 1);
  const deletedChat = await call(base, "/api/assistant/conversation/manage", { method: "POST", body: { scopeId: "global-test", conversationId: chatId, action: "delete" } });
  check("AI 对话删除进入回收站而非硬删除", deletedChat.value.recoverable === true && workspace.repository.getEntity(chatId, { includeDeleted: true }).deletedAt);
  await stop();
  const workspaceId = workspace.manifest.workspaceId;
  workspace.close();
  workspace = await openWorkspace({ xenhoHome });
  base = await start();
  const reopened = await call(base, `/api/workspace/projects/${projectId}`);
  const reopenedSeries = await call(base, `/api/workspace/series/${seriesId}`);
  check("关闭重开后项目、合集关系、正文和工作区身份保持不变", reopened.value.project.masterDraft.body === "第二版正文" && reopened.value.project.collections.some((item) => item.id === seriesId) && reopenedSeries.value.series.entries.length === 3 && workspace.manifest.workspaceId === workspaceId);
  const reopenedPlan = await call(base, `/api/plan?date=${today}`);
  const reopenedProfile = await call(base, "/api/writing-profile");
  check("关闭重开后计划、读者偏好和修订历史仍存在", reopenedPlan.value.tasks[0]?.done === true && reopenedProfile.value.profile.audience === "隔离工作区读者" && (await call(base, `/api/revisions?scope=${encodeURIComponent(`${draftId}:published`)}`)).value.items.length === 1);
  const reopenedBook = await call(base, `/api/workspace/doc?path=${encodeURIComponent(bookDoc)}`);
  check("关闭重开后书籍正文、批注和恢复状态仍存在", reopenedBook.response.status === 200 && reopenedBook.value.content.includes("更新后的正文") && reopenedBook.value.noteItems[0]?.body === "更新后的本地批注");
  // ————— 知识库：词条 + 来源 —————
  const emptyEntries = await call(base, "/api/workspace/entries");
  check("没有词条时知识库仍返回可用结构，而不是报错", emptyEntries.value.ok && emptyEntries.value.entries.length === 0
    && emptyEntries.value.health.total === 0 && emptyEntries.value.kindLabels.stance === "我的主张");

  const wikiSourceId = workspace.domain.createCapture({ kind: "article", title: "词条来源", bodyMarkdown: "四段式提示词。", actor: "user", now: new Date() });
  const conceptId = workspace.domain.createEntry({ name: "四段式提示词", kind: "method", definition: "角色、任务、约束、示例。", definitionSourceId: wikiSourceId, actor: "user", now: new Date() });
  const otherId = workspace.domain.createEntry({ name: "提示词工程", kind: "concept", definition: "写提示的方法总称。", definitionSourceId: wikiSourceId, actor: "user", now: new Date() });
  workspace.domain.addEntryFact({ entryId: conceptId, statement: "四段式适合长视频提示。", sourceEntityId: wikiSourceId, actor: "user", now: new Date() });
  const listed = await call(base, "/api/workspace/entries");
  check("词条列表带出事实数、来源数、关系数和孤儿状态", listed.value.entries.length === 2
    && listed.value.entries.find((item) => item.id === conceptId).activeFacts === 1
    && listed.value.entries.find((item) => item.id === conceptId).sourceCount === 1
    && listed.value.health.orphans === 2);
  workspace.domain.linkEntries(conceptId, otherId, "part_of", { actor: "user", now: new Date() });
  const linked = await call(base, "/api/workspace/entries");
  check("建立关系后孤儿数归零，无需任何巡检", linked.value.health.orphans === 0);

  const detail = await call(base, `/api/workspace/entries/${conceptId}`);
  check("词条详情带出每条事实的来源标题和双向邻居", detail.value.entry.name === "四段式提示词"
    && detail.value.facts[0].sourceTitle === "词条来源"
    && detail.value.neighbors.outgoing[0]?.relationType === "part_of"
    && detail.value.relationLabels.part_of === "属于");

  const knowledgeSources = await call(base, "/api/workspace/knowledge/sources");
  check("知识库来源把归类和可写性分开报，两个维度互不冒充", knowledgeSources.value.sources.length >= 1
    && knowledgeSources.value.sources.every((item) => item.sourceKind && item.writable)
    && knowledgeSources.value.totals.documents >= 1);

  const lint = await call(base, "/api/workspace/knowledge/lint");
  check("体检把孤儿和矛盾候选作为查询返回", Array.isArray(lint.value.orphans) && Array.isArray(lint.value.contradictions));

  check("隔离工作区数据库完整性检查通过", workspace.check().ok);

  console.log("\n ✓ 阶段 3 本地工作区 API、并发保存、资源字节和扩展幂等全部通过");
} finally {
  await stop();
  if (workspace?.db?.open) workspace.close();
  await fs.rm(root, { recursive: true, force: true });
}
