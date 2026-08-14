// 飞书事件订阅入口。
//
// 和 Telegram 那个入口做的是同样三件事（验来源、取纯文本、确认是机主），命令逻辑
// 共用 lib/commands.js。但飞书这边多三件 Telegram 没有的：
//
//  1. **URL 验证**。第一次在后台填回调地址时，飞书会发一个 `url_verification`
//     请求，要把 `challenge` 原样回去，否则地址存不下来。
//  2. **可能是加密的**。配了 Encrypt Key 的话 body 是 `{"encrypt":"..."}`。
//  3. **事件会重复推送**。飞书明确说了「即使成功接收，仍会收到重复消息」，失败还会
//     按 15秒/5分钟/1小时/6小时 重试 4 次。所以**必须按 event_id 幂等**，
//     否则一条消息会被存两遍、一个命令会被跑两次。
//
// 还有一条硬约束：**回调必须 3 秒内响应**（TCP 建连 2 秒 + 整体 3 秒）。所以这里
// 一律先返回 200，实际处理丢进 ctx.waitUntil；含 LLM 的命令再由 commands.js
// 转进 JobWorkflow——waitUntil 自己也只有 30 秒。

import { readEvent, messageText, chatIdOf, senderOf, eventIdOf, eventTypeOf } from "./lib/lark.js";
import { notify, target, LARK } from "./lib/notify.js";
import { runCommand, captureInbox } from "./lib/commands.js";
import { claimTask } from "./lib/db.js";

export async function handleLarkWebhook(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    console.error("lark event parse failed:", e.message);
    return json({ code: 0 });
  }

  let event;
  try {
    event = await readEvent(env, body);
  } catch (e) {
    console.error("lark decrypt failed:", e.message);
    return json({ code: 0 });
  }

  // URL 验证：必须**同步**把 challenge 回去，不能塞进 waitUntil
  if (event?.type === "url_verification") {
    return json({ challenge: event.challenge });
  }

  // Verification Token 兜底校验。加密模式下能解开就已经证明了来源，
  // 但没配 Encrypt Key 时这是唯一的来源凭据，不能不验。
  if (env.LARK_VERIFY_TOKEN) {
    const token = event?.header?.token || event?.token;
    if (token !== env.LARK_VERIFY_TOKEN) {
      console.warn("lark: bad verification token");
      return new Response("forbidden", { status: 403 });
    }
  }

  ctx.waitUntil(processEvent(env, event).catch((e) => console.error("lark event failed:", e.message)));
  return json({ code: 0 });
}

async function processEvent(env, event) {
  if (eventTypeOf(event) !== "im.message.receive_v1") return;

  const eventId = eventIdOf(event);
  // 幂等闸门。飞书会重推同一个事件，没有这道闸门就是重复入库/重复跑命令。
  // 放在最前面：任何副作用之前先认领，认领不到直接退出。
  if (eventId && !(await claimTask(env, `lark-event:${eventId}`, "lark-event"))) {
    console.log(`lark: duplicate event ${eventId}, skipped`);
    return;
  }

  const text = messageText(event);
  const chatId = chatIdOf(event);
  const sender = senderOf(event);
  if (!text || !chatId) return;

  const to = target(LARK, chatId);
  console.log(`lark: message from open_id=${sender} chat_id=${chatId}`);

  if (text.startsWith("/")) {
    // 命令只响应机主。LARK_OWNER_OPEN_ID 没配时不限制——首次部署要先发条消息
    // 从日志里读到自己的 open_id，才有值可填。
    if (env.LARK_OWNER_OPEN_ID && sender !== env.LARK_OWNER_OPEN_ID) {
      console.warn(`lark: command from non-owner ${sender}, ignored`);
      return;
    }
    await runCommand(env, to, text, eventId).catch(async (e) => {
      console.error("command failed:", e.message);
      await notify(env, to, `❌ 命令执行失败：${e.message.slice(0, 150)}`);
    });
    return;
  }

  if (env.LARK_OWNER_OPEN_ID && sender !== env.LARK_OWNER_OPEN_ID) {
    console.warn(`lark: capture from non-owner ${sender}, ignored`);
    return;
  }
  await captureInbox(env, to, text, "飞书");
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
