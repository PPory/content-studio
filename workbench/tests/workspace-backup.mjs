import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";
import {
  applyPendingWorkspaceRestore,
  createWorkspaceBundle,
  ensureAutomaticWorkspaceBackup,
  importBundleIntoEmptyWorkspace,
  previewWorkspaceBundle,
  stageWorkspaceRestore,
  workspaceBackupStatus,
  writeFullWorkspaceBackup,
} from "../server/backup/workspace-backup.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-backup-"));
const sourceHome = path.join(root, "source-Xenho");
let source;

function check(name, pass, detail = "") {
  assert.equal(Boolean(pass), true, name);
  console.log(` ✓ ${name}${detail ? `  ← ${detail}` : ""}`);
}

function tableCount(workspace, table) {
  return workspace.db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
}

async function seedWorkspace(workspace) {
  const now = new Date("2026-08-30T01:00:00.000Z");
  const project = workspace.repository.createEntity({ id: "backup-project", type: "project", now });
  workspace.repository.setEntityText(project.id, { title: "备份项目", body: "正文哈希必须保持一致。", now });
  const bookAsset = await workspace.assets.importBuffer({
    id: "backup-book-asset",
    bytes: Buffer.from("EPUB 原件字节"),
    type: "book",
    originalName: "原书.epub",
    mimeType: "application/epub+zip",
    now,
  });
  const imageAsset = await workspace.assets.importBuffer({
    id: "backup-image-asset",
    bytes: Buffer.from([0, 1, 2, 3, 250, 255]),
    type: "image",
    originalName: "封面.png",
    mimeType: "image/png",
    now,
  });
  const attachmentAsset = await workspace.assets.importBuffer({
    id: "backup-attachment-asset",
    bytes: Buffer.from("附件原始字节"),
    type: "attachment",
    originalName: "附件.txt",
    mimeType: "text/plain",
    now,
  });
  const book = workspace.repository.createEntity({ id: "backup-book", type: "book", now });
  workspace.repository.setEntityText(book.id, { title: "原书", body: "可搜索书籍文本", now });
  workspace.db.prepare(`
    INSERT INTO books(id, title, author, reading_status, source_asset_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(book.id, "原书", "作者", "在读", bookAsset.id, JSON.stringify({ coverAssetId: imageAsset.id }));
  const note = workspace.repository.createEntity({ id: "backup-book-note", type: "knowledge", now });
  workspace.repository.setEntityText(note.id, { title: "读书笔记", body: "笔记正文保留。", now });
  workspace.db.prepare(`
    INSERT INTO knowledge_items(id, knowledge_kind, book_id, title, body_markdown, quote_text, source_url, locator)
    VALUES (?, 'book_note', ?, ?, ?, ?, '', ?)
  `).run(note.id, book.id, "读书笔记", "笔记正文保留。", "原文摘录", "chapter-1");
  workspace.repository.relate(project.id, note.id, "uses_material", { now });
  workspace.repository.setSetting("backup-test", { attachmentAssetId: attachmentAsset.id }, { now });
  return { project, book, note, bookAsset, imageAsset, attachmentAsset };
}

try {
  source = await openWorkspace({ xenhoHome: sourceHome, now: new Date("2026-08-30T01:00:00.000Z") });
  const seeded = await seedWorkspace(source);

  const beforePreview = {
    entities: tableCount(source, "entities"),
    assets: tableCount(source, "assets"),
    backups: await fs.readdir(source.paths.backupsDir),
  };
  const full = await createWorkspaceBundle(source, {
    kind: "full",
    now: new Date("2026-08-30T01:10:00.000Z"),
  });
  check("完整备份包含 SQLite 身份与全部资源", full.manifest.assets.length === 3 && full.manifest.assets.every((asset) => asset.included));
  check("完整备份逐项记录数据库表数量与哈希", full.manifest.database.tables.entities.count === 3 && /^[a-f0-9]{64}$/.test(full.manifest.database.tables.entity_text.sha256));
  check("完整备份不包含密钥或旧远程来源", !full.bytes.includes(Buffer.from("WORKBENCH_KEY")) && !full.bytes.includes(Buffer.from("SUPABASE_")));

  const portable = await createWorkspaceBundle(source, {
    kind: "portable",
    now: new Date("2026-08-30T01:11:00.000Z"),
  });
  const excludedBook = portable.manifest.assets.find((asset) => asset.id === seeded.bookAsset.id);
  check("便携导出默认排除图书原件", excludedBook?.included === false && portable.manifest.excluded.bookAssets === 1);
  check("便携导出仍包含图片和附件", portable.manifest.assets.filter((asset) => asset.included).length === 2);
  const portableFiles = unzipSync(new Uint8Array(portable.bytes));
  const portableNames = Object.keys(portableFiles);
  const projectMarkdown = portableNames.find((name) => name.startsWith("Portable/Markdown/") && Buffer.from(portableFiles[name]).toString("utf8").includes('id: "backup-project"'));
  check("便携导出包含版本化 manifest、CSV、JSONL 和 Markdown/frontmatter",
    portableNames.includes("Portable/manifest.json")
      && portableNames.includes("Portable/entities.csv")
      && portableNames.includes("Portable/JSONL/entity_relations.jsonl")
      && projectMarkdown
      && Buffer.from(portableFiles[projectMarkdown]).toString("utf8").includes("# 备份项目"));
  check("便携交换文件全部进入逐项哈希清单",
    portable.manifest.portable.formats.join(",") === "markdown-frontmatter,csv,jsonl,resources"
      && portable.manifest.portable.files.every((entry) => portableFiles[entry.entry]?.length === entry.bytes));

  const portableTamperedFiles = { ...portableFiles, "Portable/entities.csv": new Uint8Array(Buffer.from("tampered")) };
  let portableTamperBlocked = false;
  try {
    await previewWorkspaceBundle(source, Buffer.from(zipSync(portableTamperedFiles)));
  } catch (error) {
    portableTamperBlocked = true;
    assert.match(error.message, /便携导出文件/);
  }
  check("便携交换文件被篡改时预览直接阻断", portableTamperBlocked);

  const preview = await previewWorkspaceBundle(source, full.bytes);
  const afterPreview = {
    entities: tableCount(source, "entities"),
    assets: tableCount(source, "assets"),
    backups: await fs.readdir(source.paths.backupsDir),
  };
  check("导入预览一个字节都不写当前工作区", JSON.stringify(afterPreview) === JSON.stringify(beforePreview));
  check("预览返回逐表数量、哈希和确认 SHA-256", preview.tables.some((table) => table.name === "entities" && table.incoming === 3) && preview.confirmationSha256 === full.archiveSha256);

  const unpacked = unzipSync(new Uint8Array(full.bytes));
  const imageEntry = full.manifest.assets.find((asset) => asset.id === seeded.imageAsset.id).archivePath;
  unpacked[imageEntry] = new Uint8Array(Buffer.from("tampered"));
  const tampered = Buffer.from(zipSync(unpacked));
  let tamperBlocked = false;
  try {
    await previewWorkspaceBundle(source, tampered);
  } catch (error) {
    tamperBlocked = true;
    assert.match(error.message, /资源 .*哈希损坏|大小不符/);
  }
  check("资源字节被篡改时预览直接阻断", tamperBlocked);

  source.repository.createEntity({ id: "post-backup-change", type: "capture", now: new Date("2026-08-30T01:12:00.000Z") });
  let badConfirmationBlocked = false;
  try {
    await stageWorkspaceRestore(source, full.bytes, { confirmedSha256: "0".repeat(64) });
  } catch (error) {
    badConfirmationBlocked = true;
    assert.match(error.message, /确认哈希/);
  }
  check("恢复必须确认本次预览的精确 SHA-256", badConfirmationBlocked);

  const staged = await stageWorkspaceRestore(source, full.bytes, {
    confirmedSha256: full.archiveSha256,
    now: new Date("2026-08-30T01:13:00.000Z"),
  });
  check("正式恢复先交付完整恢复点再等待重启", staged.restartRequired === true && staged.restorePoint.startsWith(source.paths.backupsDir));
  source.close();
  source = null;

  const applied = await applyPendingWorkspaceRestore({
    xenhoHome: sourceHome,
    now: new Date("2026-08-30T01:14:00.000Z"),
  });
  source = await openWorkspace({ xenhoHome: sourceHome, now: new Date("2026-08-30T01:15:00.000Z") });
  check("重启前不会切换，重启后原子恢复整工作区", applied.applied === true && source.repository.getEntity("post-backup-change", { includeDeleted: true }) === null);
  check("完整恢复保留 ID、正文、关系和笔记", source.repository.getEntity("backup-project")?.id === "backup-project" && source.repository.search("正文哈希", { limit: 5 })[0]?.id === "backup-project" && tableCount(source, "entity_relations") === 1 && tableCount(source, "knowledge_items") === 1);
  for (const asset of full.manifest.assets) {
    const verified = await source.assets.verify(asset.id);
    assert.equal(verified.ok, true, asset.id);
  }
  check("完整恢复后每个资源字节重新通过哈希验证", full.manifest.assets.length === 3);

  const portableTarget = path.join(root, "portable-target-Xenho");
  const imported = await importBundleIntoEmptyWorkspace({
    bytes: portable.bytes,
    targetXenhoHome: portableTarget,
    confirmedSha256: portable.archiveSha256,
    now: new Date("2026-08-30T01:20:00.000Z"),
  });
  const portableWorkspace = await openWorkspace({ xenhoHome: portableTarget, now: new Date("2026-08-30T01:21:00.000Z") });
  try {
    check("便携导出可导入新的空工作区", imported.applied === true && portableWorkspace.repository.getEntity("backup-project")?.id === "backup-project");
    check("便携导入保留图书元数据与笔记", tableCount(portableWorkspace, "books") === 1 && tableCount(portableWorkspace, "knowledge_items") === 1);
    const bookVerification = await portableWorkspace.assets.verify(seeded.bookAsset.id);
    const imageVerification = await portableWorkspace.assets.verify(seeded.imageAsset.id);
    check("便携导入明确缺少图书原件但保留其他资源", bookVerification.reason === "missing_file" && imageVerification.ok === true);
  } finally {
    portableWorkspace.close();
  }

  const conflictHome = path.join(root, "portable-conflict-Xenho");
  const conflict = await openWorkspace({ xenhoHome: conflictHome });
  try {
    conflict.repository.createEntity({ id: "existing-data", type: "capture" });
    const conflictPreview = await previewWorkspaceBundle(conflict, portable.bytes);
    assert.equal(conflictPreview.portableConflict, true);
    let portableConflictBlocked = false;
    try {
      await stageWorkspaceRestore(conflict, portable.bytes, { confirmedSha256: portable.archiveSha256 });
    } catch (error) {
      portableConflictBlocked = true;
      assert.match(error.message, /新的空工作区/);
    }
    check("便携导出不会覆盖已有数据的工作区", portableConflictBlocked);
  } finally {
    conflict.close();
  }

  const manual = await writeFullWorkspaceBackup(source, {
    category: "Manual-Test",
    now: new Date("2026-08-30T01:30:00.000Z"),
  });
  check("手动完整备份写入当前 Xenho 的 Backups", manual.file.startsWith(source.paths.backupsDir) && (await fs.stat(manual.file)).size === manual.bytes.length);
  const rotation = { maxDailyBackups: 2, maxWeeklyBackups: 2, maxAgeDays: 365 };
  const autoFirst = await ensureAutomaticWorkspaceBackup(source, { ...rotation, now: new Date("2026-07-01T01:00:00.000Z") });
  const autoSecond = await ensureAutomaticWorkspaceBackup(source, { ...rotation, now: new Date("2026-07-01T02:00:00.000Z") });
  await ensureAutomaticWorkspaceBackup(source, { ...rotation, now: new Date("2026-07-08T01:00:00.000Z") });
  await ensureAutomaticWorkspaceBackup(source, { ...rotation, now: new Date("2026-07-15T01:00:00.000Z") });
  const status = await workspaceBackupStatus(source);
  check("自动备份按间隔去重并分别轮换日备份与周备份",
    autoFirst.created === true
      && autoSecond.created === false
      && status.automatic.daily.length === 2
      && status.automatic.weekly.length === 2
      && status.policy.daily.maxBackups === 7
      && status.policy.weekly.maxBackups === 4);
  check("备份状态查询只读取当前本地工作区", status.workspaceId === source.manifest.workspaceId && status.database.tables.entities.count === 3);

  console.log("\n ✓ 阶段 5 完整备份、便携导出、冲突预览、恢复点和原子恢复全部通过");
} finally {
  if (source?.db?.open) source.close();
  await fs.rm(root, { recursive: true, force: true });
}
