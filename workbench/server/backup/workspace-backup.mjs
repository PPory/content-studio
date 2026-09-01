import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { atomicWrite } from "../lib/safe-write.mjs";
import { openWorkspace } from "../storage/workspace.mjs";
import { resolveWorkspacePaths } from "../storage/workspace-paths.mjs";

export const WORKSPACE_BUNDLE_FORMAT = "xenho-workspace-bundle";
export const WORKSPACE_BUNDLE_VERSION = 1;

const DATABASE_ENTRY = "Workspace/workspace.sqlite";
const WORKSPACE_MANIFEST_ENTRY = "Workspace/workspace.json";
const BUNDLE_MANIFEST_ENTRY = "manifest.json";
const README_ENTRY = "恢复说明.txt";
const PORTABLE_MANIFEST_ENTRY = "Portable/manifest.json";
const PORTABLE_FORMAT = "xenho-portable-interchange";
const PORTABLE_VERSION = 1;
const MAX_UNCOMPRESSED_BYTES = 2_500_000_000;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const iso = (value = new Date()) => new Date(value).toISOString();
const stamp = (value = new Date()) => iso(value).replace(/[:.]/g, "-");

function archivePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`备份包路径不安全：${value || "（空）"}`);
  }
  return normalized;
}

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function jsonValue(value) {
  if (Buffer.isBuffer(value)) return { $buffer: value.toString("base64") };
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return value.map(jsonValue);
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, jsonValue(value[key])]));
  }
  return value;
}

function summarizeDatabaseHandle(db) {
  const integrity = db.pragma("integrity_check").map((row) => row.integrity_check);
  const foreignKeys = db.pragma("foreign_key_check");
  if (integrity.length !== 1 || integrity[0] !== "ok" || foreignKeys.length) {
    throw new Error("工作区 SQLite 完整性或外键检查失败");
  }
  const names = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
  const tables = {};
  for (const name of names) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`SQLite 表名不安全：${name}`);
    const rows = db.prepare(`SELECT * FROM "${name}"`).all();
    const canonical = rows.map((row) => JSON.stringify(jsonValue(row))).sort().join("\n");
    tables[name] = { count: rows.length, sha256: sha256(canonical) };
  }
  return { integrity: "ok", foreignKeyIssues: 0, tables };
}

function summarizeDatabaseFile(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    return summarizeDatabaseHandle(db);
  } finally {
    db.close();
  }
}

function workspaceHasUserData(summary) {
  const ignored = new Set([
    "schema_migrations",
    "workspace_metadata",
    // 内置的运行时 Wiki 宪法和 migration 一样属于系统基线，不代表用户已经写入数据。
    "wiki_schema_versions",
    "entity_fts",
    "entity_fts_config",
    "entity_fts_content",
    "entity_fts_data",
    "entity_fts_docsize",
    "entity_fts_idx",
  ]);
  return Object.entries(summary.tables).some(([name, table]) => !ignored.has(name) && table.count > 0);
}

function manifestsEqual(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function portableTableNames(db) {
  const ignored = new Set([
    "entity_fts",
    "entity_fts_config",
    "entity_fts_content",
    "entity_fts_data",
    "entity_fts_docsize",
    "entity_fts_idx",
  ]);
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name).filter((name) => !ignored.has(name));
}

function portableInterchange(snapshotDb, { workspaceId, createdAt }) {
  const files = new Map();
  const entities = snapshotDb.prepare(`
    SELECT e.id, e.entity_type AS type, e.version, e.created_at AS createdAt,
           e.updated_at AS updatedAt, e.deleted_at AS deletedAt,
           COALESCE(t.title, '') AS title, COALESCE(t.body, '') AS body
    FROM entities e
    LEFT JOIN entity_text t ON t.entity_id = e.id
    ORDER BY e.id
  `).all();
  const csv = [
    ["id", "type", "version", "title", "created_at", "updated_at", "deleted_at"].map(csvCell).join(","),
    ...entities.map((row) => [
      row.id, row.type, row.version, row.title, row.createdAt, row.updatedAt, row.deletedAt,
    ].map(csvCell).join(",")),
  ].join("\r\n") + "\r\n";
  files.set("Portable/entities.csv", Buffer.from(csv, "utf8"));

  for (const row of entities) {
    const file = `Portable/Markdown/${sha256(row.id).slice(0, 16)}.md`;
    const frontmatter = [
      "---",
      `id: ${JSON.stringify(row.id)}`,
      `type: ${JSON.stringify(row.type)}`,
      `version: ${row.version}`,
      `created_at: ${JSON.stringify(row.createdAt)}`,
      `updated_at: ${JSON.stringify(row.updatedAt)}`,
      `deleted_at: ${row.deletedAt ? JSON.stringify(row.deletedAt) : "null"}`,
      "---",
      "",
    ].join("\n");
    const heading = row.title ? `# ${row.title}\n\n` : "";
    files.set(file, Buffer.from(`${frontmatter}${heading}${row.body || ""}\n`, "utf8"));
  }

  for (const table of portableTableNames(snapshotDb)) {
    if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error(`SQLite 表名不安全：${table}`);
    const rows = snapshotDb.prepare(`SELECT * FROM "${table}"`).all();
    const jsonl = rows.map((row) => JSON.stringify(jsonValue(row))).join("\n");
    files.set(`Portable/JSONL/${table}.jsonl`, Buffer.from(jsonl ? `${jsonl}\n` : "", "utf8"));
  }

  const dataFiles = [...files.entries()].map(([entry, bytes]) => ({
    entry,
    bytes: bytes.length,
    sha256: sha256(bytes),
  }));
  const portableManifest = {
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    createdAt,
    workspaceId,
    formats: ["markdown-frontmatter", "csv", "jsonl", "resources"],
    files: dataFiles,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(portableManifest, null, 2)}\n`, "utf8");
  files.set(PORTABLE_MANIFEST_ENTRY, manifestBytes);
  return {
    files,
    manifest: {
      ...portableManifest,
      files: [...dataFiles, {
        entry: PORTABLE_MANIFEST_ENTRY,
        bytes: manifestBytes.length,
        sha256: sha256(manifestBytes),
      }],
    },
  };
}

function recoveryReadme(manifest) {
  const excluded = manifest.assets.filter((asset) => !asset.included);
  return `Xenho OS 本地工作区${manifest.kind === "full" ? "完整备份" : "便携导出"}
生成时间：${manifest.createdAt}
工作区：${manifest.workspaceId}
确认哈希请以导入预览显示的 SHA-256 为准。

包含：
- 一致性 SQLite 快照，保留业务 ID、关系、正文、版本、设置与 AI 会话。
- ${manifest.assets.filter((asset) => asset.included).length} 个资源文件，逐项记录大小与 SHA-256。

${manifest.kind === "full"
    ? "完整备份包含全部图书原件、图片和附件，可用于整工作区恢复。"
    : `便携导出默认不带图书原件；本包排除 ${excluded.length} 个图书资源，但保留图书笔记和元数据。需要原件时重新导出并勾选“包含图书原件”。`}

不包含：
- .env、API key、token、secret 或其他本机密钥。
- Backups 和 Exports 目录，避免备份递归套娃。
- 任何不属于当前工作区目录的外部数据或远程副本。

恢复规则：
1. 先预览数量、表哈希、资源与冲突。
2. 确认预览给出的 SHA-256 后才能暂存恢复。
3. 现有工作区会先留下完整恢复点；重启后才原子切换。
`;
}

function readArchive(bytes) {
  let files;
  try {
    files = unzipSync(new Uint8Array(bytes));
  } catch {
    throw Object.assign(new Error("这不是可读取的 Xenho 工作区备份包"), { status: 400 });
  }
  let total = 0;
  for (const [name, content] of Object.entries(files)) {
    archivePath(name);
    total += content.length;
    if (total > MAX_UNCOMPRESSED_BYTES) throw Object.assign(new Error("备份解压后超过 2.5 GB 安全上限"), { status: 413 });
  }
  if (!files[BUNDLE_MANIFEST_ENTRY]) throw Object.assign(new Error("备份包缺少 manifest.json"), { status: 400 });
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(files[BUNDLE_MANIFEST_ENTRY]));
  } catch {
    throw Object.assign(new Error("备份包 manifest.json 无法解析"), { status: 400 });
  }
  if (manifest.format !== WORKSPACE_BUNDLE_FORMAT || manifest.version !== WORKSPACE_BUNDLE_VERSION) {
    throw Object.assign(new Error("备份包格式或版本不受支持"), { status: 400 });
  }
  if (!["full", "portable"].includes(manifest.kind) || !files[DATABASE_ENTRY] || !files[WORKSPACE_MANIFEST_ENTRY]) {
    throw Object.assign(new Error("备份包缺少工作区数据库或身份文件"), { status: 400 });
  }
  const declared = new Set([BUNDLE_MANIFEST_ENTRY, README_ENTRY, DATABASE_ENTRY, WORKSPACE_MANIFEST_ENTRY]);
  for (const asset of manifest.assets || []) {
    if (asset.included) declared.add(archivePath(asset.archivePath));
  }
  for (const portable of manifest.portable?.files || []) {
    declared.add(archivePath(portable.entry));
  }
  const unexpected = Object.keys(files).filter((name) => !declared.has(name));
  if (unexpected.length) throw Object.assign(new Error(`备份包含有未声明文件：${unexpected.slice(0, 3).join("、")}`), { status: 400 });
  return { files, manifest, archiveSha256: sha256(bytes) };
}

async function validateArchive(bytes) {
  const parsed = readArchive(bytes);
  const { files, manifest } = parsed;
  const databaseBytes = Buffer.from(files[DATABASE_ENTRY]);
  const workspaceManifestBytes = Buffer.from(files[WORKSPACE_MANIFEST_ENTRY]);
  if (databaseBytes.length !== manifest.database.bytes || sha256(databaseBytes) !== manifest.database.sha256) {
    throw Object.assign(new Error("备份中的 workspace.sqlite 大小或哈希不一致"), { status: 400 });
  }
  if (workspaceManifestBytes.length !== manifest.workspaceManifest.bytes || sha256(workspaceManifestBytes) !== manifest.workspaceManifest.sha256) {
    throw Object.assign(new Error("备份中的 workspace.json 大小或哈希不一致"), { status: 400 });
  }
  let identity;
  try {
    identity = JSON.parse(workspaceManifestBytes.toString("utf8"));
  } catch {
    throw Object.assign(new Error("备份中的 workspace.json 无法解析"), { status: 400 });
  }
  if (identity.workspaceId !== manifest.workspaceId) {
    throw Object.assign(new Error("备份数据库清单与工作区身份不一致"), { status: 400 });
  }
  for (const asset of manifest.assets || []) {
    if (!asset.included) {
      if (manifest.kind !== "portable" || asset.type !== "book") {
        throw Object.assign(new Error(`资源 ${asset.id} 被非法排除`), { status: 400 });
      }
      continue;
    }
    const content = files[archivePath(asset.archivePath)];
    if (!content || content.length !== asset.bytes || sha256(content) !== asset.sha256) {
      throw Object.assign(new Error(`资源 ${asset.id} 缺失、大小不符或哈希损坏`), { status: 400 });
    }
  }
  if (manifest.kind === "portable") {
    if (manifest.portable?.format !== PORTABLE_FORMAT || manifest.portable?.version !== PORTABLE_VERSION) {
      throw Object.assign(new Error("便携导出的交换格式或版本不受支持"), { status: 400 });
    }
    for (const portable of manifest.portable.files || []) {
      const content = files[archivePath(portable.entry)];
      if (!content || content.length !== portable.bytes || sha256(content) !== portable.sha256) {
        throw Object.assign(new Error(`便携导出文件 ${portable.entry} 缺失、大小不符或哈希损坏`), { status: 400 });
      }
    }
    let portableManifest;
    try {
      portableManifest = JSON.parse(strFromU8(files[PORTABLE_MANIFEST_ENTRY]));
    } catch {
      throw Object.assign(new Error("便携导出的 Portable/manifest.json 无法解析"), { status: 400 });
    }
    if (portableManifest.format !== PORTABLE_FORMAT || portableManifest.version !== PORTABLE_VERSION) {
      throw Object.assign(new Error("便携导出的 Portable/manifest.json 版本不受支持"), { status: 400 });
    }
  } else if (manifest.portable) {
    throw Object.assign(new Error("完整备份不应声明便携交换文件"), { status: 400 });
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-bundle-verify-"));
  try {
    const file = path.join(temp, "workspace.sqlite");
    await fs.writeFile(file, databaseBytes);
    const database = summarizeDatabaseFile(file);
    if (!manifestsEqual(database.tables, manifest.database.tables)) {
      throw Object.assign(new Error("备份数据库逐表数量或内容哈希与 manifest 不一致"), { status: 400 });
    }
    return { ...parsed, database, identity };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function assetManifest(workspace, snapshotDb, { kind, includeBookAssets }) {
  const rows = snapshotDb.prepare(`
    SELECT id, sha256, asset_type AS type, relative_path AS relativePath,
           original_name AS originalName, mime_type AS mimeType, byte_size AS bytes
    FROM assets
    ORDER BY id
  `).all();
  const assets = [];
  const contents = new Map();
  for (const row of rows) {
    const included = kind === "full" || row.type !== "book" || includeBookAssets;
    const file = workspace.assets.resolveRelative(row.relativePath);
    let bytes;
    try {
      bytes = await fs.readFile(file);
    } catch (error) {
      if (!included && error.code === "ENOENT") {
        assets.push({ ...row, included: false, archivePath: null, sourceMissing: true });
        continue;
      }
      throw new Error(`资源 ${row.id} 无法读取：${error.message}`);
    }
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) {
      throw new Error(`资源 ${row.id} 的实际字节与 SQLite 哈希不一致`);
    }
    const entry = included ? archivePath(`Workspace/${row.relativePath}`) : null;
    assets.push({ ...row, included, archivePath: entry, sourceMissing: false });
    if (included) contents.set(entry, bytes);
  }
  return { assets, contents };
}

export async function createWorkspaceBundle(workspace, {
  kind = "full",
  includeBookAssets = false,
  now = new Date(),
} = {}) {
  if (!workspace?.db?.open) throw new TypeError("工作区未打开");
  if (!["full", "portable"].includes(kind)) throw new TypeError("备份类型必须是 full 或 portable");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-workspace-bundle-"));
  try {
    const databaseFile = path.join(temp, "workspace.sqlite");
    await workspace.db.backup(databaseFile);
    const databaseBytes = await fs.readFile(databaseFile);
    const snapshotDb = new Database(databaseFile, { readonly: true, fileMustExist: true });
    const createdAt = iso(now);
    let database;
    let assetData;
    let portable;
    try {
      snapshotDb.pragma("foreign_keys = ON");
      database = summarizeDatabaseHandle(snapshotDb);
      assetData = await assetManifest(workspace, snapshotDb, { kind, includeBookAssets });
      portable = kind === "portable"
        ? portableInterchange(snapshotDb, { workspaceId: workspace.manifest.workspaceId, createdAt })
        : null;
    } finally {
      snapshotDb.close();
    }
    const workspaceManifestBytes = await fs.readFile(workspace.paths.manifestFile);
    const workspaceManifest = JSON.parse(workspaceManifestBytes.toString("utf8"));
    if (workspaceManifest.workspaceId !== workspace.manifest.workspaceId) {
      throw new Error("工作区身份文件在备份期间发生冲突");
    }
    const manifest = {
      format: WORKSPACE_BUNDLE_FORMAT,
      version: WORKSPACE_BUNDLE_VERSION,
      kind,
      createdAt,
      workspaceId: workspace.manifest.workspaceId,
      includeBookAssets: kind === "full" || includeBookAssets,
      database: {
        entry: DATABASE_ENTRY,
        bytes: databaseBytes.length,
        sha256: sha256(databaseBytes),
        tables: database.tables,
      },
      workspaceManifest: {
        entry: WORKSPACE_MANIFEST_ENTRY,
        bytes: workspaceManifestBytes.length,
        sha256: sha256(workspaceManifestBytes),
      },
      assets: assetData.assets,
      excluded: {
        bookAssets: assetData.assets.filter((asset) => asset.type === "book" && !asset.included).length,
        missingSourceAssets: assetData.assets.filter((asset) => asset.sourceMissing).length,
      },
      portable: portable?.manifest || null,
    };
    const files = {
      [DATABASE_ENTRY]: new Uint8Array(databaseBytes),
      [WORKSPACE_MANIFEST_ENTRY]: new Uint8Array(workspaceManifestBytes),
      [BUNDLE_MANIFEST_ENTRY]: strToU8(JSON.stringify(manifest, null, 2)),
      [README_ENTRY]: strToU8(recoveryReadme(manifest)),
    };
    for (const [entry, content] of assetData.contents) files[entry] = new Uint8Array(content);
    for (const [entry, content] of portable?.files || []) files[entry] = new Uint8Array(content);
    const bytes = Buffer.from(zipSync(files, { level: 6 }));
    const archiveSha256 = sha256(bytes);
    await validateArchive(bytes);
    return { bytes, manifest, archiveSha256 };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

export async function previewWorkspaceBundle(workspace, bytes) {
  const parsed = await validateArchive(bytes);
  const current = summarizeDatabaseHandle(workspace.db);
  return {
    kind: parsed.manifest.kind,
    createdAt: parsed.manifest.createdAt,
    workspaceId: parsed.manifest.workspaceId,
    currentWorkspaceId: workspace.manifest.workspaceId,
    confirmationSha256: parsed.archiveSha256,
    currentHasUserData: workspaceHasUserData(current),
    portableConflict: parsed.manifest.kind === "portable" && workspaceHasUserData(current),
    tables: Object.entries(parsed.manifest.database.tables).map(([name, incoming]) => ({
      name,
      current: current.tables[name]?.count || 0,
      incoming: incoming.count,
      currentSha256: current.tables[name]?.sha256 || "",
      incomingSha256: incoming.sha256,
      same: current.tables[name]?.sha256 === incoming.sha256,
    })),
    assets: {
      total: parsed.manifest.assets.length,
      included: parsed.manifest.assets.filter((asset) => asset.included).length,
      excludedBookAssets: parsed.manifest.excluded.bookAssets,
      bytes: parsed.manifest.assets.filter((asset) => asset.included).reduce((sum, asset) => sum + asset.bytes, 0),
      missing: parsed.manifest.assets.filter((asset) => asset.included && !parsed.files[asset.archivePath]).length,
    },
  };
}

async function listAutomaticBackups(directory) {
  let files = [];
  try {
    files = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^xenho-(?:full|weekly)-.*\.(?:xenho-backup|zip)$/.test(entry.name));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const details = await Promise.all(files.map(async (entry) => {
    const file = path.join(directory, entry.name);
    const stat = await fs.stat(file);
    return { file, name: entry.name, bytes: stat.size, at: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs };
  }));
  details.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return details;
}

async function pruneAutomaticBackups(directory, { maxBackups = 7, maxAgeDays = 30, now = new Date() } = {}) {
  const details = await listAutomaticBackups(directory);
  const cutoff = maxAgeDays == null ? null : new Date(now).getTime() - Math.max(1, maxAgeDays) * 86_400_000;
  const remove = details.filter((entry, index) => index >= Math.max(1, maxBackups) || (cutoff != null && entry.mtimeMs < cutoff));
  for (const entry of remove) await fs.rm(entry.file, { force: true });
  return details.filter((entry) => !remove.includes(entry));
}

export async function writeFullWorkspaceBackup(workspace, {
  category = "Manual",
  now = new Date(),
} = {}) {
  const directory = path.join(workspace.paths.backupsDir, category);
  await fs.mkdir(directory, { recursive: true });
  const bundle = await createWorkspaceBundle(workspace, { kind: "full", now });
  const file = path.join(directory, `xenho-full-${stamp(now)}.xenho-backup`);
  await atomicWrite(file, bundle.bytes);
  await fs.utimes(file, new Date(now), new Date(now));
  return { ...bundle, file };
}

function isoWeekKey(value) {
  const date = new Date(value);
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((current - yearStart) / 86_400_000) + 1) / 7);
  return `${current.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function ensureWeeklyBackup({ sourceFile, directory, now, maxBackups }) {
  await fs.mkdir(directory, { recursive: true });
  const week = isoWeekKey(now);
  const existing = await pruneAutomaticBackups(directory, { maxBackups, maxAgeDays: null, now });
  const current = existing.find((entry) => entry.name.includes(`-${week}-`));
  if (current) return { created: false, backup: current };
  const bytes = await fs.readFile(sourceFile);
  const file = path.join(directory, `xenho-weekly-${week}-${stamp(now)}.xenho-backup`);
  await atomicWrite(file, bytes);
  await fs.utimes(file, new Date(now), new Date(now));
  const kept = await pruneAutomaticBackups(directory, { maxBackups, maxAgeDays: null, now });
  return { created: true, backup: kept.find((entry) => entry.file === file) || null };
}

export async function ensureAutomaticWorkspaceBackup(workspace, {
  intervalHours = 24,
  maxDailyBackups = 7,
  maxWeeklyBackups = 4,
  maxAgeDays = 30,
  now = new Date(),
} = {}) {
  const dailyDirectory = path.join(workspace.paths.backupsDir, "Automatic", "Daily");
  const weeklyDirectory = path.join(workspace.paths.backupsDir, "Automatic", "Weekly");
  await fs.mkdir(dailyDirectory, { recursive: true });
  const existing = await pruneAutomaticBackups(dailyDirectory, { maxBackups: maxDailyBackups, maxAgeDays, now });
  const newest = existing.at(0);
  if (newest && new Date(now).getTime() - newest.mtimeMs < Math.max(1, intervalHours) * 3_600_000) {
    const weekly = await ensureWeeklyBackup({ sourceFile: newest.file, directory: weeklyDirectory, now, maxBackups: maxWeeklyBackups });
    return { created: false, backup: newest, weekly };
  }
  const created = await writeFullWorkspaceBackup(workspace, { category: path.join("Automatic", "Daily"), now });
  await pruneAutomaticBackups(dailyDirectory, { maxBackups: maxDailyBackups, maxAgeDays, now });
  const weekly = await ensureWeeklyBackup({ sourceFile: created.file, directory: weeklyDirectory, now, maxBackups: maxWeeklyBackups });
  return {
    created: true,
    backup: { file: created.file, name: path.basename(created.file), bytes: created.bytes.length, at: iso(now) },
    weekly,
  };
}

export async function workspaceBackupStatus(workspace) {
  const dailyDirectory = path.join(workspace.paths.backupsDir, "Automatic", "Daily");
  const weeklyDirectory = path.join(workspace.paths.backupsDir, "Automatic", "Weekly");
  const [daily, weekly] = await Promise.all([
    listAutomaticBackups(dailyDirectory),
    listAutomaticBackups(weeklyDirectory),
  ]);
  const database = summarizeDatabaseHandle(workspace.db);
  const assets = workspace.db.prepare("SELECT asset_type AS type, COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes FROM assets GROUP BY asset_type ORDER BY asset_type").all();
  return {
    ready: true,
    workspaceId: workspace.manifest.workspaceId,
    database: { tables: database.tables, bytes: (await fs.stat(workspace.paths.databaseFile)).size },
    assets,
    automatic: {
      daily: daily.map(({ name, bytes, at }) => ({ name, bytes, at })),
      weekly: weekly.map(({ name, bytes, at }) => ({ name, bytes, at })),
    },
    policy: {
      daily: { intervalHours: 24, maxBackups: 7, maxAgeDays: 30 },
      weekly: { maxBackups: 4 },
    },
  };
}

async function extractCandidate(parsed, candidateRoot) {
  const workspaceDir = path.join(candidateRoot, "Workspace");
  await fs.mkdir(workspaceDir, { recursive: true });
  const entries = [
    [DATABASE_ENTRY, path.join(workspaceDir, "workspace.sqlite")],
    [WORKSPACE_MANIFEST_ENTRY, path.join(workspaceDir, "workspace.json")],
  ];
  for (const asset of parsed.manifest.assets) {
    if (!asset.included) continue;
    const relative = archivePath(asset.archivePath).slice("Workspace/".length);
    const target = path.resolve(workspaceDir, ...relative.split("/"));
    if (!inside(workspaceDir, target)) throw new Error(`资源 ${asset.id} 的恢复路径越界`);
    entries.push([asset.archivePath, target]);
  }
  for (const [entry, target] of entries) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await atomicWrite(target, Buffer.from(parsed.files[entry]));
  }
  const candidate = await openWorkspace({ xenhoHome: candidateRoot });
  try {
    if (!candidate.check().ok) throw new Error("候选工作区重开检查失败");
  } finally {
    candidate.close();
  }
  return workspaceDir;
}

function pendingMarker(paths) {
  return path.join(paths.backupsDir, "pending-workspace-restore.json");
}

export async function stageWorkspaceRestore(workspace, bytes, { confirmedSha256, now = new Date() } = {}) {
  const preview = await previewWorkspaceBundle(workspace, bytes);
  if (!confirmedSha256 || confirmedSha256 !== preview.confirmationSha256) {
    throw Object.assign(new Error("恢复确认哈希与当前备份包不一致"), { status: 409, hint: "重新预览备份，再确认最新显示的 SHA-256。" });
  }
  if (preview.portableConflict) {
    throw Object.assign(new Error("便携导出只能导入新的空工作区"), {
      status: 409,
      hint: "当前工作区已有数据；请新建空工作区导入，或改用完整备份执行整工作区恢复。",
    });
  }
  const marker = pendingMarker(workspace.paths);
  try {
    await fs.access(marker);
    throw Object.assign(new Error("已经有一份待重启恢复的工作区"), { status: 409 });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const restorePoint = await writeFullWorkspaceBackup(workspace, { category: "Restore-Points", now });
  const parsed = await validateArchive(bytes);
  const candidateRoot = await fs.mkdtemp(path.join(workspace.paths.backupsDir, ".pending-workspace-"));
  try {
    await extractCandidate(parsed, candidateRoot);
    const payload = {
      format: "xenho-pending-restore",
      version: 1,
      createdAt: iso(now),
      candidateRoot,
      bundleSha256: preview.confirmationSha256,
      kind: preview.kind,
      restorePoint: restorePoint.file,
    };
    await atomicWrite(marker, `${JSON.stringify(payload, null, 2)}\n`, {
      verify: (text) => JSON.parse(text),
    });
    return { staged: true, restartRequired: true, marker, restorePoint: restorePoint.file, preview };
  } catch (error) {
    await fs.rm(candidateRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function applyPendingWorkspaceRestore({ xenhoHome, now = new Date() } = {}) {
  const paths = resolveWorkspacePaths({ xenhoHome });
  await fs.mkdir(paths.backupsDir, { recursive: true });
  const marker = pendingMarker(paths);
  const applying = `${marker}.applying`;
  let payload;
  try {
    await fs.rename(marker, applying);
    payload = JSON.parse(await fs.readFile(applying, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { applied: false };
    throw error;
  }
  const candidateRoot = path.resolve(payload.candidateRoot || "");
  const candidateWorkspace = path.join(candidateRoot, "Workspace");
  if (!inside(paths.backupsDir, candidateRoot) || !inside(candidateRoot, candidateWorkspace)) {
    await fs.rename(applying, marker).catch(() => {});
    throw new Error("待恢复候选目录不在当前工作区 Backups 内");
  }
  const restoreRoot = path.join(paths.backupsDir, `Restore-Point-${stamp(now)}`);
  const restoreWorkspace = path.join(restoreRoot, "Workspace");
  let movedCurrent = false;
  try {
    const candidate = await openWorkspace({ xenhoHome: candidateRoot });
    try {
      if (!candidate.check().ok) throw new Error("待恢复候选工作区校验失败");
    } finally {
      candidate.close();
    }
    await fs.mkdir(restoreRoot, { recursive: false });
    try {
      await fs.rename(paths.workspaceDir, restoreWorkspace);
      movedCurrent = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.rename(candidateWorkspace, paths.workspaceDir);
    const reopened = await openWorkspace({ xenhoHome: paths.root });
    try {
      if (!reopened.check().ok) throw new Error("恢复后工作区完整性检查失败");
    } finally {
      reopened.close();
    }
    await fs.rm(applying, { force: true });
    await fs.rm(candidateRoot, { recursive: true, force: true });
    return { applied: true, restorePoint: movedCurrent ? restoreRoot : "", bundleSha256: payload.bundleSha256, kind: payload.kind };
  } catch (error) {
    const currentExists = await fs.access(paths.workspaceDir).then(() => true, () => false);
    const restoreExists = await fs.access(restoreWorkspace).then(() => true, () => false);
    if (!currentExists && restoreExists) await fs.rename(restoreWorkspace, paths.workspaceDir).catch(() => {});
    await fs.rename(applying, marker).catch(() => {});
    throw error;
  }
}

export async function importBundleIntoEmptyWorkspace({ bytes, targetXenhoHome, confirmedSha256, now = new Date() }) {
  const workspace = await openWorkspace({ xenhoHome: targetXenhoHome, now });
  try {
    await stageWorkspaceRestore(workspace, bytes, { confirmedSha256, now });
  } finally {
    workspace.close();
  }
  return applyPendingWorkspaceRestore({ xenhoHome: targetXenhoHome, now });
}
