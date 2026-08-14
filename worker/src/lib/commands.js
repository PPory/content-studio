// Bot 命令的**唯一实现**。Telegram 和飞书两个入口都调这里。
//
// 红线，和 lib/store.js 那条一样：**不要在任何一个入口里另抄一份命令逻辑**。
// 抄了之后改一处、另一处还按旧规则跑，而且不报错——用户在飞书上用到的是半年前的
// 行为，你在 Telegram 上测得好好的，谁也发现不了。
//
// 入口只负责三件事：解析出纯文本、确认发信人是机主、给一个 target 说明回执发哪儿。
// 其余全在这里。

import { notify } from "./notify.js";
import { autoTag } from "./tagging.js";
import { pipelineCounts, formatCounts } from "./status.js";
import {
  storeTypedMaterial, storeAutoMaterial, storeInboxEntry,
  resolveStoreCmd, isVerbatimCmd, archiveMaterialToVault,
} from "./store.js";
import { findTopicByKeyword, normalizePlatform } from "../tasks/draft.js";
import { TWEET_USAGE, detectTweetMode } from "../tasks/tweet.js";
import { enqueueExplicitJob, enqueuePipelineJobs } from "../pipeline-jobs.js";

/** 非命令消息：进灵感库，等任务1 初筛。 */
export async function captureInbox(env, to, text, source) {
  try {
    const entry = await storeInboxEntry(env, text, { source });
    await notify(env, to, `✅ 已存入待初筛：${entry.title.slice(0, 80)}`);
  } catch (e) {
    console.error("inbox write failed:", e.message);
    await notify(env, to, `❌ 入库失败：${e.message.slice(0, 150)}`);
  }
}

/**
 * 命令路由。
 *
 * 长任务（/推 /成稿 /整理）只做参数校验 + 受理回执，**执行一律入队 JobWorkflow**——
 * 含 LLM 生成的命令要跑一到几分钟，而 webhook 的 waitUntil 只有 30 秒存活期
 * （Cloudflare 硬限制，实测被掐）。
 *
 * @param dedupeKey 同一条用户消息的稳定标识，用来做 Workflow 实例去重。
 *   Telegram 传 update_id，飞书传 event_id——飞书会重推事件，这个尤其重要。
 */
export async function runCommand(env, to, text, dedupeKey) {
  const body = text.slice(1).trim();
  const head = body.split(/\s+/)[0];
  const cmd = head.toLowerCase();
  const argStr = body.slice(head.length).trim();

  if (cmd === "整理" || cmd === "synthesize") {
    const queued = await enqueuePipelineJobs(env, ["synthesize"], { to });
    await notify(env, to, queued.created
      ? "⏳ 已受理，整理中…（完成后回你结果）"
      : "这批待整理灵感已在处理，或当前没有待整理内容。");
    return;
  }

  if (cmd === "状态" || cmd === "status") {
    await notify(env, to, formatCounts(await pipelineCounts(env)));
    return;
  }

  if (cmd === "成稿" || cmd === "draft") {
    // 用法：/成稿 <选题关键词> <平台列表>（平台列表为最后一段，逗号/顿号分隔）
    const parts = argStr.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      await notify(env, to, "用法：/成稿 <选题关键词> <平台列表>\n例：/成稿 写作复利 公众号\n可选平台：公众号 / X / 小红书 / 视频号 / YouTube");
      return;
    }
    const platforms = parts[parts.length - 1].split(/[,，、]/).map(normalizePlatform).filter(Boolean);
    const keyword = parts.slice(0, -1).join(" ");
    if (!platforms.length) {
      await notify(env, to, "没识别出平台。可选：公众号 / X / 小红书 / 视频号 / YouTube");
      return;
    }
    const topic = await findTopicByKeyword(env, keyword);
    if (!topic) {
      await notify(env, to, `选题库里没找到匹配「${keyword}」的选题。`);
      return;
    }
    const queued = await enqueueExplicitJob(
      env, "draft", topic.id, [topic.updated_at, [...platforms].sort()],
      { to, topic, platforms }
    );
    await notify(env, to, queued.created
      ? `⏳ 已受理，正在为「${topic.title}」成稿：${platforms[0]}…（可能需要几分钟，完成后回你）`
      : `「${topic.title}」同一版本的成稿任务已在处理。`);
    return;
  }

  if (cmd === "推" || cmd === "tweet") {
    if (!argStr.trim()) {
      await notify(env, to, TWEET_USAGE);
      return;
    }
    const mode = detectTweetMode(argStr);
    const queued = await enqueueExplicitJob(env, "tweet", to.chatId, dedupeKey ?? argStr, { to, argStr });
    await notify(env, to, queued.created
      ? `⏳ ${mode}模式已受理，生成中…（约 1-2 分钟，完成后回你）`
      : "这条 /推 请求已在处理，请勿重复发送。");
    return;
  }

  // 存素材类：/金句 /概念 /案例 /数据 /框架 /经历（或英文别名）直存指定类型
  const storeCmd = resolveStoreCmd(cmd);
  if (storeCmd) {
    await storeTyped(env, to, storeCmd, argStr);
    return;
  }
  if (cmd === "素材" || cmd === "material") {
    await storeAuto(env, to, argStr);
    return;
  }

  await notify(env, to, HELP_TEXT);
}

// ---- 存素材类命令 ----
// 存储规则（类型映射、—— 出处拆分、#token 消歧、自动补标签）全在 lib/store.js。
// 这里只做参数校验和回执文案，别把规则搬回来。

async function storeTyped(env, to, cmd, argStr) {
  if (!argStr.trim()) {
    await notify(env, to, `用法：/${cmd} <内容>${isVerbatimCmd(cmd) ? " [—— 出处]" : ""} [#选题名] [#标签]`);
    return;
  }
  const r = await storeTypedMaterial(env, cmd, argStr);
  if (!r.ok) {
    await notify(env, to, "内容为空，没存。");
    return;
  }
  const relNote = r.topicTitles.length ? `，关联选题「${r.topicTitles.join("、")}」` : "";
  const tagNote = r.tags.length ? `，标签 ${r.tags.join("、")}` : "，标签自动补中…";
  await notify(env, to, `✅ 已存素材（${r.dbType}）：${r.body.slice(0, 50)}${relNote}${tagNote}`);

  // 秒回后再补标签，不阻塞用户；手动给了标签就不补。
  // 归档排在补标签之后：标签要进 vault 的 frontmatter，而写出去的文件我们不回头改。
  if (r.needsAutoTag) await autoTag(env, r.id, r.dbType, r.body);
  await archiveMaterialToVault(env, r.id);
}

async function storeAuto(env, to, argStr) {
  if (!argStr.trim()) {
    await notify(env, to, "用法：/素材 <随手粘的内容> [#选题名] [#标签]");
    return;
  }
  await notify(env, to, "⏳ 识别中…");
  const r = await storeAutoMaterial(env, argStr);
  if (!r.ok) {
    await notify(env, to, "内容为空，没存。");
    return;
  }
  const relNote = r.topicTitles.length ? `，关联选题「${r.topicTitles.join("、")}」` : "";
  await notify(env, to, `✅ 已存素材（${r.dbType}）：${r.title.slice(0, 50)}${relNote}｜标签：${r.tags.join("、") || "无"}`);
  await archiveMaterialToVault(env, r.id);
}

// 完整命令说明（纯文本，两个渠道通用）。菜单描述保持极简，细节都在这里。
export const HELP_TEXT = [
  "📋 命令说明",
  "",
  "【存素材 · 直接进素材库】",
  "/金句 <内容> [—— 出处]  逐字保真·金句原话",
  "/数据 <内容> [—— 出处]  逐字保真·数据事实",
  "/概念 <内容>  核心观点",
  "/案例 <内容>  案例故事",
  "/框架 <内容>  框架模型",
  "/经历 <内容>  作者本人的真实个人经历",
  "/素材 <随手粘>  自动判类型 + 起标题 + 打标签",
  "· 例：/金句 复利是世界第八大奇迹 —— 爱因斯坦 #认知思维",
  "· 追加 #词：能匹配到选题名就挂「关联选题」，否则当标签",
  "· 不加标签会自动补；出处是链接进「出处」，是人名/书名并进正文",
  "· 英文名等价：quote / concept / case / data / framework / experience / material",
  "",
  "【快速出稿】",
  "/推 <X帖链接|文章链接|想法> [角度] [#存]  秒出 X 推文候选",
  "· X 帖链接→引用转发+原创推；文章链接→单推+短thread；纯文字→多角度单推",
  "· 默认只回不存，加 #存 才落库（来源进素材库、候选进稿件库）",
  "· 英文名等价：tweet",
  "",
  "【流程】",
  "/整理  立即聚类出选题",
  "/成稿 <选题关键词> <平台>  例：/成稿 写作复利 公众号",
  "/状态  各库待处理数量",
  "/help  显示本说明",
  "",
  "直接发链接或一段话（不带 /）＝ 进灵感库，5 分钟内自动初筛。",
].join("\n");
