import crypto from "node:crypto";
import { createUlid } from "../storage/ids.mjs";
import { ActionPolicy } from "./action-policy.mjs";
import { assertGroundedGeneratedText, isMaterialEligibleForDraft, isValidHttpSource, normalizeStoredText, sha256Json, sourceContainsVerbatim, verificationForMaterial } from "./integrity.mjs";
import { assertDraftReadyToFinish, deriveProjectStage, nextCaptureStatus, nextDraftWorkflow, nextSeedStatus } from "./state-rules.mjs";
import { DRAFT_WORKFLOW, MATERIAL_TYPE_SET, PLATFORMS, PRIORITIES, PROJECT_STATUS, PUBLICATION_STATUS, REVIEW_STATUS, VERBATIM_MATERIAL_TYPES, VERIFICATION } from "./values.mjs";

const isoNow = (now = new Date()) => new Date(now).toISOString();
const clean = (value) => String(value || "").trim();
const json = (value) => JSON.stringify(value ?? null);

function required(value, label) {
  const result = clean(value);
  if (!result) throw new TypeError(`${label}不能为空`);
  return result;
}

function requiredIso(value, label) {
  const raw = required(value, label);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${label}必须是有效日期时间`);
  return date.toISOString();
}

function validHttpUrl(value, label = "发布链接") {
  let url;
  try { url = new URL(required(value, label)); } catch { throw new TypeError(`${label}必须是有效网址`); }
  if (!["http:", "https:"].includes(url.protocol)) throw new TypeError(`${label}只允许 http/https`);
  return url.toString();
}

function contentHash(title, body) {
  return crypto.createHash("sha256").update(`${title}\u0000${body}`).digest("hex");
}

export class WorkspaceDomain {
  constructor({ db, repository }) {
    this.db = db;
    this.repository = repository;
    this.actions = new ActionPolicy(db);
  }

  entity(id, type) {
    const row = this.db.prepare("SELECT id, entity_type AS type, version, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM entities WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!row || (type && row.type !== type)) throw new Error(`${type || "实体"}不存在`);
    return row;
  }

  assertDraftActive(draftId) {
    const row = this.db.prepare(`SELECT d.* FROM drafts d
      JOIN entities de ON de.id = d.id AND de.deleted_at IS NULL
      JOIN entities pe ON pe.id = d.project_id AND pe.deleted_at IS NULL
      WHERE d.id = ?`).get(draftId);
    if (!row) throw new Error("稿件或所属项目在回收站中");
    return row;
  }

  assertPublicationActive(publicationId) {
    const row = this.db.prepare(`SELECT p.*, d.project_id AS projectId FROM publication_records p
      JOIN entities pube ON pube.id = p.id AND pube.deleted_at IS NULL
      JOIN drafts d ON d.id = p.draft_id JOIN entities de ON de.id = d.id AND de.deleted_at IS NULL
      JOIN entities pe ON pe.id = d.project_id AND pe.deleted_at IS NULL
      WHERE p.id = ?`).get(publicationId);
    if (!row) throw new Error("发布记录、稿件或所属项目在回收站中");
    return row;
  }

  assertReviewActive(reviewId) {
    const row = this.db.prepare(`SELECT r.*, p.draft_id AS draftId, d.project_id AS projectId FROM reviews r
      JOIN entities re ON re.id = r.id AND re.deleted_at IS NULL
      JOIN publication_records p ON p.id = r.publication_id JOIN entities pube ON pube.id = p.id AND pube.deleted_at IS NULL
      JOIN drafts d ON d.id = p.draft_id JOIN entities de ON de.id = d.id AND de.deleted_at IS NULL
      JOIN entities pe ON pe.id = d.project_id AND pe.deleted_at IS NULL
      WHERE r.id = ?`).get(reviewId);
    if (!row) throw new Error("复盘或所属发布链在回收站中");
    return row;
  }
  touch(id, now) {
    this.db.prepare("UPDATE entities SET updated_at = ?, version = version + 1 WHERE id = ? AND deleted_at IS NULL").run(isoNow(now), id);
  }

  audit(eventType, entityId, detail = {}, now) {
    this.db.prepare("INSERT INTO audit_events(id, event_type, entity_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(createUlid(), eventType, entityId || null, json(detail), isoNow(now));
  }

  createCapture({ id = createUlid(), kind = "thought", bucket = "inbox", title = "", bodyMarkdown = "", sourceUrl = "", reaction = "", now, ...auth } = {}) {
    const canonicalTitle = clean(title);
    const body = normalizeStoredText(bodyMarkdown);
    const canonicalReaction = normalizeStoredText(reaction);
    const payload = { kind, bucket, title: canonicalTitle, bodyMarkdown: body, sourceUrl, reaction: canonicalReaction };
    const authorization = this.authorizeMutation("capture.create", null, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    const allowedKinds = new Set(["article", "video", "thought", "excerpt", "web"]);
    if (!allowedKinds.has(kind)) throw new TypeError("收集类型不合法");
    if (!["inbox", "collection"].includes(bucket)) throw new TypeError("收集分区不合法");
    if (auth.actor === "ai") assertGroundedGeneratedText(payload, this.groundingMaterials(null));
    return this.repository.transaction(() => {
      this.repository.createEntity({ id, type: "capture", now });
      this.db.prepare("INSERT INTO captures(id, capture_kind, capture_bucket, title, body_markdown, source_url, reaction) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, kind, bucket, canonicalTitle, body, clean(sourceUrl), canonicalReaction);
      this.repository.setEntityText(id, { title: canonicalTitle, body, now });
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("capture.created", id, { kind }, now);
      return id;
    });
  }
  createSeed({ id = createUlid(), title, reaction = "", sourceEntityId = null, now, ...auth } = {}) {
    const canonicalTitle = required(title, "种子标题");
    const canonicalReaction = normalizeStoredText(reaction);
    const payload = { title: canonicalTitle, reaction: canonicalReaction, sourceEntityId };
    const authorization = this.authorizeMutation("seed.create", sourceEntityId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    if (auth.actor === "ai") assertGroundedGeneratedText(payload, this.groundingMaterials(null));
    return this.repository.transaction(() => {
      if (sourceEntityId) this.entity(sourceEntityId);
      this.repository.createEntity({ id, type: "seed", now });
      this.db.prepare("INSERT INTO seeds(id, title, reaction, source_entity_id) VALUES (?, ?, ?, ?)")
        .run(id, canonicalTitle, canonicalReaction, sourceEntityId);
      this.repository.setEntityText(id, { title: canonicalTitle, body: canonicalReaction, now });
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("seed.created", id, { sourceEntityId }, now);
      return id;
    });
  }
  transitionCapture(captureId, action, { now, ...auth } = {}) {
    const payload = { action };
    const authorization = this.authorizeMutation("capture.transition", captureId, payload, auth);
    if (authorization.replay) return authorization.result?.status;
    this.entity(captureId, "capture");
    return this.repository.transaction(() => {
      const capture = this.db.prepare("SELECT * FROM captures WHERE id = ?").get(captureId);
      const next = nextCaptureStatus(capture.status, action);
      this.db.prepare("UPDATE captures SET status = ? WHERE id = ?").run(next, captureId);
      this.touch(captureId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { status: next }, now });
      this.audit("capture.transitioned", captureId, { action, from: capture.status, to: next }, now);
      return next;
    });
  }
  transitionSeed(seedId, action, { now, ...auth } = {}) {
    const payload = { action };
    const authorization = this.authorizeMutation("seed.transition", seedId, payload, auth);
    if (authorization.replay) return authorization.result?.status;
    this.entity(seedId, "seed");
    return this.repository.transaction(() => {
      const seed = this.db.prepare("SELECT * FROM seeds WHERE id = ?").get(seedId);
      const next = nextSeedStatus(seed.status, action);
      this.db.prepare("UPDATE seeds SET status = ? WHERE id = ?").run(next, seedId);
      this.touch(seedId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { status: next }, now });
      this.audit("seed.transitioned", seedId, { action, from: seed.status, to: next }, now);
      return next;
    });
  }
  createMaterial({ id = createUlid(), title, type, bodyMarkdown = "", sourceUrl = "", sourceText = "", sourceEntityId = null, origin = "manual", importedVerification = null, importBatchId = null, now, ...auth } = {}) {
    const canonicalTitle = required(title, "素材标题");
    const body = normalizeStoredText(bodyMarkdown);
    const payload = { title: canonicalTitle, type, bodyMarkdown: body, sourceUrl, sourceText, sourceEntityId, origin, importedVerification, importBatchId };
    const authorization = this.authorizeMutation("material.create", sourceEntityId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    if (!MATERIAL_TYPE_SET.has(type)) throw new TypeError("素材类型不合法");
    if (auth.actor === "ai") assertGroundedGeneratedText({ title: canonicalTitle, body }, this.groundingMaterials(null));
    if (origin === "import") throw new Error("导入核验只能由阶段 4 的受信迁移器执行");
    const verification = verificationForMaterial({ type, bodyMarkdown: body, sourceUrl, sourceText, origin: "manual" });
    if (![VERIFICATION.NA, VERIFICATION.PENDING, VERIFICATION.VERIFIED].includes(verification.status)) throw new TypeError("素材核验状态不合法");
    return this.repository.transaction(() => {
      if (sourceEntityId) this.entity(sourceEntityId);
      this.repository.createEntity({ id, type: "material", now });
      this.db.prepare(`
        INSERT INTO materials(id, title, material_type, body_markdown, source_url, source_entity_id, verification_status, verification_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, canonicalTitle, type, body, clean(sourceUrl), sourceEntityId, verification.status, clean(verification.note));
      this.repository.setEntityText(id, { title: canonicalTitle, body, now });
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("material.created", id, { type, verification: verification.status, importBatchId }, now);
      return id;
    });
  }
  verifyMaterial(materialId, { sourceText = "", sourceUrl = "", note = "", revoke = false, now, ...auth } = {}) {
    const payload = { sourceText, sourceUrl, note, revoke };
    const authorization = this.authorizeMutation("material.verify", materialId, payload, auth);
    if (authorization.replay) return authorization.result?.status;
    this.entity(materialId, "material");
    const material = this.db.prepare("SELECT * FROM materials WHERE id = ?").get(materialId);
    if (!VERBATIM_MATERIAL_TYPES.has(material.material_type)) throw new Error("该素材类型不需要逐字核验");
    if (!revoke) {
      if (!isValidHttpSource(sourceUrl || material.source_url)) throw new Error("逐字核验必须保留有效出处链接");
      if (!sourceContainsVerbatim(sourceText, material.body_markdown)) throw new Error("来源快照中未找到逐字一致内容");
    }
    const status = revoke ? VERIFICATION.PENDING : VERIFICATION.VERIFIED;
    const snapshotHash = revoke ? null : crypto.createHash("sha256").update(normalizeStoredText(sourceText)).digest("hex");
    return this.repository.transaction(() => {
      this.db.prepare(`UPDATE materials SET verification_status = ?, verification_note = ?, verification_method = ?,
        source_snapshot_sha256 = ?, verified_at = ?, source_url = CASE WHEN ? = '' THEN source_url ELSE ? END WHERE id = ?`)
        .run(status, clean(note) || (revoke ? "人工撤销核验，发布前需重新核对。" : "人工逐字比对来源快照。"), revoke ? "" : "manual-verbatim", snapshotHash, revoke ? null : isoNow(now), clean(sourceUrl), clean(sourceUrl), materialId);
      this.touch(materialId, now);
      const projects = this.db.prepare("SELECT project_id AS id FROM project_materials WHERE material_id = ?").all(materialId);
      for (const project of projects) this.touch(project.id, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { status }, now });
      this.audit(revoke ? "material.verification_revoked" : "material.verified", materialId, { status, sourceSnapshotSha256: snapshotHash }, now);
      return status;
    });
  }
  createProject({ id = createUlid(), title, briefMarkdown = "", viewpoint = "", audience = "", primaryPlatform = "", priority = "中", seedId = null, confirmed = false, now, ...auth } = {}) {
    if (confirmed !== true) throw new Error("创建项目必须来自用户明确确认");
    const canonicalTitle = required(title, "项目标题");
    const brief = normalizeStoredText(briefMarkdown);
    const payload = { title: canonicalTitle, briefMarkdown: brief, viewpoint: clean(viewpoint), audience: clean(audience), primaryPlatform, priority, seedId };
    const authorization = this.authorizeMutation("project.create", seedId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    if (auth.actor === "ai") assertGroundedGeneratedText(payload, this.groundingMaterials(null));
    if (primaryPlatform && !PLATFORMS.includes(primaryPlatform)) throw new TypeError("主平台不合法");
    if (!PRIORITIES.includes(priority)) throw new TypeError("优先级不合法");
    return this.repository.transaction(() => {
      if (seedId) {
        this.entity(seedId, "seed");
        const seed = this.db.prepare("SELECT status FROM seeds WHERE id = ?").get(seedId);
        if (seed.status !== "keeping") throw new Error("只有攒着的种子可以创建项目");
      }
      this.repository.createEntity({ id, type: "project", now });
      this.db.prepare(`
        INSERT INTO projects(id, title, brief_markdown, viewpoint, audience, primary_platform, priority, seed_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, canonicalTitle, brief, payload.viewpoint, payload.audience, primaryPlatform, priority, seedId);
      if (seedId) this.db.prepare("UPDATE seeds SET status = 'written' WHERE id = ? AND status = 'keeping'").run(seedId);
      this.repository.setEntityText(id, { title: canonicalTitle, body: brief, now });
      if (seedId) this.touch(seedId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("project.created", id, { seedId }, now);
      return id;
    });
  }
  createSeries({ id = createUlid(), title, descriptionMarkdown = "", audience = "", outcome = "", confirmed = false, now, ...auth } = {}) {
    if (confirmed !== true) throw new Error("创建系列必须来自用户明确确认");
    const canonicalTitle = required(title, "系列标题");
    const description = normalizeStoredText(descriptionMarkdown);
    const canonicalAudience = clean(audience);
    const canonicalOutcome = clean(outcome);
    if (canonicalTitle.length > 120) throw new TypeError("系列标题不能超过 120 字");
    if (description.length > 2000) throw new TypeError("系列说明不能超过 2000 字");
    if (canonicalAudience.length > 200) throw new TypeError("目标读者不能超过 200 字");
    if (canonicalOutcome.length > 500) throw new TypeError("学习成果不能超过 500 字");
    const payload = { title: canonicalTitle, descriptionMarkdown: description, audience: canonicalAudience, outcome: canonicalOutcome };
    const authorization = this.authorizeMutation("series.create", null, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    return this.repository.transaction(() => {
      this.repository.createEntity({ id, type: "content_series", now });
      this.db.prepare("INSERT INTO content_series(id, title, description_markdown, audience, outcome) VALUES (?, ?, ?, ?, ?)")
        .run(id, canonicalTitle, description, canonicalAudience, canonicalOutcome);
      this.repository.setEntityText(id, { title: canonicalTitle, body: [description, canonicalAudience, canonicalOutcome].filter(Boolean).join("\n\n"), now });
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("series.created", id, {}, now);
      return id;
    });
  }

  updateSeries(seriesId, { title, descriptionMarkdown = "", audience = "", outcome = "", now, ...auth } = {}) {
    this.entity(seriesId, "content_series");
    const canonicalTitle = required(title, "系列标题");
    const description = normalizeStoredText(descriptionMarkdown);
    const canonicalAudience = clean(audience);
    const canonicalOutcome = clean(outcome);
    if (canonicalTitle.length > 120 || description.length > 2000 || canonicalAudience.length > 200 || canonicalOutcome.length > 500) {
      throw new TypeError("系列字段超过长度限制");
    }
    const payload = { title: canonicalTitle, descriptionMarkdown: description, audience: canonicalAudience, outcome: canonicalOutcome };
    const authorization = this.authorizeMutation("series.update", seriesId, payload, auth);
    if (authorization.replay) return seriesId;
    return this.repository.transaction(() => {
      this.db.prepare("UPDATE content_series SET title = ?, description_markdown = ?, audience = ?, outcome = ? WHERE id = ?")
        .run(canonicalTitle, description, canonicalAudience, canonicalOutcome, seriesId);
      this.repository.setEntityText(seriesId, { title: canonicalTitle, body: [description, canonicalAudience, canonicalOutcome].filter(Boolean).join("\n\n"), now });
      this.touch(seriesId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id: seriesId }, now });
      this.audit("series.updated", seriesId, {}, now);
      return seriesId;
    });
  }

  addSeriesChapter(seriesId, { id = createUlid(), title, summary = "", projectId = null, now, ...auth } = {}) {
    this.entity(seriesId, "content_series");
    const canonicalTitle = required(title, "章节标题");
    const canonicalSummary = clean(summary);
    if (canonicalTitle.length > 120) throw new TypeError("章节标题不能超过 120 字");
    if (canonicalSummary.length > 500) throw new TypeError("章节说明不能超过 500 字");
    if (projectId) this.entity(projectId, "project");
    const payload = { title: canonicalTitle, summary: canonicalSummary, projectId };
    const authorization = this.authorizeMutation("series.chapter.create", seriesId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    return this.repository.transaction(() => {
      const position = this.db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS value FROM series_chapters WHERE series_id = ?").get(seriesId).value;
      this.db.prepare("INSERT INTO series_chapters(id, series_id, project_id, title, summary, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, seriesId, projectId, canonicalTitle, canonicalSummary, position, isoNow(now), isoNow(now));
      this.touch(seriesId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("series.chapter_created", seriesId, { chapterId: id, projectId }, now);
      return id;
    });
  }

  updateSeriesChapter(seriesId, chapterId, { title, summary = "", now, ...auth } = {}) {
    this.entity(seriesId, "content_series");
    const chapter = this.db.prepare("SELECT id FROM series_chapters WHERE id = ? AND series_id = ?").get(chapterId, seriesId);
    if (!chapter) throw new Error("系列章节不存在");
    const canonicalTitle = required(title, "章节标题");
    const canonicalSummary = clean(summary);
    if (canonicalTitle.length > 120 || canonicalSummary.length > 500) throw new TypeError("章节字段超过长度限制");
    const payload = { chapterId, title: canonicalTitle, summary: canonicalSummary };
    const authorization = this.authorizeMutation("series.chapter.update", seriesId, payload, auth);
    if (authorization.replay) return chapterId;
    return this.repository.transaction(() => {
      this.db.prepare("UPDATE series_chapters SET title = ?, summary = ?, updated_at = ? WHERE id = ? AND series_id = ?")
        .run(canonicalTitle, canonicalSummary, isoNow(now), chapterId, seriesId);
      this.touch(seriesId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id: chapterId }, now });
      this.audit("series.chapter_updated", seriesId, { chapterId }, now);
      return chapterId;
    });
  }

  linkSeriesChapter(seriesId, chapterId, projectId, { now, ...auth } = {}) {
    this.entity(seriesId, "content_series");
    this.entity(projectId, "project");
    const chapter = this.db.prepare("SELECT project_id AS projectId FROM series_chapters WHERE id = ? AND series_id = ?").get(chapterId, seriesId);
    if (!chapter) throw new Error("系列章节不存在");
    if (chapter.projectId && chapter.projectId !== projectId) throw new Error("这个章节已经关联其他文章");
    const occupied = this.db.prepare("SELECT id FROM series_chapters WHERE project_id = ? AND id <> ?").get(projectId, chapterId);
    if (occupied) throw new Error("这篇文章已经属于其他系列章节");
    const payload = { chapterId, projectId };
    const authorization = this.authorizeMutation("series.chapter.link", seriesId, payload, auth);
    if (authorization.replay) return projectId;
    return this.repository.transaction(() => {
      this.db.prepare("UPDATE series_chapters SET project_id = ?, updated_at = ? WHERE id = ? AND series_id = ?")
        .run(projectId, isoNow(now), chapterId, seriesId);
      this.touch(seriesId, now);
      this.touch(projectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { projectId }, now });
      this.audit("series.chapter_linked", seriesId, { chapterId, projectId }, now);
      return projectId;
    });
  }

  reorderSeriesChapters(seriesId, chapterIds, { now, ...auth } = {}) {
    this.entity(seriesId, "content_series");
    const current = this.db.prepare("SELECT id FROM series_chapters WHERE series_id = ? ORDER BY position").all(seriesId).map((row) => row.id);
    const wanted = Array.isArray(chapterIds) ? chapterIds.map(clean) : [];
    if (wanted.length !== current.length || new Set(wanted).size !== current.length || current.some((id) => !wanted.includes(id))) {
      throw new Error("章节顺序必须完整包含当前系列的全部章节");
    }
    const payload = { chapterIds: wanted };
    const authorization = this.authorizeMutation("series.chapters.reorder", seriesId, payload, auth);
    if (authorization.replay) return wanted;
    return this.repository.transaction(() => {
      const offset = current.length + 1000;
      this.db.prepare("UPDATE series_chapters SET position = position + ? WHERE series_id = ?").run(offset, seriesId);
      const statement = this.db.prepare("UPDATE series_chapters SET position = ?, updated_at = ? WHERE id = ? AND series_id = ?");
      wanted.forEach((id, index) => statement.run(index + 1, isoNow(now), id, seriesId));
      this.touch(seriesId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { chapterIds: wanted }, now });
      this.audit("series.chapters_reordered", seriesId, { chapterIds: wanted }, now);
      return wanted;
    });
  }
  projectMaterials(projectId) {
    return this.db.prepare(`
      SELECT m.* FROM project_materials pm JOIN materials m ON m.id = pm.material_id
      JOIN entities e ON e.id = m.id WHERE pm.project_id = ? AND e.deleted_at IS NULL
    `).all(projectId);
  }

  groundingMaterials(projectId) {
    return this.db.prepare(`
      SELECT DISTINCT m.* FROM materials m
      JOIN entities e ON e.id = m.id
      LEFT JOIN project_materials pm ON pm.material_id = m.id AND pm.project_id = ?
      WHERE e.deleted_at IS NULL AND (m.material_type = '个人经历' OR pm.project_id IS NOT NULL)
    `).all(projectId);
  }

  linkMaterial(projectId, materialId, { relationKind = "reference", now, ...auth } = {}) {
    const payload = { materialId, relationKind };
    const authorization = this.authorizeMutation("project.materials.update", projectId, payload, auth);
    if (authorization.replay) return authorization.result?.linked === true;
    return this.repository.transaction(() => {
      this.entity(projectId, "project");
      this.entity(materialId, "material");
      const material = this.db.prepare("SELECT * FROM materials WHERE id = ?").get(materialId);
      if (relationKind === "evidence" && !isMaterialEligibleForDraft(material)) throw new Error("待核验素材不能作为成稿证据");
      this.db.prepare("INSERT INTO project_materials(project_id, material_id, relation_kind, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, material_id) DO UPDATE SET relation_kind = excluded.relation_kind")
        .run(projectId, materialId, relationKind, isoNow(now));
      this.touch(projectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { linked: true }, now });
      this.audit("project.material_linked", projectId, { materialId, relationKind }, now);
      return true;
    });
  }

  unlinkMaterial(projectId, materialId, { now, ...auth } = {}) {
    const payload = { materialId, action: "remove" };
    const authorization = this.authorizeMutation("project.materials.update", projectId, payload, auth);
    if (authorization.replay) return authorization.result?.linked === false;
    return this.repository.transaction(() => {
      this.entity(projectId, "project");
      this.entity(materialId, "material");
      const removed = this.db.prepare("DELETE FROM project_materials WHERE project_id = ? AND material_id = ?").run(projectId, materialId).changes > 0;
      if (removed) {
        this.touch(projectId, now);
        this.audit("project.material_unlinked", projectId, { materialId }, now);
      }
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { linked: false }, now });
      return removed;
    });
  }
  setPrimaryDraft(projectId, draftId, { now, ...auth } = {}) {
    const payload = { draftId };
    const authorization = this.authorizeMutation("project.primary.set", projectId, payload, auth);
    if (authorization.replay) return authorization.result?.draftId;
    this.entity(projectId, "project");
    this.assertDraftActive(draftId);
    const draft = this.db.prepare("SELECT project_id AS projectId, workflow_status AS workflowStatus FROM drafts WHERE id = ?").get(draftId);
    if (draft.workflowStatus === DRAFT_WORKFLOW.ABANDONED) throw new Error("已弃用稿件不能设为主稿，请先恢复写作");
    if (draft.projectId !== projectId) throw new Error("主稿必须属于同一个项目");
    return this.repository.transaction(() => {
      this.db.prepare("INSERT INTO project_primary_drafts(project_id, draft_id) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET draft_id = excluded.draft_id").run(projectId, draftId);
      this.touch(projectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { draftId }, now });
      this.audit("project.primary_draft_set", projectId, { draftId }, now);
      return draftId;
    });
  }

  affectedProjectIds(entityId, type) {
    const queries = {
      draft: "SELECT project_id AS id FROM drafts WHERE id = ?",
      material: "SELECT project_id AS id FROM project_materials WHERE material_id = ?",
      release_package: "SELECT d.project_id AS id FROM release_packages rp JOIN drafts d ON d.id = rp.draft_id WHERE rp.id = ?",
      publication: "SELECT d.project_id AS id FROM publication_records p JOIN drafts d ON d.id = p.draft_id WHERE p.id = ?",
      metric_snapshot: "SELECT d.project_id AS id FROM metric_snapshots m JOIN publication_records p ON p.id = m.publication_id JOIN drafts d ON d.id = p.draft_id WHERE m.id = ?",
      review: "SELECT d.project_id AS id FROM reviews r JOIN publication_records p ON p.id = r.publication_id JOIN drafts d ON d.id = p.draft_id WHERE r.id = ?",
      content_series: "SELECT project_id AS id FROM series_chapters WHERE series_id = ? AND project_id IS NOT NULL",
    };
    return queries[type] ? this.db.prepare(queries[type]).all(entityId).map((row) => row.id) : [];
  }
  softDeleteEntity(entityId, { now, ...auth } = {}) {
    const payload = { delete: true };
    const authorization = this.authorizeMutation("entity.delete", entityId, payload, auth);
    if (authorization.replay) return authorization.result?.deleted === true;
    const entity = this.entity(entityId);
    return this.repository.transaction(() => {
            const projectIds = this.affectedProjectIds(entityId, entity.type);
      if (!this.repository.softDeleteEntity(entityId, { now })) throw new Error("实体已经在回收站中");
      for (const projectId of projectIds) this.touch(projectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { deleted: true }, now });
      this.audit("entity.soft_deleted", entityId, { type: entity.type }, now);
      return true;
    });
  }

  restoreEntity(entityId, { now, ...auth } = {}) {
    const payload = { restore: true };
    const authorization = this.authorizeMutation("entity.restore", entityId, payload, auth);
    if (authorization.replay) return authorization.result?.restored === true;
    const entity = this.repository.getEntity(entityId, { includeDeleted: true });
    if (!entity?.deletedAt) throw new Error("实体不在回收站中");
    const projectIds = this.affectedProjectIds(entityId, entity.type);
    return this.repository.transaction(() => {
      if (!this.repository.restoreEntity(entityId, { now })) throw new Error("实体恢复失败");
      for (const projectId of projectIds) this.touch(projectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { restored: true }, now });
      this.audit("entity.restored", entityId, { type: entity.type }, now);
      return true;
    });
  }
  authorizeMutation(actionType, targetId, payload, options = {}) {
    if (!options.actor) throw new TypeError("领域写操作必须由受信调用方明确提供 actor");
    return this.actions.authorize({ actor: options.actor, candidateId: options.candidateId, actionType, targetId, payload, expectedVersion: options.expectedVersion });
  }

  createDraft({ id = createUlid(), projectId, title = "", bodyMarkdown = "", platform = "", parentDraftId = null, generated = false, now, ...auth } = {}) {
    const generatedContent = generated === true || auth.actor === "ai";
    const canonicalTitle = clean(title);
    const body = normalizeStoredText(bodyMarkdown);
    const payload = { projectId, title: canonicalTitle, bodyMarkdown: body, platform, parentDraftId, generated: generatedContent };
    const authorization = this.authorizeMutation("draft.create", projectId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    if (platform && !PLATFORMS.includes(platform)) throw new TypeError("稿件平台不合法");
    this.entity(projectId, "project");
    if (generatedContent) assertGroundedGeneratedText({ title: canonicalTitle, body }, this.groundingMaterials(projectId));
    return this.repository.transaction(() => {
      if (parentDraftId) {
        this.assertDraftActive(parentDraftId);
        const parent = this.db.prepare("SELECT project_id AS projectId FROM drafts WHERE id = ?").get(parentDraftId);
        if (parent.projectId !== projectId) throw new Error("父稿必须属于同一个项目");
      }
      this.repository.createEntity({ id, type: "draft", now });
      this.db.prepare("INSERT INTO drafts(id, project_id, parent_draft_id, title, body_markdown, platform) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, projectId, parentDraftId, canonicalTitle, body, platform);
      this.repository.setEntityText(id, { title: canonicalTitle, body, now });
      this.saveRevision(id, { title: canonicalTitle, bodyMarkdown: body, authorKind: generatedContent ? "ai_confirmed" : "user", reason: "create", now });
      this.db.prepare("INSERT OR IGNORE INTO project_primary_drafts(project_id, draft_id) VALUES (?, ?)").run(projectId, id);
      this.db.prepare("UPDATE projects SET status = 'active' WHERE id = ? AND status = 'generating'").run(projectId);
      this.touch(projectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("draft.created", id, { projectId, generated: generatedContent }, now);
      return id;
    });
  }
  saveRevision(entityId, { title = "", bodyMarkdown = "", authorKind = "user", reason = "", now } = {}) {
    const canonicalTitle = clean(title);
    const body = normalizeStoredText(bodyMarkdown);
    const hash = contentHash(canonicalTitle, body);
    const latest = this.db.prepare("SELECT id, content_sha256 AS hash FROM revisions WHERE entity_id = ? ORDER BY revision_no DESC LIMIT 1").get(entityId);
    if (latest?.hash === hash) return latest.id;
    const revisionNo = this.db.prepare("SELECT COALESCE(MAX(revision_no), 0) + 1 AS value FROM revisions WHERE entity_id = ?").get(entityId).value;
    const id = createUlid();
    this.db.prepare("INSERT INTO revisions(id, entity_id, revision_no, title, body_markdown, content_sha256, author_kind, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, entityId, revisionNo, canonicalTitle, body, hash, authorKind, clean(reason), isoNow(now));
    return id;
  }
  updateDraft(draftId, { title = "", bodyMarkdown = "", generated = false, reason = "edit", now, ...auth } = {}) {
    const generatedContent = generated === true || auth.actor === "ai";
    const canonicalTitle = clean(title);
    const body = normalizeStoredText(bodyMarkdown);
    const payload = { title: canonicalTitle, bodyMarkdown: body, generated: generatedContent, reason };
    const authorization = this.authorizeMutation("draft.update", draftId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    this.assertDraftActive(draftId);
    const draft = this.db.prepare("SELECT * FROM drafts WHERE id = ?").get(draftId);
    if (draft.workflow_status !== DRAFT_WORKFLOW.WRITING) throw new Error("只有写作中的稿件可以编辑；请先明确退回写作或创建新变体");
    if (generatedContent) assertGroundedGeneratedText({ title: canonicalTitle, body }, this.groundingMaterials(draft.project_id));
    return this.repository.transaction(() => {
      this.db.prepare("UPDATE drafts SET title = ?, body_markdown = ? WHERE id = ?").run(canonicalTitle, body, draftId);
      this.repository.setEntityText(draftId, { title: canonicalTitle, body, now });
      this.saveRevision(draftId, { title: canonicalTitle, bodyMarkdown: body, authorKind: generatedContent ? "ai_confirmed" : "user", reason, now });
      this.touch(draftId, now);
      this.touch(draft.project_id, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id: draftId }, now });
      this.audit("draft.updated", draftId, { generated: generatedContent }, now);
      return draftId;
    });
  }
  saveDraftRelease(draftId, { title = "", bodyMarkdown = "", summary = "", coverUrl = "", coverText = "", coverNote = "", keywords = [], interactionGoal = "", now, ...auth } = {}) {
    return this.repository.transaction(() => {
      this.updateDraft(draftId, { title, bodyMarkdown, reason: "release edit", now, ...auth });
      return this.upsertReleasePackage(draftId, { summary, coverUrl, coverText, coverNote, keywords, interactionGoal, now, ...auth });
    });
  }
  upsertReleasePackage(draftId, { id = createUlid(), summary = "", coverUrl = "", coverText = "", coverNote = "", keywords = [], interactionGoal = "", now, ...auth } = {}) {
    const normalizedKeywords = [...new Set((Array.isArray(keywords) ? keywords : []).map(clean).filter(Boolean))];
    const payload = { summary: normalizeStoredText(summary), coverUrl: clean(coverUrl), coverText: normalizeStoredText(coverText), coverNote: normalizeStoredText(coverNote), keywords: normalizedKeywords, interactionGoal: normalizeStoredText(interactionGoal) };
    if (payload.summary.length > 500 || payload.coverText.length > 120 || payload.coverNote.length > 500 || payload.interactionGoal.length > 300) throw new TypeError("发布包字段超过长度限制");
    if (normalizedKeywords.length > 8 || normalizedKeywords.some((keyword) => keyword.length > 30)) throw new TypeError("关键词最多 8 个且每个不超过 30 字");
    const authorization = this.authorizeMutation("release.update", draftId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    this.assertDraftActive(draftId);
    if (payload.coverUrl) validHttpUrl(payload.coverUrl, "封面链接");
    const draft = this.db.prepare("SELECT project_id AS projectId, workflow_status AS workflowStatus FROM drafts WHERE id = ?").get(draftId);
    if (draft.workflowStatus !== DRAFT_WORKFLOW.WRITING) throw new Error("只有写作中的稿件可以修改发布包");
    if (auth.actor === "ai") assertGroundedGeneratedText(payload, this.groundingMaterials(draft.projectId));
    return this.repository.transaction(() => {
      const existing = this.db.prepare("SELECT id FROM release_packages WHERE draft_id = ?").get(draftId);
      const packageId = existing?.id || id;
      if (!existing) this.repository.createEntity({ id: packageId, type: "release_package", now });
      this.db.prepare(`INSERT INTO release_packages(id, draft_id, summary, cover_url, cover_text, cover_note, keywords_json, interaction_goal, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(draft_id) DO UPDATE SET summary = excluded.summary, cover_url = excluded.cover_url,
          cover_text = excluded.cover_text, cover_note = excluded.cover_note, keywords_json = excluded.keywords_json,
          interaction_goal = excluded.interaction_goal, updated_at = excluded.updated_at`)
        .run(packageId, draftId, payload.summary, payload.coverUrl, payload.coverText, payload.coverNote, json(normalizedKeywords), payload.interactionGoal, isoNow(now));
      if (existing) this.touch(packageId, now);
      this.touch(draftId, now);
      this.touch(draft.projectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id: packageId }, now });
      this.audit("release_package.saved", packageId, { draftId }, now);
      return packageId;
    });
  }
  transitionDraft(draftId, action, { now, ...auth } = {}) {
    const payload = { action };
    const authorization = this.authorizeMutation("draft.transition", draftId, payload, auth);
    if (authorization.replay) return authorization.result?.status;
    this.assertDraftActive(draftId);
    return this.repository.transaction(() => {
      const draft = this.db.prepare("SELECT * FROM drafts WHERE id = ?").get(draftId);
      if (!draft) throw new Error("draft不存在");
      if (action === "finish-writing") {
        const releasePackage = this.db.prepare("SELECT rp.* FROM release_packages rp JOIN entities e ON e.id = rp.id WHERE rp.draft_id = ? AND e.deleted_at IS NULL").get(draftId);
        assertDraftReadyToFinish(draft, releasePackage);
      }
      if (action === "publish") throw new Error("发布必须通过 publishDraft 记录链接和时间");
      const next = nextDraftWorkflow(draft.workflow_status, action);
      this.db.prepare("UPDATE drafts SET workflow_status = ? WHERE id = ?").run(next, draftId);
      this.touch(draftId, now);
      this.touch(draft.project_id, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { status: next }, now });
      this.audit("draft.transitioned", draftId, { action, from: draft.workflow_status, to: next }, now);
      return next;
    });
  }

  publishDraft(draftId, { title = "", platform, publishedUrl, publishedAt, idempotencyKey, metadata = {}, now, ...auth } = {}) {
    const key = required(idempotencyKey, "幂等键");
    const payload = {
      title: clean(title),
      platform: clean(platform),
      publishedUrl: validHttpUrl(publishedUrl),
      publishedAt: requiredIso(publishedAt, "发布时间"),
      idempotencyKey: key,
      metadata,
    };
    const authorization = this.authorizeMutation("publication.create", draftId, payload, auth);
    if (authorization.replay) return authorization.result;
    const requestHash = sha256Json({ operation: "publication.create", draftId, payload });
    return this.repository.transaction(() => {
      const replay = this.db.prepare("SELECT request_sha256 AS requestSha256, response_json AS responseJson FROM idempotency_records WHERE key = ?").get(key);
      if (replay) {
        if (replay.requestSha256 !== requestHash) throw new Error("同一幂等键对应了不同发布内容");
        return JSON.parse(replay.responseJson);
      }
      this.assertDraftActive(draftId);
      const draft = this.db.prepare("SELECT * FROM drafts WHERE id = ?").get(draftId);
      if (draft.workflow_status !== DRAFT_WORKFLOW.READY) throw new Error("只有待发布稿件可以发布");
      const targetPlatform = payload.platform || draft.platform;
      if (!PLATFORMS.includes(targetPlatform)) throw new TypeError("发布平台不合法");
      const revision = this.db.prepare("SELECT id, content_sha256 AS contentSha256 FROM revisions WHERE entity_id = ? ORDER BY revision_no DESC LIMIT 1").get(draftId);
      if (!revision) throw new Error("发布稿缺少可追溯修订版本");
      const publicationId = createUlid();
      this.repository.createEntity({ id: publicationId, type: "publication", now });
      this.db.prepare("INSERT INTO publication_records(id, draft_id, revision_id, content_sha256, platform, title, published_url, published_at, idempotency_key, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(publicationId, draftId, revision.id, revision.contentSha256, targetPlatform, payload.title || draft.title, payload.publishedUrl, payload.publishedAt, key, json(metadata));
      this.db.prepare("UPDATE drafts SET workflow_status = ?, publication_status = ?, platform = ? WHERE id = ?")
        .run(DRAFT_WORKFLOW.PUBLISHED, PUBLICATION_STATUS.PUBLISHED, targetPlatform, draftId);
      this.touch(draftId, now);
      this.touch(draft.project_id, now);
      const response = { publicationId, draftId };
      this.db.prepare("INSERT INTO idempotency_records(key, operation, request_sha256, response_json, created_at) VALUES (?, 'publication.create', ?, ?, ?)")
        .run(key, requestHash, json(response), isoNow(now));
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: response, now });
      this.audit("publication.created", publicationId, { draftId, platform: targetPlatform }, now);
      return response;
    });
  }
  recordMetrics(publicationId, { id = createUlid(), capturedAt, views = null, likes = null, comments = null, collects = null, shares = null, raw = {}, now, ...auth } = {}) {
    const values = [views, likes, comments, collects, shares];
    if (values.some((value) => value != null && (!Number.isInteger(value) || value < 0))) throw new TypeError("发布指标必须是非负整数或空值");
    const payload = { capturedAt: isoNow(capturedAt || now), views, likes, comments, collects, shares, raw };
    const authorization = this.authorizeMutation("metrics.record", publicationId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    this.assertPublicationActive(publicationId);
    return this.repository.transaction(() => {
      const publication = this.db.prepare("SELECT p.*, d.project_id AS projectId FROM publication_records p JOIN drafts d ON d.id = p.draft_id WHERE p.id = ?").get(publicationId);
      this.repository.createEntity({ id, type: "metric_snapshot", now });
      this.db.prepare("INSERT INTO metric_snapshots(id, publication_id, captured_at, views, likes, comments, collects, shares, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, publicationId, payload.capturedAt, views, likes, comments, collects, shares, json(raw));
      this.touch(publicationId, now);
      this.touch(publication.projectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("publication.metrics_recorded", id, { publicationId }, now);
      return id;
    });
  }
  submitPublicationReview(publicationId, { id = createUlid(), metrics = null, status, basisMarkdown = "", conclusionMarkdown, nextExperimentMarkdown, now, ...auth } = {}) {
    const normalizedMetrics = metrics ? {
      capturedAt: isoNow(metrics.capturedAt || now),
      views: metrics.views ?? null,
      likes: metrics.likes ?? null,
      comments: metrics.comments ?? null,
      collects: metrics.collects ?? null,
      shares: metrics.shares ?? null,
      raw: metrics.raw ?? {},
    } : null;
    if (normalizedMetrics && [normalizedMetrics.views, normalizedMetrics.likes, normalizedMetrics.comments, normalizedMetrics.collects, normalizedMetrics.shares]
      .some((value) => value != null && (!Number.isInteger(value) || value < 0))) throw new TypeError("发布指标必须是非负整数或空值");
    const payload = {
      metrics: normalizedMetrics,
      status,
      basisMarkdown: required(normalizeStoredText(basisMarkdown), "复盘依据"),
      conclusionMarkdown: required(normalizeStoredText(conclusionMarkdown), "复盘结论"),
      nextExperimentMarkdown: required(normalizeStoredText(nextExperimentMarkdown), "下一篇实验"),
    };
    const authorization = this.authorizeMutation("publication.review.submit", publicationId, payload, auth);
    if (authorization.replay) return authorization.result;
    if (!REVIEW_STATUS.includes(status)) throw new TypeError("复盘状态不合法，已沉淀只能由素材沉淀动作设置");
    this.assertPublicationActive(publicationId);
    if (auth.actor === "ai") assertGroundedGeneratedText(payload, this.groundingMaterials(null));
    return this.repository.transaction(() => {
      const publication = this.db.prepare("SELECT p.*, d.project_id AS projectId FROM publication_records p JOIN drafts d ON d.id = p.draft_id WHERE p.id = ?").get(publicationId);
      const anyReview = this.db.prepare("SELECT r.id, r.status, e.deleted_at AS deletedAt FROM reviews r JOIN entities e ON e.id = r.id WHERE r.publication_id = ?").get(publicationId);
      if (anyReview?.deletedAt) throw new Error("复盘在回收站中，必须先恢复后再编辑");
      if (anyReview?.status === "已沉淀") throw new Error("已沉淀复盘不能直接覆盖");
      let metricId = null;
      if (normalizedMetrics) {
        metricId = createUlid();
        this.repository.createEntity({ id: metricId, type: "metric_snapshot", now });
        this.db.prepare("INSERT INTO metric_snapshots(id, publication_id, captured_at, views, likes, comments, collects, shares, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(metricId, publicationId, normalizedMetrics.capturedAt, normalizedMetrics.views, normalizedMetrics.likes, normalizedMetrics.comments, normalizedMetrics.collects, normalizedMetrics.shares, json(normalizedMetrics.raw));
      }
      const reviewId = anyReview?.id || id;
      if (anyReview) {
        this.db.prepare("UPDATE reviews SET status = ?, basis_markdown = ?, conclusion_markdown = ?, next_experiment_markdown = ?, reviewed_at = ? WHERE id = ?")
          .run(status, payload.basisMarkdown, payload.conclusionMarkdown, payload.nextExperimentMarkdown, isoNow(now), reviewId);
        this.touch(reviewId, now);
      } else {
        this.repository.createEntity({ id: reviewId, type: "review", now });
        this.db.prepare("INSERT INTO reviews(id, publication_id, status, basis_markdown, conclusion_markdown, next_experiment_markdown, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(reviewId, publicationId, status, payload.basisMarkdown, payload.conclusionMarkdown, payload.nextExperimentMarkdown, isoNow(now));
      }
      this.touch(publicationId, now);
      this.touch(publication.projectId, now);
      const result = { metricId, reviewId };
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result, now });
      this.audit("publication.review_submitted", reviewId, { publicationId, status, metricId }, now);
      return result;
    });
  }
  settleReview(reviewId, { feedback = [], storyMaterialIds = [], confirmed = false, now, ...auth } = {}) {
    if (confirmed !== true) throw new Error("沉淀复盘必须由用户明确确认");
    const feedbackItems = (Array.isArray(feedback) ? feedback : []).map((item) => ({
      type: clean(item?.type),
      title: required(item?.title, "反馈素材标题"),
      bodyMarkdown: normalizeStoredText(item?.bodyMarkdown),
    }));
    const requiredTypes = new Set(["标题样本", "内容角度", "平台反馈"]);
    if (feedbackItems.length !== requiredTypes.size || feedbackItems.some((item) => !requiredTypes.delete(item.type)) || requiredTypes.size) {
      throw new Error("表现突出复盘必须各沉淀一条标题样本、内容角度和平台反馈");
    }
    const uniqueStoryIds = [...new Set((Array.isArray(storyMaterialIds) ? storyMaterialIds : []).map(clean).filter(Boolean))];
    const payload = { feedback: feedbackItems, storyMaterialIds: uniqueStoryIds };
    const authorization = this.authorizeMutation("review.settle", reviewId, payload, auth);
    if (authorization.replay) return authorization.result;
    const review = this.assertReviewActive(reviewId);
    const settlementSha256 = sha256Json(payload);
    if (auth.actor === "ai") assertGroundedGeneratedText(payload, this.groundingMaterials(review.projectId));
    if (review.status === "已沉淀") {
      if (review.settlement_sha256 !== settlementSha256) throw new Error("已沉淀复盘不能用不同内容再次执行");
      return {
        status: "已沉淀",
        feedbackMaterialIds: this.db.prepare("SELECT material_id AS id FROM review_materials WHERE review_id = ? ORDER BY material_id").all(reviewId).map((item) => item.id),
        storyMaterialIds: this.db.prepare("SELECT material_id AS id FROM review_story_materials WHERE review_id = ? ORDER BY material_id").all(reviewId).map((item) => item.id),
      };
    }
    if (review.status !== "表现突出") throw new Error("只有表现突出的复盘可以沉淀");
    return this.repository.transaction(() => {
      const feedbackMaterialIds = [];
      for (const item of feedbackItems) {
        let materialId = this.db.prepare("SELECT id FROM materials WHERE source_entity_id = ? AND material_type = ?").get(reviewId, item.type)?.id;
        if (!materialId) {
          materialId = createUlid();
          this.repository.createEntity({ id: materialId, type: "material", now });
          this.db.prepare(`INSERT INTO materials(id, title, material_type, body_markdown, source_entity_id, verification_status, verification_note, verification_method)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(materialId, item.title, item.type, item.bodyMarkdown, reviewId, VERIFICATION.NA, "由用户确认的表现突出复盘沉淀。", "review-feedback");
          this.repository.setEntityText(materialId, { title: item.title, body: item.bodyMarkdown, now });
        } else {
          this.db.prepare("UPDATE materials SET title = ?, body_markdown = ? WHERE id = ?").run(item.title, item.bodyMarkdown, materialId);
          this.repository.setEntityText(materialId, { title: item.title, body: item.bodyMarkdown, now });
          this.touch(materialId, now);
        }
        this.db.prepare("INSERT OR IGNORE INTO review_materials(review_id, material_id, created_at) VALUES (?, ?, ?)").run(reviewId, materialId, isoNow(now));
        feedbackMaterialIds.push(materialId);
      }
      for (const materialId of uniqueStoryIds) {
        const story = this.db.prepare(`SELECT m.id FROM materials m JOIN entities e ON e.id = m.id AND e.deleted_at IS NULL
          JOIN project_materials pm ON pm.material_id = m.id AND pm.project_id = ?
          WHERE m.id = ? AND m.material_type IN ('案例/故事', '个人经历')`).get(review.projectId, materialId);
        if (!story) throw new Error("有效故事必须是该项目实际使用的案例或个人经历素材");
        this.db.prepare("INSERT OR IGNORE INTO review_story_materials(review_id, material_id, created_at) VALUES (?, ?, ?)").run(reviewId, materialId, isoNow(now));
      }
      this.db.prepare("UPDATE reviews SET status = '已沉淀', settlement_sha256 = ? WHERE id = ?").run(settlementSha256, reviewId);
      this.touch(reviewId, now);
      this.touch(review.projectId, now);
      const result = {
        status: "已沉淀",
        feedbackMaterialIds: feedbackMaterialIds.sort(),
        storyMaterialIds: [...uniqueStoryIds].sort(),
      };
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result, now });
      this.audit("review.settled", reviewId, result, now);
      return result;
    });
  }
  projectStage(projectId) {
    this.entity(projectId, "project");
    const project = this.db.prepare("SELECT p.* FROM projects p JOIN entities e ON e.id = p.id WHERE p.id = ? AND e.deleted_at IS NULL").get(projectId);
    const drafts = this.db.prepare("SELECT d.*, e.deleted_at FROM drafts d JOIN entities e ON e.id = d.id WHERE d.project_id = ? AND e.deleted_at IS NULL ORDER BY e.updated_at, d.id").all(projectId);
    const publications = this.db.prepare(`SELECT p.* FROM publication_records p
      JOIN entities pe ON pe.id = p.id AND pe.deleted_at IS NULL
      JOIN drafts d ON d.id = p.draft_id JOIN entities de ON de.id = d.id AND de.deleted_at IS NULL
      WHERE d.project_id = ? ORDER BY p.published_at, p.id`).all(projectId);
    const reviews = this.db.prepare(`SELECT r.* FROM reviews r
      JOIN entities re ON re.id = r.id AND re.deleted_at IS NULL
      JOIN publication_records p ON p.id = r.publication_id JOIN entities pe ON pe.id = p.id AND pe.deleted_at IS NULL
      JOIN drafts d ON d.id = p.draft_id WHERE d.project_id = ?`).all(projectId);
    const primaryDraftId = this.db.prepare(`SELECT ppd.draft_id AS id FROM project_primary_drafts ppd
      JOIN entities e ON e.id = ppd.draft_id AND e.deleted_at IS NULL WHERE ppd.project_id = ?`).get(projectId)?.id || null;
    return deriveProjectStage({ project, drafts, publications, reviews, primaryDraftId });
  }
  transitionProject(projectId, action, { now, ...auth } = {}) {
    const payload = { action };
    const authorization = this.authorizeMutation("project.transition", projectId, payload, auth);
    if (authorization.replay) return authorization.result?.status;
    this.entity(projectId, "project");
    return this.repository.transaction(() => {
      const project = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
      const rules = {
        "request-generation": { from: [PROJECT_STATUS.ACTIVE], to: PROJECT_STATUS.GENERATING },
        "cancel-generation": { from: [PROJECT_STATUS.GENERATING], to: PROJECT_STATUS.ACTIVE },
        park: { from: [PROJECT_STATUS.ACTIVE, PROJECT_STATUS.GENERATING], to: PROJECT_STATUS.PARKED },
        resume: { from: [PROJECT_STATUS.PARKED], to: PROJECT_STATUS.ACTIVE },
      };
      const rule = rules[action];
      if (!rule || !rule.from.includes(project.status)) throw new Error(`当前项目状态“${project.status}”不能执行 ${action}`);
      this.db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(rule.to, projectId);
      this.touch(projectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { status: rule.to }, now });
      this.audit("project.transitioned", projectId, { action, from: project.status, to: rule.to }, now);
      return rule.to;
    });
  }
  parkProject(projectId, options = {}) {
    return this.transitionProject(projectId, "park", options);
  }
}
