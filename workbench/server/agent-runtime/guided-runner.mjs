import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createPiRun } from "./pi-runtime.mjs";
import { DEFAULT_PERMISSION_MODE, normalizePermissionMode } from "./permission-modes.mjs";

const ROOT = path.resolve(process.cwd(), ".xenho", "guided");
const active = new Map();
const clean = (value, max = 40_000) => String(value || "").trim().slice(0, max);

export function guidedSessionId(value = "") {
  const id = clean(value, 80);
  return /^[0-9a-f-]{16,64}$/i.test(id) ? id : crypto.randomUUID();
}

const activeKey = (workflow, sessionId) => `${workflow}:${sessionId}`;

async function readPiSession(runDir) {
  try {
    const item = JSON.parse(await fs.readFile(path.join(runDir, "pi-session.json"), "utf8"));
    return { piSessionId: clean(item.piSessionId, 160), piSessionFile: clean(item.piSessionFile, 2_000), permissionMode: normalizePermissionMode(item.permissionMode) };
  } catch {
    return { piSessionId: crypto.randomUUID(), piSessionFile: "", permissionMode: DEFAULT_PERMISSION_MODE };
  }
}

export async function runGuidedTurn(env, { workflow, sessionId, prompt, model, mode = DEFAULT_PERMISSION_MODE, context = {}, onText, onSession }) {
  const id = guidedSessionId(sessionId);
  const key = activeKey(workflow, id);
  if (active.has(key)) throw Object.assign(new Error("当前回复完成后才能切换权限模式或再次发送"), { status: 409 });
  const requestedMode = normalizePermissionMode(mode);
  const runDir = path.join(ROOT, workflow, id);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "context.json"), JSON.stringify({ ...context, workflow, sessionId: id }, null, 2), "utf8");
  const saved = await readPiSession(runDir);
  const prior = saved.permissionMode === requestedMode ? saved : { piSessionId: crypto.randomUUID(), piSessionFile: "", permissionMode: requestedMode };
  let session;
  let streamed = "";
  try {
    const result = await createPiRun({
      env,
      runDir,
      kind: `guided-${workflow}`,
      prompt,
      persona: workflow === "interview"
        ? "你是 Xenho OS 的访谈起稿助手。严格使用 interview-to-draft Skill：一轮只问一个问题，只记录用户真实提供的事实；共识确认前不写完整文章。"
        : workflow === "brainstorm"
          ? "你是 Xenho OS 的想法梳理助手。严格使用 idea-dialogue Skill：一次只推进一个问题，先挖出用户自己的判断与经历，不抢着代写成稿。"
          : "你是 Xenho OS 的通用阅读与研究助手。直接回答问题，只读取用户明确提供或服务端允许的资料，不修改文件。",
      sessionRoot: path.join(runDir, "pi-sessions"),
      sessionId: prior.piSessionId,
      sessionFile: prior.piSessionFile,
      model,
      mode: requestedMode,
      context,
      onSession(instance, meta) {
        session = instance;
        active.set(key, instance);
        onSession?.(instance, meta);
      },
      onEvent(event) {
        if (event.type === "text" && event.text) {
          streamed += event.text;
          onText?.(event.text);
        }
      },
    });
    await fs.writeFile(path.join(runDir, "pi-session.json"), JSON.stringify({ piSessionId: result.piSessionId, piSessionFile: result.piSessionFile, permissionMode: requestedMode }, null, 2), "utf8");
    const finalText = clean(result.result.finalResponse, 80_000);
    if (!streamed && finalText) onText?.(finalText);
    return { sessionId: id, piSessionId: result.piSessionId, text: finalText };
  } finally {
    active.delete(key);
    session?.dispose();
  }
}

export async function cancelGuidedTurn(workflow, sessionId) {
  const session = active.get(activeKey(workflow, guidedSessionId(sessionId)));
  if (!session) return false;
  await session.abort().catch(() => {});
  return true;
}
