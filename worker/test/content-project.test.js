import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_STAGES,
  buildContentProject,
  chooseMasterDraft,
  deriveProjectStage,
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
  published_url: "",
  published_at: "",
  views: null,
  likes: null,
  comments: null,
  collects: null,
  shares: null,
  performance_summary: "",
  feedback_status: "未评估",
  updated_at: 1_786_000_010,
  ...fields,
});

test("内容项目阶段是固定契约，不暴露现有稿件状态", () => {
  assert.deepEqual(PROJECT_STAGES, ["策划中", "生成中", "写作中", "待复盘", "已完成", "需处理"]);
  assert.ok(!PROJECT_STAGES.includes("待修改"));
  assert.ok(!PROJECT_STAGES.includes("待发布"));
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

test("待修改稿件只能判为写作中，不能猜成待诊断或待发布", () => {
  const state = deriveProjectStage({ topic: topic({ status: "已成稿" }), drafts: [draft()] });
  assert.equal(state.stage, "写作中");
  assert.match(state.stageReason, /不足以证明/);
});

test("完整发布记录尚无表现判断时是待复盘", () => {
  const published = draft({ status: "已发布", published_url: "https://example.com/p", published_at: "2026-08-20T08:00:00.000Z" });
  const state = deriveProjectStage({ topic: topic({ status: "已发布" }), drafts: [published] });
  assert.equal(state.stage, "待复盘");
  assert.equal(state.publication.status, "已发布");
  assert.equal(state.nextAction, "开始复盘");
});

test("只有表现状态和复盘结论都存在时才是已完成", () => {
  const reviewed = draft({
    status: "已发布",
    published_url: "https://example.com/p",
    published_at: "2026-08-20T08:00:00.000Z",
    feedback_status: "普通",
    performance_summary: "阅读正常，下篇改进开头。",
  });
  assert.equal(deriveProjectStage({ topic: topic({ status: "已发布" }), drafts: [reviewed] }).stage, "已完成");

  const missingConclusion = { ...reviewed, performance_summary: "" };
  const state = deriveProjectStage({ topic: topic({ status: "已发布" }), drafts: [missingConclusion] });
  assert.equal(state.stage, "待复盘");
  assert.deepEqual(state.blockers, ["缺少复盘结论"]);
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
  ]) assert.ok(Object.hasOwn(project, key), `缺少 ${key}`);
});
