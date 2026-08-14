// 入口：fetch = Telegram webhook；scheduled = 三个自动任务。
// 免费账户 cron 总数上限 5 个且已被其他 Worker 占 4 个，故只注册一条 */5 cron：
// 每 tick 跑任务1初筛 + 任务3成稿；恰逢 UTC 06:00（北京 14:00）的 tick 先跑任务2整理。

import { handleTelegramWebhook } from "./telegram.js";
import { handleLarkWebhook } from "./lark-webhook.js";
import { handleLarkCardWebhook } from "./lark-card.js";
import { handleWorkbench } from "./workbench.js";
import { enqueuePipelineJobs } from "./pipeline-jobs.js";
import { target, LARK } from "./lib/notify.js";

// 长任务 Workflow（/推 /成稿 /整理 的异步执行器），wrangler 要求从入口模块导出
export { JobWorkflow } from "./jobs.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 手动触发任务（补跑/调试用）：GET /run/<task>?key=<TELEGRAM_WEBHOOK_SECRET>
    const runMatch = url.pathname.match(/^\/run\/(triage|synthesize|draft|backfill)$/);
    if (runMatch) {
      if (url.searchParams.get("key") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        const queued = await enqueuePipelineJobs(env, [runMatch[1]]);
        return Response.json({ ok: true, task: runMatch[1], ...queued });
      } catch (e) {
        return new Response(`${runMatch[1]} failed: ${e.message}`, { status: 500 });
      }
    }
    // creator-workbench 端点。必须排在下面那条 POST 兜底之前，否则 POST /wb/intake
    // 会被当成 Telegram webhook（校验 secret 失败，直接 403）。
    if (url.pathname.startsWith("/wb/")) return handleWorkbench(request, env, ctx, url);

    // 飞书事件订阅。必须排在下面那条 POST 兜底之前，否则会被当成 Telegram webhook
    // 直接 403——和 /wb/* 当初踩的是同一个坑。
    if (url.pathname === "/lark") return await handleLarkWebhook(request, env, ctx);
    // 卡片按钮点击。和事件订阅是两条链路，飞书后台也分开配。
    if (url.pathname === "/lark-card") return await handleLarkCardWebhook(request, env, ctx);

    if (request.method === "POST") return handleTelegramWebhook(request, env, ctx);
    return new Response("content-pipeline is running");
  },

  async scheduled(event, env, ctx) {
    const t = new Date(event.scheduledTime);
    const kinds = ["triage", "draft", "backfill"];
    if (t.getUTCHours() === 6 && t.getUTCMinutes() === 0) kinds.unshift("synthesize");
    // cron 没有会话上下文，回执按 open_id 私聊机主。**不给这个 to 的话，每天 14:00
    // 整理完的选题卡片没有收件人**，卡片拍板就只在手动 /整理 时才有，等于白做。
    // 顺带成稿完成也会主动通知——你把选题改成撰写中之后，不用自己去翻好了没有。
    const to = env.LARK_OWNER_OPEN_ID ? target(LARK, env.LARK_OWNER_OPEN_ID, "open_id") : null;
    ctx.waitUntil(logErrors("enqueue", () => enqueuePipelineJobs(env, kinds, { to })));
  },
};

async function logErrors(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`${name} crashed:`, e.message);
  }
}
