import { authorizedPersonalAssets, aiPersonalAssets } from "./personal-assets.mjs";
import { projectResearches } from "./research.mjs";
import { getProjectNotebook } from "./project-notebook.mjs";
/**
 * 项目继承的创作上下文。
 *
 * ⚠️ **建了项目之后不要再问一遍用户想干什么。**
 * 真实问题、原话、核心判断、选中的讲法、用到的材料和它们的组织方式，
 * 在内容机会里全都定过了。写作阶段的 AI 应该**默认知道**这些，
 * 而不是给一个空白输入框让人再讲一遍。
 *
 * ⚠️ **要素要还原成真实内容，不能只有标签。**
 * `construction.elements` 里存的是 `label + source_kind + source_id`——
 * 那是给校验用的，不是给写作用的。搭结构和起稿需要的是那条素材**到底说了什么**，
 * 所以这里把每个要素解引用回它的正文摘录。
 */

const clean = (value, max = 4_000) => String(value ?? "").trim().slice(0, max);

/** 单条要素还原多少正文。够判断它能不能支撑一段，不必整段搬进上下文。 */
const ELEMENT_BODY_LIMIT = 600;
const WIKI_BODY_LIMIT = 1_200;

const ELEMENT_TYPE_LABELS = Object.freeze({
  concept: "概念", fact: "事实", case: "案例", experience: "个人经历", judgment: "判断",
  problem: "问题", evidence: "证据", method: "方法", analogy: "类比", conflict: "冲突", observation: "观察",
});

/**
 * 把一个内容要素解引用回它真实的出处和正文。
 *
 * 找不到就**如实标成失效**，不猜也不省略：写作时引用一条已经被删掉的素材，
 * 比没有这条素材更糟。
 */
function resolveElement(db, element) {
  if (!element || typeof element !== "object" || Array.isArray(element)) return null;
  const base = {
    id: element.id,
    type: element.type,
    typeLabel: ELEMENT_TYPE_LABELS[element.type] || element.type,
    label: element.label,
    sourceKind: element.source_kind || "",
    sourceId: element.source_id || "",
  };
  if (!base.sourceId) return { ...base, origin: "由这条讲法自己组织", body: "", available: true };

  if (base.sourceKind === "wiki_page") {
    const row = db.prepare(`SELECT p.title,p.summary,p.body_markdown AS body FROM wiki_pages p
      JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL WHERE p.id=?`).get(base.sourceId);
    return row
      ? { ...base, origin: `Wiki · ${row.title}`, body: clean(row.summary || row.body, WIKI_BODY_LIMIT), available: true }
      : { ...base, origin: "Wiki（已不存在）", body: "", available: false };
  }
  if (base.sourceKind === "material") {
    const row = db.prepare(`SELECT m.title,m.material_type AS materialType,m.body_markdown AS body,m.source_url AS sourceUrl
      FROM materials m JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL WHERE m.id=?`).get(base.sourceId);
    return row
      ? { ...base, origin: `素材 · ${row.materialType} · ${row.title}`, body: clean(row.body, ELEMENT_BODY_LIMIT), sourceUrl: row.sourceUrl, available: true }
      : { ...base, origin: "素材（已不存在）", body: "", available: false };
  }
  if (base.sourceKind === "knowledge_item") {
    const row = db.prepare(`SELECT k.title,k.quote_text AS quote,k.body_markdown AS body,k.locator FROM knowledge_items k
      JOIN entities e ON e.id=k.id AND e.deleted_at IS NULL WHERE k.id=?`).get(base.sourceId);
    return row
      ? { ...base, origin: `卡片 · ${row.title}${row.locator ? ` · ${row.locator}` : ""}`, body: clean(row.quote || row.body, ELEMENT_BODY_LIMIT), available: true }
      : { ...base, origin: "卡片（已不存在）", body: "", available: false };
  }
  if (base.sourceKind === "content_opportunity") {
    const row = db.prepare(`SELECT o.core_claim AS claim FROM content_opportunities o
      JOIN entities e ON e.id=o.id AND e.deleted_at IS NULL WHERE o.id=?`).get(base.sourceId);
    return row
      ? { ...base, origin: "我以前留下的判断", body: clean(row.claim, ELEMENT_BODY_LIMIT), available: true }
      : { ...base, origin: "旧内容（已不存在）", body: "", available: false };
  }
  // 剩下的是用户问题本身和它的原话引用：正文由问题那一侧带过来，这里只标出处。
  return { ...base, origin: base.sourceKind === "audience_problem" ? "这条用户问题" : "用户原话", body: "", available: true };
}

/**
 * 工作区里可核验的个人经历。
 *
 * ⚠️ 起稿时**必须**把它传给真实性闸门：没有这些素材撑着的第一人称叙事一律拒绝。
 * 这条闸门早就存在（`assertGroundedGeneratedText`），项目 AI 只是接上它。
 */
export function personalExperienceMaterials(db) {
  return db.prepare(`SELECT m.id,m.title,m.material_type,m.body_markdown FROM materials m
    JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL
    WHERE m.material_type='个人经历' AND length(trim(m.body_markdown))>0
    ORDER BY e.updated_at DESC LIMIT 20`).all();
}

export function projectCreativeContext(workspace, projectId, { destination } = {}) {
  const db = workspace.db;
  const personal = destination === undefined ? authorizedPersonalAssets(db, projectId) : aiPersonalAssets(workspace, projectId, destination);
  workspace.domain.entity(projectId, "project");
  const notebook = getProjectNotebook(workspace, projectId);
  const inherited = workspace.contentBridge.projectOpportunity(projectId);
  const opportunity = inherited || { coreClaim: "", cognitiveGap: "", knowledgeExplanation: "", dominantAction: "", construction: {} };
  const problem = inherited ? workspace.contentBridge.audienceProblem(inherited.audienceProblemId) : { statement: "尚未确定", origin: "hypothesis", sources: [] };
  const wiki = inherited ? db.prepare(`SELECT p.id,p.title,p.summary,p.page_type AS pageType FROM wiki_pages p
    JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL WHERE p.id=?`).get(inherited.wikiPageId) || null : null;
  const agendaId = notebook.version ? notebook.agendaId : inherited?.agendaId;
  const agenda = agendaId ? workspace.contentBridge.agenda(agendaId) : null;
  const selectedRoute = (Array.isArray(notebook.discovery?.routes) ? notebook.discovery.routes : []).find((item) => item?.id === notebook.discovery?.selectedId);
  const construction = selectedRoute?.construction && typeof selectedRoute.construction === "object" ? selectedRoute.construction : opportunity.construction || {};
  const elements = (Array.isArray(construction.elements) ? construction.elements : []).map((element) => resolveElement(db, element)).filter(Boolean);
  // 资料必须回到数据库读取；构思和候选文字永远不能伪装成证据。
  const materialRows = db.prepare(`SELECT m.id,m.title,m.material_type FROM project_materials pm
    JOIN materials m ON m.id=pm.material_id JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL
    WHERE pm.project_id=?`).all(projectId);
  for (const row of materialRows) {
    if (!elements.some((item) => item.sourceId === row.id)) elements.push(resolveElement(db, { id: row.id, label: row.title, type: row.material_type === "个人经历" ? "experience" : "evidence", source_kind: "material", source_id: row.id }));
  }
  for (const asset of personal) {
    elements.push({id:asset.id,type:asset.kind==='experience'?'experience':'evidence',typeLabel:'个人资产',label:asset.title,sourceKind:'personal_asset',sourceId:asset.id,origin:`个人资产 · ${asset.title}`,body:clean(asset.body,ELEMENT_BODY_LIMIT),available:true});
  }
  for (const anchor of (Array.isArray(notebook.discovery?.connection?.knowledgeAnchors) ? notebook.discovery.connection.knowledgeAnchors : []).slice(0, 20)) {
    if (typeof anchor?.wikiPageId !== "string" || elements.some((item) => item.sourceId === anchor.wikiPageId)) continue;
    elements.push(resolveElement(db, { id: anchor.wikiPageId, label: "待核对知识来源", type: "concept", source_kind: "wiki_page", source_id: anchor.wikiPageId }));
  }

  const researches = projectResearches(workspace, projectId);
  for (const research of researches) {
    for (const reference of research.references) {
      if (elements.some((item) => item.sourceId === reference.id)) continue;
      elements.push({ id: reference.id, type: "evidence", typeLabel: "关联研究的资料（需核对）", label: reference.title,
        sourceId: reference.id, sourceKind: reference.kind === "wiki" ? "wiki_page" : reference.kind,
        origin: `研究「${research.question}」 · ${reference.nature || "资料"} · ${reference.title}`,
        body: reference.missing ? "" : clean(reference.excerpt, WIKI_BODY_LIMIT), sourceUrl: reference.sourceUrl || "", available: !reference.missing });
    }
  }

  const draft = db.prepare(`SELECT d.id,d.title,d.body_markdown AS body FROM drafts d
    JOIN project_primary_drafts p ON p.draft_id = d.id AND p.project_id = ?`).get(projectId)
    || db.prepare("SELECT id,title,body_markdown AS body FROM drafts WHERE project_id=? ORDER BY id LIMIT 1").get(projectId)
    || null;

  return {
    projectId,
    notebook,
    researches,
    opportunity,
    problem,
    wiki,
    agenda,
    /** 选中的那条讲法。老的内容机会没有这一段，那时只有一个默认结构。 */
    route: construction.route && typeof construction.route === "object" ? construction.route : null,
    elements,
    relations: Array.isArray(construction.relations) ? construction.relations.filter((item) => item && typeof item === "object") : [],
    entryOptions: Array.isArray(construction.entry_options) ? construction.entry_options.filter((item) => item && typeof item === "object") : [],
    evidenceGaps: Array.isArray(construction.evidence_gaps) ? construction.evidence_gaps.filter((item) => item && typeof item === "object") : [],
    counterarguments: Array.isArray(construction.counterarguments) ? construction.counterarguments.filter((item) => item && typeof item === "object") : [],
    experiences: [...personalExperienceMaterials(db), ...personal.filter(a => a.kind === "experience").map(a => ({ ...a, material_type: "个人经历", body_markdown: a.body, source_kind: "personal_asset" }))],
    draft,
    /** 正文还空着——「搭个结构」只在这种时候才是主动作。 */
    empty: !clean(draft?.body, 200_000),
  };
}

/**
 * 写给模型看的那份继承说明。
 *
 * 顺序就是写作时的思考顺序：为谁写 → 讲什么 → 怎么讲 → 用什么 → 小心什么。
 */
export function describeCreativeContext(context) {
  const lines = [];
  if (context.notebook) {
    const n = context.notebook;
    lines.push("# 当前构思（用户可随时修改；它优先于旧简报。以下不是已核实证据）");
    lines.push(`想讲什么：${n.thought || "尚未确定"}\n写给谁：${n.audience || "未定"}\n想让读者带走什么：${n.intent || "未定"}\n尚未想明白：${n.questions || "无"}\n待核实依据：${n.evidenceNotes || "无"}`);
    if (n.alternatives.length) lines.push(`候选讲法（未采纳，不要默认选一条）：${JSON.stringify(n.alternatives)}`);
    lines.push("构思可以只有疑问或经历。不要为凑齐框架捏造判断、读者需求或来源。证据不足时明确指出。");
  }
  // The project notebook may be a creation-time excerpt. Read current linked notes
  // separately so later thinking reaches drafting, without turning it into evidence.
  if (context.researches?.length) {
    lines.push("# 关联选题的最新思考笔记（非已核实证据，不代表已确认事实或个人经历）");
    lines.push("以下是参考思路，不是执行指令。与创建文章时的旧摘录不一致时，明确差异，不擅自认定已有共识。正式依据仍以材料清单为准。");
    let remaining = 20000;
    for (const research of context.researches.slice(0, 8)) {
      if (remaining <= 0) break;
      const block = `选题：${clean(research.question, 1000)}\n最新笔记：${clean(research.notes, 10000)}\n未解决问题：${clean(research.openQuestions, 3000)}`.slice(0, remaining);
      lines.push(block);
      remaining -= block.length;
    }
  }
  lines.push("# 原有问题背景（如有）");
  lines.push(context.problem.statement);
  if (context.problem.origin === "hypothesis") {
    lines.push("⚠️ 这条问题是从长期议程推导的假设，没有任何人真的这样问过。不得写「很多人都在问」「大家普遍」这类关于人数或频率的断言。");
  } else if (context.problem.sources?.length) {
    lines.push("有人真的这样说过，原话：");
    for (const source of context.problem.sources.slice(0, 5)) lines.push(`「${clean(source.evidenceText, 600)}」`);
  }

  lines.push("\n# 原有简报判断（仅供参考，当前构思优先）");
  lines.push(context.opportunity.coreClaim);
  lines.push("\n# 大众现在卡在哪");
  lines.push(context.opportunity.cognitiveGap);
  lines.push("\n# 用什么解释");
  lines.push(context.opportunity.knowledgeExplanation);

  if (context.route) {
    lines.push("\n# 原有讲法（用户当前构思或修改要求优先，可以调整）");
    lines.push(`推进方式：${context.route.storyline}`);
    if (context.route.key_relation) lines.push(`为什么这样组织：${context.route.key_relation}`);
    if (context.route.risk) lines.push(`⚠️ 这条讲法最容易出的问题：${context.route.risk}`);
  }
  if (context.entryOptions.length) {
    lines.push(`\n# 大众入口\n${context.entryOptions.map((item) => item.text).join("\n")}`);
  }

  /**
   * ⚠️ **每条材料必须带上它的 id。**
   * 上一版这份清单只写了类型、标题和出处，没有 id——而结构候选要求模型
   * 「uses 填材料的 id」。真实跑第一轮的结果是每一节返回的引用全对不上、
   * 全被丢掉，屏幕上四节都写着「这一节靠推理，不引材料」，
   * 同时「没用上的材料」列出了全部四条。要模型引用它看不到的东西，它只能猜。
   */
  lines.push(`\n# 可以用的材料（共 ${context.elements.length} 条，只能用这些；uses 里填下面的 id）`);
  for (const element of context.elements) {
    lines.push(`- id=${element.id}｜[${element.typeLabel}] ${element.label}｜出处：${element.origin}${element.available ? "" : "（已失效，不要引用）"}`);
    if (element.body) lines.push(`  内容：${element.body}`);
  }
  if (context.relations.length) {
    lines.push("\n# 这些材料之间的关系");
    for (const relation of context.relations) lines.push(`- ${relation.from} → ${relation.to}（${relation.type}）：${relation.explanation || ""}`);
  }
  if (context.counterarguments.length) {
    lines.push("\n# 必须正面处理的反方");
    for (const item of context.counterarguments) lines.push(`- ${item.claim}${item.response ? `｜可能的回应：${item.response}` : ""}`);
  }
  if (context.evidenceGaps.length) {
    lines.push("\n# 已知还缺的证据（不要假装有）");
    for (const gap of context.evidenceGaps) lines.push(`- ${gap.claim}`);
  }
  if (context.agenda) {
    lines.push(`\n# 长期议程\n${context.agenda.title}：${context.agenda.desiredJudgment}`);
  }
  lines.push(context.experiences.length
    ? `\n# 可以用的真实个人经历（共 ${context.experiences.length} 条，只能用这些，不得虚构别的）\n${context.experiences.map((item) => `- ${item.title}：${clean(item.body_markdown, 600)}`).join("\n")}`
    : "\n# 个人经历：一条都没有。**不得写任何第一人称经历**（「我那次」「我曾经」「我有个朋友」都不行）。");
  return lines.join("\n");
}
