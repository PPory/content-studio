import { completeJson } from "../lib/model-json.mjs";
import { validateContentConstruction } from "./content-bridge.mjs";
import { buildContentBridgeContext, hasPersonalExperience } from "./content-bridge-context.mjs";

const clean = (value, max = 8_000) => String(value ?? "").trim().slice(0, max);
const PROBLEM_PATTERNS = new Set(["trend", "frequency", "knowledge_gap", "feedback"]);
const FITS = new Set(["strong", "medium", "weak"]);
const ACTIONS = new Set(["knowledge", "judgment", "experience", "demonstration"]);
const AGENDA_FITS = new Set(["strong", "medium", "weak", "none"]);

function completionFor(env) {
  return typeof env?.CONTENT_BRIDGE_COMPLETE_JSON === "function" ? env.CONTENT_BRIDGE_COMPLETE_JSON : completeJson;
}

function exactQuote(source, quote) {
  const value = clean(quote, 2_000);
  if (value.length < 6 || !source.includes(value)) throw new Error("用户问题候选的来源原文无法在洞察报告中逐字定位");
  return value;
}

function insightSource(workspace, insightId) {
  const row = workspace.db.prepare(`SELECT k.id,k.title,k.body_markdown AS body,k.locator
    FROM knowledge_items k JOIN entities e ON e.id=k.id AND e.deleted_at IS NULL
    WHERE k.id=? AND k.knowledge_kind='knowledge_card' AND k.locator LIKE 'insight:%'`).get(clean(insightId, 500));
  if (!row) throw Object.assign(new Error("洞察报告不存在"), { status: 404 });
  return row;
}

function normalizeProblemCandidates(data, source) {
  if (!data || typeof data !== "object" || !Array.isArray(data.problems)) throw new Error("模型没有返回 problems 数组");
  return data.problems.slice(0, 12).map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`第 ${index + 1} 个用户问题候选格式无效`);
    const statement = clean(item.statement, 500);
    const whyItMatters = clean(item.why_it_matters || item.whyItMatters, 2_000);
    const pattern = clean(item.pattern, 80);
    if (!statement || !whyItMatters) throw new Error(`第 ${index + 1} 个用户问题候选缺少问题或价值说明`);
    if (!PROBLEM_PATTERNS.has(pattern)) throw new Error(`第 ${index + 1} 个用户问题候选的模式不受支持`);
    const evidenceText = exactQuote(source.body, item.evidence_quote || item.evidenceQuote);
    return {
      statement,
      whyItMatters,
      pattern,
      sourceRefs: [`insight:${source.id}`],
      sources: [{
        sourceKind: "insight_report",
        sourceId: source.id,
        evidenceText,
        observedAt: new Date().toISOString(),
      }],
    };
  });
}

export async function extractAudienceProblemCandidates(env, workspace, { insightId } = {}) {
  const source = insightSource(workspace, insightId);
  const completion = await completionFor(env)(env, {
    system: [
      "你为内容创作者从一份已经保存的洞察报告中提炼真实用户问题。",
      "问题必须写成人正在困惑什么，不要把热点标题改写成另一个标题。",
      "不能凭空声称大家都在关心；每个问题必须给出报告中的逐字 evidence_quote。",
      "只输出 JSON，不要创建项目、写稿或修改知识库。",
      "pattern 只能是 trend、frequency、knowledge_gap、feedback。",
      '结构：{"problems":[{"statement":"...","why_it_matters":"...","pattern":"knowledge_gap","evidence_quote":"报告中的连续逐字原文"}]}',
    ].join("\n"),
    user: `洞察报告 ID：${source.id}\n标题：${source.title}\n\n报告正文：\n${clean(source.body, 60_000)}`,
    maxTokens: 5_000,
  });
  return {
    source: { id: source.id, title: source.title, kind: "insight_report" },
    problems: normalizeProblemCandidates(completion.data, source),
    model: completion.model || "",
  };
}

/**
 * 议程推导出的问题候选。
 *
 * ⚠️ 和 `normalizeProblemCandidates` 最关键的区别是**这里没有 evidence_quote**。
 * 洞察提取必须逐字定位到报告原文，因为那是观察；议程推导没有可定位的东西，
 * 它是创作者对受众的预测。强行要一段「证据」只会逼模型编。
 * 真实性由别处保证：`origin='hypothesis'` 永久标注，且一条来源都不写。
 */
function normalizeAgendaProblemCandidates(data, agenda) {
  if (!data || typeof data !== "object" || !Array.isArray(data.problems)) throw new Error("模型没有返回 problems 数组");
  return data.problems.slice(0, 12).map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`第 ${index + 1} 个用户问题候选格式无效`);
    const statement = clean(item.statement, 500);
    const whyItMatters = clean(item.why_it_matters || item.whyItMatters, 2_000);
    if (!statement || !whyItMatters) throw new Error(`第 ${index + 1} 个用户问题候选缺少问题或价值说明`);
    return {
      statement,
      whyItMatters,
      // pattern 与 origin 由服务端钉死，不进提示词也不接受模型返回值。
      pattern: "knowledge_gap",
      origin: "hypothesis",
      originAgendaId: agenda.id,
      sources: [],
    };
  });
}

export async function extractAgendaProblemCandidates(env, workspace, { agendaId } = {}) {
  const agenda = workspace.contentBridge.agenda(clean(agendaId, 120));
  if (agenda.status !== "active") throw Object.assign(new Error("已归档议程不能继续推导用户问题"), { status: 409 });
  const existing = workspace.contentBridge.audienceProblems().map((item) => item.statement);
  const completion = await completionFor(env)(env, {
    system: [
      "你帮内容创作者把一条长期议程展开成受众可能正在困惑的具体问题。",
      "这些问题是**假设**，不是观察。你没有任何真实用户数据。",
      "因此绝对不要写「很多人反映」「大家都在问」「普遍存在」这类关于人数或频率的断言。",
      "每个 statement 写成一个具体的人会怎么把这个困惑说出口，用第一人称或日常口语，不要写成话题、领域或标题。",
      "why_it_matters 说明这个困惑为什么值得被这条议程回答，不要复述 statement。",
      "不要重复或改写已有问题列表里已经存在的问题。",
      "宁可少给也不要凑数：这条议程如果撑不出值得记的问题，返回空数组，这是合格结果。",
      "只输出 JSON，不要创建项目、写稿或修改知识库。",
      '结构：{"problems":[{"statement":"...","why_it_matters":"..."}]}',
    ].join("\n"),
    user: [
      `长期议程：\n${JSON.stringify(agenda)}`,
      `已有的用户问题（不要重复）：\n${JSON.stringify(existing)}`,
    ].join("\n\n"),
    maxTokens: 4_000,
  });
  return {
    agenda: { id: agenda.id, title: agenda.title, desiredJudgment: agenda.desiredJudgment },
    problems: normalizeAgendaProblemCandidates(completion.data, agenda),
    model: completion.model || "",
  };
}

function normalizeBridgeCandidate(data, { hasExperience, allowedSources }) {
  if (!data || typeof data !== "object") throw new Error("模型没有返回内容机会对象");
  const fit = clean(data.fit, 20);
  if (!FITS.has(fit)) throw new Error("模型返回的匹配度无效");
  const dominantAction = clean(data.dominant_action || data.dominantAction, 40);
  if (!ACTIONS.has(dominantAction)) throw new Error("模型返回的主导表达动作无效");
  const audienceProblem = data.audience_problem || data.audienceProblem || {};
  const agendaFit = data.agenda_fit || data.agendaFit || { status: "none", reason: "未选择长期议程" };
  const agendaStatus = clean(agendaFit.status, 20) || "none";
  if (!AGENDA_FITS.has(agendaStatus)) throw new Error("模型返回的议程匹配状态无效");
  const candidate = {
    fit,
    fitReason: clean(data.fit_reason || data.fitReason, 4_000),
    audienceProblem: {
      surface: clean(audienceProblem.surface, 2_000),
      underlying: clean(audienceProblem.underlying, 2_000),
    },
    knowledgeExplanation: clean(data.knowledge_explanation || data.knowledgeExplanation, 8_000),
    coreClaim: clean(data.core_claim || data.coreClaim, 4_000),
    cognitiveGap: clean(data.cognitive_gap || data.cognitiveGap, 4_000),
    dominantAction,
    construction: validateContentConstruction({
      elements: data.elements || [],
      relations: data.relations || [],
      entry_options: data.entry_options || data.entryOptions || [],
      evidence_gaps: data.evidence_gaps || data.evidenceGaps || [],
      counterarguments: data.counterarguments || [],
    }, { allowedSources }),
    agendaFit: { status: agendaStatus, reason: clean(agendaFit.reason, 2_000) },
    experience: {
      available: hasExperience,
      notice: hasExperience ? "存在可核验的个人经历来源，仍需在具体候选中携带来源。" : "当前没有真实个人经历来源，只能建议用户补充，不能生成第一人称经历。",
    },
  };
  for (const [label, value] of [
    ["匹配理由", candidate.fitReason],
    ["用户表层问题", candidate.audienceProblem.surface],
    ["用户深层问题", candidate.audienceProblem.underlying],
    ["知识解释", candidate.knowledgeExplanation],
    ["核心判断", candidate.coreClaim],
    ["认知差", candidate.cognitiveGap],
    ["议程匹配说明", candidate.agendaFit.reason],
  ]) if (!value) throw new Error(`模型返回缺少${label}`);
  /**
   * ⚠️ 没有真实经历时，**主导动作本身**就不许是经历型——不只是不许有经历要素。
   * 一份标着「经历型」却没有任何经历依据的候选，等于给后面的写作发一张
   * 「这里该讲个人故事」的空头许可，而那个故事只能是编的。
   */
  if (!hasExperience && dominantAction === "experience") {
    throw new Error("当前没有真实个人经历来源，不能返回经历型主导动作");
  }
  if (!hasExperience && candidate.construction.elements.some((item) => item.type === "experience")) {
    throw new Error("当前没有真实个人经历来源，模型却生成了经历要素");
  }
  return candidate;
}

export async function previewContentOpportunity(env, workspace, { wikiPageId, audienceProblemId, problemCandidate = null, agendaId = null, dominantAction = "" } = {}) {
  const requestedAction = clean(dominantAction, 40);
  if (requestedAction && !ACTIONS.has(requestedAction)) throw Object.assign(new Error("主导表达动作不受支持"), { status: 400 });
  /**
   * ⚠️ **经历型这条路存不存在，要在跑模型之前就知道。**
   * 原来这一位是 `experiences.length > 0`，而 experiences 只在用户明确点了
   * 「经历型」时才去查——于是「有没有真实经历」和「这次要不要读经历正文」
   * 被同一个变量表示了。真实工作区里一条个人经历都没有，却仍然能跑出一份
   * 经历型候选、并且保存成功。
   *
   * 现在没有经历就**当场拒绝**，并说清楚下一步该做什么，而不是等保存时才报错，
   * 更不是生成一份没有依据的经历型空壳让人先读一遍。
   */
  const hasExperience = hasPersonalExperience(workspace);
  if (requestedAction === "experience" && !hasExperience) {
    throw Object.assign(new Error("工作区没有可核验的个人经历，暂时不能走经历型"), {
      status: 409,
      hint: "如果你确实有一段相关的真实经历，先把它作为「个人经历」素材存进工作台，再回来沿这条路线构造。",
    });
  }
  const context = buildContentBridgeContext(workspace, {
    wikiPageId, audienceProblemId, problemCandidate, agendaId, includeExperiences: requestedAction === "experience",
  });
  const { wiki, problem, agenda, experiences, allowedSources } = context;
  const completion = await completionFor(env)(env, {
    system: [
      "你为 Content Studio 判断一份长期知识能否自然解释一个真实用户问题。",
      "先判断连接强弱；没有自然连接时必须返回 weak，不能为了产出文章硬连。",
      "先形成问题、解释、认知差和核心判断，不要先给标题。",
      "fit 只能 strong、medium、weak，不使用分数。",
      hasExperience
        ? "dominant_action 只能 knowledge、judgment、experience、demonstration。"
        : "dominant_action 只能 knowledge、judgment、demonstration。工作区没有任何真实个人经历，经历型这条路现在不存在，不要返回它。",
      "大众入口 entry_options 必须包含 scope_check.status=supported|too_broad 和 reason；不能承诺正文回答不了的问题。",
      "事实、数据、引用只能基于给出的 Wiki 与来源；证据不足要放进 evidence_gaps。",
      hasExperience
        ? "只可使用本次提供的个人经历。experience 要素必须使用 source_kind=material 和给出的真实 source_id，不得伪造。"
        : "工作区没有个人经历来源。不得生成第一人称经历或 experience 要素；若建议经历型，只能提示用户补充真实经历。",
      agenda ? "评估这条内容是否强化所选议程；不匹配时如实返回 weak 或 none。" : "没有选择议程，agenda_fit.status 返回 none。",
      /**
       * 假设型问题是创作者自己从议程推导的，没有任何人真的这样问过。
       * 这一条把它接进已有的 evidence_gaps 机制，不另造概念。
       */
      problem.origin === "hypothesis"
        ? "⚠️ 这条用户问题是创作者从自己的长期议程推导出的假设，尚无任何真实观察证据。不得在知识解释、认知差或大众入口中声称已经有人这样提问或这类困惑很普遍；并且必须把「验证这个问题在真实受众中是否存在」作为一条 evidence_gaps。"
        : "",
      "elements 类型只能 concept,fact,case,experience,judgment,problem,evidence,method,analogy,conflict,observation。",
      `所有需要来源的 elements 和 evidence_gaps.source_refs，只能引用以下 source_kind/source_id 对：${JSON.stringify(allowedSources)}`,
      "relations 类型只能 causal,analogy,contrast,conflict,support,challenge,concept_to_case,case_to_abstraction,problem_to_mechanism,mechanism_to_method，且 from/to 必须引用 elements.id。",
      "只输出 JSON。",
      JSON.stringify({
        fit: "strong|medium|weak",
        fit_reason: "",
        audience_problem: { surface: "", underlying: "" },
        knowledge_explanation: "",
        core_claim: "",
        cognitive_gap: "",
        dominant_action: "judgment",
        elements: [{ id: "problem", type: "problem", label: "", source_kind: "audience_problem", source_id: "" }],
        relations: [{ from: "problem", to: "knowledge", type: "problem_to_mechanism", explanation: "" }],
        entry_options: [{ text: "", scope_check: { status: "supported", reason: "" } }],
        evidence_gaps: [{ claim: "", needed: "", source_refs: [] }],
        counterarguments: [{ claim: "", response: "" }],
        agenda_fit: { status: "strong|medium|weak|none", reason: "" },
      }),
    ].filter(Boolean).join("\n"),
    user: [
      `Wiki 页面：\n${JSON.stringify(wiki)}`,
      `用户问题与来源：\n${JSON.stringify(problem)}`,
      `长期议程：\n${JSON.stringify(agenda)}`,
      `可使用的个人经历：\n${JSON.stringify(experiences)}`,
      requestedAction ? `用户指定主导表达动作：${requestedAction}` : "请建议主导表达动作。",
    ].join("\n\n"),
    maxTokens: 8_000,
  });
  return {
    candidate: {
      ...normalizeBridgeCandidate(completion.data, { hasExperience, allowedSources }),
      freshness: context.freshness,
      // 界面靠它决定要不要显示「经历型」那颗按钮：不能提供的路线不该摆在那儿等人点。
      experienceAvailable: hasExperience,
      problemView: {
        id: problem.id,
        statement: problem.statement,
        origin: problem.origin,
        sources: problem.sources,
      },
    },
    model: completion.model || "",
  };
}

export async function previewContentOpportunityAgendaFit(env, workspace, {
  wikiPageId, audienceProblemId, problemCandidate = null, agendaId, candidate,
} = {}) {
  const context = buildContentBridgeContext(workspace, { wikiPageId, audienceProblemId, problemCandidate, agendaId });
  if (!context.agenda) throw Object.assign(new Error("请选择长期议程"), { status: 400 });
  const proposal = {
    coreClaim: clean(candidate?.coreClaim, 4_000),
    cognitiveGap: clean(candidate?.cognitiveGap, 4_000),
    knowledgeExplanation: clean(candidate?.knowledgeExplanation, 8_000),
  };
  if (!proposal.coreClaim || !proposal.cognitiveGap || !proposal.knowledgeExplanation) {
    throw Object.assign(new Error("当前内容机会候选不完整"), { status: 400 });
  }
  const completion = await completionFor(env)(env, {
    system: [
      "你只评估当前内容候选与长期议程的匹配关系，不得改写候选的核心判断、认知差、知识解释或内容结构。",
      "status 只能 strong、medium、weak。只输出 JSON：{\"agenda_fit\":{\"status\":\"strong|medium|weak\",\"reason\":\"...\"}}。",
    ].join("\n"),
    user: `当前候选：\n${JSON.stringify(proposal)}\n\n长期议程：\n${JSON.stringify(context.agenda)}`,
    maxTokens: 1_200,
  });
  const raw = completion.data?.agenda_fit || completion.data?.agendaFit;
  const status = clean(raw?.status, 20);
  const reason = clean(raw?.reason, 2_000);
  if (!["strong", "medium", "weak"].includes(status) || !reason) throw new Error("模型返回的议程匹配结果无效");
  return {
    agendaFit: { status, reason },
    agendaFreshness: { agendaId: context.agenda.id, agendaUpdatedAt: context.agenda.updatedAt },
    model: completion.model || "",
  };
}
