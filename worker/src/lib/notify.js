// 回执发到哪儿。
//
// 存在的理由：**异步任务的回执必须回到发起它的那个渠道**。/推 /成稿 /整理 都是
// webhook 秒回受理、丢进 JobWorkflow 跑几分钟，等跑完时早就没有请求上下文了——
// 只有 job payload 里带着的这个 target 知道该发回 Telegram 还是飞书。
//
// 所以 job 的参数里存的是 `{channel, chatId}` 而不是一个裸 chatId。加渠道时只改这里。

import { reply as tgReply, replyLong as tgReplyLong } from "./tg.js";
import { sendLong as larkSendLong } from "./lark.js";

export const TELEGRAM = "telegram";
export const LARK = "lark";

export const target = (channel, chatId, idType) => (chatId ? { channel, chatId, idType } : null);

/**
 * 发一条回执。**失败不抛**——调用方大多是「任务已经做完了，只是想说一声」，
 * 为了一条发不出去的消息把整个任务标记为失败，会让本已落库的结果被重跑一遍。
 */
export async function notify(env, to, text) {
  if (!to?.chatId) return false;
  try {
    if (to.channel === LARK) await larkSendLong(env, to.chatId, text, undefined, to.idType);
    else await tgReply(env, to.chatId, text);
    return true;
  } catch (e) {
    console.error(`notify ${to.channel} failed:`, e.message.slice(0, 200));
    return false;
  }
}

/** 长文本（/推 的候选那种）。Telegram 侧由 tg.js 自己分片，飞书侧按段落切。 */
export async function notifyLong(env, to, text) {
  if (!to?.chatId) return false;
  try {
    if (to.channel === LARK) await larkSendLong(env, to.chatId, text, undefined, to.idType);
    else await tgReplyLong(env, to.chatId, text);
    return true;
  } catch (e) {
    console.error(`notifyLong ${to.channel} failed:`, e.message.slice(0, 200));
    return false;
  }
}
