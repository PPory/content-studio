import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-content-bridge-preview-"));
const workspace = await openWorkspace({ xenhoHome: path.join(root, "Xenho") });
const now = new Date("2026-09-01T08:00:00.000Z");
let server;
let wikiSourceId = "";
let problemSourceId = "";
let mode = "strong";
let lastRequest = null;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

function createWikiPage() {
  const id = createUlid();
  const stamp = now.toISOString();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id, type: "wiki_page", now });
    workspace.db.prepare(`INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,current_revision,schema_version,created_at,updated_at)
      VALUES (?, '认知卸载', 'concept', '把认知任务交给外部工具。', '# 认知卸载\n\n它解释人如何把认知任务交给外部工具。', 1, 1, ?, ?)`)
      .run(id, stamp, stamp);
    workspace.repository.setEntityText(id, { title: "认知卸载", body: "它解释人如何把认知任务交给外部工具。", now });
  });
  return id;
}

function candidate(overrides = {}) {
  return {
    fit: "strong",
    fit_reason: "认知卸载能直接解释用户把判断任务交给 AI 的机制。",
    audience_problem: {
      surface: "为什么我越来越依赖 AI 做选择？",
      underlying: "我该怎样分配人与 AI 的判断责任？",
    },
    knowledge_explanation: "认知卸载解释了人如何把认知任务交给外部工具。",
    core_claim: "AI 正从信息工具进入人的判断链。",
    cognitive_gap: "会用 AI 不等于应该把关键判断都交给 AI。",
    dominant_action: "judgment",
    elements: [
      { id: "problem", type: "problem", label: "依赖 AI 判断", source_kind: "audience_problem", source_id: problemSourceId },
      { id: "knowledge", type: "concept", label: "认知卸载", source_kind: "wiki_page", source_id: wikiSourceId },
      { id: "claim", type: "judgment", label: "重新分配判断权" },
    ],
    relations: [
      { from: "problem", to: "knowledge", type: "problem_to_mechanism", explanation: "知识解释问题机制" },
      { from: "knowledge", to: "claim", type: "support", explanation: "机制支撑判断" },
    ],
    entry_options: [{ text: "为什么 AI 越用越方便，我却越来越不愿意自己想？", scope_check: { status: "supported", reason: "正文能够解释这种依赖机制" } }],
    evidence_gaps: [],
    counterarguments: [{ claim: "外包低风险判断可以释放精力", response: "需要区分低风险与关键判断" }],
    agenda_fit: { status: "strong", reason: "内容直接强化保留判断权的长期议程。" },
    ...overrides,
  };
}

async function start() {
  const env = {
    async CONTENT_BRIDGE_COMPLETE_JSON(_env, request) {
      lastRequest = request;
      if (mode === "failure") throw Object.assign(new Error("模型服务暂时不可用"), { status: 503 });
      if (mode === "weak") return { model: "test", data: candidate({
        fit: "weak",
        fit_reason: "这两个对象目前只有词面相似，没有可解释的机制关系。",
        core_claim: "目前不建议把这两个对象硬做成内容。",
        knowledge_explanation: "现有 Wiki 不能解释该问题。",
        cognitive_gap: "没有可成立的认知差。",
        elements: [],
        relations: [],
        entry_options: [],
        evidence_gaps: [{ claim: "二者存在联系", needed: "需要先找到真实机制证据" }],
        counterarguments: [{ claim: "词面相似不等于因果或解释关系", response: "换一个知识或问题" }],
        agenda_fit: { status: "none", reason: "连接本身不成立，不评估议程。" },
      }) };
      if (mode === "evidence") return { model: "test", data: candidate({
        fit: "medium",
        fit_reason: "机制方向成立，但事实证据不足。",
        evidence_gaps: [{ claim: "频繁使用 AI 会导致判断能力下降", needed: "需要直接研究证据", source_refs: [] }],
        agenda_fit: { status: "weak", reason: "目前证据不足，无法稳定强化议程。" },
      }) };
      if (mode === "experience") return { model: "test", data: candidate({
        dominant_action: "experience",
        elements: [
          { id: "problem", type: "problem", label: "依赖 AI 判断", source_kind: "audience_problem", source_id: problemSourceId },
          { id: "knowledge", type: "concept", label: "认知卸载", source_kind: "wiki_page", source_id: wikiSourceId },
        ],
        relations: [{ from: "problem", to: "knowledge", type: "problem_to_mechanism", explanation: "只建议从真实经历进入，不生成经历" }],
        entry_options: [{ text: "如果你有类似真实经历，可以从一次依赖 AI 的选择进入。", scope_check: { status: "supported", reason: "这是条件式提示，没有声称经历已发生" } }],
      }) };
      if (mode === "fabricated-fact") return { model: "test", data: candidate({
        elements: [
          { id: "problem", type: "problem", label: "依赖 AI 判断", source_kind: "audience_problem", source_id: problemSourceId },
          { id: "fact", type: "fact", label: "频繁使用 AI 会削弱判断能力", source_kind: "raw", source_id: "fake-raw" },
        ],
        relations: [{ from: "fact", to: "problem", type: "support", explanation: "伪造来源不能支撑问题" }],
      }) };
      if (mode === "fabricated-experience") return { model: "test", data: candidate({
        dominant_action: "experience",
        elements: [{ id: "story", type: "experience", label: "我最近发现自己任何选择都先问 AI" }],
        relations: [],
      }) };
      if (mode === "too-broad") return { model: "test", data: candidate({
        entry_options: [{ text: "如何学会所有 AI 工具", scope_check: { status: "too_broad", reason: "现有知识只能解释判断权分配，不能覆盖所有工具学习" } }],
      }) };
      return { model: "test", data: candidate() };
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

async function post(base, body, pathname = "/api/workspace/content-opportunities/preview") {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify(body),
  });
  return { response, value: await response.json() };
}

try {
  const wikiPageId = createWikiPage();
  wikiSourceId = wikiPageId;
  const agendaId = workspace.contentBridge.createAgenda({
    title: "保留人的判断权",
    desiredJudgment: "高质量使用 AI 的核心是保留人的判断权",
    actor: "user",
    confirmed: true,
    now,
  });
  const audienceProblemId = workspace.contentBridge.createAudienceProblem({
    statement: "AI 越用越方便，为什么我越来越不愿意自己判断？",
    summary: "用户担心把判断任务交给 AI。",
    pattern: "knowledge_gap",
    sources: [{ sourceKind: "feedback", sourceId: "feedback:1", evidenceText: "遇到任何选择都会先问 AI。", observedAt: now }],
    actor: "user",
    confirmed: true,
    now,
  });
  problemSourceId = audienceProblemId;
  const base = await start();
  const input = { wikiPageId, audienceProblemId, agendaId };

  const missingWiki = await post(base, { ...input, wikiPageId: "missing" });
  check("Preview 拒绝 missing Wiki", missingWiki.response.status === 404 && /Wiki 页面不存在/.test(missingWiki.value.error));
  const missingProblem = await post(base, { ...input, audienceProblemId: "missing" });
  check("Preview 拒绝 missing Audience Problem", missingProblem.response.status === 404 && /用户问题不存在/.test(missingProblem.value.error));

  const before = {
    opportunities: workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count,
    projects: workspace.db.prepare("SELECT COUNT(*) AS count FROM projects").get().count,
  };
  const strong = await post(base, input);
  assert.equal(strong.response.status, 200, JSON.stringify(strong.value));
  check("strong fit 先返回问题、解释、认知差和判断", strong.value.candidate.fit === "strong"
    && strong.value.candidate.audienceProblem.underlying
    && strong.value.candidate.knowledgeExplanation
    && strong.value.candidate.cognitiveGap
    && strong.value.candidate.coreClaim);
  check("Preview 不保存 Opportunity 或 Project", strong.value.candidateOnly === true
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count === before.opportunities
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM projects").get().count === before.projects);
  check("观察到的问题不会触发假设告知", !/尚无任何真实观察证据/.test(lastRequest.system));

  // 议程推导出的假设进入 Preview 时，模型必须被告知没有人真的这样问过。
  const hypothesisProblemId = workspace.contentBridge.createAudienceProblem({
    statement: "哪些事情可以交给 AI，哪些必须自己判断？",
    summary: "这条议程预测受众会卡在判断责任的边界上。",
    origin: "hypothesis",
    originAgendaId: agendaId,
    actor: "user",
    confirmed: true,
    now,
  });
  // 桩候选里的 problem 要素引用的是「本次预览的那条问题」，换问题就得跟着换，否则会被来源白名单拦下。
  const observedProblemSourceId = problemSourceId;
  problemSourceId = hypothesisProblemId;
  const hypothesisPreview = await post(base, { ...input, audienceProblemId: hypothesisProblemId });
  problemSourceId = observedProblemSourceId;
  assert.equal(hypothesisPreview.response.status, 200, JSON.stringify(hypothesisPreview.value));
  check("假设型用户问题在 Preview 提示里被标为尚无观察证据",
    /尚无任何真实观察证据/.test(lastRequest.system)
    && /验证这个问题在真实受众中是否存在/.test(lastRequest.system));
  check("Preview 记录 Wiki、用户问题与议程版本", strong.value.candidate.freshness.wikiRevision === 1
    && strong.value.candidate.freshness.audienceProblemUpdatedAt && strong.value.candidate.freshness.agendaUpdatedAt);

  const agendaFit = await post(base, {
    ...input,
    candidate: {
      coreClaim: strong.value.candidate.coreClaim,
      cognitiveGap: strong.value.candidate.cognitiveGap,
      knowledgeExplanation: strong.value.candidate.knowledgeExplanation,
    },
  }, "/api/workspace/content-opportunities/agenda-fit");
  check("Agenda Fit 独立返回且不改写 Candidate 或写入业务数据", agendaFit.response.status === 200
    && agendaFit.value.agendaFit.status === "strong" && !agendaFit.value.candidate
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count === before.opportunities);

  mode = "weak";
  const weak = await post(base, input);
  check("无自然连接明确返回 weak，不硬生成内容", weak.value.candidate.fit === "weak"
    && /不建议/.test(weak.value.candidate.coreClaim));

  mode = "evidence";
  const evidence = await post(base, input);
  check("证据不足与 Agenda 不匹配被结构化保留", evidence.value.candidate.construction.evidence_gaps.length === 1
    && evidence.value.candidate.agendaFit.status === "weak");

  mode = "experience";
  const experience = await post(base, { ...input, dominantAction: "experience" });
  check("没有真实经历时只能给条件式入口，不生成第一人称经历", experience.response.status === 200
    && experience.value.candidate.experience.available === false
    && !experience.value.candidate.construction.elements.some((item) => item.type === "experience"));
  mode = "fabricated-experience";
  const fabricated = await post(base, { ...input, dominantAction: "experience" });
  check("模型编造个人经历被服务端硬闸拒绝", fabricated.response.status === 400 && /来源/.test(fabricated.value.error));
  mode = "fabricated-fact";
  const fabricatedFact = await post(base, input);
  check("模型伪造事实来源 ID 被服务端硬闸拒绝", fabricatedFact.response.status === 400 && /实际读取范围/.test(fabricatedFact.value.error));

  mode = "too-broad";
  const tooBroad = await post(base, input);
  check("过大入口被 Scope Check 标记而非伪装成可兑现", tooBroad.value.candidate.construction.entry_options[0].scope_check.status === "too_broad");

  mode = "failure";
  const failure = await post(base, input);
  check("模型失败返回 503 且不产生副作用", failure.response.status === 503
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count === before.opportunities);
} finally {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  workspace.close();
  await fs.rm(root, { recursive: true, force: true });
}

console.log("\nContent Opportunity Preview API 测试通过。\n");
