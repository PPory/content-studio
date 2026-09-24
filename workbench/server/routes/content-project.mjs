// 项目里的 AI：搭结构、起稿。
//
// ⚠️ **两个端点都不碰正文。** 结构和初稿都以候选回到编辑器，由用户在正文上采纳。
// 「AI 只提出候选，正文由用户确认后写入」这条在写作阶段同样成立——
// 而且这里是最容易破例的地方，因为产出的东西本身就长得像正文。

import { createProjectExploration, getProjectNotebook, saveProjectNotebook } from "../domain/project-notebook.mjs";
import { fail, json, readJsonBody } from "../lib/http.mjs";
import { proposeProjectDraft, proposeProjectOutline } from "../domain/content-project-ai.mjs";
import { projectCreativeContext } from "../domain/content-project.mjs";
import { chooseAngle, chooseStructure, planView, proposeAngles, proposeStructures, writeDraft } from "../domain/content-plan-ai.mjs";

/**
 * 结构候选的存放位置。
 *
 * ⚠️ **存进 `workspace_settings`，不进业务表。** 它仍然是候选：
 * 没有被采纳之前，它不该出现在任何一条稿件或内容机会里。
 * 但它也不该刷一下页面就没——搭一次要十几秒，而用户很可能先去翻一眼素材再回来。
 * 和 AI 发现的扫描缓存同一个位置、同一条道理。
 */
const outlineKey = (projectId) => `project-outline:${projectId}`;

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guard(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await ready(context.workspace) }); }
    catch (error) {
      fail(context.res, error.message || "项目 AI 操作失败", {
        status: error.status || (error.code === "UNGROUNDED_PERSONAL_EXPERIENCE" ? 422 : /不存在/.test(error.message || "") ? 404 : 400),
        hint: error.hint || (error.code === "UNGROUNDED_PERSONAL_EXPERIENCE"
          ? "工作区里没有能支撑这段第一人称叙事的「个人经历」素材。补一条真实经历再起稿，或者换一条不依赖经历的讲法。"
          : undefined),
      });
    }
  };
}

function draftBytes(workspace, projectId) {
  return workspace.db.prepare("SELECT COALESCE(SUM(length(body_markdown)), 0) AS size, COUNT(*) AS count FROM drafts WHERE project_id=?")
    .get(projectId);
}

export const contentProjectRoutes = [
  {
    method: "POST",
    path: "/api/workspace/explorations",
    handler: guard(async ({ workspace, req, res }) => {
      const body = await readJsonBody(req, 300000);
      json(res, { ok: true, ...createProjectExploration(workspace, body) });
    }),
  },
  {
    method: "GET",
    path: "/api/workspace/projects/:id/notebook",
    handler: guard(async ({ workspace, res, params }) => {
      json(res, { ok: true, notebook: getProjectNotebook(workspace, params.id) });
    }),
  },
  {
    method: "PUT",
    path: "/api/workspace/projects/:id/notebook",
    handler: guard(async ({ workspace, req, res, params }) => {
      const body = await readJsonBody(req, 300000);
      json(res, { ok: true, notebook: saveProjectNotebook(workspace, params.id, body) });
    }),
  },
  {
    method: "GET",
    path: "/api/workspace/projects/:id/creative-context",
    handler: guard(async ({ workspace, res, params }) => {
      const context = projectCreativeContext(workspace, params.id);
      json(res, {
        ok: true,
        context: {
          problem: context.problem,
          wiki: context.wiki,
          agenda: context.agenda,
          coreClaim: context.opportunity.coreClaim,
          dominantAction: context.opportunity.dominantAction,
          route: context.route,
          elements: context.elements,
          entryOptions: context.entryOptions,
          evidenceGaps: context.evidenceGaps,
          counterarguments: context.counterarguments,
          experienceCount: context.experiences.length,
          empty: context.empty,
        },
      });
    }),
  },
  {
    method: "GET",
    path: "/api/workspace/projects/:id/outline",
    handler: guard(async ({ workspace, res, params }) => {
      workspace.domain.entity(params.id, "project");
      json(res, { ok: true, ...(workspace.repository.getSetting(outlineKey(params.id), null) || { outline: null, markdown: "" }) });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/projects/:id/outline",
    handler: guard(async ({ env, workspace, req, res, params }) => {
      const body = await readJsonBody(req).catch(() => ({}));
      // 「不用提纲，直接写」和「采用了」都走这儿把候选清掉，不留一份没人认的结构。
      if (body.action === "forget") {
        workspace.repository.setSetting(outlineKey(params.id), null);
        return json(res, { ok: true, outline: null, markdown: "" });
      }
      const before = draftBytes(workspace, params.id);
      const result = await proposeProjectOutline(env, workspace, { projectId: params.id, instruction: body.instruction });
      const after = draftBytes(workspace, params.id);
      if (before.size !== after.size || before.count !== after.count) throw new Error("搭结构产生了不应有的正文写入");
      workspace.repository.setSetting(outlineKey(params.id), { outline: result.outline, markdown: result.markdown, builtAt: new Date().toISOString() });
      json(res, { ok: true, candidateOnly: true, ...result });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/projects/:id/draft-candidate",
    handler: guard(async ({ env, workspace, req, res, params }) => {
      const body = await readJsonBody(req);
      const before = draftBytes(workspace, params.id);
      const result = await proposeProjectDraft(env, workspace, { projectId: params.id, outline: body.outline, instruction: body.instruction });
      const after = draftBytes(workspace, params.id);
      if (before.size !== after.size || before.count !== after.count) throw new Error("起稿产生了不应有的正文写入");
      json(res, { ok: true, candidateOnly: true, ...result });
    }),
  },
  // ── 选题到初稿（2026-09-24，content-plan-ai.mjs）：读懂 → 选角度 → 补齐 → 定结构 → 写初稿 ──
  // 角度和结构只存进构思里的 plan（候选和选择），不碰正文；只有「写初稿」在正文为空时写入主稿——
  // 用户点了「按这个结构写初稿」就是确认，且稿件保存留版本；正文已有字时只返回候选。
  { method: "GET", path: "/api/workspace/projects/:id/plan", handler: guard(async ({ env, workspace, res, params }) => json(res, { ok: true, ...planView(workspace, env, params.id) })) },
  { method: "POST", path: "/api/workspace/projects/:id/plan/angles", handler: guard(async ({ env, workspace, req, res, params }) => { const body = await readJsonBody(req); json(res, { ok: true, ...(await proposeAngles(env, workspace, { projectId: params.id, force: body.force === true })) }); }) },
  { method: "POST", path: "/api/workspace/projects/:id/plan/choose-angle", handler: guard(async ({ env, workspace, req, res, params }) => { const body = await readJsonBody(req); chooseAngle(workspace, params.id, { angleId: body.angleId, own: body.own }); json(res, { ok: true, ...planView(workspace, env, params.id) }); }) },
  { method: "POST", path: "/api/workspace/projects/:id/plan/structures", handler: guard(async ({ env, workspace, req, res, params }) => { const body = await readJsonBody(req); json(res, { ok: true, ...(await proposeStructures(env, workspace, { projectId: params.id, force: body.force === true })) }); }) },
  { method: "POST", path: "/api/workspace/projects/:id/plan/choose-structure", handler: guard(async ({ env, workspace, req, res, params }) => { const body = await readJsonBody(req); chooseStructure(workspace, params.id, { structure: Number(body.structure) || 0, title: Number(body.title) || 0 }); json(res, { ok: true, ...planView(workspace, env, params.id) }); }) },
  { method: "POST", path: "/api/workspace/projects/:id/plan/draft", handler: guard(async ({ env, workspace, res, params }) => { const result = await writeDraft(env, workspace, { projectId: params.id }); json(res, { ok: true, ...result, ...planView(workspace, env, params.id) }); }) },
];
