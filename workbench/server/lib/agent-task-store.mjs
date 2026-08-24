import { callWorker } from "./worker.mjs";

function unavailable(result) {
  const message = String(result?.data?.error || "");
  return result?.status === 503 || result?.status === 404 || /agent_tasks|unknown endpoint|还没有.*表/i.test(message);
}

async function write(env, path, body) {
  if (!env) return { available: false };
  const result = await callWorker(env, path, { method: "POST", body });
  if (unavailable(result)) return { available: false, reason: result.data?.error || "D1 任务表不可用" };
  if (result.status >= 400 || !result.data?.ok) throw Object.assign(new Error(result.data?.error || "D1 任务状态写入失败"), { hint: result.data?.hint });
  return { available: true, ...result.data };
}

export const claimDurableTask = (env, body) => write(env, "agent-tasks/claim", body);
export const heartbeatDurableTask = (env, id, body) => write(env, `agent-tasks/${encodeURIComponent(id)}/heartbeat`, body);
export const finishDurableTask = (env, id, body) => write(env, `agent-tasks/${encodeURIComponent(id)}/finish`, body);
