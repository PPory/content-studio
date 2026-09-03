import crypto from "node:crypto";
import fs from "node:fs/promises";
import { fail, json, readJsonBody, readRawBody } from "../lib/http.mjs";
import { createUlid } from "../storage/ids.mjs";
import { SEED_REACTION_GROUPS, SEED_REACTIONS } from "../domain/values.mjs";
import { entityPage, listMaterials, listProjects, listSeries, projectDto, seriesDto, seriesMarkdown, seriesReadDto } from "../workspace/workspace-view.mjs";
import { collectAssetRefs, exportFileName, markdownBundle, markdownToDocx, markdownToPlainText, projectMarkdown, rewriteAssetRefs } from "../lib/document-export.mjs";
import { observeLanes } from "../domain/workbench-lanes.mjs";

const actor = "user";
const clean = (value) => String(value ?? "").trim();
const now = () => new Date();
const CONTENT_PLATFORMS = ["公众号", "X", "小红书", "视频号", "YouTube"];
const METRIC_PLATFORMS = ["公众号", "X", "小红书", "抖音", "视频号", "YouTube"];

export function publicationRows(workspace) {
  const linked = workspace.db.prepare(`SELECT p.id,p.draft_id AS draftId,p.title,p.platform,p.published_url AS url,substr(p.published_at,1,10) AS date,d.project_id AS doc,NULL AS views,NULL AS likes,NULL AS comments,NULL AS collects,NULL AS shares,p.published_at AS synced FROM publication_records p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL JOIN drafts d ON d.id=p.draft_id`).all();
  const external = workspace.db.prepare(`SELECT p.id,NULL AS draftId,p.title,p.platform,p.published_url AS url,substr(p.published_at,1,10) AS date,'' AS doc,p.views,p.likes,p.comments,p.collects,p.shares,p.published_at AS synced FROM external_publication_records p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL`).all();
  return [...linked, ...external].sort((a,b) => String(b.date).localeCompare(String(a.date)));
}

function accountMetricRows(workspace) {
  return workspace.db.prepare(`SELECT m.id,m.metric_date AS date,m.platform,m.followers,m.views,m.note FROM account_metric_snapshots m JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL ORDER BY m.metric_date DESC`).all();
}

async function currentWorkspace(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503, hint: "稍等片刻后重试；如果仍失败，请重启工作台。" });
  return workspace;
}

function guarded(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await currentWorkspace(context.workspace) }); }
    catch (error) { fail(context.res, error.message || "本地工作区操作失败", { status: error.status || (/不存在|找不到|回收站/.test(error.message || "") ? 404 : 400), hint: error.hint }); }
  };
}

const EXPORT_FORMATS = {
  md: { extension: "md", type: "text/markdown; charset=utf-8" },
  txt: { extension: "txt", type: "text/plain; charset=utf-8" },
  docx: { extension: "docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};

/**
 * 正文里引用到的资产字节。
 *
 * 读不到的**跳过但记下来**——由调用方决定怎么呈现（md 保留原链接、docx 画一行说明）。
 * 静默当作没有这张图，会导出一个看着完好、其实少了插图的文件。
 */
async function exportAssets(workspace, markdown) {
  const items = [];
  const seen = new Set();
  for (const ref of collectAssetRefs(markdown)) {
    const asset = workspace.assets.get(ref.id);
    if (!asset) continue;
    try {
      const bytes = await fs.readFile(await workspace.assets.resolveStoredFile(asset));
      // 同名的第二张图要改名，否则 zip 里后一张会盖掉前一张。
      let name = asset.originalName || `${ref.id}.bin`;
      if (seen.has(name)) name = `${ref.id}-${name}`;
      seen.add(name);
      items.push({ id: ref.id, name, bytes, mimeType: asset.mimeType });
    } catch { /* 文件缺失：按读不到处理 */ }
  }
  return items;
}

/** 导出一律回二进制 + `content-disposition`，前端照 `downloadBackup` 那套直接落盘。 */
function sendDownload(res, { name, type, bytes }) {
  res.writeHead(200, {
    "content-type": type,
    "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "content-length": String(bytes.length),
    "cache-control": "no-store",
  });
  res.end(bytes);
}

function seedDto(row) {
  return { id: row.id, take: row.title, title: row.title, reaction: row.reaction, status: row.status === "keeping" ? "留着" : row.status === "written" ? "写了" : "放弃", editedAt: row.updated_at };
}

function entityKind(view) {
  return ({ collections: "capture", inbox: "capture", materials: "material", topics: "project", drafts: "draft" })[view] || "";
}

function sourceRows(workspace, view) {
  if (view === "materials") return listMaterials(workspace).items.map((item) => item.record);
  if (view === "drafts") return workspace.db.prepare(`SELECT d.id, d.title, d.body_markdown AS note, d.platform, d.workflow_status AS status, e.updated_at AS editedAt FROM drafts d JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL JOIN projects p ON p.id=d.project_id JOIN entities pe ON pe.id=p.id AND pe.deleted_at IS NULL ORDER BY e.updated_at DESC`).all();
  if (view === "topics") return workspace.db.prepare(`SELECT p.id, p.title, p.brief_markdown AS note, p.status, p.primary_platform AS platform, e.updated_at AS editedAt FROM projects p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL ORDER BY e.updated_at DESC`).all();
  const captures = workspace.db.prepare(`SELECT c.*, e.updated_at FROM captures c JOIN entities e ON e.id=c.id AND e.deleted_at IS NULL ORDER BY e.updated_at DESC`).all();
  return captures.filter((item) => view === "collections" ? item.capture_bucket === "collection" : item.capture_bucket !== "collection").map((item) => ({
    id: item.id, title: item.title, note: item.body_markdown, selection: item.body_markdown, type: item.capture_kind, source: item.source_url ? "网页" : "手动", link: item.source_url, reviewStatus: item.status, status: item.status, snapshotStatus: "not_needed", tags: [], editedAt: item.updated_at,
  }));
}

function updateEntity(workspace, view, id, fields = {}, markdown) {
  const type = entityKind(view);
  const entity = workspace.repository.getEntity(id);
  if (!entity || entity.type !== type) throw new Error("条目不存在");
  if (view === "drafts") {
    const row = workspace.db.prepare("SELECT title, body_markdown FROM drafts WHERE id = ?").get(id);
    workspace.domain.updateDraft(id, { title: fields.title ?? row.title, bodyMarkdown: markdown ?? row.body_markdown, reason: "workspace api save", actor, now: now() });
  } else {
    const current = workspace.db.prepare("SELECT title, body FROM entity_text WHERE entity_id = ?").get(id) || { title: "", body: "" };
    const title = clean(fields.title ?? current.title);
    const body = String(markdown ?? current.body ?? "");
    const stamp = now();
    workspace.repository.transaction(() => {
      if (view === "materials") workspace.db.prepare("UPDATE materials SET title = ?, body_markdown = ? WHERE id = ?").run(title, body, id);
      else if (view === "topics") workspace.db.prepare("UPDATE projects SET title = ?, brief_markdown = ? WHERE id = ?").run(title, body, id);
      else workspace.db.prepare("UPDATE captures SET title = ?, body_markdown = ? WHERE id = ?").run(title, body, id);
      workspace.repository.setEntityText(id, { title, body, now: stamp });
      workspace.domain.touch(id, stamp);
      workspace.domain.audit(`${type}.updated`, id, { source: "workspace-api" }, stamp);
    });
  }
}

export const workspaceRoutes = [
  { method: "GET", path: "/api/workspace/status", handler: guarded(async ({ workspace, res }) => json(res, { ok: true, ready: true, workspaceId: workspace.manifest.workspaceId, counts: { projects: listProjects(workspace).total, materials: listMaterials(workspace).total } })) },
  { method: "GET", path: "/api/workspace/series", handler: guarded(async ({ workspace, res }) => json(res, { ok: true, ...listSeries(workspace) })) },
  { method: "POST", path: "/api/workspace/series", handler: guarded(async ({ workspace, req, res }) => {
    const body = await readJsonBody(req); const stamp = now();
    const id = workspace.domain.createSeries({
      title: body.title,
      descriptionMarkdown: body.description,
      confirmed: true,
      actor,
      now: stamp,
    });
    json(res, { ok: true, series: seriesDto(workspace, id) });
  }) },
  { method: "GET", path: "/api/workspace/series/:id", handler: guarded(async ({ workspace, res, params }) => {
    const series = seriesDto(workspace, params.id);
    if (!series) throw new Error("合集不存在");
    json(res, { ok: true, series });
  }) },
  { method: "POST", path: "/api/workspace/series/:id/update", handler: guarded(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    workspace.domain.updateSeries(params.id, {
      title: body.title,
      descriptionMarkdown: body.description,
      actor,
      now: now(),
    });
    json(res, { ok: true, series: seriesDto(workspace, params.id) });
  }) },
  { method: "POST", path: "/api/workspace/series/:id/articles", handler: guarded(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req); const stamp = now();
    // 一次可以放多篇：选择器是多选的，前端不该为了加三篇打三次。
    const projectIds = (Array.isArray(body.projectIds) ? body.projectIds : [body.projectId]).map(clean).filter(Boolean);
    if (!projectIds.length) throw new Error("请选择要放进合集的文章");
    workspace.repository.transaction(() => {
      for (const projectId of projectIds) workspace.domain.addSeriesArticle(params.id, { projectId, actor, now: stamp });
    });
    json(res, { ok: true, added: projectIds.length, series: seriesDto(workspace, params.id) });
  }) },
  { method: "POST", path: "/api/workspace/series/:id/articles/new", handler: guarded(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req); const stamp = now();
    if (!seriesDto(workspace, params.id)) throw new Error("合集不存在");
    const platform = body.platform || "公众号";
    const projectId = workspace.repository.transaction(() => {
      const id = workspace.domain.createProject({
        title: "未命名",
        audience: body.audience,
        primaryPlatform: platform,
        confirmed: true,
        actor,
        now: stamp,
      });
      const draftId = workspace.domain.createDraft({ projectId: id, title: "未命名", platform, actor, now: stamp });
      workspace.domain.setPrimaryDraft(id, draftId, { actor, now: stamp });
      workspace.domain.addSeriesArticle(params.id, { projectId: id, actor, now: stamp });
      return id;
    });
    json(res, { ok: true, projectId, series: seriesDto(workspace, params.id) });
  }) },
  { method: "POST", path: "/api/workspace/series/:id/sections", handler: guarded(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    workspace.domain.addSeriesSection(params.id, { heading: body.heading, actor, now: now() });
    json(res, { ok: true, series: seriesDto(workspace, params.id) });
  }) },
  { method: "POST", path: "/api/workspace/series/:id/entries/reorder", handler: guarded(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    workspace.domain.reorderSeriesEntries(params.id, body.entryIds, { actor, now: now() });
    json(res, { ok: true, series: seriesDto(workspace, params.id) });
  }) },
  { method: "POST", path: "/api/workspace/series/:id/entries/:entryId/update", handler: guarded(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    workspace.domain.updateSeriesEntry(params.id, params.entryId, { heading: body.heading, note: body.note, actor, now: now() });
    json(res, { ok: true, series: seriesDto(workspace, params.id) });
  }) },
  { method: "POST", path: "/api/workspace/series/:id/entries/:entryId/remove", handler: guarded(async ({ workspace, res, params }) => {
    workspace.domain.removeSeriesEntry(params.id, params.entryId, { actor, now: now() });
    json(res, { ok: true, series: seriesDto(workspace, params.id), preservedArticle: true });
  }) },
  { method: "GET", path: "/api/workspace/series/:id/read", handler: guarded(async ({ workspace, res, params }) => {
    const read = seriesReadDto(workspace, params.id);
    if (!read) throw new Error("合集不存在");
    json(res, { ok: true, read });
  }) },
  { method: "POST", path: "/api/workspace/series/:id/export", handler: guarded(async ({ workspace, res, params }) => {
    // ⚠️ **不落盘**：拼好的 Markdown 直接回给前端，由浏览器触发下载。
    // 写文件要过根目录限制和真实路径检查，而这里根本不需要写。
    const exported = seriesMarkdown(workspace, params.id);
    if (!exported) throw new Error("合集不存在");
    json(res, { ok: true, ...exported });
  }) },
  { method: "POST", path: "/api/workspace/series/:id/trash", handler: guarded(async ({ workspace, res, params }) => {
    const series = seriesDto(workspace, params.id);
    if (!series) throw new Error("合集不存在");
    workspace.domain.softDeleteEntity(params.id, { actor, now: now() });
    json(res, { ok: true, deleted: 1, preservedProjects: series.progress.total, recoverable: true });
  }) },
  { method: "POST", path: "/api/workspace/projects/:id/series", handler: guarded(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    workspace.domain.setProjectSeries(params.id, body.seriesIds, { actor, now: now() });
    json(res, { ok: true, project: projectDto(workspace, params.id) });
  }) },
  /**
   * 单篇导出。**不落盘**——拼好的字节直接回给浏览器（写文件要过根目录限制和真实路径
   * 检查，而这里根本不需要写）。这条和合集导出（`/series/:id/export`）同一个判断，
   * 只是那边回的是 JSON 里的字符串，这边有二进制，所以一律走 `content-disposition`。
   */
  { method: "POST", path: "/api/workspace/projects/:id/export", handler: guarded(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    const format = EXPORT_FORMATS[clean(body.format) || "md"];
    if (!format) throw new Error("只支持导出 Markdown、Word 和纯文本");
    const project = projectDto(workspace, params.id);
    if (!project) throw new Error("内容项目不存在");
    const markdown = projectMarkdown(project);
    const assets = await exportAssets(workspace, markdown);

    if (format.extension === "txt") {
      // ⚠️ **纯文本不带 frontmatter。** 传 `markdown`（带 frontmatter 的那份）进去的话，
      // `---` 会被当成分隔线渲染成「————」，后面跟着一串 `title: …` 的裸 YAML——
      // 一个说好「剥掉所有记号」的格式，开头三行全是记号。标题单独放第一行就够了。
      const text = `${project.title || "未命名内容"}\n\n${markdownToPlainText(project.masterDraft?.body || "")}`;
      return sendDownload(res, { name: exportFileName(project.title, "txt"), type: format.type, bytes: Buffer.from(text, "utf8") });
    }
    if (format.extension === "docx") {
      const images = new Map(assets.map((item) => [item.id, item]));
      return sendDownload(res, { name: exportFileName(project.title, "docx"), type: format.type, bytes: markdownToDocx({ title: project.title, markdown: project.masterDraft?.body || "", images }) });
    }
    // ⚠️ **有图就必须打包。** 单个 `.md` 里留着 `asset://` 链接，在别的编辑器里
    // 一张图都显示不出来——而文件看着是正常的，用户要等发出去之后才发现。
    if (!assets.length) {
      return sendDownload(res, { name: exportFileName(project.title, "md"), type: format.type, bytes: Buffer.from(markdown, "utf8") });
    }
    const rewritten = rewriteAssetRefs(markdown, assets.map((item) => [item.id, `assets/${item.name}`]));
    return sendDownload(res, {
      name: exportFileName(project.title, "zip"),
      type: "application/zip",
      bytes: markdownBundle({ title: project.title, markdown: rewritten, assets }),
    });
  }) },
  /**
   * 值班台：四条链此刻各自的下一步。
   *
   * ⚠️ **纯读，不调模型。** 每条链的下一步是数出来的；算不出来就回 next: null，
   * 由界面照实说「这条链现在没事」。
   */
  { method: "GET", path: "/api/workspace/lanes", handler: guarded(async ({ workspace, res }) => json(res, { ok: true, ...observeLanes(workspace) })) },
  { method: "GET", path: "/api/workspace/projects", handler: guarded(async ({ workspace, res, url }) => json(res, { ok: true, ...listProjects(workspace, { stage: url.searchParams.get("stage") || "" }) })) },
  { method: "GET", path: "/api/workspace/projects/:id", handler: guarded(async ({ workspace, res, params }) => { const project = projectDto(workspace, params.id); if (!project) throw new Error("内容项目不存在"); json(res, { ok: true, project }); }) },
  { method: "POST", path: "/api/workspace/projects", handler: guarded(async ({ workspace, req, res }) => {
    const body = await readJsonBody(req); const stamp = now();
    const projectId = workspace.domain.createProject({ title: clean(body.title) || "未命名", viewpoint: body.viewpoint, audience: body.audience, primaryPlatform: body.platform, briefMarkdown: body.notes || "", seedId: body.seedId || null, confirmed: true, actor, now: stamp });
    let draftId = null;
    if (body.kind !== "topic") {
      draftId = workspace.domain.createDraft({ projectId, title: clean(body.title) || "未命名", bodyMarkdown: body.body || "", platform: body.platform || "公众号", actor, now: stamp });
      workspace.domain.setPrimaryDraft(projectId, draftId, { actor, now: stamp });
      for (const materialId of [...new Set(body.materialIds || [])]) workspace.domain.linkMaterial(projectId, materialId, { actor, now: stamp });
    }
    json(res, { ok: true, topic: { id: projectId }, draft: draftId ? { id: draftId, topicId: projectId } : null, project: projectDto(workspace, projectId) });
  }) },
  { method: "POST", path: "/api/workspace/projects/:id/transition", handler: guarded(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req); const project = projectDto(workspace, params.id); if (!project) throw new Error("内容项目不存在"); const stamp = now();
    if (body.action === "start-writing") { const draftId = workspace.domain.createDraft({ projectId: params.id, title: project.title, platform: project.brief?.platform || "公众号", actor, now: stamp }); workspace.domain.setPrimaryDraft(params.id, draftId, { actor, now: stamp }); }
    else if (body.action === "set-primary") workspace.domain.setPrimaryDraft(params.id, body.draftId, { actor, now: stamp });
    else if (body.action === "abandon") project.masterDraft ? workspace.domain.transitionDraft(project.masterDraft.id, "abandon", { actor, now: stamp }) : workspace.domain.parkProject(params.id, { actor, now: stamp });
    else if (body.action === "return-writing" && project.stage === "已搁置" && !project.masterDraft) workspace.domain.transitionProject(params.id, "resume", { actor, now: stamp });
    else workspace.domain.transitionDraft(project.masterDraft?.id, body.action, { actor, now: stamp });
    json(res, { ok: true, project: projectDto(workspace, params.id) });
  }) },
  { method: "POST", path: "/api/workspace/projects/:id/materials", handler: guarded(async ({ workspace, req, res, params }) => { const body = await readJsonBody(req); for (const id of body.add || []) workspace.domain.linkMaterial(params.id, id, { actor, now: now() }); for (const id of body.remove || []) workspace.domain.unlinkMaterial(params.id, id, { actor, now: now() }); json(res, { ok: true, project: projectDto(workspace, params.id) }); }) },
  { method: "POST", path: "/api/workspace/projects/:id/variants", handler: guarded(async ({ workspace, req, res, params }) => { const body = await readJsonBody(req); const project = projectDto(workspace, params.id); if (!project?.masterDraft) throw new Error("请先建立主稿"); const same = project.variants.find((item) => item.platform === body.platform); if (same) return json(res, { ok: true, created: false, variantId: same.id, project }); const id = workspace.domain.createDraft({ projectId: params.id, title: project.masterDraft.title, bodyMarkdown: project.masterDraft.body, platform: body.platform, parentDraftId: project.masterDraft.id, actor, now: now() }); json(res, { ok: true, created: true, variantId: id, project: projectDto(workspace, params.id) }); }) },
  { method: "POST", path: "/api/workspace/projects/:id/variants/:draftId/remove", handler: guarded(async ({ workspace, res, params }) => { workspace.domain.softDeleteEntity(params.draftId, { actor, now: now() }); json(res, { ok: true, project: projectDto(workspace, params.id) }); }) },
  { method: "POST", path: "/api/workspace/projects/:id/releases/:draftId", handler: guarded(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    const entity = workspace.repository.getEntity(params.draftId);
    if (!entity) throw new Error("稿件不存在");
    if (body.expectedVersion != null && Number(body.expectedVersion) !== Number(entity.version)) return fail(res, "正文已在别处更新，请刷新后再保存", { status: 409 });
    workspace.domain.saveDraftRelease(params.draftId, { title: body.title, bodyMarkdown: body.body, summary: body.summary, coverUrl: body.coverUrl, coverText: body.coverText, coverNote: body.coverNote, keywords: body.keywords, interactionGoal: body.interactionGoal, actor, now: now() });
    json(res, { ok: true, project: projectDto(workspace, params.id) });
  }) },  { method: "POST", path: "/api/workspace/projects/:id/review", handler: guarded(async ({ workspace, req, res, params }) => { const body = await readJsonBody(req); const project = projectDto(workspace, params.id); const publication = workspace.db.prepare("SELECT id FROM publication_records WHERE draft_id=? ORDER BY published_at DESC LIMIT 1").get(body.draftId || project.publication?.latest?.draftId); if (!publication) throw new Error("尚无发布记录"); const result = workspace.domain.submitPublicationReview(publication.id, { metrics: body.metrics, status: body.status, basisMarkdown: body.basis, conclusionMarkdown: body.conclusion, nextExperimentMarkdown: body.nextExperiment, actor, now: now() }); let feedbackCreated = 0; if (body.captureFeedback) { const current = projectDto(workspace, params.id); const title = current.publication.latest?.title || current.title; const feedback = [{ type: "标题样本", title: `有效标题｜${title}`, bodyMarkdown: title }, { type: "内容角度", title: `有效角度｜${current.title}`, bodyMarkdown: current.brief?.viewpoint || current.title }, { type: "平台反馈", title: `平台反馈｜${title}`, bodyMarkdown: body.basis }]; workspace.domain.settleReview(result.reviewId, { feedback, storyMaterialIds: current.materials.filter((item) => ["案例/故事", "个人经历"].includes(item.type)).map((item) => item.id), confirmed: true, actor, now: now() }); feedbackCreated = 3; } json(res, { ok: true, feedbackCreated, project: projectDto(workspace, params.id) }); }) },
  { method: "POST", path: "/api/workspace/projects/:id/trash", handler: guarded(async ({ workspace, res, params }) => { const count = workspace.db.prepare("SELECT COUNT(*) AS count FROM drafts d JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL WHERE d.project_id=?").get(params.id).count; workspace.domain.softDeleteEntity(params.id, { actor, now: now() }); json(res, { ok: true, deleted: count, recoverable: true }); }) },
  { method: "GET", path: "/api/workspace/materials", handler: guarded(async ({ workspace, res, url }) => json(res, { ok: true, ...listMaterials(workspace, Object.fromEntries(url.searchParams)) })) },
  { method: "GET", path: "/api/workspace/items/:view", handler: guarded(async ({ workspace, res, params, url }) => { let items = sourceRows(workspace, params.view); const state = url.searchParams.get("state"); if (state) items = items.filter((item) => item.status === state || item.reviewStatus === state); json(res, { ok: true, items, nextCursor: null }); }) },
  { method: "GET", path: "/api/workspace/search/:view", handler: guarded(async ({ workspace, res, params, url }) => { const q = clean(url.searchParams.get("q")).toLowerCase(); const items = sourceRows(workspace, params.view).filter((item) => `${item.title || ""}\n${item.note || item.content || ""}`.toLowerCase().includes(q)); json(res, { ok: true, items }); }) },
  { method: "GET", path: "/api/workspace/items/:view/:id", handler: guarded(async ({ workspace, res, params }) => { const page = entityPage(workspace, params.id); if (!page || workspace.repository.getEntity(params.id)?.type !== entityKind(params.view)) throw new Error("条目不存在"); json(res, { ok: true, ...page }); }) },
  { method: "POST", path: "/api/workspace/items/:view/:id/update", handler: guarded(async ({ workspace, req, res, params }) => { const body = await readJsonBody(req); updateEntity(workspace, params.view, params.id, body.fields || {}, body.markdown); json(res, { ok: true, ...entityPage(workspace, params.id) }); }) },
  { method: "POST", path: "/api/workspace/items/:view/:id/trash", handler: guarded(async ({ workspace, res, params }) => { workspace.domain.softDeleteEntity(params.id, { actor, now: now() }); json(res, { ok: true, deleted: 1, recoverable: true }); }) },
  { method: "GET", path: "/api/workspace/annotations/:id", handler: guarded(async ({ workspace, res, params }) => { const rows = workspace.db.prepare(`SELECT k.id, k.body_markdown AS text, e.created_at AS createdAt FROM knowledge_items k JOIN entities e ON e.id=k.id AND e.deleted_at IS NULL WHERE k.knowledge_kind='annotation' AND k.locator=? ORDER BY e.created_at`).all(`entity:${params.id}`); json(res, { ok: true, comments: rows }); }) },
  { method: "POST", path: "/api/workspace/annotations/:id", handler: guarded(async ({ workspace, req, res, params }) => { if (!workspace.repository.getEntity(params.id)) throw new Error("条目不存在"); const body = await readJsonBody(req); const id=createUlid(); const stamp=now(); workspace.repository.transaction(() => { workspace.repository.createEntity({ id, type: "knowledge_item", now: stamp }); workspace.db.prepare("INSERT INTO knowledge_items(id, knowledge_kind, title, body_markdown, locator) VALUES (?, 'annotation', '', ?, ?)").run(id, clean(body.text), `entity:${params.id}`); workspace.repository.setEntityText(id, { title: "", body: clean(body.text), now: stamp }); }); json(res, { ok: true, id }); }) },
  { method: "POST", path: "/api/workspace/intake", handler: guarded(async ({ workspace, req, res }) => {
    const body = await readJsonBody(req);
    const target = clean(body.target);
    const title = clean(body.title) || "未命名";
    const content = String(body.content || body.selection || "");
    const requestId = clean(body.clientRequestId || body.requestId);
    const requestPayload = { target, title, content, cmd: clean(body.cmd), url: clean(body.url || body.source) };
    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex");
    if (requestId) {
      const existing = workspace.db.prepare("SELECT payload_sha256 AS payloadHash, result_json AS resultJson FROM client_requests WHERE request_id = ?").get(requestId);
      if (existing) {
        if (existing.payloadHash !== payloadHash) return fail(res, "同一请求编号不能对应不同内容", { status: 409 });
        return json(res, { ...JSON.parse(existing.resultJson), duplicate: true });
      }
    }
    const stamp = now();
    const result = workspace.repository.transaction(() => {
      let id;
      if (target === "material") id = workspace.domain.createMaterial({ title, type: clean(body.cmd) || "核心观点", bodyMarkdown: content, sourceUrl: body.url || body.source || "", actor, now: stamp });
      else id = workspace.domain.createCapture({ kind: clean(body.kind) || (body.url ? "web" : "thought"), bucket: target === "collection" ? "collection" : "inbox", title, bodyMarkdown: content, sourceUrl: body.url || "", actor, now: stamp });
      const value = { ok: true, id, duplicate: false, dbType: target === "material" ? clean(body.cmd) || "核心观点" : "" };
      if (requestId) workspace.db.prepare("INSERT INTO client_requests(request_id, client_type, operation, payload_sha256, result_json, created_at) VALUES (?, 'extension', 'intake', ?, ?, ?)").run(requestId, payloadHash, JSON.stringify(value), stamp.toISOString());
      return value;
    });
    json(res, result);
  }) },  { method: "GET", path: "/api/workspace/seeds", handler: guarded(async ({ workspace, res }) => { const seeds=workspace.db.prepare(`SELECT s.*, e.updated_at FROM seeds s JOIN entities e ON e.id=s.id AND e.deleted_at IS NULL ORDER BY e.updated_at DESC`).all().map(seedDto); json(res,{ok:true,seeds,reactions:[...SEED_REACTIONS],reactionGroups:SEED_REACTION_GROUPS.map((group)=>({label:group.label,items:[...group.items]}))}); }) },
  { method: "POST", path: "/api/workspace/seeds", handler: guarded(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const id=workspace.domain.createSeed({title:body.take||body.title,reaction:body.reaction,actor,now:now()}); json(res,{ok:true,seed:seedDto(workspace.db.prepare(`SELECT s.*, e.updated_at FROM seeds s JOIN entities e ON e.id=s.id WHERE s.id=?`).get(id))}); }) },
  { method: "POST", path: "/api/workspace/seeds/:id", handler: guarded(async ({ workspace, req, res, params }) => { const body=await readJsonBody(req); const current=workspace.db.prepare("SELECT * FROM seeds WHERE id=?").get(params.id); if(!current) throw new Error("种子不存在"); const wanted=body.status; if(wanted === "写了" && current.status === "keeping") workspace.domain.transitionSeed(params.id,"write",{actor,now:now()}); else if(wanted === "放弃" && current.status === "keeping") workspace.domain.transitionSeed(params.id,"drop",{actor,now:now()}); else if(wanted === "留着" && current.status === "dropped") workspace.domain.transitionSeed(params.id,"restore",{actor,now:now()}); json(res,{ok:true}); }) },
  { method: "POST", path: "/api/workspace/seeds/:id/trash", handler: guarded(async ({ workspace,res,params }) => { workspace.domain.softDeleteEntity(params.id,{actor,now:now()}); json(res,{ok:true,recoverable:true}); }) },
  { method: "POST", path: "/api/workspace/drafts/:id/save", handler: guarded(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    const entity = workspace.repository.getEntity(params.id);
    if (!entity || entity.type !== "draft") throw new Error("稿件不存在");
    if (body.expectedVersion != null && Number(body.expectedVersion) !== Number(entity.version)) return fail(res, "正文已在别处更新，请刷新后再保存", { status: 409 });
    const draft = workspace.db.prepare("SELECT project_id AS projectId FROM drafts WHERE id = ?").get(params.id);
    workspace.domain.updateDraft(params.id, { title: body.title, bodyMarkdown: body.body, reason: "autosave", actor, now: now() });
    const fresh = workspace.repository.getEntity(params.id);
    json(res, { ok: true, version: fresh.version, updatedAt: fresh.updatedAt, project: projectDto(workspace, draft.projectId) });
  }) },  { method: "POST", path: "/api/workspace/publications", handler: guarded(async ({ workspace,req,res }) => {
    const body=await readJsonBody(req);
    const publishedAt=new Date(body.publishedAt||Date.now()).toISOString();
    const key=`ui:${body.draftId}:${publishedAt}:${clean(body.url)}`;
    const result=workspace.domain.publishDraft(body.draftId,{title:body.title,platform:body.platform,publishedUrl:body.url,publishedAt,idempotencyKey:key,metadata:{source:"workbench"},actor,now:now()});
    const metricNames=["views","likes","comments","collects","shares"];
    if(metricNames.some((name)=>body[name]!==""&&body[name]!=null)) workspace.domain.recordMetrics(result.publicationId,{capturedAt:publishedAt,...Object.fromEntries(metricNames.map((name)=>[name,body[name]])),actor,now:now()});
    if (result.knowledgeSourceDocumentId) {
      const queuedAt = now().toISOString();
      workspace.db.prepare(`INSERT INTO source_ingests(source_entity_id,status,run_at) VALUES (?,'queued',?)
        ON CONFLICT(source_entity_id) DO UPDATE SET status='queued', candidate_id=NULL, error='', run_at=excluded.run_at`).run(result.knowledgeSourceDocumentId, queuedAt);
      workspace.jobs.enqueue({idempotencyKey:`wiki.ingest:published:${result.publicationId}`,kind:"wiki.ingest",payload:{sourceId:result.knowledgeSourceDocumentId}});
    }
    json(res,{ok:true,publicationId:result.publicationId,knowledgeQueued:!!result.knowledgeSourceDocumentId,record:{id:result.publicationId,draftId:body.draftId,title:body.title,platform:body.platform,url:body.url,publishedAt}});
  }) },
  { method: "GET", path: "/api/workspace/publications", handler: guarded(async ({ workspace,res }) => json(res,{ok:true,platforms:CONTENT_PLATFORMS,rows:publicationRows(workspace)})) },
  { method: "POST", path: "/api/workspace/external-publications", handler: guarded(async ({ workspace, req, res }) => {
    const body = await readJsonBody(req);
    const platform = clean(body.platform);
    const title = clean(body.title);
    const publishedUrl = clean(body.url);
    const publishedAt = new Date(body.date || Date.now()).toISOString();
    const existing = publishedUrl
      ? workspace.db.prepare("SELECT id FROM external_publication_records WHERE platform = ? AND published_url = ?").get(platform, publishedUrl)
      : workspace.db.prepare("SELECT id FROM external_publication_records WHERE platform = ? AND published_at = ? AND title = ?").get(platform, publishedAt, title);
    const id = existing?.id || createUlid();
    const stamp = now();
    workspace.repository.transaction(() => {
      if (!existing) workspace.repository.createEntity({ id, type: "external_publication", now: stamp });
      const metrics = ["views", "likes", "comments", "collects", "shares"].map((name) => body[name] === "" || body[name] == null ? null : body[name]);
      if (existing) {
        workspace.db.prepare("UPDATE external_publication_records SET platform = ?, title = ?, published_url = ?, published_at = ?, views = ?, likes = ?, comments = ?, collects = ?, shares = ? WHERE id = ?").run(platform, title, publishedUrl, publishedAt, ...metrics, id);
        workspace.domain.touch(id, stamp);
      } else {
        workspace.db.prepare("INSERT INTO external_publication_records(id, platform, title, published_url, published_at, views, likes, comments, collects, shares) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, platform, title, publishedUrl, publishedAt, ...metrics);
      }
      workspace.repository.setEntityText(id, { title, body: publishedUrl, now: stamp });
      workspace.domain.audit(existing ? "external_publication.updated" : "external_publication.created", id, { platform }, stamp);
    });
    json(res, { ok: true, platforms: CONTENT_PLATFORMS, rows: publicationRows(workspace) });
  }) },  { method: "GET", path: "/api/workspace/account-metrics", handler: guarded(async ({ workspace,res }) => json(res,{ok:true,platforms:METRIC_PLATFORMS,rows:accountMetricRows(workspace)})) },
  { method: "POST", path: "/api/workspace/account-metrics", handler: guarded(async ({ workspace,req,res }) => { const body=await readJsonBody(req); const existing=workspace.db.prepare("SELECT id FROM account_metric_snapshots WHERE metric_date=? AND platform=?").get(body.date,body.platform); const id=existing?.id||createUlid(); const stamp=now(); workspace.repository.transaction(() => { if(!existing) workspace.repository.createEntity({id,type:"account_metric",now:stamp}); workspace.db.prepare(`INSERT INTO account_metric_snapshots(id,metric_date,platform,followers,views,note) VALUES (?,?,?,?,?,?) ON CONFLICT(metric_date,platform) DO UPDATE SET followers=excluded.followers,views=excluded.views,note=excluded.note`).run(id,body.date,body.platform,body.followers??null,body.views??null,body.note||""); }); json(res,{ok:true,platforms:METRIC_PLATFORMS,rows:accountMetricRows(workspace)}); }) },
  { method: "GET", path: "/api/workspace/drafts-of/:id", handler: guarded(async ({ workspace,res,params }) => { const drafts=workspace.db.prepare(`SELECT d.id,d.title,d.platform,d.workflow_status AS status,e.updated_at AS editedAt FROM drafts d JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL JOIN projects p ON p.id=d.project_id JOIN entities pe ON pe.id=p.id AND pe.deleted_at IS NULL WHERE d.project_id=? ORDER BY e.updated_at DESC`).all(params.id); json(res,{ok:true,drafts}); }) },
  { method: "POST", path: "/api/workspace/assets/images", handler: guarded(async ({ workspace,req,res,url }) => { const asset=await workspace.assets.importBuffer({bytes:await readRawBody(req,25_000_000),type:"image",originalName:url.searchParams.get("name")||"image.bin",mimeType:req.headers["content-type"]||"application/octet-stream",now:now()}); json(res,{ok:true,asset,uri:asset.uri,path:asset.uri}); }) },
  { method: "GET", path: "/api/workspace/assets/:id", handler: guarded(async ({ workspace,res,params }) => { const asset=workspace.assets.get(params.id); if(!asset) throw new Error("资源不存在"); const file=await workspace.assets.resolveStoredFile(asset); const bytes=await fs.readFile(file); res.writeHead(200,{"content-type":asset.mimeType,"content-length":bytes.length,"cache-control":"private, max-age=31536000, immutable"}); res.end(bytes); }) },
  { method: "GET", path: "/api/workspace/search", handler: guarded(async ({ workspace,res,url }) => json(res,{ok:true,results:workspace.repository.search(url.searchParams.get("q")||"",{limit:url.searchParams.get("limit")||20}).map((item)=>({id:item.id,type:item.type,title:item.title,snippet:item.body}))})) },
];
