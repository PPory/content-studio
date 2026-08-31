// 知识库的本地 API：词条、来源和体检。
//
// ⚠️ **索引和更新日志不在这里，因为它们不该是被维护出来的东西。**
// 参照的那套飞书实现要人（其实是 AI）手写一份 A-Z 索引文档、再跑一条 lint 去查它
// 和实际词条对不对得上——那是因为飞书没有全文检索。这里索引就是一次查询，
// 日志就是 `audit_events`，两者都不会和事实不同步，也就没有「对账」这回事。

import crypto from "node:crypto";
import { fail, json, readJsonBody } from "../lib/http.mjs";
import { ENTRY_KIND_LABELS, ENTRY_RELATION_LABELS } from "../domain/values.mjs";
import { applyProposal } from "../domain/wiki-ingest.mjs";

function guard(handler) {
  return async (context) => {
    try {
      const workspace = await context.workspace;
      if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
      await handler({ ...context, workspace });
    } catch (error) {
      fail(context.res, error.message || "知识库请求失败", { status: error.status || 400 });
    }
  };
}

function entryRows(workspace) {
  return workspace.db.prepare(`
    SELECT e.id, e.name, e.entry_kind AS kind, e.definition, e.orphan_since AS orphanSince, en.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM entry_facts f WHERE f.entry_id = e.id AND f.status = 'active') AS activeFacts,
      (SELECT COUNT(*) FROM entry_facts f WHERE f.entry_id = e.id AND f.status = 'disputed') AS disputedFacts,
      (SELECT COUNT(*) FROM entry_facts f WHERE f.entry_id = e.id AND f.status = 'superseded') AS supersededFacts,
      (SELECT COUNT(*) FROM (
        SELECT f.source_entity_id AS sourceId FROM entry_facts f WHERE f.entry_id = e.id
        UNION SELECT e.definition_source_id WHERE e.definition_source_id IS NOT NULL
      )) AS sourceCount,
      (SELECT COUNT(*) FROM entity_relations r WHERE r.from_id = e.id OR r.to_id = e.id) AS relationCount
    FROM entries e JOIN entities en ON en.id = e.id AND en.deleted_at IS NULL
    ORDER BY en.updated_at DESC, e.name
  `).all();
}

/**
 * 来源一览。知识库里「我已经有什么」的那一半。
 *
 * 归类（书籍 / 课程 / 文档 / 文章）和可写性（藏书 / 资料）分开报——
 * 它们是正交的两件事，混成一列的话「这门课能不能改正文」就没地方看了。
 */
function sourceRows(workspace) {
  return workspace.db.prepare(`
    SELECT b.id, b.title, b.source_kind AS sourceKind, b.reading_status AS status,
      b.author, b.source_url AS sourceUrl, b.published_at AS publishedAt, b.platform,
      json_extract(b.metadata_json, '$.kind') AS writable,
      COALESCE(json_extract(b.metadata_json, '$.userAuthored'), 0) AS userAuthored,
      e.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM book_documents d JOIN entities de ON de.id = d.id AND de.deleted_at IS NULL WHERE d.book_id = b.id) AS documents,
      (SELECT COALESCE(SUM(LENGTH(d.body_markdown)), 0) FROM book_documents d WHERE d.book_id = b.id) AS chars,
      -- 这份资料**养活了多少条事实**。知识库特有的那一列：它区分「读过并用上了」
      -- 和「导进来放着」，而后者在任何文件列表里都长得和前者一模一样。
      (SELECT COUNT(*) FROM entry_facts f JOIN book_documents d ON d.id = f.source_entity_id WHERE d.book_id = b.id) AS citedFacts,
      (SELECT COUNT(*) FROM source_ingests s JOIN book_documents d ON d.id = s.source_entity_id
        WHERE d.book_id = b.id AND s.status IN ('applied', 'proposed', 'empty')) AS distilled,
      (SELECT COUNT(*) FROM source_ingests s JOIN book_documents d ON d.id = s.source_entity_id
        WHERE d.book_id = b.id AND s.status = 'failed') AS failed,
      (SELECT COUNT(*) FROM source_ingests s JOIN book_documents d ON d.id = s.source_entity_id
        WHERE d.book_id = b.id AND s.status = 'queued') AS queued,
      (SELECT COUNT(*) FROM source_ingests s JOIN book_documents d ON d.id = s.source_entity_id
        WHERE d.book_id = b.id AND s.status = 'proposed') AS proposed,
      (SELECT COUNT(*) FROM source_ingests s JOIN book_documents d ON d.id = s.source_entity_id
        WHERE d.book_id = b.id AND s.status = 'rejected') AS rejected
    FROM books b JOIN entities e ON e.id = b.id AND e.deleted_at IS NULL
    ORDER BY b.source_kind, b.title
  `).all();
}

/** 一份来源里的章节，供表格展开。带上每一节自己的提炼状态。 */
function sourceDocuments(workspace, bookId) {
  return workspace.db.prepare(`
    SELECT d.id, d.title, d.document_order AS position, LENGTH(d.body_markdown) AS chars,
      COALESCE(s.status, '') AS ingestStatus, COALESCE(s.error, '') AS ingestError,
      (SELECT COUNT(*) FROM entry_facts f WHERE f.source_entity_id = d.id) AS citedFacts
    FROM book_documents d
    JOIN entities e ON e.id = d.id AND e.deleted_at IS NULL
    LEFT JOIN source_ingests s ON s.source_entity_id = d.id
    WHERE d.book_id = ? ORDER BY d.document_order
  `).all(bookId);
}

function selectedProposal(payload, include) {
  if (!Array.isArray(include)) return payload;
  const allowed = new Set(include.map(String));
  const take = (name) => (payload[name] || []).filter((_, index) => allowed.has(`${name}:${index}`));
  return {
    ...payload,
    entries: take("entries"),
    definitions: take("definitions"),
    facts: take("facts"),
    relations: take("relations"),
    contradictions: take("contradictions"),
  };
}

function queueIngest(workspace, documents, { retry = false } = {}) {
  const stamp = new Date().toISOString();
  let queued = 0;
  let skipped = 0;
  let chars = 0;
  for (const document of documents.slice(0, 20)) {
    const hash = crypto.createHash("sha256").update(document.body || "").digest("hex");
    const previous = workspace.db.prepare("SELECT status, source_content_sha256 AS hash FROM source_ingests WHERE source_entity_id = ?").get(document.id);
    if (!retry && previous && ["queued", "proposed", "applied", "empty"].includes(previous.status) && (!previous.hash || previous.hash === hash)) {
      skipped += 1;
      continue;
    }
    workspace.db.prepare(`INSERT INTO source_ingests(source_entity_id,status,source_content_sha256,run_at)
      VALUES (?,'queued',?,?) ON CONFLICT(source_entity_id) DO UPDATE SET status='queued',
      candidate_id=NULL, source_content_sha256=excluded.source_content_sha256, error='', run_at=excluded.run_at`)
      .run(document.id, hash, stamp);
    workspace.jobs.enqueue({
      idempotencyKey: `wiki.ingest:${document.id}:${hash}${retry ? `:${Date.now()}` : ""}`,
      kind: "wiki.ingest",
      payload: { sourceId: document.id },
    });
    queued += 1;
    chars += String(document.body || "").length;
  }
  return { queued, skipped, chars, capped: documents.length > 20 };
}

export const wikiRoutes = [
  { method: "GET", path: "/api/workspace/entries", handler: guard(async ({ workspace, res }) => {
    const entries = entryRows(workspace);
    json(res, {
      ok: true,
      entries,
      kindLabels: ENTRY_KIND_LABELS,
      relationLabels: ENTRY_RELATION_LABELS,
      health: {
        total: entries.length,
        orphans: workspace.domain.entryOrphans({ limit: 500 }).length,
        // ⚠️ **`disputed` 是已经判定过的冲突，`pendingPairs` 只是待判定的候选。**
        // 两者绝不能合成一个数报出去：候选里绝大多数是互补说法，把它当成
        // 「N 处矛盾」端到界面上，点开全是噪音，第二次用户就不再点了。
        disputed: entries.reduce((sum, entry) => sum + entry.disputedFacts, 0),
        pendingPairs: workspace.domain.entryFactPairs({ limit: 2_000 }).length,
      },
    });
  }) },

  { method: "GET", path: "/api/workspace/entries/:id", handler: guard(async ({ workspace, res, params }) => {
    const entry = workspace.domain.entryRow(params.id);
    const facts = workspace.db.prepare(`
      SELECT f.id, f.statement, f.status, f.source_entity_id AS sourceId, f.source_locator AS locator,
        f.source_quote AS sourceQuote, f.source_content_sha256 AS sourceContentSha256,
        f.asserted_at AS assertedAt, f.superseded_by AS supersededBy, f.conflicts_with AS conflictsWith,
        COALESCE(t.title, '') AS sourceTitle, se.entity_type AS sourceType,
        -- ⚠️ **来源所属的那本书要一起给。** 少了它，界面上「打开来源」只能退回
        -- 「继续读上次那本」——于是点 Seedance 的来源会跳进《结构化与知识管理》，
        -- 而用户完全无法理解发生了什么。
        d.book_id AS sourceBookId
      FROM entry_facts f
      LEFT JOIN entities se ON se.id = f.source_entity_id
      LEFT JOIN entity_text t ON t.entity_id = f.source_entity_id
      LEFT JOIN book_documents d ON d.id = f.source_entity_id
      WHERE f.entry_id = ? ORDER BY f.status, f.created_at
    `).all(params.id);
    json(res, {
      ok: true,
      entry: {
        id: entry.id, name: entry.name, kind: entry.entry_kind, definition: entry.definition,
        definitionSourceId: entry.definition_source_id, definitionQuote: entry.definition_quote,
        definitionLocator: entry.definition_locator, definitionSourceSha256: entry.definition_source_sha256,
      },
      definitionHistory: workspace.db.prepare(`SELECT r.id, r.definition, r.source_entity_id AS sourceId,
          r.source_quote AS sourceQuote, r.source_locator AS locator, r.reason, r.is_current AS isCurrent,
          r.created_at AS createdAt, COALESCE(t.title, '') AS sourceTitle, d.book_id AS sourceBookId
        FROM entry_definition_revisions r
        LEFT JOIN entity_text t ON t.entity_id = r.source_entity_id
        LEFT JOIN book_documents d ON d.id = r.source_entity_id
        WHERE r.entry_id = ? ORDER BY r.created_at DESC`).all(params.id),
      facts,
      neighbors: workspace.domain.entryNeighbors(params.id),
      relationEvidence: workspace.db.prepare(`SELECT r.from_id AS fromId, r.to_id AS toId, r.relation_type AS relationType,
          ev.source_entity_id AS sourceId, ev.source_quote AS sourceQuote, ev.source_locator AS locator, ev.why,
          COALESCE(t.title, '') AS sourceTitle, d.book_id AS sourceBookId
        FROM entity_relations r
        JOIN entry_relation_evidence ev ON ev.from_id=r.from_id AND ev.to_id=r.to_id AND ev.relation_type=r.relation_type
        LEFT JOIN entity_text t ON t.entity_id=ev.source_entity_id
        LEFT JOIN book_documents d ON d.id=ev.source_entity_id
        WHERE r.from_id=? OR r.to_id=? ORDER BY r.created_at`).all(params.id, params.id),
      kindLabels: ENTRY_KIND_LABELS,
      relationLabels: ENTRY_RELATION_LABELS,
    });
  }) },

  { method: "GET", path: "/api/workspace/knowledge/sources", handler: guard(async ({ workspace, res }) => {
    const sources = sourceRows(workspace);
    json(res, {
      ok: true,
      sources,
      totals: {
        sources: sources.length,
        documents: sources.reduce((sum, item) => sum + item.documents, 0),
        chars: sources.reduce((sum, item) => sum + item.chars, 0),
        distilled: sources.reduce((sum, item) => sum + item.distilled, 0),
        citedFacts: sources.reduce((sum, item) => sum + item.citedFacts, 0),
      },
    });
  }) },

  { method: "GET", path: "/api/workspace/knowledge/sources/:id", handler: guard(async ({ workspace, res, params }) => {
    json(res, { ok: true, documents: sourceDocuments(workspace, params.id) });
  }) },

  { method: "POST", path: "/api/workspace/knowledge/ingest", handler: guard(async ({ workspace, req, res }) => {
    const body = await readJsonBody(req);
    const bookIds = [...new Set((body.bookIds || []).map(String).filter(Boolean))];
    const documentIds = [...new Set((body.documentIds || []).map(String).filter(Boolean))];
    if (!bookIds.length && !documentIds.length) throw new Error("请先选择要提炼的来源");
    const placeholders = (items) => items.map(() => "?").join(",");
    const byBooks = bookIds.length ? workspace.db.prepare(`SELECT d.id, d.body_markdown AS body
      FROM book_documents d JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL
      WHERE d.book_id IN (${placeholders(bookIds)}) ORDER BY d.book_id,d.document_order`).all(...bookIds) : [];
    const byIds = documentIds.length ? workspace.db.prepare(`SELECT d.id, d.body_markdown AS body
      FROM book_documents d JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL
      WHERE d.id IN (${placeholders(documentIds)}) ORDER BY d.id`).all(...documentIds) : [];
    const unique = new Map([...byBooks, ...byIds].map((item) => [item.id, item]));
    const result = queueIngest(workspace, [...unique.values()], { retry: body.retry === true });
    json(res, { ok: true, ...result, maxBatch: 20 });
  }) },

  /**
   * 写作现场的召回。**POST 是因为正文可能很长**，不是因为它会改东西——只读。
   */
  { method: "POST", path: "/api/workspace/knowledge/recall", handler: guard(async ({ workspace, req, res }) => {
    const body = await readJsonBody(req);
    json(res, {
      ok: true,
      entries: workspace.domain.recallEntries(String(body.text || ""), { limit: Number(body.limit) || 6 }),
      relationLabels: ENTRY_RELATION_LABELS,
      kindLabels: ENTRY_KIND_LABELS,
    });
  }) },

  /**
   * 待审阅的提炼提案。
   *
   * ⚠️ **提炼是自动排的，写入不是。** 收一份资料会自动读它，但读出来的词条要在这儿
   * 过一眼才落库——AGENTS.md 第 4 条。这一页就是那个「一次手势」的地方。
   */
  { method: "GET", path: "/api/workspace/knowledge/candidates", handler: guard(async ({ workspace, res }) => {
    const rows = workspace.db.prepare(`
      SELECT c.id, c.action_type AS actionType, c.target_id AS sourceId, c.payload_json AS payloadJson, c.proposed_at AS proposedAt,
        COALESCE(t.title, '') AS sourceTitle, COALESCE(b.title, '') AS bookTitle
      FROM action_candidates c
      LEFT JOIN entity_text t ON t.entity_id = c.target_id
      LEFT JOIN book_documents d ON d.id = c.target_id
      LEFT JOIN books b ON b.id = d.book_id
      WHERE c.status = 'proposed' AND c.action_type IN ('entry.create','entry.fact.dispute','entry.link')
      ORDER BY c.proposed_at DESC LIMIT 50
    `).all();
    const candidates = [];
    for (const row of rows) {
      let payload;
      try { payload = JSON.parse(row.payloadJson); } catch { continue; }
      if (!["wiki.ingest", "wiki.lint"].includes(payload?.kind)) continue;
      if (payload.kind === "wiki.ingest") {
        const contradictions = (payload.contradictions || []).map((item) => ({
          ...item,
          existingStatement: workspace.db.prepare("SELECT statement FROM entry_facts WHERE id = ?").get(item.existingFactId)?.statement || "",
        }));
        candidates.push({
          id: row.id, type: "ingest", sourceId: row.sourceId, sourceTitle: row.sourceTitle,
          bookTitle: row.bookTitle, proposedAt: row.proposedAt, model: payload.model || "",
          entries: payload.entries || [], definitions: payload.definitions || [], facts: payload.facts || [],
          relations: payload.relations || [], contradictions, rejected: payload.rejected || [],
        });
      } else {
        candidates.push({
          id: row.id, type: "lint", mode: payload.mode, sourceTitle: payload.name || row.sourceTitle,
          proposedAt: row.proposedAt, tensions: payload.tensions || [], links: payload.links || [],
        });
      }
    }
    json(res, { ok: true, candidates, kindLabels: ENTRY_KIND_LABELS, relationLabels: ENTRY_RELATION_LABELS });
  }) },

  { method: "POST", path: "/api/workspace/knowledge/candidates/:id", handler: guard(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    const candidate = workspace.domain.actions.get(params.id);
    if (!candidate || candidate.status !== "proposed") throw Object.assign(new Error("这条提案已经处理过了"), { status: 409 });
    const payload = candidate.payload;
    if (!["wiki.ingest", "wiki.lint"].includes(payload?.kind)) throw new Error("这不是知识库候选");
    if (body.action === "reject") {
      workspace.repository.transaction(() => {
        workspace.domain.actions.reject(params.id);
        if (payload.kind === "wiki.ingest") {
          workspace.db.prepare("UPDATE source_ingests SET status='rejected', candidate_id=? WHERE source_entity_id=?").run(params.id, payload.sourceId);
        }
        workspace.domain.audit("wiki.candidate_rejected", payload.sourceId || payload.entryId || candidate.targetId, {
          candidateId: params.id, kind: payload.kind, mode: payload.mode || "",
        }, new Date());
      });
      return json(res, { ok: true, rejected: true });
    }
    if (body.action !== "accept") throw new Error("处理方式只能是 accept 或 reject");

    const now = new Date();
    const applied = workspace.repository.transaction(() => {
      let result;
      if (payload.kind === "wiki.ingest") {
        const proposal = selectedProposal(payload, body.include);
        const selectedCount = ["entries", "definitions", "facts", "relations", "contradictions"]
          .reduce((sum, key) => sum + (proposal[key]?.length || 0), 0);
        if (!selectedCount) throw new Error("至少保留一项再接受");
        workspace.domain.actions.confirm(params.id, { now });
        result = applyProposal(workspace, { sourceId: payload.sourceId, sourceTitle: payload.title || "", proposal, actor: "user", now });
        workspace.db.prepare("UPDATE source_ingests SET status='applied', candidate_id=?, error='' WHERE source_entity_id=?").run(params.id, payload.sourceId);
      } else if (payload.mode === "tension") {
        const allowed = Array.isArray(body.include) ? new Set(body.include.map(String)) : null;
        const tensions = (payload.tensions || []).filter((_, index) => !allowed || allowed.has(`tensions:${index}`));
        if (!tensions.length) throw new Error("至少保留一项再接受");
        workspace.domain.actions.confirm(params.id, { now });
        for (const tension of tensions) {
          if (tension.verdict === "supersede") {
            const pair = workspace.db.prepare(`SELECT id, asserted_at AS assertedAt, created_at AS createdAt FROM entry_facts
              WHERE id IN (?, ?) ORDER BY asserted_at, created_at, id`).all(tension.leftFactId, tension.rightFactId);
            if (pair.length === 2) workspace.domain.supersedeEntryFact(pair[0].id, { supersededBy: pair[1].id, actor: "user", now });
          } else workspace.domain.disputeEntryFacts(tension.leftFactId, tension.rightFactId, { actor: "user", now });
        }
        result = { tensions: tensions.length };
      } else {
        const allowed = Array.isArray(body.include) ? new Set(body.include.map(String)) : null;
        const links = (payload.links || []).filter((_, index) => !allowed || allowed.has(`links:${index}`));
        if (!links.length) throw new Error("至少保留一项再接受");
        workspace.domain.actions.confirm(params.id, { now });
        for (const link of links) workspace.domain.linkEntries(payload.entryId, link.toId, link.type, { why: link.why, actor: "user", now });
        result = { links: links.length };
      }
      workspace.domain.actions.markApplied(params.id, { result, now });
      workspace.domain.audit("wiki.candidate_applied", payload.sourceId || payload.entryId || candidate.targetId, {
        candidateId: params.id, kind: payload.kind, mode: payload.mode || "", result,
      }, now);
      return result;
    });
    json(res, { ok: true, applied });
  }) },
  { method: "POST", path: "/api/workspace/knowledge/lint/run", handler: guard(async ({ workspace, req, res }) => {
    const body = await readJsonBody(req);
    const mode = body.mode;
    if (!["tension", "orphan"].includes(mode)) throw new Error("体检类型不合法");
    const limit = Math.max(1, Math.min(10, Number(body.limit) || 5));
    const entries = mode === "orphan"
      ? workspace.domain.entryOrphans({ limit })
      : [...new Map(workspace.domain.entryFactPairs({ limit: 2_000 }).map((item) => [item.entryId, { id: item.entryId }])).values()].slice(0, limit);
    for (const entry of entries) workspace.jobs.enqueue({
      idempotencyKey: `wiki.lint:${mode}:${entry.id}:${Date.now()}`,
      kind: "wiki.lint",
      payload: { entryId: entry.id, mode },
    });
    json(res, { ok: true, queued: entries.length, mode, maxBatch: 10 });
  }) },

  /** 体检。孤儿和矛盾候选都是查询，不是 AI 巡检出来的。 */
  { method: "GET", path: "/api/workspace/knowledge/lint", handler: guard(async ({ workspace, res }) => {
    json(res, {
      ok: true,
      orphans: workspace.domain.entryOrphans({ limit: 100 }),
      pendingPairs: workspace.domain.entryFactPairs({ limit: 200 }),
    });
  }) },
];
