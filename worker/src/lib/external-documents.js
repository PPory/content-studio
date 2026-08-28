import { first, newId, now, run } from "./db.js";

const PROVIDERS = new Set(["feishu"]);
const ENTITY_TYPES = new Set(["draft"]);
const TOKEN_RE = /^[0-9A-Za-z_-]{8,160}$/;

function clean(value, limit = 1000) {
  return String(value ?? "").trim().slice(0, limit);
}

function externalUrl(value) {
  const text = clean(value, 2000);
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("飞书文档地址不合法");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !/(^|\.)(feishu\.cn|larksuite\.com)$/.test(host)) {
    throw new Error("只接受飞书或 Lark 的 HTTPS 文档地址");
  }
  return url.toString();
}

export function normalizeExternalDocumentInput(entityType, entityId, input = {}) {
  const provider = clean(input.provider || "feishu", 32).toLowerCase();
  const type = clean(entityType, 32).toLowerCase();
  const id = clean(entityId, 80);
  const externalId = clean(input.externalId, 160);
  if (!PROVIDERS.has(provider)) throw new Error(`不支持的文档提供者：${provider || "(空)"}`);
  if (!ENTITY_TYPES.has(type)) throw new Error(`不支持的内容类型：${type || "(空)"}`);
  if (!/^[0-9A-Za-z-]{20,40}$/.test(id)) throw new Error("内容 id 不合法");
  if (!TOKEN_RE.test(externalId)) throw new Error("飞书文档 token 不合法");
  return {
    provider,
    entityType: type,
    entityId: id,
    externalId,
    externalUrl: externalUrl(input.externalUrl),
    containerId: clean(input.containerId, 500),
    contentHash: clean(input.contentHash, 128),
    remoteHash: clean(input.remoteHash, 128),
    lastSource: input.lastSource === "remote" ? "remote" : "local",
  };
}

export function mapExternalDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    entityType: row.entity_type,
    entityId: row.entity_id,
    externalId: row.external_id,
    externalUrl: row.external_url || "",
    containerId: row.container_id || "",
    contentHash: row.content_hash || "",
    remoteHash: row.remote_hash || "",
    lastSource: row.last_source || "local",
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at * 1000).toISOString() : null,
  };
}

export async function getExternalDocument(env, provider, entityType, entityId) {
  return mapExternalDocument(await first(
    env,
    `SELECT * FROM external_documents
     WHERE provider = ? AND entity_type = ? AND entity_id = ?`,
    provider,
    entityType,
    entityId
  ));
}

export async function upsertExternalDocument(env, entityType, entityId, input) {
  const value = normalizeExternalDocumentInput(entityType, entityId, input);
  const ts = now();
  await run(
    env,
    `INSERT INTO external_documents (
       id, provider, entity_type, entity_id, external_id, external_url, container_id,
       content_hash, remote_hash, last_source, last_synced_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, entity_type, entity_id) DO UPDATE SET
       external_id = excluded.external_id,
       external_url = excluded.external_url,
       container_id = excluded.container_id,
       content_hash = excluded.content_hash,
       remote_hash = excluded.remote_hash,
       last_source = excluded.last_source,
       last_synced_at = excluded.last_synced_at,
       updated_at = excluded.updated_at`,
    newId(), value.provider, value.entityType, value.entityId, value.externalId,
    value.externalUrl, value.containerId, value.contentHash, value.remoteHash,
    value.lastSource, ts, ts, ts
  );
  return getExternalDocument(env, value.provider, value.entityType, value.entityId);
}
