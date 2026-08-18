import test from "node:test";
import assert from "node:assert/strict";

import { citeText, splitSentences } from "../src/lib/cite.js";

const MATERIAL_A = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZZA",
  text: "信息过载导致的结果不仅是处理不过来，更深层的问题是：人们会停止自己的思考，用博主的语言替代自己的价值观，用媒体的价值观规范自己的人生。",
};
const MATERIAL_B = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZZB",
  text: "我们倾向于相信让自己心理舒服的解释，而非真相。例如创业公司CEO看到「员工应该ALL IN」会觉得很对，但真正的答案是CEO自身管理能力的缺失。",
};

test("逐字搬进正文的那一句能标出来源，并带回素材原话", () => {
  const body = [
    "# 你的脑子，什么时候开始替别人转的？",
    "",
    "有一个现象，你可能已经习惯到察觉不到了。",
    "",
    "这不是信息太多的问题。信息过载导致的结果不仅是处理不过来，更深层的问题是：人们会停止自己的思考，用博主的语言替代自己的价值观，用媒体的价值观规范自己的人生。",
  ].join("\n");

  const cites = citeText(body, [MATERIAL_A, MATERIAL_B]);
  assert.equal(cites.length, 1);
  assert.equal(cites[0].id, MATERIAL_A.id);
  assert.ok(cites[0].score >= 0.9, `逐字搬运的相似度应该很高，实得 ${cites[0].score}`);
  assert.equal(body.slice(cites[0].start, cites[0].end), cites[0].text);
  assert.ok(cites[0].text.startsWith("信息过载导致"), `标注区间不该框住上一句：${cites[0].text}`);
  assert.ok(cites[0].quote.includes("停止自己的思考"), `应带回素材里对上的那一段：${cites[0].quote}`);
});

test("改写过但仍在复述同一件事的句子能标出来", () => {
  const body = "很多人以为问题是信息处理不过来，其实更深层的问题是人们停止了自己的思考，用博主的语言替代了自己的价值观。";
  const cites = citeText(body, [MATERIAL_A, MATERIAL_B]);
  assert.equal(cites.length, 1);
  assert.equal(cites[0].id, MATERIAL_A.id);
});

test("模型自己写的过渡句不会被硬挂到素材上", () => {
  // 这是**这套东西的全部意义**：错标比漏标糟得多，所以这条一旦变红，
  // 先怀疑阈值被调低了，而不是去改这条断言。
  const body = [
    "有一个现象，你可能已经习惯到察觉不到了。",
    "打开手机，刷到一条观点犀利的短视频，你点头，觉得说得太对了。",
    "说白了，你不是被信息淹没了，你是把思考这件事外包了。",
    "所以真正该问的问题只有一个：这件事对你到底意味着什么呢。",
  ].join("\n\n");
  assert.deepEqual(citeText(body, [MATERIAL_A, MATERIAL_B]), []);
});

test("长素材不会因为「什么词都有」而把无关句子吸过去", () => {
  // 整条素材算重合的老毛病：素材越长命中率越高。滑窗就是为这条存在的。
  const long = {
    id: "01HZZZZZZZZZZZZZZZZZZZZZZC",
    text: [
      "去年做那个项目的时候，我们每周开三次会，每次两小时，会上讨论的都是排期和优先级。",
      "后来我发现真正的问题不在排期，而在没人愿意说「这件事不该做」。",
      "信息很多，会议很多，思考很少。每个人都在处理，没有人在判断。",
      "复盘下来最有用的一条是：先砍掉一半的会，再看还有什么真的推不动。",
    ].join(""),
  };
  const body = "打开手机，刷到一条观点犀利的短视频，你点头，觉得说得太对了。";
  assert.deepEqual(citeText(body, [long]), []);
});

test("同一句同时像两条素材时，只归给更像的那条", () => {
  const body = "更深层的问题是：人们会停止自己的思考，用博主的语言替代自己的价值观。";
  const cites = citeText(body, [MATERIAL_B, MATERIAL_A]);
  assert.equal(cites.length, 1, "一句只能有一个出处，否则脚标会叠成一堆");
  assert.equal(cites[0].id, MATERIAL_A.id);
});

test("句末的加粗记号算进区间，脚标不会插进 ** 中间", () => {
  // 模型常把素材原话整句加粗。区间停在 `。` 的话，渲染出来是 `…人生。¹**`——
  // 一对记号被从中间切开，看着像正文里多了两个星号。
  const body = `这不是信息太多的问题。**${MATERIAL_A.text}**`;
  const cites = citeText(body, [MATERIAL_A]);
  assert.equal(cites.length, 1);
  const span = body.slice(cites[0].start, cites[0].end);
  assert.ok(span.startsWith("**") && span.endsWith("**"), span.slice(0, 12) + " … " + span.slice(-12));
  assert.equal(cites[0].end, body.length);
});

test("行首的块级记号不进区间，行内强调记号进", () => {
  const body = `## ${MATERIAL_A.text}`;
  const cites = citeText(body, [MATERIAL_A]);
  assert.equal(cites.length, 1);
  // `## ` 是这一行的容器，不是这句话——底纹框住半个 `## ` 会很难看
  assert.ok(body.slice(cites[0].start, cites[0].end).startsWith("信息过载"), body.slice(cites[0].start, cites[0].start + 8));
});

test("代码围栏里的内容不参与标注", () => {
  const material = { id: "01HZZZZZZZZZZZZZZZZZZZZZZD", text: "部署命令是 npx wrangler deploy，改完提示词必须重新部署才生效。" };
  const body = "```bash\nnpx wrangler deploy，改完提示词必须重新部署才生效\n```";
  assert.deepEqual(citeText(body, [material]), []);
});

test("切句保留原文下标，且掐掉行首的 Markdown 记号", () => {
  const body = "## 小标题在这里，写得足够长一点\n\n> 这是一段引用，也要足够长才行。";
  const parts = splitSentences(body);
  assert.equal(parts.length, 2);
  assert.equal(body.slice(parts[0].start, parts[0].end), "小标题在这里，写得足够长一点");
  assert.equal(body.slice(parts[1].start, parts[1].end), "这是一段引用，也要足够长才行。");
});

test("空正文、空素材、素材没有 id 时安静地回空", () => {
  assert.deepEqual(citeText("", [MATERIAL_A]), []);
  assert.deepEqual(citeText("随便写点什么，够长的一句话在这里。", []), []);
  assert.deepEqual(citeText("信息过载导致的结果不仅是处理不过来。", [{ id: "", text: MATERIAL_A.text }]), []);
});
