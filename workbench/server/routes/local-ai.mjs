import crypto from "node:crypto";
import { fail, json, readJsonBody } from "../lib/http.mjs";
import { assertGroundedGeneratedText } from "../domain/integrity.mjs";
import {
  cancelAssistantTurn,
  createAssistantConversation,
  runAssistantTurn,
} from "../agent-runtime/assistant-runner.mjs";
import { piRuntimeInfo } from "../agent-runtime/pi-runtime.mjs";

const clean = (value, max = 80_000) => String(value ?? "").trim().slice(0, max);

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guard(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await ready(context.workspace) }); }
    catch (error) { fail(context.res, error.message || "本地 AI 操作失败", { status: error.status || 500, hint: error.hint || "检查本机 Pi 模型配置后重试。" }); }
  };
}

function scope(prefix, value = "") {
  return `${prefix}:${crypto.createHash("sha256").update(clean(value, 2_000) || crypto.randomUUID()).digest("hex").slice(0, 24)}`;
}

function writingInstruction(body) {
  const mode = clean(body.mode, 40);
  const selected = clean(body.selected, 30_000);
  const instruction = clean(body.instruction, 2_000);
  if (selected) {
    return [
      `请只返回修订后的候选文本，不要解释，不要使用代码围栏。修订模式：${mode || "rewrite"}。`,
      instruction ? `具体要求：${instruction}` : "",
      `选区前文：\n${clean(body.before, 4_000) || "（无）"}`,
      `需要修订的原文：\n${selected}`,
      `选区后文：\n${clean(body.after, 4_000) || "（无）"}`,
    ].filter(Boolean).join("\n\n");
  }
  const task = mode === "nudge"
    ? "围绕当前光标给一个不超过 180 字、能推动作者继续思考的问题或下一步，不要代写整篇。"
    : mode === "finish"
      ? "沿着已有正文完成后续候选，只返回可插入正文的文本。"
      : "围绕当前光标续写一个紧凑段落，只返回可插入正文的候选文本。";
  return [
    task,
    instruction ? `具体要求：${instruction}` : "",
    body.expert ? `本轮专家约束：\n${clean(body.expert, 6_000)}` : "",
    body.style ? `写作风格：\n${clean(body.style, 6_000)}` : "",
    body.materials ? `已采用素材摘要：\n${clean(body.materials, 12_000)}` : "",
  ].filter(Boolean).join("\n\n");
}

async function localWriting(env, body) {
  const selected = clean(body.selected, 30_000);
  const content = selected || clean(body.content, 80_000);
  const result = await runAssistantTurn(env, {
    scopeId: scope("inline-writing"),
    startNew: true,
    message: writingInstruction(body),
    document: {
      title: clean(body.title, 300),
      body: content,
      platform: clean(body.platform, 80),
      selection: selected ? { text: selected } : null,
    },
    materials: [],
    permissionMode: "daily",
  });
  const text = clean(result.message?.text, 40_000);
  if (!text) throw new Error("Pi 已结束，但没有返回可显示的候选");
  const evidenceText = selected
    ? [body.before, selected, body.after].filter(Boolean).join("\n\n")
    : clean(body.content, 80_000);
  assertGroundedGeneratedText(text, evidenceText ? [{ type: "个人经历", content: evidenceText }] : []);
  return { text, mode: clean(body.mode, 40), kind: selected ? "局部修订" : clean(body.mode, 40) === "nudge" ? "下一步" : "续写一段", grounding: { used: [], skipped: [] } };
}

function explainMessage(body) {
  const mode = clean(body.mode, 80) || "解释";
  const selection = clean(body.selection, 20_000);
  return [
    `任务：${mode}。直接回答，不要声称已修改或保存任何内容。`,
    body.title ? `文档标题：${clean(body.title, 300)}` : "",
    `选中内容：\n${selection}`,
    body.context ? `上下文：\n${clean(body.context, 20_000)}` : "",
  ].filter(Boolean).join("\n\n");
}

function extensionChatMessage(body) {
  return [
    clean(body.message, 8_000),
    body.docTitle ? `当前网页：${clean(body.docTitle, 300)}` : "",
    body.selection ? `网页选区：\n${clean(body.selection, 8_000)}` : "",
    body.pageContext ? `网页上下文：\n${clean(body.pageContext, 20_000)}` : "",
    body.sourceUrl ? `来源：${clean(body.sourceUrl, 2_000)}` : "",
  ].filter(Boolean).join("\n\n");
}

function guidedMessage(body) {
  const workflow = body.workflow === "interview" ? "interview" : body.workflow === "brainstorm" ? "brainstorm" : "general";
  const prefix = workflow === "interview"
    ? [!body.sessionId ? "/interview-to-draft" : "", "每轮只问一个问题；共识确认前不生成完整成稿。"]
    : workflow === "brainstorm"
      ? [!body.sessionId ? "/idea-dialogue" : "", "只整理用户已说出的判断和经历，每轮只推进一个问题，不代写完整文章。"]
      : ["直接回答问题；只读取当前本地工作区和用户明确授权的资料，不修改任何内容。"];
  return [
    ...prefix,
    body.draftTitle || body.docTitle ? `当前内容：${clean(body.draftTitle || body.docTitle, 300)}` : "",
    body.platform ? `平台：${clean(body.platform, 80)}` : "",
    body.audience ? `读者：${clean(body.audience, 300)}` : "",
    body.selection ? `选中内容：\n${clean(body.selection, 8_000)}` : "",
    body.pageContext ? `上下文：\n${clean(body.pageContext, 20_000)}` : "",
    `本轮输入：\n${clean(body.message, 8_000)}`,
  ].filter(Boolean).join("\n\n");
}
async function plainTextAssistant({ env, res, input }) {
  const runtime = await piRuntimeInfo(env);
  if (!runtime.configured) return json(res, { ok: false, error: "本地 Pi 模型尚未配置", hint: "在设置中完成模型配置后重试。" }, 503);
  const scopeId = input.scopeId;
  const supplied = /^chat-[a-z0-9]+$/i.test(clean(input.conversationId, 100)) ? clean(input.conversationId, 100) : "";
  const conversationId = supplied || (await createAssistantConversation(scopeId, { permissionMode: "daily" })).id;
  let streamed = "";
  let finished = false;
  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-session-id": conversationId,
  });
  const cancel = () => { if (!finished) cancelAssistantTurn(scopeId, conversationId).catch(() => {}); };
  res.once("close", cancel);
  try {
    const result = await runAssistantTurn(env, { ...input, conversationId, startNew: false, permissionMode: "daily" }, {
      onEvent(event) {
        if (event.type === "text" && event.text && !res.destroyed) {
          streamed += event.text;
          res.write(event.text);
        }
      },
    });
    const finalText = clean(result.message?.text, 40_000);
    if (!streamed && finalText && !res.destroyed) res.write(finalText);
  } catch (error) {
    if (!res.destroyed) res.write(`\n\n本地 AI 调用失败：${clean(error.message, 800)}`);
  } finally {
    finished = true;
    res.off("close", cancel);
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}

export const localAiRoutes = [
  { method: "POST", path: "/api/agent/chat", handler: guard(async ({ env, req, res }) => { const body=await readJsonBody(req); if(!clean(body.message,8_000)) throw Object.assign(new Error("message 不能为空"),{status:400}); const workflow=body.workflow==="interview"?"interview":body.workflow==="brainstorm"?"brainstorm":"general"; const scopeId=scope(`guided-${workflow}`,body.docPath||body.draftTitle||body.docTitle||"global"); await plainTextAssistant({env,res,input:{scopeId,conversationId:body.sessionId,message:guidedMessage(body),document:{id:clean(body.documentId,180),title:clean(body.draftTitle||body.docTitle,300),body:clean(body.pageContext,20_000),platform:clean(body.platform,80),audience:clean(body.audience,300),selection:body.selection?{text:clean(body.selection,8_000)}:null},materials:[]}}); }) },
  { method: "POST", path: "/api/pipe/writing-assist", handler: guard(async ({ env, req, res }) => { const body=await readJsonBody(req); json(res,{ok:true,...await localWriting(env,body)}); }) },
  { method: "POST", path: "/api/pipe/text-revision", handler: guard(async ({ env, req, res }) => { const body=await readJsonBody(req); if(!clean(body.selected)) throw new Error("请先选择需要修订的文字"); json(res,{ok:true,...await localWriting(env,body)}); }) },
  { method: "POST", path: "/api/ai/explain", handler: guard(async ({ env, req, res }) => { const body=await readJsonBody(req); await plainTextAssistant({env,res,input:{scopeId:scope("selection",`${body.title}:${body.selection}`),message:explainMessage(body),document:{title:clean(body.title,300),body:clean(body.context,20_000),selection:{text:clean(body.selection,20_000)}},materials:[]}}); }) },
  { method: "POST", path: "/api/extension/local-ask", handler: guard(async ({ env, req, res }) => { const body=await readJsonBody(req); await plainTextAssistant({env,res,input:{scopeId:scope("extension-ask",`${body.title}:${body.mode}`),message:explainMessage(body),document:{title:clean(body.title,300),body:clean(body.context,20_000),selection:{text:clean(body.selection,20_000)}},materials:[]}}); }) },
  { method: "POST", path: "/api/extension/local-chat", handler: guard(async ({ env, req, res }) => { const body=await readJsonBody(req); const scopeId=scope("extension-chat",body.sourceUrl||body.docTitle); await plainTextAssistant({env,res,input:{scopeId,conversationId:body.sessionId,message:extensionChatMessage(body),document:{title:clean(body.docTitle,300),body:clean(body.pageContext,20_000),selection:{text:clean(body.selection,20_000)}},materials:[]}}); }) },
];
