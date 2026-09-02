import { completeJson } from "../lib/model-json.mjs";
import { sourceContainsVerbatim } from "./integrity.mjs";
import { describeSettlementEvidence } from "./content-experiment-context.mjs";

/**
 * 发布之后的反馈 → 新的用户问题候选。
 *
 * ⚠️ **必须有真实反馈原话才能跑。** 只有数据（阅读量、收藏数）时不生成候选：
 * 从「收藏率偏高」推不出任何人具体在困惑什么，那一步是创作者自己的推断，
 * 写成「用户问题」就是把推断伪装成观察。
 *
 * 有原话时，每条候选必须能逐字定位回那段原话——和洞察提取同一条硬闸。
 * 所以这里产出的是 origin=observed 的问题：它确实有人说过。
 *
 * ⚠️ **反馈原文本身要先落进不可变证据层。**
 * 上一版把它当成一个临时字符串，产出的证据行写着 `source_id = experiment:<id>`——
 * 那个 id 指向一次实验，指不回任何一段原话。于是这条问题永远回溯不到
 * 「谁说了什么」，`gradeProblemEvidence` 也只能把它判成「人工记录」。
 * 闭环看着连上了，其实断在这里。现在反馈先成为一段 `audience_raw_source`，
 * 证据写成 `raw:<id>`，既能逐字回溯，也会被下一次 Discovery 直接读到。
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

/**
 * 把这次发布收到的反馈收进不可变证据层。
 *
 * ⚠️ 这一步是闭环真正闭上的地方：反馈从此是一段可回溯的原话，
 * 而不是某个表单里的临时字符串。它同时会被下一次 Discovery 读到——
 * 「这一篇发出去之后收到的话」本来就是下一篇最该看的现实声音。
 */
export function recordExperimentFeedback(workspace, { experimentId, feedbackText, now } = {}) {
  const experiment = workspace.experiments.experiment(experimentId);
  const feedback = clean(feedbackText, 20_000);
  if (!feedback) {
    throw Object.assign(new Error("需要真实反馈原话才能读出用户问题"), {
      status: 400,
      hint: "把评论、私信或群里的原话贴进来。只有阅读量和收藏数的话，读出的问题是推断，不是观察。",
    });
  }
  const publication = experiment.publicationId
    ? workspace.db.prepare("SELECT platform, title FROM publication_records WHERE id = ?").get(experiment.publicationId)
    : null;
  return workspace.audienceRaw.record({
    kind: "feedback",
    body: feedback,
    sourceName: publication
      ? `${publication.platform}《${publication.title}》发布后`
      : `《${experiment.projectTitle || "这一篇"}》发布后`,
    actor: "user",
    confirmed: true,
    now,
  });
}

export async function extractExperimentProblemCandidates(env, workspace, { experimentId, feedbackText = "", rawSourceId = "" } = {}) {
  const experiment = workspace.experiments.experiment(experimentId);
  if (experiment.verdict === "open") throw Object.assign(new Error("先结算这次实验，再从反馈里读用户问题"), { status: 409 });
  /**
   * ⚠️ 反馈先入证据层，再读问题。
   * 顺序反过来的话，产出的证据就只能指向一次实验，而不是指向那段话。
   */
  const source = clean(rawSourceId, 120)
    ? workspace.audienceRaw.source(clean(rawSourceId, 120))
    : recordExperimentFeedback(workspace, { experimentId, feedbackText }).source;
  const feedback = source.body;
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
        // ⚠️ 指向那段原话本身，不是指向这次实验：实验 id 回溯不到任何一句话。
        sourceId: source.ref,
        evidenceText,
        observedAt: source.observedAt,
      }],
    };
  });
  return {
    experiment: { id: experiment.id, projectTitle: experiment.projectTitle, verdict: experiment.verdict },
    /** 这段反馈现在是一段可回溯的原话，下一次 Discovery 会读到它。 */
    voice: { id: source.id, ref: source.ref, kindLabel: source.kindLabel, sourceName: source.sourceName },
    problems,
    model: completion.model || "",
  };
}

/**
 * 发布前：这一篇最值得验证什么。
 *
 * ⚠️ **这是在替换一个空白输入框**（「你为什么认为这一篇会有效？」）。
 * 那个框最常见的结果是随手写一句「用真实问题当入口应该会更好」——
 * 而这一篇的入口、讲法、判断和长期议程系统全都知道，本来就该由它先提。
 */
function normalizeHypotheses(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.hypotheses)) throw new Error("模型没有返回 hypotheses 数组");
  const items = data.hypotheses.slice(0, 3).map((item) => ({
    hypothesis: clean(item?.hypothesis, 1_000),
    why: clean(item?.why, 2_000),
    /**
     * ⚠️ **说不出「什么结果算不成立」的假设不是假设。**
     * 它一定会被判成 supported——真实库里那条唯一的实验就是这么结的
     *（「数据比之前好点」→ 一半一半 → 「下次可以继续这样尝试」）。
     */
    signal: clean(item?.signal, 2_000),
  })).filter((item) => item.hypothesis && item.why && item.signal);
  if (!items.length) throw new Error("模型没有给出可用的假设候选");
  return items;
}

export async function proposeExperimentHypotheses(env, workspace, context) {
  if (!context.opportunity) {
    throw Object.assign(new Error("这个项目没有关联的内容机会"), {
      status: 409,
      hint: "从内容里发展一条连接并保存成内容机会，再建立项目，系统才知道这一篇的策略是什么。",
    });
  }
  const completion = await completionFor(env)(env, {
    system: [
      "你帮内容创作者想清楚：这一篇发出去，最值得验证的是什么。",
      "给 2 到 3 条，每条都要能被结果否掉。",
      "⚠️ 假设要针对**这一篇的策略选择**（入口、讲法、主导动作），不要写「希望多点阅读」这种和策略无关的愿望。",
      "⚠️ signal 必须说清什么结果算成立、什么算不成立。说不出「什么算不成立」的假设不是假设，它一定会被判成成立。",
      "⚠️ 不要假设任何你看不到的历史表现；只有下面给了基线才可以提「比以往如何」。",
      "why 说明为什么这一篇适合验证它——通常是这一篇相对以往变了什么。",
      "不要重复下面列出的、已经验证过的假设。",
      "只输出 JSON。",
      JSON.stringify({ hypotheses: [{ hypothesis: "", why: "", signal: "" }] }),
    ].join("\n"),
    user: [
      `这一篇的用户问题：${context.problem?.statement || "（没有关联问题）"}`,
      context.problem?.origin === "hypothesis" ? "⚠️ 这条问题本身还是假设，没有人真的这样问过。" : "",
      `核心判断：${context.opportunity.coreClaim}`,
      `主导表达动作：${context.opportunity.dominantAction}`,
      context.route ? `选定的讲法：${context.route.storyline}${context.route.risk ? `\n这条讲法最容易出的问题：${context.route.risk}` : ""}` : "",
      context.entryOptions.length ? `大众入口：${context.entryOptions.map((item) => item.text).join("；")}` : "",
      context.agenda ? `长期议程：${context.agenda.title}——${context.agenda.desiredJudgment}` : "",
      context.history.length
        ? `已经验证过的假设（不要重复）：\n${context.history.map((item) => `- ${item.hypothesis}（${item.verdict}）→ ${item.learning}`).join("\n")}`
        : "还没有任何已结算的实验，所以没有历史可参照。",
    ].filter(Boolean).join("\n\n"),
    maxTokens: 3_000,
  });
  return { hypotheses: normalizeHypotheses(completion.data), model: completion.model || "" };
}

/**
 * 发布后：这次到底发生了什么。
 *
 * ⚠️ **观察和推断必须分开，而且分开这件事要由服务端保证。**
 * 「收藏率高于过去五篇的中位数」是观察，「这说明判断边界比 AI 会让人变笨更能引发讨论」
 * 是推断。混在一起写，复盘就变成了一段读起来很有道理、但没人能复核的话。
 *
 * 判据很硬：一条观察要么引用了这次真实给出的数字，要么逐字引用了粘进来的反馈原文。
 * 两样都对不上就**降级成推断**——不是丢掉，因为那句话可能仍然有用，
 * 但它不是观察，不能挂着观察的可信度。
 */
function classifyObservations(items, context) {
  const observations = [];
  const demoted = [];
  const metricValues = context.metrics ? Object.entries(context.metrics.values).map(([key, value]) => `${key}${value}`) : [];
  for (const item of Array.isArray(items) ? items.slice(0, 8) : []) {
    const text = clean(item?.text, 2_000);
    if (!text) continue;
    const basisKind = clean(item?.basis_kind || item?.basisKind, 40);
    const quote = clean(item?.quote, 2_000);

    if (basisKind === "feedback" && context.feedback && quote && sourceContainsVerbatim(context.feedback, quote)) {
      observations.push({ text, basisKind: "feedback", quote });
      continue;
    }
    if (basisKind === "metric" && context.metrics) {
      const key = clean(item?.metric, 40);
      const value = context.metrics.values[key];
      if (value != null) {
        observations.push({
          text,
          basisKind: "metric",
          metric: key,
          metricLabel: context.metricLabels[key] || key,
          value,
          baseline: context.baseline.available ? context.baseline.values[key] ?? null : null,
        });
        continue;
      }
    }
    demoted.push({ text, reason: basisKind === "feedback" ? "这句原话在反馈里逐字找不到" : "这条数字不在这次拿到的数据里" });
  }
  return { observations, demoted };
}

export async function previewExperimentSettlement(env, workspace, context) {
  /**
   * ⚠️ **一点真实数据都没有的时候，不跑模型。**
   * 那种情况下模型只能靠假设本身反推一段听起来合理的复盘，
   * 而那正是「把推断伪装成观察」最典型的样子。
   */
  if (!context.hasEvidence) {
    return {
      observations: [],
      inferences: [],
      demoted: [],
      verdict: null,
      verdictReason: "",
      learningCandidate: "",
      nextExperiment: "",
      note: "这一篇还没有任何数字，也没有一句真实反馈——现在结算只能靠猜。",
      missing: context.missing,
      model: "",
    };
  }

  const completion = await completionFor(env)(env, {
    system: [
      "你帮内容创作者复盘一次已经发布的内容实验。",
      "",
      "⚠️ **observations 和 inferences 必须分开。**",
      "observation 是**能被别人复核的事实**：一个给定的数字，或者反馈里的一句逐字原话。",
      "  - 引用数字时：basis_kind=\"metric\"，metric 填字段名（views/likes/comments/collects/shares）。",
      "  - 引用原话时：basis_kind=\"feedback\"，quote 填反馈里**连续的逐字原文**，不能改写。",
      "  - 上面没给你的数字和没出现过的原话，一律不能写成 observation。",
      "inference 是你的解释和推测。它可以有价值，但它不是事实，写进 inferences 里。",
      "",
      "verdict 只能 supported、mixed、refuted，并说明依据。",
      "证据不足以判断时，verdict 用 mixed 并在 verdict_reason 里说清还缺什么。",
      "learning_candidate 是一句**下次会因此改变什么**的话，不要写「继续保持」这种没有动作的总结。",
      "next_experiment 是下一次值得验证的一件事。",
      "只输出 JSON。",
      JSON.stringify({
        observations: [{ text: "", basis_kind: "metric|feedback", metric: "", quote: "" }],
        inferences: [""],
        verdict: "supported|mixed|refuted",
        verdict_reason: "",
        learning_candidate: "",
        next_experiment: "",
      }),
    ].join("\n"),
    user: describeSettlementEvidence(context),
    maxTokens: 5_000,
  });

  const data = completion.data || {};
  const { observations, demoted } = classifyObservations(data.observations, context);
  const inferences = (Array.isArray(data.inferences) ? data.inferences : [])
    .slice(0, 8).map((item) => clean(typeof item === "string" ? item : item?.text, 2_000)).filter(Boolean);
  const verdict = clean(data.verdict, 20);
  return {
    observations,
    /** 被降级的那些也跟着回去：它们仍然是推断，只是模型本来把它们当成了事实。 */
    inferences: [...inferences, ...demoted.map((item) => item.text)],
    demoted,
    verdict: ["supported", "mixed", "refuted"].includes(verdict) ? verdict : "mixed",
    verdictReason: clean(data.verdict_reason || data.verdictReason, 2_000),
    learningCandidate: clean(data.learning_candidate || data.learningCandidate, 4_000),
    nextExperiment: clean(data.next_experiment || data.nextExperiment, 2_000),
    note: "",
    missing: context.missing,
    model: completion.model || "",
  };
}
