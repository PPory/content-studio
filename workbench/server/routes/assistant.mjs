import { fail, json, readJsonBody } from "../lib/http.mjs";
import { assistantConversation, cancelAssistantTurn, clearAssistantConversation, runAssistantTurn } from "../agent-runtime/assistant-runner.mjs";

export const assistantRoutes = [
  {
    method: "GET",
    path: "/api/assistant/conversation",
    async handler({ res, url }) {
      json(res, { ok: true, conversation: await assistantConversation(url.searchParams.get("scope") || "") });
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
      json(res, { ok: true, cancelled: await cancelAssistantTurn(body.scopeId) });
    },
  },
  {
    method: "POST",
    path: "/api/assistant/new",
    async handler({ req, res }) {
      const body = await readJsonBody(req);
      json(res, { ok: true, conversation: await clearAssistantConversation(body.scopeId) });
    },
  },
];
