import test from "node:test";
import assert from "node:assert/strict";

import {
  assertGroundedGeneratedText,
  assertGroundedPersonalNarrative,
  auditPersonalNarrative,
  findSpecificPersonalClaims,
  isMaterialEligibleForDraft,
  isValidHttpSource,
  normalizeStoredText,
  sourceContainsVerbatim,
  stableTaskKey,
  primaryPlatform,
  topicStatusFromDrafts,
  verificationForMaterial,
  workflowInstanceId,
} from "../src/lib/integrity.js";

test("字面的 \\n 在存进库之前还原成真换行", () => {
  // 模型双重转义的产物：库里存的是「反斜杠 + n」两个字符，四个下游全都不报错、只是显示成一串 \n
  assert.equal(normalizeStoredText("Step 1 提出问题。\\nStep 2 拆解问题。"), "Step 1 提出问题。\nStep 2 拆解问题。");
  assert.equal(normalizeStoredText("甲\\r\\n乙"), "甲\n乙");
  // 真换行原样留着，别的转义不碰
  assert.equal(normalizeStoredText("甲\n乙\\t丙"), "甲\n乙\\t丙");
  assert.equal(normalizeStoredText(""), "");
});

test("有效来源且原文可逐字比对时自动标记已核验", () => {
  assert.equal(isValidHttpSource("https://example.com/report"), true);
  assert.equal(sourceContainsVerbatim("报告写道：增长率为 12%。", "增长率为 12%。"), true);
  assert.deepEqual(verificationForMaterial({
    type: "数据/事实",
    note: "增长率为 12%。",
    sourceUrl: "https://example.com/report",
    sourceText: "报告写道：增长率为 12%。",
    origin: "auto-extract",
  }), {
    status: "已核验",
    note: "已在抓取原文中逐字匹配，并保留有效出处链接。",
  });
});

test("删除或发布稿件后只按主平台重算选题状态", () => {
  const targets = ["公众号", "X", "小红书"];
  assert.equal(primaryPlatform(targets), "公众号");
  assert.equal(topicStatusFromDrafts(targets, []), "待写");
  assert.equal(topicStatusFromDrafts(targets, [
    { platform: "X", status: "待修改" },
  ]), "搁置");
  assert.equal(topicStatusFromDrafts(targets, [{ platform: "公众号", status: "待修改" }]), "已成稿");
  assert.equal(topicStatusFromDrafts(targets, [{ platform: "公众号", status: "已发布" }]), "已发布");
});

test("无效来源、不可比对来源和手工逐字素材都保持待核验", () => {
  assert.equal(isValidHttpSource("李某的演讲"), false);
  assert.equal(verificationForMaterial({
    type: "金句/原话",
    note: "未经比对的句子",
    sourceUrl: "notaurl",
    sourceText: "未经比对的句子",
    origin: "auto-extract",
  }).status, "待核验");
  assert.equal(verificationForMaterial({
    type: "金句/原话",
    note: "原句",
    sourceUrl: "https://example.com",
    sourceText: "另一句话",
    origin: "auto-extract",
  }).status, "待核验");
  assert.equal(verificationForMaterial({
    type: "数据/事实",
    note: "42%",
    sourceUrl: "https://example.com",
    sourceText: "42%",
    origin: "manual",
  }).status, "待核验");
});

test("待核验素材不能进入成稿，逐字类必须明确已核验", () => {
  assert.equal(isMaterialEligibleForDraft({ type: "核心观点", verificationStatus: "待核验" }), false);
  assert.equal(isMaterialEligibleForDraft({ type: "金句/原话", verificationStatus: "" }), false);
  assert.equal(isMaterialEligibleForDraft({ type: "金句/原话", verificationStatus: "已核验" }), true);
  assert.equal(isMaterialEligibleForDraft({ type: "个人经历", verificationStatus: "不适用" }), true);
});

test("无个人经历素材时拦截具体第一人称或朋友叙事", () => {
  const body = "前几天跟一个朋友聊天，他说账号一直没起色。我问他问题出在哪。";
  assert.ok(findSpecificPersonalClaims(body).length > 0);
  assert.throws(
    () => assertGroundedPersonalNarrative(body, [{ type: "核心观点", note: "观点" }]),
    (error) => error.code === "UNGROUNDED_PERSONAL_EXPERIENCE"
  );
});

test("待补占位不触发拦截，只有内容匹配的个人经历才能支撑具体叙事", () => {
  assert.doesNotThrow(() => assertGroundedPersonalNarrative("【待补：一段与读者聊天的真实经历】", []));
  assert.doesNotThrow(() => assertGroundedPersonalNarrative(
    "上周我和一位读者聊天。",
    [{ type: "个人经历", note: "上周我和一位读者聊天，讨论内容创作。" }]
  ));
});

test("一条无关个人经历不能解锁另一段编造叙事", () => {
  assert.throws(
    () => assertGroundedPersonalNarrative(
      "去年我辞职开始创业，第一次就拿到了十个客户。",
      [{ type: "个人经历", note: "上周我和一位读者聊天，讨论内容创作。" }]
    ),
    (error) => error.code === "UNGROUNDED_PERSONAL_EXPERIENCE"
  );
});

test("真实性审计返回可供界面逐条处理的具体问题", () => {
  const audit = auditPersonalNarrative("上周我和一个朋友聊天，他说账号没起色。", []);
  assert.equal(audit.evidenceCount, 0);
  assert.equal(audit.ungrounded.length, 1);
  assert.match(audit.ungrounded[0], /朋友聊天/);
});

test("标题摘要等旁路字段与正文使用同一条真实性硬闸", () => {
  assert.throws(
    () => assertGroundedGeneratedText({
      headline: "我辞职创业后拿到十个客户",
      summary: "一段真实复盘",
      body: "正文只有观点。",
      alternatives: ["我的朋友靠这个方法翻身了"],
    }, []),
    (error) => error.code === "UNGROUNDED_PERSONAL_EXPERIENCE"
  );
  assert.doesNotThrow(() => assertGroundedGeneratedText({
    headline: "我辞职创业后拿到十个客户",
    body: "正文只有观点。",
  }, [{ type: "个人经历", note: "我辞职创业后拿到十个客户，这是我的真实复盘。" }]));
});

test("外部原文里的第一人称不能被当成用户本人证据", () => {
  const externalQuote = "作者写道：去年我辞职创业，第一次就拿到了十个客户。";
  assert.throws(
    () => assertGroundedGeneratedText("去年我辞职创业，第一次就拿到了十个客户。", []),
    (error) => error.code === "UNGROUNDED_PERSONAL_EXPERIENCE"
  );
  assert.doesNotThrow(() => assertGroundedGeneratedText(
    "作者在原文中自述了辞职创业经历。",
    [{ type: "案例/故事", note: externalQuote }]
  ));
});

test("稳定任务键和 Workflow 实例 ID 对同一输入稳定、不同输入分离", () => {
  const a = stableTaskKey("draft", "topic-1", "X");
  const b = stableTaskKey("draft", "topic-1", "X");
  const c = stableTaskKey("draft", "topic-1", "公众号");
  assert.equal(a, b);
  assert.notEqual(a, c);
  const workflowId = workflowInstanceId("draft", "topic-1", "2026-08-13T00:00:00Z");
  assert.equal(workflowId, workflowInstanceId("draft", "topic-1", "2026-08-13T00:00:00Z"));
  assert.ok(workflowId.length <= 100);
});
