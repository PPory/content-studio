// 长期议程候选：数据不够必须说还看不出来，候选必须指得回真实记录。
//
// ⚠️ 这一步最容易产出「听起来很对但什么都没说」的东西。
// 让模型总结几条内容机会，它一定写得出一句漂亮的长期判断——
// 而那句话多半只是把现有那几条重新组织了一遍。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import { AGENDA_THRESHOLD, observeAgendaSignals, describeAgendaSignals } from "../server/domain/content-agenda.mjs";
import { buildContentBridgeContext } from "../server/domain/content-bridge-context.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-agenda-ai-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-03T08:00:00.000Z");
let workspace;
let server;
let respond = null;
let calls = 0;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

function wikiPage(title) {
  const id = createUlid();
  const stamp = now.toISOString();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id, type: "wiki_page", now });
    workspace.db.prepare(`INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,current_revision,schema_version,created_at,updated_at)
      VALUES (?, ?, 'concept', ?, ?, 1, 1, ?, ?)`).run(id, title, `${title}的摘要。`, `# ${title}`, stamp, stamp);
    workspace.repository.setEntityText(id, { title, body: title, now });
  });
  return id;
}

/** 造一条完整的「问题 × 知识 → 判断」，因为议程只能从这种记录里看出来。 */
function opportunity({ problemText, quote, claim }) {
  const wikiId = wikiPage(`知识-${claim.slice(0, 6)}`);
  const voice = workspace.audienceRaw.record({
    kind: "comment", body: `评论：${quote}`, actor: "user", confirmed: true, now,
  });
  const problemCandidate = {
    statement: problemText,
    summary: "说明。",
    origin: "observed",
    evidence: [{ rawSourceId: voice.id, quote }],
  };
  return workspace.contentBridge.saveOpportunity({
    wikiPageId: wikiId,
    problemCandidate,
    coreClaim: claim,
    knowledgeExplanation: "解释。",
    cognitiveGap: "认知差。",
    dominantAction: "judgment",
    fit: "strong",
    fitReason: "理由。",
    construction: {
      elements: [{ id: "p", type: "problem", label: problemText, source_kind: "comment", source_id: `raw:${voice.id}` }],
      relations: [], entry_options: [], evidence_gaps: [], counterarguments: [],
    },
    freshness: buildContentBridgeContext(workspace, { wikiPageId: wikiId, problemCandidate, includeExperiences: true, scope: "workspace" }).freshness,
    actor: "user", confirmed: true, now,
  });
}

async function start() {
  const env = {
    async CONTENT_AGENDA_COMPLETE_JSON() {
      calls += 1;
      if (typeof respond === "function") return respond();
      throw new Error("测试没有设置模型响应");
    },
  };
  const api = createApi(env, { workspace: Promise.resolve(workspace) });
  server = http.createServer((req, res) => api(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
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

  // ── 数据不够：说还差多少，而且不跑模型 ──────────────────────────
  const emptySignals = observeAgendaSignals(workspace);
  check("一条内容机会都没有时，看不出议程", emptySignals.ready === false);
  check("还差多少说得出数字，不是一句「数据不足」",
    emptySignals.missing.some((item) => /再攒 5 条内容机会/.test(item))
    && emptySignals.missing.some((item) => /再覆盖 3 个不同的用户问题/.test(item)));

  const early = await call(base, "/api/workspace/agenda-candidates", { method: "POST" });
  check("数据不够时直接拒绝，连模型都不跑", early.status === 409 && calls === 0);
  check("并且把还差多少一起说清", /再攒 5 条内容机会/.test(early.data.hint || ""));
  check("同时告诉用户手工那条路一直在", /看不出/.test(early.data.error));

  // ── 攒够：五条机会、四种判断、三个不同问题 ──────────────────────
  const ids = [];
  ids.push(opportunity({ problemText: "AI 工具太多我该学哪个？", quote: "AI 工具太多我该学哪个", claim: "学 AI 应该从真实任务倒推，而不是从工具清单开始。" }));
  ids.push(opportunity({ problemText: "写到一半就卡住是不是没天赋？", quote: "写到一半就卡住是不是没天赋", claim: "写作卡顿是认知机制问题，不是天赋问题。" }));
  ids.push(opportunity({ problemText: "为什么我越用 AI 越不想自己想？", quote: "为什么我越用 AI 越不想自己想", claim: "判断权必须自己留着，能外包的只有任务。" }));
  ids.push(opportunity({ problemText: "收藏了很多教程却打不开", quote: "收藏了很多教程却打不开", claim: "囤积教程是在缓解焦虑，不是在学习。" }));
  ids.push(opportunity({ problemText: "我该怎么判断自己是真的不行", quote: "我该怎么判断自己是真的不行", claim: "把感受当证据之前，先找到能被复核的判据。" }));

  const signals = observeAgendaSignals(workspace);
  check("攒够之后才说得出话", signals.ready === true);
  check("三个维度都数过了", signals.counts.opportunities >= AGENDA_THRESHOLD.opportunities
    && signals.counts.distinctClaims >= AGENDA_THRESHOLD.distinctClaims
    && signals.counts.distinctProblems >= AGENDA_THRESHOLD.distinctProblems);
  const described = describeAgendaSignals(signals);
  check("给模型的那份长期行为每条都带 id", described.includes(`id=${ids[0]}`));

  // ── 依据必须指得回真实记录 ────────────────────────────────────
  respond = () => ({
    model: "test-agenda",
    data: {
      agendas: [
        {
          title: "保留人的判断权",
          desired_judgment: "把任务交给 AI 是效率，把判断交出去是失能；能外包的只有前者。",
          audience: "高频使用 AI 的创作者",
          problem_space: "AI 进入判断链之后，人怎么分配判断责任",
          reason: "这几条都在把「看起来像能力问题的卡点」还原成机制，并且都落到「判断要自己留着」。",
          basis: [ids[0], ids[2], ids[4]],
        },
        {
          title: "编的议程",
          desired_judgment: "一句听起来很对的话。",
          reason: "凭感觉。",
          basis: ["01NOTAREALID0000000000000A"],
        },
        {
          title: "只踩了一条",
          desired_judgment: "另一句。",
          reason: "凭一条。",
          basis: [ids[1]],
        },
      ],
    },
  });
  const proposed = await call(base, "/api/workspace/agenda-candidates", { method: "POST" });
  check("指不回真实记录的那条被丢掉", !proposed.data.agendas.some((item) => item.title === "编的议程"));
  check("只踩了一条记录的也不算议程", !proposed.data.agendas.some((item) => item.title === "只踩了一条"));
  check("并且说得出为什么被丢掉", proposed.data.dropped.length === 2
    && /指不回至少 3 条真实记录/.test(proposed.data.dropped[0].reason));
  const candidate = proposed.data.agendas[0];
  check("留下的那条带着可核对的依据", candidate.basis.length === 3
    && candidate.basis.every((item) => ids.includes(item.id)));
  check("并且说得出覆盖了几个不同的用户问题", candidate.problemSpread === 3);
  check("提候选不建议程", workspace.contentBridge.agendas().length === 0);

  // ── 已有议程不要换个说法再提一遍 ────────────────────────────────
  const agendaId = workspace.contentBridge.createAgenda({
    title: "保留人的判断权",
    desiredJudgment: "把任务交给 AI 是效率，把判断交出去是失能。",
    actor: "user", confirmed: true, now,
  });
  check("用户确认之后才落库", Boolean(agendaId) && workspace.contentBridge.agendas().length === 1);
  const again = await call(base, "/api/workspace/agenda-candidates", { method: "POST" });
  check("已经定过的议程不会被再提一遍", !again.data.agendas.some((item) => item.title === "保留人的判断权"));

  // ── 看不出来时如实返回空数组 ────────────────────────────────────
  respond = () => ({ model: "test-agenda", data: { agendas: [], nothing_found_reason: "这些内容还没有指向同一条长期判断。" } });
  const nothing = await call(base, "/api/workspace/agenda-candidates", { method: "POST" });
  check("看不出来时返回空数组，不硬凑", nothing.data.agendas.length === 0);
  check("并且说得出为什么", /还没有指向同一条长期判断/.test(nothing.data.nothingFoundReason));

  const listed = await call(base, "/api/workspace/agenda-signals");
  check("接口能单独回答「现在够不够」", listed.data.ok === true && listed.data.ready === true
    && listed.data.threshold.opportunities === AGENDA_THRESHOLD.opportunities);

  console.log("\n长期议程候选验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
