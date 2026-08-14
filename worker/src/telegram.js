// Telegram webhook 入口。
//
// 这个文件只做三件事：**验来源、取纯文本、确认是机主**，然后交给 lib/commands.js。
// 命令逻辑一份都不留在这里——飞书那个入口做的是同样三件事，两边共用同一套命令，
// 否则改一处、另一处还按旧规则跑，而且不报错。
//
// 处理放 ctx.waitUntil，webhook 立即返回 200，避免 Telegram 超时重发导致重复入库。
// 注意 waitUntil 只有 30 秒存活期，含 LLM 长生成的命令由 commands.js 丢进 JobWorkflow。

import { notify, target, TELEGRAM } from "./lib/notify.js";
import { runCommand, captureInbox } from "./lib/commands.js";

export async function handleTelegramWebhook(request, env, ctx) {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  // body 必须在返回响应前读完（响应发出后 request stream 即关闭）
  let update;
  try {
    update = await request.json();
  } catch (e) {
    console.error("telegram update parse failed:", e.message);
    return new Response("ok");
  }
  ctx.waitUntil(processUpdate(env, update).catch((e) => console.error("telegram update failed:", e.message)));
  return new Response("ok");
}

async function processUpdate(env, update) {
  const msg = update.message;
  const text = (msg?.text || msg?.caption || "").trim();
  if (!msg || !text) return;

  const chatId = msg.chat.id;
  const to = target(TELEGRAM, chatId);
  console.log(`telegram: message from chat_id=${chatId}`);

  // 命令（以 / 开头）：只响应机主 OWNER_CHAT_ID（未配则退回 ALLOWED_CHAT_ID）
  if (text.startsWith("/")) {
    const owner = env.OWNER_CHAT_ID || env.ALLOWED_CHAT_ID;
    if (owner && String(chatId) !== String(owner)) {
      console.warn(`telegram: command from non-owner ${chatId}, ignored`);
      return;
    }
    await runCommand(env, to, text, update.update_id).catch(async (e) => {
      console.error("command failed:", e.message);
      await notify(env, to, `❌ 命令执行失败：${e.message.slice(0, 150)}`);
    });
    return;
  }

  // 采集：非命令消息入灵感库（仅允许发信人）
  if (env.ALLOWED_CHAT_ID && String(chatId) !== String(env.ALLOWED_CHAT_ID)) {
    console.warn(`telegram: chat_id ${chatId} not allowed, ignored`);
    return;
  }
  await captureInbox(env, to, text, "Telegram");
}
