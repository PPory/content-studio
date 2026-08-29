import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createUlid, isUlid } from "../server/storage/ids.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { WORKSPACE_SCHEMA_VERSION } from "../server/storage/migrations.mjs";
import { configureWorkspaceDatabase, migrateWorkspaceDatabase } from "../server/storage/sqlite.mjs";
import { defaultXenhoHome, resolveWorkspacePaths, runtimeXenhoHome } from "../server/storage/workspace-paths.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-storage-"));
let workspace;

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function check(name, pass, detail = "") {
  assert(pass, `${name}${detail ? `：${detail}` : ""}`);
  console.log(` ✓ ${name}${detail ? `  ← ${detail}` : ""}`);
}

try {
  const fakeHome = path.join(root, "home");
  check("默认工作区位于文档目录下的 Xenho", defaultXenhoHome({ homeDir: fakeHome }) === path.join(fakeHome, "Documents", "Xenho"));
  const redirectedDocuments = path.join(root, "redirected-documents");
  check("Windows 文档目录重定向后使用系统真实路径", defaultXenhoHome({ documentsDir: redirectedDocuments, platform: "win32" }) === path.join(redirectedDocuments, "Xenho"));
  check("进程级临时工作区覆盖 .env 工作区", runtimeXenhoHome({ XENHO_HOME: "D:\\real" }, { XENHO_HOME: "C:\\temp\\isolated" }) === "C:\\temp\\isolated");
  assert.throws(() => resolveWorkspacePaths({ xenhoHome: "relative/path" }), /绝对路径/);
  assert.throws(() => resolveWorkspacePaths({ xenhoHome: path.parse(root).root }), /磁盘根目录/);

  const xenhoHome = path.join(root, "Xenho");
  const paths = resolveWorkspacePaths({ xenhoHome });
  check("路径解析本身不创建目录", !(await fs.stat(xenhoHome).then(() => true, () => false)));
  for (const candidate of Object.values(paths)) check(`路径留在临时根：${path.basename(candidate)}`, inside(root, candidate));

  const fixedNow = new Date("2026-08-29T00:00:00.000Z");
  workspace = await openWorkspace({ xenhoHome, now: fixedNow });
  check("工作区 ID 使用 ULID", isUlid(workspace.manifest.workspaceId), workspace.manifest.workspaceId);
  check("SQLite 文件写在隔离工作区", inside(root, workspace.paths.databaseFile));
  check("四类资源目录已创建", (await Promise.all([
    workspace.paths.imageAssetsDir,
    workspace.paths.bookAssetsDir,
    workspace.paths.attachmentAssetsDir,
    workspace.paths.importAssetsDir,
  ].map((item) => fs.stat(item)))).every((stat) => stat.isDirectory()));
  check("外键已启用", workspace.db.pragma("foreign_keys", { simple: true }) === 1);
  check("数据库使用 WAL", workspace.db.pragma("journal_mode", { simple: true }) === "wal");
  check("首次 migration 已记录", workspace.db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count === WORKSPACE_SCHEMA_VERSION);
  check("workspace.json 与数据库 ID 一致", workspace.repository.getMetadata("workspace_id") === workspace.manifest.workspaceId);

  const preservedId = "legacy-uuid-1234";
  workspace.repository.createEntity({ id: preservedId, type: "material", now: fixedNow });
  workspace.repository.setEntityText(preservedId, { title: "长期复利", body: "复利让小行动持续积累。", now: fixedNow });
  const projectId = workspace.repository.createEntity({ type: "project", now: fixedNow }).id;
  workspace.repository.relate(projectId, preservedId, "uses_material", { now: fixedNow });
  check("迁移记录可保留旧 ID", workspace.repository.getEntity(preservedId)?.id === preservedId);
  check("两字中文搜索有 LIKE 回退", workspace.repository.search("复利").some((item) => item.id === preservedId));

  assert.throws(() => workspace.repository.relate(projectId, "missing", "uses_material"), /FOREIGN KEY/);
  check("无效外键被拒绝", workspace.db.prepare("SELECT COUNT(*) AS count FROM entity_relations").get().count === 1);

  assert.throws(() => workspace.repository.transaction((repo) => {
    repo.createEntity({ id: "rollback-record", type: "material", now: fixedNow });
    throw new Error("rollback");
  }), /rollback/);
  check("事务失败后没有残留", workspace.repository.getEntity("rollback-record", { includeDeleted: true }) === null);
  assert.throws(() => workspace.repository.transaction(async () => true), /必须是同步函数/);
  check("异步回调不能伪装成 SQLite 事务", true);

  workspace.repository.softDeleteEntity(preservedId, { now: fixedNow });
  check("软删除记录不再出现在搜索", !workspace.repository.search("复利").some((item) => item.id === preservedId));
  check("软删除不会硬删正文", workspace.db.prepare("SELECT COUNT(*) AS count FROM entity_text WHERE entity_id = ?").get(preservedId).count === 1);
  workspace.repository.restoreEntity(preservedId, { now: fixedNow });
  check("恢复后搜索重新可见", workspace.repository.search("复利").some((item) => item.id === preservedId));

  const bytes = Buffer.from("real image bytes\u0000\u0001", "utf8");
  const imported = await workspace.assets.importBuffer({ bytes, type: "image", originalName: "示例.png", mimeType: "image/png", now: fixedNow });
  const duplicate = await workspace.assets.importBuffer({ bytes, type: "image", originalName: "另一个名字.png", mimeType: "image/png", now: fixedNow });
  check("资源使用稳定 asset URI", imported.uri === `asset://${imported.id}`);
  check("资源按 SHA-256 去重", duplicate.id === imported.id && duplicate.deduplicated);
  const verified = await workspace.assets.verify(imported.id);
  check("资源实际字节与数据库哈希一致", verified.ok && verified.sha256 === crypto.createHash("sha256").update(bytes).digest("hex"));
  check("资源文件位于临时工作区", inside(root, workspace.assets.resolveRelative(imported.relativePath)));
  workspace.db.prepare("UPDATE assets SET relative_path = ? WHERE id = ?").run("assets/books/wrong.png", imported.id);
  await assert.rejects(() => workspace.assets.verify(imported.id), /资源记录与资源类型目录不一致/);
  workspace.db.prepare("UPDATE assets SET relative_path = ? WHERE id = ?").run(imported.relativePath, imported.id);
  check("资源记录不能跨到其他类型目录", true);
  workspace.assets.softDelete(imported.id, { now: fixedNow });
  check("资源先软删除不移除字节", workspace.assets.get(imported.id) === null && (await workspace.assets.verify(imported.id)).ok);
  workspace.assets.restore(imported.id);

  const batch = workspace.repository.createImportBatch({ sourceType: "d1", sourceLabel: "snapshot", now: fixedNow });
  workspace.repository.addImportItem({ batchId: batch.id, sourceId: "old-1", targetId: preservedId, result: "imported", detail: { source: "d1" }, now: fixedNow });
  assert.throws(() => workspace.repository.addImportItem({ batchId: batch.id, sourceId: "old-1", result: "skipped", now: fixedNow }), /UNIQUE/);
  workspace.repository.finishImportBatch(batch.id, { summary: { imported: 1 }, now: fixedNow });
  check("导入逐项结果和去重约束已记录", workspace.repository.importItems(batch.id).length === 1);
  check("数据库完整性与外键检查通过", workspace.check().ok);

  const workspaceId = workspace.manifest.workspaceId;
  workspace.close();
  workspace = await openWorkspace({ xenhoHome });
  check("关闭重开后仍读取同一工作区", workspace.manifest.workspaceId === workspaceId && workspace.repository.getEntity(preservedId)?.id === preservedId);
  check("重复打开 migration 幂等", workspace.db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count === WORKSPACE_SCHEMA_VERSION);
  workspace.close();
  workspace = null;

  const checksumDb = new Database(path.join(root, "checksum.sqlite"));
  configureWorkspaceDatabase(checksumDb);
  migrateWorkspaceDatabase(checksumDb);
  checksumDb.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1").run("0".repeat(64));
  assert.throws(() => migrateWorkspaceDatabase(checksumDb), /校验和/);
  checksumDb.close();
  check("migration 校验和漂移会被拒绝", true);

  const gapDb = new Database(path.join(root, "gap.sqlite"));
  configureWorkspaceDatabase(gapDb);
  const gapSql = "SELECT 1;";
  assert.throws(() => migrateWorkspaceDatabase(gapDb, [{
    version: 2,
    name: "gap",
    sql: gapSql,
    checksum: crypto.createHash("sha256").update(gapSql).digest("hex"),
  }]), /连续递增/);
  gapDb.close();
  check("migration 缺号时拒绝执行", true);

  const failedDb = new Database(path.join(root, "failed.sqlite"));
  configureWorkspaceDatabase(failedDb);
  const badSql = "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT, checksum TEXT, applied_at TEXT); CREATE TABLE half_done(id TEXT); INVALID SQL;";
  assert.throws(() => migrateWorkspaceDatabase(failedDb, [{
    version: 1,
    name: "fails",
    sql: badSql,
    checksum: crypto.createHash("sha256").update(badSql).digest("hex"),
  }]), /syntax error/i);
  check("失败 migration 完整回滚", !failedDb.prepare("SELECT 1 FROM sqlite_master WHERE name = 'half_done'").get());
  failedDb.close();

  const brokenHome = path.join(root, "broken");
  const broken = await openWorkspace({ xenhoHome: brokenHome });
  const manifestPath = broken.paths.manifestFile;
  const changed = { ...broken.manifest, workspaceId: createUlid() };
  broken.close();
  await fs.writeFile(manifestPath, `${JSON.stringify(changed)}\n`, "utf8");
  await assert.rejects(() => openWorkspace({ xenhoHome: brokenHome }), /ID 不一致/);
  check("manifest 与数据库身份冲突时拒绝覆盖", true);

  const corruptHome = path.join(root, "corrupt");
  const corrupt = await openWorkspace({ xenhoHome: corruptHome });
  const corruptDatabaseFile = corrupt.paths.databaseFile;
  corrupt.close();
  const corruptDb = new Database(corruptDatabaseFile);
  corruptDb.prepare("UPDATE workspace_metadata SET value_json = ? WHERE key = ?").run("{broken", "workspace_id");
  corruptDb.close();
  await assert.rejects(() => openWorkspace({ xenhoHome: corruptHome }), /JSON 已损坏/);
  check("损坏的工作区元数据不会被静默覆盖", true);

  console.log("\n ✓ 本地 SQLite、FTS 回退、软删除、资源和导入审计全部通过");
} finally {
  if (workspace?.db?.open) workspace.close();
  await fs.rm(root, { recursive: true, force: true });
}
