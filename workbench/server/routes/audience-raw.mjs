// 原始用户声音的本地 API。
//
// ⚠️ **只有记录和读取，没有修改。** 这不是遗漏：证据层的全部价值就在于正文不会变。

import { fail, json, readJsonBody } from "../lib/http.mjs";
import { AUDIENCE_RAW_KINDS } from "../domain/audience-raw.mjs";

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guard(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await ready(context.workspace) }); }
    catch (error) {
      fail(context.res, error.message || "用户声音操作失败", {
        status: error.status || (/不存在/.test(error.message || "") ? 404 : 400),
        hint: error.hint,
      });
    }
  };
}

export const audienceRawRoutes = [
  {
    method: "GET",
    path: "/api/workspace/audience-voices",
    handler: guard(async ({ workspace, res, url }) => {
      json(res, {
        ok: true,
        kinds: AUDIENCE_RAW_KINDS,
        stats: workspace.audienceRaw.stats(),
        voices: workspace.audienceRaw.sources({
          limit: Number(url.searchParams.get("limit")) || 20,
          pendingOnly: url.searchParams.get("pending") === "1",
        }).map((voice) => ({ ...voice, citations: workspace.audienceRaw.citationCount(voice.id) })),
      });
    }),
  },
  {
    method: "GET",
    path: "/api/workspace/audience-voices/:id",
    handler: guard(async ({ workspace, res, params }) => {
      const voice = workspace.audienceRaw.source(params.id);
      json(res, { ok: true, voice: { ...voice, citations: workspace.audienceRaw.citationCount(voice.id) } });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/audience-voices",
    handler: guard(async ({ workspace, req, res }) => {
      const body = await readJsonBody(req);
      const result = workspace.audienceRaw.record({
        kind: body.kind,
        body: body.body ?? body.text,
        sourceName: body.sourceName,
        sourceUrl: body.sourceUrl,
        observedAt: body.observedAt,
        actor: "user",
        confirmed: body.confirmed === true,
        now: new Date(),
      });
      json(res, {
        ok: true,
        duplicate: result.duplicate,
        voice: { ...result.source, citations: workspace.audienceRaw.citationCount(result.id) },
      });
    }),
  },
];
