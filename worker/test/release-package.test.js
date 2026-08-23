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
    * ⚠️ **`missing` 只列「屏幕上真有地方填」的项，现在只剩摘要。**
    *
    * 陆续撤掉的是关键词、互动目标、**头图**——它们的输入框都已经从发布栏去掉了。
    * 追下游追到底：除了摘要（进 vault 归档的 frontmatter）和发布链接
    *（项目进复盘的唯一开关），其余存进 D1 之后**没有任何消费者**。
    * 催你补一个没有输入框的东西，**比不提示更糟**。
    *
    * ⚠️ **这条只钉「不催没地方填的」，不钉具体条数**——真源是发布栏画了什么。
    */
  assert.deepEqual(pkg.readiness.missing, ["摘要"]);
  // 撤掉输入框的那几样，一个都不许再出现在 missing 里
  for (const gone of ["头图", "封面", "关键词", "互动目标", "画面备注"]) {
    assert.ok(!pkg.readiness.missing.includes(gone), `${gone} 又回到 missing 里了，可界面上没有它的输入框`);
  }
  // 摘要填了就齐活——它是唯一还有下游的那一项
  assert.equal(releasePackage({ platform: "公众号", summary: "有摘要", cover_url: "" }).readiness.complete, true);
});
