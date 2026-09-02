import { assertRawSourceEvidence, isRawSourceRef, problemSourceKindForRawKind, rawSourceRef } from "./audience-raw.mjs";
import { workspaceElementPool } from "./content-construction.mjs";
import { sha256Json } from "./integrity.mjs";

/**
 * 一次构造允许引用多大范围的来源。
 *
 * - `anchor`：只有锚点 Wiki 和它的来源、这条用户问题、个人经历。
 *   旧的单路线分析走这条——它给模型看的就这些。
 * - `workspace`：整个工作区的要素池。多路线构造走这条，因为它给模型看的就是整个池子。
 *
 * ⚠️ **两边必须一致：给模型看什么，就允许它引用什么。**
 * 白名单比上下文宽，等于放行它没读过的来源；比上下文窄，等于它刚读过的东西引用不了。
 * 所以 scope 会写进 freshness——保存时用哪个范围校验，由**当初预览用的那个**决定。
 */
export const CONTEXT_SCOPES = Object.freeze(["anchor", "workspace"]);

const clean = (value) => String(value ?? "").trim();

function required(value, label) {
  const result = clean(value);
  if (!result) throw new TypeError(`${label}不能为空`);
  return result;
}

/**
 * 还没入库的用户问题候选。
 *
 * ⚠️ **它存在的理由是「发展这条」不该写库。** 从一段群聊里读出来的问题，多数在被
 * 看过一眼之后就该被放弃；先建 `audience_problems` 再谈连接，等于让每一次好奇心
 * 都在问题库里留下一条垃圾。所以候选一路带到最后，用户点「保存为内容机会」
 * 那一刻才在同一个事务里正式建问题。
 *
 * ⚠️ **候选的证据同样过逐字硬闸。** 没有入库不等于可以不真实。
 */
export function normalizeProblemCandidate(db, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("用户问题候选必须是对象");
  const statement = required(value.statement, "用户问题");
  if (statement.length > 500) throw new TypeError("用户问题不能超过 500 字");
  const summary = clean(value.summary || value.whyItMatters);
  if (summary.length > 2000) throw new TypeError("用户问题说明不能超过 2000 字");
  const origin = clean(value.origin) || "observed";
  if (!["observed", "hypothesis"].includes(origin)) throw new TypeError("用户问题来历不受支持");

  const evidence = (Array.isArray(value.evidence) ? value.evidence : []).map((item, index) => {
    const rawSourceId = required(item?.rawSourceId || item?.raw_source_id, `用户问题证据 ${index + 1} 来源`);
    const quote = required(item?.quote || item?.evidenceText, `用户问题证据 ${index + 1} 原话`);
    const ref = isRawSourceRef(rawSourceId) ? rawSourceId : rawSourceRef(rawSourceId);
    const source = assertRawSourceEvidence(db, ref, quote, `用户问题证据 ${index + 1}`);
    return { ref, rawSourceId: source.id, quote, kind: source.kind, observedAt: source.observedAt };
  });

  if (origin === "observed" && !evidence.length) {
    throw new Error("观察到的用户问题必须携带可逐字回溯的真实原话");
  }
  if (origin === "hypothesis" && evidence.length) {
    throw new Error("假设型用户问题不能携带观察证据");
  }
  if (origin === "hypothesis" && !clean(value.originAgendaId)) {
    throw new Error("假设型用户问题必须说明它是从哪条议程推导出来的");
  }

  return {
    statement,
    summary,
    origin,
    originAgendaId: origin === "hypothesis" ? clean(value.originAgendaId) : null,
    evidence,
  };
}

/**
 * 候选的内容指纹。
 *
 * Preview 与保存之间隔着用户读一遍、想一下的时间；这中间候选可能被改过。
 * 已入库的问题靠 `updatedAt` 判断，候选没有那个东西，所以拿内容自己当版本号。
 */
export function problemCandidateHash(candidate) {
  return sha256Json({
    statement: candidate.statement,
    summary: candidate.summary,
    origin: candidate.origin,
    originAgendaId: candidate.originAgendaId,
    evidence: candidate.evidence.map((item) => [item.rawSourceId, item.quote]),
  });
}

function candidateProblemView(candidate) {
  return {
    id: null,
    statement: candidate.statement,
    summary: candidate.summary,
    origin: candidate.origin,
    originAgendaId: candidate.originAgendaId,
    pattern: candidate.origin === "hypothesis" ? "knowledge_gap" : "feedback",
    status: "candidate",
    sources: candidate.evidence.map((item) => ({
      /**
       * ⚠️ 这里就用**最终入库时那个** source_kind，不用一个临时值。
       * 预览时告诉模型可以引用 `X|raw:<id>`，保存后库里却变成另一个 kind 的话，
       * 以后拿保存下来的 construction 重新校验会对不上，而那种错只在很久以后才炸。
       */
      sourceKind: problemSourceKindForRawKind(item.kind),
      sourceId: item.ref,
      evidenceText: item.quote,
      observedAt: item.observedAt,
    })),
  };
}

export function buildContentBridgeContext(workspace, {
  wikiPageId,
  audienceProblemId,
  problemCandidate = null,
  agendaId = null,
  includeExperiences = false,
  scope = "anchor",
} = {}) {
  if (!CONTEXT_SCOPES.includes(scope)) throw new TypeError("来源范围不受支持");
  const wiki = workspace.db.prepare(`SELECT p.id,p.title,p.summary,p.body_markdown AS bodyMarkdown,p.page_type AS pageType,
    p.current_revision AS currentRevision,p.updated_at AS updatedAt
    FROM wiki_pages p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL WHERE p.id=?`)
    .get(required(wikiPageId, "Wiki 页面 ID"));
  if (!wiki) throw Object.assign(new Error("Wiki 页面不存在"), { status: 404 });
  wiki.sources = workspace.db.prepare(`SELECT source_entity_id AS sourceId,source_quote AS quote,source_locator AS locator,contribution
    FROM wiki_page_sources WHERE page_id=? ORDER BY created_at DESC LIMIT 20`).all(wiki.id);

  /**
   * 两条进入方式：已入库的问题，或者还没入库的候选。
   * ⚠️ **不能两个都给**——那样保存时就说不清到底以哪一个为准。
   */
  if (audienceProblemId && problemCandidate) throw new TypeError("用户问题只能来自已保存记录或候选之一");
  const candidate = problemCandidate ? normalizeProblemCandidate(workspace.db, problemCandidate) : null;
  const problem = candidate
    ? candidateProblemView(candidate)
    : workspace.contentBridge.audienceProblem(required(audienceProblemId, "用户问题 ID"));
  if (!candidate && problem.status !== "active") throw Object.assign(new Error("用户问题已归档"), { status: 409 });

  const agenda = agendaId ? workspace.contentBridge.agenda(required(agendaId, "议程 ID")) : null;
  if (agenda && agenda.status !== "active") throw Object.assign(new Error("议程已归档"), { status: 409 });

  const experiences = includeExperiences ? workspace.db.prepare(`SELECT m.id,m.title,m.body_markdown AS bodyMarkdown,e.updated_at AS updatedAt
    FROM materials m JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL
    WHERE m.material_type='个人经历' AND length(trim(m.body_markdown))>0
    ORDER BY e.updated_at DESC,m.id DESC LIMIT 12`).all() : [];

  // 整个工作区的要素池只在 workspace 范围里取——anchor 范围压根不需要读它。
  const pool = scope === "workspace" ? workspaceElementPool(workspace.db) : null;

  return {
    wiki,
    problem,
    problemCandidate: candidate,
    agenda,
    experiences,
    scope,
    pool,
    allowedSources: [
      { sourceKind: "wiki_page", sourceId: wiki.id },
      ...wiki.sources.map((item) => ({ sourceKind: "raw", sourceId: item.sourceId })),
      // 候选还没有 id，所以它不能当来源；它的**证据**可以，那些是真实存在的原话。
      ...(problem.id ? [{ sourceKind: "audience_problem", sourceId: problem.id }] : []),
      ...problem.sources.map((item) => ({ sourceKind: item.sourceKind, sourceId: item.sourceId })),
      ...experiences.map((item) => ({ sourceKind: "material", sourceId: item.id })),
      ...(pool?.allowedSources || []),
    ],
    freshness: {
      wikiPageId: wiki.id,
      wikiRevision: wiki.currentRevision,
      audienceProblemId: problem.id,
      audienceProblemUpdatedAt: problem.id ? problem.updatedAt : null,
      problemCandidateHash: candidate ? problemCandidateHash(candidate) : null,
      agendaId: agenda?.id || null,
      agendaUpdatedAt: agenda?.updatedAt || null,
      scope,
    },
  };
}

export function assertContentBridgeFreshness(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Preview 版本信息不能为空");
  const same = clean(value.wikiPageId) === expected.wikiPageId
    && Number(value.wikiRevision) === expected.wikiRevision
    && (clean(value.audienceProblemId) || null) === (expected.audienceProblemId || null)
    && (clean(value.audienceProblemUpdatedAt) || null) === (expected.audienceProblemUpdatedAt || null)
    && (clean(value.problemCandidateHash) || null) === (expected.problemCandidateHash || null)
    && (clean(value.agendaId) || null) === expected.agendaId
    && (clean(value.agendaUpdatedAt) || null) === expected.agendaUpdatedAt
    /**
     * ⚠️ 范围也要对得上。多路线构造引用了整个工作区，用 anchor 范围去校验它一定会失败；
     * 反过来，拿 anchor 范围产出的候选按 workspace 范围保存，等于悄悄放宽了它的白名单。
     * 老数据没有这一位，按 anchor 处理。
     */
    && (clean(value.scope) || "anchor") === (expected.scope || "anchor");
  if (!same) throw Object.assign(new Error("相关知识、用户问题或议程已更新，请重新预览后再保存"), { status: 409 });
  return { ...expected };
}

/**
 * 工作区里有没有可核验的个人经历。
 *
 * ⚠️ **单独算一次，不跟着 `includeExperiences` 走。** 那个开关决定的是
 * 「这次要不要把经历正文喂给模型」，而这里回答的是「经历型这条路存不存在」——
 * 两件事混在一起，就会出现库里一条个人经历都没有、却保存下一条主导动作是
 * 「经历型」的内容机会（真实工作区里已经有这么一条）。
 */
export function hasPersonalExperience(workspace) {
  return workspace.db.prepare(`SELECT COUNT(*) AS count FROM materials m
    JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL
    WHERE m.material_type='个人经历' AND length(trim(m.body_markdown))>0`).get().count > 0;
}
