import crypto from "node:crypto";
import { createUlid } from "../storage/ids.mjs";
import { ActionPolicy } from "./action-policy.mjs";
import { assertGroundedGeneratedText, isMaterialEligibleForDraft, isValidHttpSource, normalizeStoredText, sha256Json, sourceContainsVerbatim, verificationForMaterial } from "./integrity.mjs";
import { assertDraftReadyToFinish, deriveProjectStage, nextCaptureStatus, nextDraftWorkflow, nextSeedStatus } from "./state-rules.mjs";
import { DRAFT_WORKFLOW, ENTRY_KIND_SET, ENTRY_RELATION_SET, MATERIAL_TYPE_SET, PLATFORMS, PRIORITIES, PROJECT_STATUS, PUBLICATION_STATUS, REVIEW_STATUS, VERBATIM_MATERIAL_TYPES, VERIFICATION } from "./values.mjs";

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
  /* ————————————————— 词条层（本地 LLM Wiki）—————————————————
   *
   * 让知识复利而不是堆积，只有三个操作：**归并**（新事实落到已有词条上）、
   * **矛盾**（冲突被记录而不是被静默覆盖）、**连接**。下面这组方法就是这三个。
   *
   * ⚠️ 这一层没有 update 语义。事实只会被**追加**、被**推翻**（superseded）
   * 或被**标记冲突**（disputed），不会被就地改写——否则「这个说法什么时候变的、
   * 因为哪份资料变的」就查不回来了，而那恰恰是这套东西比一堆笔记值钱的地方。
   */

  entryRow(entryId) {
    const row = this.db.prepare("SELECT e.* FROM entries e JOIN entities en ON en.id = e.id AND en.deleted_at IS NULL WHERE e.id = ?").get(entryId);
    if (!row) throw new Error("词条不存在");
    return row;
  }

  /**
   * 把词条正文写进 FTS。**每次事实变动都要重跑。**
   *
   * 写作时「不用 @、相关词条自己出现」靠的是拿草稿正文去 match 词条正文；
   * 事实不进索引的话，召回就退化成只看标题匹配，等于没有。
   * 已被推翻的事实不进索引——它们仍然可查，但不该再被当成现在的知识召回。
   */
  refreshEntryText(entryId, now) {
    const entry = this.db.prepare("SELECT name, definition FROM entries WHERE id = ?").get(entryId);
    if (!entry) return;
    const facts = this.db.prepare("SELECT statement FROM entry_facts WHERE entry_id = ? AND status <> 'superseded' ORDER BY created_at, id").all(entryId);
    this.repository.setEntityText(entryId, {
      title: entry.name,
      body: [entry.definition, ...facts.map((fact) => fact.statement)].filter(Boolean).join("\n"),
      now,
    });
  }

  createEntry({ id = createUlid(), name, kind, definition = "", definitionSourceId = null, now, ...auth } = {}) {
    const canonicalName = required(name, "词条名");
    const canonicalDefinition = normalizeStoredText(definition);
    const payload = { name: canonicalName, kind, definition: canonicalDefinition, definitionSourceId };
    const authorization = this.authorizeMutation("entry.create", definitionSourceId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    if (!ENTRY_KIND_SET.has(kind)) throw new TypeError("词条类型不合法");
    // 定义必须有来源。没有来源的定义就是模型的记忆——而模型的记忆正是这套东西要根除的东西。
    if (!canonicalDefinition) throw new TypeError("词条定义不能为空");
    if (!definitionSourceId) throw new TypeError("词条定义必须注明来源实体");
    if (auth.actor === "ai") assertGroundedGeneratedText({ title: canonicalName, body: canonicalDefinition }, this.groundingMaterials(null));
    return this.repository.transaction(() => {
      this.entity(definitionSourceId);
      // 重名先拦一道。表上有 UNIQUE，但 `UNIQUE constraint failed: entries.name`
      // 对调用方没有意义——ingest 需要的是「已经有这个词条了，去追加事实或者合并」。
      // ⚠️ 软删的词条**仍然占着名字**（UNIQUE 不带 deleted 条件），这是故意的：
      // 合并掉的名字不该被另起炉灶重建，那样刚合完就又分叉了。
      const existing = this.db.prepare("SELECT id FROM entries WHERE name = ?").get(canonicalName);
      if (existing) throw Object.assign(new Error(`词条「${canonicalName}」已存在，应追加事实或合并，不要重建`), { code: "ENTRY_NAME_TAKEN", entryId: existing.id });
      this.repository.createEntity({ id, type: "entry", now });
      // 建出来就是孤儿，直到有人链它或它链别人。**不在这里硬拦**：
      // 批量入库时第一个词条无处可链，硬拦会让整批卡死。孤儿是一个队列，不是一道门。
      this.db.prepare("INSERT INTO entries(id, name, entry_kind, definition, definition_source_id, orphan_since) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, canonicalName, kind, canonicalDefinition, definitionSourceId, isoNow(now));
      this.refreshEntryText(id, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("entry.created", id, { kind, definitionSourceId }, now);
      return id;
    });
  }

  /**
   * 往词条上追加一条事实。
   *
   * `assertedAt` 是「这条事实在什么时间点为真」，默认取来源实体的创建时间。
   * ⚠️ 对导入的书籍章节来说那是**入库时间**而不是成书时间，过期检测在这类来源上
   * 会偏松；需要精确时间的调用方要自己传。
   */
  addEntryFact({ id = createUlid(), entryId, statement, sourceEntityId, sourceLocator = "", assertedAt = "", now, ...auth } = {}) {
    const canonicalStatement = required(statement, "事实内容");
    const payload = { entryId, statement: canonicalStatement, sourceEntityId, sourceLocator, assertedAt };
    const authorization = this.authorizeMutation("entry.fact.add", entryId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    // 硬闸：没有来源的事实进不来。表上是 NOT NULL，这里先给一句人话的错误。
    if (!sourceEntityId) throw new TypeError("事实必须注明来源实体");
    if (auth.actor === "ai") assertGroundedGeneratedText({ body: canonicalStatement }, this.groundingMaterials(null));
    return this.repository.transaction(() => {
      this.entryRow(entryId);
      const source = this.entity(sourceEntityId);
      const stamp = isoNow(now);
      this.db.prepare(`INSERT INTO entry_facts(id, entry_id, statement, source_entity_id, source_locator, asserted_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .run(id, entryId, canonicalStatement, sourceEntityId, clean(sourceLocator), assertedAt ? requiredIso(assertedAt, "事实时间") : source.createdAt, stamp, stamp);
      this.refreshEntryText(entryId, now);
      this.touch(entryId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("entry.fact_added", entryId, { factId: id, sourceEntityId }, now);
      return id;
    });
  }

  /** 新资料推翻旧论断。旧事实**不删**，标记 superseded 并指向新的那条。 */
  supersedeEntryFact(factId, { supersededBy, now, ...auth } = {}) {
    const payload = { supersededBy };
    const authorization = this.authorizeMutation("entry.fact.supersede", factId, payload, auth);
    if (authorization.replay) return authorization.result?.status;
    return this.repository.transaction(() => {
      const stale = this.db.prepare("SELECT * FROM entry_facts WHERE id = ?").get(factId);
      const fresh = this.db.prepare("SELECT * FROM entry_facts WHERE id = ?").get(supersededBy);
      if (!stale || !fresh) throw new Error("事实不存在");
      if (stale.id === fresh.id) throw new TypeError("事实不能推翻自己");
      if (stale.entry_id !== fresh.entry_id) throw new TypeError("只能用同一词条下的事实推翻");
      if (stale.status === "superseded") throw new Error("这条事实已经被推翻过");
      this.db.prepare("UPDATE entry_facts SET status = 'superseded', superseded_by = ?, conflicts_with = NULL, updated_at = ? WHERE id = ?")
        .run(fresh.id, isoNow(now), stale.id);
      this.refreshEntryText(stale.entry_id, now);
      this.touch(stale.entry_id, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { status: "superseded" }, now });
      this.audit("entry.fact_superseded", stale.entry_id, { factId: stale.id, supersededBy: fresh.id }, now);
      return "superseded";
    });
  }

  /**
   * 两条事实互相打架、又都站得住。
   *
   * ⚠️ **这不是删除，也不是二选一。** 参照的那套飞书实现在这里写的是
   * 「以最新入库资料为准」——直接覆盖。那样一来「我曾经相信过什么、为什么改了」
   * 就永久丢了，而对写作者来说，认知变化本身往往就是选题。
   */
  disputeEntryFacts(factId, otherFactId, { now, ...auth } = {}) {
    const payload = { otherFactId };
    const authorization = this.authorizeMutation("entry.fact.dispute", factId, payload, auth);
    if (authorization.replay) return authorization.result?.status;
    return this.repository.transaction(() => {
      const left = this.db.prepare("SELECT * FROM entry_facts WHERE id = ?").get(factId);
      const right = this.db.prepare("SELECT * FROM entry_facts WHERE id = ?").get(otherFactId);
      if (!left || !right) throw new Error("事实不存在");
      if (left.id === right.id) throw new TypeError("事实不能和自己冲突");
      if (left.entry_id !== right.entry_id) throw new TypeError("只能标记同一词条下的事实冲突");
      if (left.status === "superseded" || right.status === "superseded") throw new Error("已被推翻的事实不再参与冲突标记");
      const stamp = isoNow(now);
      this.db.prepare("UPDATE entry_facts SET status = 'disputed', conflicts_with = ?, updated_at = ? WHERE id = ?").run(right.id, stamp, left.id);
      this.db.prepare("UPDATE entry_facts SET status = 'disputed', conflicts_with = ?, updated_at = ? WHERE id = ?").run(left.id, stamp, right.id);
      this.touch(left.entry_id, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { status: "disputed" }, now });
      this.audit("entry.fact_disputed", left.entry_id, { factIds: [left.id, right.id] }, now);
      return "disputed";
    });
  }

  /**
   * 连接两个词条。
   *
   * 只存**一条有方向的边**，不写回链——反向链接是 `entity_relations_to_idx` 上的
   * 一次查询，免费且不会和正向不同步。参照的那套实现要专门跑一条 lint 去查
   * 「回链补全了没有」，那是 markdown 和飞书文档链接才需要的账。
   */
  linkEntries(fromId, toId, relationType, { now, ...auth } = {}) {
    const payload = { toId, relationType };
    const authorization = this.authorizeMutation("entry.link", fromId, payload, auth);
    if (authorization.replay) return authorization.result?.linked;
    if (!ENTRY_RELATION_SET.has(relationType)) throw new TypeError("词条关系类型不合法");
    if (fromId === toId) throw new TypeError("词条不能链接到自己");
    return this.repository.transaction(() => {
      this.entryRow(fromId);
      this.entryRow(toId);
      this.repository.relate(fromId, toId, relationType, { now });
      // 两端都不再是孤儿——被链接和链接别人一样算「接上了」。
      this.db.prepare("UPDATE entries SET orphan_since = NULL WHERE id IN (?, ?)").run(fromId, toId);
      this.touch(fromId, now);
      this.touch(toId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { linked: true }, now });
      this.audit("entry.linked", fromId, { toId, relationType }, now);
      return true;
    });
  }

  /**
   * 合并重复词条：把 source 的事实和关系搬到 target，然后软删 source。
   *
   * AI 提词条一定会造出「结构化提示词」和「结构化提示」这种同义重复，
   * 没有合并的话它们会各自长事实，然后互相矛盾——而那是**假矛盾**，
   * 会把真矛盾淹掉。
   */
  mergeEntries(sourceId, targetId, { now, ...auth } = {}) {
    const payload = { targetId };
    const authorization = this.authorizeMutation("entry.merge", sourceId, payload, auth);
    if (authorization.replay) return authorization.result?.merged;
    if (sourceId === targetId) throw new TypeError("词条不能和自己合并");
    return this.repository.transaction(() => {
      this.entryRow(sourceId);
      this.entryRow(targetId);
      this.db.prepare("UPDATE entry_facts SET entry_id = ?, updated_at = ? WHERE entry_id = ?").run(targetId, isoNow(now), sourceId);
      // 搬关系时要绕开两个坑：搬过去会变成自链的（source 和 target 本来就相连），
      // 以及 target 上已经有的同类边。两者都直接丢弃。
      for (const row of this.db.prepare("SELECT to_id AS toId, relation_type AS type FROM entity_relations WHERE from_id = ?").all(sourceId)) {
        if (row.toId !== targetId) this.repository.relate(targetId, row.toId, row.type, { now });
      }
      for (const row of this.db.prepare("SELECT from_id AS fromId, relation_type AS type FROM entity_relations WHERE to_id = ?").all(sourceId)) {
        if (row.fromId !== targetId) this.repository.relate(row.fromId, targetId, row.type, { now });
      }
      this.db.prepare("DELETE FROM entity_relations WHERE from_id = ? OR to_id = ?").run(sourceId, sourceId);
      const attached = this.db.prepare("SELECT COUNT(*) AS count FROM entity_relations WHERE from_id = ? OR to_id = ?").get(targetId, targetId).count;
      if (attached > 0) this.db.prepare("UPDATE entries SET orphan_since = NULL WHERE id = ?").run(targetId);
      this.refreshEntryText(targetId, now);
      this.touch(targetId, now);
      this.repository.softDeleteEntity(sourceId, { now });
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { merged: true }, now });
      this.audit("entry.merged", targetId, { sourceId }, now);
      return true;
    });
  }

  /** 按名字找词条。ingest 每提一个词条都要先问一次「这个是不是已经有了」。 */
  findEntryByName(name) {
    return this.db.prepare(`SELECT e.id, e.name, e.entry_kind AS kind, e.definition
      FROM entries e JOIN entities en ON en.id = e.id AND en.deleted_at IS NULL WHERE e.name = ?`).get(clean(name)) || null;
  }

  /** 孤儿词条。**是一个查询，不是一次巡检**——不需要 AI 遍历全库去找。 */
  entryOrphans({ limit = 100 } = {}) {
    return this.db.prepare(`SELECT e.id, e.name, e.entry_kind AS kind, e.orphan_since AS orphanSince
      FROM entries e JOIN entities en ON en.id = e.id AND en.deleted_at IS NULL
      WHERE NOT EXISTS (SELECT 1 FROM entity_relations r WHERE r.from_id = e.id OR r.to_id = e.id)
      ORDER BY e.orphan_since, e.id LIMIT ?`).all(Math.max(1, Math.min(500, Number(limit) || 100)));
  }

  /**
   * 待判定的同题事实：同一词条下、来自不同来源、都还 active 的两条。
   *
   * ⚠️ **这不是「矛盾」，别在界面上这么叫。** 它是**候选**——绝大多数是互补或
   * 同义重述，真矛盾要靠语义判断才认得出来。
   *
   * ⚠️ **不要用字符重合度当闸门。** 我试过（阈值 0.22），实测 98 对里最高只有 0.19，
   * 等于全部拦掉；而且方向是反的——真矛盾（「A 提高记忆」对「A 没有效果」）
   * **共享的词反而更少**，重合度量的是话题相似度，不是冲突。那道闸门滤掉噪音的同时
   * 也滤掉了信号。
   *
   * 判断留给 lint：把**一个词条的全部事实**一次交给模型看有没有张力——
   * 单位对了，成本也从 O(事实²) 降到 O(词条)。这里只负责把范围机械缩到
   * 「同词条 + 不同来源」，那已经把全库比对变成了几十对。
   */
  entryFactPairs({ limit = 400 } = {}) {
    return this.db.prepare(`SELECT a.entry_id AS entryId, e.name AS entryName,
        a.id AS leftFactId, a.statement AS leftStatement, a.source_entity_id AS leftSourceId, a.asserted_at AS leftAssertedAt,
        b.id AS rightFactId, b.statement AS rightStatement, b.source_entity_id AS rightSourceId, b.asserted_at AS rightAssertedAt
      FROM entry_facts a
      JOIN entry_facts b ON b.entry_id = a.entry_id AND b.id > a.id AND b.source_entity_id <> a.source_entity_id
      JOIN entries e ON e.id = a.entry_id
      JOIN entities en ON en.id = e.id AND en.deleted_at IS NULL
      WHERE a.status = 'active' AND b.status = 'active'
      ORDER BY a.entry_id, a.id LIMIT ?`).all(Math.max(1, Math.min(2_000, Number(limit) || 400)));
  }

  /** 词条的双向邻居。正向存在表里，反向是索引上的一次查询。 */
  entryNeighbors(entryId) {
    return {
      outgoing: this.db.prepare(`SELECT r.to_id AS id, e.name, e.entry_kind AS kind, r.relation_type AS relationType
        FROM entity_relations r JOIN entries e ON e.id = r.to_id
        JOIN entities en ON en.id = e.id AND en.deleted_at IS NULL WHERE r.from_id = ? ORDER BY e.name`).all(entryId),
      incoming: this.db.prepare(`SELECT r.from_id AS id, e.name, e.entry_kind AS kind, r.relation_type AS relationType
        FROM entity_relations r JOIN entries e ON e.id = r.from_id
        JOIN entities en ON en.id = e.id AND en.deleted_at IS NULL WHERE r.to_id = ? ORDER BY e.name`).all(entryId),
    };
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
  /**
   * 合集 = 文章的归属 + 有序目录。它**不是一个要维护的项目**：没有目标读者、
   * 没有学习成果、没有发布进度。`content_series` 上残留的
   * `audience` / `outcome` / `status` 三列已在 0005 里退役（见那份 migration 的抬头），
   * ⚠️ **不要重新接线**。
   */
  createSeries({ id = createUlid(), title, descriptionMarkdown = "", confirmed = false, now, ...auth } = {}) {
    if (confirmed !== true) throw new Error("创建合集必须来自用户明确确认");
    const canonicalTitle = required(title, "合集名称");
    const description = normalizeStoredText(descriptionMarkdown);
    if (canonicalTitle.length > 120) throw new TypeError("合集名称不能超过 120 字");
    if (description.length > 2000) throw new TypeError("合集说明不能超过 2000 字");
    const payload = { title: canonicalTitle, descriptionMarkdown: description };
    const authorization = this.authorizeMutation("series.create", null, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    return this.repository.transaction(() => {
      this.repository.createEntity({ id, type: "content_series", now });
      this.db.prepare("INSERT INTO content_series(id, title, description_markdown) VALUES (?, ?, ?)")
        .run(id, canonicalTitle, description);
      this.repository.setEntityText(id, { title: canonicalTitle, body: description, now });
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("series.created", id, {}, now);
      return id;
    });
  }

  updateSeries(seriesId, { title, descriptionMarkdown = "", now, ...auth } = {}) {
    this.entity(seriesId, "content_series");
    const canonicalTitle = required(title, "合集名称");
    const description = normalizeStoredText(descriptionMarkdown);
    if (canonicalTitle.length > 120 || description.length > 2000) throw new TypeError("合集字段超过长度限制");
    const payload = { title: canonicalTitle, descriptionMarkdown: description };
    const authorization = this.authorizeMutation("series.update", seriesId, payload, auth);
    if (authorization.replay) return seriesId;
    return this.repository.transaction(() => {
      this.db.prepare("UPDATE content_series SET title = ?, description_markdown = ? WHERE id = ?")
        .run(canonicalTitle, description, seriesId);
      this.repository.setEntityText(seriesId, { title: canonicalTitle, body: description, now });
      this.touch(seriesId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id: seriesId }, now });
      this.audit("series.updated", seriesId, {}, now);
      return seriesId;
    });
  }

  /** 追加一条 = 拿当前最大 position + 1。`series_entries` 上 `UNIQUE(series_id, position)` 挡重复。 */
  #appendSeriesEntry(seriesId, { id, kind, projectId, heading, note, now }) {
    const position = this.db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS value FROM series_entries WHERE series_id = ?").get(seriesId).value;
    this.db.prepare("INSERT INTO series_entries(id, series_id, kind, project_id, heading, note, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, seriesId, kind, projectId, heading, note, position, isoNow(now), isoNow(now));
    return id;
  }

  /**
   * 把一篇已有文章放进合集。
   *
   * ⚠️ **一篇文章可以同时属于多个合集**——0005 去掉了 `project_id` 上那条全局 UNIQUE，
   * 只留 `UNIQUE(series_id, project_id)`。旧版那条全局唯一让已归属的文章在选择器里
   * 静默消失，而用户只看到「没有可添加的文章」。这里重复加入要**说清原因**，不能静默。
   */
  addSeriesArticle(seriesId, { id = createUlid(), projectId, note = "", now, ...auth } = {}) {
    this.entity(seriesId, "content_series");
    const canonicalProjectId = required(projectId, "文章");
    this.entity(canonicalProjectId, "project");
    const canonicalNote = clean(note);
    if (canonicalNote.length > 500) throw new TypeError("条目说明不能超过 500 字");
    const existing = this.db.prepare("SELECT id FROM series_entries WHERE series_id = ? AND project_id = ?").get(seriesId, canonicalProjectId);
    if (existing) throw new Error("这篇文章已经在这个合集里了");
    const payload = { projectId: canonicalProjectId, note: canonicalNote };
    const authorization = this.authorizeMutation("series.article.add", seriesId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    return this.repository.transaction(() => {
      this.#appendSeriesEntry(seriesId, { id, kind: "article", projectId: canonicalProjectId, heading: "", note: canonicalNote, now });
      this.touch(seriesId, now);
      this.touch(canonicalProjectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("series.article_added", seriesId, { entryId: id, projectId: canonicalProjectId }, now);
      return id;
    });
  }

  /** 分节行：合集里的一条分隔标题（「入门 / 进阶 / 参考」），本身不是文章。 */
  addSeriesSection(seriesId, { id = createUlid(), heading, now, ...auth } = {}) {
    this.entity(seriesId, "content_series");
    const canonicalHeading = required(heading, "分节标题");
    if (canonicalHeading.length > 120) throw new TypeError("分节标题不能超过 120 字");
    const payload = { heading: canonicalHeading };
    const authorization = this.authorizeMutation("series.section.add", seriesId, payload, auth);
    if (authorization.replay) return authorization.result?.id;
    return this.repository.transaction(() => {
      this.#appendSeriesEntry(seriesId, { id, kind: "section", projectId: null, heading: canonicalHeading, note: "", now });
      this.touch(seriesId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id }, now });
      this.audit("series.section_added", seriesId, { entryId: id }, now);
      return id;
    });
  }

  /**
   * 改一条条目上的字：分节改 `heading`，文章条目改 `note`。
   *
   * ⚠️ **文章标题不在这里改**。条目上不存标题——旧版 `series_chapters.title`
   * 和文章标题双写，改了文章标题合集里还是旧的。标题永远从 `projects` 现取。
   */
  updateSeriesEntry(seriesId, entryId, { heading, note, now, ...auth } = {}) {
    this.entity(seriesId, "content_series");
    const entry = this.db.prepare("SELECT id, kind FROM series_entries WHERE id = ? AND series_id = ?").get(entryId, seriesId);
    if (!entry) throw new Error("合集条目不存在");
    const payload = { entryId };
    if (entry.kind === "section") {
      payload.heading = required(heading, "分节标题");
      if (payload.heading.length > 120) throw new TypeError("分节标题不能超过 120 字");
    } else {
      payload.note = clean(note);
      if (payload.note.length > 500) throw new TypeError("条目说明不能超过 500 字");
    }
    const authorization = this.authorizeMutation("series.entry.update", seriesId, payload, auth);
    if (authorization.replay) return entryId;
    return this.repository.transaction(() => {
      if (entry.kind === "section") {
        this.db.prepare("UPDATE series_entries SET heading = ?, updated_at = ? WHERE id = ? AND series_id = ?")
          .run(payload.heading, isoNow(now), entryId, seriesId);
      } else {
        this.db.prepare("UPDATE series_entries SET note = ?, updated_at = ? WHERE id = ? AND series_id = ?")
          .run(payload.note, isoNow(now), entryId, seriesId);
      }
      this.touch(seriesId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id: entryId }, now });
      this.audit("series.entry_updated", seriesId, { entryId }, now);
      return entryId;
    });
  }

  /**
   * 文章那一侧的入口：一次写定这篇文章属于哪些合集。
   *
   * ⚠️ **前端不要拼多次调用**（先删两条再加三条）。中途失败会留下一半状态，
   * 而用户在界面上做的是**一个**动作：勾几个合集然后确认。
   */
  setProjectSeries(projectId, seriesIds, { now, ...auth } = {}) {
    this.entity(projectId, "project");
    const wanted = [...new Set((Array.isArray(seriesIds) ? seriesIds : []).map(clean).filter(Boolean))];
    for (const seriesId of wanted) this.entity(seriesId, "content_series");
    const current = this.db.prepare("SELECT series_id AS seriesId, id FROM series_entries WHERE project_id = ?").all(projectId);
    const currentIds = new Set(current.map((row) => row.seriesId));
    const added = wanted.filter((id) => !currentIds.has(id));
    const removed = current.filter((row) => !wanted.includes(row.seriesId));
    const payload = { projectId, seriesIds: wanted };
    const authorization = this.authorizeMutation("series.project.set", projectId, payload, auth);
    if (authorization.replay) return wanted;
    return this.repository.transaction(() => {
      for (const seriesId of added) {
        this.#appendSeriesEntry(seriesId, { id: createUlid(), kind: "article", projectId, heading: "", note: "", now });
        this.touch(seriesId, now);
      }
      for (const row of removed) {
        this.#removeSeriesEntryRow(row.seriesId, row.id, now);
        this.touch(row.seriesId, now);
      }
      this.touch(projectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { projectId, seriesIds: wanted }, now });
      this.audit("series.project_set", projectId, { added, removed: removed.map((row) => row.seriesId) }, now);
      return wanted;
    });
  }

  /**
   * 删一条并把序号收紧。
   *
   * ⚠️ **必须先整体加一个 offset 再逐条落位**：`UNIQUE(series_id, position)` 是即时生效的，
   * 直接把第 3 条改成 2 会撞上还没挪走的第 2 条。
   */
  #removeSeriesEntryRow(seriesId, entryId, now) {
    this.db.prepare("DELETE FROM series_entries WHERE id = ? AND series_id = ?").run(entryId, seriesId);
    const remaining = this.db.prepare("SELECT id FROM series_entries WHERE series_id = ? ORDER BY position").all(seriesId);
    const offset = remaining.length + 1000;
    this.db.prepare("UPDATE series_entries SET position = position + ? WHERE series_id = ?").run(offset, seriesId);
    const reorder = this.db.prepare("UPDATE series_entries SET position = ?, updated_at = ? WHERE id = ?");
    remaining.forEach((item, index) => reorder.run(index + 1, isoNow(now), item.id));
  }

  /** 移出合集**不删文章**——文章仍留在全部文章里，只是不再属于这个合集。 */
  removeSeriesEntry(seriesId, entryId, { now, ...auth } = {}) {
    this.entity(seriesId, "content_series");
    const entry = this.db.prepare("SELECT project_id AS projectId FROM series_entries WHERE id = ? AND series_id = ?").get(entryId, seriesId);
    if (!entry) throw new Error("合集条目不存在");
    const payload = { entryId, projectId: entry.projectId || null };
    const authorization = this.authorizeMutation("series.entry.remove", seriesId, payload, auth);
    if (authorization.replay) return entryId;
    return this.repository.transaction(() => {
      this.#removeSeriesEntryRow(seriesId, entryId, now);
      this.touch(seriesId, now);
      if (entry.projectId) this.touch(entry.projectId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { id: entryId }, now });
      this.audit("series.entry_removed", seriesId, payload, now);
      return entryId;
    });
  }

  reorderSeriesEntries(seriesId, entryIds, { now, ...auth } = {}) {
    this.entity(seriesId, "content_series");
    const current = this.db.prepare("SELECT id FROM series_entries WHERE series_id = ? ORDER BY position").all(seriesId).map((row) => row.id);
    const wanted = Array.isArray(entryIds) ? entryIds.map(clean) : [];
    if (wanted.length !== current.length || new Set(wanted).size !== current.length || current.some((id) => !wanted.includes(id))) {
      throw new Error("顺序必须完整包含当前合集的全部条目");
    }
    const payload = { entryIds: wanted };
    const authorization = this.authorizeMutation("series.entries.reorder", seriesId, payload, auth);
    if (authorization.replay) return wanted;
    return this.repository.transaction(() => {
      // 同 `#removeSeriesEntryRow`：先整体挪开，再逐条落位
      const offset = current.length + 1000;
      this.db.prepare("UPDATE series_entries SET position = position + ? WHERE series_id = ?").run(offset, seriesId);
      const statement = this.db.prepare("UPDATE series_entries SET position = ?, updated_at = ? WHERE id = ? AND series_id = ?");
      wanted.forEach((id, index) => statement.run(index + 1, isoNow(now), id, seriesId));
      this.touch(seriesId, now);
      if (auth.candidateId) this.actions.markApplied(auth.candidateId, { result: { entryIds: wanted }, now });
      this.audit("series.entries_reordered", seriesId, { entryIds: wanted }, now);
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
      content_series: "SELECT project_id AS id FROM series_entries WHERE series_id = ? AND project_id IS NOT NULL",
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
