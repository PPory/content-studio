// 原始用户声音的本地 API。
//
// ⚠️ **只有记录和读取，没有修改。** 这不是遗漏：证据层的全部价值就在于正文不会变。

import { fail, json, readJsonBody } from "../lib/http.mjs";
import { AUDIENCE_RAW_KINDS, extractProblemsFromVoice } from "../domain/audience-raw.mjs";

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
    /**
     * 从一段原话直接读用户问题。
     * ⚠️ 只产候选，不写库；确认保存仍走 POST /audience-problems，那条路会再做一次逐字校验。
     */
    method: "POST",
    path: "/api/workspace/audience-voices/:id/problem-candidates",
    handler: guard(async ({ env, workspace, res, params }) => {
      const before = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
      const result = await extractProblemsFromVoice(env, workspace, { rawSourceId: params.id });
      const after = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
      if (before !== after) throw new Error("读用户问题产生了不应有的写入");
      json(res, { ok: true, candidateOnly: true, ...result });
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
