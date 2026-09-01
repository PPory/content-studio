import { compileSourceToWiki, lintWikiNetwork } from "../domain/wiki-pages.mjs";

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
export function createDefaultJobHandlers(workspace, env = {}) {
  return {
    /** 提炼一份来源。payload.sourceId 指定读哪一份。 */
    "wiki.ingest": async (payload) => {
      const sourceId = String(payload?.sourceId || "");
      if (!sourceId) throw new Error("wiki.ingest 需要 sourceId");
      return ingestOne(workspace, env, sourceId);
    },

    "wiki.lint": async (payload) => lintOne(workspace, env, payload),

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
