// 平台发布包的唯一规则：每个平台需要什么封面比例、发布动作叫什么，
// 以及标题/摘要/封面/关键词等字段怎样落库，都由 Worker 决定。

import { PLATFORMS } from "./values.js";

const SPECS = Object.freeze({
  公众号: { coverLabel: "头图", coverRatio: "2.35:1", outputLabel: "公众号排版", coverRecommended: true },
  X: { coverLabel: "配图", coverRatio: "16:9", outputLabel: "复制发布稿", coverRecommended: false },
  小红书: { coverLabel: "首图", coverRatio: "3:4", outputLabel: "复制发布稿", coverRecommended: true },
  视频号: { coverLabel: "封面", coverRatio: "3:4", outputLabel: "复制发布稿", coverRecommended: true },
  YouTube: { coverLabel: "缩略图", coverRatio: "16:9", outputLabel: "复制发布稿", coverRecommended: true },
});

const text = (value) => String(value ?? "").trim();

export function releaseSpec(platform) {
  const name = text(platform);
  if (!PLATFORMS.has(name)) throw new Error("发布平台不合法");
  return { platform: name, ...SPECS[name] };
}

export function releaseOptions() {
  return [...PLATFORMS].map(releaseSpec);
}

export function normalizeKeywords(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,，、\n]/);
  return [...new Set(source.map((item) => text(item).slice(0, 30)).filter(Boolean))].slice(0, 8);
}

export function parseKeywords(value) {
  try {
    return normalizeKeywords(JSON.parse(String(value || "[]")));
  } catch {
    return normalizeKeywords(value);
  }
}

export function normalizeReleaseInput(input = {}, current = {}) {
  const headline = text(input.title ?? current.title ?? current.headline).slice(0, 200);
  const body = String(input.body ?? current.body ?? "");
  const coverUrl = text(input.coverUrl ?? current.release?.coverUrl ?? current.cover_url);
  if (!headline) throw new Error("发布标题不能为空");
  if (!body.trim()) throw new Error("发布正文不能为空");
  if (coverUrl && !/^https?:\/\//i.test(coverUrl)) throw new Error("封面图片地址必须以 http:// 或 https:// 开头");

  return {
    headline,
    body,
    summary: text(input.summary ?? current.release?.summary ?? current.summary).slice(0, 500),
    cover_url: coverUrl,
    cover_text: text(input.coverText ?? current.release?.coverText ?? current.cover_text).slice(0, 120),
    cover_note: text(input.coverNote ?? current.release?.coverNote ?? current.cover_note).slice(0, 500),
    keywords_json: JSON.stringify(normalizeKeywords(input.keywords ?? current.release?.keywords ?? current.keywords_json)),
    interaction_goal: text(input.interactionGoal ?? current.release?.interactionGoal ?? current.interaction_goal).slice(0, 300),
  };
}

export function releasePackage(row = {}) {
  const spec = releaseSpec(row.platform);
  const keywords = parseKeywords(row.keywords_json);
  /**
   * ⚠️ **`missing` 只列「屏幕上真有地方填」的项，现在只剩摘要一项。**
   *
   * 陆续撤掉的是：关键词、互动目标、**封面（头图）**。它们的输入框都已经从
   * 发布栏里去掉了——追下游追到底，除了摘要（进 vault 归档的 frontmatter）
   * 和发布链接（项目进复盘的开关），其余存进 D1 之后**没有任何消费者**，
   * 只是让你在工作台里抄一遍反正要在平台后台填的东西。
   *
   * 留在这儿的后果是界面一直催你补一个**没有输入框**的东西——
   * **一句你照做不了的提示，比不提示更糟。** 列全都还在表上，只是不再当成「缺」。
   */
  const missing = [];
  if (!text(row.summary)) missing.push("摘要");
  return {
    summary: row.summary || "",
    coverUrl: row.cover_url || "",
    coverText: row.cover_text || "",
    coverNote: row.cover_note || "",
    keywords,
    interactionGoal: row.interaction_goal || "",
    spec,
    readiness: { complete: missing.length === 0, missing },
  };
}
