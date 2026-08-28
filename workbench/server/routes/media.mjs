import { fail, json, readRawBody } from "../lib/http.mjs";
import {
  downloadMediaAsset,
  MAX_MEDIA_BYTES,
  mediaAssetById,
  mediaReference,
  uploadMediaAsset,
} from "../lib/supabase-media.mjs";

function guard(handler) {
  return async (ctx) => {
    try {
      await handler(ctx);
    } catch (error) {
      fail(ctx.res, error.message || "图片处理失败", {
        status: error.status || 500,
        hint: error.hint,
      });
    }
  };
}

export const mediaRoutes = [
  {
    method: "POST",
    path: "/api/media",
    handler: guard(async ({ env, req, res, url }) => {
      const bytes = await readRawBody(req, MAX_MEDIA_BYTES + 1);
      const asset = await uploadMediaAsset(env, {
        bytes,
        originalName: url.searchParams.get("name") || "image",
        source: "workbench",
      });
      json(res, {
        ok: true,
        id: asset.id,
        path: mediaReference(asset.id),
        kind: "image",
        mimeType: asset.mime_type,
        size: Number(asset.size_bytes),
      });
    }),
  },
  {
    method: "GET",
    path: "/api/media/:id",
    handler: guard(async ({ env, res, params }) => {
      const asset = await mediaAssetById(env, params.id);
      if (!asset) return fail(res, "找不到图片", { status: 404 });
      const bytes = await downloadMediaAsset(env, asset);
      res.writeHead(200, {
        "content-type": asset.mime_type,
        "content-length": String(bytes.length),
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      });
      res.end(bytes);
    }),
  },
];
