import { createUlid } from "../storage/ids.mjs";

/**
 * 内容实验：学习闭环的核心对象。
 *
 * 假设 → 发布 → 发生了什么 → 我更新了什么判断 → 下一次试什么。
 *
 * ⚠️ 这里最重要的一条不变式是**假设必须先于发布**。
 * 发布之后再补的「假设」是事后诸葛：它一定和结果一致，于是 verdict 永远 supported，
 * 整条闭环就退化成一份好看的记录。所以 settle 时会拿 recorded_at 和发布时间比，
 * 补不上就拒绝，而不是默默接受。
 */

const VERDICTS = new Set(["supported", "mixed", "refuted"]);

const isoNow = (now = new Date()) => new Date(now).toISOString();
const clean = (value) => String(value ?? "").trim();

function required(value, label, max = Infinity) {
  const result = clean(value);
  if (!result) throw new TypeError(`${label}不能为空`);
  if (result.length > max) throw new TypeError(`${label}不能超过 ${max} 字`);
  return result;
}

function requireConfirmedUser({ actor, confirmed }, action) {
  if (actor !== "user") throw new Error(`${action}只能由用户执行`);
  if (confirmed !== true) throw new Error(`${action}必须来自用户明确确认`);
}

function experimentDto(row) {
  return row && {
    id: row.id,
    projectId: row.project_id,
    projectTitle: row.project_title || "",
    hypothesisMarkdown: row.hypothesis_markdown,
    recordedAt: row.recorded_at,
    publicationId: row.publication_id || null,
    publicationTitle: row.publication_title || "",
    publishedAt: row.published_at || null,
    outcomeMarkdown: row.outcome_markdown,
    learningMarkdown: row.learning_markdown,
    verdict: row.verdict,
    settledAt: row.settled_at || null,
  };
}

const SELECT = `SELECT x.*, p.title AS project_title, r.title AS publication_title, r.published_at
  FROM content_experiments x
  JOIN entities e ON e.id = x.id AND e.deleted_at IS NULL
  LEFT JOIN projects p ON p.id = x.project_id
  LEFT JOIN publication_records r ON r.id = x.publication_id`;

export class ContentExperimentDomain {
  constructor({ db, repository, workspaceDomain }) {
    this.db = db;
    this.repository = repository;
    this.workspaceDomain = workspaceDomain;
  }

  recordHypothesis({ id = createUlid(), projectId, hypothesisMarkdown, actor, confirmed = false, now } = {}) {
    requireConfirmedUser({ actor, confirmed }, "记录内容假设");
    this.workspaceDomain.entity(projectId, "project");
    const hypothesis = required(hypothesisMarkdown, "内容假设", 4000);
    const stamp = isoNow(now);
    return this.repository.transaction(() => {
      this.repository.createEntity({ id, type: "content_experiment", now });
      this.db.prepare(`INSERT INTO content_experiments(id, project_id, hypothesis_markdown, recorded_at, verdict)
        VALUES (?, ?, ?, ?, 'open')`).run(id, projectId, hypothesis, stamp);
      this.repository.setEntityText(id, { title: `实验假设：${hypothesis.slice(0, 60)}`, body: hypothesis, now });
      this.workspaceDomain.audit("content_experiment.recorded", id, { projectId }, now);
      return id;
    });
  }

  updateHypothesis(id, { hypothesisMarkdown, actor, confirmed = false, now } = {}) {
    requireConfirmedUser({ actor, confirmed }, "修改内容假设");
    const current = this.experiment(id);
    // 结算之后改假设等于事后改答案，闭环就不成立了。
    if (current.verdict !== "open") throw new Error("已结算的实验不能再改假设");
    const hypothesis = required(hypothesisMarkdown, "内容假设", 4000);
    return this.repository.transaction(() => {
      this.db.prepare("UPDATE content_experiments SET hypothesis_markdown = ? WHERE id = ?").run(hypothesis, id);
      this.repository.setEntityText(id, { title: `实验假设：${hypothesis.slice(0, 60)}`, body: hypothesis, now });
      this.workspaceDomain.touch(id, now);
      this.workspaceDomain.audit("content_experiment.updated", id, {}, now);
      return id;
    });
  }

  settleExperiment(id, { publicationId = null, outcomeMarkdown, learningMarkdown, verdict, actor, confirmed = false, now } = {}) {
    requireConfirmedUser({ actor, confirmed }, "结算内容实验");
    const current = this.experiment(id);
    if (current.verdict !== "open") throw new Error("这次实验已经结算过");
    const canonicalVerdict = clean(verdict);
    if (!VERDICTS.has(canonicalVerdict)) throw new TypeError("实验结论只能是 supported、mixed 或 refuted");
    const outcome = required(outcomeMarkdown, "发生了什么", 4000);
    const learning = required(learningMarkdown, "我更新了什么判断", 4000);

    let linkedPublication = null;
    if (publicationId) {
      linkedPublication = this.db.prepare(`SELECT r.id, r.published_at AS publishedAt, d.project_id AS projectId
        FROM publication_records r JOIN drafts d ON d.id = r.draft_id
        JOIN entities e ON e.id = r.id AND e.deleted_at IS NULL WHERE r.id = ?`).get(clean(publicationId));
      if (!linkedPublication) throw Object.assign(new Error("发布记录不存在"), { status: 404 });
      if (linkedPublication.projectId !== current.projectId) throw new Error("这条发布记录不属于该实验的项目");
      /**
       * 事前假设的硬闸。发布之后补的假设一定和结果吻合，
       * verdict 会永远是 supported，闭环就变成了自我确认。
       */
      if (new Date(current.recordedAt).getTime() > new Date(linkedPublication.publishedAt).getTime()) {
        throw new Error("这条假设记录于发布之后，不能用来验证这次发布；假设必须在发布前写下");
      }
    }

    const stamp = isoNow(now);
    return this.repository.transaction(() => {
      this.db.prepare(`UPDATE content_experiments
        SET publication_id = ?, outcome_markdown = ?, learning_markdown = ?, verdict = ?, settled_at = ?
        WHERE id = ?`).run(linkedPublication?.id || null, outcome, learning, canonicalVerdict, stamp, id);
      this.repository.setEntityText(id, {
        title: `实验假设：${current.hypothesisMarkdown.slice(0, 60)}`,
        body: `${current.hypothesisMarkdown}\n${outcome}\n${learning}`,
        now,
      });
      this.workspaceDomain.touch(id, now);
      this.workspaceDomain.audit("content_experiment.settled", id, { verdict: canonicalVerdict, publicationId: linkedPublication?.id || null }, now);
      return id;
    });
  }

  linkProblem(experimentId, problemId, { actor, confirmed = false, now } = {}) {
    requireConfirmedUser({ actor, confirmed }, "把实验学到的东西记成用户问题");
    this.experiment(experimentId);
    this.db.prepare(`INSERT INTO experiment_problem_links(experiment_id, problem_id, created_at)
      VALUES (?, ?, ?) ON CONFLICT(experiment_id, problem_id) DO NOTHING`)
      .run(experimentId, clean(problemId), isoNow(now));
    this.workspaceDomain.audit("content_experiment.problem_linked", experimentId, { problemId }, now);
    return experimentId;
  }

  experiments({ projectId = "", openOnly = false } = {}) {
    const where = [];
    const params = [];
    if (projectId) { where.push("x.project_id = ?"); params.push(clean(projectId)); }
    if (openOnly) where.push("x.verdict = 'open'");
    const sql = `${SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY x.recorded_at DESC, x.id`;
    return this.db.prepare(sql).all(...params).map(experimentDto);
  }

  experiment(id) {
    const row = this.db.prepare(`${SELECT} WHERE x.id = ?`).get(clean(id));
    if (!row) throw Object.assign(new Error("内容实验不存在"), { status: 404 });
    return experimentDto(row);
  }

  /** 这次实验的学习回流成了哪些用户问题。 */
  linkedProblems(experimentId) {
    return this.db.prepare(`SELECT p.id, p.statement, p.origin
      FROM experiment_problem_links l
      JOIN audience_problems p ON p.id = l.problem_id
      JOIN entities e ON e.id = p.id AND e.deleted_at IS NULL
      WHERE l.experiment_id = ? ORDER BY l.created_at DESC`).all(clean(experimentId));
  }
}

export const CONTENT_EXPERIMENT_VALUES = Object.freeze({ verdicts: [...VERDICTS] });
