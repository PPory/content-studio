import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { closeResidentHarness, createHarnessRun } from "./harness-adapter.mjs";

const ROOT = path.resolve(process.cwd(), ".xenho", "guided");
const clean = (value, max = 40_000) => String(value || "").trim().slice(0, max);

export function guidedSessionId(value = "") {
  const id = clean(value, 80);
  return /^[0-9a-f-]{16,64}$/i.test(id) ? id : crypto.randomUUID();
}

const residentKey = (workflow, sessionId, model) => `guided:${workflow}:${sessionId}:${clean(model, 240)}`;

function notificationText(notification, emit) {
  if (notification?.method !== "session.event") return;
  const event = notification.params?.event;
  const chunk = event?.data?.chunk;
  if (event?.type === "assistant/chunk" && chunk?.type === "text-delta" && chunk.text) emit(chunk.text);
  if (event?.type === "text-chunks") for (const text of event.data?.texts || []) if (text) emit(text);
}

export async function runGuidedTurn(env, { workflow, sessionId, prompt, model, context = {}, onText, onHarness }) {
  const id = guidedSessionId(sessionId);
  const runDir = path.join(ROOT, workflow, id);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "context.json"), JSON.stringify({ ...context, workflow, sessionId: id }, null, 2), "utf8");
  let streamed = "";
  const result = await createHarnessRun({
    env,
    runDir,
    kind: `guided-${workflow}`,
    prompt,
    persona: workflow === "interview"
      ? "你是 Xenho OS 的访谈起稿助手。严格使用 interview-to-draft Skill：一轮只问一个问题，只记录用户真实提供的事实；共识确认前不写完整文章。"
      : "你是 Xenho OS 的想法梳理助手。严格使用 idea-dialogue Skill：一次只推进一个问题，先挖出用户自己的判断与经历，不抢着代写成稿。",
    sessionRoot: path.join(runDir, "sessions"),
    sessionId: `guided-${workflow}-${id}`,
    maxTokens: 4096,
    model,
    residentKey: residentKey(workflow, id, model || env.HARNESS_LLM_MODEL),
    onHarness,
    onNotification(notification) {
      notificationText(notification, (text) => {
        streamed += text;
        onText?.(text);
      });
    },
  });
  const finalText = clean(result.result.finalResponse, 80_000);
  if (!streamed && finalText) onText?.(finalText);
  if (!finalText) throw new Error("Harness 已结束，但没有返回可显示的内容");
  return { sessionId: id, text: finalText };
}

export async function cancelGuidedTurn(workflow, sessionId, model = "") {
  return closeResidentHarness(residentKey(workflow, guidedSessionId(sessionId), model));
}
