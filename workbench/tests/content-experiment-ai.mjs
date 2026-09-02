// 实验 AI：假设候选、结算预览、观察与推断的分野、没有数据时说不知道。
//
// 这里最要紧的一条：**一条不给依据的「观察」就是推断**。
// 真实库里那条唯一结算过的实验，「发生了什么」写的是「数据比之前好点」——
// 那句话没有任何人能复核，而它当时被记在了「观察」的位置上。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import { describeSettlementEvidence, settlementContext } from "../server/domain/content-experiment-context.mjs";
import { buildContentBridgeContext } from "../server/domain/content-bridge-context.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-experiment-ai-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-02T08:00:00.000Z");
let workspace;
let server;
let respond = null;
let calls = 0;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

const QUOTE = "AI 工具一周出三个，我到底该学哪个";
const FEEDBACK = "读者留言：这篇让我第一次想清楚该先定任务再挑工具。\n另一条：看完把收藏夹清了一半。";

async function start() {
  const env = {
    async CONTENT_BRIDGE_COMPLETE_JSON() {
      calls += 1;
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

  // ── 前置：一条真实的内容机会 + 项目 ──────────────────────────────
  const wikiId = createUlid();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id: wikiId, type: "wiki_page", now });
    workspace.db.prepare(`INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,current_revision,schema_version,created_at,updated_at)
      VALUES (?, '真实问题驱动学习', 'method', '从真实问题倒推该学什么。', '# 真实问题驱动学习', 1, 1, ?, ?)`)
      .run(wikiId, now.toISOString(), now.toISOString());
    workspace.repository.setEntityText(wikiId, { title: "真实问题驱动学习", body: "从真实问题倒推该学什么。", now });
  });
  const voice = workspace.audienceRaw.record({
    kind: "group_chat", body: `阿泽：${QUOTE}`, actor: "user", confirmed: true, now,
  });
  const agendaId = workspace.contentBridge.createAgenda({
    title: "创作困境有机制", desiredJudgment: "卡点多数有可解释的机制。", actor: "user", confirmed: true, now,
  });
  const problemCandidate = {
    statement: "AI 工具一周出三个，我到底该学哪个？",
    summary: "选择成本挤掉了学习时间。",
    origin: "observed",
    evidence: [{ rawSourceId: voice.id, quote: QUOTE }],
  };
  const opportunityId = workspace.contentBridge.saveOpportunity({
    wikiPageId: wikiId,
    problemCandidate,
    agendaId,
    coreClaim: "学 AI 不该从工具清单开始。",
    knowledgeExplanation: "先有真实任务，才谈得上该学哪个工具。",
    cognitiveGap: "大众把它当成工具选择题。",
    dominantAction: "judgment",
    fit: "strong",
    fitReason: "问题问的是选择，知识给的是标准。",
    construction: {
      route: { id: "A", storyline: "从工具焦虑进入 → 给出标准。", key_relation: "", risk: "容易讲成科普。" },
      elements: [{ id: "p", type: "problem", label: "该学哪个工具", source_kind: "feedback", source_id: `raw:${voice.id}` }],
      relations: [],
      entry_options: [{ text: "AI 工具这么多，我到底该学哪个？", scope_check: { status: "supported", reason: "正文能回答。" } }],
      evidence_gaps: [],
      counterarguments: [],
    },
    freshness: buildContentBridgeContext(workspace, { wikiPageId: wikiId, problemCandidate, agendaId, includeExperiences: true, scope: "workspace" }).freshness,
    actor: "user", confirmed: true, now,
  });
  const projectId = workspace.contentBridge.createProjectFromOpportunity(opportunityId, { actor: "user", confirmed: true, now });

  // ── 发布前：假设候选替代空白输入框 ──────────────────────────────
  respond = () => ({
    model: "test-experiment",
    data: {
      hypotheses: [
        { hypothesis: "用真实问题当入口，会比直接讲概念更容易被收藏。", why: "这一篇最大的策略变化就是问题入口。", signal: "收藏高于同平台中位数算成立；持平或更低算不成立。" },
        { hypothesis: "先承认反方再给标准，会比直接下判断更少引来抬杠。", why: "这条讲法把反方放在了最前面。", signal: "评论里出现讨论标准而非否定立场的比例上升算成立。" },
        { hypothesis: "这条没有 signal", why: "缺一项", signal: "" },
      ],
    },
  });
  const before = workspace.db.prepare("SELECT COUNT(*) AS c FROM content_experiments").get().c;
  const proposed = await call(base, `/api/workspace/projects/${projectId}/hypothesis-candidates`, { method: "POST" });
  check("发布前先提假设候选，不再从空白框开始", proposed.data.ok === true && proposed.data.hypotheses.length === 2);
  check("说不出「什么算不成立」的那条被丢掉",
    !proposed.data.hypotheses.some((item) => item.hypothesis.includes("没有 signal")));
  check("每条都说清怎么算成立", proposed.data.hypotheses.every((item) => item.signal));
  check("提候选不建实验", workspace.db.prepare("SELECT COUNT(*) AS c FROM content_experiments").get().c === before);

  const experimentId = workspace.experiments.recordHypothesis({
    projectId,
    hypothesisMarkdown: proposed.data.hypotheses[0].hypothesis,
    actor: "user", confirmed: true, now,
  });

  // ── 还没发布 / 没有任何数据时：不跑模型，说清还差什么 ────────────
  const callsBefore = calls;
  const empty = await call(base, `/api/workspace/experiments/${experimentId}/settlement-preview`, { method: "POST", body: {} });
  check("一点真实数据都没有时不跑模型", calls === callsBefore);
  check("并且不给结论", empty.data.observations.length === 0 && empty.data.verdict === null);
  check("而是说清现在结算只能靠猜", /只能靠猜/.test(empty.data.note));
  check("还差什么说得具体，不是一句「暂无数据」",
    empty.data.missing.some((item) => /贴进来|导一次/.test(item)));

  // ── 有了发布记录和数字 ──────────────────────────────────────────
  const publishedAt = new Date(now.getTime() + 3_600_000).toISOString();
  /**
   * ⚠️ 用真实的领域接口发布，不手插 `publication_records`。
   * 那张表挂着「发布内容必须对得上某个修订版本」的触发器，手插会被直接拒——
   * 而那条触发器正是这套发布追溯的地基，测试绕过它就等于没验。
   */
  const draftId = workspace.domain.createDraft({
    projectId, title: "该学哪个工具", bodyMarkdown: "# 该学哪个工具\n\n正文。", platform: "小红书",
    actor: "user", confirmed: true, now,
  });
  workspace.domain.saveDraftRelease(draftId, {
    title: "该学哪个工具", bodyMarkdown: "# 该学哪个工具\n\n正文。", summary: "摘要",
    actor: "user", confirmed: true, now,
  });
  workspace.domain.transitionDraft(draftId, "finish-writing", { actor: "user", confirmed: true, now });
  const publication = workspace.domain.publishDraft(draftId, {
    title: "该学哪个工具", platform: "小红书", publishedUrl: "https://example.invalid/1",
    publishedAt, idempotencyKey: `pub-${draftId}`, actor: "user", confirmed: true, now,
  });
  const publicationId = publication?.id || publication?.publicationId || publication;
  check("发布记录走真实领域接口建立", Boolean(publicationId));

  // 平台导出的历史行：基线从这里来
  for (const [index, row] of [[391, 33], [243, 19], [104, 6]].entries()) {
    const id = createUlid();
    workspace.repository.transaction(() => {
      workspace.repository.createEntity({ id, type: "external_publication_record", now });
      workspace.db.prepare(`INSERT INTO external_publication_records(id,platform,title,published_url,published_at,views,collects)
        VALUES (?, '小红书', ?, '', ?, ?, ?)`)
        .run(id, `历史第 ${index + 1} 篇`, new Date(now.getTime() - (index + 1) * 86_400_000).toISOString(), row[0], row[1]);
    });
  }
  const thisOne = createUlid();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id: thisOne, type: "external_publication_record", now });
    workspace.db.prepare(`INSERT INTO external_publication_records(id,platform,title,published_url,published_at,views,collects)
      VALUES (?, '小红书', '该学哪个工具', '', ?, 520, 61)`).run(thisOne, publishedAt);
  });

  const context = settlementContext(workspace, { experimentId, feedbackText: FEEDBACK });
  check("这一篇的数字从平台导出那一侧对上了", context.metrics?.source === "platform-import" && context.metrics.values.collects === 61);
  check("基线是同平台过去几篇的中位数", context.baseline.available && context.baseline.values.collects === 19);
  check("有数字也有原话时才算有证据", context.hasEvidence === true);
  const described = describeSettlementEvidence(context);
  check("给模型的证据里写明只能引用这些原话", described.includes(FEEDBACK.split("\n")[0]) && described.includes("逐字"));

  // ── 观察必须有依据，没依据的降级成推断 ────────────────────────────
  respond = () => ({
    model: "test-experiment",
    data: {
      observations: [
        { text: "收藏 61，高于同平台过去 3 篇的中位数 19。", basis_kind: "metric", metric: "collects" },
        { text: "有读者说这篇让他想清楚了先定任务再挑工具。", basis_kind: "feedback", quote: "这篇让我第一次想清楚该先定任务再挑工具。" },
        { text: "读者普遍觉得这篇比以前的更实用。", basis_kind: "feedback", quote: "大家都说更实用" },
        { text: "转发量也涨了。", basis_kind: "metric", metric: "shares" },
      ],
      inferences: ["问题入口可能确实比概念入口更容易被收藏。"],
      verdict: "supported",
      verdict_reason: "收藏显著高于中位数，且有原话指向判断被接受。",
      learning_candidate: "下一篇继续用真实问题当入口，并在开头就把标准点出来。",
      next_experiment: "验证把标准提到前三段会不会进一步提高收藏。",
    },
  });
  const preview = await call(base, `/api/workspace/experiments/${experimentId}/settlement-preview`, {
    method: "POST", body: { feedbackText: FEEDBACK },
  });
  check("有依据的两条留在观察里", preview.data.observations.length === 2);
  check("引用数字的那条带着依据和基线",
    preview.data.observations[0].basisKind === "metric"
    && preview.data.observations[0].value === 61
    && preview.data.observations[0].baseline === 19);
  check("引用原话的那条逐字对得上", preview.data.observations[1].quote === "这篇让我第一次想清楚该先定任务再挑工具。");
  /**
   * ⚠️ 这两条是整套里最要紧的：编出来的原话和没给过的数字，
   * 不能挂着「观察」的可信度，但它们也没被扔掉——它们是推断。
   */
  check("编出来的原话被降级成推断，不是观察",
    !preview.data.observations.some((item) => item.text.includes("普遍觉得"))
    && preview.data.inferences.some((item) => item.includes("普遍觉得")));
  check("没给过的数字同样降级", preview.data.inferences.some((item) => item.includes("转发量")));
  check("降级的原因说得出来", preview.data.demoted.length === 2
    && preview.data.demoted.some((item) => /逐字找不到/.test(item.reason))
    && preview.data.demoted.some((item) => /不在这次拿到的数据里/.test(item.reason)));
  check("verdict 和学习候选都给了，但都还只是候选",
    preview.data.verdict === "supported" && preview.data.learningCandidate.includes("继续用真实问题当入口"));
  check("结算预览不写库",
    workspace.experiments.experiment(experimentId).verdict === "open");

  // ── 只有数字没有原话：不能说读者怎么想 ──────────────────────────
  const metricsOnly = settlementContext(workspace, { experimentId });
  check("没有原话时明确禁止谈读者在讨论什么",
    /不得说读者怎么想/.test(describeSettlementEvidence(metricsOnly)));
  check("而且如实列出还差一句真实反馈", metricsOnly.missing.some((item) => /真实反馈原话/.test(item)));

  // ── 确认学习才落库 ──────────────────────────────────────────────
  const settled = await call(base, `/api/workspace/experiments/${experimentId}/settle`, {
    method: "POST",
    body: {
      publicationId,
      outcome: preview.data.observations.map((item) => item.text).join("\n"),
      learning: preview.data.learningCandidate,
      verdict: preview.data.verdict,
      confirmed: true,
    },
  });
  check("用户确认之后才结算", settled.data.ok === true
    && workspace.experiments.experiment(experimentId).verdict === "supported");
  check("落库的是用户确认过的那句学习",
    workspace.experiments.experiment(experimentId).learningMarkdown.includes("继续用真实问题当入口"));

  console.log("\n实验 AI 验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
