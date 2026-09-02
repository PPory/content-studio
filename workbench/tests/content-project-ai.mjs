// 项目 AI：继承内容机会与讲法、先结构后起稿、不自动生成全文、第一人称硬闸。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import { describeCreativeContext, projectCreativeContext } from "../server/domain/content-project.mjs";
import { outlineToMarkdown } from "../server/domain/content-project-ai.mjs";
import { buildContentBridgeContext } from "../server/domain/content-bridge-context.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-content-project-ai-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-02T08:00:00.000Z");
let workspace;
let server;
let respond = null;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

const QUOTE = "AI 工具一周出三个，我到底该学哪个";

function wikiPage(title, summary) {
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
    async CONTENT_PROJECT_COMPLETE_JSON() {
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

  const anchorWiki = wikiPage("真实问题驱动学习", "从自己真正要解决的问题倒推该学什么。");
  const layerWiki = wikiPage("三层模型", "交互层变得最快，结构层和动力层相对稳定。");
  const caseId = workspace.domain.createMaterial({
    title: "两周只学一个工具的对照",
    type: "案例/故事",
    bodyMarkdown: "同一个任务，一组先挑工具、一组先写清任务，后者两周内完成。",
    actor: "user",
    now,
  });
  const voice = workspace.audienceRaw.record({
    kind: "group_chat",
    body: `阿泽：${QUOTE}\n小林：收藏夹里躺了二十个教程`,
    sourceName: "读者群",
    actor: "user",
    confirmed: true,
    now,
  });
  const agendaId = workspace.contentBridge.createAgenda({
    title: "创作困境有机制",
    desiredJudgment: "看起来像天赋问题的卡点多数有可解释的机制。",
    actor: "user", confirmed: true, now,
  });

  const construction = {
    route: {
      id: "B",
      storyline: "先承认追新有回报 → 指出它什么时候不成立 → 给出判断标准。",
      key_relation: "用反方逼出一个标准。",
      risk: "承认反方之后容易收不回来。",
    },
    elements: [
      { id: "p", type: "problem", label: "该学哪个工具", source_kind: "feedback", source_id: `raw:${voice.id}` },
      { id: "m", type: "concept", label: "三层模型", source_kind: "wiki_page", source_id: layerWiki },
      { id: "c", type: "case", label: "两周只学一个工具的对照", source_kind: "material", source_id: caseId },
      { id: "j", type: "judgment", label: "先定任务再挑工具" },
    ],
    relations: [{ from: "p", to: "m", type: "problem_to_mechanism", explanation: "用三层模型解释焦虑从哪来。" }],
    entry_options: [{ text: "追新工具真的错了吗？", scope_check: { status: "supported", reason: "正文能回答。" } }],
    evidence_gaps: [{ claim: "还缺一个跨工具迁移的实测。", needed: "", source_refs: [] }],
    counterarguments: [{ claim: "有些新工具确实值得早追。", response: "那也该由任务决定。" }],
  };

  const opportunityId = workspace.contentBridge.saveOpportunity({
    wikiPageId: anchorWiki,
    problemCandidate: {
      statement: "AI 工具一周出三个，我到底该学哪个？",
      summary: "选择成本正在挤掉学习时间。",
      origin: "observed",
      evidence: [{ rawSourceId: voice.id, quote: QUOTE }],
    },
    agendaId,
    coreClaim: "追新工具不总是错的，错的是没有一个决定什么时候追的标准。",
    knowledgeExplanation: "三层模型说明交互层变得最快。",
    cognitiveGap: "大众把它当成工具选择题。",
    dominantAction: "judgment",
    fit: "strong",
    fitReason: "问题问的是选择，知识给的是标准。",
    construction,
    freshness: buildContentBridgeContext(workspace, {
      wikiPageId: anchorWiki,
      problemCandidate: {
        statement: "AI 工具一周出三个，我到底该学哪个？",
        summary: "选择成本正在挤掉学习时间。",
        origin: "observed",
        evidence: [{ rawSourceId: voice.id, quote: QUOTE }],
      },
      agendaId,
      includeExperiences: true,
      scope: "workspace",
    }).freshness,
    actor: "user",
    confirmed: true,
    now,
  });

  console.log(" ✓ 前置：内容机会已保存");
  const projectId = workspace.contentBridge.createProjectFromOpportunity(opportunityId, { actor: "user", confirmed: true, now });

  // ── 继承：项目 AI 不该再问一遍用户想干什么 ────────────────────────
  const context = projectCreativeContext(workspace, projectId);
  check("项目自动继承用户问题、核心判断和议程", context.problem.statement.includes("我到底该学哪个")
    && context.opportunity.coreClaim.includes("没有一个决定什么时候追的标准")
    && context.agenda.title === "创作困境有机制");
  check("选定的讲法跟着项目走", context.route.storyline.includes("先承认追新有回报"));
  check("要素被还原成真实正文，不只有标签",
    context.elements.find((item) => item.id === "m").body.includes("交互层变得最快")
    && context.elements.find((item) => item.id === "c").body.includes("先写清任务"));
  check("出处跟着每条材料", context.elements.find((item) => item.id === "c").origin.includes("素材 · 案例/故事"));
  check("没有个人经历时如实为空", context.experiences.length === 0);
  check("正文还空着", context.empty === true);

  const described = describeCreativeContext(context);
  check("给模型的继承说明带上逐字原话", described.includes(QUOTE));
  check("并且明确禁止编造第一人称经历", /一条都没有.*不得写任何第一人称经历/s.test(described));
  check("已知的证据缺口写明不要假装有", described.includes("不要假装有") && described.includes("跨工具迁移"));
  // ⚠️ 真实跑第一轮时这份清单没有 id，模型只能猜，于是每一节都「不引材料」。
  check("材料清单带上 id，模型才引用得了", described.includes("id=m｜[概念] 三层模型"));

  const base = await start();

  // ── 结构候选 ──────────────────────────────────────────────────────
  respond = () => ({
    model: "test-project",
    data: {
      sections: [
        { heading: "先承认：追新工具确实有回报", purpose: "把最强的反方立起来，避免读者一开始就觉得被说教。", uses: ["p"], beats: ["读者群里的原话", "为什么这种焦虑是合理的"] },
        { heading: "它什么时候不成立", purpose: "用三层模型指出被追的是最容易过时的那一层。", uses: ["m"] },
        { heading: "一个真实对照", purpose: "把机制落到一次具体的任务上。", uses: ["c", "notarealelement"] },
        { heading: "所以标准是什么", purpose: "给出决定什么时候该追的判断。", uses: ["j"] },
      ],
      note: "按选定的讲法排的：反方 → 机制 → 对照 → 标准。",
    },
  });

  const draftBytes = () => workspace.db.prepare("SELECT COALESCE(SUM(length(body_markdown)),0) AS size FROM drafts WHERE project_id=?").get(projectId).size;
  const before = draftBytes();
  const outlineResult = await call(base, `/api/workspace/projects/${projectId}/outline`, { method: "POST" });
  check("搭结构成功", outlineResult.data.ok === true && outlineResult.data.outline.sections.length === 4);
  check("每一节都说清承担什么作用", outlineResult.data.outline.sections.every((section) => Boolean(section.purpose)));
  check("每一节说清用哪几条材料，并带着出处",
    outlineResult.data.outline.sections[1].uses[0].label === "三层模型"
    && outlineResult.data.outline.sections[1].uses[0].origin.startsWith("Wiki"));
  check("认不出的材料引用被丢掉，结构本身留下", outlineResult.data.outline.sections[2].uses.length === 1);

  // 模型回填标题而不是 id 时也要认——两边都是这次真给过它的东西。
  respond = () => ({
    model: "test-project",
    data: { sections: [{ heading: "一节", purpose: "用标题回填引用。", uses: ["三层模型", "两周只学一个工具的对照"] }], note: "" },
  });
  const byLabel = await call(base, `/api/workspace/projects/${projectId}/outline`, { method: "POST" });
  check("模型用标题回填引用时也能对上，不会整节变成「不引材料」",
    byLabel.data.outline.sections[0].uses.length === 2
    && byLabel.data.outline.sections[0].uses[0].label === "三层模型");
  check("搭结构不写正文", draftBytes() === before);
  check("结构可以直接落成 Markdown", outlineResult.data.markdown.includes("## 先承认：追新工具确实有回报"));

  // ── 起稿必须先有结构 ──────────────────────────────────────────────
  const noOutline = await call(base, `/api/workspace/projects/${projectId}/draft-candidate`, { method: "POST", body: {} });
  check("没有结构不给起稿", noOutline.status === 400 && /先搭一个结构/.test(noOutline.data.error));
  check("并说清为什么", /一般文章/.test(noOutline.data.hint || ""));

  respond = () => ({
    model: "test-project",
    data: {
      title: "追新工具不是错，没有标准才是",
      body_markdown: "## 先承认：追新工具确实有回报\n\n读者群里有人说：「AI 工具一周出三个，我到底该学哪个」。\n\n## 它什么时候不成立\n\n三层模型指出，交互层变得最快。\n\n## 一个真实对照\n\n同一个任务，一组先挑工具、一组先写清任务。\n\n## 所以标准是什么\n\n【待补：跨工具迁移的实测】\n",
      note: "按结构写了四节，缺证据的地方留了待补标记。",
    },
  });
  const draftResult = await call(base, `/api/workspace/projects/${projectId}/draft-candidate`, {
    method: "POST",
    body: { outline: outlineResult.data.outline },
  });
  check("有结构之后可以起稿", draftResult.data.ok === true && draftResult.data.body.includes("## 一个真实对照"));
  check("起稿同样不写正文", draftBytes() === before);
  check("缺证据的地方留下待补标记，不编", draftResult.data.body.includes("【待补："));

  // ── 第一人称硬闸 ──────────────────────────────────────────────────
  respond = () => ({
    model: "test-project",
    data: {
      title: "编的",
      body_markdown: "## 先承认\n\n我去年带的那个项目，前几天我和一个同事聊天，他说追工具追到崩溃。\n",
      note: "",
    },
  });
  const fabricated = await call(base, `/api/workspace/projects/${projectId}/draft-candidate`, {
    method: "POST",
    body: { outline: outlineResult.data.outline },
  });
  check("没有个人经历素材时，编出来的第一人称叙事被拒绝", fabricated.status === 422
    && /个人经历/.test(fabricated.data.error));
  check("并且告诉用户下一步该做什么", /补一条真实经历|个人经历.*素材/.test(fabricated.data.hint || ""));
  check("被拒绝时正文一个字都没动", draftBytes() === before);

  respond = () => ({
    model: "test-project",
    data: { sections: [{ heading: "从我那次踩坑讲起", purpose: "用我去年带项目的经历开场。", uses: [] }], note: "" },
  });
  const fabricatedOutline = await call(base, `/api/workspace/projects/${projectId}/outline`, { method: "POST" });
  check("结构里安排一段没有依据的经历，同样被拒绝", fabricatedOutline.status === 422);

  // 有了真实经历之后，同一段叙事就能通过——闸门挡的是没依据，不是第一人称本身。
  workspace.domain.createMaterial({
    title: "去年带项目追工具的经历",
    type: "个人经历",
    bodyMarkdown: "我去年带的那个项目，前几天我和一个同事聊天，他说追工具追到崩溃。",
    actor: "user",
    now,
  });
  respond = () => ({
    model: "test-project",
    data: {
      title: "有依据的经历",
      body_markdown: "## 先承认\n\n我去年带的那个项目，前几天我和一个同事聊天，他说追工具追到崩溃。\n",
      note: "",
    },
  });
  const grounded = await call(base, `/api/workspace/projects/${projectId}/draft-candidate`, {
    method: "POST",
    body: { outline: outlineResult.data.outline },
  });
  check("有真实经历素材撑着的同一段叙事可以通过", grounded.data.ok === true);

  // ── 没有内容机会的老项目 ──────────────────────────────────────────
  const loneProject = workspace.domain.createProject({
    title: "没有内容机会的老项目",
    briefMarkdown: "手动建的",
    actor: "user",
    confirmed: true,
    now,
  });
  const lone = await call(base, `/api/workspace/projects/${loneProject}/creative-context`);
  check("没有关联内容机会时如实说不知道，并给出下一步", lone.status === 409
    && /没有关联的内容机会/.test(lone.data.error)
    && /发展一条连接/.test(lone.data.hint || ""));

  check("结构转 Markdown 带上每节的作用", outlineToMarkdown(outlineResult.data.outline).includes("> 把最强的反方立起来"));

  console.log("\n项目 AI 验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
