// 浏览器扩展专用端点。只接受扩展服务进程加上的标记头，不开放 CORS。

import { fail, json, readJsonBody } from "../lib/http.mjs";
import { vaultRoot } from "../lib/vault.mjs";
import { addWebNote, editWebNote, readWebNotes } from "../lib/web-notes.mjs";

function guarded(fn) {
  return async (ctx) => {
    try {
      await fn(ctx);
    } catch (error) {
      fail(ctx.res, error.message || "扩展请求失败", {
        status: error.status || 500,
        hint: error.hint,
      });
    }
  };
}

export const extensionRoutes = [
  {
    method: "GET",
    path: "/api/extension/status",
    handler: guarded(async ({ env, res, extensionToken }) => {
      let vault = true;
      try { vaultRoot(env); } catch { vault = false; }
      json(res, {
        ok: true,
        name: "Xenho 网页助手",
        version: 2,
        product: "content-studio",
        protocolVersion: 2,
        pairToken: extensionToken,
        ready: vault && !!String(env.WORKER_URL || "").trim() && !!String(env.WORKBENCH_KEY || "").trim(),
        services: { vault, pipeline: !!String(env.WORKER_URL || "").trim() && !!String(env.WORKBENCH_KEY || "").trim() },
      });
    }),
  },
  {
    method: "GET",
    path: "/api/extension/annotations",
    handler: guarded(async ({ env, res, url }) => {
      const data = await readWebNotes(vaultRoot(env), {
        url: url.searchParams.get("url"),
        title: url.searchParams.get("title"),
      });
      json(res, { ok: true, ...data });
    }),
  },
  {
    method: "POST",
    path: "/api/extension/annotation",
    handler: guarded(async ({ env, req, res }) => {
      const data = await addWebNote(vaultRoot(env), await readJsonBody(req, 100_000));
      json(res, { ok: true, ...data });
    }),
  },
  {
    method: "POST",
    path: "/api/extension/annotation/edit",
    handler: guarded(async ({ env, req, res }) => {
      const data = await editWebNote(vaultRoot(env), await readJsonBody(req, 100_000));
      json(res, { ok: true, ...data });
    }),
  },
];
