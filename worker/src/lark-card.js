// 飞书卡片回调入口（按钮点击）。
//
// 和事件订阅是**两条独立的链路**：事件订阅推的是「有人发了消息」，卡片回调推的是
// 「有人点了按钮」，后台要分开配地址，格式也不同（`card.action.trigger`）。
//
// 这条链路存在的意义，是把拍板选题从两个动作压成一个：
//
//   原来：先在选题上勾好「适配平台」，再把状态改成「撰写中」——**顺序还不能反**，
//         反了的话 runDraft 可能在平台还没写进去时就把选题领走，按旧勾选成稿。
//   现在：点一下「公众号」，平台和触发是同一个动作，那道闸门不存在了。
//
// 飞书要求「立即返回响应内容以反馈用户的操作」，所以这里同样是先回 JSON、
// 实际成稿丢进 JobWorkflow——LLM 要跑一到几分钟，卡片回调等不了。

import { readEvent } from "./lib/lark.js";
import { notify, target, LARK } from "./lib/notify.js";
import { getRow, updateRow } from "./lib/db.js";
import { TOPIC_STATUS, PLATFORMS } from "./lib/values.js";
import { enqueueExplicitJob } from "./pipeline-jobs.js";

export async function handleLarkCardWebhook(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    console.error("lark card parse failed:", e.message);
    return json({ code: 0 });
  }

  let event;
  try {
    event = await readEvent(env, body);
  } catch (e) {
    console.error("lark card decrypt failed:", e.message);
    return json({ code: 0 });
  }

  // URL 验证：必须同步返回，不能塞进 waitUntil
  if (event?.type === "url_verification") return json({ challenge: event.challenge });

  if (env.LARK_VERIFY_TOKEN) {
    const token = event?.header?.token || event?.token;
    if (token !== env.LARK_VERIFY_TOKEN) {
      console.warn("lark card: bad verification token");
      return new Response("forbidden", { status: 403 });
    }
  }

  const action = event?.event?.action;
  const value = action?.value || {};
  const operator = event?.event?.operator?.open_id || "";
  const chatId = event?.event?.context?.open_chat_id || "";

  if (env.LARK_OWNER_OPEN_ID && operator !== env.LARK_OWNER_OPEN_ID) {
    console.warn(`lark card: click from non-owner ${operator}, ignored`);
    return json({ toast: { type: "error", content: "只有机主能操作" } });
  }

  if (value.action === "draft" && value.topicId && PLATFORMS.has(value.platform)) {
    ctx.waitUntil(
      startDraft(env, value.topicId, value.platform, chatId)
        .catch((e) => console.error("card draft failed:", e.message))
    );
    // toast 是点击后立刻弹的提示。真正的结果几分钟后由 JobWorkflow 用消息回执发来。
    //
    // **没有把原卡片改掉，所以按钮会一直留着。** 这是可以接受的，因为重复点击撞不到
    // 花钱的地方：startDraft 挡掉「已在撰写中」，而即使状态已经变成「已成稿」再点，
    // draft.js 那道防重（该平台已有稿就跳过）也会在调 LLM 之前返回。
    // 代价只是几次 D1 查询。
    return json({ toast: { type: "info", content: `已开始为「${value.platform}」成稿` } });
  }

  return json({ code: 0 });
}

/**
 * 卡片按钮触发成稿。
 *
 * **先写平台再改状态**，顺序和工作台那道闸门一致：反过来的话 runDraft 可能在
 * platform 还没落库时就把选题领走。这里两步之间没有别的 await，窗口极小，
 * 但顺序仍然按对的来——这条规则的成本是零，破坏它的代价是一轮白烧的 LLM。
 */
async function startDraft(env, topicId, platform, chatId) {
  const to = target(LARK, chatId);
  const topic = await getRow(env, "topics", topicId);
  if (!topic) {
    await notify(env, to, "这个选题已经不在库里了。");
    return;
  }
  if (topic.status === TOPIC_STATUS.WRITING) {
    await notify(env, to, `「${topic.title}」已经在撰写中，不重复触发。`);
    return;
  }

  await updateRow(env, "topics", topicId, { platform, status: TOPIC_STATUS.WRITING });
  const queued = await enqueueExplicitJob(
    env, "draft", topicId, [topic.updated_at, platform],
    { to, topic: { ...topic, platform }, platforms: [platform] }
  );
  await notify(env, to, queued.created
    ? `⏳ 已受理，正在为「${topic.title}」写${platform}…（几分钟后回你）`
    : `「${topic.title}」的成稿任务已在处理。`);
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
