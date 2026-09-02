import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-content-bridge-api-"));
const workspace = await openWorkspace({ xenhoHome: path.join(root, "Xenho") });
let server;
let failModel = false;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

function createInsight() {
  const id = createUlid();
  const now = new Date("2026-09-01T08:00:00.000Z");
  const title = "2026-W36 本地内容洞察";
  const body = "# 本地洞察\n\n## AI 使用反馈\n\n现在遇到任何选择我都先问 AI，感觉自己懒得判断了。\n\n多条反馈都提到模型越多越不知道该选哪个。";
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id, type: "knowledge_item", now });
    workspace.db.prepare("INSERT INTO knowledge_items(id,knowledge_kind,title,body_markdown,locator) VALUES (?,'knowledge_card',?,?,'insight:2026-W36')")
      .run(id, title, body);
    workspace.repository.setEntityText(id, { title, body, now });
  });
  return id;
}

async function start() {
  const env = {
    async CONTENT_BRIDGE_COMPLETE_JSON() {
      if (failModel) throw Object.assign(new Error("上游模型暂时不可用"), { status: 503 });
      return {
        model: "test-bridge-model",
        data: {
          problems: [{
            statement: "AI 越用越方便，为什么我越来越不愿意自己判断？",
            why_it_matters: "这会影响用户如何分配人与 AI 的责任。",
            pattern: "knowledge_gap",
            evidence_quote: "现在遇到任何选择我都先问 AI，感觉自己懒得判断了。",
          }],
        },
      };
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
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { origin: base } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, value: await response.json() };
}

try {
  const insightId = createInsight();
  const base = await start();

  const missingAgendaConfirmation = await call(base, "/api/workspace/agendas", {
    method: "POST",
    body: { title: "判断权", desiredJudgment: "人应保留判断权" },
  });
  check("Agenda API 拒绝未确认写入", missingAgendaConfirmation.response.status === 400 && missingAgendaConfirmation.value.ok === false);
  const createdAgenda = await call(base, "/api/workspace/agendas", {
    method: "POST",
    body: { title: "判断权", desiredJudgment: "人应保留判断权", confirmed: true },
  });
  check("Agenda API 创建后可读取", createdAgenda.value.agenda.title === "判断权"
    && (await call(base, "/api/workspace/agendas")).value.agendas.length === 1);

  const before = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
  const extracted = await call(base, "/api/workspace/audience-problems/extract", {
    method: "POST",
    body: { insightId },
  });
  const after = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
  assert.equal(extracted.response.status, 200, JSON.stringify(extracted.value));
  check("从洞察提取的是带逐字来源的 Candidate，且不产生副作用",
    extracted.value.candidateOnly === true
    && extracted.value.problems[0].sources[0].evidenceText.includes("先问 AI")
    && before === after);

  const invalidInsight = await call(base, "/api/workspace/audience-problems/extract", {
    method: "POST",
    body: { insightId: "missing-insight" },
  });
  check("不存在的洞察报告返回明确 404", invalidInsight.response.status === 404 && /不存在/.test(invalidInsight.value.error));

  failModel = true;
  const modelFailure = await call(base, "/api/workspace/audience-problems/extract", {
    method: "POST",
    body: { insightId },
  });
  failModel = false;
  check("模型失败不写入用户问题", modelFailure.response.status === 503
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count === 0);

  const candidate = extracted.value.problems[0];
  const unconfirmedSave = await call(base, "/api/workspace/audience-problems", {
    method: "POST",
    body: candidate,
  });
  check("候选未经确认不能保存", unconfirmedSave.response.status === 400 && unconfirmedSave.value.ok === false);
  const saved = await call(base, "/api/workspace/audience-problems", {
    method: "POST",
    body: { ...candidate, confirmed: true },
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.value));
  check("确认后保存 Audience Problem 与来源关系", saved.value.problem.sources.length === 1
    && saved.value.problem.sourceKind === "insight_report"
    && (await call(base, "/api/workspace/audience-problems")).value.problems.length === 1);

  const agendaId = createdAgenda.value.agenda.id;
  const beforeDerive = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
  const derived = await call(base, "/api/workspace/audience-problems/from-agenda", {
    method: "POST",
    body: { agendaId },
  });
  const afterDerive = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
  assert.equal(derived.response.status, 200, JSON.stringify(derived.value));
  const hypothesisCandidate = derived.value.problems[0];
  check("议程推导返回的是不带来源的假设候选，且不产生副作用",
    derived.value.candidateOnly === true
    && hypothesisCandidate.origin === "hypothesis"
    && hypothesisCandidate.originAgendaId === agendaId
    && hypothesisCandidate.sources.length === 0
    && hypothesisCandidate.pattern === "knowledge_gap"
    && beforeDerive === afterDerive);

  const missingAgenda = await call(base, "/api/workspace/audience-problems/from-agenda", {
    method: "POST",
    body: { agendaId: "missing-agenda" },
  });
  check("不存在的议程返回明确 404", missingAgenda.response.status === 404 && /不存在/.test(missingAgenda.value.error));

  failModel = true;
  const deriveFailure = await call(base, "/api/workspace/audience-problems/from-agenda", {
    method: "POST",
    body: { agendaId },
  });
  failModel = false;
  check("议程推导模型失败不写入用户问题", deriveFailure.response.status === 503 && afterDerive === beforeDerive);

  const archived = await call(base, `/api/workspace/audience-problems/${saved.value.problem.id}/update`, {
    method: "POST",
    body: { action: "archive", confirmed: true },
  });
  check("Audience Problem API 支持可恢复归档", archived.value.problem.status === "archived"
    && (await call(base, "/api/workspace/audience-problems")).value.problems.length === 0
    && (await call(base, "/api/workspace/audience-problems?archived=1")).value.problems.length === 1);

  // 放在归档断言之后，免得多出来的这条改掉上面那两个列表计数。
  const savedHypothesis = await call(base, "/api/workspace/audience-problems", {
    method: "POST",
    body: { ...hypothesisCandidate, confirmed: true },
  });
  assert.equal(savedHypothesis.response.status, 200, JSON.stringify(savedHypothesis.value));
  check("确认后保存的假设永久标注来历且没有来源",
    savedHypothesis.value.problem.origin === "hypothesis"
    && savedHypothesis.value.problem.originAgendaId === agendaId
    && savedHypothesis.value.problem.sources.length === 0
    && savedHypothesis.value.problem.sourceRef === `agenda:${agendaId}`);
} finally {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  workspace.close();
  await fs.rm(root, { recursive: true, force: true });
}

console.log("\nContent Bridge Audience Problem API 测试通过。\n");
