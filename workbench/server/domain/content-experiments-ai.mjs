import { completeJson } from "../lib/model-json.mjs";

/**
 * 发布之后的反馈 → 新的用户问题候选。
 *
 * ⚠️ **必须有真实反馈原话才能跑。** 只有数据（阅读量、收藏数）时不生成候选：
 * 从「收藏率偏高」推不出任何人具体在困惑什么，那一步是创作者自己的推断，
 * 写成「用户问题」就是把推断伪装成观察。
 *
 * 有原话时，每条候选必须能逐字定位回那段原话——和洞察提取同一条硬闸。
 * 所以这里产出的是 origin=observed 的问题：它确实有人说过。
 */

const clean = (value, max = 8_000) => String(value ?? "").trim().slice(0, max);

function completionFor(env) {
  return typeof env?.CONTENT_BRIDGE_COMPLETE_JSON === "function" ? env.CONTENT_BRIDGE_COMPLETE_JSON : completeJson;
}

function exactQuote(source, quote) {
  const value = clean(quote, 2_000);
  if (value.length < 6 || !source.includes(value)) throw new Error("用户问题候选的原话无法在这段反馈里逐字定位");
  return value;
}

export async function extractExperimentProblemCandidates(env, workspace, { experimentId, feedbackText = "" } = {}) {
  const experiment = workspace.experiments.experiment(experimentId);
  if (experiment.verdict === "open") throw Object.assign(new Error("先结算这次实验，再从反馈里读用户问题"), { status: 409 });
  const feedback = clean(feedbackText, 20_000);
  if (!feedback) {
    throw Object.assign(new Error("需要真实反馈原话才能读出用户问题"), {
      status: 400,
      hint: "把评论、私信或群里的原话贴进来。只有阅读量和收藏数的话，读出的问题是推断，不是观察。",
    });
  }
  const existing = workspace.contentBridge.audienceProblems().map((item) => item.statement);
  const completion = await completionFor(env)(env, {
    system: [
      "你从一次内容发布收到的真实反馈里，读出受众正在困惑的问题。",
      "每条候选都必须给出 evidence_quote：反馈中连续的逐字原文，不能改写、不能拼接。",
      "读不出真正的困惑就返回空数组——这是合格结果，不要为了凑数把感谢、夸奖或无关闲聊硬读成问题。",
      "statement 写成一个具体的人会怎么把困惑说出口，不要写成话题或标题。",
      "不要重复已有问题列表里已经存在的问题。",
      "只输出 JSON，不要创建项目、写稿或修改知识库。",
      '结构：{"problems":[{"statement":"...","why_it_matters":"...","evidence_quote":"反馈中的连续逐字原文"}]}',
    ].join("\n"),
    user: [
      `这次实验的假设：\n${experiment.hypothesisMarkdown}`,
      `发生了什么：\n${experiment.outcomeMarkdown}`,
      `我更新了什么判断：\n${experiment.learningMarkdown}`,
      `收到的真实反馈原话：\n${feedback}`,
      `已有的用户问题（不要重复）：\n${JSON.stringify(existing)}`,
    ].join("\n\n"),
    maxTokens: 4_000,
  });
  const data = completion.data;
  if (!data || typeof data !== "object" || !Array.isArray(data.problems)) throw new Error("模型没有返回 problems 数组");
  const problems = data.problems.slice(0, 12).map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`第 ${index + 1} 个用户问题候选格式无效`);
    const statement = clean(item.statement, 500);
    const whyItMatters = clean(item.why_it_matters || item.whyItMatters, 2_000);
    if (!statement || !whyItMatters) throw new Error(`第 ${index + 1} 个用户问题候选缺少问题或价值说明`);
    const evidenceText = exactQuote(feedback, item.evidence_quote || item.evidenceQuote);
    return {
      statement,
      whyItMatters,
      pattern: "feedback",
      // 有人真的这样说过，所以它是观察，不是假设。
      origin: "observed",
      sourceKind: "feedback",
      sources: [{
        sourceKind: "feedback",
        sourceId: `experiment:${experiment.id}`,
        evidenceText,
        observedAt: new Date().toISOString(),
      }],
    };
  });
  return {
    experiment: { id: experiment.id, projectTitle: experiment.projectTitle, verdict: experiment.verdict },
    problems,
    model: completion.model || "",
  };
}
