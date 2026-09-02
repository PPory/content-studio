/**
 * 对话里的**研究方向信号**。
 *
 * ⚠️ **这一整个模块只回答一个问题：他最近在想什么。**
 * 它不回答「什么是真的」。这不是措辞谨慎，是结构上的：
 * 下面只读 `role === "user"` 的消息，助手说过的话一个字都不会离开这个文件。
 *
 * 为什么必须这样：AI 说的话看起来和事实一模一样，而且往往写得比事实更顺。
 * 一旦它能当证据，整套「逐字回溯」就白做了——你可以让模型先说一句，
 * 再把那句话当成来源引用回来，而且中间没有任何一步看起来像作假。
 *
 *     对话可以决定「看哪里」。
 *     不能决定「什么是真的」。
 */

const clean = (value, max = 4_000) => String(value ?? "").trim().slice(0, max);

/** 单条用户消息最多带多少字进上下文。 */
const TURN_LIMIT = 400;
/** 一次最多看几段对话。再多就变成翻聊天记录，而不是看方向。 */
const CONVERSATION_LIMIT = 12;
/** 多久以内的对话才算「最近」。 */
const RECENT_DAYS = 21;

/**
 * 这些 scope 里的「用户消息」不是人打的，是应用自己发的提示词。
 *
 * ⚠️ **真实库里就有两条**：`inline-writing:` 那种「围绕当前光标续写一个紧凑段落…
 * 本轮专家约束：写作教练…」。它以 `role: "user"` 存着，因为对模型来说它确实是
 * user turn——但它不是任何人在研究什么。不滤掉的话，下一次扫描会认真地
 * 把「写作教练的约束」当成创作者最近的关注方向。
 */
const MACHINE_SCOPES = ["inline-writing:", "reader:", "expert:"];

/** 应用注入的那段专家约束的特征。scope 认不出来时靠它兜底。 */
const SCAFFOLD_MARKERS = ["本轮专家约束", "只返回可插入正文", "只输出 JSON"];

/**
 * **对工具下的指令**，不是在研究什么。
 *
 * ⚠️ 真实库里 6 段「用户消息」有 5 段是这一类：
 * 「根据已知信息，写一篇文章」「看看这篇文章」「请素材顾问、审稿顾问和事实核查
 * 分别独立检查全文」「@知识库 里面现在大概有哪些内容」。
 * 把这些当成「他最近在想什么」喂进扫描，等于告诉系统他最近在研究「写一篇文章」。
 *
 * ⚠️ 判据是**这句话在说工具，还是在说一个题目**。
 * 「知识库里关于批判性思维是怎么说的」也提到知识库，但它问的是一个题目，
 * 所以它留下——这条区别就是这个过滤器存在的全部理由。
 */
const SENTENCE = "[^。？！\\n]";
const OPERATIONAL_PATTERNS = [
  new RegExp(`^(请|帮我|帮忙|麻烦)?\\s*(把|将)?${SENTENCE}{0,12}(改写|润色|续写|扩写|缩写|翻译|排版|生成|起草|写一?篇|检查全文|汇总)`),
  new RegExp(`(素材顾问|审稿顾问|事实核查|品控|专家)${SENTENCE}{0,20}(检查|审阅|汇总|独立)`),
  new RegExp(`^@?\\S{0,8}(知识库|素材库|工作台)${SENTENCE}{0,10}(有哪些|里有什么|大概有|现在有)`),
  new RegExp(`^(看看|读一下|打开|继续|接着写|再来一版|重写)${SENTENCE}{0,10}$`),
  new RegExp(`^根据(已知|上面|以上)${SENTENCE}{0,10}(写|生成|整理)`),
];

/** 太短的句子说不出任何方向。 */
const MIN_SUBSTANCE = 8;

function isOperationalTurn(text) {
  if (text.length < MIN_SUBSTANCE) return true;
  return OPERATIONAL_PATTERNS.some((pattern) => pattern.test(text));
}

function isMachineTurn(scopeId, text) {
  if (MACHINE_SCOPES.some((prefix) => String(scopeId || "").startsWith(prefix))) return true;
  return SCAFFOLD_MARKERS.some((marker) => text.includes(marker));
}

/**
 * 最近的研究方向。
 *
 * 返回的每一条都**只包含用户自己写的话**。助手的回答连同它的长度、条数
 * 都不出现在结果里——留一个「助手说了 5 条」的计数，下一步就会有人拿它当权重。
 */
export function recentResearchSignals(workspace, { limit = CONVERSATION_LIMIT, now = new Date() } = {}) {
  const cutoff = new Date(new Date(now).getTime() - RECENT_DAYS * 86_400_000).toISOString();
  const rows = workspace.db.prepare(`SELECT c.id, c.title, c.scope_id AS scopeId, c.record_json AS recordJson, e.updated_at AS updatedAt
    FROM ai_conversations c JOIN entities e ON e.id = c.id AND e.deleted_at IS NULL
    WHERE c.archived_at IS NULL AND e.updated_at >= ?
    ORDER BY e.updated_at DESC LIMIT ?`).all(cutoff, Math.max(1, Math.min(40, limit * 3)));

  const signals = [];
  for (const row of rows) {
    if (signals.length >= limit) break;
    let record;
    try { record = JSON.parse(row.recordJson); } catch { continue; }
    const messages = Array.isArray(record?.messages) ? record.messages : [];
    /**
     * ⚠️ 这一行是整个模块的闸门。改动它之前先读文件头那段。
     * 助手的消息在这里被丢掉，之后的代码再也拿不到它们。
     */
    const userTurns = messages
      .filter((message) => message?.role === "user")
      .map((message) => clean(message.text, TURN_LIMIT))
      .filter((text) => text && !isMachineTurn(row.scopeId, text) && !isOperationalTurn(text));
    if (!userTurns.length) continue;
    signals.push({
      conversationId: row.id,
      title: clean(row.title, 200),
      updatedAt: row.updatedAt,
      /** 只有他自己说过的话。 */
      userTurns: userTurns.slice(-6),
    });
  }
  return signals;
}

/** 一段对话变成一句「这次优先看哪儿」。同样只取用户自己的话。 */
export function conversationResearchFocus(workspace, conversationId) {
  const signal = recentResearchSignals(workspace, { limit: 40 })
    .find((item) => item.conversationId === conversationId);
  if (!signal) {
    throw Object.assign(new Error("这段对话里没有你自己写下的内容"), {
      status: 409,
      hint: "只有你自己说过的话可以决定下一次看哪里；AI 的回答不能当作方向依据。",
    });
  }
  return {
    conversationId,
    title: signal.title,
    focus: signal.userTurns.join("；").slice(0, 500),
  };
}

/**
 * 写给模型看的那段「他最近在想什么」。
 *
 * ⚠️ 措辞本身就是硬闸的一部分：这段话必须明确说出它**不是事实来源**，
 * 否则模型会很自然地把「他最近在聊认知卸载」写成「认知卸载已经被验证过」。
 */
export function describeResearchSignals(signals) {
  if (!signals.length) return "";
  const lines = ["# 我最近在想什么（只是方向，不是事实）"];
  lines.push("⚠️ 下面全部是创作者自己打的字，不含任何 AI 回答。");
  lines.push("⚠️ 它只能帮你决定**往哪儿看**，不能当成证据、结论或已经成立的知识。");
  lines.push("⚠️ 不得因为这里提到过某个说法，就当作它已经被验证。");
  for (const signal of signals) {
    lines.push(`- ${signal.title || "（未命名对话）"}：${signal.userTurns.join(" / ")}`);
  }
  return lines.join("\n");
}
