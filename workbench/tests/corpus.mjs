// 冷启动语料导入的纯逻辑测试。清洗和切块**不需要真实工作区**，
// 所以这里一个数据库都不开——跑得快，也不会碰到用户的库。

import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { cleanFeishuMarkdown, cleanHeadingTitle, findDeadFeishuImages, planDocument, readFeishuArchive, sortSourceNames, splitDocument, stripDeadFeishuImages } from "../server/lib/corpus.mjs";

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

const BACKSLASH = String.fromCharCode(92);

// 实测一篇 19KB 的飞书导出里，这些标点全被转义了：& [ ] . < > _ * - ! ( )
const escaped = `图片是 image${BACKSLASH}.png，去 ${BACKSLASH}[地点/描述${BACKSLASH}] 度假${BACKSLASH}&nbsp; `;
const cleanedEscapes = cleanFeishuMarkdown(escaped);
check("飞书的反斜杠转义被还原成标点本身", cleanedEscapes.includes("image.png") && cleanedEscapes.includes("[地点/描述]") && !cleanedEscapes.includes(BACKSLASH));
check("真正的反斜杠不会被吃掉", cleanFeishuMarkdown(`路径 C:${BACKSLASH}${BACKSLASH}tmp`).includes(BACKSLASH));
check("&nbsp; 变成普通空格", !cleanFeishuMarkdown("a&nbsp;b").includes("&nbsp;"));

check("三个以上星号的坏粗体被压回标准粗体", cleanFeishuMarkdown("请描述 *** 任务 ***。") === "请描述 **任务**。");
check("嵌套坏粗体不会留下空粗体标记", !cleanFeishuMarkdown("** ***** 迭代 ***** **").includes("****"));
check("三行以上空行被压成一个空段", cleanFeishuMarkdown("a\n\n\n\n\nb") === "a\n\nb");

const deadMarkdown = "![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=ABC)";
check("飞书带鉴权的临时图片链接被识别为失效", findDeadFeishuImages(deadMarkdown).length === 1);
check("正常图片链接不会被误判为失效", findDeadFeishuImages("![x](图片和附件/a.png)").length === 0);
check("失效图链换成人话占位，而不是留一张永远加载不出的破图", stripDeadFeishuImages(deadMarkdown).includes("链接已失效")
  && !stripDeadFeishuImages(deadMarkdown).includes("feishu.cn"));

check("标题里的行内 markdown 被剥掉，目录里不出现星号", cleanHeadingTitle("## **角色 (Persona)**") === "角色 (Persona)");
check("标题里的链接只留文字", cleanHeadingTitle("[金字塔原理](https://example.com)") === "金字塔原理");

// 切块：短文不切；长文优先按**出现两次以上**的标题层级切。
check("没超长的文档保持整篇，不会被无谓切碎", splitDocument("短文", "只有一段。").length === 1);
const single = `# 只出现一次的大标题\n\n${"正".repeat(300)}\n\n${"文".repeat(300)}`;
check("只出现一次的标题不作为切分依据，否则切出一个空壳", splitDocument("单标题", single, { maxChars: 100 }).every((section) => section.text.length > 50));
const twoSections = `导语。\n\n## 第一节\n\n${"甲".repeat(900)}\n\n## 第二节\n\n${"乙".repeat(900)}`;
const split = splitDocument("讲义", twoSections, { maxChars: 500 });
check("超长文档按重复出现的标题层级切开并保留小节名", split.length >= 2 && split.some((section) => section.title === "第一节") && split.some((section) => section.title === "第二节"));
check("标题前的导语并进第一块，不会丢", split.map((section) => section.text).join("").includes("导语。"));
const headless = Array.from({ length: 20 }, (unused, index) => `第 ${index} 段。${"字".repeat(120)}`).join("\n\n");
const paragraphSplit = splitDocument("无标题长文", headless, { maxChars: 800 });
check("一个标题都没有的长文按段落兜底切开", paragraphSplit.length > 1 && paragraphSplit.every((section) => section.text.trim()));
check("兜底切块不丢内容", paragraphSplit.map((section) => section.text).join("\n\n").replace(/\s/g, "").length === headless.replace(/\s/g, "").length);

const archive = zipSync({
  "提示词工程.md": strToU8(`# 提示词工程\n\n![封面](图片和附件/cover.png)\n\n正文 *** 重点 ***。`),
  "图片和附件/cover.png": new Uint8Array([1, 2, 3]),
});
const read = readFeishuArchive(archive, { fileName: "提示词工程.zip" });
check("飞书 zip 里能取出正文和图片和附件目录下的图", read.title === "提示词工程" && read.images.length === 1 && read.images[0].name === "图片和附件/cover.png");
assert.throws(() => readFeishuArchive(zipSync({ "只有图.png": new Uint8Array([1]) })), /没有 markdown/);
check("没有正文的压缩包明确报错，而不是导入一本空书", true);

const planned = planDocument({ title: "提示词工程", text: read.text });
check("planDocument 一次做完清洗、去死链和切块", planned.sections.length === 1 && planned.sections[0].text.includes("**重点**"));

check("目录内文件按数字前缀排序，课程顺序不会乱", sortSourceNames(["10-第十课.md", "2-第二课.md", "1-第一课.md"]).at(0) === "1-第一课.md");

console.log("\n ✓ 语料清洗、切块与飞书导出解析全部通过");
