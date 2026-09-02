import { fail, json, readJsonBody } from "../lib/http.mjs";
import { CONTENT_EXPERIMENT_VALUES } from "../domain/content-experiments.mjs";
import { extractExperimentProblemCandidates, previewExperimentSettlement, proposeExperimentHypotheses } from "../domain/content-experiments-ai.mjs";
import { hypothesisContext, settlementContext } from "../domain/content-experiment-context.mjs";
import { observePositioning } from "../domain/positioning.mjs";

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
    /** 只读观察，不写任何东西：定位是算出来的，不是存下来的一张表。 */
    method: "GET",
    path: "/api/workspace/positioning",
    handler: guard(async ({ workspace, res }) => json(res, { ok: true, positioning: observePositioning(workspace) })),
  },
  {
    /**
     * 发布前：这一篇最值得验证什么。
     *
     * ⚠️ 只产候选，不建实验。用户确认哪一条，才走 `POST /experiments` 记下来——
     * 而那一步仍然要求 `confirmed: true`。
     */
    method: "POST",
    path: "/api/workspace/projects/:id/hypothesis-candidates",
    handler: guard(async ({ env, workspace, res, params }) => {
      const before = workspace.db.prepare("SELECT COUNT(*) AS count FROM content_experiments").get().count;
      const context = hypothesisContext(workspace, params.id);
      const result = await proposeExperimentHypotheses(env, workspace, context);
      const after = workspace.db.prepare("SELECT COUNT(*) AS count FROM content_experiments").get().count;
      if (before !== after) throw new Error("提假设候选产生了不应有的写入");
      json(res, { ok: true, candidateOnly: true, ...result });
    }),
  },
  {
    /**
     * 发布后：这次到底发生了什么。
     *
     * ⚠️ 观察 / 推断 / 学习候选三段分开回，学习要用户确认之后才走 settle。
     * 这条端点一个字都不写库——真实数据不够时它甚至不跑模型。
     */
    method: "POST",
    path: "/api/workspace/experiments/:id/settlement-preview",
    handler: guard(async ({ env, workspace, req, res, params }) => {
      const body = await readJsonBody(req).catch(() => ({}));
      const before = workspace.db.prepare("SELECT COUNT(*) AS count FROM content_experiments WHERE verdict <> 'open'").get().count;
      const context = settlementContext(workspace, { experimentId: params.id, feedbackText: body.feedbackText });
      const result = await previewExperimentSettlement(env, workspace, context);
      const after = workspace.db.prepare("SELECT COUNT(*) AS count FROM content_experiments WHERE verdict <> 'open'").get().count;
      if (before !== after) throw new Error("结算预览产生了不应有的写入");
      json(res, {
        ok: true,
        candidateOnly: true,
        evidence: {
          publication: context.publication,
          metrics: context.metrics,
          metricLabels: context.metricLabels,
          baseline: context.baseline,
          hasEvidence: context.hasEvidence,
        },
        ...result,
      });
    }),
  },
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
