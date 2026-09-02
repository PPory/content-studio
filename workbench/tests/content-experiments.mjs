import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { WORKSPACE_SCHEMA_VERSION } from "../server/storage/migrations.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-content-experiments-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-02T08:00:00.000Z");
const actor = "user";

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

const workspace = await openWorkspace({ xenhoHome });
const { domain, experiments, contentBridge } = workspace;

try {
  check("工作区 Schema 已升级到内容实验版本", WORKSPACE_SCHEMA_VERSION === 14);

  const projectId = domain.createProject({ title: "为什么我越写越不敢下判断", confirmed: true, actor, now });
  const draftId = domain.createDraft({ projectId, title: "主稿", actor, now });
  domain.updateDraft(draftId, { title: "主稿", bodyMarkdown: "# 主稿\n\n一段足够长的正文，用来通过发布前的检查。", reason: "user edit", actor, now });
  domain.upsertReleasePackage(draftId, { summary: "一段可发布摘要", coverText: "封面", keywords: ["写作"], actor, now });
  domain.transitionDraft(draftId, "finish-writing", { actor, now });

  assert.throws(() => experiments.recordHypothesis({ projectId, hypothesisMarkdown: "会有效", actor, now }), /明确确认/);
  assert.throws(() => experiments.recordHypothesis({ projectId, hypothesisMarkdown: "", actor, confirmed: true, now }), /内容假设不能为空/);

  // 事前假设：记在发布之前
  const beforeId = experiments.recordHypothesis({
    projectId,
    hypothesisMarkdown: "用真实问题当入口，会比直接讲概念更容易被收藏。",
    actor,
    confirmed: true,
    now: new Date("2026-09-02T08:00:00.000Z"),
  });
  check("假设记下来时还是开放状态", experiments.experiment(beforeId).verdict === "open" && experiments.experiment(beforeId).settledAt === null);

  /**
   * 发布链接可以为空：视频号、群发这类地方拿不到链接，
   * 但「发出去了」这件事必须能登记，否则后面的实验和复盘全断在这儿。
   */
  const draftNoUrl = domain.createDraft({ projectId, title: "无链接平台版", actor, now });
  domain.updateDraft(draftNoUrl, { title: "无链接平台版", bodyMarkdown: "# 正文" + String.fromCharCode(10, 10) + "一段足够长的正文。", reason: "user edit", actor, now });
  domain.upsertReleasePackage(draftNoUrl, { summary: "摘要", actor, now });
  domain.transitionDraft(draftNoUrl, "finish-writing", { actor, now });
  const noUrl = domain.publishDraft(draftNoUrl, {
    title: "没有链接的一次发布",
    platform: "视频号",
    publishedUrl: "",
    publishedAt: "2026-09-02T09:00:00.000Z",
    idempotencyKey: "publish:no-url:v1",
    actor,
    now: new Date("2026-09-02T09:00:00.000Z"),
  });
  check("没有链接也能登记发布", Boolean(noUrl.publicationId)
    && workspace.db.prepare("SELECT published_url AS url FROM publication_records WHERE id=?").get(noUrl.publicationId).url === "");
  assert.throws(() => domain.publishDraft(draftNoUrl, {
    title: "坏链接", platform: "视频号", publishedUrl: "不是网址", publishedAt: "2026-09-02T09:00:00.000Z",
    idempotencyKey: "publish:bad-url:v1", actor, now,
  }), /必须是有效网址/);

  const publication = domain.publishDraft(draftId, {
    title: "为什么我越写越不敢下判断",
    platform: "公众号",
    publishedUrl: "https://example.com/one",
    publishedAt: "2026-09-02T10:00:00.000Z",
    idempotencyKey: "publish:experiment:v1",
    actor,
    now: new Date("2026-09-02T10:00:00.000Z"),
  });

  // 事后假设：记在发布之后
  const afterId = experiments.recordHypothesis({
    projectId,
    hypothesisMarkdown: "我早就知道这样会成。",
    actor,
    confirmed: true,
    now: new Date("2026-09-02T12:00:00.000Z"),
  });

  /**
   * 这条是整个学习闭环的地基：发布之后补的假设一定和结果吻合，
   * 允许它就等于允许把复盘写成自我确认。
   */
  assert.throws(() => experiments.settleExperiment(afterId, {
    publicationId: publication.publicationId,
    outcomeMarkdown: "阅读量一般，收藏率偏高。",
    learningMarkdown: "真实问题入口更适合沉淀型内容。",
    verdict: "supported",
    actor,
    confirmed: true,
    now,
  }), /假设必须在发布前写下/);
  check("发布之后补的假设不能用来验证这次发布", experiments.experiment(afterId).verdict === "open");

  assert.throws(() => experiments.settleExperiment(beforeId, {
    publicationId: publication.publicationId,
    outcomeMarkdown: "阅读量一般。",
    learningMarkdown: "学到了。",
    verdict: "看起来还行",
    actor,
    confirmed: true,
    now,
  }), /supported、mixed 或 refuted/);
  assert.throws(() => experiments.settleExperiment(beforeId, {
    publicationId: publication.publicationId,
    outcomeMarkdown: "阅读量一般。",
    learningMarkdown: "",
    verdict: "mixed",
    actor,
    confirmed: true,
    now,
  }), /我更新了什么判断不能为空/);

  experiments.settleExperiment(beforeId, {
    publicationId: publication.publicationId,
    outcomeMarkdown: "阅读量和平时差不多，但收藏率是过去的两倍。",
    learningMarkdown: "真实问题入口更适合沉淀型内容，不一定扩大初始曝光。",
    verdict: "mixed",
    actor,
    confirmed: true,
    now: new Date("2026-09-03T08:00:00.000Z"),
  });
  const settled = experiments.experiment(beforeId);
  check("结算后同时记住发生了什么和学到了什么", settled.verdict === "mixed"
    && settled.settledAt
    && settled.outcomeMarkdown.includes("收藏率")
    && settled.learningMarkdown.includes("沉淀型"));
  check("结算把实验和那次发布绑定", settled.publicationId === publication.publicationId && settled.publishedAt === "2026-09-02T10:00:00.000Z");

  assert.throws(() => experiments.settleExperiment(beforeId, {
    outcomeMarkdown: "再来一次", learningMarkdown: "再学一次", verdict: "supported", actor, confirmed: true, now,
  }), /已经结算过/);
  assert.throws(() => experiments.updateHypothesis(beforeId, { hypothesisMarkdown: "改个说法", actor, confirmed: true, now }), /不能再改假设/);
  check("结算之后既不能重算也不能回头改假设", experiments.experiment(beforeId).hypothesisMarkdown.includes("更容易被收藏"));

  // 反馈回流：学到的东西变成一条真实用户问题，并记住是从哪次实验来的
  const problemId = contentBridge.createAudienceProblem({
    statement: "为什么我收藏了一堆写作方法，真下笔还是卡住？",
    sourceKind: "feedback",
    sourceRef: `experiment:${beforeId}`,
    pattern: "feedback",
    sources: [{ sourceKind: "feedback", sourceId: `experiment:${beforeId}`, evidenceText: "我收藏了一堆方法，真下笔还是卡住。", observedAt: now }],
    actor,
    confirmed: true,
    now,
  });
  assert.throws(() => experiments.linkProblem(beforeId, problemId, { actor, now }), /明确确认/);
  experiments.linkProblem(beforeId, problemId, { actor, confirmed: true, now });
  experiments.linkProblem(beforeId, problemId, { actor, confirmed: true, now });
  const linked = experiments.linkedProblems(beforeId);
  check("学到的东西可以回流成用户问题，且重复关联幂等", linked.length === 1 && linked[0].id === problemId && linked[0].origin === "observed");

  check("按项目和开放状态筛选实验", experiments.experiments({ projectId }).length === 2
    && experiments.experiments({ projectId, openOnly: true }).length === 1);

  const audit = workspace.db.prepare("SELECT event_type AS action FROM audit_events WHERE event_type LIKE 'content_experiment.%' ORDER BY rowid").all().map((row) => row.action);
  check("实验的每次写入都进了审计", audit.includes("content_experiment.recorded")
    && audit.includes("content_experiment.settled")
    && audit.includes("content_experiment.problem_linked"));

  const integrity = workspace.check();
  check("数据库完整性与外键检查通过", integrity.ok);
} finally {
  workspace.close();
  await fs.rm(root, { recursive: true, force: true });
}

console.log("\n内容实验（学习闭环）领域测试通过。\n");
