/**
 * 内容构造的模型协议：**几种讲法**，以及用自然语言继续推。
 *
 * ⚠️ **这里要防的不是「模型答错」，是「模型给三个看起来不同、其实一样的东西」。**
 * 三张卡片、三个入口、读起来都挺顺——退化成这样的时候一点都不像出错，
 * 所以差异必须由服务端**算**出来（`routesAreDistinct`），算不出差别的直接丢掉。
 *
 * ⚠️ **一个字都不写库。** 这里产出的始终是候选；只有用户点「保存为内容机会」
 * 才走 `saveOpportunity`，那一步有事务、freshness 和 provenance 硬闸。
 */

import { completeJson } from "../lib/model-json.mjs";
import { CONTENT_BRIDGE_VALUES, validateContentConstruction } from "./content-bridge.mjs";
import { buildContentBridgeContext } from "./content-bridge-context.mjs";
import { describeElementPool, distinctRoutes } from "./content-construction.mjs";

const clean = (value, max = 8_000) => String(value ?? "").trim().slice(0, max);
const ACTIONS = new Set(["knowledge", "judgment", "experience", "demonstration"]);
const RELATION_TYPES = new Set(CONTENT_BRIDGE_VALUES.relationTypes);
const ACTION_LABELS = Object.freeze({
  knowledge: "知识型：解释机制，让人看懂它为什么这样运作",
  judgment: "判断型：正面处理一个对立，最后落到一个可被反驳的判断",
  experience: "经历型：从一段真实经历进入，再把它抽象成判断",
  demonstration: "展示型：把两种做法并排做一遍，用结果说话",
});

function completionFor(env) {
  return typeof env?.CONTENT_CONSTRUCTION_COMPLETE_JSON === "function"
    ? env.CONTENT_CONSTRUCTION_COMPLETE_JSON
    : typeof env?.CONTENT_BRIDGE_COMPLETE_JSON === "function"
      ? env.CONTENT_BRIDGE_COMPLETE_JSON
      : completeJson;
}

function connectionBrief(connection) {
  return [
    `真实问题：${clean(connection.problem?.statement, 500)}`,
    connection.problem?.origin === "hypothesis"
      ? "⚠️ 这条问题是从长期议程推导的假设，还没有任何人真的这样问过。不得写「大家都在问」「很多人反映」这类关于人数或频率的断言。"
      : `有人真的这样说过，原话：\n${(connection.problem?.evidence || []).map((item) => `「${clean(item.quote, 600)}」`).join("\n") || "（这条问题在工作台里已确认）"}`,
    `AI 发现的核心连接：${clean(connection.fitReason, 2_000)}`,
    `连接指向的判断：${clean(connection.coreClaim, 2_000)}`,
    `锚点知识：${(connection.knowledgeAnchors || []).map((item) => `${item.title}（${item.wikiPageId}）`).join("、")}`,
  ].filter(Boolean).join("\n");
}

function routesSystemPrompt({ hasExperience, count }) {
  return [
    "你帮一个内容创作者把一条已经成立的连接，构造成几种**真正不同的讲法**。",
    `给 ${count} 条。宁可只给 2 条真的不一样的，也不要给 3 条换汤不换药的。`,
    "",
    "⚠️ 什么叫真正不同：进入现实的入口不同、主导表达动作不同、用到的材料不同、最后落下的判断不同。",
    "⚠️ 什么不算不同：同一个结构换三个标题；同一批材料换个顺序；同一句判断换种说法。",
    "如果这条连接确实只撑得起一种讲法，就只给一条，并在 note 里说明为什么。",
    "",
    "主导表达动作只能是：",
    ...Object.entries(ACTION_LABELS)
      .filter(([key]) => hasExperience || key !== "experience")
      .map(([key, label]) => `  ${key} — ${label}`),
    hasExperience
      ? "经历型只能使用下面列出的真实个人经历，必须引用它的 source_id，不得虚构。"
      : "⚠️ 工作区里一条真实个人经历都没有。**不要返回 experience 主导动作，也不要生成任何 experience 要素**；这条路线现在不存在。",
    "",
    "supporting_elements 是这条讲法真正会用到的东西，每条都要给 source_kind + source_id，且只能引用下面池子里真实存在的 id。",
    "  可用的 element type：concept, fact, case, experience, judgment, problem, evidence, method, analogy, conflict, observation。",
    "  judgment 和 analogy 允许没有来源（它们是你的组织方式）；其余类型必须带真实来源。",
    "  ⚠️ 不要只用锚点那一页。锚点只是入口，构造得好不好取决于你从整个池子里找到了什么。",
    `relations 的 type 只能是这几个之一：${CONTENT_BRIDGE_VALUES.relationTypes.join("、")}。from/to 必须是上面 supporting_elements 里的 id。`,
    "key_relation 说明这些东西为什么这样组织，不是复述它们。",
    "risk 说明这条讲法最容易出什么问题（讲太大、缺证据、像科普、结论太绝对……）。",
    "entry 是大众入口，必须是正文真能回答的问题，不能是标题党。",
    "core_claim 是一句能被反驳的判断，三条路线的 core_claim 不能只是换说法。",
    "knowledge_explanation 说明这条讲法用什么解释这个问题；cognitive_gap 说明大众现在卡在哪。",
    "只输出 JSON。",
    JSON.stringify({
      routes: [{
        id: "A",
        label: "从工具焦虑进入",
        dominant_action: "judgment",
        entry: "",
        storyline: "从什么进入 → 用什么解释 → 怎么转折 → 落到什么判断",
        key_relation: "",
        core_claim: "",
        knowledge_explanation: "",
        cognitive_gap: "",
        risk: "",
        supporting_elements: [{ id: "e1", type: "concept", label: "", source_kind: "wiki_page", source_id: "", role: "这条在这里承担什么" }],
        relations: [{ from: "e1", to: "e2", type: "problem_to_mechanism", explanation: "" }],
        evidence_gaps: [""],
        counterarguments: [{ claim: "", response: "" }],
      }],
      note: "",
    }),
  ].filter(Boolean).join("\n");
}

/**
 * 收一条路线。
 *
 * 返回 `null` = 这条不可用（引用了池子里没有的东西、缺必填、或者在没有经历时
 * 声称经历型），直接丢掉而不是让整次构造失败。
 *
 * ⚠️ **丢掉的原因要记下来。** 三条全被丢掉、界面上只显示「没有可用的讲法」，
 * 是这一整块最难查的一种故障：模型明明返回了东西，而你完全不知道它坏在哪。
 * `dropped` 会跟着结果一起回到界面和日志里。
 */
function normalizeRoute(item, { index, allowedSources, hasExperience, dropped = [] }) {
  const drop = (reason) => { dropped.push({ id: clean(item?.id, 20) || String(index + 1), reason }); return null; };
  if (!item || typeof item !== "object") return drop("返回的不是一个对象");
  const dominantAction = clean(item.dominant_action || item.dominantAction, 40);
  if (!ACTIONS.has(dominantAction)) return drop(`主导动作无效：${dominantAction || "空"}`);
  if (!hasExperience && dominantAction === "experience") return drop("工作区没有个人经历，经历型这条路线不成立");

  const coreClaim = clean(item.core_claim || item.coreClaim, 4_000);
  const knowledgeExplanation = clean(item.knowledge_explanation || item.knowledgeExplanation, 8_000);
  const cognitiveGap = clean(item.cognitive_gap || item.cognitiveGap, 4_000);
  const entry = clean(item.entry, 1_000);
  const storyline = clean(item.storyline, 4_000);
  if (!coreClaim || !knowledgeExplanation || !cognitiveGap || !entry || !storyline) {
    return drop(`缺少必填：${[["core_claim", coreClaim], ["knowledge_explanation", knowledgeExplanation], ["cognitive_gap", cognitiveGap], ["entry", entry], ["storyline", storyline]].filter(([, v]) => !v).map(([k]) => k).join("、")}`);
  }

  const elements = (Array.isArray(item.supporting_elements || item.supportingElements)
    ? (item.supporting_elements || item.supportingElements) : []).slice(0, 24);
  /**
   * ⚠️ **认不出的关系类型丢掉那一条，不作废整条讲法。**
   * 真实跑第一轮就是这么全军覆没的：三条讲法的要素、来源、判断全都站得住，
   * 只因为模型把关系写成了词表外的一个词，整批被判无效，界面上只剩「暂时没有」。
   * 关系是「为什么这样组织」这一层，它说不清不等于这条讲法是编的——
   * 而编造来源是另一回事，那个仍然一票否决。
   */
  const relations = (Array.isArray(item.relations) ? item.relations : [])
    .filter((relation) => RELATION_TYPES.has(clean(relation?.type, 60)));
  let construction;
  try {
    /**
     * ⚠️ 直接复用保存时那套校验，不另写一份。
     * 构造阶段放行、保存阶段才拒绝，是这类功能最难查的一种毛病：
     * 用户已经花时间读完选完，才被告诉「这条不能存」。
     */
    construction = validateContentConstruction({
      route: { id: clean(item.id, 120) || String.fromCharCode(65 + index), storyline, key_relation: item.key_relation || item.keyRelation, risk: item.risk },
      elements,
      relations,
      entry_options: [{ text: entry, scope_check: { status: "supported", reason: clean(item.entry_reason || item.entryReason, 2_000) || "这条讲法的正文能够回答这个入口。" } }],
      evidence_gaps: item.evidence_gaps || item.evidenceGaps || [],
      counterarguments: item.counterarguments || [],
    }, { allowedSources });
  } catch (error) {
    return drop(error.message || "构造校验没通过");
  }
  if (!construction.elements.length) return drop("一条材料都没用上");

  return {
    id: construction.route.id,
    label: clean(item.label, 120) || `讲法 ${construction.route.id}`,
    dominantAction,
    entry,
    storyline,
    keyRelation: construction.route.key_relation,
    risk: construction.route.risk,
    coreClaim,
    knowledgeExplanation,
    cognitiveGap,
    supportingElements: construction.elements.map((element, position) => ({
      id: element.id,
      type: element.type,
      label: element.label,
      sourceKind: element.source_kind,
      sourceId: element.source_id,
      role: clean(elements[position]?.role, 500),
    })),
    evidenceGaps: construction.evidence_gaps.map((gap) => gap.claim),
    counterarguments: construction.counterarguments,
    construction,
  };
}

function poolContext(workspace, connection, { agendaId = "" } = {}) {
  const anchor = connection.knowledgeAnchors?.[0]?.wikiPageId;
  const context = buildContentBridgeContext(workspace, {
    wikiPageId: anchor,
    audienceProblemId: connection.problem?.existingProblemId || undefined,
    problemCandidate: connection.problem?.existingProblemId ? null : {
      statement: connection.problem?.statement,
      summary: connection.problem?.whyItMatters,
      origin: connection.problem?.origin,
      originAgendaId: connection.problem?.originAgendaId,
      evidence: connection.problem?.evidence || [],
    },
    agendaId: agendaId || null,
    includeExperiences: true,
    scope: "workspace",
  });
  return context;
}

export async function proposeConstructionRoutes(env, workspace, { connection, agendaId = "", count = 3 } = {}) {
  if (!connection?.knowledgeAnchors?.length) throw Object.assign(new Error("这条连接没有可用的锚点知识"), { status: 400 });
  const context = poolContext(workspace, connection, { agendaId });
  const pool = context.pool;
  const size = Math.max(2, Math.min(3, Number(count) || 3));

  const completion = await completionFor(env)(env, {
    system: routesSystemPrompt({ hasExperience: pool.hasExperience, count: size }),
    user: [
      connectionBrief(connection),
      context.agenda ? `我的长期议程：\n${JSON.stringify({ title: context.agenda.title, desiredJudgment: context.agenda.desiredJudgment })}` : "",
      "以下是我整个工作区里可用的内容要素。只能引用这里出现过的 id：",
      describeElementPool(pool),
    ].filter(Boolean).join("\n\n"),
    maxTokens: 12_000,
  });

  const data = completion.data;
  if (!data || typeof data !== "object" || !Array.isArray(data.routes)) throw new Error("模型没有返回 routes 数组");
  const dropped = [];
  const normalized = data.routes
    .slice(0, 5)
    .map((item, index) => normalizeRoute(item, { index, allowedSources: context.allowedSources, hasExperience: pool.hasExperience, dropped }))
    .filter(Boolean);
  const routes = distinctRoutes(normalized, size);

  return {
    routes,
    /** 被算成「和已有那条没有实质差别」而丢掉的条数。真实用起来要能看见这个数。 */
    droppedAsSame: normalized.length - routes.length,
    /** 因为不合格被丢掉的，以及为什么。全军覆没时界面靠它说人话。 */
    dropped,
    note: clean(data.note, 1_000),
    experienceAvailable: pool.hasExperience,
    poolSize: pool.size,
    freshness: context.freshness,
    model: completion.model || "",
  };
}

/**
 * 用一句话继续推。
 *
 * ⚠️ **只改当前这条路线，不改正式正文、不改内容机会、不改 Wiki。**
 * 也不允许它顺手把 core_claim 换成一个和用户要求无关的东西：
 * 用户说「结论别太绝对」，回来发现整篇讲法都换了，比不改还糟。
 */
export async function refineConstructionRoute(env, workspace, { connection, route, instruction, agendaId = "" } = {}) {
  const ask = clean(instruction, 2_000);
  if (!ask) throw Object.assign(new Error("先说说你想怎么调整"), { status: 400 });
  if (!route) throw Object.assign(new Error("还没有选中的讲法"), { status: 400 });
  const context = poolContext(workspace, connection, { agendaId });
  const pool = context.pool;

  const completion = await completionFor(env)(env, {
    system: [
      "你在按创作者的一句话，修改**当前这一条**内容构造路线。",
      "只改他要求的那部分。没被要求改的入口、判断、材料和关系保持原样——",
      "他说「结论别太绝对」，回来发现整条讲法都换了，比不改还糟。",
      "如果他要求的东西工作区里没有（比如「找我以前的案例」但确实没有相关案例），",
      "如实在 note 里说没有，并给出最接近的替代，不要编一个。",
      pool.hasExperience
        ? "经历型只能使用给出的真实个人经历。"
        : "⚠️ 工作区里一条真实个人经历都没有。不得改成 experience 主导动作，也不得加入 experience 要素；如果他要的是经历型，就在 note 里说明需要先补一段真实经历。",
      "supporting_elements 只能引用下面池子里真实存在的 id。",
      "note 用一句话说明你改了什么、为什么；没能满足的部分要说出来。",
      "只输出 JSON，结构和输入的 route 一致，外加 note。",
      JSON.stringify({
        route: {
          id: "", label: "", dominant_action: "", entry: "", storyline: "", key_relation: "",
          core_claim: "", knowledge_explanation: "", cognitive_gap: "", risk: "",
          supporting_elements: [{ id: "", type: "", label: "", source_kind: "", source_id: "", role: "" }],
          relations: [{ from: "", to: "", type: "", explanation: "" }],
          evidence_gaps: [""], counterarguments: [{ claim: "", response: "" }],
        },
        note: "",
      }),
    ].filter(Boolean).join("\n"),
    user: [
      connectionBrief(connection),
      `当前这条讲法：\n${JSON.stringify({
        id: route.id,
        label: route.label,
        dominant_action: route.dominantAction,
        entry: route.entry,
        storyline: route.storyline,
        key_relation: route.keyRelation,
        core_claim: route.coreClaim,
        knowledge_explanation: route.knowledgeExplanation,
        cognitive_gap: route.cognitiveGap,
        risk: route.risk,
        supporting_elements: route.supportingElements,
        relations: route.construction?.relations || [],
        evidence_gaps: route.evidenceGaps,
        counterarguments: route.counterarguments,
      })}`,
      `我说：${ask}`,
      "以下是我整个工作区里可用的内容要素。只能引用这里出现过的 id：",
      describeElementPool(pool),
    ].join("\n\n"),
    maxTokens: 12_000,
  });

  const data = completion.data;
  const dropped = [];
  const revised = normalizeRoute(data?.route, { index: 0, allowedSources: context.allowedSources, hasExperience: pool.hasExperience, dropped });
  if (!revised) {
    throw Object.assign(new Error("这次调整没能产出一条站得住的讲法"), {
      status: 422,
      hint: [dropped[0]?.reason, clean(data?.note, 300)].filter(Boolean).join("；")
        || "当前这条讲法没有被改动，你可以换个说法再试一次。",
    });
  }
  return {
    route: { ...revised, id: route.id, label: revised.label || route.label },
    note: clean(data?.note, 1_000),
    experienceAvailable: pool.hasExperience,
    freshness: context.freshness,
    model: completion.model || "",
  };
}
