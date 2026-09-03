// Living Wiki 的本地 API：完整页面、Raw 来源、追加式演化记录和全库体检。

import crypto from "node:crypto";
import { fail, json, readJsonBody } from "../lib/http.mjs";
import { readArticle } from "../lib/article.mjs";
import { createBookRecord } from "./books-local.mjs";
import {
  applyWikiCompile,
  lintFindingRepairability,
  wikiIndex,
  wikiPage,
  wikiHealth,
  trashWikiPage,
} from "../domain/wiki-pages.mjs";
import { resolveIngestSource } from "../domain/wiki-ingest.mjs";
// ⚠️ 这两个原来没 import，而这个文件里有四处在用它们。ESM 里引一个不存在的名字**不报编译错**，
// 只在那一行真的跑到时抛 ReferenceError——于是召回这个端点从上线起每次都 500，而写作现场的
// 「相关词条」只是安静地什么都不显示（它 `.catch(() => setData(null))`，没命中和请求失败长得一模一样）。
import { ENTRY_KIND_LABELS, ENTRY_RELATION_LABELS } from "../domain/values.mjs";

function guard(handler) {
  return async (context) => {
    try {
      const workspace = await context.workspace;
      if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
      await handler({ ...context, workspace });
    } catch (error) {
      // ⚠️ hint 要带上：这一栏里好几处报错都备了「下一步怎么办」，
      // 而这里原来只把 message 送出去，那些提示一句都到不了屏幕上。
      fail(context.res, error.message || "知识库请求失败", { status: error.status || 400, hint: error.hint });
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
      (SELECT COALESCE(SUM(LENGTH(d.body_markdown)), 0) FROM book_documents d
        JOIN entities de ON de.id = d.id AND de.deleted_at IS NULL WHERE d.book_id = b.id) AS chars,
      -- 这份资料**养活了多少条事实**。知识库特有的那一列：它区分「读过并用上了」
      -- 和「导进来放着」，而后者在任何文件列表里都长得和前者一模一样。
      (SELECT COUNT(*) FROM entry_facts f JOIN book_documents d ON d.id = f.source_entity_id WHERE d.book_id = b.id) AS citedFacts,
      (SELECT COUNT(DISTINCT s.page_id) FROM wiki_page_sources s JOIN book_documents d ON d.id=s.source_entity_id
        JOIN entities pe ON pe.id=s.page_id AND pe.deleted_at IS NULL
        WHERE d.book_id=b.id) AS citedPages,
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

/**
 * 全库「被来源影响过的 Wiki 页面」总数。
 *
 * ⚠️ **不能把每份来源各自的 `citedPages` 加起来。** 一张被三份来源引用的页面
 * 会被数三遍，于是「来源」页显示的 103 大于全库实际的 95 张——两页相邻摆着，
 * 数字自己拆自己的台。去重只能在一条查询里做。
 */
function citedPageTotal(workspace) {
  return workspace.db.prepare(`SELECT COUNT(DISTINCT s.page_id) AS count
    FROM wiki_page_sources s JOIN book_documents d ON d.id = s.source_entity_id
    JOIN entities e ON e.id = d.id AND e.deleted_at IS NULL
    JOIN entities pe ON pe.id = s.page_id AND pe.deleted_at IS NULL`).get().count;
}

/** 一份来源里的章节，供表格展开。带上每一节自己的提炼状态。 */
function sourceDocuments(workspace, bookId) {
  return workspace.db.prepare(`
    SELECT d.id, d.title, d.document_order AS position, LENGTH(d.body_markdown) AS chars,
      COALESCE(s.status, '') AS ingestStatus, COALESCE(s.error, '') AS ingestError,
      (SELECT COUNT(*) FROM entry_facts f WHERE f.source_entity_id = d.id) AS citedFacts
      ,(SELECT COUNT(DISTINCT s.page_id) FROM wiki_page_sources s
        JOIN entities pe ON pe.id=s.page_id AND pe.deleted_at IS NULL
        WHERE s.source_entity_id=d.id) AS citedPages
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
    pages: take("pages"),
    sources: take("sources"),
  };
}

// 值班台也排提炼（`workspace.mjs`），所以导出。和 `createBookRecord` 跨文件是同一个路子。
export function queueIngest(workspace, documents, { retry = false } = {}) {
  const stamp = new Date().toISOString();
  let queued = 0;
  let skipped = 0;
  let chars = 0;
  for (const document of documents.slice(0, 20)) {
    const hash = crypto.createHash("sha256").update(document.body || "").digest("hex");
    const previous = workspace.db.prepare("SELECT status, source_content_sha256 AS hash FROM source_ingests WHERE source_entity_id = ?").get(document.id);
    const liveJob = workspace.db.prepare(`SELECT 1 FROM local_jobs
      WHERE deleted_at IS NULL AND kind='wiki.ingest' AND status IN ('queued','retry','running')
        AND json_extract(payload_json, '$.sourceId')=? LIMIT 1`).get(document.id);
    const unchanged = previous && (!previous.hash || previous.hash === hash);
    if (liveJob || (!retry && unchanged && ["proposed", "applied", "empty"].includes(previous.status))) {
      skipped += 1;
      continue;
    }
    const baseKey = `wiki.ingest:${document.id}:${hash}`;
    let enqueued = workspace.jobs.enqueue({
      idempotencyKey: retry ? `${baseKey}:${crypto.randomUUID()}` : baseKey,
      kind: "wiki.ingest",
      payload: { sourceId: document.id },
    });
    if (!enqueued.created && !["queued", "retry", "running"].includes(enqueued.job.status)) {
      enqueued = workspace.jobs.enqueue({
        idempotencyKey: `${baseKey}:${crypto.randomUUID()}`,
        kind: "wiki.ingest",
        payload: { sourceId: document.id },
      });
    }
    if (!enqueued.created && !["queued", "retry", "running"].includes(enqueued.job.status)) {
      throw new Error(`来源 ${document.id} 未能进入编译队列`);
    }
    workspace.db.prepare(`INSERT INTO source_ingests(source_entity_id,status,source_content_sha256,run_at)
      VALUES (?,'queued',?,?) ON CONFLICT(source_entity_id) DO UPDATE SET status='queued',
      candidate_id=NULL, source_content_sha256=excluded.source_content_sha256, error='', run_at=excluded.run_at`)
      .run(document.id, hash, stamp);
    queued += 1;
    chars += String(document.body || "").length;
  }
  return { queued, skipped, chars, capped: documents.length > 20 };
}

function pastedTitle(text) {
  const line = String(text || "").split(String.fromCharCode(10)).map((item) => item.trim()).find(Boolean) || "";
  return line.replace(/^#{1,6} +/, "").replace(/^[-*>] +/, "").slice(0, 100) || "粘贴的文字";
}

async function importResearchSources(workspace, payload, include) {
  const proposal = selectedProposal(payload, include);
  if (!proposal.sources?.length) throw new Error("至少选择一份来源");
  const documents = [];
  let imported = 0;
  let existing = 0;
  for (const source of proposal.sources) {
    let book;
    try {
      book = await createBookRecord(workspace, {
        title: source.title || source.url,
        author: source.author || "",
        kind: "资料",
        sourceKind: "文档",
        sourceUrl: source.url,
        publishedAt: source.publishedAt || "",
        platform: source.siteName || "",
        chapters: [{ title: source.title || source.url, text: source.bodyMarkdown || "" }],
      });
      imported += 1;
    } catch (error) {
      if (error?.status !== 409 || !error.sourceId) throw error;
      book = { id: error.sourceId };
      existing += 1;
    }
    const rows = workspace.db.prepare(`SELECT d.id,d.title,d.body_markdown AS body
      FROM book_documents d JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL
      WHERE d.book_id=? ORDER BY d.document_order`).all(book.id);
    documents.push(...rows);
  }
  const queued = queueIngest(workspace, documents);
  return { imported, existing, selected: proposal.sources.length, ...queued };
}

export const wikiRoutes = [
  { method: "GET", path: "/api/workspace/wiki", handler: guard(async ({ workspace, req, res }) => {
    const url = new URL(req.url, "http://127.0.0.1");
    json(res, { ok: true, ...wikiIndex(workspace, { query: url.searchParams.get("q") || "" }) });
  }) },

  { method: "GET", path: "/api/workspace/wiki/:id", handler: guard(async ({ workspace, res, params }) => {
    json(res, { ok: true, ...wikiPage(workspace, params.id) });
  }) },

  { method: "POST", path: "/api/workspace/wiki/:id/trash", handler: guard(async ({ workspace, res, params }) => {
    json(res, { ok: true, page: trashWikiPage(workspace, params.id) });
  }) },

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
        citedPages: citedPageTotal(workspace),
      },
    });
  }) },

  { method: "GET", path: "/api/workspace/knowledge/sources/:id", handler: guard(async ({ workspace, res, params }) => {
    json(res, { ok: true, documents: sourceDocuments(workspace, params.id) });
  }) },

  { method: "POST", path: "/api/workspace/knowledge/sources/import", handler: guard(async ({ workspace, env, req, res }) => {
    const body = await readJsonBody(req);
    const mode = String(body.mode || "");
    let source;
    if (mode === "url") {
      const article = await readArticle(String(body.url || ""), env);
      source = {
        title: article.title || article.url,
        author: article.byline || "",
        sourceUrl: article.url,
        platform: article.siteName || "",
        text: article.markdown || "",
      };
    } else if (mode === "text") {
      const text = String(body.text || "").trim();
      if (text.length < 20) throw new Error("粘贴的文字太短，至少需要 20 个字符");
      source = { title: pastedTitle(text), author: "", sourceUrl: "", platform: "", text };
    } else if (mode === "capture") {
      /**
       * ⚠️ **情报 → 知识。** 收藏原来只能停在情报那一栏：读过、留着、然后没有下一步。
       * 它身上该有的东西（标题、正文、链接）本来就齐了，所以这条路不新开一份导入实现，
       * 只是把收藏喂进同一个 `createBookRecord`——提炼、逐字校验、审核全都照旧。
       */
      const capture = workspace.db.prepare(`SELECT c.id, c.title, c.body_markdown AS body, c.source_url AS sourceUrl
        FROM captures c JOIN entities e ON e.id = c.id AND e.deleted_at IS NULL WHERE c.id = ?`).get(String(body.captureId || ""));
      if (!capture) throw new Error("这条收藏不存在");
      const text = String(capture.body || "").trim();
      if (text.length < 20) {
        throw Object.assign(new Error("这条收藏正文太短，提炼不出东西"), {
          hint: "收藏里只存了标题或链接时会这样。先把正文补进去，或者直接用「粘贴链接」重读一遍。",
        });
      }
      source = {
        title: capture.title || pastedTitle(text), author: "",
        sourceUrl: capture.sourceUrl || "", platform: "", text, captureId: capture.id,
      };
    } else {
      throw new Error("请选择粘贴链接、粘贴文字，或指定一条收藏");
    }
    if (!source.text.trim()) throw new Error("没有读取到可导入的正文");
    const book = await createBookRecord(workspace, {
      title: source.title,
      author: source.author,
      kind: "资料",
      sourceKind: "文档",
      sourceUrl: source.sourceUrl,
      platform: source.platform,
      chapters: [{ title: source.title, text: source.text }],
    });
    let queuedForDistill = 0;
    if (body.distill !== false) {
      const documents = workspace.db.prepare(`SELECT d.id,d.body_markdown AS body FROM book_documents d
        JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL WHERE d.book_id=? ORDER BY d.document_order`).all(book.id);
      queuedForDistill = queueIngest(workspace, documents).queued;
    }
    /**
     * ⚠️ **提炼过的收藏就算归好了。** 不改状态的话，值班台上「N 条收藏还没归」
     * 会一直报同一条——而你已经对它做了这条链上最实的一件事。
     */
    if (source.captureId) {
      workspace.db.prepare("UPDATE captures SET status = 'accepted' WHERE id = ? AND status = 'pending'").run(source.captureId);
    }
    json(res, { ok: true, book, queuedForDistill, captureId: source.captureId || "" });
  }) },

  { method: "POST", path: "/api/workspace/knowledge/ingest", handler: guard(async ({ workspace, req, res }) => {
    const body = await readJsonBody(req);
    const bookIds = [...new Set((body.bookIds || []).map(String).filter(Boolean))];
    const documentIds = [...new Set((body.documentIds || []).map(String).filter(Boolean))];
    /**
     * ⚠️ **结算过的实践记录也能提炼。** 词条原来只认外部读物，于是「我自己做完一件事
     * 学到的东西」永远回不了知识库——四条链里「内容 → 知识」这一段是断的。
     * 逐字闸没有放松：结算记录是你自己写下并确认过的文本，引它一样要对得上。
     */
    const experimentIds = [...new Set((body.experimentIds || []).map(String).filter(Boolean))];
    if (!bookIds.length && !documentIds.length && !experimentIds.length) throw new Error("请先选择要提炼的来源");
    const placeholders = (items) => items.map(() => "?").join(",");
    const byBooks = bookIds.length ? workspace.db.prepare(`SELECT d.id, d.body_markdown AS body
      FROM book_documents d JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL
      WHERE d.book_id IN (${placeholders(bookIds)}) ORDER BY d.book_id,d.document_order`).all(...bookIds) : [];
    const byIds = documentIds.length ? workspace.db.prepare(`SELECT d.id, d.body_markdown AS body
      FROM book_documents d JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL
      WHERE d.id IN (${placeholders(documentIds)}) ORDER BY d.id`).all(...documentIds) : [];
    // 未结算的假设在这里解析不出来，所以「只沉淀已经验证过的」这条规矩由领域层守，
    // 不靠路由再抄一遍条件。
    const byExperiments = experimentIds
      .map((id) => resolveIngestSource(workspace.db, id))
      .filter(Boolean)
      .map((source) => ({ id: source.id, body: source.body }));
    if (experimentIds.length && !byExperiments.length) {
      throw Object.assign(new Error("这条实验还没结算，沉淀不了"), {
        hint: "还没验证的假设不是知识。先在运营那一栏结算它，再沉淀。",
      });
    }
    const unique = new Map([...byBooks, ...byIds, ...byExperiments].map((item) => [item.id, item]));
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
        COALESCE(t.title, '') AS sourceTitle, COALESCE(b.title, '') AS bookTitle, COALESCE(d.book_id, '') AS sourceBookId
      FROM action_candidates c
      LEFT JOIN entity_text t ON t.entity_id = c.target_id
      LEFT JOIN book_documents d ON d.id = c.target_id
      LEFT JOIN books b ON b.id = d.book_id
      WHERE c.status = 'proposed' AND c.action_type IN ('wiki.pages.apply','wiki.lint.review','wiki.sources.import')
      ORDER BY c.proposed_at DESC LIMIT 50
    `).all();
    const candidates = [];
    for (const row of rows) {
      let payload;
      try { payload = JSON.parse(row.payloadJson); } catch { continue; }
      if (!["wiki.compile", "wiki.lint.report", "wiki.repair", "wiki.research"].includes(payload?.kind)) continue;
      if (payload.kind === "wiki.compile") {
        candidates.push({
          id: row.id, type: "compile", sourceId: row.sourceId, sourceBookId: row.sourceBookId, sourceTitle: row.sourceTitle,
          bookTitle: row.bookTitle, proposedAt: row.proposedAt, model: payload.model || "",
          readMode: payload.readMode, chunksRead: payload.chunksRead || 1,
          compilationSummary: payload.compilationSummary || "", pages: payload.pages || [],
          rejected: payload.rejected || [],
        });
      } else if (payload.kind === "wiki.lint.report") {
        const repairJob = workspace.db.prepare(`SELECT status,last_error AS error FROM local_jobs
          WHERE deleted_at IS NULL AND kind='wiki.lint.repair'
            AND json_extract(payload_json, '$.reportCandidateId')=?
          ORDER BY created_at DESC LIMIT 1`).get(row.id);
        const pendingRepair = workspace.db.prepare(`SELECT 1 FROM action_candidates
          WHERE status='proposed' AND action_type='wiki.pages.apply'
            AND json_extract(payload_json, '$.kind')='wiki.repair'
            AND json_extract(payload_json, '$.reportCandidateId')=? LIMIT 1`).get(row.id);
        const researchJob = workspace.db.prepare(`SELECT status,last_error AS error FROM local_jobs
          WHERE deleted_at IS NULL AND kind='wiki.lint.research'
            AND json_extract(payload_json, '$.reportCandidateId')=?
          ORDER BY created_at DESC LIMIT 1`).get(row.id);
        const pendingResearch = workspace.db.prepare(`SELECT 1 FROM action_candidates
          WHERE status='proposed' AND action_type='wiki.sources.import'
            AND json_extract(payload_json, '$.kind')='wiki.research'
            AND json_extract(payload_json, '$.reportCandidateId')=? LIMIT 1`).get(row.id);
        candidates.push({
          id: row.id, type: "wiki-lint", mode: "network", sourceTitle: "全库体检",
          proposedAt: row.proposedAt,
          findings: (payload.findings || []).map((finding) => ({ ...finding, ...lintFindingRepairability(finding) })),
          deterministic: payload.deterministic || {},
          repairStatus: pendingRepair ? "ready" : repairJob?.status === "failed" ? "failed" : ["queued", "retry", "running"].includes(repairJob?.status) ? repairJob.status : "",
          repairError: repairJob?.error || "",
          researchStatus: pendingResearch ? "ready" : researchJob?.status === "failed" ? "failed" : ["queued", "retry", "running"].includes(researchJob?.status) ? researchJob.status : "",
          researchError: researchJob?.error || "",
        });
      } else if (payload.kind === "wiki.repair") {
        candidates.push({
          id: row.id, type: "repair", sourceTitle: "体检修订候选", proposedAt: row.proposedAt,
          model: payload.model || "", repairSummary: payload.repairSummary || "",
          reportCandidateId: payload.reportCandidateId || "", selectedFindings: payload.selectedFindings || [],
          pages: payload.pages || [], rejected: payload.rejected || [], unresolved: payload.unresolved || [],
        });
      } else if (payload.kind === "wiki.research") {
        candidates.push({
          id: row.id, type: "research", sourceTitle: "补充来源候选", proposedAt: row.proposedAt,
          reportCandidateId: payload.reportCandidateId || "", selectedFindings: payload.selectedFindings || [],
          sources: (payload.sources || []).map(({ bodyMarkdown, ...source }) => source),
          unreadable: payload.failures?.length || 0,
        });
      }
    }
    json(res, { ok: true, candidates });
  }) },

  { method: "POST", path: "/api/workspace/knowledge/candidates/:id/repair", handler: guard(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    const candidate = workspace.domain.actions.get(params.id);
    if (!candidate || candidate.status !== "proposed" || candidate.payload?.kind !== "wiki.lint.report") {
      throw Object.assign(new Error("这份体检报告已经处理过了"), { status: 409 });
    }
    const findingIndexes = [...new Set((body.include || []).map(String)
      .filter((key) => key.startsWith("findings:"))
      .map((key) => Number(key.slice("findings:".length)))
      .filter((index) => Number.isInteger(index) && index >= 0 && candidate.payload.findings?.[index]))].slice(0, 10);
    if (!findingIndexes.length) throw new Error("请先选择要处理的体检问题");
    const blocked = findingIndexes.map((index) => ({ index, ...lintFindingRepairability(candidate.payload.findings[index]) }))
      .filter((item) => !item.repairable);
    if (blocked.length) throw new Error(blocked[0].reason);
    const live = workspace.db.prepare(`SELECT id,status,last_error AS error FROM local_jobs
      WHERE deleted_at IS NULL AND kind='wiki.lint.repair' AND status IN ('queued','retry','running')
        AND json_extract(payload_json, '$.reportCandidateId')=? ORDER BY created_at DESC LIMIT 1`).get(params.id);
    if (live) return json(res, { ok: true, queued: 0, selected: findingIndexes.length, status: live.status });
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(findingIndexes)).digest("hex").slice(0, 16);
    const baseKey = `wiki.lint.repair:${params.id}:${fingerprint}`;
    let queued = workspace.jobs.enqueue({
      idempotencyKey: baseKey,
      kind: "wiki.lint.repair",
      payload: { reportCandidateId: params.id, findingIndexes },
    });
    if (!queued.created && !["queued", "retry", "running"].includes(queued.job.status)) {
      queued = workspace.jobs.enqueue({
        idempotencyKey: `${baseKey}:${crypto.randomUUID()}`,
        kind: "wiki.lint.repair",
        payload: { reportCandidateId: params.id, findingIndexes },
      });
    }
    json(res, { ok: true, queued: queued.created ? 1 : 0, selected: findingIndexes.length, status: queued.job.status });
  }) },

  { method: "POST", path: "/api/workspace/knowledge/candidates/:id/research", handler: guard(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    const candidate = workspace.domain.actions.get(params.id);
    if (!candidate || candidate.status !== "proposed" || candidate.payload?.kind !== "wiki.lint.report") {
      throw Object.assign(new Error("这份体检报告已经处理过了"), { status: 409 });
    }
    const findingIndexes = [...new Set((body.include || []).map(String)
      .filter((key) => key.startsWith("findings:"))
      .map((key) => Number(key.slice("findings:".length)))
      .filter((index) => Number.isInteger(index) && index >= 0 && candidate.payload.findings?.[index]))].slice(0, 5);
    if (!findingIndexes.length) throw new Error("请先选择要搜索来源的问题");
    const blocked = findingIndexes.map((index) => ({ index, ...lintFindingRepairability(candidate.payload.findings[index]) }))
      .filter((item) => !item.researchable);
    if (blocked.length) throw new Error("所选项目中包含不需要搜索补充来源的问题");
    const live = workspace.db.prepare(`SELECT id,status,last_error AS error FROM local_jobs
      WHERE deleted_at IS NULL AND kind='wiki.lint.research' AND status IN ('queued','retry','running')
        AND json_extract(payload_json, '$.reportCandidateId')=? ORDER BY created_at DESC LIMIT 1`).get(params.id);
    if (live) return json(res, { ok: true, queued: 0, selected: findingIndexes.length, status: live.status });
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(findingIndexes)).digest("hex").slice(0, 16);
    const baseKey = `wiki.lint.research:${params.id}:${fingerprint}`;
    let queued = workspace.jobs.enqueue({
      idempotencyKey: baseKey,
      kind: "wiki.lint.research",
      payload: { reportCandidateId: params.id, findingIndexes },
    });
    if (!queued.created && !["queued", "retry", "running"].includes(queued.job.status)) {
      queued = workspace.jobs.enqueue({
        idempotencyKey: `${baseKey}:${crypto.randomUUID()}`,
        kind: "wiki.lint.research",
        payload: { reportCandidateId: params.id, findingIndexes },
      });
    }
    json(res, { ok: true, queued: queued.created ? 1 : 0, selected: findingIndexes.length, status: queued.job.status });
  }) },

  { method: "POST", path: "/api/workspace/knowledge/candidates/:id", handler: guard(async ({ workspace, req, res, params }) => {
    const body = await readJsonBody(req);
    const candidate = workspace.domain.actions.get(params.id);
    if (!candidate || candidate.status !== "proposed") throw Object.assign(new Error("这条提案已经处理过了"), { status: 409 });
    const payload = candidate.payload;
    if (!["wiki.compile", "wiki.lint.report", "wiki.repair", "wiki.research"].includes(payload?.kind)) throw new Error("这是旧版原子候选，请重新编译为完整 Wiki 页面");
    if (body.action === "reject") {
      workspace.repository.transaction(() => {
        workspace.domain.actions.reject(params.id);
        if (payload.kind === "wiki.compile") {
          workspace.db.prepare("UPDATE source_ingests SET status='rejected', candidate_id=? WHERE source_entity_id=?").run(params.id, payload.sourceId);
        }
        workspace.domain.audit("wiki.candidate_rejected", payload.sourceId || payload.entryId || candidate.targetId, {
          candidateId: params.id, kind: payload.kind, mode: payload.mode || "",
        }, new Date());
      });
      return json(res, { ok: true, rejected: true });
    }
    if (body.action !== "accept") throw new Error("处理方式只能是 accept 或 reject");
    if (payload.kind === "wiki.lint.report") throw new Error("体检报告不能直接写入 Wiki，请先生成修订候选");

    if (payload.kind === "wiki.research") {
      const result = await importResearchSources(workspace, payload, body.include);
      const now = new Date();
      workspace.repository.transaction(() => {
        workspace.domain.actions.confirm(params.id, { now });
        workspace.domain.actions.markApplied(params.id, { result, now });
        workspace.domain.audit("wiki.research_sources_imported", null, {
          candidateId: params.id, reportCandidateId: payload.reportCandidateId || "", result,
        }, now);
      });
      return json(res, { ok: true, applied: result });
    }

    const now = new Date();
    const applied = workspace.repository.transaction(() => {
      let result;
      if (["wiki.compile", "wiki.repair"].includes(payload.kind)) {
        const proposal = selectedProposal(payload, body.include);
        if (!proposal.pages?.length) throw new Error("至少保留一个页面变更");
        workspace.domain.actions.confirm(params.id, { now });
        result = applyWikiCompile(workspace, {
          proposal, candidateId: params.id,
          operation: payload.kind === "wiki.compile" ? "ingest" : "lint",
          actor: "user", now,
        });
        if (payload.kind === "wiki.compile") {
          workspace.db.prepare("UPDATE source_ingests SET status='applied', candidate_id=?, error='' WHERE source_entity_id=?").run(params.id, payload.sourceId);
        }
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
    if (body.mode !== "network") throw new Error("Wiki 只支持全库网络体检");
    const queued = workspace.jobs.enqueue({
      idempotencyKey: `wiki.lint:network:${Date.now()}`,
      kind: "wiki.lint",
      payload: { mode: "network" },
    });
    json(res, { ok: true, queued: queued.created ? 1 : 0, mode: "network", maxBatch: 1 });
  }) },

  /** 体检。孤儿和矛盾候选都是查询，不是 AI 巡检出来的。 */
  { method: "GET", path: "/api/workspace/knowledge/lint", handler: guard(async ({ workspace, res }) => {
    json(res, {
      ok: true,
      wiki: wikiHealth(workspace),
    });
  }) },
];
