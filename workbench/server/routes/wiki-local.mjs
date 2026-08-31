// 知识库的本地 API：词条、来源和体检。
//
// ⚠️ **索引和更新日志不在这里，因为它们不该是被维护出来的东西。**
// 参照的那套飞书实现要人（其实是 AI）手写一份 A-Z 索引文档、再跑一条 lint 去查它
// 和实际词条对不对得上——那是因为飞书没有全文检索。这里索引就是一次查询，
// 日志就是 `audit_events`，两者都不会和事实不同步，也就没有「对账」这回事。

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
      (SELECT COUNT(DISTINCT f.source_entity_id) FROM entry_facts f WHERE f.entry_id = e.id) AS sourceCount,
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
      json_extract(b.metadata_json, '$.kind') AS writable,
      e.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM book_documents d JOIN entities de ON de.id = d.id AND de.deleted_at IS NULL WHERE d.book_id = b.id) AS documents,
      (SELECT COALESCE(SUM(LENGTH(d.body_markdown)), 0) FROM book_documents d WHERE d.book_id = b.id) AS chars,
      -- 这份资料**养活了多少条事实**。知识库特有的那一列：它区分「读过并用上了」
      -- 和「导进来放着」，而后者在任何文件列表里都长得和前者一模一样。
      (SELECT COUNT(*) FROM entry_facts f JOIN book_documents d ON d.id = f.source_entity_id WHERE d.book_id = b.id) AS citedFacts,
      (SELECT COUNT(*) FROM source_ingests s JOIN book_documents d ON d.id = s.source_entity_id
        WHERE d.book_id = b.id AND s.status IN ('applied', 'proposed', 'empty')) AS distilled,
      (SELECT COUNT(*) FROM source_ingests s JOIN book_documents d ON d.id = s.source_entity_id
        WHERE d.book_id = b.id AND s.status = 'failed') AS failed
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
        f.asserted_at AS assertedAt, f.superseded_by AS supersededBy, f.conflicts_with AS conflictsWith,
        COALESCE(t.title, '') AS sourceTitle, se.entity_type AS sourceType
      FROM entry_facts f
      LEFT JOIN entities se ON se.id = f.source_entity_id
      LEFT JOIN entity_text t ON t.entity_id = f.source_entity_id
      WHERE f.entry_id = ? ORDER BY f.status, f.created_at
    `).all(params.id);
    json(res, {
      ok: true,
      entry: { id: entry.id, name: entry.name, kind: entry.entry_kind, definition: entry.definition, definitionSourceId: entry.definition_source_id },
      facts,
      neighbors: workspace.domain.entryNeighbors(params.id),
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
      SELECT c.id, c.target_id AS sourceId, c.payload_json AS payloadJson, c.proposed_at AS proposedAt,
        COALESCE(t.title, '') AS sourceTitle, COALESCE(b.title, '') AS bookTitle
      FROM action_candidates c
      LEFT JOIN entity_text t ON t.entity_id = c.target_id
      LEFT JOIN book_documents d ON d.id = c.target_id
      LEFT JOIN books b ON b.id = d.book_id
      WHERE c.status = 'proposed' AND c.action_type = 'entry.create'
      ORDER BY c.proposed_at DESC LIMIT 50
    `).all();
    const candidates = [];
    for (const row of rows) {
      let payload;
      try { payload = JSON.parse(row.payloadJson); } catch { continue; }
      if (payload?.kind !== "wiki.ingest") continue;
      candidates.push({
        id: row.id, sourceId: row.sourceId, sourceTitle: row.sourceTitle, bookTitle: row.bookTitle, proposedAt: row.proposedAt,
        entries: payload.entries || [], facts: payload.facts || [], relations: payload.relations || [],
        contradictions: payload.contradictions || [], rejected: payload.rejected || [],
      });
    }
    json(res, { ok: true, candidates, kindLabels: ENTRY_KIND_LABELS, relationLabels: ENTRY_RELATION_LABELS });
  }) },

  { method: "POST", path: "/api/workspace/knowledge/candidates/:id", handler: guard(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    const candidate = workspace.domain.actions.get(params.id);
    if (!candidate || candidate.status !== "proposed") throw Object.assign(new Error("这条提案已经处理过了"), { status: 409 });
    if (body.action === "reject") {
      workspace.domain.actions.reject(params.id);
      return json(res, { ok: true, rejected: true });
    }
    // ⚠️ `actions.get()` **已经解析过** payload 了（`payloadJson` 被它置成 undefined）。
    // 再 JSON.parse 一次会报 `"undefined" is not valid JSON`——错在解析，读起来却像候选坏了。
    const payload = candidate.payload;
    const now = new Date();
    // 先确认再落地：`markApplied` 要求候选处于 confirmed，这一步就是「用户点了接受」。
    workspace.domain.actions.confirm(params.id, { now });
    const applied = applyProposal(workspace, { sourceId: payload.sourceId, sourceTitle: payload.title || "", proposal: payload, actor: "user", now });
    workspace.domain.actions.markApplied(params.id, { result: applied, now });
    json(res, { ok: true, applied });
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
