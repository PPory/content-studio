// 入口：fetch = Telegram webhook；scheduled = 三个自动任务 + 每周备份。
// 免费账户 cron 总数上限 5 个且已被其他 Worker 占 4 个，故只注册一条 */5 cron：
// 每 tick 跑任务1初筛 + 任务3成稿；恰逢 UTC 06:00（北京 14:00）的 tick 先跑任务2整理；
// 每周日 UTC 20:00（北京周一 04:00）的 tick 另外跑一次 D1 备份。

import { handleTelegramWebhook } from "./telegram.js";
import { handleLarkWebhook } from "./lark-webhook.js";
import { handleLarkCardWebhook } from "./lark-card.js";
import { handleWorkbench } from "./workbench.js";
import { enqueuePipelineJobs } from "./pipeline-jobs.js";
import { runBackup } from "./tasks/backup.js";
import { notify, target, LARK } from "./lib/notify.js";
import { isLegacyReadOnly, legacyReadOnlyAllows, legacyReadOnlyResponse } from "./lib/legacy-read-only.js";

// 长任务 Workflow（/推 /成稿 /整理 的异步执行器），wrangler 要求从入口模块导出
export { JobWorkflow } from "./jobs.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (isLegacyReadOnly(env) && !legacyReadOnlyAllows(request, url)) return legacyReadOnlyResponse();
    // 手动触发任务（补跑/调试用）：GET /run/<task>?key=<TELEGRAM_WEBHOOK_SECRET>
    const runMatch = url.pathname.match(/^\/run\/(triage|synthesize|draft|backfill|backup)$/);
    if (runMatch) {
      if (url.searchParams.get("key") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        // 备份不入队：它没有 LLM、就一个步骤，走 Workflow 只是多一层看不见的间接。
        // 而且手动触发时你要的正是**当场看到写进 vault 的哪个文件、多少行**，
        // 入队只会回一个实例 id，结果得再去 tail 里翻。
        //
        // ⚠️ 两个分支都用 `task: runMatch[1]` 而不是写死字符串。`test/creation.test.js`
        // 拿正则扫全部源码里的 task 字面量去核对 LLM 环节清单，这儿写死会被它当成
        // 一个不存在的环节名报错——连这段注释里举个例子都会被抓到（试过）。
        // 那道扫描是钝的，但它兜的是「模型设置改了没反应」这种查不出来的问题，
        // 值得让这儿绕一下。
        const result = runMatch[1] === "backup"
          ? await runBackup(env)
          : await enqueuePipelineJobs(env, [runMatch[1]]);
        return Response.json({ ok: true, task: runMatch[1], ...result });
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
    if (isLegacyReadOnly(env)) {
      console.log("legacy workspace scheduled writes skipped: migration read-only");
      return;
    }
    const t = new Date(event.scheduledTime);
    const kinds = ["triage", "draft", "backfill"];
    if (t.getUTCHours() === 6 && t.getUTCMinutes() === 0) kinds.unshift("synthesize");
    // cron 没有会话上下文，回执按 open_id 私聊机主。**不给这个 to 的话，每天 14:00
    // 整理完的选题卡片没有收件人**，卡片拍板就只在手动 /整理 时才有，等于白做。
    // 顺带成稿完成也会主动通知——你把选题改成撰写中之后，不用自己去翻好了没有。
    const to = env.LARK_OWNER_OPEN_ID ? target(LARK, env.LARK_OWNER_OPEN_ID, "open_id") : null;
    ctx.waitUntil(logErrors("enqueue", () => enqueuePipelineJobs(env, kinds, { to })));

    // 每周日 UTC 20:00 = 北京周一 04:00。挑在整理任务（UTC 06:00）之外，
    // 纯粹是不想让两件事挤在同一个 tick 里互相拖慢——它们本身并不冲突。
    if (t.getUTCDay() === 0 && t.getUTCHours() === 20 && t.getUTCMinutes() === 0) {
      ctx.waitUntil(logErrors("backup", () => weeklyBackup(env, to)));
    }
  },
};

/**
 * **备份失败必须出声。**
 *
 * 别的定时任务失败了，下一轮 cron 自己会重来，你也迟早在界面上看出来（灵感一直卡在
 * 待初筛）。备份不是——它失败的样子就是「什么都没发生」，而你要到真需要恢复的那天
 * 才会知道。这是这个 Worker 里唯一一件「静默失败等于从来没做过」的事，
 * 所以它是唯一一件失败了会主动发消息打扰你的事。
 *
 * 成功不发消息：每周一条「✅ 备份成功」的价值不如 vault 里每周多出来的那个文件——
 * 那个文件本身就是证据，而且是打开 Obsidian 就能看到的证据。
 */
async function weeklyBackup(env, to) {
  try {
    const r = await runBackup(env);
    if (r.skipped) console.log(`backup skipped: ${r.skipped}`);
    else console.log(`backup: ${r.rows} 行 / ${r.bytes} 字节 → ${r.path}`);
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 200);
    console.error("backup failed:", msg);
    await notify(env, to, `⚠️ D1 每周备份失败：${msg}\n\n手动补跑：GET /run/backup?key=…`);
  }
}

async function logErrors(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`${name} crashed:`, e.message);
  }
}
