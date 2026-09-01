import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createBookRecord } from "../server/routes/books-local.mjs";
import { createDefaultJobHandlers } from "../server/jobs/default-job-handlers.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import {
  applyExplorationPage,
  applyWikiCompile,
  captureWikiSourceSnapshot,
  splitSourceForReading,
  validateWikiLintRepair,
  validateWikiCompile,
  wikiIndex,
  wikiPage,
  wikiSearch,
} from "../server/domain/wiki-pages.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-wiki-pages-"));
let workspace;
let modelServer;
const check = (name, value) => {
  assert(value, name);
  console.log(` ✓ ${name}`);
};

function compiledPage({ pageId = "", revision = 0, action = "create", title, pageType, summary, body, quote, links = [] }) {
  return {
    pageId,
    expectedRevision: revision,
    action,
    title,
    pageType,
    summary,
    bodyMarkdown: body,
    beforeBodyMarkdown: "",
    changeSummary: "吸收新来源并形成当前认识",
    citations: [{ quote, contribution: "支撑页面核心判断" }],
    links,
  };
}

try {
  const now = new Date("2026-09-01T08:00:00.000Z");
  workspace = await openWorkspace({ xenhoHome: path.join(root, "Xenho"), now });
  const longText = Array.from({ length: 1_700 }, (_, index) => `第${index + 1}段：文件系统让 Agent 的长期状态能够跨任务保留下来，并在新的探索中继续复用。`).join("\n\n");
  const chunks = splitSourceForReading(longText);
  check("超过 60000 字的来源会分段阅读全文而不是截断", longText.length > 60_000 && chunks.length > 1
    && chunks[0].includes("第1段") && chunks.at(-1).includes("第1700段"));

  const rawQuoteA = "文件系统让 Agent 的长期状态能够跨任务保留下来，并在新的探索中继续复用。";
  const bookA = await createBookRecord(workspace, {
    title: "Agent 长期记忆", sourceKind: "文档",
    chapters: [{ title: "文件系统与长期状态", text: `${rawQuoteA}\n\n这不是临时检索，而是把理解持续写进已有知识页面。` }],
  });
  const sourceA = workspace.db.prepare("SELECT id,body_markdown AS body FROM book_documents WHERE book_id=?").get(bookA.id);
  const snapshotA = captureWikiSourceSnapshot(workspace, sourceA.id, { now });
  const hashA = snapshotA.contentSha256;
  const firstProposal = {
    sourceId: sourceA.id,
    sourceSnapshotId: snapshotA.id,
    title: "文件系统与长期状态",
    compilationSummary: "建立来源资料卡，并形成 Agent 长期记忆概念页。",
    sourceLocator: "Agent 长期记忆 · 文件系统与长期状态",
    sourceContentSha256: hashA,
    model: "test",
    pages: [
      compiledPage({
        title: "来源：Agent 长期记忆 · 文件系统与长期状态", pageType: "source_summary",
        summary: "这份来源解释文件系统为什么能承担 Agent 的长期状态。",
        body: `# 来源：Agent 长期记忆 · 文件系统与长期状态\n\n## 核心内容\n\n${rawQuoteA}\n\n## 对 Wiki 的贡献\n\n它连接了 Agent、长期记忆和文件系统。`,
        quote: rawQuoteA,
        links: [{ toTitle: "Agent 长期记忆", relation: "支撑", why: "来源直接解释长期状态" }],
      }),
      compiledPage({
        title: "Agent 长期记忆", pageType: "concept",
        summary: "Agent 在多次任务间持续保存并复用状态的能力。",
        body: `# Agent 长期记忆\n\nAgent 的长期记忆不是一次查询的临时上下文，而是跨任务保留并继续演化的状态。\n\n## 文件系统\n\n${rawQuoteA}\n\n## 当前认识\n\n持久工作空间让后续探索不必从零开始。`,
        quote: rawQuoteA,
        links: [{ toTitle: "来源：Agent 长期记忆 · 文件系统与长期状态", relation: "依据来自", why: "当前认识由该来源支撑" }],
      }),
    ],
  };
  const appliedA = applyWikiCompile(workspace, { proposal: firstProposal, now });
  const indexA = wikiIndex(workspace);
  check("一次来源编译会原子写入多张完整页面", appliedA.created === 2 && indexA.pages.length === 2);
  check("页面、来源引用、双向可浏览连接、版本和 Log 同时写入",
    indexA.totals.links === 2 && indexA.totals.sources === 1 && indexA.log[0].operation === "ingest");
  check("Raw 在 Wiki 编译前后保持不变", workspace.db.prepare("SELECT body_markdown AS body FROM book_documents WHERE id=?").get(sourceA.id).body === sourceA.body);
  check("编译会冻结 AI 实际读过的不可变 Raw 快照", workspace.db.prepare("SELECT body_markdown AS body FROM wiki_source_snapshots WHERE id=?").get(snapshotA.id).body === sourceA.body);

  const concept = indexA.pages.find((page) => page.title === "Agent 长期记忆");
  const rawQuoteB = "新的来源进一步指出，长期记忆还需要把重要结论重新编译回可维护的知识页面。";
  const bookB = await createBookRecord(workspace, {
    title: "持续编译", sourceKind: "文章", chapters: [{ title: "知识为什么会复利", text: `${rawQuoteB}\n\n旧页面需要被修订，而不是为每份来源另建一个孤立摘要。` }],
  });
  const sourceB = workspace.db.prepare("SELECT id,body_markdown AS body FROM book_documents WHERE book_id=?").get(bookB.id);
  const snapshotB = captureWikiSourceSnapshot(workspace, sourceB.id, { now: new Date(now.getTime() + 500) });
  const hashB = snapshotB.contentSha256;
  const secondProposal = {
    sourceId: sourceB.id,
    sourceSnapshotId: snapshotB.id,
    title: "知识为什么会复利",
    compilationSummary: "新来源补充持续编译机制，并修订既有 Agent 长期记忆页面。",
    sourceLocator: "持续编译 · 知识为什么会复利",
    sourceContentSha256: hashB,
    model: "test",
    pages: [
      compiledPage({
        title: "来源：持续编译 · 知识为什么会复利", pageType: "source_summary",
        summary: "这份来源说明持续编译如何让知识产生复利。",
        body: `# 来源：持续编译 · 知识为什么会复利\n\n## 核心内容\n\n${rawQuoteB}\n\n## 贡献\n\n补充了知识回写机制。`,
        quote: rawQuoteB,
        links: [{ toTitle: "Agent 长期记忆", relation: "补充", why: "补充了知识回写" }],
      }),
      compiledPage({
        pageId: concept.id, revision: concept.revision, action: "update",
        title: concept.title, pageType: concept.pageType,
        summary: "Agent 跨任务保存状态，并把重要探索持续编译回知识页面的能力。",
        body: `# Agent 长期记忆\n\nAgent 的长期记忆不是一次查询的临时上下文，而是跨任务保留并继续演化的状态。\n\n## 文件系统\n\n文件系统承担持久工作空间。\n\n## 持续编译\n\n${rawQuoteB}\n\n## 当前认识\n\n长期记忆既要保存状态，也要把探索沉淀成可维护的页面。`,
        quote: rawQuoteB,
        links: [{ toTitle: "来源：持续编译 · 知识为什么会复利", relation: "依据来自", why: "新结论由该来源补充" }],
      }),
    ],
  };
  const appliedB = applyWikiCompile(workspace, { proposal: secondProposal, now: new Date(now.getTime() + 1_000) });
  const evolved = wikiPage(workspace, concept.id);
  check("第二份来源优先修订既有页面而不是复制同名页面", appliedB.updated === 1
    && wikiIndex(workspace).pages.filter((page) => page.title === "Agent 长期记忆").length === 1);
  check("页面演化保留完整版本与两份来源", evolved.page.revision === 2 && evolved.revisions.length === 2 && evolved.sources.length === 2);
  check("每个页面版本都保留当时使用的 Raw 快照证据", workspace.db.prepare("SELECT COUNT(*) AS count FROM wiki_revision_sources").get().count === 4);
  assert.throws(() => applyWikiCompile(workspace, { proposal: secondProposal, now: new Date(now.getTime() + 2_000) }), /审阅期间已经更新/);
  check("过期多页候选不能覆盖较新的 Wiki 版本", true);

  const bad = validateWikiCompile({ pages: [{
    title: "没有证据的页面", pageType: "concept", summary: "摘要完整但证据是编造的。",
    bodyMarkdown: "# 没有证据的页面\n\n这是一段长度足够但没有 Raw 依据的正文，用来验证真实性硬闸不会被完整页面绕过。",
    citations: [{ quote: "这句话完全不在原始来源里面，而且是模型自行编造的。" }],
  }] }, { source: { body: sourceB.body }, catalog: wikiIndex(workspace).pages, existingPages: [] });
  check("完整 Wiki 页面仍必须通过 Raw 逐字证据硬闸", bad.pages.length === 0 && bad.rejected.length >= 1);

  const currentConcept = wikiPage(workspace, concept.id);
  const lintEvidence = workspace.db.prepare(`SELECT s.source_entity_id AS sourceId,s.source_snapshot_id AS sourceSnapshotId,
      s.source_quote AS quote,s.source_locator AS locator,s.contribution,snap.content_sha256 AS sourceContentSha256
    FROM wiki_page_sources s JOIN wiki_source_snapshots snap ON snap.id=s.source_snapshot_id
    WHERE s.page_id=? ORDER BY s.created_at`).all(concept.id);
  const lintContext = {
    catalog: wikiIndex(workspace).pages,
    pages: [{
      id: concept.id, title: currentConcept.page.title, pageType: currentConcept.page.pageType,
      summary: currentConcept.page.summary, bodyMarkdown: currentConcept.page.bodyMarkdown,
      revision: currentConcept.page.revision, links: [],
    }],
    evidence: lintEvidence.map((evidence, index) => ({ evidenceId: `e${index + 1}`, pageId: concept.id, ...evidence })),
  };
  const lintBody = `${currentConcept.page.bodyMarkdown}\n\n## 与来源资料卡的连接\n\n体检补充了从当前认识返回原始证据的明确导航，已有判断保持不变。`;
  const lintRawProposal = {
    repairSummary: "补齐知识页面与来源资料卡之间的连接。",
    pages: [{
      findingIndexes: [0], pageId: concept.id, title: currentConcept.page.title,
      pageType: currentConcept.page.pageType, summary: currentConcept.page.summary,
      bodyMarkdown: lintBody, changeSummary: "补齐来源导航",
      evidenceIds: lintEvidence.map((_, index) => `e${index + 1}`),
      links: [{ toTitle: "来源：持续编译 · 知识为什么会复利", relation: "依据来自", why: "让当前认识可回到 Raw 证据" }],
    }],
  };
  const validatedRepair = validateWikiLintRepair(lintRawProposal, { context: lintContext, findingIndexes: [0] });
  check("体检建议只能生成带现有来源证据的整页修订", validatedRepair.pages.length === 1
    && validatedRepair.pages[0].citations[0].sourceSnapshotId === lintEvidence[0].sourceSnapshotId);
  const badRepair = validateWikiLintRepair({ ...lintRawProposal, pages: [{ ...lintRawProposal.pages[0], evidenceIds: ["unknown"] }] }, { context: lintContext, findingIndexes: [0] });
  check("体检修订不能引用模型自行编造的证据编号", badRepair.pages.length === 0 && badRepair.rejected.length === 1);
  modelServer = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(lintRawProposal) } }] }));
  });
  await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  const reportCandidate = workspace.domain.actions.propose({
    actionType: "wiki.lint.review", targetId: null, proposedBy: "ai",
    payload: {
      kind: "wiki.lint.report", mode: "network", deterministic: {},
      findings: [{ type: "missing_link", pages: [currentConcept.page.title], problem: "页面缺少返回来源的连接", suggestion: "补充可核验的来源导航" }],
    },
  });
  const repairResult = await createDefaultJobHandlers(workspace, {
    AGENT_INGEST_BASE_URL: `http://127.0.0.1:${modelServer.address().port}`,
    AGENT_INGEST_API_KEY: "local-test-key", AGENT_INGEST_MODEL: "local-test-model",
  })["wiki.lint.repair"]({ reportCandidateId: reportCandidate.id, findingIndexes: [0] });
  const generatedRepair = workspace.domain.actions.get(repairResult.candidateId);
  check("体检修订任务完成后关闭原报告并留下可审阅候选", workspace.domain.actions.get(reportCandidate.id).status === "applied"
    && generatedRepair.status === "proposed" && generatedRepair.payload.kind === "wiki.repair");
  workspace.domain.actions.reject(generatedRepair.id);
  await new Promise((resolve) => modelServer.close(resolve));
  modelServer = null;
  const lintApplied = applyWikiCompile(workspace, {
    operation: "lint",
    proposal: { kind: "wiki.repair", title: "全库体检修订", repairSummary: validatedRepair.repairSummary, pages: validatedRepair.pages },
    now: new Date(now.getTime() + 2_500),
  });
  check("确认体检修订后才原子写入页面新版本与体检 Log", lintApplied.updated === 1
    && wikiPage(workspace, concept.id).page.revision === 3 && wikiIndex(workspace).log[0].operation === "lint"
    && wikiIndex(workspace).log[0].summary.includes("补齐知识页面"));

  const exploration = applyExplorationPage(workspace, {
    title: "持久状态与知识复利", pageType: "synthesis",
    summary: "综合说明状态保存和知识编译为何必须同时存在。",
    bodyMarkdown: "# 持久状态与知识复利\n\n只保存状态不足以形成认知复利；有价值的探索还要回写为可持续修订、带来源并互相连接的完整知识页面。\n\n## 综合判断\n\n文件系统负责让状态留下，Wiki 编译负责让理解继续增长。",
    basedOnPageIds: [concept.id],
    why: "本次比较形成了可被以后直接复用的综合判断。",
  }, { now: new Date(now.getTime() + 3_000) });
  check("有价值的探索经确认后能归档为综合页面并继承来源", exploration.created === 1
    && wikiPage(workspace, exploration.pages[0].id).sources.length === 2);
  check("查询能优先复用持久 Wiki 正文", wikiSearch(workspace, "知识复利").some((page) => page.title === "持久状态与知识复利"));
  check("隔离工作区数据库完整性仍通过", workspace.check().ok);
  console.log("\n ✓ LLM Wiki 页面、增量编译、版本、引用、连接和探索复利全部通过");
} finally {
  if (modelServer) await new Promise((resolve) => modelServer.close(resolve));
  workspace?.close();
  await fs.rm(root, { recursive: true, force: true });
}
