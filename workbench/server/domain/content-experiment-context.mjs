/**
 * 实验的上下文：发布前拿什么提假设，发布后拿什么结算。
 *
 * ⚠️ **这一层最重要的产出不是数据，是「有没有数据」。**
 * 真实工作区里最常见的情况是：发出去了，但这一篇还没有任何数字。
 * 那时候正确的输出是**零条观察**加一句「还差什么」，而不是把
 * 「数据比之前好点」这种话包装成结算——真实库里那条唯一的实验就是这么结的。
 *
 * 模型协议在 `content-experiments-ai.mjs`。
 */

const clean = (value, max = 4_000) => String(value ?? "").trim().slice(0, max);

const METRIC_LABELS = Object.freeze({
  views: "阅读", likes: "点赞", comments: "评论", collects: "收藏", shares: "转发",
});
const METRIC_KEYS = Object.keys(METRIC_LABELS);

function median(values) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : Math.round((list[middle - 1] + list[middle]) / 2);
}

/**
 * 这一篇自己的数字。
 *
 * ⚠️ **工作台的发布记录和从平台导进来的那些是两套东西。**
 * `metric_snapshots` 挂在工作台自己的发布记录上；`external_publication_records`
 * 是从平台后台导出来的行，两边没有连过。所以这里两边都看，并且**说清是哪一边**——
 * 把导入的行当成这一篇的数据，是「安静地把两篇并成一篇」那类错误。
 */
function publicationMetrics(db, publication) {
  if (!publication) return null;
  const snapshot = db.prepare(`SELECT captured_at AS capturedAt, views, likes, comments, collects, shares
    FROM metric_snapshots WHERE publication_id = ? ORDER BY captured_at DESC LIMIT 1`).get(publication.id);
  if (snapshot) {
    return {
      source: "workbench",
      capturedAt: snapshot.capturedAt,
      values: Object.fromEntries(METRIC_KEYS.map((key) => [key, snapshot[key]]).filter(([, value]) => value != null)),
    };
  }
  /**
   * 工作台没有快照时，**按平台 + 标题**去找那条导入的行。
   * ⚠️ 对不上就返回 null，不做模糊匹配：同一篇内容在两个平台标题常常不一样，
   * 猜错了会安静地把别人的数字算到这一篇头上。
   */
  const external = db.prepare(`SELECT published_at AS publishedAt, views, likes, comments, collects, shares
    FROM external_publication_records WHERE platform = ? AND title = ? ORDER BY published_at DESC LIMIT 1`)
    .get(publication.platform, publication.title);
  if (!external) return null;
  return {
    source: "platform-import",
    capturedAt: external.publishedAt,
    values: Object.fromEntries(METRIC_KEYS.map((key) => [key, external[key]]).filter(([, value]) => value != null)),
  };
}

/**
 * 同平台过去几篇的中位数。
 *
 * ⚠️ **没有基线就不给基线**，不要拿一两篇算个「中位数」充数：
 * 「高于过去 5 篇中位数」和「比上一篇高」是完全不同强度的话。
 */
function baselineFor(db, platform, excludeTitle) {
  const rows = db.prepare(`SELECT title, views, likes, comments, collects, shares
    FROM external_publication_records WHERE platform = ? AND title <> ?
    ORDER BY published_at DESC LIMIT 10`).all(platform, excludeTitle || "");
  if (rows.length < 2) return { available: false, sampleSize: rows.length, values: {} };
  return {
    available: true,
    sampleSize: rows.length,
    values: Object.fromEntries(METRIC_KEYS
      .map((key) => [key, median(rows.map((row) => row[key]))])
      .filter(([, value]) => value != null)),
  };
}

/** 已经结算过的实验：提假设时用来避免重复验证同一件事。 */
function settledHistory(db, projectId) {
  return db.prepare(`SELECT x.hypothesis_markdown AS hypothesis, x.verdict, x.learning_markdown AS learning,
      p.title AS projectTitle
    FROM content_experiments x
    JOIN entities e ON e.id = x.id AND e.deleted_at IS NULL
    LEFT JOIN projects p ON p.id = x.project_id
    WHERE x.verdict <> 'open' AND x.project_id <> ?
    ORDER BY x.settled_at DESC LIMIT 8`).all(clean(projectId));
}

/**
 * 发布前：这一篇最值得验证什么。
 *
 * 上下文全部来自已经定过的东西——内容机会、选定的讲法、议程、过去的实验。
 * ⚠️ 这里不问用户任何问题：「你为什么认为这一篇会有效」正是要被替换掉的那个空输入框。
 */
export function hypothesisContext(workspace, projectId) {
  const db = workspace.db;
  workspace.domain.entity(projectId, "project");
  const opportunity = workspace.contentBridge.projectOpportunity(projectId);
  const project = db.prepare("SELECT title FROM projects WHERE id = ?").get(clean(projectId));
  const problem = opportunity ? workspace.contentBridge.audienceProblem(opportunity.audienceProblemId) : null;
  const agenda = opportunity?.agendaId ? workspace.contentBridge.agenda(opportunity.agendaId) : null;
  const construction = opportunity?.construction || {};
  return {
    projectId,
    projectTitle: project?.title || "",
    opportunity,
    problem,
    agenda,
    route: construction.route || null,
    entryOptions: construction.entry_options || [],
    history: settledHistory(db, projectId),
    open: workspace.experiments.experiments({ projectId, openOnly: true }),
  };
}

/**
 * 发布后：结算这一次到底能看到什么。
 *
 * 返回的 `evidence` 就是**允许被称为「观察」的全部东西**。
 * 模型能说的观察必须落在它里面；落不上的一律降级成推断。
 */
export function settlementContext(workspace, { experimentId, feedbackText = "" } = {}) {
  const db = workspace.db;
  const experiment = workspace.experiments.experiment(experimentId);
  const publication = experiment.publicationId
    ? db.prepare(`SELECT id, platform, title, published_at AS publishedAt, published_url AS publishedUrl
        FROM publication_records WHERE id = ?`).get(experiment.publicationId)
    : db.prepare(`SELECT r.id, r.platform, r.title, r.published_at AS publishedAt, r.published_url AS publishedUrl
        FROM publication_records r JOIN drafts d ON d.id = r.draft_id
        JOIN entities e ON e.id = r.id AND e.deleted_at IS NULL
        WHERE d.project_id = ? ORDER BY r.published_at DESC LIMIT 1`).get(experiment.projectId);

  const metrics = publicationMetrics(db, publication);
  const baseline = publication ? baselineFor(db, publication.platform, publication.title) : { available: false, sampleSize: 0, values: {} };
  const feedback = clean(feedbackText, 20_000);

  /**
   * ⚠️ **缺什么要说得具体。** 「暂无数据」读完之后人不知道该干什么；
   * 「这一篇还没有任何数字，去导一次平台数据，或者把收到的评论贴进来」才有下一步。
   */
  const missing = [];
  if (!publication) missing.push("这个项目还没有发布记录");
  if (!metrics) missing.push("这一篇还没有任何数字：到 复盘 → 数据 导一次平台导出，或者手动补一条");
  if (!feedback) missing.push("还没有真实反馈原话：把评论、私信或群里的原话贴进来");
  if (metrics && !baseline.available) missing.push(`同平台只有 ${baseline.sampleSize} 篇可比，还算不出中位数基线`);

  return {
    experiment,
    publication,
    metrics,
    metricLabels: METRIC_LABELS,
    baseline,
    feedback,
    /** 有没有任何可以称为「观察」的东西。没有就不该给结论。 */
    hasEvidence: Boolean(metrics) || Boolean(feedback),
    missing,
    problem: (() => {
      const opportunity = workspace.contentBridge.projectOpportunity(experiment.projectId);
      return opportunity ? workspace.contentBridge.audienceProblem(opportunity.audienceProblemId) : null;
    })(),
  };
}

/** 写给模型看的那份「你只能拿这些当观察」。 */
export function describeSettlementEvidence(context) {
  const lines = [];
  lines.push(`# 这次要验证的假设\n${context.experiment.hypothesisMarkdown}`);
  lines.push(context.publication
    ? `\n# 发布记录\n${context.publication.platform} · ${String(context.publication.publishedAt).slice(0, 10)} · ${context.publication.title}`
    : "\n# 发布记录：没有");

  if (context.metrics) {
    const rows = Object.entries(context.metrics.values)
      .map(([key, value]) => `${context.metricLabels[key] || key}=${value}`).join("，");
    lines.push(`\n# 这一篇的数字（${context.metrics.source === "workbench" ? "工作台记录" : "平台导出"}，截至 ${String(context.metrics.capturedAt).slice(0, 10)}）\n${rows}`);
  } else {
    lines.push("\n# 这一篇的数字：一个都没有。**不得凭空说它表现好或不好。**");
  }

  if (context.baseline.available) {
    const rows = Object.entries(context.baseline.values)
      .map(([key, value]) => `${context.metricLabels[key] || key}=${value}`).join("，");
    lines.push(`\n# 同平台过去 ${context.baseline.sampleSize} 篇的中位数\n${rows}`);
  } else {
    lines.push(`\n# 基线：同平台只有 ${context.baseline.sampleSize} 篇可比，**算不出中位数，不得说「高于/低于以往」**。`);
  }

  lines.push(context.feedback
    ? `\n# 收到的真实反馈原话（观察只能引用这里的原文，逐字）\n${context.feedback}`
    : "\n# 真实反馈：一句都没有。**不得说读者怎么想、评论区在讨论什么。**");
  return lines.join("\n");
}
