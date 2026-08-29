import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectD1Source } from "../server/migration/d1-collector.mjs";
import { collectLocalSource } from "../server/migration/local-collector.mjs";
import { collectObsidianSource } from "../server/migration/obsidian-collector.mjs";
import { collectFeishuSource, collectSupabaseSource, referencedMediaIds } from "../server/migration/remote-collectors.mjs";
import { rehearseMigration } from "../server/migration/rehearsal.mjs";
import { writeMigrationSnapshot } from "../server/migration/snapshot.mjs";
import { collectXenhoSource } from "../server/migration/xenho-collector.mjs";
import { collectWorkspaceDelta } from "../server/migration/workspace-delta-collector.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { documentFingerprint, formatFeishuDraftTitle } from "../server/lib/feishu-sync.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-collector-test-"));
const epoch = 1787976000;
const iso = new Date(epoch * 1000).toISOString();
const mediaId = "11111111-1111-4111-8111-111111111111";
const check = (name, value) => { assert(value, name); console.log(` ✓ ${name}`); };

try {
  const schema = await fs.readFile(new URL("../../worker/schema.sql", import.meta.url), "utf8");
  const d1Sql = `${schema}\n
INSERT INTO inbox(id,title,kind,link,source,body,card_markdown,status,value_judgment,verdict,capture_origin,processing_mode,review_status,save_note,selection,canonical_url,content_hash,snapshot_status,snapshot_error,created_at,updated_at)
VALUES ('inbox-1','旧收集','文章链接','https://example.com','test','原始内容 ![](.xenho-media/${mediaId})','','待选题','值得深挖','可写','idea','triage','kept','','','https://example.com','','not_needed','',${epoch},${epoch});
INSERT INTO materials(id,title,content,type,source_url,inbox_id,verification,verification_note,feedback_types,performance_basis,task_key,created_at,updated_at)
VALUES ('material-1','旧素材','素材正文','核心观点','https://example.com','inbox-1','不适用','','','',NULL,${epoch},${epoch});
INSERT INTO topics(id,title,viewpoint,audience,notes,platform,priority,status,primary_draft_id,draft_note,task_key,created_at,updated_at)
VALUES ('topic-1','旧项目','观点','读者','说明','公众号','高','已发布','draft-1','',NULL,${epoch},${epoch});
INSERT INTO drafts(id,topic_id,headline,summary,body,platform,status,workflow_status,published_url,published_at,views,likes,performance_summary,feedback_status,review_conclusion,next_experiment,reviewed_at,keywords_json,task_key,created_at,updated_at)
VALUES ('draft-1','topic-1','旧稿','摘要','正文','公众号','已发布','已发布','https://example.com/p','${iso}',10,2,'表现依据','普通','结论','下次实验','${iso}','["迁移"]','task-1',${epoch},${epoch});
INSERT INTO topic_materials(topic_id,material_id) VALUES ('topic-1','material-1');
INSERT INTO topic_inbox(topic_id,inbox_id) VALUES ('topic-1','inbox-1');
INSERT INTO external_documents(id,provider,entity_type,entity_id,external_id,content_hash,remote_hash,last_source,last_synced_at,created_at,updated_at)
VALUES ('mapping-1','feishu','draft','draft-1','doc-1','x','y','local',${epoch},${epoch},${epoch});
`;
  const d1File = path.join(root, "d1.sql");
  await fs.writeFile(d1File, d1Sql, "utf8");
  const d1 = await collectD1Source({ sqlFile: d1File, tempDir: root });
  check("D1 原记录被规范化并保留 ID、发布和复盘关系", d1.records.captures[0].id === "inbox-1" && d1.records.publications.length === 1 && d1.records.reviews.length === 1);
  check("D1 正文中的 Supabase 媒体引用被精确识别", referencedMediaIds(d1).includes(mediaId));

  const workbench = path.join(root, "workbench");
  await fs.mkdir(path.join(workbench, "data"), { recursive: true });
  await fs.mkdir(path.join(workbench, "config"), { recursive: true });
  await fs.writeFile(path.join(workbench, "data", "posts.csv"), "date,platform,title,url,views\n2026-08-29,X,旧发布,https://example.com/x,20\n");
  await fs.writeFile(path.join(workbench, "data", "metrics.csv"), "date,platform,followers,views,note\n2026-08-29,X,100,200,记录\n");
  await fs.writeFile(path.join(workbench, "data", "editor-revisions.json"), JSON.stringify({ schemaVersion: 1, documents: { "draft-1": { updatedAt: iso, items: [{ id: "revision-old-1", label: "润色", instruction: "更清楚", original: "旧", candidate: "新", status: "adopted", createdAt: iso }] } }, aliases: {} }));
  await fs.writeFile(path.join(workbench, "config", "audiences.json"), "{\"items\":[\"创作者\"]}");
  const browser = path.join(root, "browser.json");
  await fs.writeFile(browser, JSON.stringify({ entries: [
    { origin: "http://127.0.0.1:5180", key: "workbench:reading:v1", value: "{\"version\":1}" },
    { origin: "https://typeset.example", key: "wechat-typeset", value: "{\"draft\":true}" },
    { origin: "https://typeset.example", key: "ignored:key", value: "no" },
  ] }));
  const local = await collectLocalSource({ workbenchDir: workbench, browserFile: browser });
  check("本地 CSV、编辑器修订和多来源浏览器状态均被采集", local.source.records.externalPublications.length === 1 && local.source.records.accountMetrics.length === 1 && local.source.records.knowledgeItems.length === 1 && local.source.inventory.browserKeys === 2 && local.source.records.workspaceSettings.some((item) => item.key === "legacy_browser:https://typeset.example:wechat-typeset"));

  const xenhoDir = path.join(workbench, ".xenho");
  const conversationDir = path.join(xenhoDir, "assistant", "scope", "conversations", "chat-1");
  await fs.mkdir(conversationDir, { recursive: true });
  const attachment = path.join(xenhoDir, "assistant", "scope", "attachment.png");
  await fs.writeFile(attachment, Buffer.from("image-bytes"));
  await fs.writeFile(path.join(conversationDir, "conversation.json"), JSON.stringify({ id: "chat-1", scopeId: "project:draft-1", title: "旧会话", model: "test", createdAt: iso, updatedAt: iso, messages: [{ id: "old-message-1", role: "user", text: "问题", createdAt: iso }], attachments: [{ id: "file-old", name: "attachment.png", type: "image/png", kind: "image", originalPath: attachment, imageRef: { mediaType: "image/png" }, createdAt: iso }], actions: [] }));
  await fs.mkdir(path.join(xenhoDir, "expert-runs", "run-1"), { recursive: true });
  await fs.writeFile(path.join(xenhoDir, "expert-runs", "run-1", "run.json"), "{\"status\":\"done\"}");
  const xenho = await collectXenhoSource({ xenhoDir });
  check("AI 会话、消息、附件和执行历史均被采集", xenho.source.records.conversations.length === 1 && xenho.source.records.messages.length === 1 && xenho.source.records.conversationAssets.length === 1 && xenho.source.assets.length >= 2);

  const vault = path.join(root, "vault");
  const bookDir = path.join(vault, "99 - 个人工作台", "01 - 书架", "测试书");
  await fs.mkdir(bookDir, { recursive: true });
  await fs.writeFile(path.join(bookDir, "book.md"), `---\n作者: 作者\n状态: 在读\n---\n# 测试书\n正文`);
  await fs.writeFile(path.join(bookDir, "01 第一章.md"), "# 第一章\n章节正文");
  await fs.writeFile(path.join(bookDir, "01 第一章.highlights.md"), "- [黄] 一段高亮\n");
  const knowledgeDir = path.join(vault, "99 - 个人工作台", "06 - 知识卡片");
  await fs.mkdir(knowledgeDir, { recursive: true });
  await fs.writeFile(path.join(knowledgeDir, "卡片.md"), "# 卡片\n知识正文");
  const obsidian = await collectObsidianSource({ vaultRoot: vault });
  check("Obsidian 仅采集工作台专用书籍、章节、标记和知识", obsidian.source.workspaceScope === "99 - 个人工作台" && obsidian.source.records.books.length === 1 && obsidian.source.records.bookDocuments.length === 2 && obsidian.source.records.bookMarks.length === 1 && obsidian.source.records.knowledgeItems.length === 1);

  const remoteBytes = Buffer.from("remote-image");
  const remoteHash = crypto.createHash("sha256").update(remoteBytes).digest("hex");
  const supabase = await collectSupabaseSource({ env: {}, mediaIds: [mediaId], mediaAsset: async () => ({ id: mediaId, original_name: "remote.png", mime_type: "image/png", size_bytes: remoteBytes.length, sha256: remoteHash, storage_path: "x" }), download: async () => remoteBytes });
  check("Supabase 采集器只下载显式引用且校验字节", supabase.source.assets.length === 1 && supabase.source.missingAssets.length === 0);

  const localHash = documentFingerprint(formatFeishuDraftTitle("旧稿", "公众号"), "正文");
  const remoteDocHash = documentFingerprint("[公众号] 旧稿", "正文");
  const feishu = await collectFeishuSource({ mappings: [{ id: "mapping-1", provider: "feishu", entity_type: "draft", entity_id: "draft-1", external_id: "doc-1", content_hash: localHash, remote_hash: remoteDocHash }], draftsById: new Map(d1.records.drafts.map((item) => [item.id, item])), fetchDocument: async () => ({ id: "doc-1", title: "[公众号] 旧稿", markdown: "正文" }) });
  check("飞书采集器只做已映射文档哈希对账", feishu.checks.mappedDocuments.length === 1 && feishu.checks.mappedDocuments[0].remoteChanged === false);

  const deltaHome = path.join(root, "workspace-delta");
  const deltaWorkspace = await openWorkspace({ xenhoHome: deltaHome, now: new Date(iso) });
  const deltaProjectId = deltaWorkspace.domain.createProject({ id: "delta-project-1", title: "冻结后项目", confirmed: true, actor: "user", now: new Date(iso) });
  const deltaDraftId = deltaWorkspace.domain.createDraft({ id: "delta-draft-1", projectId: deltaProjectId, title: "冻结后稿件", bodyMarkdown: "冻结后正文", platform: "公众号", actor: "user", now: new Date(iso) });
  deltaWorkspace.domain.softDeleteEntity(deltaProjectId, { actor: "user", now: new Date(iso) });
  deltaWorkspace.repository.setSetting("plan:delta", { tasks: ["保留"] }, { now: new Date(iso) });
  deltaWorkspace.repository.createEntity({ id: "delta-conversation-1", type: "ai_conversation", now: new Date(iso) });
  deltaWorkspace.repository.setEntityText("delta-conversation-1", { title: "冻结后会话", body: "", now: new Date(iso) });
  deltaWorkspace.db.prepare("INSERT INTO ai_conversations(id,title,scope_type,scope_id,model) VALUES (?,?,?,?,?)").run("delta-conversation-1", "冻结后会话", "project", deltaProjectId, "test");
  deltaWorkspace.close();
  const delta = await collectWorkspaceDelta({ xenhoHome: deltaHome, tempDir: root });
  check("冻结后本地工作区通过一致性副本采集且原数据库进入恢复快照", delta.source.records.projects.length === 1 && Boolean(delta.source.records.projects[0].deletedAt) && delta.source.records.drafts.length === 1 && delta.source.records.revisions.length === 1 && delta.source.records.conversations.length === 1 && delta.source.records.workspaceSettings.length === 1 && delta.source.inventory.rawDatabaseIncluded === true && delta.source.assets.some((item) => item.originalName === "workspace-delta.sqlite"));
  for (const [category, rows] of Object.entries(delta.source.records)) local.source.records[category] = [...(local.source.records[category] || []), ...rows];
  local.source.assets.push(...delta.source.assets);
  local.source.inventory.workspaceDelta = delta.source.inventory;
  local.assetFiles.push(...delta.assetFiles);

  const snapshotDir = path.join(root, "snapshot");
  await writeMigrationSnapshot({ directory: snapshotDir, sources: { d1, local: local.source, xenho: xenho.source, obsidian: obsidian.source, supabase: supabase.source, feishu }, assetFiles: [...local.assetFiles, ...xenho.assetFiles, ...obsidian.assetFiles, ...supabase.assetFiles] });
  const report = await rehearseMigration({ snapshotDir, targetXenhoHome: path.join(root, "target"), reportDir: path.join(root, "report") });
  check("完整采集结果可在临时空工作区重建并逐类对账", report.ok && report.results.failed === 0 && report.reconciliation.every((item) => item.ok));
  console.log("\n ✓ 阶段 4 六来源、浏览器与冻结后本地增量采集和完整隔离重建通过");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
