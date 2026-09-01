import {
  compileSourceToWiki,
  lintFindingRepairability,
  lintWikiNetwork,
  proposeWikiLintRepair,
} from "../domain/wiki-pages.mjs";
import { readArticle } from "../lib/article.mjs";
import { searchWeb } from "../lib/web-search.mjs";

/**
 * 一次提炼一份来源。**队列在库里，不在内存**——工作台随时可能关掉，
 * 而一批 145 份资料要跑很久；进度必须能跨重启接着走。
 */
async function ingestOne(workspace, env, sourceId) {
  const stamp = new Date().toISOString();
  const record = (status, proposal, error = "", candidateId = null) => workspace.db.prepare(`
    INSERT INTO source_ingests(source_entity_id, status, model, candidate_id, source_content_sha256,
      entries_proposed, facts_proposed, relations_proposed, contradictions_found, rejected_ungrounded,
      pages_proposed, page_links_proposed, error, run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_entity_id) DO UPDATE SET status = excluded.status, model = excluded.model,
      candidate_id = excluded.candidate_id, source_content_sha256 = excluded.source_content_sha256,
      entries_proposed = excluded.entries_proposed, facts_proposed = excluded.facts_proposed,
      relations_proposed = excluded.relations_proposed, contradictions_found = excluded.contradictions_found,
      rejected_ungrounded = excluded.rejected_ungrounded, pages_proposed=excluded.pages_proposed,
      page_links_proposed=excluded.page_links_proposed, error = excluded.error, run_at = excluded.run_at
  `).run(sourceId, status, proposal?.model || "", candidateId, proposal?.sourceContentSha256 || "",
    0, 0, 0, 0, proposal?.rejected?.length || 0, proposal?.pages?.length || 0,
    (proposal?.pages || []).reduce((sum, page) => sum + (page.links?.length || 0), 0),
    String(error).slice(0, 2_000), stamp);

  try {
    const proposal = await compileSourceToWiki(workspace, env, { sourceId });
    if (proposal.empty) { record("empty", proposal); return { sourceId, empty: true }; }
    const candidate = workspace.domain.actions.propose({
      actionType: "wiki.pages.apply", targetId: sourceId,
      payload: { kind: "wiki.compile", sourceId, ...proposal }, proposedBy: "ai",
    });
    record("proposed", proposal, "", candidate.id);
    return { sourceId, candidateId: candidate.id, pages: proposal.pages.length };
  } catch (error) {
    record("failed", null, error.message);
    return { sourceId, error: error.message };
  }
}

async function lintOne(workspace, env, payload) {
  const mode = String(payload?.mode || "");
  if (mode !== "network") throw new Error("Wiki 只支持全库网络体检");
  const judged = await lintWikiNetwork(workspace, env);
  if (!judged.findings.length && !judged.deterministic.orphans && !judged.deterministic.missingCitations) {
    return { mode, empty: true };
  }
  const candidate = workspace.domain.actions.propose({
    actionType: "wiki.lint.review",
    targetId: null,
    payload: { kind: "wiki.lint.report", mode, ...judged },
    proposedBy: "ai",
  });
  return { mode, candidateId: candidate.id, findings: judged.findings.length };
}

async function repairLintReport(workspace, env, payload) {
  const reportCandidateId = String(payload?.reportCandidateId || "");
  const findingIndexes = [...new Set((payload?.findingIndexes || []).map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0))].slice(0, 10);
  if (!reportCandidateId || !findingIndexes.length) throw new Error("体检修订需要报告和所选问题");
  const report = workspace.domain.actions.get(reportCandidateId);
  if (!report || report.status !== "proposed" || report.payload?.kind !== "wiki.lint.report") {
    return { canceled: true, reason: "体检报告已经处理或不存在" };
  }
  const findings = findingIndexes.map((index) => report.payload.findings?.[index]).filter(Boolean);
  if (findings.length !== findingIndexes.length || findings.some((finding) => !lintFindingRepairability(finding).repairable)) {
    throw new Error("所选体检问题中包含不能直接生成修订的项目");
  }
  const proposal = await proposeWikiLintRepair(workspace, env, { findings, findingIndexes });
  if (proposal.empty) throw new Error("没有生成通过证据校验的页面修订，请缩小范围后重试");
  return workspace.repository.transaction(() => {
    const current = workspace.domain.actions.get(reportCandidateId);
    if (!current || current.status !== "proposed") return { canceled: true, reason: "体检报告已经处理" };
    const candidate = workspace.domain.actions.propose({
      actionType: "wiki.pages.apply",
      targetId: null,
      payload: { ...proposal, reportCandidateId },
      proposedBy: "ai",
    });
    const now = new Date();
    workspace.domain.audit("wiki.lint_repair_proposed", null, {
      reportCandidateId, repairCandidateId: candidate.id,
      findingIndexes, pages: proposal.pages.length,
    }, now);
    return { reportCandidateId, candidateId: candidate.id, pages: proposal.pages.length };
  });
}

async function researchLintReport(workspace, env, payload, { searchWebFn = searchWeb, readArticleFn = readArticle } = {}) {
  const reportCandidateId = String(payload?.reportCandidateId || "");
  const findingIndexes = [...new Set((payload?.findingIndexes || []).map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0))].slice(0, 5);
  if (!reportCandidateId || !findingIndexes.length) throw new Error("补充来源需要报告和所选问题");
  const report = workspace.domain.actions.get(reportCandidateId);
  if (!report || report.status !== "proposed" || report.payload?.kind !== "wiki.lint.report") {
    return { canceled: true, reason: "体检报告已经处理或不存在" };
  }
  const findings = findingIndexes.map((index) => report.payload.findings?.[index]).filter(Boolean);
  if (findings.length !== findingIndexes.length || findings.some((finding) => !lintFindingRepairability(finding).researchable)) {
    throw new Error("所选项目中包含不需要搜索补充来源的问题");
  }

  const collected = [];
  const seen = new Set();
  const failures = [];
  for (let offset = 0; offset < findings.length; offset += 1) {
    const finding = findings[offset];
    // 用户点击搜索按钮后，只发送页面名称和通用检索词；不外发 Wiki 正文、问题描述或私人笔记。
    const query = [...(finding.pages || []), finding.type === "stale" ? "最新 官方资料" : "官方资料 来源"].join(" ").slice(0, 300);
    const result = await searchWebFn(env, { query, maxResults: 4 });
    for (const source of result.sources || []) {
      if (!source?.url || seen.has(source.url) || collected.length >= 8) continue;
      seen.add(source.url);
      try {
        const article = await readArticleFn(source.url, env);
        if (!article?.markdown || article.markdown.trim().length < 80) continue;
        collected.push({
          sourceKey: `source:${collected.length}`,
          findingIndexes: [findingIndexes[offset]],
          title: article.title || source.title || source.url,
          url: article.url || source.url,
          author: article.byline || "",
          siteName: article.siteName || "",
          publishedAt: source.publishedAt || "",
          excerpt: article.markdown.replace(/\s+/g, " ").trim().slice(0, 560),
          bodyMarkdown: article.markdown.slice(0, 300_000),
          words: Number(article.words) || article.markdown.length,
          why: finding.suggestion,
        });
      } catch (error) {
        failures.push({ url: source.url, error: String(error?.message || error).slice(0, 240) });
      }
    }
  }
  if (!collected.length) throw new Error(failures.length
    ? "搜索到了结果，但正文均未能读取；请稍后重试或检查网页抓取设置"
    : "没有搜索到可供确认的新来源");
  const candidate = workspace.domain.actions.propose({
    actionType: "wiki.sources.import",
    targetId: null,
    payload: {
      kind: "wiki.research", title: "体检补充来源", reportCandidateId,
      selectedFindingIndexes: findingIndexes, selectedFindings: findings,
      sources: collected, failures,
    },
    proposedBy: "ai",
  });
  workspace.domain.audit("wiki.lint_research_proposed", null, {
    reportCandidateId, researchCandidateId: candidate.id,
    findingIndexes, sources: collected.length, unreadable: failures.length,
  }, new Date());
  return { reportCandidateId, candidateId: candidate.id, sources: collected.length, unreadable: failures.length };
}
/**
 * 旧版本曾把任务参数读错，任务耗尽重试后 `source_ingests` 仍会停在 queued。
 * 启动时只恢复「没有存活任务」的排队记录，已有 queued/retry/running 任务不重复创建。
 */
export function recoverQueuedWikiIngests(workspace, { now = new Date() } = {}) {
  const queued = workspace.db.prepare("SELECT source_entity_id AS sourceId FROM source_ingests WHERE status = 'queued'").all();
  let recovered = 0;
  for (const item of queued) {
    const live = workspace.db.prepare(`SELECT 1 FROM local_jobs
      WHERE deleted_at IS NULL AND kind = 'wiki.ingest' AND status IN ('queued', 'retry', 'running')
        AND json_extract(payload_json, '$.sourceId') = ? LIMIT 1`).get(item.sourceId);
    if (live) continue;
    const result = workspace.jobs.enqueue({
      idempotencyKey: `wiki.ingest:recovery:${item.sourceId}:${new Date(now).toISOString()}`,
      kind: "wiki.ingest",
      payload: { sourceId: item.sourceId },
      dueAt: now,
      now,
    });
    if (result.created) recovered += 1;
  }
  return recovered;
}

export function reconcileWikiIngestCandidates(workspace, { now = new Date() } = {}) {
  const result = workspace.db.prepare(`UPDATE source_ingests
    SET status='failed', candidate_id=NULL,
      error='待审阅候选已失效，请重新编译这份来源', run_at=?
    WHERE status='proposed' AND (
      candidate_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM action_candidates c
        WHERE c.id=source_ingests.candidate_id AND c.status='proposed'
          AND c.action_type='wiki.pages.apply' AND json_extract(c.payload_json, '$.kind')='wiki.compile'
      )
    )`).run(new Date(now).toISOString());
  return result.changes;
}

export function createDefaultJobHandlers(workspace, env = {}, dependencies = {}) {
  return {
    /** 提炼一份来源。payload.sourceId 指定读哪一份。 */
    "wiki.ingest": async (payload) => {
      const sourceId = String(payload?.sourceId || "");
      if (!sourceId) throw new Error("wiki.ingest 需要 sourceId");
      return ingestOne(workspace, env, sourceId);
    },

    "wiki.lint": async (payload) => lintOne(workspace, env, payload),

    "wiki.lint.repair": async (payload) => repairLintReport(workspace, env, payload),

    "wiki.lint.research": async (payload) => researchLintReport(workspace, env, payload, dependencies),

    "pipeline.dispatch": async () => {
      const captures = workspace.db.prepare(`SELECT c.id FROM captures c
        JOIN entities e ON e.id = c.id AND e.deleted_at IS NULL
        WHERE c.status IN ('pending', 'needs_review') ORDER BY e.updated_at, c.id LIMIT 100`).all();
      const projects = workspace.db.prepare(`SELECT p.id FROM projects p
        JOIN entities e ON e.id = p.id AND e.deleted_at IS NULL
        WHERE p.status = 'generating' ORDER BY e.updated_at, p.id LIMIT 100`).all();
      return {
        mode: "candidate-input-scan",
        captureIds: captures.map((item) => item.id),
        projectIds: projects.map((item) => item.id),
      };
    },
    "materials.synthesize": async () => {
      const materials = workspace.db.prepare(`SELECT m.id FROM materials m
        JOIN entities e ON e.id = m.id AND e.deleted_at IS NULL
        WHERE m.verification_status <> '待核验'
        ORDER BY e.updated_at DESC, m.id DESC LIMIT 300`).all();
      return {
        mode: "candidate-input-scan",
        materialIds: materials.map((item) => item.id),
      };
    },
  };
}
