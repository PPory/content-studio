/**
 * AI Discovery 的模型协议。
 *
 * 输入：我的知识索引 + 现实里的原话和已确认问题 + 长期议程。
 * 输出：少量**连接候选**——不是选题列表，也不是文章。
 *
 * ⚠️ **这里一个字都不写库。** 候选里的用户问题可能根本还不存在于 `audience_problems`，
 * 那是故意的：先建问题再谈连接，等于要求用户替系统整理数据，而多数连接在被
 * 看见之前根本不知道值不值得记。用户点「保存为内容机会」时才一次性入库。
 *
 * ⚠️ **模型说某句话是原话，不算数。** 每一条 evidence 都要能在被引用的那段
 * 原始声音里逐字定位，定位不上就丢掉那条证据；一条自称「观察到」的候选如果
 * 最后一条证据都不剩，**整条丢掉**——它的问题、解释和判断都是从那句编出来的
 * 原话长出来的，留着只是把一次伪造洗成一条合法的猜测。
 */

import { completeJson } from "../lib/model-json.mjs";
import { assertRawSourceEvidence, rawSourceRef } from "./audience-raw.mjs";

const clean = (value, max = 8_000) => String(value ?? "").trim().slice(0, max);
const FITS = new Set(["strong", "medium", "weak"]);
const AGENDA_FITS = new Set(["strong", "medium", "weak", "none"]);
const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 5;

function completionFor(env) {
  return typeof env?.CONTENT_DISCOVERY_COMPLETE_JSON === "function"
    ? env.CONTENT_DISCOVERY_COMPLETE_JSON
    : typeof env?.CONTENT_BRIDGE_COMPLETE_JSON === "function"
      ? env.CONTENT_BRIDGE_COMPLETE_JSON
      : completeJson;
}

function systemPrompt({ hasVoices, hasAgenda, limit }) {
  return [
    "你为一个内容创作者在他自己的知识和现实里听到的真实声音之间寻找值得表达的连接。",
    `最多给 ${limit} 条，宁可少给。找不到自然的连接就返回空数组并说明原因——这是合格结果，不是失败。`,
    "不要生成选题列表、标题或文章。每条候选要回答：谁在困惑什么、我的哪块知识能解释它、为什么这两者值得连接、可能留下什么判断。",
    "fit 只能 strong、medium、weak，不使用分数、热度或爆款概率。",
    "knowledge_anchors 只能引用给定 Wiki 索引里真实存在的 id，最多 3 个，并说明为什么是它。",
    "",
    "关于用户问题的来历，只有两种：",
    "1. observed：有人真的这样说过。必须给出 evidence，每条 evidence 的 quote 必须是所引用那段原话里**连续的逐字原文**，不能改写、不能拼接、不能翻译。",
    "2. hypothesis：你从创作者的**某一条长期议程**推导出来的猜测，没有任何人真的这样说过。这时必须在 agenda_suggestion.agenda_id 里写出是哪一条议程，写不出来就不要给这条候选。",
    "",
    "⚠️ hypothesis 候选中绝对不要写「大家都在问」「很多人反映」「普遍存在」这类关于人数或频率的断言——你没有任何数据支持它。",
    "⚠️ 已存在的用户问题请通过 existing_problem_id 引用，不要重复造一条；它的来历以工作台记录为准，你不要改。",
    hasVoices
      ? "现实侧给了尚未分析的原话。优先从原话里读出真正的困惑，而不是复述已有问题。"
      : "现实侧没有新的原话。只能基于已确认的用户问题，或如实给出 hypothesis 候选。",
    hasAgenda
      ? "创作者选了一条长期议程。在 agenda_suggestion 里说明这条连接是否强化它；不匹配就如实返回 weak 或 none。"
      : "没有选长期议程。如果某条连接反复指向一个尚未被命名的长期判断，可以在 agenda_suggestion.reason 里指出来，status 用 none。",
    "core_claim 写成一句可以被反驳的判断，不要写成主题或口号。",
    "cognitive_gap 说明大众现在的理解卡在哪，不要复述 core_claim。",
    "evidence_gaps 写这条内容目前还缺什么才站得住。",
    "只输出 JSON，不要创建项目、写稿或修改知识库。",
    JSON.stringify({
      connections: [{
        problem: {
          statement: "",
          why_it_matters: "",
          origin: "observed|hypothesis",
          existing_problem_id: "",
          evidence: [{ raw_source_id: "", quote: "" }],
        },
        knowledge_anchors: [{ wiki_page_id: "", reason: "" }],
        fit: "strong|medium|weak",
        fit_reason: "",
        knowledge_explanation: "",
        cognitive_gap: "",
        core_claim: "",
        agenda_suggestion: { agenda_id: "", status: "strong|medium|weak|none", reason: "" },
        evidence_gaps: [""],
      }],
      nothing_found_reason: "",
    }),
  ].filter(Boolean).join("\n");
}

function userPrompt(context) {
  const wiki = context.wikiPages
    .map((page) => `${page.id}\t${page.pageType}\t${page.title}\t${clean(page.summary, 300)}`)
    .join("\n");
  const problems = context.problems.map((problem) => ({
    id: problem.id,
    statement: problem.statement,
    summary: problem.summary,
    origin: problem.origin,
    evidence: problem.evidenceLabel,
    quotes: problem.quotes.map((item) => item.quote),
  }));
  const voices = context.voices.map((voice) => ({
    raw_source_id: voice.id,
    kind: voice.kindLabel,
    source_name: voice.sourceName,
    observed_at: voice.observedAt,
    truncated: voice.truncated,
    body: voice.body,
  }));
  return [
    `我的知识索引（id / 类型 / 标题 / 摘要，共 ${context.wikiPages.length} 条）：\n${wiki}`,
    `已确认的用户问题：\n${JSON.stringify(problems)}`,
    voices.length
      ? `现实里听到的原话（逐字引用必须来自这里）：\n${JSON.stringify(voices)}`
      : "现实里暂时没有可读的新原话。",
    context.agenda
      ? `当前长期议程：\n${JSON.stringify(context.agenda)}`
      : `我全部的长期议程：\n${JSON.stringify(context.agendas.map((item) => ({ id: item.id, title: item.title, desiredJudgment: item.desiredJudgment })))}`,
    context.focus ? `这次我想优先看：${context.focus}` : "",
  ].filter(Boolean).join("\n\n");
}

/**
 * 把模型返回的一条候选收成可以显示、可以继续构造的形状。
 *
 * 返回 `null` 表示这条候选不可用（引用了不存在的 Wiki、或者一条证据都留不下来），
 * 直接丢掉而不是让整次扫描失败——一条坏候选不该把另外三条好的一起带走。
 */
function normalizeConnection(workspace, item, { wikiById, problemById, voiceIds, agendaById }) {
  if (!item || typeof item !== "object") return null;
  const fit = clean(item.fit, 20);
  if (!FITS.has(fit)) return null;

  const anchors = (Array.isArray(item.knowledge_anchors) ? item.knowledge_anchors : [])
    .slice(0, 3)
    .map((anchor) => {
      const id = clean(anchor?.wiki_page_id || anchor?.wikiPageId, 120);
      const page = wikiById.get(id);
      return page ? { wikiPageId: id, title: page.title, pageType: page.pageType, summary: page.summary, reason: clean(anchor?.reason, 2_000) } : null;
    })
    .filter(Boolean);
  if (!anchors.length) return null;

  const raw = item.problem || {};
  const existingId = clean(raw.existing_problem_id || raw.existingProblemId, 120);
  const existing = existingId ? problemById.get(existingId) || null : null;

  /**
   * 逐字校验。模型给的 quote 必须真的在那段原话里连续出现，
   * 而且那段原话必须是**这次扫描实际读过的**——不能引用一段它根本没看到的东西。
   */
  const evidence = [];
  for (const entry of Array.isArray(raw.evidence) ? raw.evidence.slice(0, 6) : []) {
    const rawId = clean(entry?.raw_source_id || entry?.rawSourceId, 120);
    const quote = clean(entry?.quote, 2_000);
    if (!rawId || !quote || !voiceIds.has(rawId)) continue;
    try {
      const source = assertRawSourceEvidence(workspace.db, rawSourceRef(rawId), quote);
      evidence.push({
        rawSourceId: rawId,
        quote,
        kind: source.kind,
        kindLabel: source.kindLabel,
        sourceName: source.sourceName,
        observedAt: source.observedAt,
      });
    } catch {
      // 定位不上就丢这一条证据。不是整条候选的问题，除非最后一条都不剩。
    }
  }

  const suggestion = item.agenda_suggestion || item.agendaSuggestion || {};
  const suggestedAgendaId = clean(suggestion.agenda_id || suggestion.agendaId, 120);

  /**
   * ⚠️ **origin 由服务端定，不采信模型的自我声明。**
   *
   * 引用已有问题时以库里的记录为准。新问题分两种：
   *  - 模型自己就说是 hypothesis：诚实，留下；
   *  - 模型说 observed，但一条原话都没验证通过：**整条丢掉**，不降级成假设。
   *    降级看起来更宽容，实际是把一次伪造洗成一条「合法的猜测」——
   *    而这条候选的问题陈述、解释和判断全都是从那句编出来的原话长出来的。
   */
  const claimedOrigin = clean(raw.origin, 20);
  if (!existing && claimedOrigin === "observed" && !evidence.length) return null;
  const origin = existing ? existing.origin : evidence.length ? "observed" : "hypothesis";
  const statement = existing ? existing.statement : clean(raw.statement, 500);
  if (!statement) return null;

  /**
   * ⚠️ **假设必须说得出它是从哪条议程推导来的。**
   * 这不是形式要求：`audience_problems` 里假设的唯一合法出处就是那条议程，
   * 说不出来的假设保存时一定会被域层拒绝——那种候选摆在首页上只会浪费一次点击。
   */
  const originAgenda = existing || origin !== "hypothesis"
    ? null
    : agendaById.get(suggestedAgendaId) || (agendaById.size === 1 ? [...agendaById.values()][0] : null);
  if (!existing && origin === "hypothesis" && !originAgenda) return null;

  const knowledgeExplanation = clean(item.knowledge_explanation || item.knowledgeExplanation, 8_000);
  const coreClaim = clean(item.core_claim || item.coreClaim, 4_000);
  const cognitiveGap = clean(item.cognitive_gap || item.cognitiveGap, 4_000);
  const fitReason = clean(item.fit_reason || item.fitReason, 4_000);
  if (!knowledgeExplanation || !coreClaim || !cognitiveGap || !fitReason) return null;

  const agendaStatus = clean(suggestion.status, 20) || "none";

  return {
    problem: {
      existingProblemId: existing?.id || null,
      statement,
      whyItMatters: clean(raw.why_it_matters || raw.whyItMatters, 2_000),
      origin,
      originAgendaId: originAgenda?.id || null,
      evidence,
      // 界面直接用这句，不自己另编一套措辞——真实性文案只有一处真源。
      evidenceLabel: origin === "hypothesis"
        ? "你认为这可能是一个受众问题，尚待真实反馈验证"
        : existing && !evidence.length
          ? "已确认的用户问题"
          : `${evidence.length} 段可逐字回溯的真实原话`,
    },
    knowledgeAnchors: anchors,
    fit,
    fitReason,
    knowledgeExplanation,
    coreClaim,
    cognitiveGap,
    agendaSuggestion: {
      agendaId: agendaById.get(suggestedAgendaId)?.id || null,
      agendaTitle: agendaById.get(suggestedAgendaId)?.title || "",
      status: AGENDA_FITS.has(agendaStatus) ? agendaStatus : "none",
      reason: clean(suggestion.reason, 2_000),
    },
    evidenceGaps: (Array.isArray(item.evidence_gaps) ? item.evidence_gaps : [])
      .slice(0, 6)
      .map((gap) => clean(typeof gap === "string" ? gap : gap?.claim, 2_000))
      .filter(Boolean),
  };
}

export async function discoverConnections(env, workspace, context, { limit = DEFAULT_LIMIT } = {}) {
  const size = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
  const completion = await completionFor(env)(env, {
    system: systemPrompt({ hasVoices: context.voices.length > 0, hasAgenda: Boolean(context.agenda), limit: size }),
    user: userPrompt(context),
    maxTokens: 9_000,
  });
  const data = completion.data;
  if (!data || typeof data !== "object" || !Array.isArray(data.connections)) {
    throw new Error("模型没有返回 connections 数组");
  }
  const wikiById = new Map(context.wikiPages.map((page) => [page.id, page]));
  const problemById = new Map(context.problems.map((problem) => [problem.id, problem]));
  const voiceIds = new Set(context.voices.map((voice) => voice.id));
  const agendaById = new Map(context.agendas.map((agenda) => [agenda.id, agenda]));
  const connections = data.connections
    .slice(0, size)
    .map((item) => normalizeConnection(workspace, item, { wikiById, problemById, voiceIds, agendaById }))
    .filter(Boolean);
  return {
    connections,
    /**
     * ⚠️ 一条都没有时**必须说得出为什么**。
     * 「暂无结果」读完之后人不知道该干什么，而这一页的下一步恰恰取决于
     * 到底是没有原话、还是有原话但连不上知识。
     */
    nothingFoundReason: connections.length
      ? ""
      : clean(data.nothing_found_reason || data.nothingFoundReason, 1_000) || "这次没有找到足够自然的新连接。",
    model: completion.model || "",
  };
}
