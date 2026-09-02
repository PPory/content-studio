// AI Discovery：上下文预算、真实性硬闸、缓存失效、降级和「候选不写库」。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import { buildDiscoveryContext, discoveryReadiness } from "../server/domain/content-discovery.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-content-discovery-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-02T08:00:00.000Z");
let workspace;
let server;
let respond = null;
let bridgeRespond = null;
let calls = 0;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

const CHAT = [
  "小林：AI 工具每周都在出新的，我到底该学哪个？",
  "阿泽：收藏夹里躺了二十个教程，一个都没打开。",
].join("\n");
const QUOTE = "AI 工具每周都在出新的，我到底该学哪个？";

function createWikiPage(title, summary) {
  const id = createUlid();
  const stamp = now.toISOString();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id, type: "wiki_page", now });
    workspace.db.prepare(`INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,current_revision,schema_version,created_at,updated_at)
      VALUES (?, ?, 'concept', ?, ?, 1, 1, ?, ?)`).run(id, title, summary, `# ${title}\n\n${summary}`, stamp, stamp);
    workspace.repository.setEntityText(id, { title, body: summary, now });
  });
  return id;
}

async function start() {
  const env = {
    async CONTENT_DISCOVERY_COMPLETE_JSON() {
      calls += 1;
      if (typeof respond === "function") return respond();
      throw new Error("测试没有设置模型响应");
    },
    async CONTENT_BRIDGE_COMPLETE_JSON() {
      if (typeof bridgeRespond === "function") return bridgeRespond();
      throw new Error("测试没有设置内容桥接模型响应");
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

async function call(base, pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

try {
  workspace = await openWorkspace({ xenhoHome, now });
  const base = await start();

  // ── 空工作区：不跑模型，并且说清楚缺的是哪一头 ────────────────────────
  const emptyScan = await call(base, "/api/workspace/content-discovery/scan", { method: "POST", body: {} });
  check("什么都没有时不调用模型", calls === 0);
  check("空工作区说清缺的是知识那一头", emptyScan.data.scan.missing.includes("knowledge")
    && /知识/.test(emptyScan.data.scan.nothingFoundReason));

  const learnWiki = createWikiPage("真实问题驱动学习", "从自己真正要解决的问题倒推该学什么，而不是照工具清单学。");
  const unrelatedWiki = createWikiPage("CSS 网格布局", "用行列关系组织网页布局的方法。");

  const onlyKnowledge = await call(base, "/api/workspace/content-discovery/scan", { method: "POST", body: { force: true } });
  check("只有知识没有现实声音时，说清缺的是另一头", onlyKnowledge.data.scan.missing.includes("reality"));
  check("仍然没有调用模型", calls === 0);

  const voice = await call(base, "/api/workspace/audience-voices", {
    method: "POST",
    body: { kind: "group_chat", body: CHAT, sourceName: "读者群", confirmed: true },
  });
  const voiceId = voice.data.voice.id;

  // ── 上下文预算 ────────────────────────────────────────────────────
  const context = buildDiscoveryContext(workspace, {});
  check("知识侧给的是轻量索引，不是正文", context.wikiPages.length === 2
    && !Object.keys(context.wikiPages[0]).includes("bodyMarkdown"));
  check("现实侧带上尚未分析的原话", context.voices.length === 1 && context.voices[0].id === voiceId);
  check("两头都有内容时判定为可以扫描", discoveryReadiness(context).ready === true);

  // ── 真实性硬闸 ────────────────────────────────────────────────────
  respond = () => ({
    model: "test-discovery",
    data: {
      connections: [
        {
          // 编造的原话：这段话不在那段群聊里
          problem: { statement: "编的问题", origin: "observed", evidence: [{ raw_source_id: voiceId, quote: "大家都在焦虑该学哪个工具" }] },
          knowledge_anchors: [{ wiki_page_id: learnWiki, reason: "看似相关" }],
          fit: "strong", fit_reason: "理由", knowledge_explanation: "解释", core_claim: "判断", cognitive_gap: "认知差",
        },
        {
          // 引用了不存在的 Wiki
          problem: { statement: "另一个问题", origin: "observed", evidence: [{ raw_source_id: voiceId, quote: QUOTE }] },
          knowledge_anchors: [{ wiki_page_id: "01NOTAREALWIKIPAGEID", reason: "不存在" }],
          fit: "strong", fit_reason: "理由", knowledge_explanation: "解释", core_claim: "判断", cognitive_gap: "认知差",
        },
        {
          problem: {
            statement: "AI 工具每周都在出新的，我到底该学哪个？",
            why_it_matters: "选择成本正在挤掉真正的学习时间。",
            origin: "observed",
            evidence: [{ raw_source_id: voiceId, quote: QUOTE }],
          },
          knowledge_anchors: [{ wiki_page_id: learnWiki, reason: "这条知识把问题从「选哪个」改写成「按什么顺序学」。" }],
          fit: "strong",
          fit_reason: "问题问的是选择，而这条知识给的是决定顺序的标准。",
          knowledge_explanation: "先有真实任务，才谈得上该学哪个工具。",
          core_claim: "学 AI 不该从工具清单开始，而该从自己真正要解决的问题开始。",
          cognitive_gap: "大众把它当成工具选择题，其实是学习顺序问题。",
          agenda_suggestion: { status: "none", reason: "这条反复指向一个还没被命名的长期判断。" },
          evidence_gaps: ["还缺一个真实案例说明这个顺序确实更省时间。"],
        },
      ],
    },
  });

  const scan = await call(base, "/api/workspace/content-discovery/scan", { method: "POST", body: { force: true } });
  check("模型被调用了一次", calls === 1);
  check("编造的原话和不存在的知识都被丢掉，只留下站得住的那条", scan.data.scan.connections.length === 1);
  check("自称观察到却验证不出原话的那条被整条丢掉，没有被洗成「假设」",
    !scan.data.scan.connections.some((item) => item.problem.statement === "编的问题"));
  const connection = scan.data.scan.connections[0];
  check("留下的那条带着可逐字回溯的原话", connection.problem.evidence.length === 1
    && connection.problem.evidence[0].quote === QUOTE
    && connection.problem.evidence[0].sourceName === "读者群");
  check("知识锚点带着标题和理由", connection.knowledgeAnchors[0].title === "真实问题驱动学习"
    && Boolean(connection.knowledgeAnchors[0].reason));
  check("匹配度只用 strong/medium/weak，没有分数", connection.fit === "strong" && !("score" in connection));

  const counts = () => ({
    problems: workspace.db.prepare("SELECT COUNT(*) AS c FROM audience_problems").get().c,
    opportunities: workspace.db.prepare("SELECT COUNT(*) AS c FROM content_opportunities").get().c,
  });
  check("扫描没有写出任何用户问题或内容机会", counts().problems === 0 && counts().opportunities === 0);
  check("读过的原话被标成已分析，下次不重复发给模型",
    workspace.audienceRaw.source(voiceId).analyzedAt !== null);

  // ── 缓存 ──────────────────────────────────────────────────────────
  const reused = await call(base, "/api/workspace/content-discovery/scan", { method: "POST", body: {} });
  check("数据没变时复用上次结果，不再调用模型", reused.data.reused === true && calls === 1);
  const fresh = await call(base, "/api/workspace/content-discovery");
  check("刚扫完不算过期", fresh.data.stale === false);

  await call(base, "/api/workspace/audience-voices", {
    method: "POST",
    body: { kind: "comment", body: "我按你说的先定问题再挑工具，两周省下不少时间。", confirmed: true },
  });
  const afterVoice = await call(base, "/api/workspace/content-discovery");
  check("新粘一段原话之后缓存立刻失效", afterVoice.data.stale === true);
  check("并且说得出为什么失效", /又记了 1 段原话/.test(afterVoice.data.staleReason));

  // ── 模型失败的降级 ────────────────────────────────────────────────
  respond = () => { throw Object.assign(new Error("上游模型暂时不可用"), { status: 503 }); };
  const failed = await call(base, "/api/workspace/content-discovery/scan", { method: "POST", body: { force: true } });
  check("模型失败时如实报错", failed.data.ok === false && /不可用/.test(failed.data.error));
  const afterFailure = await call(base, "/api/workspace/content-discovery");
  check("失败不清空上次的结果", afterFailure.data.scan.connections.length === 1);
  check("失败不动任何业务数据", counts().problems === 0 && counts().opportunities === 0);

  // ── 一条都没找到时必须说得出原因 ──────────────────────────────────
  respond = () => ({ model: "test-discovery", data: { connections: [], nothing_found_reason: "这批原话讲的是排版工具，和现有知识没有自然连接。" } });
  const nothing = await call(base, "/api/workspace/content-discovery/scan", { method: "POST", body: { force: true } });
  check("允许返回零条", nothing.data.scan.connections.length === 0);
  check("零条时说得出为什么", /没有自然连接/.test(nothing.data.scan.nothingFoundReason));

  // ── 候选 → 保存：这一刻才入库 ─────────────────────────────────────
  const candidate = {
    statement: "AI 工具每周都在出新的，我到底该学哪个？",
    summary: "选择成本正在挤掉真正的学习时间。",
    origin: "observed",
    evidence: [{ rawSourceId: voiceId, quote: QUOTE }],
  };
  const previewBody = {
    wikiPageId: learnWiki,
    problemCandidate: candidate,
  };
  const badCandidate = await call(base, "/api/workspace/content-opportunities/preview", {
    method: "POST",
    body: { wikiPageId: learnWiki, problemCandidate: { ...candidate, evidence: [{ rawSourceId: voiceId, quote: "我编的一句原话" }] } },
  });
  check("候选的证据同样过逐字硬闸", badCandidate.data.ok === false && /逐字定位/.test(badCandidate.data.error));

  const noEvidence = await call(base, "/api/workspace/content-opportunities/preview", {
    method: "POST",
    body: { wikiPageId: learnWiki, problemCandidate: { ...candidate, evidence: [] } },
  });
  check("声称观察到却拿不出原话，直接拒绝", noEvidence.data.ok === false && /可逐字回溯/.test(noEvidence.data.error));

  const experienceRequest = await call(base, "/api/workspace/content-opportunities/preview", {
    method: "POST",
    body: { ...previewBody, dominantAction: "experience" },
  });
  check("工作区没有个人经历时，经历型在跑模型之前就被拦下", experienceRequest.status === 409
    && /个人经历/.test(experienceRequest.data.error));
  check("并且告诉用户下一步该做什么", /个人经历.*素材/.test(experienceRequest.data.hint || ""));

  // ── 发展这条 → 保存：用户问题到这一刻才第一次入库 ─────────────────
  bridgeRespond = () => ({
    model: "test-bridge",
    data: {
      fit: "strong",
      fit_reason: "问题问的是选择，而这条知识给的是决定顺序的标准。",
      audience_problem: { surface: "该学哪个工具", underlying: "按什么顺序学" },
      knowledge_explanation: "先有真实任务，才谈得上该学哪个工具。",
      core_claim: "学 AI 不该从工具清单开始，而该从自己真正要解决的问题开始。",
      cognitive_gap: "大众把它当成工具选择题，其实是学习顺序问题。",
      dominant_action: "judgment",
      elements: [
        { id: "problem", type: "problem", label: "该学哪个工具", source_kind: "feedback", source_id: `raw:${voiceId}` },
        { id: "concept", type: "concept", label: "真实问题驱动学习", source_kind: "wiki_page", source_id: learnWiki },
        { id: "claim", type: "judgment", label: "从问题开始", source_kind: "", source_id: "" },
      ],
      relations: [
        { from: "problem", to: "concept", type: "problem_to_mechanism", explanation: "用这条知识解释选择困难。" },
        { from: "concept", to: "claim", type: "support", explanation: "机制支撑判断。" },
      ],
      entry_options: [{ text: "AI 工具这么多，我到底该学哪个？", scope_check: { status: "supported", reason: "正文能回答。" } }],
      evidence_gaps: [],
      counterarguments: [{ claim: "有些工具确实值得早点追。", response: "那也该由真实任务决定。" }],
      agenda_fit: { status: "none", reason: "未选择长期议程" },
    },
  });

  const preview = await call(base, "/api/workspace/content-opportunities/preview", { method: "POST", body: previewBody });
  check("候选可以直接跑预览，不必先入库", preview.data.ok === true && preview.data.candidate.fit === "strong");
  check("预览一样不写库", counts().problems === 0 && counts().opportunities === 0);
  check("没有个人经历时预览如实告诉界面经历型不可用", preview.data.candidate.experienceAvailable === false);

  const savePayload = (problemOverride) => ({
    wikiPageId: learnWiki,
    problemCandidate: problemOverride || candidate,
    coreClaim: preview.data.candidate.coreClaim,
    knowledgeExplanation: preview.data.candidate.knowledgeExplanation,
    cognitiveGap: preview.data.candidate.cognitiveGap,
    dominantAction: preview.data.candidate.dominantAction,
    fit: preview.data.candidate.fit,
    fitReason: preview.data.candidate.fitReason,
    construction: preview.data.candidate.construction,
    freshness: preview.data.candidate.freshness,
    confirmed: true,
  });

  const staleSave = await call(base, "/api/workspace/content-opportunities", {
    method: "POST",
    body: savePayload({ ...candidate, statement: "偷偷改过的问题" }),
  });
  check("预览之后被改过的候选保存时被拦下", staleSave.status === 409 && /重新预览/.test(staleSave.data.error));
  check("被拦下之后一条数据都没多出来", counts().problems === 0 && counts().opportunities === 0);

  const saved = await call(base, "/api/workspace/content-opportunities", { method: "POST", body: savePayload() });
  check("保存时候选问题和内容机会一起入库", saved.data.ok === true
    && counts().problems === 1 && counts().opportunities === 1);
  const storedProblem = workspace.contentBridge.audienceProblem(saved.data.opportunity.audienceProblemId);
  check("入库的问题记着是观察到的", storedProblem.origin === "observed");
  check("入库的问题带着可回溯的原话", storedProblem.sources.length === 1
    && storedProblem.sources[0].sourceId === `raw:${voiceId}`
    && storedProblem.sources[0].evidenceText === QUOTE);

  assert.throws(
    () => workspace.db.prepare("DELETE FROM audience_raw_sources WHERE id=?").run(voiceId),
    /已经被用户问题引用/,
  );
  check("支撑它的那段原话从此删不掉", true);

  console.log("\nAI Discovery 验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
