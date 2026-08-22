import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeKeywords,
  normalizeReleaseInput,
  releaseOptions,
  releasePackage,
} from "../src/lib/release-package.js";

test("五个平台的发布包规格由 Worker 统一返回", () => {
  const options = releaseOptions();
  assert.deepEqual(options.map((item) => item.platform), ["公众号", "X", "小红书", "视频号", "YouTube"]);
  assert.equal(options.find((item) => item.platform === "小红书").coverRatio, "3:4");
  assert.equal(options.find((item) => item.platform === "公众号").outputLabel, "公众号排版");
});

test("关键词去重、保序并限制为八个", () => {
  assert.deepEqual(normalizeKeywords("写作，复利、写作,产品\n成长,一,二,三,四,五"), ["写作", "复利", "产品", "成长", "一", "二", "三", "四"]);
});

test("发布包拒绝空标题、空正文和非法封面地址", () => {
  assert.throws(() => normalizeReleaseInput({ title: "", body: "正文" }), /标题不能为空/);
  assert.throws(() => normalizeReleaseInput({ title: "标题", body: "" }), /正文不能为空/);
  assert.throws(() => normalizeReleaseInput({ title: "标题", body: "正文", coverUrl: "C:\\cover.png" }), /http/);
});

test("平台发布包明确返回还缺哪些准备项", () => {
  const pkg = releasePackage({ platform: "公众号", summary: "", cover_url: "", keywords_json: "[]", interaction_goal: "" });
  assert.equal(pkg.readiness.complete, false);
  /**
    * ⚠️ **`missing` 只列「屏幕上真有地方填」的项。**
    * 「关键词」和「互动目标」那两个输入框已经从发布栏撤了（后者在任何平台后台
    * 都没有对应字段，纯内部笔记）。留在这儿的后果是界面一直催你补一个没有输入框
    * 的东西——**一句你照做不了的提示，比不提示更糟。**
    */
  assert.deepEqual(pkg.readiness.missing, ["摘要", "头图"]);
});
