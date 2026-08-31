import { proposeFromSource } from "../domain/wiki-ingest.mjs";

/**
 * 一次提炼一份来源。**队列在库里，不在内存**——工作台随时可能关掉，
 * 而一批 145 份资料要跑很久；进度必须能跨重启接着走。
 */
async function ingestOne(workspace, env, sourceId) {
  const stamp = new Date().toISOString();
  const record = (status, proposal, error = "") => workspace.db.prepare(`
    INSERT INTO source_ingests(source_entity_id, status, model, entries_proposed, facts_proposed,
      relations_proposed, contradictions_found, rejected_ungrounded, error, run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_entity_id) DO UPDATE SET status = excluded.status, model = excluded.model,
      entries_proposed = excluded.entries_proposed, facts_proposed = excluded.facts_proposed,
      relations_proposed = excluded.relations_proposed, contradictions_found = excluded.contradictions_found,
      rejected_ungrounded = excluded.rejected_ungrounded, error = excluded.error, run_at = excluded.run_at
  `).run(sourceId, status, proposal?.model || "", proposal?.entries?.length || 0, proposal?.facts?.length || 0,
    proposal?.relations?.length || 0, proposal?.contradictions?.length || 0, proposal?.rejected?.length || 0,
    String(error).slice(0, 2_000), stamp);

  try {
    const proposal = await proposeFromSource(workspace, env, { sourceId });
    if (proposal.empty) { record("empty", proposal); return { sourceId, empty: true }; }
    // ⚠️ 只写**提案**，不动正式词条。写入要等用户在审阅卡上确认——AGENTS.md 第 4 条。
    const candidate = workspace.domain.actions.propose({
      actionType: "entry.create", targetId: sourceId,
      payload: { kind: "wiki.ingest", sourceId, ...proposal }, proposedBy: "ai",
    });
    workspace.db.prepare("UPDATE source_ingests SET candidate_id = ? WHERE source_entity_id = ?").run(candidate.id, sourceId);
    record("proposed", proposal);
    return { sourceId, candidateId: candidate.id, entries: proposal.entries.length, facts: proposal.facts.length };
  } catch (error) {
    record("failed", null, error.message);
    return { sourceId, error: error.message };
  }
}

export function createDefaultJobHandlers(workspace, env = {}) {
  return {
    /** 提炼一份来源。payload.sourceId 指定读哪一份。 */
    "wiki.ingest": async (job) => {
      const sourceId = String(job?.payload?.sourceId || "");
      if (!sourceId) throw new Error("wiki.ingest 需要 sourceId");
      return ingestOne(workspace, env, sourceId);
    },

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
