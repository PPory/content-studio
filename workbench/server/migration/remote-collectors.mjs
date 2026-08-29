import crypto from "node:crypto";
import { documentFingerprint, fetchFeishuDocument, formatFeishuDraftTitle } from "../lib/feishu-sync.mjs";
import { downloadMediaAsset, mediaAssetById } from "../lib/supabase-media.mjs";

const MEDIA_REFERENCE = /\.xenho-media\/([0-9a-f-]{36})/gi;
const SHADOW_TABLES = ["inbox", "topics", "drafts", "materials", "tags", "material_tags", "inbox_tags", "topic_materials", "topic_inbox", "comments", "task_log", "settings", "agent_tasks", "external_documents", "seeds", "content_documents", "published_posts", "feishu_tree_nodes", "sync_conflicts"];

export function referencedMediaIds(d1Source) {
  const ids = new Set();
  for (const collection of Object.values(d1Source.records || {})) {
    for (const record of Array.isArray(collection) ? collection : []) {
      for (const value of Object.values(record || {})) {
        if (typeof value !== "string") continue;
        for (const match of value.matchAll(MEDIA_REFERENCE)) ids.add(match[1].toLowerCase());
      }
    }
  }
  return [...ids].sort();
}

async function shadowCount(env, table) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_SECRET_KEY || "").trim();
  const workspaceId = String(env.SUPABASE_WORKSPACE_ID || "00000000-0000-0000-0000-000000000001").trim();
  if (!url || !key) return null;
  const response = await fetch(`${url}/rest/v1/${table}?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`, {
    method: "HEAD",
    headers: { apikey: key, authorization: `Bearer ${key}`, prefer: "count=exact", range: "0-0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Supabase 影子表 ${table} 只读计数失败（${response.status}）`);
  const range = response.headers.get("content-range") || "";
  const count = Number(range.split("/").at(-1));
  return Number.isSafeInteger(count) ? count : null;
}

export async function collectSupabaseSource({ env, mediaIds, mediaAsset = mediaAssetById, download = downloadMediaAsset }) {
  const assets = [];
  const assetFiles = [];
  const missingAssets = [];
  for (const id of [...new Set(mediaIds || [])]) {
    const asset = await mediaAsset(env, id);
    if (!asset) { missingAssets.push({ id, reason: "media_assets 记录不存在" }); continue; }
    const bytes = await download(env, asset);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (asset.sha256 && asset.sha256 !== digest) { missingAssets.push({ id, reason: "下载字节与 Supabase SHA-256 不一致" }); continue; }
    if (asset.size_bytes != null && Number(asset.size_bytes) !== bytes.length) { missingAssets.push({ id, reason: "下载字节数与 Supabase 记录不一致" }); continue; }
    const extension = String(asset.original_name || "").match(/\.[a-z0-9]{1,10}$/i)?.[0]?.toLowerCase() || ".bin";
    const relative = `assets/supabase/${digest}${extension}`;
    assets.push({ id, path: relative, type: "image", originalName: asset.original_name || `${id}${extension}`, mimeType: asset.mime_type || "application/octet-stream", referenced: true });
    assetFiles.push({ source: "supabase", path: relative, bytes });
  }
  const shadowCounts = {};
  if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
    for (const table of SHADOW_TABLES) shadowCounts[table] = await shadowCount(env, table);
  }
  return { source: { records: {}, assets, inventory: { referencedMedia: mediaIds.length, shadowCounts }, missingAssets }, assetFiles };
}

export async function collectFeishuSource({ mappings, draftsById, fetchDocument = fetchFeishuDocument }) {
  const mappedDocuments = [];
  for (const binding of mappings || []) {
    if (binding.provider !== "feishu" || binding.entity_type !== "draft") continue;
    const draft = draftsById.get(binding.entity_id);
    if (!draft) {
      mappedDocuments.push({ id: binding.id, localHash: "", remoteHash: "", baseHash: binding.content_hash || "", localChanged: true, remoteChanged: true, error: "D1 中找不到映射稿件" });
      continue;
    }
    const remote = await fetchDocument(binding.external_id);
    const localHash = documentFingerprint(formatFeishuDraftTitle(draft.headline || draft.title, draft.platform), draft.body || draft.bodyMarkdown || "");
    const remoteHash = documentFingerprint(remote.title, remote.markdown);
    mappedDocuments.push({
      id: binding.id, externalId: binding.external_id, entityId: binding.entity_id,
      baseHash: binding.content_hash || "", baseRemoteHash: binding.remote_hash || "", localHash, remoteHash,
      localChanged: localHash !== (binding.content_hash || ""), remoteChanged: remoteHash !== (binding.remote_hash || ""),
    });
  }
  return { records: {}, assets: [], checks: { mappedDocuments }, inventory: { mappedDocuments: mappedDocuments.length } };
}
