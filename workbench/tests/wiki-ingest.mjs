// 提炼的逐字闸门和提案校验。**不调模型、不开库**——这一层是纯函数，
// 而它恰恰是整套东西最该被钉死的地方：闸门松一格，编造的事实就进了知识库，
// 之后每一篇引用它的文章都带着那个错。

import assert from "node:assert/strict";
import { quoteGrounded, quoteSpans, validateProposal } from "../server/domain/wiki-ingest.mjs";

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

// 真实语料里的形状：中文段落之间是 \r\n，标点是全角。
const SOURCE = [
  "比如情绪，就是一种典型的神经元链接：场景-情绪反应。",
  "所以我说如何应对情绪呢？一个做法就是用一个新的行为来干扰这个链接。",
  "他的结论（广为人知的遗忘曲线）针对的是无意义音节的机械重复，因而不具备参考价值。",
].join("\r\n");

check("跨段落的连续引用能通过——中文换行不该被当成模型该照抄的空格", quoteGrounded(SOURCE,
  "比如情绪，就是一种典型的神经元链接：场景-情绪反应。所以我说如何应对情绪呢？"));
check("用省略号连接两处真实原文的引用能通过", quoteGrounded(SOURCE,
  "比如情绪，就是一种典型的神经元链接……一个做法就是用一个新的行为来干扰这个链接"));
check("省略号的多种写法都认得", quoteSpans("前一段......后一段").length === 2 && quoteSpans("前一段……后一段").length === 2);

// ⚠️ 下面两条是这套闸门存在的理由，改坏了不会有别的地方报错。
check("不加标记地跳掉中间几句要拦住——拼出来的句子原文里从没存在过", !quoteGrounded(SOURCE,
  "比如情绪，就是一种典型的神经元链接：一个做法就是用一个新的行为来干扰这个链接。"));
check("悄悄删掉括号插入语要拦住", !quoteGrounded(SOURCE,
  "他的结论针对的是无意义音节的机械重复，因而不具备参考价值。"));
check("整段编造要拦住", !quoteGrounded(SOURCE, "这段话在原文里根本不存在，完全是模型自己写的。"));
check("太短的片段不算依据——两三个字在任何文档里都找得到", !quoteGrounded(SOURCE, "情绪"));
check("单段太短的拼接引用也不算数", !quoteGrounded(SOURCE, "比如情绪……场景"));

const existing = [{ id: "F1", name: "神经元链接", kind: "concept", definition: "场景与反应之间的连接。", facts: [{ id: "FACT1", statement: "旧链接会被新信息削弱。" }] }];
const proposal = {
  entries: [
    { name: "第三者干扰", kind: "method", definition: "用新行为干扰已有的场景-情绪链接。", quote: "所以我说如何应对情绪呢？一个做法就是用一个新的行为来干扰这个链接。" },
    { name: "神经元链接", kind: "concept", definition: "重复建一个同名的。", quote: "比如情绪，就是一种典型的神经元链接：场景-情绪反应。" },
    { name: "凭空词条", kind: "concept", definition: "编的。", quote: "这段依据在原文里根本找不到，纯属编造出来的句子。" },
    { name: "类型不对", kind: "随便写的", definition: "类型不在允许值里。", quote: "比如情绪，就是一种典型的神经元链接：场景-情绪反应。" },
    { name: "P", kind: "concept", definition: "缩写里的单个字母。", quote: "所以我说如何应对情绪呢？一个做法就是用一个新的行为来干扰这个链接。" },
  ],
  facts: [
    { entry: "第三者干扰", statement: "用新行为干扰旧链接。", quote: "一个做法就是用一个新的行为来干扰这个链接" },
    { entry: "不存在的词条", statement: "挂在空气上。", quote: "比如情绪，就是一种典型的神经元链接：场景-情绪反应。" },
  ],
  relations: [
    { from: "第三者干扰", to: "神经元链接", type: "based_on", why: "作用在链接上" },
    { from: "第三者干扰", to: "第三者干扰", type: "based_on", why: "自链" },
    { from: "第三者干扰", to: "神经元链接", type: "相关", why: "零信息关系" },
  ],
  contradictions: [
    { entry: "神经元链接", existingFactId: "FACT1", statement: "旧链接不会被削弱。", quote: "他的结论（广为人知的遗忘曲线）针对的是无意义音节的机械重复", verdict: "dispute", why: "说法相反" },
    { entry: "神经元链接", existingFactId: "不存在的事实", statement: "指向空气。", quote: "比如情绪，就是一种典型的神经元链接：场景-情绪反应。", verdict: "dispute", why: "" },
  ],
};
const result = validateProposal(proposal, { sourceText: SOURCE, existing });

check("已经存在的词条不许重建，会被引导去归并", result.entries.length === 1 && result.entries[0].name === "第三者干扰"
  && result.rejected.some((item) => item.why.includes("已存在")));
check("依据对不上的词条整条丢掉", !result.entries.some((item) => item.name === "凭空词条"));
check("类型不合法的词条丢掉", !result.entries.some((item) => item.name === "类型不对"));
// 实测跑出过叫「N」和「P」的词条——模型把 INKP 拆成了四个字母各建一条。
check("缩写里的单个字母不许单独成条", !result.entries.some((item) => item.name === "P")
  && result.rejected.some((item) => item.why.includes("名字太短")));
check("挂在不存在词条上的事实丢掉，不会凭空造一个词条出来", result.facts.length === 1 && result.facts[0].entry === "第三者干扰");
check("自链和零信息关系都被拦下，只留下有语义的那条", result.relations.length === 1 && result.relations[0].type === "based_on");
check("指向不存在的已有事实的矛盾丢掉", result.contradictions.length === 1 && result.contradictions[0].existingFactId === "FACT1");
check("被丢掉的条目都带着原因，能用来判断这个模型能不能用", result.rejected.length >= 6 && result.rejected.every((item) => item.what && item.why));
check("依据找不到时报出的是**具体那一段**，不是整串", result.rejected.some((item) => item.quote && item.quote.includes("这段依据在原文里根本找不到")));

console.log("\n ✓ 提炼的逐字闸门与提案校验全部通过");
