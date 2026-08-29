import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MIGRATION_SNAPSHOT_FORMAT = "xenho-local-first-migration";
export const MIGRATION_SNAPSHOT_VERSION = 1;
export const MIGRATION_SOURCE_ORDER = Object.freeze(["d1", "local", "xenho", "obsidian", "supabase", "feishu"]);

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function migrationValueHash(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function safeRelative(value) {
  const relative = String(value || "").replaceAll("\\", "/");
  if (!relative || relative.startsWith("/") || relative.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`迁移快照包含不安全路径：${relative || "<empty>"}`);
  }
  return relative;
}

async function readVerifiedFile(root, entry) {
  const relative = safeRelative(entry.path);
  const file = path.resolve(root, ...relative.split("/"));
  if (!inside(root, file)) throw new Error(`迁移快照文件越过根目录：${relative}`);
  let bytes;
  try {
    bytes = await fs.readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`迁移快照缺少文件：${relative}`);
    throw error;
  }
  if (bytes.length !== entry.byteSize) throw new Error(`迁移快照文件大小不一致：${relative}`);
  if (sha256(bytes) !== entry.sha256) throw new Error(`迁移快照文件哈希不一致：${relative}`);
  return { file, bytes };
}

export async function loadMigrationSnapshot(snapshotDir) {
  const root = path.resolve(String(snapshotDir || ""));
  const manifestFile = path.join(root, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("迁移快照缺少 manifest.json");
    if (error instanceof SyntaxError) throw new Error("迁移快照 manifest.json 不是有效 JSON");
    throw error;
  }
  if (manifest.format !== MIGRATION_SNAPSHOT_FORMAT || manifest.formatVersion !== MIGRATION_SNAPSHOT_VERSION) {
    throw new Error("迁移快照格式或版本不受支持");
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error("迁移快照清单为空");
  const paths = new Set();
  const files = new Map();
  for (const entry of manifest.files) {
    if (!MIGRATION_SOURCE_ORDER.includes(entry.source)) throw new Error(`迁移快照来源不受支持：${entry.source}`);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 || "") || !Number.isSafeInteger(entry.byteSize) || entry.byteSize < 0) {
      throw new Error(`迁移快照文件元数据无效：${entry.path || "<unknown>"}`);
    }
    const relative = safeRelative(entry.path);
    if (paths.has(relative)) throw new Error(`迁移快照清单路径重复：${relative}`);
    paths.add(relative);
    files.set(relative, { ...entry, ...(await readVerifiedFile(root, { ...entry, path: relative })) });
  }

  const sources = new Map();
  for (const source of MIGRATION_SOURCE_ORDER) {
    const relative = `sources/${source}.json`;
    const entry = files.get(relative);
    if (!entry) continue;
    let data;
    try { data = JSON.parse(entry.bytes.toString("utf8")); } catch { throw new Error(`${relative} 不是有效 JSON`); }
    if (data.source !== source || typeof data.records !== "object" || Array.isArray(data.records)) {
      throw new Error(`${relative} 的来源或 records 结构无效`);
    }
    if (source === "obsidian" && data.workspaceScope !== "99 - 个人工作台") {
      throw new Error("Obsidian 快照范围必须精确为 99 - 个人工作台");
    }
    sources.set(source, data);
  }
  if (!sources.size) throw new Error("迁移快照没有来源数据文件");
  return { root, manifest, manifestSha256: sha256(await fs.readFile(manifestFile)), files, sources };
}

export async function writeMigrationSnapshot({ directory, sources, assetFiles = [], now = new Date() }) {
  const root = path.resolve(String(directory || ""));
  await fs.mkdir(path.join(root, "sources"), { recursive: true });
  const entries = [];
  for (const source of MIGRATION_SOURCE_ORDER) {
    if (!sources?.[source]) continue;
    const relative = `sources/${source}.json`;
    const bytes = Buffer.from(`${JSON.stringify({ source, ...sources[source] }, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(root, ...relative.split("/")), bytes);
    entries.push({ path: relative, source, kind: "records", byteSize: bytes.length, sha256: sha256(bytes) });
  }
  const writtenAssets = new Map();
  for (const asset of assetFiles) {
    const relative = safeRelative(asset.path);
    const target = path.join(root, ...relative.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const bytes = Buffer.isBuffer(asset.bytes) ? asset.bytes : Buffer.from(asset.bytes || []);
    const digest = sha256(bytes);
    const previous = writtenAssets.get(relative);
    if (previous) {
      if (previous.source !== asset.source || previous.sha256 !== digest || previous.byteSize !== bytes.length) throw new Error(`迁移快照资源路径冲突：${relative}`);
      continue;
    }
    await fs.writeFile(target, bytes);
    const entry = { path: relative, source: asset.source, kind: "asset", byteSize: bytes.length, sha256: digest };
    writtenAssets.set(relative, entry);
    entries.push(entry);
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    format: MIGRATION_SNAPSHOT_FORMAT,
    formatVersion: MIGRATION_SNAPSHOT_VERSION,
    createdAt: new Date(now).toISOString(),
    mode: "read-only-snapshot",
    files: entries,
  };
  await fs.writeFile(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}
