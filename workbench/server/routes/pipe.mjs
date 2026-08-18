// /api/pipe/* → 转发 content-studio Worker 的 /wb/* 端点。
//
// 为什么不让浏览器直连 Worker：WORKBENCH_KEY 得留在服务端。前端拿到 key 就等于
// 把它写进了浏览器可读的地方，而且 Worker 也就必须开 CORS。
//
// **除了 `/delete`，这里每一条都是纯转发。** 删除多一步「把 vault 里那份归档
// 移进废纸篓」，因为那件事只有本机做得到——理由写在那条路由上。加新路由时
// 别照着它写：转发是常态，动本机文件是例外。

import { json, fail, readJsonBody } from "../lib/http.mjs";
import { callWorker } from "../lib/worker.mjs";
import { vaultRoot, trashFile } from "../lib/vault.mjs";

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
    /**
     * 按意思挑素材。**整件事都在 Worker 那侧做**：候选清单是整库素材，而库就在那儿，
     * LLM 代理也在那儿——一次调用、秒级。
     *
     * 试过让工作台自己 spawn 本机 CLI 来挑，撤了：那要十几秒（而这只是一次搜索），
     * 还等于让工作台持有「素材怎么挑」这条数据规则。**规则跟着数据走。**
     */
    method: "POST",
    path: "/api/pipe/pick/materials",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "pick/materials"),
  },
  {
    /**
     * 按素材起稿。**在 Worker 那侧收齐 + 过真实性闸门再返回**，所以这一条会挂很久
     * （几十秒到两三分钟），要单独给一个长超时——默认那个是按「查一次库」定的。
     *
     * Worker 生成期间每 10 秒发一个换行心跳（不然连接会被当成卡死的请求掐掉），
     * 而 `callWorker` 是读完整段再 `JSON.parse`，前导空白它不在乎，所以这里照旧转发就行。
     */
    method: "POST",
    path: "/api/pipe/draft/material",
    async handler({ env, req, res }) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return fail(res, e.message, { status: 400 });
      }
      const r = await callWorker(env, "draft/material", { method: "POST", body, timeoutMs: 300_000 });
      json(res, withDeployHint(r.data), r.status);
    },
  },
  {
    /** 写作推动同样先收齐、过真实性闸门，再把候选结果交给用户决定是否插入。 */
    method: "POST",
    path: "/api/pipe/writing-assist",
    async handler({ env, req, res }) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return fail(res, e.message, { status: 400 });
      }
      const r = await callWorker(env, "writing-assist", { method: "POST", body, timeoutMs: 300_000 });
      json(res, withDeployHint(r.data), r.status);
    },
  },
  {
    /**
     * 正文里哪一句来自哪条素材。**对齐算法在 Worker 那侧**（`worker/src/lib/cite.js`），
     * 因为它和真实性闸门共用同一套归一化和二字组判据——挪一份到工作台来，
     * 两边迟早会漂，而漂了不报错，只是标注开始和闸门说的不是一回事。
     *
     * 不慢：纯字符串比对、一次查库，没有 LLM 调用，所以用默认超时。
     */
    method: "POST",
    path: "/api/pipe/cite",
    handler: ({ env, req, res }) => forwardPost(env, req, res, "cite"),
  },
  {
    // 各环节用哪个模型。**真源在 Worker 的 D1 里**（`worker/src/lib/models.js`）——
    // cron 任务、两个 Bot、工作台读的是同一份，所以这儿只转发，不在本地存第二份。
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
    /**
     * 删除。**这一条不是纯转发**——它是这个文件里唯一会动本机文件的路由。
     *
     * Worker 删的是 D1 那一行；vault 里那份归档它碰不到，也不该碰：它只有
     * GitHub Contents API、明令「只增不改」，而且跑在 Cloudflare 上，
     * 够不着你本机的 `.trash/`。**所以「删了 Obsidian 里还在」不是漏了一步，
     * 是那条路上根本没有本机。** 本机这一环只能在这儿补。
     *
     * ⚠️ **顺序不能反：先删库，再动文件。** 反过来的话，文件已经进废纸篓、
     * 而删库那一步失败（key 过期、网络断），库里那行还在、归档却没了——
     * 下一轮 backfill 看到 `vault_path` 有值也不会补写，你得自己去废纸篓捞。
     *
     * ⚠️ **清归档失败绝不能让删除看起来失败。** D1 那行已经删了，这时候回一个
     * 500，用户会再点一次然后收到「not found」，然后以为东西没删掉。
     * 和 Worker 侧 `tryArchive` 同一条：归档是副产物，不能反过来决定主动作的成败。
     * 失败照实回一个 `archive` 状态，界面上说清「归档没清掉，要手动删」。
     */
    method: "POST",
    path: "/api/pipe/delete",
    async handler({ env, req, res }) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return fail(res, e.message, { status: 400 });
      }
      const r = await callWorker(env, "delete", { method: "POST", body });
      const data = withDeployHint(r.data);
      if (!data?.ok) return json(res, data, r.status);
      json(res, { ...data, archive: await trashArchive(env, data.vaultPath) }, r.status);
    },
  },
  {
    // 某个选题成稿之后，稿子在稿件库的哪几行
    method: "GET",
    path: "/api/pipe/drafts-of/:id",
    handler: ({ env, res, params }) => forwardGet(env, res, `drafts-of/${params.id}`),
  },
];

/**
 * 清掉 vault 里那份归档。回的是一个**状态**而不是抛异常，四种情况界面上要分开说：
 *
 * - `none`    这条本来就没归档过（`vault_path` 为空，或 Worker 还是旧版本不回这个字段）
 * - `missing` 库里记着路径，但文件已经不在了（你自己在 Obsidian 里先删过）
 * - `trashed` 移进 `.trash/` 了，能捞回来
 * - `failed`  没能移动，原文件还在原地——这一条必须让用户看见，否则孤儿会一直攒着
 */
async function trashArchive(env, vaultPath) {
  const rel = String(vaultPath || "").trim();
  if (!rel) return { status: "none" };
  try {
    const moved = await trashFile(vaultRoot(env), rel);
    return moved ? { status: "trashed", ...moved } : { status: "missing", from: rel };
  } catch (e) {
    return { status: "failed", from: rel, error: e.message, hint: e.hint || "去 Obsidian 里手动删掉这个文件" };
  }
}
