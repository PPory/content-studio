import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { claimAgentTask, finishAgentTask, heartbeatAgentTask } from "../src/lib/agent-tasks.js";

const migrations = [
  readFileSync(new URL("../migrations/0006_agent_tasks_v1.sql", import.meta.url), "utf8"),
  readFileSync(new URL("../migrations/0007_agent_tasks_pi_session.sql", import.meta.url), "utf8"),
].join("\n");

function envWithDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migrations);
  const wrap = (prepared) => ({
    bind(...params) {
      const bound = prepared;
      return {
        async first() { const row = bound.get(...params); return row ? { ...row } : null; },
        async run() { const result = bound.run(...params); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
    },
  });
  return { sqlite, env: { DB: { prepare(sql) { return wrap(sqlite.prepare(sql)); } } } };
}

const claim = (overrides = {}) => ({
  id: "expert-task-000000000001", idempotencyKey: "quality:scope:v1", kind: "quality-review",
  scopeId: "scope-1", documentVersion: "v1-10-abcd", leaseOwner: "worker-a", piSessionId: "pi-session-1",
  ...overrides,
});

test("同一幂等键只有一个持有者能领取任务", async () => {
  const { sqlite, env } = envWithDb();
  const first = await claimAgentTask(env, claim());
  assert.equal(first.claimed, true);
  assert.equal(first.task.attempt, 1);
  assert.equal(first.task.piSessionId, "pi-session-1");


  const duplicate = await claimAgentTask(env, claim({ id: "expert-task-000000000002", leaseOwner: "worker-b" }));
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.task.id, first.task.id);
  assert.equal(duplicate.task.leaseOwner, "worker-a");
  sqlite.close();
});

test("心跳续租且终态保存结构化报告", async () => {
  const { sqlite, env } = envWithDb();
  const started = await claimAgentTask(env, claim());
  const beat = await heartbeatAgentTask(env, started.task.id, { leaseOwner: "worker-a", stage: "tool-use", stageLabel: "核查来源", percent: 62 });
  assert.equal(beat.stage, "tool-use");
  assert.equal(beat.percent, 62);
  const done = await finishAgentTask(env, started.task.id, { leaseOwner: "worker-a", status: "done", stageLabel: "检查完成", result: { kind: "quality-review", summary: "ok" } });
  assert.equal(done.status, "done");
  assert.deepEqual(done.result, { kind: "quality-review", summary: "ok" });
  const duplicate = await claimAgentTask(env, claim({ leaseOwner: "worker-b" }));
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.task.status, "done");
  sqlite.close();
});
