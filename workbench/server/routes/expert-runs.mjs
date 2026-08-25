import { fail, json, readJsonBody } from "../lib/http.mjs";
import { cancelExpertRun, getExpertRun, piRuntimeInfo, listExpertRuns, startExpertRun } from "../agent-runtime/expert-runner.mjs";

export const expertRunRoutes = [
  {
    method: "GET",
    path: "/api/expert-runtime",
    async handler({ env, res }) { json(res, { ok: true, runtime: await piRuntimeInfo(env) }); },
  },
  {
    method: "POST",
    path: "/api/expert-runs",
    async handler({ env, req, res }) {
      try { json(res, { ok: true, run: await startExpertRun(env, await readJsonBody(req)) }, 202); }
      catch (error) { fail(res, error.message, { status: error.status || 500, hint: error.hint }); }
    },
  },
  {
    method: "GET",
    path: "/api/expert-runs",
    async handler({ env, res, url }) { json(res, { ok: true, runs: await listExpertRuns(url.searchParams.get("scope") || "", env) }); },
  },
  {
    method: "GET",
    path: "/api/expert-runs/:id",
    async handler({ env, res, params }) {
      const run = await getExpertRun(params.id, env);
      if (!run) return fail(res, "找不到这次专家任务", { status: 404 });
      json(res, { ok: true, run });
    },
  },
  {
    method: "POST",
    path: "/api/expert-runs/:id/cancel",
    async handler({ env, res, params }) {
      const run = await cancelExpertRun(params.id, env);
      if (!run) return fail(res, "找不到这次专家任务", { status: 404 });
      json(res, { ok: true, run });
    },
  },
];
