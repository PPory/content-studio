import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProjectReview, PROJECT_REVIEW_STATUSES, winningFeedbackPlan } from "../src/lib/project-review.js";

const completeReview = (fields = {}) => ({
  status: "普通",
  basis: "同平台近三篇中位数为 1000，这篇是 980。",
  conclusion: "本次结构没有带来明显提升。",
  nextExperiment: "下一篇只替换成案例开头。",
  metrics: { views: "980", likes: 20, comments: "", collects: null, shares: 3 },
  ...fields,
});

test("项目复盘只接受三种判断，并保留空指标而不伪装成 0", () => {
  assert.deepEqual(PROJECT_REVIEW_STATUSES, ["样本不足", "普通", "表现突出"]);
  assert.deepEqual(normalizeProjectReview(completeReview()), {
    status: "普通",
    basis: "同平台近三篇中位数为 1000，这篇是 980。",
    conclusion: "本次结构没有带来明显提升。",
    nextExperiment: "下一篇只替换成案例开头。",
    captureFeedback: false,
    metrics: { views: 980, likes: 20, comments: null, collects: null, shares: 3 },
  });
  assert.throws(() => normalizeProjectReview(completeReview({ status: "成功" })), /请选择/);
  assert.throws(() => normalizeProjectReview(completeReview({ metrics: { views: -1 } })), /大于等于 0/);
  assert.throws(() => normalizeProjectReview(completeReview({ metrics: { views: 1.5 } })), /整数/);
});

test("复盘必须留下依据、判断和下一次实验", () => {
  assert.throws(() => normalizeProjectReview(completeReview({ basis: "" })), /判断的依据/);
  assert.throws(() => normalizeProjectReview(completeReview({ conclusion: "" })), /复盘判断/);
  assert.throws(() => normalizeProjectReview(completeReview({ nextExperiment: "" })), /具体动作/);
});

test("只有表现突出且用户明确确认时才允许沉淀", () => {
  assert.equal(normalizeProjectReview(completeReview({ captureFeedback: true })).captureFeedback, false);
  assert.equal(normalizeProjectReview(completeReview({ status: "表现突出", captureFeedback: true })).captureFeedback, true);
});

test("表现突出计划展示明确证据，并只标记故事类素材", () => {
  const plan = winningFeedbackPlan({
    draft: { id: "d1", headline: "真实标题", platform: "公众号" },
    topic: { id: "t1", title: "真实选题", viewpoint: "真实角度" },
    materials: [
      { id: "story", type: "案例/故事" },
      { id: "experience", type: "个人经历" },
      { id: "fact", type: "数据/事实" },
    ],
    basis: "阅读量是同平台近五篇中位数的 1.8 倍。",
  });
  assert.deepEqual(plan.candidates.map((item) => item.label), ["有效标题", "有效角度", "平台反馈"]);
  assert.ok(plan.candidates.every((item) => item.evidence.includes("1.8 倍")));
  assert.deepEqual(plan.storyIds, ["story", "experience"]);
  assert.deepEqual(winningFeedbackPlan({ draft: { id: "d1" } }), { candidates: [], storyIds: [] });
});
