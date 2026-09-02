import { fail, json, readJsonBody } from "../lib/http.mjs";
import { CONTENT_EXPERIMENT_VALUES } from "../domain/content-experiments.mjs";
import { extractExperimentProblemCandidates } from "../domain/content-experiments-ai.mjs";

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guard(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await ready(context.workspace) }); }
    catch (error) {
      fail(context.res, error.message || "内容实验操作失败", {
        status: error.status || (/不存在/.test(error.message || "") ? 404 : 400),
        hint: error.hint,
      });
    }
  };
}

export const contentExperimentRoutes = [
  {
    method: "GET",
    path: "/api/workspace/experiments",
    handler: guard(async ({ workspace, res, url }) => {
      json(res, {
        ok: true,
        experiments: workspace.experiments.experiments({
          projectId: url.searchParams.get("project") || "",
          openOnly: url.searchParams.get("open") === "1",
        }),
        verdicts: CONTENT_EXPERIMENT_VALUES.verdicts,
      });
    }),
  },
  {
    method: "GET",
    path: "/api/workspace/experiments/:id",
    handler: guard(async ({ workspace, res, params }) => {
      json(res, {
        ok: true,
        experiment: workspace.experiments.experiment(params.id),
        problems: workspace.experiments.linkedProblems(params.id),
      });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/experiments",
    handler: guard(async ({ workspace, req, res }) => {
      const body = await readJsonBody(req);
      const id = workspace.experiments.recordHypothesis({
        projectId: body.projectId,
        hypothesisMarkdown: body.hypothesis || body.hypothesisMarkdown,
        actor: "user",
        confirmed: body.confirmed === true,
        now: new Date(),
      });
      json(res, { ok: true, experiment: workspace.experiments.experiment(id) });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/experiments/:id/update",
    handler: guard(async ({ workspace, req, res, params }) => {
      const body = await readJsonBody(req);
      workspace.experiments.updateHypothesis(params.id, {
        hypothesisMarkdown: body.hypothesis || body.hypothesisMarkdown,
        actor: "user",
        confirmed: body.confirmed === true,
        now: new Date(),
      });
      json(res, { ok: true, experiment: workspace.experiments.experiment(params.id) });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/experiments/:id/settle",
    handler: guard(async ({ workspace, req, res, params }) => {
      const body = await readJsonBody(req);
      workspace.experiments.settleExperiment(params.id, {
        publicationId: body.publicationId,
        outcomeMarkdown: body.outcome || body.outcomeMarkdown,
        learningMarkdown: body.learning || body.learningMarkdown,
        verdict: body.verdict,
        actor: "user",
        confirmed: body.confirmed === true,
        now: new Date(),
      });
      json(res, { ok: true, experiment: workspace.experiments.experiment(params.id) });
    }),
  },
  {
    /**
     * 学到的东西 → 用户问题候选。
     * 只提候选，不写库；写入仍然走 audience-problems 那条确认过的路。
     */
    method: "POST",
    path: "/api/workspace/experiments/:id/problem-candidates",
    handler: guard(async ({ env, workspace, req, res, params }) => {
      const body = await readJsonBody(req);
      const before = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
      const result = await extractExperimentProblemCandidates(env, workspace, {
        experimentId: params.id,
        feedbackText: body.feedbackText || body.feedback || "",
      });
      const after = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
      if (after !== before) throw new Error("实验回流产生了不应有的写入");
      json(res, { ok: true, candidateOnly: true, ...result });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/experiments/:id/link-problem",
    handler: guard(async ({ workspace, req, res, params }) => {
      const body = await readJsonBody(req);
      workspace.experiments.linkProblem(params.id, body.problemId, {
        actor: "user",
        confirmed: body.confirmed === true,
        now: new Date(),
      });
      json(res, { ok: true, problems: workspace.experiments.linkedProblems(params.id) });
    }),
  },
];
