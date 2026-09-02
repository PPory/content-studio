/**
 * 涌现定位：从已经做过的事里**观察**出你正在变成谁。
 *
 * ⚠️ **这里不新建任何对象，也不让用户填。**
 * 定位不是开工前填的一张表（「你的 IP 定位：____」），它是长期反复解决某类问题、
 * 反复使用某些解释方式之后，别人对你形成的稳定判断——所以它只能从
 * 议程 → 内容机会 → 项目 → 发布 → 实验 这条已经存在的链上算出来。
 *
 * ⚠️ **数据不够时必须说不知道。**
 * 一篇已发布、一次实验，算不出任何「你总在解决什么」。这种时候给一个看起来很满的
 * 仪表盘是在编，正确的输出是「还看不出来」加上「还差什么」。阈值写在下面，
 * 并且跟着结果一起返回，界面不自己另定一套标准。
 */

/** 说得出话的最低量。低于这个只报进度，不下结论。 */
export const POSITIONING_THRESHOLD = Object.freeze({ publications: 3, settledExperiments: 3 });

export function observePositioning(workspace) {
  const db = workspace.db;

  const counts = {
    agendas: db.prepare("SELECT COUNT(*) AS c FROM content_agendas a JOIN entities e ON e.id=a.id AND e.deleted_at IS NULL WHERE a.status='active'").get().c,
    problems: db.prepare("SELECT COUNT(*) AS c FROM audience_problems p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL WHERE p.status='active'").get().c,
    opportunities: db.prepare("SELECT COUNT(*) AS c FROM content_opportunities o JOIN entities e ON e.id=o.id AND e.deleted_at IS NULL WHERE o.status='active'").get().c,
    publications: db.prepare(`SELECT COUNT(*) AS c FROM publication_records r
      JOIN entities e ON e.id=r.id AND e.deleted_at IS NULL
      JOIN drafts d ON d.id=r.draft_id
      JOIN entities pe ON pe.id=d.project_id AND pe.deleted_at IS NULL`).get().c,
    settledExperiments: db.prepare("SELECT COUNT(*) AS c FROM content_experiments x JOIN entities e ON e.id=x.id AND e.deleted_at IS NULL WHERE x.verdict<>'open'").get().c,
  };

  /**
   * 你反复回答的问题。
   * 排序看的是「走到了多远」而不是「记了多少条」——一条被记下但从没被写过的问题，
   * 说明不了你在解决它。
   */
  const problems = db.prepare(`SELECT p.statement, p.origin,
      COUNT(DISTINCT o.id) AS opportunities,
      COUNT(DISTINCT pe.id) AS projects
    FROM audience_problems p
    JOIN entities e ON e.id = p.id AND e.deleted_at IS NULL
    LEFT JOIN content_opportunities o ON o.audience_problem_id = p.id AND o.status = 'active'
    LEFT JOIN content_project_opportunities link ON link.opportunity_id = o.id
    LEFT JOIN entities pe ON pe.id = link.project_id AND pe.deleted_at IS NULL
    WHERE p.status = 'active'
    GROUP BY p.id
    HAVING opportunities > 0
    ORDER BY projects DESC, opportunities DESC, p.updated_at DESC
    LIMIT 8`).all();

  /**
   * 议程兑现到哪一步。一条议程说了什么不重要，重要的是它有没有真的变成内容发出去。
   */
  const agendas = db.prepare(`SELECT a.title, a.desired_judgment AS desiredJudgment,
      COUNT(DISTINCT o.id) AS opportunities,
      COUNT(DISTINCT pe.id) AS projects,
      COUNT(DISTINCT re.id) AS publications
    FROM content_agendas a
    JOIN entities e ON e.id = a.id AND e.deleted_at IS NULL
    LEFT JOIN content_opportunities o ON o.agenda_id = a.id AND o.status = 'active'
    LEFT JOIN content_project_opportunities link ON link.opportunity_id = o.id
    LEFT JOIN entities pe ON pe.id = link.project_id AND pe.deleted_at IS NULL
    LEFT JOIN drafts d ON d.project_id = pe.id
    LEFT JOIN publication_records r ON r.draft_id = d.id
    LEFT JOIN entities re ON re.id = r.id AND re.deleted_at IS NULL
    WHERE a.status = 'active'
    GROUP BY a.id
    ORDER BY publications DESC, projects DESC, a.updated_at DESC`).all();

  /** 已经发出去的内容留下了哪些判断。没发出去的不算——它还没被任何人看见。 */
  const claims = db.prepare(`SELECT DISTINCT o.core_claim AS claim, a.title AS agendaTitle
    FROM content_opportunities o
    JOIN entities e ON e.id = o.id AND e.deleted_at IS NULL
    JOIN content_project_opportunities link ON link.opportunity_id = o.id
    JOIN entities pe ON pe.id = link.project_id AND pe.deleted_at IS NULL
    JOIN drafts d ON d.project_id = pe.id
    JOIN publication_records r ON r.draft_id = d.id
    JOIN entities re ON re.id = r.id AND re.deleted_at IS NULL
    LEFT JOIN content_agendas a ON a.id = o.agenda_id
    WHERE o.status = 'active'
    ORDER BY r.published_at DESC
    LIMIT 8`).all();

  /** 你从现实里更新过的判断，以及那次假设成没成立。 */
  const learnings = db.prepare(`SELECT x.hypothesis_markdown AS hypothesis, x.learning_markdown AS learning,
      x.verdict, x.settled_at AS settledAt, p.title AS projectTitle
    FROM content_experiments x
    JOIN entities e ON e.id = x.id AND e.deleted_at IS NULL
    LEFT JOIN projects p ON p.id = x.project_id
    WHERE x.verdict <> 'open'
    ORDER BY x.settled_at DESC
    LIMIT 8`).all();

  const verdicts = db.prepare(`SELECT verdict, COUNT(*) AS c FROM content_experiments x
    JOIN entities e ON e.id = x.id AND e.deleted_at IS NULL
    WHERE verdict <> 'open' GROUP BY verdict`).all()
    .reduce((all, row) => ({ ...all, [row.verdict]: row.c }), {});

  const ready = counts.publications >= POSITIONING_THRESHOLD.publications
    && counts.settledExperiments >= POSITIONING_THRESHOLD.settledExperiments;

  return {
    ready,
    threshold: POSITIONING_THRESHOLD,
    counts,
    /**
     * 还差什么。⚠️ 说的是**还差几条**，不是「继续加油」——
     * 一句没有数字的鼓励，读完之后你并不知道什么时候能看到结果。
     */
    missing: ready ? [] : [
      counts.publications < POSITIONING_THRESHOLD.publications
        ? `再发 ${POSITIONING_THRESHOLD.publications - counts.publications} 篇`
        : "",
      counts.settledExperiments < POSITIONING_THRESHOLD.settledExperiments
        ? `再结算 ${POSITIONING_THRESHOLD.settledExperiments - counts.settledExperiments} 次实验`
        : "",
    ].filter(Boolean),
    problems,
    agendas,
    claims,
    learnings,
    verdicts,
  };
}
