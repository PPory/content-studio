// 原始用户声音：不可变证据层的域层与 API 验收。
//
// 这里盯的是三件事：正文改不了、被引用的证据删不掉、引用必须能逐字落回原文。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { WORKSPACE_SCHEMA_VERSION } from "../server/storage/migrations.mjs";
import {
  EVIDENCE_GRADES,
  gradeProblemEvidence,
  problemSourceKindForRawKind,
  rawSourceRef,
} from "../server/domain/audience-raw.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-audience-raw-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-02T08:00:00.000Z");
let workspace;
let server;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

const CHAT = [
  "小林：AI 工具每周都在出新的，我到底该学哪个？",
  "阿泽：我也是，收藏夹里躺了二十个教程，一个都没打开。",
  "小林：感觉不学就落后，学了又用不上，挺焦虑的。",
].join("\n");

async function start() {
  const api = createApi({}, { workspace: Promise.resolve(workspace) });
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
  const { db, audienceRaw, contentBridge } = workspace;

  check("工作区 Schema 至少到原始用户声音版本", WORKSPACE_SCHEMA_VERSION >= 15);
  check("同来源多句引用的主键已经就位",
    workspace.db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info(?) WHERE pk > 0").get("audience_problem_sources").c === 4);
  check("原始用户声音表已创建", Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='audience_raw_sources'").get()));
  check("不可变触发器已创建", Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='audience_raw_sources_immutable'").get()));

  assert.throws(() => audienceRaw.record({ kind: "group_chat", body: CHAT, actor: "user", now }), /明确确认/);
  assert.throws(() => audienceRaw.record({ kind: "群聊", body: CHAT, actor: "user", confirmed: true, now }), /种类不受支持/);
  assert.throws(() => audienceRaw.record({ kind: "group_chat", body: "   ", actor: "user", confirmed: true, now }), /原话不能为空/);

  const first = audienceRaw.record({
    kind: "group_chat",
    body: CHAT,
    sourceName: "读者群",
    actor: "user",
    confirmed: true,
    now,
  });
  check("记录一段原话会写入证据层", Boolean(first.id) && first.duplicate === false);
  const stored = audienceRaw.source(first.id);
  check("原话逐字保存，没有被改写", stored.body === CHAT);
  check("没填时间就记成导入时间，不去猜", stored.observedAt === stored.ingestedAt);
  check("引用前缀是 raw:", stored.ref === rawSourceRef(first.id));

  const again = audienceRaw.record({ kind: "group_chat", body: `${CHAT}\n`, actor: "user", confirmed: true, now });
  check("同一段原话重复粘贴不再写第二条", again.duplicate === true && again.id === first.id);

  assert.throws(
    () => db.prepare("UPDATE audience_raw_sources SET body=? WHERE id=?").run("改过的原话", first.id),
    /不可变证据/,
  );
  check("绕过域层也改不了正文", audienceRaw.source(first.id).body === CHAT);
  assert.throws(
    () => db.prepare("UPDATE audience_raw_sources SET source_name=? WHERE id=?").run("换个来源", first.id),
    /不可变证据/,
  );
  check("来源信息同样冻结：改正靠新增一条", audienceRaw.source(first.id).sourceName === "读者群");

  // 分析状态是唯一允许变的列——上下文预算靠它，不然每次扫描都要重发全部历史。
  check("尚未分析的原话可以单独筛出来", audienceRaw.sources({ pendingOnly: true }).length === 1);
  audienceRaw.markAnalyzed([first.id], { now });
  check("标记分析过之后不再落入待分析", audienceRaw.sources({ pendingOnly: true }).length === 0);
  check("标记分析不影响正文", audienceRaw.source(first.id).body === CHAT);

  const quote = "AI 工具每周都在出新的，我到底该学哪个？";
  assert.throws(() => contentBridge.createAudienceProblem({
    statement: "我不知道该学哪个 AI 工具",
    sourceKind: problemSourceKindForRawKind("group_chat"),
    pattern: "knowledge_gap",
    sources: [{ sourceKind: "feedback", sourceId: rawSourceRef(first.id), evidenceText: "大家都在焦虑该学哪个工具", observedAt: now }],
    actor: "user",
    confirmed: true,
    now,
  }), /无法在这段原始用户声音里逐字定位/);
  check("落不回原文的「原话」写不进库", true);

  assert.throws(() => contentBridge.createAudienceProblem({
    statement: "我不知道该学哪个 AI 工具",
    sourceKind: "feedback",
    pattern: "knowledge_gap",
    sources: [{ sourceKind: "feedback", sourceId: rawSourceRef("01NOTAREALSOURCEID"), evidenceText: quote, observedAt: now }],
    actor: "user",
    confirmed: true,
    now,
  }), /原始用户声音不存在/);
  check("指向不存在原话的引用被拒绝", true);

  const problemId = contentBridge.createAudienceProblem({
    statement: "AI 工具每周都在出新的，我到底该学哪个？",
    summary: "读者群里反复出现的选择困难。",
    sourceKind: problemSourceKindForRawKind("group_chat"),
    pattern: "frequency",
    sources: [{ sourceKind: "feedback", sourceId: rawSourceRef(first.id), evidenceText: quote, observedAt: now }],
    actor: "user",
    confirmed: true,
    now,
  });
  check("逐字对得上的引用可以入库", Boolean(problemId));

  /**
   * ⚠️ 同一段原话里的两句证据不能撞主键。
   * 真实跑的时候用户点保存，屏幕上弹出的是一句原样的 SQLite 报错。
   */
  const twoQuoteId = contentBridge.createAudienceProblem({
    statement: "收藏夹里的教程为什么打不开？",
    sourceKind: problemSourceKindForRawKind("group_chat"),
    pattern: "frequency",
    sources: [
      { sourceKind: "feedback", sourceId: rawSourceRef(first.id), evidenceText: quote, observedAt: now },
      { sourceKind: "feedback", sourceId: rawSourceRef(first.id), evidenceText: "收藏夹里躺了二十个教程，一个都没打开。", observedAt: now },
    ],
    actor: "user",
    confirmed: true,
    now,
  });
  check("同一段原话里的两句证据不再撞主键", Boolean(twoQuoteId));
  /**
   * ⚠️ 两句都要留下来。
   * 一条问题有几句话撑着，是判断它有多硬的直接依据；上一版为了绕开主键冲突
   * 丢掉第二句，等于悄悄把证据变弱了。
   */
  const twoQuote = contentBridge.audienceProblem(twoQuoteId);
  check("同一段原话里的两句证据各占一行，不再被丢掉一句", twoQuote.sources.length === 2
    && twoQuote.sources.some((item) => item.evidenceText === quote)
    && twoQuote.sources.some((item) => item.evidenceText.includes("二十个教程")));
  check("两句证据都能逐字回溯", gradeProblemEvidence(db, twoQuote).verbatimCount === 2);

  // 完全一样的句子重复提交仍然只留一条——那种重复是错误，不是第二条证据。
  const repeatedId = contentBridge.createAudienceProblem({
    statement: "重复提交同一句",
    sourceKind: problemSourceKindForRawKind("group_chat"),
    pattern: "feedback",
    sources: [
      { sourceKind: "feedback", sourceId: rawSourceRef(first.id), evidenceText: quote, observedAt: now },
      { sourceKind: "feedback", sourceId: rawSourceRef(first.id), evidenceText: quote, observedAt: now },
    ],
    actor: "user", confirmed: true, now,
  });
  check("一模一样的引用仍然只留一条", contentBridge.audienceProblem(repeatedId).sources.length === 1);

  const graded = gradeProblemEvidence(db, contentBridge.audienceProblem(problemId));
  check("有原话的问题被判为真实原话", graded.grade === EVIDENCE_GRADES.VERBATIM && graded.quotes.length === 1);
  check("证据里带得回原文和出处", graded.quotes[0].quote === quote && graded.quotes[0].sourceName === "读者群");

  const manualId = contentBridge.createAudienceProblem({
    statement: "创作焦虑",
    sourceKind: "manual",
    pattern: "feedback",
    sources: [{ sourceKind: "manual", sourceId: "manual:1", evidenceText: "创作焦虑", observedAt: now }],
    actor: "user",
    confirmed: true,
    now,
  });
  const manualGrade = gradeProblemEvidence(db, contentBridge.audienceProblem(manualId));
  check("手工录入的问题只算人工记录，不算真实反馈", manualGrade.grade === EVIDENCE_GRADES.RECORDED && manualGrade.verbatimCount === 0);

  const agendaId = contentBridge.createAgenda({
    title: "创作困境有机制",
    desiredJudgment: "看起来像天赋问题的卡点多数有可解释的机制。",
    actor: "user",
    confirmed: true,
    now,
  });
  const hypothesisId = contentBridge.createAudienceProblem({
    statement: "我是不是根本没有做长内容的天赋？",
    origin: "hypothesis",
    originAgendaId: agendaId,
    actor: "user",
    confirmed: true,
    now,
  });
  const hypothesisGrade = gradeProblemEvidence(db, contentBridge.audienceProblem(hypothesisId));
  check("议程推导的问题被判为假设", hypothesisGrade.grade === EVIDENCE_GRADES.HYPOTHESIS);
  check("假设的说明不声称有人真的这样问过", /尚待真实反馈验证/.test(hypothesisGrade.note));

  assert.throws(
    () => db.prepare("DELETE FROM audience_raw_sources WHERE id=?").run(first.id),
    /已经被用户问题引用/,
  );
  check("被引用的原话删不掉", Boolean(audienceRaw.source(first.id)));

  const before = audienceRaw.stats();
  audienceRaw.record({ kind: "comment", body: "这个方法我试了一周，确实比追工具有用。", actor: "user", confirmed: true, now });
  const after = audienceRaw.stats();
  check("统计能反映新导入，供缓存失效判断", after.total === before.total + 1 && after.pending === before.pending + 1);

  const base = await start();
  const list = await call(base, "/api/workspace/audience-voices");
  check("API 可以读出原话清单和种类", list.data.ok && list.data.voices.length === 2 && list.data.kinds.length === 7);
  check("清单里带上被引用次数", list.data.voices.find((item) => item.id === first.id).citations >= 2);

  const rejected = await call(base, "/api/workspace/audience-voices", { method: "POST", body: { kind: "comment", body: "没有确认的粘贴" } });
  check("未确认的记录被拒绝", rejected.status === 400 && /明确确认/.test(rejected.data.error));

  const created = await call(base, "/api/workspace/audience-voices", {
    method: "POST",
    body: { kind: "direct_message", body: "私信问我：写不下去的时候你都怎么办？", confirmed: true },
  });
  check("API 可以记录一段原话", created.data.ok && created.data.voice.kind === "direct_message" && created.data.duplicate === false);

  const duplicate = await call(base, "/api/workspace/audience-voices", {
    method: "POST",
    body: { kind: "direct_message", body: "私信问我：写不下去的时候你都怎么办？", confirmed: true },
  });
  check("API 重复粘贴照实回执，不报错也不重复写", duplicate.data.ok && duplicate.data.duplicate === true);

  const missing = await call(base, "/api/workspace/audience-voices/01NOTAREALSOURCEID");
  check("读不存在的原话返回 404", missing.status === 404);

  console.log("\n原始用户声音验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
