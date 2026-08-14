// vault 归档的纯逻辑。这里覆盖的都是「错了不报错、只是安静地不对」的地方：
// 文件名里混进 Obsidian 语法字符会让反链解析错位，frontmatter 里少一个引号会让
// 整份属性区失效——而 Obsidian 两种情况都不会提示，只是不显示。

import { test } from "node:test";
import assert from "node:assert/strict";
import { safeName, yamlValue, frontmatter, titledBody } from "../src/lib/vault.js";

test("safeName 去掉文件系统非法字符", () => {
  assert.equal(safeName('a/b\\c:d*e?f"g<h>i|j'), "a b c d e f g h i j");
});

test("safeName 去掉 Obsidian 的语法字符", () => {
  // [ ] 是 wikilink、# 是标签、^ 是块引用。留在文件名里会让 [[链接]] 解析错位
  assert.equal(safeName("讲[写作]的#技巧^要点"), "讲 写作 的 技巧 要点");
});

test("safeName 截断后不留尾部的点和空格", () => {
  // Windows 上以点或空格结尾的文件名是非法的
  assert.equal(safeName("标题。。。   "), "标题。。。");
  assert.equal(safeName("abc...", 4), "abc");
});

test("safeName 空值兜底", () => {
  assert.equal(safeName(""), "未命名");
  assert.equal(safeName("###"), "未命名");
  assert.equal(safeName(null), "未命名");
});

test("safeName 按 max 截断", () => {
  assert.equal(safeName("一二三四五六七八九十", 5), "一二三四五");
});

test("yamlValue 给 wikilink 加引号", () => {
  // 裸的 [[x]] 在 YAML 里是嵌套流式序列，不加引号整个属性区就废了
  assert.equal(yamlValue("[[某条素材]]"), '"[[某条素材]]"');
});

test("yamlValue 转义双引号和反斜杠", () => {
  assert.equal(yamlValue('他说"这样"'), '"他说\\"这样\\""');
  assert.equal(yamlValue("a\\b"), '"a\\\\b"');
});

test("yamlValue 把换行压成空格", () => {
  // 多行标量需要 | 或 > 语法，这里的字段都是单行语义，压平比引入块标量简单
  assert.equal(yamlValue("第一行\n第二行"), '"第一行 第二行"');
});

test("yamlValue 含冒号的串要加引号", () => {
  assert.equal(yamlValue("标题: 副标题"), '"标题: 副标题"');
  // URL 里的冒号后面没空格，YAML 不会误解析
  assert.equal(yamlValue("https://x.com/a"), '"https://x.com/a"');
});

test("yamlValue 简单中文和素材类型不加引号", () => {
  assert.equal(yamlValue("核心观点"), "核心观点");
  assert.equal(yamlValue("金句/原话"), "金句/原话");
  assert.equal(yamlValue("2026-08-14"), "2026-08-14");
});

test("yamlValue 空值给空串而不是裸 null", () => {
  assert.equal(yamlValue(""), '""');
  assert.equal(yamlValue(null), '""');
  assert.equal(yamlValue(0), "0");
});

test("frontmatter 跳过空字段，不留一排空属性", () => {
  const fm = frontmatter({ id: "x", link: "", tags: [], type: "核心观点" });
  assert.equal(fm, "---\nid: x\ntype: 核心观点\n---");
});

test("frontmatter 数组按 YAML 列表展开", () => {
  const fm = frontmatter({ tags: ["写作", "复利"] });
  assert.equal(fm, "---\ntags:\n  - 写作\n  - 复利\n---");
});

test("frontmatter 的 wikilink 数组每项都带引号", () => {
  const fm = frontmatter({ materials: ["[[素材A]]", "[[素材B]]"] });
  assert.equal(fm, '---\nmaterials:\n  - "[[素材A]]"\n  - "[[素材B]]"\n---');
});

test("titledBody 不重复加标题：正文自带 H1", () => {
  // 成稿的 body 是 LLM 写的，开头本来就是 # 标题。再加一个就是三重标题
  // （文件名 + 我们加的 + LLM 自带的）
  const out = titledBody("成长的复利公式", "# 成长的复利公式\n\n正文……");
  assert.equal(out, "# 成长的复利公式\n\n正文……\n");
});

test("titledBody 不重复加标题：正文就是标题本身", () => {
  // /金句 存的素材，title 和 content 是同一个串
  assert.equal(titledBody("一句金句", "一句金句"), "一句金句\n");
});

test("titledBody 正文没有标题时补一个", () => {
  assert.equal(titledBody("标题", "一段正文"), "# 标题\n\n一段正文\n");
});

test("titledBody 空正文只留标题", () => {
  assert.equal(titledBody("标题", ""), "# 标题\n");
  assert.equal(titledBody("标题", null), "# 标题\n");
});

test("titledBody 不把 ## 当成已有标题", () => {
  // 只认 H1。正文从二级标题开始时，仍然需要一个主标题
  assert.equal(titledBody("标题", "## 小节"), "# 标题\n\n## 小节\n");
});
