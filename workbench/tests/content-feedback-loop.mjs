// 反馈闭环：发布 → 反馈 → 可回溯证据 → 用户问题 → 下一轮内容。
//
// ⚠️ 这里验的核心是**闭环有没有真的闭上**。
// 上一版反馈存成 `source_id = experiment:<id>`——那个 id 指向一次实验，
// 指不回任何一句话。于是问题永远回溯不到「谁说了什么」，证据等级只能是「人工记录」。
// 看着连上了，其实断在这里。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { EVIDENCE_GRADES, gradeProblemEvidence } from "../server/domain/audience-raw.mjs";
import { buildDiscoveryContext } from "../server/domain/content-discovery.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-feedback-loop-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-03T08:00:00.000Z");
let workspace;
let server;
let respond = null;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

const FEEDBACK = [
  "读者A：看完才意识到，我一直把焦虑当成能力不足的证明。",
  "读者B：那我到底怎么判断哪次是真的能力不够？",
].join("\n");

async function start() {
  const env = {
    async CONTENT_BRIDGE_COMPLETE_JSON() {
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

  const projectId = workspace.domain.createProject({
    title: "创作焦虑", briefMarkdown: "简报", actor: "user", confirmed: true, now,
  });
  const experimentId = workspace.experiments.recordHypothesis({
    projectId,
    hypothesisMarkdown: "用真实问题当入口，会比直接讲概念更容易被收藏。",
    actor: "user", confirmed: true, now,
  });

  // ── 结算之前不许从反馈里读问题 ──────────────────────────────────
  const tooEarly = await call(base, `/api/workspace/experiments/${experimentId}/problem-candidates`, {
    method: "POST", body: { feedbackText: FEEDBACK },
  });
  check("没结算就想从反馈里读问题会被挡住", tooEarly.status === 409 && /先结算/.test(tooEarly.data.error));

  workspace.experiments.settleExperiment(experimentId, {
    outcomeMarkdown: "收到两条留言。",
    learningMarkdown: "以后讨论创作焦虑时，优先讲怎么判断，而不是只讲机制。",
    verdict: "mixed",
    actor: "user", confirmed: true, now,
  });

  // ── 反馈先进不可变证据层 ────────────────────────────────────────
  const voicesBefore = workspace.audienceRaw.stats().total;
  const recorded = await call(base, `/api/workspace/experiments/${experimentId}/feedback`, {
    method: "POST", body: { feedbackText: FEEDBACK },
  });
  check("这次发布收到的反馈成为一段可回溯的原话", recorded.data.ok === true
    && workspace.audienceRaw.stats().total === voicesBefore + 1);
  check("它记着自己是哪一篇发出去之后收到的", /发布后/.test(recorded.data.voice.sourceName));
  check("正文逐字保存", workspace.audienceRaw.source(recorded.data.voice.id).body === FEEDBACK);
  assert.throws(
    () => workspace.db.prepare("UPDATE audience_raw_sources SET body='改过的' WHERE id=?").run(recorded.data.voice.id),
    /不可变证据/,
  );
  check("和别的原话一样改不了", true);

  // ── 从反馈读出的问题必须能逐字回溯 ──────────────────────────────
  respond = () => ({
    model: "test-loop",
    data: {
      problems: [{
        statement: "我到底怎么判断哪次是真的能力不够？",
        why_it_matters: "把焦虑归因到机制之后，读者需要一个能自己用的判据。",
        evidence_quote: "那我到底怎么判断哪次是真的能力不够？",
      }],
    },
  });
  const extracted = await call(base, `/api/workspace/experiments/${experimentId}/problem-candidates`, {
    method: "POST", body: { rawSourceId: recorded.data.voice.id },
  });
  check("从这段反馈里读出了用户问题", extracted.data.problems.length === 1);
  /**
   * ⚠️ 这一条是整个 P5 的关键。
   * 证据指向那段原话本身（raw:<id>），不是指向一次实验——
   * 指向实验的话，这条问题永远回溯不到任何一句真话。
   */
  check("证据指向那段原话，不是指向这次实验",
    extracted.data.problems[0].sources[0].sourceId === recorded.data.voice.ref
    && !extracted.data.problems[0].sources[0].sourceId.startsWith("experiment:"));

  const saved = await call(base, "/api/workspace/audience-problems", {
    method: "POST", body: { ...extracted.data.problems[0], confirmed: true },
  });
  const storedProblem = workspace.contentBridge.audienceProblem(saved.data.problem.id);
  const grade = gradeProblemEvidence(workspace.db, storedProblem);
  check("入库之后它是「真实原话」，不是「人工记录」", grade.grade === EVIDENCE_GRADES.VERBATIM);
  check("而且带得回是谁在哪儿说的", grade.quotes[0].sourceName.includes("发布后")
    && grade.quotes[0].quote.includes("怎么判断哪次是真的能力不够"));

  // ── 这段反馈会进下一次扫描 ──────────────────────────────────────
  const context = buildDiscoveryContext(workspace, {});
  check("下一次扫描会读到这段发布后的反馈",
    context.voices.some((voice) => voice.id === recorded.data.voice.id));
  check("那条已确认的问题也在，带着它的原话",
    context.problems.some((problem) => problem.quotes.some((quote) => quote.quote.includes("能力不够"))));

  // ── 一段原话可以直接读问题，不必等 Discovery 挑中它 ──────────────
  const voice = workspace.audienceRaw.record({
    kind: "comment",
    body: "评论区：写长文我总是写到一半就想推翻重来，是不是方法不对？",
    actor: "user", confirmed: true, now,
  });
  respond = () => ({
    model: "test-loop",
    data: {
      problems: [
        { statement: "写长文写到一半总想推翻重来，是方法不对吗？", why_it_matters: "反复重来是长内容最常见的停滞点。", evidence_quote: "写长文我总是写到一半就想推翻重来" },
        { statement: "编的问题", why_it_matters: "编的", evidence_quote: "这句话原文里没有" },
      ],
    },
  });
  const fromVoice = await call(base, `/api/workspace/audience-voices/${voice.id}/problem-candidates`, { method: "POST" });
  check("编出来的原话让整次提取失败，而不是混进去一条假证据",
    fromVoice.data.ok === false && /逐字定位/.test(fromVoice.data.error));

  respond = () => ({
    model: "test-loop",
    data: {
      problems: [{ statement: "写长文写到一半总想推翻重来，是方法不对吗？", why_it_matters: "反复重来是长内容最常见的停滞点。", evidence_quote: "写长文我总是写到一半就想推翻重来" }],
    },
  });
  const problemsBefore = workspace.db.prepare("SELECT COUNT(*) AS c FROM audience_problems").get().c;
  const direct = await call(base, `/api/workspace/audience-voices/${voice.id}/problem-candidates`, { method: "POST" });
  check("一段原话可以直接读出用户问题，不必等 Discovery 挑中它", direct.data.problems.length === 1);
  check("读问题不写库", workspace.db.prepare("SELECT COUNT(*) AS c FROM audience_problems").get().c === problemsBefore);
  const keptDirect = await call(base, "/api/workspace/audience-problems", {
    method: "POST", body: { ...direct.data.problems[0], confirmed: true },
  });
  check("确认之后它同样是真实原话",
    gradeProblemEvidence(workspace.db, workspace.contentBridge.audienceProblem(keptDirect.data.problem.id)).grade === EVIDENCE_GRADES.VERBATIM);

  // ── 学到的东西带去下一次扫描 ────────────────────────────────────
  const learning = workspace.experiments.experiment(experimentId).learningMarkdown;
  check("复盘学到的那句话留在实验里，可以带去下一次扫描", learning.includes("优先讲怎么判断"));

  console.log("\n反馈闭环验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
