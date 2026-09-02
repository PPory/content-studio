// 内容构造的本地 API。
//
// ⚠️ **两个端点都不写库。** 提路线、按一句话继续推，产出的始终是候选；
// 只有「保存为内容机会」走已有的 `/api/workspace/content-opportunities`，
// 那一步才有事务、freshness 和 provenance 硬闸。

import { fail, json, readJsonBody } from "../lib/http.mjs";
import { proposeConstructionRoutes, refineConstructionRoute } from "../domain/content-construction-ai.mjs";

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guard(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await ready(context.workspace) }); }
    catch (error) {
      fail(context.res, error.message || "内容构造失败", {
        status: error.status || (/不存在/.test(error.message || "") ? 404 : 400),
        hint: error.hint,
      });
    }
  };
}

/** 业务表行数。构造阶段前后必须一模一样。 */
function businessCounts(workspace) {
  const count = (table) => workspace.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  return {
    problems: count("audience_problems"),
    problemSources: count("audience_problem_sources"),
    opportunities: count("content_opportunities"),
    projects: count("projects"),
    drafts: count("drafts"),
    wikiPages: count("wiki_pages"),
  };
}

function assertNoWrites(workspace, before, what) {
  const after = businessCounts(workspace);
  for (const key of Object.keys(before)) {
    if (before[key] !== after[key]) throw new Error(`${what}产生了不应有的写入`);
  }
}

export const contentConstructionRoutes = [
  {
    method: "POST",
    path: "/api/workspace/content-construction/routes",
    handler: guard(async ({ env, workspace, req, res }) => {
      const body = await readJsonBody(req);
      const before = businessCounts(workspace);
      const result = await proposeConstructionRoutes(env, workspace, {
        connection: body.connection,
        agendaId: body.agendaId,
        count: body.count,
      });
      assertNoWrites(workspace, before, "构造路线");
      json(res, { ok: true, candidateOnly: true, ...result });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/content-construction/refine",
    handler: guard(async ({ env, workspace, req, res }) => {
      const body = await readJsonBody(req);
      const before = businessCounts(workspace);
      const result = await refineConstructionRoute(env, workspace, {
        connection: body.connection,
        route: body.route,
        instruction: body.instruction,
        agendaId: body.agendaId,
      });
      assertNoWrites(workspace, before, "继续推这条讲法");
      json(res, { ok: true, candidateOnly: true, ...result });
    }),
  },
];
