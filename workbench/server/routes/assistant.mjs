import { fail, json, readJsonBody, readRawBody } from "../lib/http.mjs";
import {
  assistantConversation,
  assistantConversations,
  assistantExperts,
  assistantModelCatalog,
  assistantSkills,
  cancelAssistantTurn,
  createAssistantConversation,
  applyAssistantAction,
  rewindAssistantConversation,
  runAssistantTurn,
  saveAssistantAttachment,
  updateAssistantConversationModel,
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
      json(res, { ok: true, models: await assistantModelCatalog(env) });
    },
  },
  {
    method: "GET",
    path: "/api/assistant/skills",
    async handler({ res }) {
      json(res, { ok: true, skills: await assistantSkills() });
    },
  },
  {
    method: "GET",
    path: "/api/assistant/experts",
    async handler({ res }) {
      json(res, { ok: true, experts: assistantExperts() });
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
    path: "/api/assistant/chat/stream",
    async handler({ env, req, res }) {
      const send = (event) => {
        if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
      };
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      });
      try {
        const result = await runAssistantTurn(env, await readJsonBody(req), { onEvent: send });
        send({ type: "done", result });
      } catch (error) {
        send({ type: "error", error: error.message, hint: error.hint || "检查 Harness 模型配置后重试；正文和已保存内容不受影响。" });
      } finally {
        if (!res.destroyed && !res.writableEnded) res.end();
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
    path: "/api/assistant/model",
    async handler({ env, req, res }) {
      try {
        const body = await readJsonBody(req);
        const catalog = await assistantModelCatalog(env);
        if (!catalog.items.some((item) => item.id === body.model)) {
          return fail(res, "这个模型不在当前接口返回的可用列表中", { status: 400, hint: "重新展开模型菜单并选择其中一项。" });
        }
        json(res, { ok: true, conversation: await updateAssistantConversationModel(body.scopeId, body.conversationId, body.model) });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
  {
    method: "POST",
    path: "/api/assistant/rewind",
    async handler({ req, res }) {
      try {
        const body = await readJsonBody(req);
        json(res, { ok: true, ...(await rewindAssistantConversation(body.scopeId, body.conversationId)) });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
  {
    method: "POST",
    path: "/api/assistant/action",
    async handler({ env, req, res }) {
      try {
        const body = await readJsonBody(req);
        json(res, { ok: true, ...(await applyAssistantAction(env, body.scopeId, body.conversationId, body.actionId)) });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
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
