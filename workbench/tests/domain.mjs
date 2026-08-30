import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalJobRunner } from "../server/jobs/local-job-runner.mjs";
import { startWorkspaceRuntime } from "../server/jobs/workspace-runtime.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { startLocalWorkspaceRuntime } from "../server/vite-plugin-workbench.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-domain-"));
let workspace;
let runtime;
const actor = "user";

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

try {
  const now = new Date("2026-08-29T08:00:00.000Z");
  workspace = await openWorkspace({ xenhoHome: path.join(root, "Xenho"), now });
  const { db, domain, jobs } = workspace;

  check("领域 migration 已创建收集、项目、系列、发布包、AI 和任务表", ["captures", "projects", "content_series", "series_chapters", "release_packages", "action_candidates", "local_jobs"].every((name) => (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  )));
  check("纯打开工作区不会注册或补跑计划", db.prepare("SELECT COUNT(*) AS count FROM local_schedules").get().count === 0);
  check("没有恢复已退出的每日计划表", !db.prepare("SELECT 1 FROM sqlite_master WHERE name LIKE '%daily_plan%'").get());
  assert.throws(() => domain.createCapture({ kind: "thought", title: "缺 actor", now }), /明确提供 actor/);
  check("领域写操作缺少受信 actor 时默认拒绝", true);

  const captureId = domain.createCapture({ kind: "article", title: " 原始收集 ", bodyMarkdown: "一段来源内容", sourceUrl: "https://example.com/source", actor, now });
  const seedId = domain.createSeed({ title: "持续写作", reaction: "我以前也这么以为，后来发现…", sourceEntityId: captureId, actor, now });
  check("标题规范化后在业务表和搜索表一致", db.prepare("SELECT c.title, t.title AS textTitle FROM captures c JOIN entity_text t ON t.entity_id = c.id WHERE c.id = ?").get(captureId).title === "原始收集");
  check("收集状态只能按允许路径变化", domain.transitionCapture(captureId, "flag", { actor, now }) === "needs_review" && domain.transitionCapture(captureId, "accept", { actor, now }) === "accepted");
  assert.throws(() => domain.transitionCapture(captureId, "retry", { actor, now }), /不能执行/);
  const spareSeedId = domain.createSeed({ title: "暂不写的种子", actor, now });
  check("种子可放弃并恢复但不能任意跳转", domain.transitionSeed(spareSeedId, "drop", { actor, now }) === "dropped" && domain.transitionSeed(spareSeedId, "restore", { actor, now }) === "keeping");
  assert.throws(() => domain.createProject({ title: "未确认项目", seedId, actor, now }), /明确确认/);

  const projectId = domain.createProject({
    title: "持续写作项目",
    viewpoint: "稳定的小行动比偶发冲刺更可靠",
    audience: "想建立写作习惯的人",
    primaryPlatform: "公众号",
    seedId,
    confirmed: true,
    actor,
    now,
  });
  check("用户确认后才创建项目且同一种子只能建立一个项目", domain.projectStage(projectId).stage === "策划中");
  assert.throws(() => domain.createProject({ title: "重复项目", seedId, confirmed: true, actor, now }), /攒着|UNIQUE/);
  assert.throws(() => domain.createSeries({ title: "未确认系列", actor, now }), /明确确认/);
  assert.throws(() => domain.createSeries({ title: "", confirmed: true, actor, now }), /不能为空/);
  const seriesId = domain.createSeries({
    title: "从零开始持续写作",
    descriptionMarkdown: "一套从习惯到发布的系列教程",
    audience: "想稳定输出的创作者",
    outcome: "建立一条可以长期执行的写作流程",
    confirmed: true,
    actor,
    now,
  });
  const openingChapterId = domain.addSeriesChapter(seriesId, { title: "先建立最小写作习惯", summary: "从每天十分钟开始", actor, now });
  const publishChapterId = domain.addSeriesChapter(seriesId, { title: "再完成第一次发布", actor, now });
  assert.throws(() => domain.reorderSeriesChapters(seriesId, [openingChapterId], { actor, now }), /完整包含/);
  domain.reorderSeriesChapters(seriesId, [publishChapterId, openingChapterId], { actor, now });
  domain.linkSeriesChapter(seriesId, openingChapterId, projectId, { actor, now });
  const otherSeriesId = domain.createSeries({ title: "另一个系列", confirmed: true, actor, now });
  const otherChapterId = domain.addSeriesChapter(otherSeriesId, { title: "不能重复关联", actor, now });
  assert.throws(() => domain.linkSeriesChapter(otherSeriesId, otherChapterId, projectId, { actor, now }), /已经属于其他系列/);
  check("系列章节可规划、完整排序并且一篇文章只属于一个系列", db.prepare("SELECT position FROM series_chapters WHERE id = ?").get(publishChapterId).position === 1);
  domain.transitionProject(projectId, "park", { actor, now });
  check("项目搁置时保留内容和关系", domain.projectStage(projectId).stage === "已搁置");
  domain.transitionProject(projectId, "resume", { actor, now });
  domain.transitionProject(projectId, "request-generation", { actor, now });
  check("明确请求生成后项目进入生成中", domain.projectStage(projectId).stage === "生成中");

  const pendingQuoteId = domain.createMaterial({
    title: "待核验原话",
    type: "金句/原话",
    bodyMarkdown: "未经来源逐字比对的原话",
    sourceUrl: "https://example.com/source",
    actor,
    now,
  });
  domain.linkMaterial(projectId, pendingQuoteId, { relationKind: "reference", actor, now });
  assert.throws(() => domain.linkMaterial(projectId, pendingQuoteId, { relationKind: "evidence", actor, now }), /待核验素材/);
  assert.throws(() => domain.verifyMaterial(pendingQuoteId, { sourceText: "并不包含", sourceUrl: "https://example.com/source", actor, now }), /未找到逐字一致/);
  domain.verifyMaterial(pendingQuoteId, { sourceText: "正文：未经来源逐字比对的原话。", sourceUrl: "https://example.com/source", actor, now });
  domain.linkMaterial(projectId, pendingQuoteId, { relationKind: "evidence", actor, now });
  check("待核验逐字素材可作参考，人工留存来源哈希后才能作证据", db.prepare("SELECT source_snapshot_sha256 AS hash FROM materials WHERE id = ?").get(pendingQuoteId).hash.length === 64);

  const fabricatedText = "去年我和一个客户吃饭，他告诉我已经赚到一百万。";
  const fabricatedPayload = { title: "伪造经历", type: "个人经历", bodyMarkdown: fabricatedText, sourceUrl: "", sourceText: "", sourceEntityId: null, origin: "manual", importedVerification: null, importBatchId: null };
  const fabricatedCandidate = domain.actions.propose({ actionType: "material.create", payload: fabricatedPayload, now });
  domain.actions.confirm(fabricatedCandidate.id, { now });
  assert.throws(() => domain.createMaterial({ ...fabricatedPayload, actor: "ai", candidateId: fabricatedCandidate.id, now }), (error) => error.code === "UNGROUNDED_PERSONAL_EXPERIENCE");
  check("AI 不能先伪造个人经历素材再把它作为正文自证据", true);
  assert.throws(() => domain.createMaterial({ title: "伪导入", type: "金句/原话", bodyMarkdown: "伪导入", origin: "import", importedVerification: { status: "已核验" }, importBatchId: "fake", actor, now }), /受信迁移器/);
  check("普通领域调用不能自报导入核验状态", true);

  const experienceText = "去年我开始每天写作，连续写了一百天。";
  const experienceId = domain.createMaterial({ title: "真实写作经历", type: "个人经历", bodyMarkdown: experienceText, actor, now });
  domain.linkMaterial(projectId, experienceId, { relationKind: "evidence", actor, now });

  const draftPayload = { projectId, title: "每天写一点", bodyMarkdown: experienceText, platform: "公众号", parentDraftId: null, generated: true };
  const draftCandidate = domain.actions.propose({ actionType: "draft.create", targetId: projectId, payload: draftPayload, now });
  assert.throws(() => domain.createDraft({ ...draftPayload, actor: "ai", candidateId: draftCandidate.id, now }), /必须先由用户确认/);
  domain.actions.confirm(draftCandidate.id, { now });
  const draftId = domain.createDraft({ ...draftPayload, actor: "ai", candidateId: draftCandidate.id, now });
  const replayDraftId = domain.createDraft({ ...draftPayload, actor: "ai", candidateId: draftCandidate.id, now });
  check("AI 生成稿经确认和硬闸后只写一次，重试返回原结果", draftId === replayDraftId && db.prepare("SELECT COUNT(*) AS count FROM drafts WHERE project_id = ?").get(projectId).count === 1);
  check("生成完成后项目回到写作中并留下首个修订", domain.projectStage(projectId).stage === "写作中" && db.prepare("SELECT COUNT(*) AS count FROM revisions WHERE entity_id = ?").get(draftId).count === 1);
  domain.softDeleteEntity(projectId, { actor, now });
  assert.throws(() => domain.updateDraft(draftId, { title: "回收站暗改", bodyMarkdown: experienceText, actor, now }), /回收站/);
  domain.restoreEntity(projectId, { actor, now });
  check("项目进入回收站后所属稿件不能暗中修改", db.prepare("SELECT title FROM drafts WHERE id = ?").get(draftId).title === "每天写一点");

  const otherProjectId = domain.createProject({ title: "另一项目", confirmed: true, actor, now });
  const otherDraftId = domain.createDraft({ projectId: otherProjectId, title: "另一主稿", actor, now });
  assert.throws(() => domain.setPrimaryDraft(projectId, otherDraftId, { actor, now }), /同一个项目/);
  check("主稿不能指向另一个项目的稿件", true);

  const globalExperience = "前年我连续记录了九十天阅读笔记。";
  domain.createMaterial({ title: "未挂项目的真实经历", type: "个人经历", bodyMarkdown: globalExperience, actor, now });
  const globalPayload = { title: "阅读记录", bodyMarkdown: globalExperience, generated: true, reason: "ai rewrite" };
  const globalCandidate = domain.actions.propose({ actionType: "draft.update", targetId: draftId, payload: globalPayload, now });
  domain.actions.confirm(globalCandidate.id, { now });
  domain.updateDraft(draftId, { ...globalPayload, actor: "ai", candidateId: globalCandidate.id, now });
  check("整个工作区已存在的个人经历都可作为真实性证据", domain.actions.get(globalCandidate.id).status === "applied");

  const stalePayload = { title: "候选标题", bodyMarkdown: experienceText, generated: true, reason: "ai rewrite" };
  const stale = domain.actions.propose({ actionType: "draft.update", targetId: draftId, payload: stalePayload, now });
  domain.actions.confirm(stale.id, { now });
  domain.updateDraft(draftId, { title: "用户先改了", bodyMarkdown: globalExperience, reason: "user edit", actor, now });
  assert.throws(() => domain.updateDraft(draftId, { ...stalePayload, actor: "ai", candidateId: stale.id, now }), /需要重新确认/);
  check("同一毫秒内写入也会递增版本并使旧候选失效", domain.actions.get(stale.id).status === "stale");

  const unsafePayload = { title: "编造经历", bodyMarkdown: fabricatedText, generated: true, reason: "ai rewrite" };
  const unsafe = domain.actions.propose({ actionType: "draft.update", targetId: draftId, payload: unsafePayload, now });
  domain.actions.confirm(unsafe.id, { now });
  assert.throws(() => domain.updateDraft(draftId, { ...unsafePayload, actor: "ai", candidateId: unsafe.id, now }), (error) => error.code === "UNGROUNDED_PERSONAL_EXPERIENCE");
  check("用户确认也不能绕过真实性硬闸", db.prepare("SELECT title FROM drafts WHERE id = ?").get(draftId).title === "用户先改了");

  assert.throws(() => domain.transitionDraft(draftId, "finish-writing", { actor, now }), /发布包缺少摘要/);
  domain.upsertReleasePackage(draftId, { summary: "一段可发布摘要", coverText: "每天写一点", keywords: ["写作", "习惯", "写作"], actor, now });
  assert.throws(() => domain.upsertReleasePackage(draftId, { summary: "x".repeat(501), actor, now }), /长度限制/);
  domain.transitionDraft(draftId, "finish-writing", { actor, now });
  check("有正文且发布包摘要完整后才能进入待发布", domain.projectStage(projectId).stage === "待发布");

  const publicationInput = {
    title: "每天写一点",
    platform: "公众号",
    publishedUrl: "https://example.com/published",
    publishedAt: "2026-08-29T09:00:00.000Z",
    idempotencyKey: "publish:project-one:v1",
    metadata: { source: "manual" },
    actor,
    now,
  };
  assert.throws(() => domain.publishDraft(draftId, { ...publicationInput, publishedAt: "", idempotencyKey: "publish:missing-time" }), /发布时间不能为空/);
  const publication = domain.publishDraft(draftId, publicationInput);
  const replay = domain.publishDraft(draftId, publicationInput);
  const publicationRow = db.prepare("SELECT revision_id AS revisionId, content_sha256 AS hash FROM publication_records WHERE id = ?").get(publication.publicationId);
  check("发布幂等重放不会重复写且固定到实际修订哈希", publication.publicationId === replay.publicationId && publicationRow.revisionId && publicationRow.hash.length === 64);
  assert.throws(() => domain.publishDraft(draftId, { ...publicationInput, title: "不同内容" }), /不同发布内容/);
  check("发布后项目进入待复盘", domain.projectStage(projectId).stage === "待复盘");
  domain.softDeleteEntity(draftId, { actor, now });
  assert.throws(() => domain.recordMetrics(publication.publicationId, { views: 1, actor, now }), /回收站/);
  domain.restoreEntity(draftId, { actor, now });
  check("稿件进入回收站后不能继续写入发布指标", true);
  assert.throws(() => domain.submitPublicationReview(publication.publicationId, { status: "普通", basisMarkdown: "", conclusionMarkdown: "结论", nextExperimentMarkdown: "实验", actor, now }), /复盘依据不能为空/);
  assert.throws(() => domain.submitPublicationReview(publication.publicationId, { status: "已沉淀", basisMarkdown: "依据", conclusionMarkdown: "结论", nextExperimentMarkdown: "实验", actor, now }), /状态不合法/);
  const reviewResult = domain.submitPublicationReview(publication.publicationId, {
    metrics: { views: 100, likes: 10, capturedAt: now },
    status: "表现突出",
    basisMarkdown: "阅读 100，点赞 10。",
    conclusionMarkdown: "稳定写作有清晰反馈。",
    nextExperimentMarkdown: "下一篇测试更具体的开头。",
    actor,
    now,
  });
  check("指标与完整复盘在一个事务内提交", reviewResult.metricId && reviewResult.reviewId && domain.projectStage(projectId).stage === "已完成");
  const unsafeSettlePayload = {
    feedback: [
      { type: "标题样本", title: "每天写一点", bodyMarkdown: "具体承诺型标题。" },
      { type: "内容角度", title: "小行动的复利", bodyMarkdown: "从可持续性展开。" },
      { type: "平台反馈", title: "虚构的平台反馈", bodyMarkdown: "去年我和一个客户吃饭，他告诉我已经赚到一百万。" },
    ],
    storyMaterialIds: [experienceId],
  };
  const unsafeSettleCandidate = domain.actions.propose({ actionType: "review.settle", targetId: reviewResult.reviewId, payload: unsafeSettlePayload, now });
  domain.actions.confirm(unsafeSettleCandidate.id, { now });
  assert.throws(() => domain.settleReview(reviewResult.reviewId, { ...unsafeSettlePayload, confirmed: true, actor: "ai", candidateId: unsafeSettleCandidate.id, now }), (error) => error.code === "UNGROUNDED_PERSONAL_EXPERIENCE");
  check("AI 复盘反馈即使确认也不能绕过真实性硬闸", true);

  const settled = domain.settleReview(reviewResult.reviewId, {
    feedback: [
      { type: "标题样本", title: "每天写一点", bodyMarkdown: "具体承诺型标题。" },
      { type: "内容角度", title: "小行动的复利", bodyMarkdown: "从可持续性展开。" },
      { type: "平台反馈", title: "本次平台反馈", bodyMarkdown: "读者更喜欢具体开头。" },
    ],
    storyMaterialIds: [experienceId],
    confirmed: true,
    actor,
    now,
  });
  const settledAgain = domain.settleReview(reviewResult.reviewId, {
    feedback: [
      { type: "标题样本", title: "每天写一点", bodyMarkdown: "具体承诺型标题。" },
      { type: "内容角度", title: "小行动的复利", bodyMarkdown: "从可持续性展开。" },
      { type: "平台反馈", title: "本次平台反馈", bodyMarkdown: "读者更喜欢具体开头。" },
    ],
    storyMaterialIds: [experienceId],
    confirmed: true,
    actor,
    now,
  });
  assert.throws(() => domain.settleReview(reviewResult.reviewId, {
    feedback: [
      { type: "标题样本", title: "不同标题", bodyMarkdown: "具体承诺型标题。" },
      { type: "内容角度", title: "小行动的复利", bodyMarkdown: "从可持续性展开。" },
      { type: "平台反馈", title: "本次平台反馈", bodyMarkdown: "读者更喜欢具体开头。" },
    ],
    storyMaterialIds: [experienceId],
    confirmed: true,
    actor,
    now,
  }), /不同内容/);
  assert.throws(() => domain.submitPublicationReview(publication.publicationId, { status: "普通", basisMarkdown: "依据", conclusionMarkdown: "结论", nextExperimentMarkdown: "实验", actor, now }), /不能直接覆盖/);
  check("表现突出复盘确定性沉淀三类反馈并标记有效故事，重试不重复", settled.feedbackMaterialIds.join() === settledAgain.feedbackMaterialIds.join()
    && db.prepare("SELECT COUNT(*) AS count FROM review_materials WHERE review_id = ?").get(reviewResult.reviewId).count === 3
    && db.prepare("SELECT COUNT(*) AS count FROM review_story_materials WHERE review_id = ?").get(reviewResult.reviewId).count === 1);

  domain.softDeleteEntity(reviewResult.reviewId, { actor, now });
  check("复盘进入回收站后不再计入项目完成状态", domain.projectStage(projectId).stage === "待复盘");
  domain.restoreEntity(reviewResult.reviewId, { actor, now });
  check("恢复复盘后项目读模型恢复且版本递增", domain.projectStage(projectId).stage === "已完成");
  assert.throws(() => db.prepare("INSERT INTO metric_snapshots(id, publication_id, captured_at, views, raw_json) VALUES ('bad-metric', ?, ?, -1, '{}')").run(publication.publicationId, now.toISOString()), /CHECK/);
  check("SQLite 本身拒绝负指标", true);

  const first = jobs.enqueue({ idempotencyKey: "job:one", kind: "pipeline.dispatch", payload: { batch: 1, optional: undefined }, dueAt: now, now });
  const duplicate = jobs.enqueue({ idempotencyKey: "job:one", kind: "pipeline.dispatch", payload: { batch: 1 }, dueAt: now, now });
  check("JSON-safe 哈希与任务幂等键对 undefined 一致", first.created && !duplicate.created);
  const claimed = jobs.claim({ leaseOwner: "runner-a", now });
  assert.throws(() => jobs.complete(claimed.id, { leaseOwner: "runner-a", leaseToken: "wrong", now }), /有效租约/);
  jobs.fail(claimed.id, { leaseOwner: "runner-a", leaseToken: claimed.leaseToken, error: "temporary", retryDelaySeconds: 60, now });
  const retried = jobs.claim({ leaseOwner: "runner-b", now: new Date(now.getTime() + 61_000) });
  assert.throws(() => jobs.complete(retried.id, { leaseOwner: "runner-a", leaseToken: claimed.leaseToken, now: new Date(now.getTime() + 62_000) }), /有效租约/);
  jobs.complete(retried.id, { leaseOwner: "runner-b", leaseToken: retried.leaseToken, result: { ok: true }, now: new Date(now.getTime() + 62_000) });
  check("租约重领后旧 token 无法完成任务", jobs.get(retried.id).status === "done" && jobs.get(retried.id).attempt === 2);

  const exhausted = jobs.enqueue({ idempotencyKey: "job:exhausted", kind: "pipeline.dispatch", payload: { final: true }, dueAt: now, maxAttempts: 1, now }).job;
  jobs.claim({ leaseOwner: "runner-a", leaseSeconds: 30, now });
  jobs.claim({ leaseOwner: "runner-b", now: new Date(now.getTime() + 31_000) });
  check("最后一次租约过期后明确结为失败", jobs.get(exhausted.id).status === "failed");

  const unknown = jobs.enqueue({ idempotencyKey: "job:unknown", kind: "unknown.kind", payload: {}, dueAt: now, now }).job;
  const runner = new LocalJobRunner(jobs);
  await runner.runNext({ leaseOwner: "runner-unknown", now });
  check("未知任务类型不会被当作成功或无限重试", jobs.get(unknown.id).status === "failed");

  let clock = new Date("2026-08-30T08:00:00.000Z");
  const handlers = {
    "pipeline.dispatch": async () => ({ candidateOnly: true }),
    "materials.synthesize": async () => ({ candidateOnly: true }),
  };
  runtime = startWorkspaceRuntime(workspace, { handlers, now: () => clock, pollIntervalMs: 60_000 });
  const initialRun = await runtime.ready;
  check("显式启动运行时后才注册并补跑允许列表中的本地任务", initialRun.startupJobs.length === 2 && initialRun.results.every((job) => job.result?.candidateOnly));
  clock = new Date(clock.getTime() + 86_400_000);
  const nextRun = await runtime.tick();
  const repeatedRun = await runtime.tick();
  check("运行期间到期计划会继续执行且重复 tick 不重复写", nextRun.startupJobs.length === 2 && repeatedRun.startupJobs.length === 0);
  await runtime.stop();
  runtime = null;

  const productionRuntime = await startLocalWorkspaceRuntime({ XENHO_HOME: path.join(root, "ProductionRuntime") });
  const productionReady = await productionRuntime.runtime.ready;
  check("真实 Vite 启动入口会打开隔离工作区并执行默认候选扫描", productionReady.startupJobs.length === 2
    && productionReady.results.every((job) => job.status === "done" && job.result?.mode === "candidate-input-scan"));
  await productionRuntime.runtime.stop();
  productionRuntime.workspace.close();
  check("数据库完整性和外键仍通过", workspace.check().ok);
  console.log("\n ✓ 本地域规则、确认边界、发布追溯、复盘事务与持久任务全部通过");
} finally {
  if (runtime) await runtime.stop();
  if (workspace?.db?.open) workspace.close();
  await fs.rm(root, { recursive: true, force: true });
}
