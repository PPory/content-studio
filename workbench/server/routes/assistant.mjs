import { fail, json, readJsonBody, readRawBody } from "../lib/http.mjs";
import {
  assistantConversation,
  assistantConversations,
  assistantModels,
  cancelAssistantTurn,
  createAssistantConversation,
  runAssistantTurn,
  saveAssistantAttachment,
} from "../agent-runtime/assistant-runner.mjs";

export const assistantRoutes = [
  {
    method: "GET",
    path: "/api/assistant/conversation",
    async handler({ res, url }) {
      json(res, { ok: true, conversation: await assistantConversation(url.searchParams.get("scope") || "", url.searchParams.get("conversationId") || "") });
    },
  },
  {
    method: "GET",
    path: "/api/assistant/conversations",
    async handler({ res, url }) {
      json(res, { ok: true, conversations: await assistantConversations(url.searchParams.get("scope") || "") });
    },
  },
  {
    method: "GET",
    path: "/api/assistant/models",
    async handler({ env, res }) {
      json(res, { ok: true, models: await assistantModels(env) });
    },
  },
  {
    method: "POST",
    path: "/api/assistant/chat",
    async handler({ env, req, res }) {
      try {
        const result = await runAssistantTurn(env, await readJsonBody(req));
        json(res, { ok: true, ...result });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint || "检查 Harness 模型配置后重试；正文和已保存内容不受影响。" });
      }
    },
  },
  {
    method: "POST",
    path: "/api/assistant/cancel",
    async handler({ req, res }) {
      const body = await readJsonBody(req);
      json(res, { ok: true, cancelled: await cancelAssistantTurn(body.scopeId, body.conversationId) });
    },
  },
  {
    method: "POST",
    path: "/api/assistant/new",
    async handler({ req, res }) {
      const body = await readJsonBody(req);
      json(res, { ok: true, conversation: await createAssistantConversation(body.scopeId, { model: body.model }) });
    },
  },
  {
    method: "POST",
    path: "/api/assistant/attachment",
    async handler({ req, res, url }) {
      try {
        const result = await saveAssistantAttachment(
          url.searchParams.get("scope") || "",
          url.searchParams.get("conversationId") || "",
          url.searchParams.get("filename") || "附件.txt",
          await readRawBody(req, 20_000_000),
        );
        json(res, { ok: true, ...result });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
];
