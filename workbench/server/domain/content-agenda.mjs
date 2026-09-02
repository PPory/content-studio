/**
 * 长期议程的观察层：从已经做过的事里看有没有一条反复出现的判断。
 *
 * ⚠️ **数据不够就说还看不出来，并且说清还差多少。**
 * 一条议程的意思是「我反复在解决这类问题、反复希望别人形成这个判断」——
 * 三条内容机会看不出「反复」，硬要模型总结，它只会把现有那几条重新包装一遍，
 * 读起来像洞察，其实只是复述。
 *
 * 这条规矩和涌现定位是同一条（`positioning.mjs`），阈值也放在一起看：
 * 定位问「我正在变成谁」，议程问「我反复想让别人形成什么判断」，
 * 两者都只能从长期行为里观察出来，都不能靠填一张表。
 */

const clean = (value, max = 4_000) => String(value ?? "").trim().slice(0, max);

/**
 * 说得出话的最低量。
 *
 * ⚠️ **三个维度缺一不可，而且要的是「异质」不是「数量」。**
 * 五条机会全都挂在同一个用户问题上，说明的是「我很在意这一个问题」，
 * 不是「我有一条长期议程」——所以还要求覆盖到不同的问题。
 */
export const AGENDA_THRESHOLD = Object.freeze({
  opportunities: 5,
  distinctClaims: 4,
  distinctProblems: 3,
});

/**
 * 长期行为的观察结果。
 *
 * 这里**不调用模型**：够不够得着说话，是数出来的，不是问出来的。
 */
export function observeAgendaSignals(workspace) {
  const db = workspace.db;

  /** 已经留下过的判断。带着它是从哪条问题、哪块知识来的，好让依据可以被核对。 */
  const claims = db.prepare(`SELECT o.id, o.core_claim AS claim, o.dominant_action AS dominantAction,
      o.agenda_id AS agendaId, p.id AS problemId, p.statement AS problem, p.origin,
      w.id AS wikiId, w.title AS wikiTitle, o.updated_at AS updatedAt
    FROM content_opportunities o
    JOIN entities e ON e.id = o.id AND e.deleted_at IS NULL
    JOIN audience_problems p ON p.id = o.audience_problem_id
    LEFT JOIN wiki_pages w ON w.id = o.wiki_page_id
    WHERE o.status = 'active'
    ORDER BY o.updated_at DESC LIMIT 40`).all();

  /** 已经发出去的那些：真正被人看见过的判断，比只存下来的那些重。 */
  const published = db.prepare(`SELECT r.id, r.title, r.platform, r.published_at AS publishedAt
    FROM publication_records r
    JOIN entities e ON e.id = r.id AND e.deleted_at IS NULL
    ORDER BY r.published_at DESC LIMIT 20`).all();

  /** 从现实里更新过的判断。它是「我改变了什么」的直接记录。 */
  const learnings = db.prepare(`SELECT x.id, x.learning_markdown AS learning, x.verdict, p.title AS projectTitle
    FROM content_experiments x
    JOIN entities e ON e.id = x.id AND e.deleted_at IS NULL
    LEFT JOIN projects p ON p.id = x.project_id
    WHERE x.verdict <> 'open' ORDER BY x.settled_at DESC LIMIT 12`).all();

  /** 反复被回答的问题。只算真的走到内容机会那一步的——记下来但没写过的说明不了什么。 */
  const problems = db.prepare(`SELECT p.id, p.statement, p.origin, COUNT(DISTINCT o.id) AS opportunities
    FROM audience_problems p
    JOIN entities e ON e.id = p.id AND e.deleted_at IS NULL
    JOIN content_opportunities o ON o.audience_problem_id = p.id AND o.status = 'active'
    WHERE p.status = 'active'
    GROUP BY p.id ORDER BY opportunities DESC, p.updated_at DESC LIMIT 20`).all();

  const existing = workspace.contentBridge.agendas();
  const distinctClaims = new Set(claims.map((item) => clean(item.claim, 200))).size;
  const distinctProblems = new Set(claims.map((item) => item.problemId)).size;

  const counts = {
    opportunities: claims.length,
    distinctClaims,
    distinctProblems,
    published: published.length,
    learnings: learnings.length,
    agendas: existing.length,
  };

  /**
   * ⚠️ **还差多少要说得出数字。**
   * 「数据还不够」读完之后你不知道什么时候能看到结果；
   * 「再攒 2 条内容机会、再覆盖 1 个不同的用户问题」才是一个可以完成的事。
   */
  const missing = [
    counts.opportunities < AGENDA_THRESHOLD.opportunities
      ? `再攒 ${AGENDA_THRESHOLD.opportunities - counts.opportunities} 条内容机会`
      : "",
    distinctClaims < AGENDA_THRESHOLD.distinctClaims
      ? `再留下 ${AGENDA_THRESHOLD.distinctClaims - distinctClaims} 条不同的核心判断`
      : "",
    distinctProblems < AGENDA_THRESHOLD.distinctProblems
      ? `再覆盖 ${AGENDA_THRESHOLD.distinctProblems - distinctProblems} 个不同的用户问题`
      : "",
  ].filter(Boolean);

  return {
    ready: missing.length === 0,
    threshold: AGENDA_THRESHOLD,
    counts,
    missing,
    claims,
    published,
    learnings,
    problems,
    existing,
  };
}

/**
 * 写给模型看的那份长期行为。
 *
 * 每一条都带 id：候选必须指得回具体哪几条，否则「依据」就只是一句好听的话。
 */
export function describeAgendaSignals(signals) {
  const lines = [];
  lines.push(`# 我已经留下过的判断（共 ${signals.claims.length} 条）`);
  for (const item of signals.claims) {
    lines.push(`- id=${item.id}｜问题：${clean(item.problem, 120)}｜知识：${item.wikiTitle || "（已删除）"}｜判断：${clean(item.claim, 300)}`);
  }
  if (signals.problems.length) {
    lines.push(`\n# 我反复回答的问题`);
    for (const item of signals.problems) {
      lines.push(`- id=${item.id}｜${clean(item.statement, 200)}｜已经发展出 ${item.opportunities} 条内容机会${item.origin === "hypothesis" ? "｜⚠️ 这条本身还是假设" : ""}`);
    }
  }
  if (signals.published.length) {
    lines.push(`\n# 真的发出去过的（共 ${signals.published.length} 篇）`);
    for (const item of signals.published) lines.push(`- id=${item.id}｜${item.platform}《${clean(item.title, 120)}》`);
  }
  if (signals.learnings.length) {
    lines.push(`\n# 我从现实里更新过的判断`);
    for (const item of signals.learnings) lines.push(`- id=${item.id}｜${clean(item.learning, 300)}（${item.verdict}）`);
  }
  if (signals.existing.length) {
    lines.push(`\n# 已经定过的长期议程（不要重复，也不要换个说法再提一遍）`);
    for (const item of signals.existing) lines.push(`- ${item.title}：${clean(item.desiredJudgment, 300)}`);
  }
  return lines.join("\n");
}
