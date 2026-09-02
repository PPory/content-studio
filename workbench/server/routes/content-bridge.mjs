import { fail, json, readJsonBody } from "../lib/http.mjs";
import { extractAgendaProblemCandidates, extractAudienceProblemCandidates, previewContentOpportunity, previewContentOpportunityAgendaFit } from "../domain/content-bridge-ai.mjs";
import { CONTENT_BRIDGE_VALUES } from "../domain/content-bridge.mjs";

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guard(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await ready(context.workspace) }); }
    catch (error) {
      fail(context.res, error.message || "内容桥接操作失败", {
        status: error.status || (/不存在/.test(error.message || "") ? 404 : 400),
        hint: error.hint,
      });
    }
  };
}

function sourceRef(body) {
  return body.sourceRef || body.sources?.[0]?.sourceId || body.sources?.[0]?.source_id || "";
}

export const contentBridgeRoutes = [
  {
    method: "GET",
    path: "/api/workspace/agendas",
    handler: guard(async ({ workspace, res, url }) => {
      json(res, { ok: true, agendas: workspace.contentBridge.agendas({ includeArchived: url.searchParams.get("archived") === "1" }) });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/agendas",
    handler: guard(async ({ workspace, req, res }) => {
      const body = await readJsonBody(req);
      const id = workspace.contentBridge.createAgenda({
        title: body.title,
        audience: body.audience,
        problemSpace: body.problemSpace,
        desiredJudgment: body.desiredJudgment,
        valueCommitment: body.valueCommitment,
        relatedProduct: body.relatedProduct,
        actor: "user",
        confirmed: body.confirmed === true,
        now: new Date(),
      });
      json(res, { ok: true, agenda: workspace.contentBridge.agenda(id) });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/agendas/:id/update",
    handler: guard(async ({ workspace, req, res, params }) => {
      const body = await readJsonBody(req);
      if (body.action === "archive" || body.action === "restore") {
        workspace.contentBridge.setAgendaArchived(params.id, body.action === "archive", { actor: "user", confirmed: body.confirmed === true, now: new Date() });
      } else {
        workspace.contentBridge.updateAgenda(params.id, {
          title: body.title,
          audience: body.audience,
          problemSpace: body.problemSpace,
          desiredJudgment: body.desiredJudgment,
          valueCommitment: body.valueCommitment,
          relatedProduct: body.relatedProduct,
          actor: "user",
          confirmed: body.confirmed === true,
          now: new Date(),
        });
      }
      json(res, { ok: true, agenda: workspace.contentBridge.agenda(params.id) });
    }),
  },
  {
    method: "GET",
    path: "/api/workspace/audience-problems",
    handler: guard(async ({ workspace, res, url }) => {
      json(res, {
        ok: true,
        problems: workspace.contentBridge.audienceProblems({ includeArchived: url.searchParams.get("archived") === "1" }),
        sourceKinds: CONTENT_BRIDGE_VALUES.sourceKinds,
        patterns: CONTENT_BRIDGE_VALUES.problemPatterns,
      });
    }),
  },
  {
    method: "GET",
    path: "/api/workspace/audience-problems/:id",
    handler: guard(async ({ workspace, res, params }) => {
      json(res, { ok: true, problem: workspace.contentBridge.audienceProblem(params.id) });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/audience-problems/extract",
    handler: guard(async ({ env, workspace, req, res }) => {
      const body = await readJsonBody(req);
      const before = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
      const result = await extractAudienceProblemCandidates(env, workspace, { insightId: body.insightId });
      const after = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
      if (after !== before) throw new Error("提取候选产生了不应有的写入");
      json(res, { ok: true, candidateOnly: true, ...result });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/audience-problems/from-agenda",
    handler: guard(async ({ env, workspace, req, res }) => {
      const body = await readJsonBody(req);
      const before = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
      const result = await extractAgendaProblemCandidates(env, workspace, { agendaId: body.agendaId });
      const after = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
      if (after !== before) throw new Error("议程推导产生了不应有的写入");
      json(res, { ok: true, candidateOnly: true, ...result });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/audience-problems",
    handler: guard(async ({ workspace, req, res }) => {
      const body = await readJsonBody(req);
      const id = workspace.contentBridge.createAudienceProblem({
        statement: body.statement,
        summary: body.summary || body.whyItMatters,
        sourceKind: body.sourceKind,
        sourceRef: sourceRef(body),
        pattern: body.pattern,
        sources: body.sources,
        origin: body.origin,
        originAgendaId: body.originAgendaId,
        actor: "user",
        confirmed: body.confirmed === true,
        now: new Date(),
      });
      json(res, { ok: true, problem: workspace.contentBridge.audienceProblem(id) });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/audience-problems/:id/update",
    handler: guard(async ({ workspace, req, res, params }) => {
      const body = await readJsonBody(req);
      if (!["archive", "restore"].includes(body.action)) throw new Error("用户问题更新动作不受支持");
      workspace.contentBridge.setAudienceProblemArchived(params.id, body.action === "archive", { actor: "user", confirmed: body.confirmed === true, now: new Date() });
      json(res, { ok: true, problem: workspace.contentBridge.audienceProblem(params.id) });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/content-opportunities/preview",
    handler: guard(async ({ env, workspace, req, res }) => {
      const body = await readJsonBody(req);
      const before = {
        opportunities: workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count,
        projects: workspace.db.prepare("SELECT COUNT(*) AS count FROM projects").get().count,
      };
      const result = await previewContentOpportunity(env, workspace, body);
      const after = {
        opportunities: workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count,
        projects: workspace.db.prepare("SELECT COUNT(*) AS count FROM projects").get().count,
      };
      if (before.opportunities !== after.opportunities || before.projects !== after.projects) throw new Error("内容机会 Preview 产生了不应有的写入");
      json(res, { ok: true, candidateOnly: true, ...result });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/content-opportunities/agenda-fit",
    handler: guard(async ({ env, workspace, req, res }) => {
      const body = await readJsonBody(req);
      const before = {
        opportunities: workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count,
        projects: workspace.db.prepare("SELECT COUNT(*) AS count FROM projects").get().count,
      };
      const result = await previewContentOpportunityAgendaFit(env, workspace, body);
      const after = {
        opportunities: workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count,
        projects: workspace.db.prepare("SELECT COUNT(*) AS count FROM projects").get().count,
      };
      if (before.opportunities !== after.opportunities || before.projects !== after.projects) {
        throw new Error("议程匹配 Preview 产生了不应有的写入");
      }
      json(res, { ok: true, candidateOnly: true, ...result });
    }),
  },
  {
    method: "GET",
    path: "/api/workspace/content-opportunities",
    handler: guard(async ({ workspace, res, url }) => {
      json(res, {
        ok: true,
        opportunities: workspace.contentBridge.opportunities({ includeArchived: url.searchParams.get("archived") === "1" }),
      });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/content-opportunities",
    handler: guard(async ({ workspace, req, res }) => {
      const body = await readJsonBody(req);
      const id = workspace.contentBridge.saveOpportunity({
        wikiPageId: body.wikiPageId,
        audienceProblemId: body.audienceProblemId,
        agendaId: body.agendaId || null,
        coreClaim: body.coreClaim,
        knowledgeExplanation: body.knowledgeExplanation,
        cognitiveGap: body.cognitiveGap,
        dominantAction: body.dominantAction,
        fit: body.fit,
        fitReason: body.fitReason,
        construction: body.construction,
        freshness: body.freshness,
        actor: "user",
        confirmed: body.confirmed === true,
        now: new Date(),
      });
      json(res, { ok: true, opportunity: workspace.contentBridge.opportunity(id) });
    }),
  },
  {
    method: "GET",
    path: "/api/workspace/content-opportunities/:id",
    handler: guard(async ({ workspace, res, params }) => {
      json(res, { ok: true, opportunity: workspace.contentBridge.opportunity(params.id) });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/content-opportunities/:id/update",
    handler: guard(async ({ workspace, req, res, params }) => {
      const body = await readJsonBody(req);
      if (!["archive", "restore"].includes(body.action)) throw new Error("内容机会更新动作不受支持");
      workspace.contentBridge.setOpportunityArchived(params.id, body.action === "archive", {
        actor: "user",
        confirmed: body.confirmed === true,
        now: new Date(),
      });
      json(res, { ok: true, opportunity: workspace.contentBridge.opportunity(params.id) });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/content-opportunities/:id/project",
    handler: guard(async ({ workspace, req, res, params }) => {
      const body = await readJsonBody(req);
      const projectId = workspace.contentBridge.createProjectFromOpportunity(params.id, {
        title: body.title,
        briefMarkdown: body.briefMarkdown,
        priority: body.priority,
        primaryPlatform: body.primaryPlatform,
        actor: "user",
        confirmed: body.confirmed === true,
        now: new Date(),
      });
      json(res, { ok: true, projectId });
    }),
  },
  {
    method: "GET",
    path: "/api/workspace/projects/:id/content-intent",
    handler: guard(async ({ workspace, res, params }) => {
      workspace.domain.entity(params.id, "project");
      const opportunity = workspace.contentBridge.projectOpportunity(params.id);
      if (!opportunity) return json(res, { ok: true, intent: null });
      const wiki = workspace.db.prepare("SELECT id,title,page_type AS pageType,summary FROM wiki_pages WHERE id=?").get(opportunity.wikiPageId);
      const problem = workspace.contentBridge.audienceProblem(opportunity.audienceProblemId);
      const agenda = opportunity.agendaId ? workspace.contentBridge.agenda(opportunity.agendaId) : null;
      json(res, {
        ok: true,
        intent: {
          opportunity,
          wiki,
          problem,
          agenda,
          evidenceGaps: opportunity.construction.evidence_gaps,
        },
      });
    }),
  },
];
