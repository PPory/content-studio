import { fail, json, readJsonBody } from "../lib/http.mjs";
import { CHAT_GUARD, DEFAULT_PROMPTS, PROMPT_FIELDS, normalizePrompts, validatePrompts } from "../lib/prompts.mjs";

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

export const promptsRoutes = [
  {
    method: "GET",
    path: "/api/prompts",
    async handler({ workspace: source, res }) {
      const workspace = await ready(source);
      json(res, {
        ok: true,
        fields: PROMPT_FIELDS,
        values: normalizePrompts(workspace.repository.getSetting("prompts", DEFAULT_PROMPTS)),
        defaults: DEFAULT_PROMPTS,
        guard: CHAT_GUARD,
      });
    },
  },
  {
    method: "POST",
    path: "/api/prompts",
    async handler({ workspace: source, req, res }) {
      try {
        const body = await readJsonBody(req);
        const values = validatePrompts(body);
        (await ready(source)).repository.setSetting("prompts", values);
        json(res, { ok: true, values });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
];
