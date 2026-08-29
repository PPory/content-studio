import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../lib/safe-write.mjs";
import { createUlid } from "./ids.mjs";

const KINDS = Object.freeze({
  image: "images",
  book: "books",
  attachment: "attachments",
  import: "imports",
});

const isoNow = (now = new Date()) => new Date(now).toISOString();

function safeExtension(name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : ".bin";
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export class AssetStore {
  constructor({ db, paths }) {
    this.db = db;
    this.paths = paths;
  }

  async assertSafeAssetDirectory(kind) {
    const folder = KINDS[kind];
    if (!folder) throw new TypeError("资源类型必须是 image、book、attachment 或 import");
    const [workspaceReal, directoryReal] = await Promise.all([
      fs.realpath(this.paths.workspaceDir),
      fs.realpath(path.join(this.paths.assetsDir, folder)),
    ]);
    if (!inside(workspaceReal, directoryReal)) throw new Error("资源目录越过了 Xenho 工作区");
    return directoryReal;
  }

  async resolveStoredFile(asset) {
    const directory = await this.assertSafeAssetDirectory(asset.type);
    const expectedDirectory = path.join(this.paths.assetsDir, KINDS[asset.type]);
    const file = this.resolveRelative(asset.relativePath);
    if (!inside(expectedDirectory, file)) throw new Error("资源记录与资源类型目录不一致");
    if (!(await exists(file))) return file;
    const fileReal = await fs.realpath(file);
    if (!inside(directory, fileReal)) throw new Error("资源文件越过了对应类型目录");
    return fileReal;
  }

  async importBuffer({ bytes, type, originalName = "", mimeType = "application/octet-stream", now } = {}) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const existing = this.db.prepare(`
      SELECT id, sha256, asset_type AS type, relative_path AS relativePath,
             original_name AS originalName, mime_type AS mimeType, byte_size AS byteSize, deleted_at AS deletedAt
      FROM assets WHERE sha256 = ?
    `).get(sha256);
    if (existing) {
      const file = await this.resolveStoredFile(existing);
      if (!(await exists(file))) await atomicWrite(file, buffer);
      if (existing.deletedAt) this.db.prepare("UPDATE assets SET deleted_at = NULL WHERE id = ?").run(existing.id);
      return { ...existing, deletedAt: null, uri: `asset://${existing.id}`, deduplicated: true };
    }

    const directory = await this.assertSafeAssetDirectory(type);
    const extension = safeExtension(originalName);
    const filename = `${sha256}${extension}`;
    const file = path.join(directory, filename);
    const relativePath = path.relative(this.paths.workspaceDir, file).split(path.sep).join("/");
    const alreadyPresent = await exists(file);
    if (!alreadyPresent) await atomicWrite(file, buffer);
    const id = createUlid();
    try {
      this.db.prepare(`
        INSERT INTO assets(id, sha256, asset_type, relative_path, original_name, mime_type, byte_size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, sha256, type, relativePath, path.basename(String(originalName || "")), String(mimeType || "application/octet-stream"), buffer.length, isoNow(now));
    } catch (error) {
      const winner = this.db.prepare(`
        SELECT id, sha256, asset_type AS type, relative_path AS relativePath,
               original_name AS originalName, mime_type AS mimeType, byte_size AS byteSize, deleted_at AS deletedAt
        FROM assets WHERE sha256 = ?
      `).get(sha256);
      if (winner) {
        if (winner.deletedAt) this.db.prepare("UPDATE assets SET deleted_at = NULL WHERE id = ?").run(winner.id);
        return { ...winner, deletedAt: null, uri: `asset://${winner.id}`, deduplicated: true };
      }
      if (!alreadyPresent) await fs.rm(file, { force: true }).catch(() => {});
      throw error;
    }
    return { id, sha256, type, relativePath, originalName: path.basename(String(originalName || "")), mimeType, byteSize: buffer.length, deletedAt: null, uri: `asset://${id}`, deduplicated: false };
  }

  resolveRelative(relativePath) {
    const parts = String(relativePath || "").split("/").filter(Boolean);
    const target = path.resolve(this.paths.workspaceDir, ...parts);
    if (!inside(this.paths.workspaceDir, target)) throw new Error("资源路径越过了 Xenho 工作区");
    return target;
  }

  get(assetId, { includeDeleted = false } = {}) {
    const id = String(assetId || "").replace(/^asset:\/\//, "").trim();
    if (!id) return null;
    const row = this.db.prepare(`
      SELECT id, sha256, asset_type AS type, relative_path AS relativePath,
             original_name AS originalName, mime_type AS mimeType, byte_size AS byteSize,
             created_at AS createdAt, deleted_at AS deletedAt
      FROM assets WHERE id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}
    `).get(id);
    return row ? { ...row, uri: `asset://${row.id}` } : null;
  }

  softDelete(assetId, { now } = {}) {
    const id = String(assetId || "").replace(/^asset:\/\//, "").trim();
    return this.db.prepare("UPDATE assets SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(isoNow(now), id).changes === 1;
  }

  restore(assetId) {
    const id = String(assetId || "").replace(/^asset:\/\//, "").trim();
    return this.db.prepare("UPDATE assets SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL")
      .run(id).changes === 1;
  }

  async verify(assetId) {
    const asset = this.get(assetId, { includeDeleted: true });
    if (!asset) return { ok: false, reason: "not_found" };
    const file = await this.resolveStoredFile(asset);
    let bytes;
    try { bytes = await fs.readFile(file); } catch (error) {
      if (error.code === "ENOENT") return { ok: false, reason: "missing_file", asset };
      throw error;
    }
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    return { ok: sha256 === asset.sha256 && bytes.length === asset.byteSize, sha256, byteSize: bytes.length, asset };
  }
}
