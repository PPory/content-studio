import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_STAGES,
  buildContentProject,
  chooseMasterDraft,
  deriveProjectStage,
  nextDraftWorkflow,
  draftReadyToFinish,
} from "../src/lib/content-project.js";

const topic = (fields = {}) => ({
  id: "01TOPIC0000000000000000000",
  title: "一个选题",
  viewpoint: "核心观点",
  audience: "目标读者",
  notes: "写作要点",
  platform: "公众号",
  priority: "中",
  status: "待写",
  updated_at: 1_786_000_000,
  ...fields,
});

const draft = (fields = {}) => ({
  id: "01DRAFT0000000000000000000",
  topic_id: "01TOPIC0000000000000000000",
  headline: "一篇稿件",
  summary: "摘要",
  body: "# 正文",
  platform: "公众号",
  status: "待修改",
  workflow_status: "写作中",
  published_url: "",
  published_at: "",
  views: null,
  likes: null,
  comments: null,
  collects: null,
  shares: null,
  performance_summary: "",
  feedback_status: "未评估",
  review_conclusion: "",
  next_experiment: "",
  reviewed_at: "",
  cover_url: "",
  cover_text: "",
  cover_note: "",
  keywords_json: "[]",
  interaction_goal: "",
  updated_at: 1_786_000_010,
  ...fields,
});

test("内容项目阶段是固定契约，创作门槛有明确阶段", () => {
  assert.deepEqual(PROJECT_STAGES, ["策划中", "生成中", "写作中", "待发布", "待复盘", "已完成", "已搁置", "需处理"]);
  assert.ok(!PROJECT_STAGES.includes("待修改"));
  assert.ok(PROJECT_STAGES.includes("待发布"));
  // ⚠️ 「待诊断」是撤掉的那一档：它在这个 Worker 里没有任何实现，
  // 全部含义是"发出去前你自己再读一遍"。**没有工具的闸门只是一个多出来的状态。**
  assert.ok(!PROJECT_STAGES.includes("待诊断"));
});

test("只有一篇稿件时直接作为母版", () => {
  const only = draft();
  assert.deepEqual(chooseMasterDraft(topic(), [only]), { master: only, variants: [], blocker: null });
});

test("多稿件时只有唯一匹配选题主平台才能确定母版", () => {
  const primary = draft({ id: "primary", platform: "公众号" });
  const variant = draft({ id: "variant", platform: "X" });
  const selected = chooseMasterDraft(topic(), [variant, primary]);
  assert.equal(selected.master.id, "primary");
  assert.deepEqual(selected.variants.map((item) => item.id), ["variant"]);
  assert.equal(selected.blocker, null);
});

test("多稿件仍有歧义时必须要求确认母版，不按新旧猜", () => {
  const selected = chooseMasterDraft(topic(), [
    draft({ id: "older", updated_at: 100 }),
    draft({ id: "newer", updated_at: 200 }),
  ]);
  assert.equal(selected.master, null);
  assert.equal(selected.blocker, "需确认母版");
  assert.deepEqual(selected.variants.map((item) => item.id), ["newer", "older"]);
});

test("已确认的 primary_draft_id 是唯一母版依据", () => {
  const primary = draft({ id: "chosen", platform: "X" });
  const other = draft({ id: "other", platform: "公众号" });
  const selected = chooseMasterDraft(topic({ primary_draft_id: "chosen" }), [other, primary]);
  assert.equal(selected.master.id, "chosen");
  assert.deepEqual(selected.variants.map((item) => item.id), ["other"]);

  const broken = chooseMasterDraft(topic({ primary_draft_id: "missing" }), [other]);
  assert.equal(broken.master, null);
  assert.match(broken.blocker, /不在这个项目/);
});

test("待写选题没有稿件时处于策划中，并明示简报缺口", () => {
  const state = deriveProjectStage({ topic: topic({ audience: "", viewpoint: "" }), drafts: [] });
  assert.equal(state.stage, "策划中");
  assert.equal(state.nextAction, "补全创作简报");
  assert.deepEqual(state.blockers, ["缺少目标读者", "缺少核心观点"]);
});

test("撰写中选题尚无稿件时是生成中", () => {
  const state = deriveProjectStage({ topic: topic({ status: "撰写中" }), drafts: [] });
  assert.equal(state.stage, "生成中");
  assert.equal(state.nextAction, "等待初稿");
});

test("旧待修改稿安全兼容为写作中", () => {
  const state = deriveProjectStage({ topic: topic({ status: "已成稿" }), drafts: [draft({ body: "已经写了一些" })] });
  assert.equal(state.stage, "写作中");
  assert.match(state.stageReason, /正在编辑/);
});

/**
 * ⚠️ **空稿要说出来，而且不能装成"正在编辑"。**
 * 工作台的「建立空白主稿」建的是 `body=''` 的空壳。它和一篇写了一半的稿子在库里
 * 唯一的区别就是这个长度——不区分的话，界面对着一个空文件说「主稿正在编辑」。
 * 库里真出过：6 篇稿子有 3 篇正文长度是 0。
 */
test("空主稿照实说是空的", () => {
  const state = deriveProjectStage({ topic: topic({ status: "已成稿" }), drafts: [draft({ body: "" })] });
  assert.equal(state.stage, "写作中");
  assert.match(state.stageReason, /空的/);
  assert.match(state.nextAction, /开始写/);
});

test("空稿不许进待发布，写了字才行", () => {
  assert.equal(draftReadyToFinish({ body: "有内容" }), true);
  assert.equal(draftReadyToFinish({ body: "   \n  " }), false);
  assert.equal(draftReadyToFinish({ body: "" }), false);
  assert.equal(draftReadyToFinish({}), false);
});

test("稿件创作状态直接决定待发布", () => {
  assert.equal(deriveProjectStage({ topic: topic({ status: "已成稿" }), drafts: [draft({ workflow_status: "待发布" })] }).stage, "待发布");
});

/**
 * ⚠️ **库里的历史值「待诊断」要当「写作中」读。**
 * CHECK 约束里还留着这个值（改 CHECK 要重建表，不值得），所以旧行还会出现。
 * 不翻译的话它们一个分支都命中不了，最后掉进「需处理」——而「需处理」的意思是
 * "关系有歧义，需要你决定"，那是句假话：它们只是状态旧了。
 */
test("历史值待诊断读出来是写作中", () => {
  const state = deriveProjectStage({ topic: topic({ status: "已成稿" }), drafts: [draft({ workflow_status: "待诊断", body: "有正文" })] });
  assert.equal(state.stage, "写作中");
});

test("阶段命令只允许相邻门槛和明确退回", () => {
  assert.equal(nextDraftWorkflow("写作中", "finish-writing"), "待发布");
  assert.equal(nextDraftWorkflow("待发布", "return-writing"), "写作中");
  // 历史值只出不进：旧行要走得出去，但没有任何命令能把它写回去
  assert.equal(nextDraftWorkflow("待诊断", "finish-writing"), "待发布");
  assert.equal(nextDraftWorkflow("待诊断", "return-writing"), "写作中");
  assert.ok(!Object.values({ a: nextDraftWorkflow("写作中", "finish-writing"), b: nextDraftWorkflow("待发布", "return-writing") }).includes("待诊断"));
  assert.throws(() => nextDraftWorkflow("待发布", "finish-writing"), /不能执行/);
  assert.throws(() => nextDraftWorkflow("写作中", "submit-diagnosis"), /action 不合法/);
  assert.throws(() => nextDraftWorkflow("写作中", "approve-diagnosis"), /action 不合法/);
  assert.throws(() => nextDraftWorkflow("写作中", "unknown"), /action 不合法/);
});

test("完整发布记录尚无表现判断时是待复盘", () => {
  const published = draft({ status: "已发布", published_url: "https://example.com/p", published_at: "2026-08-20T08:00:00.000Z" });
  const state = deriveProjectStage({ topic: topic({ status: "已发布" }), drafts: [published] });
  assert.equal(state.stage, "待复盘");
  assert.equal(state.publication.status, "已发布");
  assert.equal(state.nextAction, "开始复盘");
});

test("只有表现状态、复盘判断和下一次实验都存在时才是已完成", () => {
  const reviewed = draft({
    status: "已发布",
    published_url: "https://example.com/p",
    published_at: "2026-08-20T08:00:00.000Z",
    feedback_status: "普通",
    performance_summary: "阅读量与同平台近三篇相当。",
    review_conclusion: "开头没有带来明显改善。",
    next_experiment: "下一篇只替换成案例开头。",
    reviewed_at: "2026-08-21T08:00:00.000Z",
  });
  assert.equal(deriveProjectStage({ topic: topic({ status: "已发布" }), drafts: [reviewed] }).stage, "已完成");

  const missingConclusion = { ...reviewed, review_conclusion: "" };
  const state = deriveProjectStage({ topic: topic({ status: "已发布" }), drafts: [missingConclusion] });
  assert.equal(state.stage, "待复盘");
  assert.deepEqual(state.blockers, ["缺少复盘判断"]);

  const missingExperiment = { ...reviewed, next_experiment: "" };
  assert.deepEqual(
    deriveProjectStage({ topic: topic({ status: "已发布" }), drafts: [missingExperiment] }).blockers,
    ["缺少下一篇实验"]
  );
});

test("已发布却缺链接或时间的记录进入需处理", () => {
  const state = deriveProjectStage({
    topic: topic({ status: "已发布" }),
    drafts: [draft({ status: "已发布", published_url: "", published_at: "" })],
  });
  assert.equal(state.stage, "需处理");
  assert.ok(state.blockers.some((item) => item.includes("缺少发布链接")));
  assert.ok(state.blockers.some((item) => item.includes("缺少发布时间")));
});

test("发布信息和选题或稿件状态打架时进入需处理", () => {
  const detailsWithoutStatus = deriveProjectStage({
    topic: topic(),
    drafts: [draft({ published_url: "https://example.com/p", published_at: "2026-08-20T08:00:00.000Z" })],
  });
  assert.equal(detailsWithoutStatus.stage, "需处理");
  assert.match(detailsWithoutStatus.stageReason, /状态不是已发布/);

  const publishedDraftWithWritingTopic = deriveProjectStage({
    topic: topic({ status: "已成稿" }),
    drafts: [draft({ status: "已发布", published_url: "https://example.com/p", published_at: "2026-08-20T08:00:00.000Z" })],
  });
  assert.equal(publishedDraftWithWritingTopic.stage, "需处理");
  assert.match(publishedDraftWithWritingTopic.stageReason, /选题状态不是已发布/);
});

test("选题声称已成稿但没有关联稿件时进入需处理", () => {
  const state = deriveProjectStage({ topic: topic({ status: "已成稿" }), drafts: [] });
  assert.equal(state.stage, "需处理");
  assert.match(state.stageReason, /没有找到关联稿件/);
});

test("孤立稿件以 draft:<id> 稳定显示为内容项目", () => {
  const orphan = draft({ topic_id: null });
  const project = buildContentProject({ drafts: [orphan] });
  assert.equal(project.id, `draft:${orphan.id}`);
  assert.equal(project.topic, null);
  assert.equal(project.masterDraft.id, orphan.id);
  assert.equal(project.stage, "写作中");
});

test("聚合读模型包含前端不应二次推导的全部契约字段", () => {
  const project = buildContentProject({ topic: topic(), drafts: [draft()], materials: [], sources: [] });
  for (const key of [
    "id", "title", "stage", "stageReason", "nextAction", "blockers", "brief", "topic",
    "masterDraft", "variants", "materials", "sources", "publication", "review", "updatedAt",
    "releaseOptions",
  ]) assert.ok(Object.hasOwn(project, key), `缺少 ${key}`);
  assert.equal(project.masterDraft.release.spec.platform, "公众号");
});
