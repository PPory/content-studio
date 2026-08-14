// /api/ai/* → 划词 AI。整条链路全程流式：LLM → Worker → 本地服务 → 浏览器。
//
// 中间任何一环攒完再发，用户就会对着空白等十几秒。所以这里**不能**用 res.json()，
// 必须把 Worker 的响应体一块一块 pipe 出去。

import { Readable } from "node:stream";
import { json, readJsonBody } from "../lib/http.mjs";
import { callWorkerRaw } from "../lib/worker.mjs";

export const aiRoutes = [
  {
    method: "POST",
    path: "/api/ai/explain",
    async handler({ env, req, res }) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return json(res, { ok: false, error: e.message }, 400);
      }

      // LLM 生成比 Notion 查询慢，给 120 秒；流式下只要持续有字节到达就不会超时
      const { res: workerRes, configError, done } = await callWorkerRaw(env, "explain", {
        method: "POST",
        body,
        timeoutMs: 120_000,
      });
      if (configError) return json(res, configError, 503);

      try {
        // Worker 出错时回的是 JSON（不是流），原样透传，前端按同一套错误契约显示
        const type = workerRes.headers.get("content-type") || "";
        if (!workerRes.ok || type.includes("application/json")) {
          const text = await workerRes.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = { ok: false, error: `AI 返回了非预期内容（HTTP ${workerRes.status}）：${text.slice(0, 200)}` };
          }
          if (!data.hint && /LLM \d+/.test(data.error || "")) {
            data.hint = "LLM 代理不可用。检查 content-pipeline 的 LLM_BASE_URL 是否还有效";
          }
          return json(res, data, workerRes.status === 200 ? 502 : workerRes.status);
        }

        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-cache, no-transform",
        });
        await new Promise((resolve, reject) => {
          const nodeStream = Readable.fromWeb(workerRes.body);
          nodeStream.on("error", reject);
          res.on("close", () => nodeStream.destroy()); // 用户中途关掉面板就别再拉了
          nodeStream.pipe(res).on("finish", resolve).on("error", reject);
        });
      } finally {
        done?.();
      }
    },
  },
];
