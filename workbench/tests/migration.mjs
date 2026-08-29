import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { formalMigration } from "../server/migration/formal.mjs";
import { rehearseMigration } from "../server/migration/rehearsal.mjs";
import { loadMigrationSnapshot, writeMigrationSnapshot } from "../server/migration/snapshot.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-migration-test-"));
const stamp = "2026-08-29T04:00:00.000Z";
const revisionHash = crypto.createHash("sha256").update("第一稿\u0000正文内容").digest("hex");

function check(name, pass) {
  assert(pass, name);
  console.log(` ✓ ${name}`);
}

try {
  const snapshotDir = path.join(root, "snapshot");
  const imageBytes = Buffer.from("image-real-bytes\u0000", "utf8");
  const bookBytes = Buffer.from("book-real-bytes\u0000", "utf8");
  await writeMigrationSnapshot({
    directory: snapshotDir,
    now: new Date(stamp),
    sources: {
      d1: { records: {
        captures: [{ id: "capture-1", kind: "article", title: "来源", bodyMarkdown: "原始正文", sourceUrl: "https://example.com", status: "accepted", createdAt: stamp }],
        materials: [{ id: "material-1", title: "证据", type: "核心观点", bodyMarkdown: "证据正文", sourceEntityId: "capture-1", verificationStatus: "不适用", createdAt: stamp }],
        seeds: [{ id: "seed-1", title: "种子", reaction: "我的判断", sourceEntityId: "capture-1", status: "written", createdAt: stamp }],
        projects: [{ id: "project-1", title: "迁移项目", briefMarkdown: "项目说明", priority: "高", status: "active", seedId: "seed-1", createdAt: stamp }],
        drafts: [{ id: "draft-1", projectId: "project-1", title: "第一稿", bodyMarkdown: "正文内容", platform: "公众号", workflowStatus: "已发布", publicationStatus: "已发布", createdAt: stamp }],
        revisions: [{ id: "revision-1", entityId: "draft-1", revisionNo: 1, title: "第一稿", bodyMarkdown: "正文内容", contentSha256: revisionHash, authorKind: "import", createdAt: stamp }],
        projectPrimaryDrafts: [{ projectId: "project-1", draftId: "draft-1" }],
        projectMaterials: [{ projectId: "project-1", materialId: "material-1", relationKind: "evidence", createdAt: stamp }],
        projectSources: [{ projectId: "project-1", sourceEntityId: "capture-1", createdAt: stamp }],
        publications: [{ id: "publication-1", draftId: "draft-1", revisionId: "revision-1", contentSha256: revisionHash, platform: "公众号", title: "第一稿", publishedUrl: "https://example.com/p/1", publishedAt: stamp, idempotencyKey: "old-publish-1", createdAt: stamp }],
        metricSnapshots: [{ id: "metric-1", publicationId: "publication-1", capturedAt: stamp, views: 123, likes: 8, createdAt: stamp }],
      }, assets: [] },
      local: { records: {
        externalPublications: [{ id: "external-1", platform: "小红书", title: "历史发布", publishedUrl: "https://example.com/x/1", publishedAt: stamp, views: 99, source: "import", createdAt: stamp }],
        accountMetrics: [{ id: "account-1", metricDate: "2026-08-29", platform: "公众号", followers: 1000, views: 888, note: "本地记录", createdAt: stamp }],
        books: [{ id: "book-local-1", title: "本地图书", author: "作者", readingStatus: "在读", sourceAssetId: "asset-book-1", createdAt: stamp }],
      }, assets: [{ id: "asset-book-1", path: "assets/local/book.epub", type: "book", originalName: "book.epub", mimeType: "application/epub+zip" }] },
      xenho: { records: {
        conversations: [{ id: "conversation-1", title: "历史会话", model: "test", createdAt: stamp }],
        messages: [{ id: "message-1", conversationId: "conversation-1", sequence: 1, role: "user", bodyMarkdown: "历史问题", createdAt: stamp }],
      }, assets: [{ id: "asset-image-1", path: "assets/xenho/image.png", type: "image", originalName: "image.png", mimeType: "image/png" }] },
      obsidian: { workspaceScope: "99 - 个人工作台", records: {
        knowledgeItems: [{ id: "knowledge-1", knowledgeKind: "knowledge_card", title: "知识卡", bodyMarkdown: "知识正文", locator: "99 - 个人工作台/知识卡.md", createdAt: stamp }],
      }, assets: [] },
      supabase: { records: {}, assets: [{ id: "shadow-unused", path: "assets/supabase/unused.png", type: "image", originalName: "unused.png", mimeType: "image/png", referenced: false }] },
      feishu: { records: {}, checks: { mappedDocuments: [{ id: "doc-1", baseHash: "same", localHash: "same", remoteHash: "same", localChanged: false, remoteChanged: false }] }, assets: [] },
    },
    assetFiles: [
      { source: "local", path: "assets/local/book.epub", bytes: bookBytes },
      { source: "xenho", path: "assets/xenho/image.png", bytes: imageBytes },
      { source: "supabase", path: "assets/supabase/unused.png", bytes: imageBytes },
    ],
  });

  const loaded = await loadMigrationSnapshot(snapshotDir);
  check("快照清单逐文件校验通过", loaded.sources.size === 6 && loaded.files.size === 9);

  const target = path.join(root, "target");
  const reportDir = path.join(root, "report");
  const report = await rehearseMigration({ snapshotDir, targetXenhoHome: target, reportDir, now: new Date(stamp) });
  check("六来源隔离迁移演练通过", report.ok && report.results.failed === 0 && report.results.conflicts === 0);
  check("未引用 Supabase 媒体只核对不导入", report.results.skipped === 1 && !report.assets.some((item) => item.id === "shadow-unused"));
  check("对账报告包含正文与关系哈希", report.contentHashes.some((item) => item.id === "draft-1") && report.relationships.length === 3);
  check("JSON 和 Markdown 对账报告已生成", await fs.stat(path.join(reportDir, "migration-reconciliation.json")).then((item) => item.isFile()) && await fs.stat(path.join(reportDir, "migration-reconciliation.md")).then((item) => item.isFile()));

  const workspace = await openWorkspace({ xenhoHome: target });
  check("原业务 ID 和发布关系被保留", workspace.db.prepare("SELECT COUNT(*) AS count FROM publication_records WHERE id='publication-1' AND draft_id='draft-1'").get().count === 1);
  check("资源实际字节、大小和哈希一致", (await workspace.assets.verify("asset-book-1")).ok && (await workspace.assets.verify("asset-image-1")).ok);
  check("重开后正文、书籍、会话和指标仍可读取", workspace.db.prepare("SELECT COUNT(*) AS count FROM drafts").get().count === 1 && workspace.db.prepare("SELECT COUNT(*) AS count FROM books").get().count === 1 && workspace.db.prepare("SELECT COUNT(*) AS count FROM ai_messages").get().count === 1 && workspace.db.prepare("SELECT COUNT(*) AS count FROM account_metric_snapshots").get().count === 1);
  check("SQLite 完整性和外键检查通过", workspace.check().ok);
  workspace.close();

  const formalHome = path.join(root, "formal-home");
  const formalTarget = path.join(formalHome, "Documents", "Xenho");
  const formal = await formalMigration({
    snapshotDir,
    targetXenhoHome: formalTarget,
    confirmedManifestSha256: loaded.manifestSha256,
    homeDir: formalHome,
    now: new Date(stamp),
  });
  const formalWorkspace = await openWorkspace({ xenhoHome: formalTarget });
  const formalMetadata = formalWorkspace.repository.getMetadata("migration_formal");
  check("正式切换只接受默认空工作区并可重开", formal.ok && formalWorkspace.check().ok && formalMetadata.manifestSha256 === loaded.manifestSha256);
  formalWorkspace.close();
  const restoreSnapshot = path.join(formal.restorePoint, "source-snapshot");
  const restoredManifest = await loadMigrationSnapshot(restoreSnapshot);
  check("正式切换前写入完整恢复点和正式对账报告", restoredManifest.manifestSha256 === loaded.manifestSha256 && await fs.stat(path.join(formal.reportDir, "migration-reconciliation.json")).then((item) => item.isFile()));
  await assert.rejects(() => formalMigration({ snapshotDir, targetXenhoHome: path.join(root, "wrong-target"), confirmedManifestSha256: loaded.manifestSha256, homeDir: formalHome }), /默认单工作区/);
  check("正式切换拒绝非默认目标", true);

  const conflictSnapshot = path.join(root, "conflict-snapshot");
  await writeMigrationSnapshot({ directory: conflictSnapshot, sources: { feishu: { records: {}, checks: { mappedDocuments: [{ id: "doc-conflict", baseHash: "base", localHash: "local", remoteHash: "remote", localChanged: true, remoteChanged: true }] } } } });
  const conflictTarget = path.join(root, "conflict-target");
  const conflictReport = await rehearseMigration({ snapshotDir: conflictSnapshot, targetXenhoHome: conflictTarget, reportDir: path.join(root, "conflict-report") });
  check("飞书远端更新或双向哈希冲突会在写入前中止", !conflictReport.ok && conflictReport.results.conflicts === 1 && !(await fs.stat(conflictTarget).then(() => true, () => false)));

  const tampered = path.join(snapshotDir, "sources", "d1.json");
  await fs.appendFile(tampered, " ", "utf8");
  await assert.rejects(() => loadMigrationSnapshot(snapshotDir), /大小不一致|哈希不一致/);
  check("被篡改的快照在导入前被拒绝", true);
  await assert.rejects(() => rehearseMigration({ snapshotDir: conflictSnapshot, targetXenhoHome: path.dirname(os.tmpdir()) }), /系统临时目录/);
  check("演练目标不能越过系统临时目录", true);

  console.log("\n ✓ 阶段 4 快照校验、来源优先级、隔离导入、资源核验和对账报告全部通过");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
