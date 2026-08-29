// 长任务 Workflow：Telegram webhook 的 waitUntil 只有 30 秒存活期（Cloudflare 硬限制），
// LLM 生成动辄 1 分钟以上会被掐死。/推 /成稿 /整理 一律在 webhook 秒回受理，把活儿
// 丢进本 Workflow 异步执行，跑完用 Telegram 回执结果。
// 免费版可用：每步 wall time 无上限（I/O 等待不计 CPU），每天 3000 步额度。
// 重试策略：主步骤不自动重试（LLM 重跑烧 token、synthesize 部分成功后重跑会建重复选题），
// 失败直接走 Telegram 告知；只有失败通知本身允许重试一次。

import { WorkflowEntrypoint } from "cloudflare:workers";
import { notify, LARK } from "./lib/notify.js";
import { sendCard } from "./lib/lark.js";
import { topicsCard } from "./lib/lark-card-builder.js";
import { runTweetJob } from "./tasks/tweet.js";
import { runDraftForTopic, runDraftPageById, formatDraftResult } from "./tasks/draft.js";
import { runSynthesize } from "./tasks/synthesize.js";
import { runTriagePageById } from "./tasks/triage.js";
import { runVaultBackfill } from "./tasks/backfill.js";
import { isLegacyReadOnly } from "./lib/legacy-read-only.js";

const JOB_LABELS = { tweet: "/推 生成", draft: "成稿", "draft-page": "成稿", synthesize: "整理", "triage-page": "初筛", "vault-backfill": "vault 补写" };

export class JobWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    if (isLegacyReadOnly(this.env)) {
      console.log("legacy workspace workflow skipped: migration read-only");
      return;
    }
    const job = event.payload; // { kind, to: {channel, chatId}, ...参数 }
    try {
      await step.do(`job-${job.kind}`, { retries: { limit: 0, delay: "5 seconds" }, timeout: "20 minutes" }, async () => {
        await dispatch(this.env, job);
      });
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 150);
      console.error(`job ${job.kind} failed:`, msg);
      if (job.to) {
        await step.do("notify-failure", { retries: { limit: 1, delay: "5 seconds" }, timeout: "1 minute" }, async () => {
          await notify(this.env, job.to, `❌ ${JOB_LABELS[job.kind] || job.kind}失败：${msg}`);
        });
      }
    }
  }
}

async function dispatch(env, job) {
  if (job.kind === "tweet") {
    await runTweetJob(env, job);
    return;
  }
  if (job.kind === "draft") {
    // topic 是 webhook 里查好的选题行，platforms 覆盖选题自己的 platform
    const r = await runDraftForTopic(env, job.topic, job.platforms);
    await notify(env, job.to, formatDraftResult(r));
    return;
  }
  if (job.kind === "draft-page") {
    const r = await runDraftPageById(env, job.topicId);
    await notify(env, job.to, formatDraftResult(r));
    return;
  }
  if (job.kind === "triage-page") {
    await runTriagePageById(env, job.pageId);
    return;
  }
  if (job.kind === "vault-backfill") {
    await runVaultBackfill(env);
    return;
  }
  if (job.kind === "synthesize") {
    const r = await runSynthesize(env);
    if (!job.to) return;
    if (!r || !r.topics) {
      await notify(env, job.to, "整理完成：暂无足够待整理素材，未产出新选题。");
      return;
    }
    // 飞书发带按钮的卡片——点一下就开写，不用再去改状态。其余渠道退回文本。
    // 卡片是渠道能力差异，不塞进 notify：那一层的职责是「发一段文字到某个渠道」。
    if (job.to.channel === LARK && r.createdTopics?.length) {
      await sendCard(env, job.to.chatId, topicsCard(r.createdTopics), job.to.idType);
    } else {
      await notify(env, job.to, `✅ 整理完成：新建 ${r.topics} 个选题，标记 ${r.marked} 条灵感为已选题。去选题库把想写的改成「撰写中」即可成稿。`);
    }
    return;
  }
  throw new Error(`unknown job kind: ${job.kind}`);
}
