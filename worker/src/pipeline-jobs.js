// 所有 cron / 手动触发统一从这里进入 Workflows。确定性实例 ID 让同一批工作在
// Workflow 保留期内只受理一次；业务写入仍用「任务标识」upsert，形成双层幂等。

import { listByStatus } from "./lib/db.js";
import { pendingVaultCount } from "./tasks/backfill.js";
import { workflowInstanceId } from "./lib/integrity.js";
import { INBOX_STATUS, TOPIC_STATUS } from "./lib/values.js";

const TRIAGE_BATCH = 3;
const SYNTH_BATCH = 20;

export async function enqueuePipelineJobs(env, kinds, { to } = {}) {
  const requested = new Set(kinds);
  const batch = [];

  if (requested.has("triage")) {
    const rows = await listByStatus(env, "inbox", INBOX_STATUS.PENDING, TRIAGE_BATCH);
    for (const row of rows) {
      batch.push({
        id: workflowInstanceId("triage", row.id, row.updated_at),
        params: { kind: "triage-page", pageId: row.id, to },
      });
    }
  }

  if (requested.has("draft")) {
    const rows = await listByStatus(env, "topics", TOPIC_STATUS.WRITING, 1);
    for (const row of rows) {
      batch.push({
        id: workflowInstanceId("draft", row.id, row.updated_at),
        params: { kind: "draft-page", topicId: row.id, to },
      });
    }
  }

  if (requested.has("backfill")) {
    // 有没有待归档的先问一句，没有就不入队——省掉一个空跑的 Workflow 实例。
    // 实例 ID 用 5 分钟时间窗做 revision：每个 cron tick 一个新实例，这样上一轮
    // 全失败（pending 数没变）时下一轮仍会重试，而同一 tick 的重复入队会被去重。
    if (await pendingVaultCount(env)) {
      batch.push({
        id: workflowInstanceId("backfill", "vault", Math.floor(Date.now() / 300_000)),
        params: { kind: "vault-backfill", to },
      });
    }
  }

  if (requested.has("synthesize")) {
    const rows = await listByStatus(env, "inbox", INBOX_STATUS.TO_CLUSTER, SYNTH_BATCH);
    if (rows.length) {
      // 指纹用 updated_at 而不是 Notion 的 last_edited_time：语义一样（内容变了就是新一批），
      // 但这个字段由我们自己在写入时维护，不受平台行为影响。
      const fingerprint = rows.map((row) => [row.id, row.updated_at]).sort();
      batch.push({
        id: workflowInstanceId("synthesize", "pending", fingerprint),
        params: { kind: "synthesize", to },
      });
    }
  }

  if (!batch.length) return { requested: 0, created: 0, instances: [] };
  const created = await env.JOBS.createBatch(batch);
  return { requested: batch.length, created: created.length, instances: created.map((item) => item.id) };
}

export async function enqueueExplicitJob(env, kind, entity, revision, params) {
  const created = await env.JOBS.createBatch([{
    id: workflowInstanceId(kind, entity, revision),
    params: { kind, ...params },
  }]);
  return { created: created.length === 1, instanceId: created[0]?.id || null };
}
