/**
 * 项目里的两个 AI 动作：**搭结构**和**起稿**。
 *
 * ⚠️ **建了项目不自动生成全文。** 这条是产品判断，不是性能取舍：
 * 一上来给一篇完整的稿，人会本能地去改它而不是想自己要讲什么，
 * 而那篇稿是照着「一般文章该怎么写」生成的，不是照着这个人要留下的判断。
 * 所以顺序是：先给结构候选 → 用户看过、认了 → 才谈起稿。
 *
 * ⚠️ **两个动作都不写正文。** 结构和草稿都以候选形式回到编辑器里，
 * 由用户在正文上逐处采纳。
 */

import { completeJson } from "../lib/model-json.mjs";
import { assertGroundedGeneratedText } from "./integrity.mjs";
import { describeCreativeContext, projectCreativeContext } from "./content-project.mjs";

const clean = (value, max = 8_000) => String(value ?? "").trim().slice(0, max);

function completionFor(env) {
  return typeof env?.CONTENT_PROJECT_COMPLETE_JSON === "function"
    ? env.CONTENT_PROJECT_COMPLETE_JSON
    : typeof env?.CONTENT_BRIDGE_COMPLETE_JSON === "function"
      ? env.CONTENT_BRIDGE_COMPLETE_JSON
      : completeJson;
}

/**
 * 结构候选里每一节都要说清**这一节承担什么**和**用哪几条材料**。
 *
 * 只给一串小标题的提纲没有用：那种提纲每篇文章都能套，读完仍然不知道
 * 第三节到底要拿什么把话说圆。
 */
function normalizeOutline(data, context) {
  if (!data || typeof data !== "object" || !Array.isArray(data.sections)) throw new Error("模型没有返回 sections 数组");
  /**
   * id 和标题都能对上。
   * ⚠️ 模型很自然地会回填它读到的**标题**而不是 id；为此把整节的引用丢光，
   * 换来的是一份「什么材料都没用」的结构——那比宽容匹配糟得多。
   * 两边都是这次真的给过它的东西，认哪一个都不会放进任何新来源。
   */
  const known = new Map();
  for (const element of context.elements) {
    known.set(element.id, element);
    if (element.label) known.set(element.label, element);
  }
  const sections = data.sections.slice(0, 12).map((item, index) => {
    const heading = clean(item?.heading, 200);
    const purpose = clean(item?.purpose, 1_000);
    if (!heading || !purpose) throw new Error(`第 ${index + 1} 节缺少小标题或它承担的作用`);
    const usesRaw = Array.isArray(item?.uses) ? item.uses : [];
    return {
      heading,
      purpose,
      /**
       * ⚠️ 认不出的要素引用丢掉，不让整份结构失败。
       * 结构层说错一条「这里用哪个材料」，代价是用户自己再挑一次；
       * 而把整份结构作废，代价是他什么都拿不到。真正不能放过的是起稿时的编造。
       */
      uses: usesRaw.map((id) => known.get(clean(id, 120))).filter(Boolean)
        .map((element) => ({ id: element.id, label: element.label, typeLabel: element.typeLabel, origin: element.origin })),
      beats: (Array.isArray(item?.beats) ? item.beats : []).slice(0, 6).map((beat) => clean(beat, 500)).filter(Boolean),
    };
  });
  if (!sections.length) throw new Error("模型没有给出任何一节");
  return {
    sections,
    note: clean(data.note, 1_000),
    /** 这份结构没能安排上的材料。摆出来让用户判断是它没用上，还是它不该在这篇里。 */
    unused: context.elements
      .filter((element) => !sections.some((section) => section.uses.some((use) => use.id === element.id)))
      .map((element) => ({ id: element.id, label: element.label, typeLabel: element.typeLabel })),
  };
}

/** 结构候选转成可以直接落进正文的 Markdown。 */
export function outlineToMarkdown(outline) {
  return outline.sections
    .map((section) => {
      const lines = [`## ${section.heading}`, "", `> ${section.purpose}`];
      if (section.uses.length) lines.push(`>`, `> 用：${section.uses.map((use) => use.label).join("、")}`);
      if (section.beats.length) lines.push("", ...section.beats.map((beat) => `- ${beat}`));
      return lines.join("\n");
    })
    .join("\n\n");
}

export async function proposeProjectOutline(env, workspace, { projectId, instruction = "" } = {}) {
  const context = projectCreativeContext(workspace, projectId);
  const ask = clean(instruction, 1_000);
  const completion = await completionFor(env)(env, {
    system: [
      "你为一个创作者把已经定好的内容构造，落成一份可以照着写的文章结构。",
      "不要写正文，只给结构。",
      "每一节必须说清两件事：这一节承担什么作用（purpose），以及它用上面哪几条材料（uses，填材料的 id）。",
      "beats 是这一节里要依次讲到的两三个点，可选。",
      "⚠️ 只能安排上面列出的材料，不要引入任何没给你的东西。",
      "⚠️ 已经选定的讲法就是这篇的推进方式，不要换一种讲法。",
      "⚠️ 已知缺的证据不要假装有；如果某一节依赖它，就在 purpose 里点明这里需要补什么。",
      context.experiences.length
        ? "涉及个人经历时只能用给出的那几条。"
        : "⚠️ 工作区里一条真实个人经历都没有。任何一节都不得安排第一人称经历。",
      "节数按内容需要定，通常四到七节。宁可少而实，不要凑一个漂亮的对称结构。",
      "只输出 JSON。",
      JSON.stringify({ sections: [{ heading: "", purpose: "", uses: [""], beats: [""] }], note: "" }),
    ].filter(Boolean).join("\n"),
    user: ask ? `${describeCreativeContext(context)}

# 我对上一版结构的意见（这次要照着改）
${ask}` : describeCreativeContext(context),
    maxTokens: 6_000,
  });
  const outline = normalizeOutline(completion.data, context);
  /**
   * ⚠️ 结构也过一遍第一人称硬闸。
   * 「第三节：讲我那次踩坑」——结构里写下这一句，后面起稿时它就一定会被编出来。
   */
  assertGroundedGeneratedText(outline, context.experiences);
  return { outline, markdown: outlineToMarkdown(outline), context: summarize(context), model: completion.model || "" };
}

function summarize(context) {
  return {
    problem: context.problem.statement,
    problemOrigin: context.problem.origin,
    coreClaim: context.opportunity.coreClaim,
    dominantAction: context.opportunity.dominantAction,
    route: context.route,
    elementCount: context.elements.length,
    experienceCount: context.experiences.length,
    agenda: context.agenda ? { id: context.agenda.id, title: context.agenda.title } : null,
    empty: context.empty,
  };
}

/**
 * 起稿。
 *
 * ⚠️ **必须先有结构。** 没有结构就起稿，等于回到「一上来给一篇完整的稿」——
 * 那正是这一步要避免的事。
 */
export async function proposeProjectDraft(env, workspace, { projectId, outline, instruction = "" } = {}) {
  const context = projectCreativeContext(workspace, projectId);
  /**
   * ⚠️ **起稿不能只有一次机会。**
   * 「不满意只能重来一遍」意味着用户唯一能表达不满的方式是再抽一次——
   * 而他通常很清楚哪儿不对（太像科普、结论太早、开头绕）。带上这句话再起，
   * 是把「重抽」换成「说一句」。
   */
  const ask = clean(instruction, 1_000);
  if (!outline || !Array.isArray(outline.sections) || !outline.sections.length) {
    throw Object.assign(new Error("先搭一个结构，再起稿"), {
      status: 400,
      hint: "起稿要照着你认过的结构写；没有结构的稿只是一篇「一般文章」，不是你要留下的判断。",
    });
  }
  const completion = await completionFor(env)(env, {
    system: [
      "你按创作者已经认过的结构，起一份初稿。",
      "这是初稿，不是成稿：把话说清楚、把材料放到位就够了，不要堆形容词，也不要写编辑寄语式的开头结尾。",
      "⚠️ 只能用给出的材料。没有的事实、数据、案例一律不要写；需要而没有的，在正文里用【待补：具体缺什么】标出来。",
      "⚠️ 不要写任何没有依据的第一人称经历。",
      context.experiences.length
        ? "涉及个人经历时只能用给出的那几条，并且忠于原文。"
        : "⚠️ 工作区里一条真实个人经历都没有。整篇不得出现「我那次」「我曾经」「我有个朋友」这类具体的个人叙事。",
      context.problem.origin === "hypothesis"
        ? "⚠️ 这条用户问题是假设，没有人真的这样问过。不得写「很多读者问我」「大家都在困惑」。"
        : "引用真实原话时保持逐字，不要改写。",
      "严格按给定的每一节写，小标题用 `## `。",
      "只输出 JSON：{\"title\":\"\",\"body_markdown\":\"\",\"note\":\"\"}。body_markdown 是完整初稿。",
    ].filter(Boolean).join("\n"),
    user: [
      describeCreativeContext(context),
      `\n# 已经认过的结构（照这个写）\n${outline.sections.map((section, index) => `${index + 1}. ${section.heading}\n   作用：${section.purpose}\n   用：${(section.uses || []).map((use) => use.label).join("、") || "（这一节靠推理，不引材料）"}`).join("\n")}`,
    ].join("\n"),
    maxTokens: 14_000,
  });
  const data = completion.data;
  const body = clean(data?.body_markdown || data?.bodyMarkdown, 120_000);
  if (!body) throw new Error("模型没有返回初稿正文");
  /**
   * ⚠️ **这是起稿这条路上唯一不能绕开的闸。**
   * 一篇读起来很顺的稿子里夹一句「我去年带的那个项目」，是这套系统最容易
   * 也最难被发现的造假——它不像错误，它像文采。
   */
  assertGroundedGeneratedText(body, context.experiences);
  return {
    title: clean(data?.title, 200),
    body,
    note: clean(data?.note, 1_000),
    context: summarize(context),
    model: completion.model || "",
  };
}
