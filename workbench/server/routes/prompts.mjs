// /api/prompts/* → 两类提示词，**分开两组端点，因为它们生效的方式不同**。
//
//   /api/prompts             工作台自己的（config/prompts.json）。改完立刻生效。
//   /api/prompts/pipeline    content-pipeline 的 prompt/*.md。**改完要 npx wrangler deploy。**
//
// 合成一组端点的话，前端就得靠一个 `kind` 字段去分辨「这次保存要不要提醒部署」，
// 而漏掉那个提醒的后果是：用户改完 Worker 的提示词、看到「已保存」、以为生效了，
// 而 Worker 照旧按老提示词跑——不报错，界面上也看不出来。

import { json, fail, readJsonBody } from "../lib/http.mjs";
import { CHAT_GUARD, DEFAULT_PROMPTS, PROMPT_FIELDS, loadPrompts, savePrompts } from "../lib/prompts.mjs";
import { DEPLOY_CMD, listPipelinePrompts, readPipelinePrompt, writePipelinePrompt } from "../lib/pipeline-prompts.mjs";

export const promptsRoutes = [
  {
    method: "GET",
    path: "/api/prompts",
    async handler({ res }) {
      json(res, {
        ok: true,
        fields: PROMPT_FIELDS,
        values: await loadPrompts(),
        defaults: DEFAULT_PROMPTS,
        // 安全约束**明着回给前端**，界面上只读展示。藏起来的话用户会以为
        // 自己改的那段就是全部，而实际发出去的比他看到的多一段。
        guard: CHAT_GUARD,
      });
    },
  },

  {
    method: "POST",
    path: "/api/prompts",
    async handler({ req, res }) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return fail(res, e.message, { status: 400 });
      }
      try {
        json(res, { ok: true, values: await savePrompts(body) });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },

  {
    method: "GET",
    path: "/api/prompts/pipeline",
    async handler({ env, res }) {
      const { root, exists, items } = await listPipelinePrompts(env);
      // 找不到目录**不是错**：没 clone content-pipeline 的人一样能用工作台的其余部分
      json(res, {
        ok: true,
        root,
        exists,
        items,
        deployCmd: DEPLOY_CMD,
        ...(exists
          ? {}
          : { hint: "把 content-pipeline clone 到工作台的同级目录，或者在「本机路径」里填 content-pipeline 目录" }),
      });
    },
  },

  {
    method: "GET",
    path: "/api/prompts/pipeline/:id",
    async handler({ env, res, params }) {
      try {
        json(res, { ok: true, ...(await readPipelinePrompt(env, params.id)) });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },

  {
    method: "POST",
    path: "/api/prompts/pipeline/:id",
    async handler({ env, req, res, params }) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return fail(res, e.message, { status: 400 });
      }
      try {
        const saved = await writePipelinePrompt(env, params.id, body?.text, body?.stamp);
        // **回执里带上部署命令**，别让界面自己拼一份第二真源
        json(res, { ok: true, ...saved, deployCmd: DEPLOY_CMD, needsDeploy: true });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
];
