import assert from "node:assert/strict";
import { interviewPromptParts, materialDraftPromptParts } from "../server/routes/agent.mjs";
import { cleanGeneratedDraft, deriveDraftTitle, formatMaterialQuote } from "../src/lib/creation-api.js";

assert.equal(cleanGeneratedDraft("```markdown\n# 标题\n\n正文\n```"), "# 标题\n\n正文");
assert.equal(cleanGeneratedDraft("# 标题\n\n正文"), "# 标题\n\n正文");
console.log("✓ 访谈初稿能去掉 Markdown 围栏");

const firstTurn = interviewPromptParts({
  draftTitle: "一篇待访谈文章",
  platform: "公众号",
  phase: "interviewing",
});
assert.equal(firstTurn[0], "/interview-to-draft");
assert.match(firstTurn[1], /暂定标题：一篇待访谈文章/);
assert.match(firstTurn[1], /目标平台：公众号/);

const resumedTurn = interviewPromptParts({ draftTitle: "续聊" }, "123e4567-e89b-12d3-a456-426614174000");
assert.equal(resumedTurn.some((part) => part === "/interview-to-draft"), false);
console.log("✓ 访谈首轮调用工作台 skill，续聊沿用既有会话");

assert.equal(deriveDraftTitle("", "# 最后才想到的标题\n\n正文"), "最后才想到的标题");
assert.equal(deriveDraftTitle("", "这是正文第一句话。\n\n第二段"), "这是正文第一句话。");
assert.equal(deriveDraftTitle("用户填写的标题", "# 正文标题"), "用户填写的标题");
console.log("✓ 空白稿可在写完后从正文生成标题");

const materialPrompt = materialDraftPromptParts({
  draftTitle: "有依据的文章",
  platform: "公众号",
  viewpoint: "只讨论已知信息",
  audience: "内容创作者",
  materials: [{ title: "真实素材", type: "数据/事实", verificationStatus: "已核验", note: "原始内容", link: "https://example.com" }],
});
assert.match(materialPrompt.join("\n"), /只能使用下面已经确认的写作简报和可用素材/);
assert.match(materialPrompt.join("\n"), /写作方向：只讨论已知信息/);
assert.match(materialPrompt.join("\n"), /正文：\n原始内容/);
assert.doesNotMatch(materialPrompt.join("\n"), /vault/);
console.log("✓ AI 素材起稿只接收已确认简报和已选素材");

assert.equal(formatMaterialQuote({ title: "真实素材", note: "第一行\n第二行" }), "> 第一行\n> 第二行\n>\n> —— 素材：真实素材");
console.log("✓ 素材引用按需插入正文，不预填编辑器");
