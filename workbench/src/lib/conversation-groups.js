/**
 * 历史会话按时间分段。
 *
 * ⚠️ **段名是给「找上次那段」用的，不是装饰。**
 * 一列没有分段的会话，找东西只能一路读标题；而人回忆一段对话时，
 * 第一个想起来的通常是「昨天」「上周」这种时间锚点，不是标题里的词。
 *
 * 置顶的抽出来单独一段排最前：置顶的语义就是「不跟着时间沉下去」。
 *
 * 判据只写这一处——渲染层只负责把段名和段内的会话画出来，不再自己算一遍时间。
 */

const DAY = 86_400_000;

export const CONVERSATION_BUCKETS = Object.freeze(["置顶", "今天", "昨天", "最近 7 天", "最近 30 天", "更早"]);

export function conversationBucket(item, now = Date.now()) {
  if (item?.pinnedAt) return "置顶";
  const at = Date.parse(item?.updatedAt || item?.createdAt || "");
  // 时间读不出来时归到「更早」，不猜也不丢——列表里少一条比排错一条更难发现。
  if (!Number.isFinite(at)) return "更早";
  const days = (now - at) / DAY;
  if (days < 1) return "今天";
  if (days < 2) return "昨天";
  if (days < 7) return "最近 7 天";
  if (days < 30) return "最近 30 天";
  return "更早";
}

/**
 * 一条会话在列表里显示的时间戳。
 *
 * ⚠️ **格式跟着它所在的段走，不是所有行一个格式。**
 * 「今天」段里每条都写一遍月/日，等于把段名已经说过的话再说一遍，
 * 而且会和段名对不上——8/26 的会话在「今天」段里标着「8/26」，读者要停下来想一秒。
 * 今天和昨天段显示时分（这一段里真正区分先后的是钟点），其他段显示月/日。
 */
export function conversationStamp(item, bucket, now = Date.now()) {
  const at = Date.parse(item?.updatedAt || item?.createdAt || "");
  if (!Number.isFinite(at)) return "";
  const clock = bucket === "今天" || bucket === "昨天";
  if (clock) return new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleDateString("zh-CN", sameYear ? { month: "numeric", day: "numeric" } : { year: "numeric", month: "numeric", day: "numeric" });
}

/** 返回 `[段名, 会话[]][]`，只包含真的有会话的段，顺序固定为 CONVERSATION_BUCKETS。 */
export function groupConversationsByTime(items = [], now = Date.now()) {
  const buckets = new Map();
  for (const item of items) {
    const key = conversationBucket(item, now);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  return CONVERSATION_BUCKETS.filter((key) => buckets.has(key)).map((key) => [key, buckets.get(key)]);
}
