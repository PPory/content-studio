// 内容构造：要素池、路线差异判据、真实性硬闸、自然语言继续推、候选不写库。
//
// 这里最要紧的一条不是「模型答对了」，是**「三条讲法不能只是换标题」**——
// 那种退化看起来完全不像出错，所以差异必须由服务端算出来。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import {
  claimOverlap,
  distinctRoutes,
  routesAreDistinct,
  workspaceElementPool,
} from "../server/domain/content-construction.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-content-construction-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-02T08:00:00.000Z");
let workspace;
let server;
let respond = null;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

const CHAT = [
  "阿泽：AI 工具一周出三个，我到底该学哪个",
  "小林：收藏夹里躺了二十个教程，一个都没打开",
].join("\n");
const QUOTE = "AI 工具一周出三个，我到底该学哪个";

function wikiPage(title, summary, pageType = "concept") {
  const id = createUlid();
  const stamp = now.toISOString();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id, type: "wiki_page", now });
    workspace.db.prepare(`INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,current_revision,schema_version,created_at,updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`).run(id, title, pageType, summary, `# ${title}\n\n${summary}`, stamp, stamp);
    workspace.repository.setEntityText(id, { title, body: summary, now });
  });
  return id;
}

async function start() {
  const env = {
    async CONTENT_CONSTRUCTION_COMPLETE_JSON() {
      if (typeof respond === "function") return respond();
      throw new Error("测试没有设置模型响应");
    },
  };
  const api = createApi(env, { workspace: Promise.resolve(workspace) });
  server = http.createServer((req, res) => api(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function call(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

try {
  workspace = await openWorkspace({ xenhoHome, now });

  const anchorWiki = wikiPage("真实问题驱动学习", "从自己真正要解决的问题倒推该学什么。", "method");
  const layerWiki = wikiPage("三层模型", "把事情分成交互层、结构层和动力层，越外层变得越快。");
  const caseId = workspace.domain.createMaterial({
    title: "两周只学一个工具的对照",
    type: "案例/故事",
    bodyMarkdown: "同一个任务，一组先挑工具、一组先写清任务，后者两周内完成，前者还在比较。",
    actor: "user",
    now,
  });
  const counterId = workspace.domain.createMaterial({
    title: "追新工具确实有回报的时候",
    type: "反直觉点",
    bodyMarkdown: "当一个新工具把某类任务的成本降一个数量级时，早追的人确实占便宜。",
    actor: "user",
    now,
  });

  const voice = workspace.audienceRaw.record({
    kind: "group_chat", body: CHAT, sourceName: "读者群", actor: "user", confirmed: true, now,
  });
  const agendaId = workspace.contentBridge.createAgenda({
    title: "创作困境有机制",
    desiredJudgment: "看起来像天赋问题的卡点多数有可解释的机制。",
    actor: "user", confirmed: true, now,
  });

  // ── 要素池 ────────────────────────────────────────────────────────
  const pool = workspaceElementPool(workspace.db);
  check("要素池不止锚点那一页", pool.wikiPages.length === 2
    && pool.wikiPages.some((page) => page.id === layerWiki));
  check("素材按类型给出建议要素类型", pool.materials.find((item) => item.id === caseId).elementType === "case"
    && pool.materials.find((item) => item.id === counterId).elementType === "conflict");
  check("没有个人经历时经历栏是空的", pool.experiences.length === 0 && pool.hasExperience === false);
  check("白名单和池子是同一份", pool.allowedSources.some((item) => item.sourceKind === "material" && item.sourceId === caseId)
    && pool.allowedSources.some((item) => item.sourceKind === "wiki_page" && item.sourceId === layerWiki));

  // ── 路线差异判据 ──────────────────────────────────────────────────
  const routeA = {
    dominantAction: "knowledge",
    coreClaim: "工具焦虑的根源是把精力放在最容易过时的交互层。",
    supportingElements: [{ sourceKind: "wiki_page", sourceId: layerWiki }, { sourceKind: "material", sourceId: caseId }],
  };
  const sameShape = {
    dominantAction: "knowledge",
    coreClaim: "工具焦虑的根源，是把精力放到了最容易过时的交互层上。",
    supportingElements: [{ sourceKind: "wiki_page", sourceId: layerWiki }, { sourceKind: "material", sourceId: caseId }],
  };
  const realDifferent = {
    dominantAction: "judgment",
    coreClaim: "追新工具不总是错的，错的是没有一个决定什么时候追的标准。",
    supportingElements: [{ sourceKind: "material", sourceId: counterId }, { sourceKind: "wiki_page", sourceId: anchorWiki }],
  };
  check("换个说法不算另一条讲法", routesAreDistinct(routeA, sameShape) === false);
  check("换主导动作 + 换材料 + 换判断才算", routesAreDistinct(routeA, realDifferent) === true);
  check("同一句话换标点后重合度很高", claimOverlap(routeA.coreClaim, sameShape.coreClaim) > 0.6);
  check("去重时保留先来的那条", distinctRoutes([routeA, sameShape, realDifferent], 3).length === 2);

  const base = await start();
  const connection = {
    problem: {
      existingProblemId: null,
      statement: "AI 工具一周出三个，我到底该学哪个？",
      whyItMatters: "选择成本正在挤掉真正的学习时间。",
      origin: "observed",
      originAgendaId: null,
      evidenceLabel: "1 段可逐字回溯的真实原话",
      evidence: [{ rawSourceId: voice.id, quote: QUOTE }],
    },
    knowledgeAnchors: [{ wikiPageId: anchorWiki, title: "真实问题驱动学习", reason: "把选择问题改写成顺序问题。" }],
    fit: "strong",
    fitReason: "问题问的是选择，而这条知识给的是决定顺序的标准。",
    coreClaim: "学 AI 不该从工具清单开始。",
    cognitiveGap: "大众把它当成工具选择题。",
    knowledgeExplanation: "先有真实任务，才谈得上该学哪个工具。",
  };

  const routePayload = (overrides) => ({
    id: "A",
    label: "从工具焦虑进入",
    dominant_action: "knowledge",
    entry: "AI 工具这么多，我到底该学哪个？",
    storyline: "从工具焦虑进入 → 用三层模型解释什么在变 → 用对照案例落地 → 给出学习顺序。",
    key_relation: "先用机制解释现象，再用一个真实对照把机制变成可执行的顺序。",
    core_claim: "工具焦虑的根源是把精力放在最容易过时的交互层。",
    knowledge_explanation: "三层模型说明交互层变得最快，而结构与动力层稳定。",
    cognitive_gap: "大众以为要追上每一个工具，其实只需要追结构层。",
    risk: "容易讲成一篇知识科普，读完没有可执行的下一步。",
    supporting_elements: [
      { id: "p", type: "problem", label: "该学哪个工具", source_kind: "feedback", source_id: `raw:${voice.id}`, role: "现实入口" },
      { id: "m", type: "concept", label: "三层模型", source_kind: "wiki_page", source_id: layerWiki, role: "解释什么在变" },
      { id: "c", type: "case", label: "两周只学一个工具的对照", source_kind: "material", source_id: caseId, role: "把机制落到结果上" },
      { id: "j", type: "judgment", label: "先定任务再挑工具" },
    ],
    relations: [
      { from: "p", to: "m", type: "problem_to_mechanism", explanation: "用三层模型解释焦虑从哪来。" },
      { from: "m", to: "c", type: "concept_to_case", explanation: "机制落到一个真实对照上。" },
      { from: "c", to: "j", type: "case_to_abstraction", explanation: "从对照提炼出顺序。" },
    ],
    evidence_gaps: ["还缺一个跨工具迁移同一套流程的实测。"],
    counterarguments: [{ claim: "有些新工具确实值得早追。", response: "那也该由任务决定。" }],
    ...overrides,
  });

  // ── Case B：同一个连接，判断型和展示型必须真的不同 ────────────────
  respond = () => ({
    model: "test-construction",
    data: {
      routes: [
        routePayload(),
        routePayload({
          id: "B",
          label: "从反方进入",
          dominant_action: "judgment",
          entry: "追新工具真的错了吗？",
          storyline: "先承认追新有回报 → 指出它什么时候不成立 → 给出判断标准。",
          core_claim: "追新工具不总是错的，错的是没有一个决定什么时候追的标准。",
          supporting_elements: [
            { id: "k", type: "conflict", label: "追新确实有回报的时候", source_kind: "material", source_id: counterId, role: "先立最强的反方" },
            { id: "a", type: "method", label: "真实问题驱动学习", source_kind: "wiki_page", source_id: anchorWiki, role: "给出判断标准" },
            { id: "j2", type: "judgment", label: "标准而不是禁令" },
          ],
          relations: [
            { from: "k", to: "a", type: "challenge", explanation: "反方逼出一个标准。" },
            { from: "a", to: "j2", type: "support", explanation: "标准支撑判断。" },
          ],
        }),
        // 第三条：换了标题和措辞，材料、动作、判断全一样 —— 必须被算成同一条
        routePayload({ id: "C", label: "从学习顺序进入", core_claim: "工具焦虑的根源，是把精力放到了最容易过时的交互层上。" }),
      ],
    },
  });

  const proposed = await call(base, "/api/workspace/content-construction/routes", { connection, agendaId });
  check("模型给三条，其中一条只是换说法，被算成同一条丢掉", proposed.data.routes.length === 2
    && proposed.data.droppedAsSame === 1);
  const [first, second] = proposed.data.routes;
  check("留下的两条主导动作真的不同", first.dominantAction === "knowledge" && second.dominantAction === "judgment");
  check("两条用的材料也不同", routesAreDistinct(first, second) === true);
  check("每条都带着风险和证据缺口，不只有一个漂亮入口", Boolean(first.risk) && first.evidenceGaps.length > 0);
  check("要素带着真实出处", first.supportingElements.every((item) => item.type === "judgment" || Boolean(item.sourceId))
    && first.supportingElements.some((item) => item.sourceKind === "material" && item.sourceId === caseId));
  check("锚点之外的知识确实被用上了", first.supportingElements.some((item) => item.sourceId === layerWiki));
  check("范围记在 freshness 里", proposed.data.freshness.scope === "workspace");

  const counts = () => ({
    problems: workspace.db.prepare("SELECT COUNT(*) AS c FROM audience_problems").get().c,
    opportunities: workspace.db.prepare("SELECT COUNT(*) AS c FROM content_opportunities").get().c,
  });
  check("提路线一条业务数据都没写", counts().problems === 0 && counts().opportunities === 0);

  // ── Case C：没有个人经历时不给伪经历路线 ──────────────────────────
  respond = () => ({
    model: "test-construction",
    data: {
      routes: [
        routePayload({
          id: "X",
          dominant_action: "experience",
          label: "从我的经历进入",
          supporting_elements: [
            { id: "e", type: "experience", label: "我那次追了三个工具", source_kind: "material", source_id: "fake-experience" },
          ],
        }),
        routePayload(),
      ],
    },
  });
  const noExperience = await call(base, "/api/workspace/content-construction/routes", { connection });
  check("没有真实经历时经历型路线被丢掉", noExperience.data.routes.length === 1
    && noExperience.data.routes.every((route) => route.dominantAction !== "experience"));
  check("并且告诉界面这条路线现在不存在", noExperience.data.experienceAvailable === false);

  /**
   * ⚠️ 关系类型认不出来时，丢那一条关系，不作废整条讲法。
   * 真实跑第一轮就是这么全军覆没的——三条讲法的要素和来源全都站得住，
   * 只因为模型把关系写成了词表外的一个词。
   */
  respond = () => ({
    model: "test-construction",
    data: { routes: [routePayload({ relations: [{ from: "p", to: "m", type: "leads_to", explanation: "词表外的关系" }] })] },
  });
  const oddRelation = await call(base, "/api/workspace/content-construction/routes", { connection });
  check("关系类型认不出来只丢那条关系，讲法本身留下", oddRelation.data.routes.length === 1
    && oddRelation.data.routes[0].construction.relations.length === 0
    && oddRelation.data.routes[0].supportingElements.length === 4);

  // 引用池子里不存在的来源 → 整条丢掉
  respond = () => ({
    model: "test-construction",
    data: { routes: [routePayload({ supporting_elements: [{ id: "m", type: "concept", label: "编的知识", source_kind: "wiki_page", source_id: "01NOTAREALWIKI" }] })] },
  });
  const fabricated = await call(base, "/api/workspace/content-construction/routes", { connection });
  check("引用池子里没有的来源，整条讲法被丢掉", fabricated.data.routes.length === 0);
  // ⚠️ 全军覆没时必须说得出为什么，否则这故障没法查也没法判断该不该重试。
  check("并且说得出每条为什么被丢掉", fabricated.data.dropped.length === 1
    && /不属于本次预览实际读取范围/.test(fabricated.data.dropped[0].reason));

  // ── 自然语言继续推 ────────────────────────────────────────────────
  respond = () => ({
    model: "test-construction",
    data: {
      routes: [routePayload(), routePayload({ id: "B", dominant_action: "judgment", core_claim: "追新工具不总是错的，错的是没有标准。", entry: "追新工具真的错了吗？", supporting_elements: [{ id: "k", type: "conflict", label: "追新确实有回报", source_kind: "material", source_id: counterId }, { id: "j2", type: "judgment", label: "标准" }], relations: [] })],
    },
  });
  // ⚠️ 这里必须带上同一个 agendaId：freshness 记着议程，保存时对不上会 409。
  // （这条正是 freshness 该管的事，不是测试的噪音。）
  const forRefine = await call(base, "/api/workspace/content-construction/routes", { connection, agendaId });
  const target = forRefine.data.routes[0];

  respond = () => ({
    model: "test-construction",
    data: {
      route: routePayload({
        core_claim: "在多数任务上，先定清楚任务比先挑工具更省时间。",
        risk: "结论收窄之后，要小心显得没有观点。",
      }),
      note: "把「根源是……」收成了「在多数任务上」，其余入口、材料和关系没动。",
    },
  });
  const refined = await call(base, "/api/workspace/content-construction/refine", {
    connection, route: target, instruction: "结论太绝对了，收一点",
  });
  check("一句话就能改这条讲法", refined.data.ok === true
    && /在多数任务上/.test(refined.data.route.coreClaim));
  check("没被要求改的入口和材料保持原样", refined.data.route.entry === target.entry
    && refined.data.route.supportingElements.length === target.supportingElements.length);
  check("改完会说改了什么", /收成/.test(refined.data.note));
  check("继续推同样不写库", counts().problems === 0 && counts().opportunities === 0);

  respond = () => ({ model: "test-construction", data: { route: routePayload({ dominant_action: "experience" }), note: "改成经历型" } });
  const noExperienceRefine = await call(base, "/api/workspace/content-construction/refine", {
    connection, route: target, instruction: "改成经历型",
  });
  check("没有真实经历时，改成经历型会被拒绝而不是编一段", noExperienceRefine.status === 422
    && /站得住/.test(noExperienceRefine.data.error));

  const emptyAsk = await call(base, "/api/workspace/content-construction/refine", { connection, route: target, instruction: "  " });
  check("空指令不跑模型", emptyAsk.status === 400 && /怎么调整/.test(emptyAsk.data.error));

  // ── 保存：这一刻才入库，而且范围要对得上 ──────────────────────────
  const savePayload = (route, freshness) => ({
    wikiPageId: anchorWiki,
    problemCandidate: {
      statement: connection.problem.statement,
      summary: connection.problem.whyItMatters,
      origin: "observed",
      evidence: connection.problem.evidence,
    },
    agendaId,
    coreClaim: route.coreClaim,
    knowledgeExplanation: route.knowledgeExplanation,
    cognitiveGap: route.cognitiveGap,
    dominantAction: route.dominantAction,
    fit: connection.fit,
    fitReason: connection.fitReason,
    construction: route.construction,
    freshness,
    confirmed: true,
  });

  /**
   * ⚠️ 换一条议程保存，同样要被拦下。
   * 真实跑第一轮就栽在这儿：路线是按「不关联议程」跑的，而界面随后默认选中了
   * 最近那条议程，保存时带着一个 freshness 里没有的议程，当场 409——
   * 用户什么都没改过。现在保存用的是**提路线时那条议程**，这条断言锁住它。
   */
  const wrongAgenda = await call(base, "/api/workspace/content-opportunities", {
    ...savePayload(target, forRefine.data.freshness),
    agendaId: undefined,
  });
  check("换掉议程再保存会被 freshness 拦下", wrongAgenda.status === 409 && /重新预览/.test(wrongAgenda.data.error));

  const wrongScope = await call(base, "/api/workspace/content-opportunities", savePayload(target, { ...forRefine.data.freshness, scope: "anchor" }));
  /**
   * ⚠️ 这里是 400 不是 409，而且是对的：scope 写在 freshness 里，保存时按它重建上下文，
   * 所以 freshness 自己对得上；真正拦住它的是**白名单**——anchor 范围只认锚点那一页，
   * 于是跨来源的要素当场被指名报错。错误里带着那个具体 id，比一句「请重新预览」更好查。
   */
  check("拿 anchor 范围保存整个工作区构造会被拦下", wrongScope.status === 400
    && /不属于本次预览实际读取范围/.test(wrongScope.data.error));

  const saved = await call(base, "/api/workspace/content-opportunities", savePayload(target, forRefine.data.freshness));
  check("确认保存那一刻，用户问题和内容机会一起入库", saved.data.ok === true
    && counts().problems === 1 && counts().opportunities === 1);
  const stored = workspace.contentBridge.opportunity(saved.data.opportunity.id);
  check("讲法本身也被存下来，写作时还知道为什么这样排", stored.construction.route.storyline === target.storyline
    && stored.construction.route.risk === target.risk);
  check("跨来源的要素完整保留", stored.construction.elements.some((item) => item.source_id === layerWiki)
    && stored.construction.elements.some((item) => item.source_id === caseId));

  console.log("\n内容构造验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
