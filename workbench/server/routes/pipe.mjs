// /api/pipe/* → 转发 content-studio Worker 的 /wb/* 端点。
//
// 为什么不让浏览器直连 Worker：WORKBENCH_KEY 得留在服务端。前端拿到 key 就等于
// 把它写进了浏览器可读的地方，而且 Worker 也就必须开 CORS。

import { json, fail, readJsonBody } from "../lib/http.mjs";
import { callWorker } from "../lib/worker.mjs";

/**
 * Worker 认不出这个端点 = 线上那份是旧版本。
 *
 * 原样回给用户的话，界面上就是一句「unknown endpoint: delete」——那是给开发者看的，
 * 用户只会以为功能坏了。按本项目的错误契约，报错要带**下一步动作**。
 */
function withDeployHint(data) {
  if (data?.ok === false && /unknown endpoint/i.test(data.error || "")) {
    return { ...data, error: "流水线 Worker 上还没有这个接口", hint: "在 content-studio/worker 里跑 npx wrangler deploy 更新 Worker" };
  }
  return data;
}

// 转发一个 GET，Worker 的响应原样回给前端
async function forwardGet(env, res, path, search) {
  const r = await callWorker(env, path, { search });
  json(res, withDeployHint(r.data), r.status);
}

// 转发一个 POST，先把请求体读出来
async function forwardPost(env, req, res, path) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return fail(res, e.message, { status: 400 });
  }
  const r = await callWorker(env, path, { method: "POST", body });
  json(res, withDeployHint(r.data), r.status);
}

export const pipeRoutes = [
  {
    method: "GET",
    path: "/api/pipe/ping",
    handler: ({ env, res }) => forwardGet(env, res, "ping"),
  },
  {
    method: "GET",
    path: "/api/pipe/status",
    handler: ({ env, res }) => forwardGet(env, res, "status"),
  },
  {
    method: "GET",
    path: "/api/pipe/list/:view",
    handler({ env, res, params, url }) {
      const search = new URLSearchParams();
      for (const k of ["state", "cursor", "pageSize"]) {
        const v = url.searchParams.get(k);
        if (v) search.set(k, v);
      }
      return forwardGet(env, res, `list/${params.view}`, search.toString());
    },
  },
  {
    method: "GET",
    path: "/api/pipe/search/:view",
    handler({ env, res, params, url }) {
      const search = new URLSearchParams();
      for (const k of ["q", "state", "limit"]) {
        const v = url.searchParams.get(k);
        if (v) search.set(k, v);
      }
      return forwardGet(env, res, `search/${params.view}`, search.toString());
    },
  },
  {
    method: "GET",
    path: "/api/pipe/page/:id",
    handler({ env, res, params, url }) {
      const view = url.searchParams.get("view");
      return forwardGet(env, res, `page/${params.id}`, view ? `view=${encodeURIComponent(view)}` : "");
    },
  },
  {
    method: "GET",
    path: "/api/pipe/comments/:id",
    handler: ({ env, res, params }) => forwardGet(env, res, `comments/${params.id}`),
  },
  {
    method: "GET",
    path: "/api/pipe/models",
    handler: ({ env, res }) => forwardGet(env, res, "models"),
  },
  {
    method: "POST",
    path: "/api/pipe/models",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "models"),
  },
  {
    method: "POST",
    path: "/api/pipe/intake",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "intake"),
  },
  {
    method: "POST",
    path: "/api/pipe/collections/:id/snapshot",
    handler: ({ env, req, res, params }) => forwardPost(env, req, res, `collections/${params.id}/snapshot`),
  },
  {
    method: "POST",
    path: "/api/pipe/collections/organize/preview",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "collections/organize/preview"),
  },
  {
    method: "POST",
    path: "/api/pipe/collections/organize/apply",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "collections/organize/apply"),
  },
  {
    method: "POST",
    path: "/api/pipe/create",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "create"),
  },
  {
    method: "POST",
    path: "/api/pipe/comment",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "comment"),
  },
  {
    method: "POST",
    path: "/api/pipe/update",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "update"),
  },
  {
    method: "POST",
    path: "/api/pipe/content",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "content"),
  },
  {
    method: "POST",
    path: "/api/pipe/publish",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "publish"),
  },
  {
    // 删除走 Worker 的统一归档规则，界面不要写成「永久删除」。
    method: "POST",
    path: "/api/pipe/delete",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "delete"),
  },
  {
    // 某个选题成稿之后，稿子在稿件库的哪几行
    method: "GET",
    path: "/api/pipe/drafts-of/:id",
    handler: ({ env, res, params }) => forwardGet(env, res, `drafts-of/${params.id}`),
  },
];
