import crypto from "node:crypto";
import path from "node:path";

export const MEDIA_BUCKET = "workbench-media";
export const PERSONAL_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MEDIA_REF_PREFIX = ".xenho-media/";

const MIME_EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
};

function apiError(message, status = 500, hint = "") {
  return Object.assign(new Error(message), { status, hint });
}

function configOf(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_SECRET_KEY || "").trim();
  const workspaceId = String(env.SUPABASE_WORKSPACE_ID || PERSONAL_WORKSPACE_ID).trim();
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw apiError("Supabase 项目地址未配置或格式不正确", 503, "在设置中填写 SUPABASE_URL");
  }
  if (!key) {
    throw apiError("Supabase 服务端密钥尚未配置", 503, "只把 Secret key 填进本机设置，不要粘贴到聊天或前端");
  }
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw apiError("Supabase 工作区 ID 格式不正确", 500);
  return { url, key, workspaceId };
}

function authHeaders(key, extra = {}) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    ...extra,
  };
}

async function request(env, endpoint, options = {}) {
  const { url, key } = configOf(env);
  const response = await fetch(`${url}${endpoint}`, {
    ...options,
    headers: authHeaders(key, options.headers),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body.message || body.error || body.msg || body.hint || "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw apiError(`Supabase 操作失败（${response.status}）${detail ? `：${String(detail).slice(0, 300)}` : ""}`, response.status);
  }
  return response;
}

const encodeObjectPath = (value) => String(value).split("/").map(encodeURIComponent).join("/");

export function sniffImageType(bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 6 && ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (data.length >= 2 && data.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  return "";
}

function cleanName(value, mimeType) {
  const fallback = `image${MIME_EXTENSIONS[mimeType]}`;
  const name = path.basename(String(value || fallback)).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-").trim();
  return (name || fallback).slice(0, 255);
}

async function assetByFilter(env, filter) {
  const response = await request(env, `/rest/v1/media_assets?${filter}&select=*`, {
    headers: { accept: "application/json" },
  });
  const rows = await response.json();
  return rows[0] || null;
}

export async function mediaAssetById(env, id) {
  const { workspaceId } = configOf(env);
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  return assetByFilter(env, `workspace_id=eq.${encodeURIComponent(workspaceId)}&id=eq.${encodeURIComponent(id)}`);
}

export async function uploadMediaAsset(env, { bytes, originalName, source = "workbench" }) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!data.length) throw apiError("图片文件是空的", 400);
  if (data.length > MAX_MEDIA_BYTES) throw apiError("图片超过 10MB，飞书无法稳定同步", 413);
  const mimeType = sniffImageType(data);
  if (!mimeType) throw apiError("只支持 PNG、JPG、GIF、WebP 或 BMP 图片", 400);
  const { workspaceId } = configOf(env);
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  const existing = await assetByFilter(
    env,
    `workspace_id=eq.${encodeURIComponent(workspaceId)}&sha256=eq.${sha256}&select=*`
  );
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = new Date();
  const extension = MIME_EXTENSIONS[mimeType];
  const storagePath = `${workspaceId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}${extension}`;
  await request(env, `/storage/v1/object/${MEDIA_BUCKET}/${encodeObjectPath(storagePath)}`, {
    method: "POST",
    headers: { "content-type": mimeType, "x-upsert": "false" },
    body: data,
  });

  try {
    const response = await request(env, "/rest/v1/media_assets", {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify({
        id,
        workspace_id: workspaceId,
        bucket_id: MEDIA_BUCKET,
        storage_path: storagePath,
        original_name: cleanName(originalName, mimeType),
        mime_type: mimeType,
        size_bytes: data.length,
        sha256,
        source,
      }),
    });
    const rows = await response.json();
    return rows[0];
  } catch (error) {
    await request(env, `/storage/v1/object/${MEDIA_BUCKET}/${encodeObjectPath(storagePath)}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

export async function createMediaSignedUrl(env, asset, expiresIn = 600) {
  if (!asset?.storage_path) throw apiError("找不到图片资产", 404);
  const response = await request(env, `/storage/v1/object/sign/${MEDIA_BUCKET}/${encodeObjectPath(asset.storage_path)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
  const data = await response.json();
  const signed = data.signedURL || data.signedUrl || "";
  if (!signed) throw apiError("Supabase 没有返回图片临时链接", 502);
  if (/^https?:\/\//i.test(signed)) return signed;
  return `${configOf(env).url}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
}

export async function downloadMediaAsset(env, asset) {
  if (!asset?.storage_path) throw apiError("找不到图片资产", 404);
  const response = await request(env, `/storage/v1/object/${MEDIA_BUCKET}/${encodeObjectPath(asset.storage_path)}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function replaceExternalDocumentAssetMappings(env, {
  entityId,
  externalDocumentId,
  images,
  tokens,
}) {
  if (images.length !== tokens.length) {
    throw apiError("飞书返回的图片数量与工作台不一致，未保存图片映射", 502);
  }
  const { workspaceId } = configOf(env);
  const documentFilter = encodeURIComponent(externalDocumentId);
  await request(env, `/rest/v1/external_document_assets?provider=eq.feishu&external_document_id=eq.${documentFilter}`, {
    method: "DELETE",
  });
  const rows = images.map((image, ordinal) => image.asset ? {
    workspace_id: workspaceId,
    asset_id: image.asset.id,
    provider: "feishu",
    entity_type: "draft",
    entity_id: String(entityId),
    external_document_id: String(externalDocumentId),
    external_token: String(tokens[ordinal]),
    ordinal,
  } : null).filter(Boolean);
  if (!rows.length) return [];
  const response = await request(env, "/rest/v1/external_document_assets", {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  return response.json();
}

export function mediaReference(id) {
  return `${MEDIA_REF_PREFIX}${id}`;
}

export function mediaIdFromReference(value) {
  const decoded = decodeURIComponent(String(value || "").trim());
  if (!decoded.startsWith(MEDIA_REF_PREFIX)) return "";
  const id = decoded.slice(MEDIA_REF_PREFIX.length).split(/[?#]/, 1)[0];
  return /^[0-9a-f-]{36}$/i.test(id) ? id : "";
}
