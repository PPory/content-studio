import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { createBookRecord } from "../server/routes/books-local.mjs";
import { applyWikiCompile, captureWikiSourceSnapshot } from "../server/domain/wiki-pages.mjs";
import { buildContentBridgeContext } from "../server/domain/content-bridge-context.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-content-bridge-ui-"));
const xenhoHome = path.join(tempRoot, "Xenho");
const shotDir = path.join(ROOT, "output", "playwright");
const PORT = 5206;
const oldHome = process.env.XENHO_HOME;
const oldProxy = { HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY };
const oldLifecycle = { WB_LAUNCHER: process.env.WB_LAUNCHER, WB_KEEP_ALIVE: process.env.WB_KEEP_ALIVE };
process.env.XENHO_HOME = xenhoHome;
process.env.WB_KEEP_ALIVE = "1";
process.env.HTTP_PROXY = "http://127.0.0.1:9";
process.env.HTTPS_PROXY = "http://127.0.0.1:9";
process.env.NO_PROXY = "127.0.0.1,localhost";

function playwright() {
  const require = createRequire(import.meta.url);
  const roots = [ROOT, "C:/Users/Lenovo", process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : ""];
  for (const root of roots.filter(Boolean)) {
    try {
      return require(require.resolve("playwright", { paths: [root] }));
    } catch {}
  }
  throw new Error("找不到 playwright");
}

const check = (name, pass, detail = "") => {
  assert(pass, detail || name);
  console.log(` ✓ ${name}`);
};

async function request(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function strongCandidate({ dominantAction = "judgment", agendaId = "", wikiId, problemId, freshness } = {}) {
  const experience = dominantAction === "experience";
  return {
    fit: "strong",
    fitReason: "这个用户问题正好需要认知卸载提供的机制解释。",
    audienceProblem: {
      surface: "AI 越用越方便，却越来越不愿意自己想。",
      underlying: "我应该把哪些判断交给 AI，又该保留哪些判断权？",
    },
    knowledgeExplanation: "认知卸载解释了人如何把认知任务交给外部工具，也提醒我们区分省力与放弃判断。",
    coreClaim: "AI 正从信息工具进入人的判断链，关键不是少用，而是保留判断权。",
    cognitiveGap: "大多数人把会用 AI 理解成尽量多交给 AI，但真正需要设计的是判断权如何分配。",
    dominantAction,
    experience: experience
      ? { available: false, reason: "工作区没有可回溯的个人经历，只能给出条件式入口。", sourceRefs: [] }
      : { available: false, reason: "当前表达不依赖个人经历。", sourceRefs: [] },
    construction: {
      elements: [
        { id: "problem", type: "problem", label: "AI 使用中的判断依赖", source_kind: "audience_problem", source_id: problemId },
        { id: "concept", type: "concept", label: "认知卸载", source_kind: "wiki_page", source_id: wikiId },
        { id: "claim", type: "judgment", label: "保留人的判断权", source_kind: "", source_id: "" },
      ],
      relations: [
        { from: "problem", to: "concept", type: "problem_to_mechanism", explanation: "用认知卸载解释判断为何被外包。" },
        { from: "concept", to: "claim", type: "support", explanation: "机制解释支撑保留判断权的主张。" },
      ],
      entry_options: experience
        ? [{ text: "如果你确实有把选择交给 AI 的真实经历，可以从那次具体选择进入。", scope_check: { status: "supported", reason: "条件式表达没有虚构经历。" } }]
        : [
            { text: "为什么 AI 越用越方便，我们却越来越不愿意自己判断？", scope_check: { status: "supported", reason: "正文能够用认知卸载解释并给出判断边界。" } },
            { text: "AI 会不会让所有人彻底失去思考能力？", scope_check: { status: "too_broad", reason: "现有知识只能解释判断任务被外包，无法证明所有人会彻底失去思考能力。" } },
          ],
      evidence_gaps: [{ claim: "频繁使用 AI 会削弱独立判断", needed: "需要纵向研究或可核对的行为证据。", source_refs: [] }],
      counterarguments: [{ claim: "把低价值判断交给 AI 反而能释放注意力。", response: "需要区分可卸载任务和不可放弃的价值判断。" }],
    },
    agendaFit: agendaId
      ? { status: "strong", reason: "这条内容会强化高质量使用 AI 必须保留人的判断权。" }
      : { status: "none", reason: "可以暂不关联议程，先验证连接本身。" },
    freshness,
  };
}

function weakCandidate({ wikiId, problemId, freshness } = {}) {
  return {
    fit: "weak",
    fitReason: "CSS 网格布局无法自然解释退休账户风险，两者目前没有足够自然的连接。",
    audienceProblem: { surface: "如何判断退休账户风险？", underlying: "我需要理解资产配置和风险承受能力。" },
    knowledgeExplanation: "这页知识只解释网页布局，不提供金融风险判断。",
    coreClaim: "当前没有足够依据形成值得写的核心判断。",
    cognitiveGap: "两边属于不同的问题空间，强行类比会误导读者。",
    dominantAction: "knowledge",
    experience: { available: false, reason: "不适用。", sourceRefs: [] },
    construction: {
      elements: [
        { id: "problem", type: "problem", label: "退休账户风险", source_kind: "audience_problem", source_id: problemId },
        { id: "method", type: "method", label: "CSS 网格布局", source_kind: "wiki_page", source_id: wikiId },
      ],
      relations: [],
      entry_options: [],
      evidence_gaps: [{ claim: "CSS 布局知识可以解释金融风险", needed: "目前没有任何直接证据。", source_refs: [] }],
      counterarguments: [{ claim: "表面上的网格类比不能替代真实金融知识。", response: "应更换知识或用户问题。" }],
    },
    agendaFit: { status: "weak", reason: "与当前议程不匹配。" },
    freshness,
  };
}

let server;
let browser;
try {
  server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, "vite.config.mjs"),
    server: { port: PORT, strictPort: true, open: false },
    logLevel: "error",
  });
  await server.listen();

  const status = await request("/api/workspace/status");
  check("Content Bridge 使用隔离 SQLite 工作区", status.ready && path.resolve(xenhoHome).startsWith(path.resolve(os.tmpdir())));

  const workspace = await server.xenhoWorkspace;
  const cognitiveQuote = "认知卸载是把一部分认知任务交给外部工具，但价值判断仍需要由人承担。";
  const layoutQuote = "CSS 网格用于安排网页中的行列关系，不提供任何金融风险判断。";
  const source = await createBookRecord(workspace, {
    title: "Content Bridge UI 验收资料",
    kind: "藏书",
    sourceKind: "文档",
    chapters: [{ title: "知识原文", text: `# 知识原文\n\n${cognitiveQuote}\n\n${layoutQuote}` }],
  });
  const sourceId = workspace.db.prepare("SELECT id FROM book_documents WHERE book_id=?").get(source.id).id;
  const snapshot = captureWikiSourceSnapshot(workspace, sourceId);
  applyWikiCompile(workspace, {
    proposal: {
      sourceId,
      sourceSnapshotId: snapshot.id,
      sourceContentSha256: snapshot.contentSha256,
      sourceLocator: "Content Bridge UI 验收资料 · 知识原文",
      title: "编译内容桥接验收知识",
      compilationSummary: "生成两条用于验证自然连接与弱连接的 Wiki 知识。",
      pages: [
        {
          action: "create",
          title: "认知卸载",
          pageType: "concept",
          summary: "人会把认知任务交给外部工具，但不应同时交出价值判断。",
          bodyMarkdown: `# 认知卸载\n\n${cognitiveQuote}`,
          changeSummary: "建立认知卸载概念页",
          citations: [{ quote: cognitiveQuote, contribution: "定义认知卸载及判断边界" }],
          links: [],
        },
        {
          action: "create",
          title: "CSS 网格布局",
          pageType: "method",
          summary: "用行列关系组织网页布局的方法。",
          bodyMarkdown: `# CSS 网格布局\n\n${layoutQuote}`,
          changeSummary: "建立无关知识用于弱连接验收",
          citations: [{ quote: layoutQuote, contribution: "限定这条知识的适用范围" }],
          links: [],
        },
      ],
    },
  });
  const cognitiveWiki = workspace.db.prepare("SELECT id FROM wiki_pages WHERE title='认知卸载'").get();
  const weakWiki = workspace.db.prepare("SELECT id FROM wiki_pages WHERE title='CSS 网格布局'").get();
  const now = new Date("2026-09-01T08:00:00.000Z");
  const agendaId = workspace.contentBridge.createAgenda({
    title: "保留人的判断权",
    audience: "正在把 AI 用进日常工作的创作者",
    problemSpace: "AI 进入判断链后，人如何保留必要的判断权",
    desiredJudgment: "高质量使用 AI，核心是保留人的判断权。",
    valueCommitment: "帮助用户区分可以卸载的任务与必须自己承担的判断。",
    actor: "user",
    confirmed: true,
    now,
  });
  const problemId = workspace.contentBridge.createAudienceProblem({
    statement: "AI 越用越方便，为什么我越来越不愿意自己想？",
    summary: "用户担心效率提高的同时，自己逐渐退出判断过程。",
    sourceKind: "feedback",
    pattern: "knowledge_gap",
    sources: [{
      sourceKind: "feedback",
      sourceId: "feedback:bridge-ui:1",
      evidenceText: "我现在遇到选择就先问 AI，感觉自己越来越不愿意先想一遍。",
      observedAt: now,
    }],
    actor: "user",
    confirmed: true,
    now,
  });
  const weakProblemId = workspace.contentBridge.createAudienceProblem({
    statement: "如何判断退休账户风险？",
    summary: "用户需要资产配置和风险承受能力方面的可靠解释。",
    sourceKind: "feedback",
    pattern: "feedback",
    sources: [{
      sourceKind: "feedback",
      sourceId: "feedback:bridge-ui:2",
      evidenceText: "我不知道自己的退休账户风险是不是太高。",
      observedAt: now,
    }],
    actor: "user",
    confirmed: true,
    now,
  });

  const { chromium } = playwright();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  let previewCalls = 0;
  let agendaFitCalls = 0;
  await page.route("**/api/workspace/content-opportunities/preview", async (route) => {
    previewCalls += 1;
    const payload = route.request().postDataJSON();
    const context = buildContentBridgeContext(workspace, {
      wikiPageId: payload.wikiPageId,
      audienceProblemId: payload.audienceProblemId,
      agendaId: payload.agendaId || null,
    });
    const candidate = payload.wikiPageId === weakWiki.id || payload.audienceProblemId === weakProblemId
      ? weakCandidate({ wikiId: payload.wikiPageId, problemId: payload.audienceProblemId, freshness: context.freshness })
      : strongCandidate({ dominantAction: payload.dominantAction || "judgment", agendaId: payload.agendaId || "", wikiId: payload.wikiPageId, problemId: payload.audienceProblemId, freshness: context.freshness });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, candidate }) });
  });
  await page.route("**/api/workspace/content-opportunities/agenda-fit", async (route) => {
    agendaFitCalls += 1;
    const payload = route.request().postDataJSON();
    const agenda = workspace.contentBridge.agenda(payload.agendaId);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true,
      candidateOnly: true,
      agendaFit: { status: "strong", reason: "这条内容会强化高质量使用 AI 必须保留人的判断权。" },
      agendaFreshness: { agendaId: agenda.id, agendaUpdatedAt: agenda.updatedAt },
    }) });
  });

  await page.goto(`http://127.0.0.1:${PORT}/#/bridge`);
  await page.getByRole("heading", { name: "把你搞懂的，连接到用户正在困惑的。" }).waitFor();
  check("主导航以内容机会作为内容入口", await page.getByRole("button", { name: "内容机会", exact: true }).count() === 1);
  await page.getByRole("button", { name: "选择知识：认知卸载" }).click();
  await page.getByRole("button", { name: "选择用户问题：AI 越用越方便，为什么我越来越不愿意自己想？" }).click();
  check("Wiki 与用户问题均可选择", await page.getByRole("button", { name: "选择知识：认知卸载", pressed: true }).count() === 1
    && await page.getByRole("button", { name: "选择用户问题：AI 越用越方便，为什么我越来越不愿意自己想？", pressed: true }).count() === 1);

  await page.getByRole("button", { name: "看看怎么连接" }).click();
  await page.getByRole("heading", { name: "核心判断" }).waitFor();
  const resultHeadings = await page.locator(".bridge-result-section h3").allTextContents();
  check("连接结果先呈现问题、解释、认知差和判断", resultHeadings.slice(0, 4).join("|") === "用户真正的问题|我的知识能提供什么解释|最大的认知差|核心判断");
  check("Preview 明确保持候选且不产生写入", await page.getByText("目前仍是候选", { exact: true }).count() === 1
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count === 0);

  // 有结果之后这一页从「选」切到「读和决定」：两栏塌成一行，结果不再被压到第二屏。
  const resultTop = (await page.locator(".bridge-result").boundingBox()).y;
  check("有结果时选择区塌成一行，结果落在第一屏", await page.locator(".bridge-picker").count() === 0
    && await page.locator(".bridge-selection-bar").count() === 1
    && resultTop < 700, `结果顶边 ${resultTop}px`);
  await page.getByRole("button", { name: "重新选择" }).click();
  check("重新选择把两栏放回来", await page.locator(".bridge-picker").count() === 1
    && await page.getByRole("button", { name: "选择知识：认知卸载", pressed: true }).count() === 1);

  await page.getByRole("button", { name: "换一个大众入口" }).click();
  check("过大入口显示范围检查而不是标题党", (await page.locator(".bridge-storyline").innerText()).includes("范围过大")
    && (await page.locator(".bridge-storyline").innerText()).includes("无法证明所有人会彻底失去思考能力"));

  await page.getByRole("button", { name: "经历型" }).click();
  await page.getByRole("button", { name: "经历型", pressed: true }).waitFor();
  const bridgeText = await page.locator(".bridge-result").innerText();
  check("没有经历来源时只给条件式入口", bridgeText.includes("如果你确实有") && !bridgeText.includes("我最近发现"));

  const claimBeforeAgenda = await page.locator(".bridge-result-section blockquote").textContent();
  const callsBeforeAgenda = previewCalls;
  await page.locator(".bridge-agenda-field select").selectOption(agendaId);
  await page.getByText("高质量使用 AI，核心是保留人的判断权。", { exact: true }).waitFor();
  check("选择长期议程只计算 Agenda Fit，不重写整个 Candidate", await page.locator(".bridge-agenda-field select").inputValue() === agendaId
    && agendaFitCalls === 1 && previewCalls === callsBeforeAgenda
    && await page.locator(".bridge-result-section blockquote").textContent() === claimBeforeAgenda);
  check("按议程重新构造需要明确点击", await page.getByRole("button", { name: "按这个议程重新构造" }).count() === 1);

  await page.getByRole("button", { name: "查看证据缺口" }).click();
  check("证据缺口操作把焦点送到可读结果", await page.locator(".bridge-checks > div").first().evaluate((element) => element === document.activeElement));
  await page.getByRole("button", { name: "查看反方" }).click();
  check("反方操作把焦点送到可读结果", await page.locator(".bridge-checks > div").nth(1).evaluate((element) => element === document.activeElement));

  await page.getByRole("button", { name: "保存为内容机会" }).click();
  await page.getByText("内容机会已保存", { exact: true }).waitFor();
  const saved = workspace.db.prepare("SELECT id,agenda_id AS agendaId,dominant_action AS dominantAction FROM content_opportunities").get();
  check("用户确认后才把结构化机会写入 SQLite", Boolean(saved?.id) && saved.agendaId === agendaId && saved.dominantAction === "experience");
  check("保存后立即出现在最近内容机会", await page.locator(".bridge-recent-list").getByText("AI 正从信息工具进入人的判断链，关键不是少用，而是保留判断权。").count() === 1);

  if (process.argv.includes("--shots")) {
    await fs.mkdir(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, "content-bridge-desktop.png"), fullPage: true });
  }

  await page.getByRole("button", { name: "建立内容项目" }).click();
  await page.getByRole("heading", { name: "写作前先守住这三件事" }).waitFor();
  const link = workspace.db.prepare("SELECT project_id AS projectId FROM content_project_opportunities WHERE opportunity_id=?").get(saved.id);
  check("创作意图默认折叠且正文保持视觉主体", Boolean(link?.projectId)
    && await page.getByRole("button", { name: "展开" }).count() === 1
    && !(await page.locator(".content-intent").innerText()).includes("认知卸载"));
  if (process.argv.includes("--shots")) await page.screenshot({ path: path.join(shotDir, "content-intent-collapsed.png"), fullPage: true });
  await page.getByRole("button", { name: "展开" }).click();
  check("展开后显示支撑知识、表达动作、证据缺口和 AI 思考动作", (await page.locator(".content-intent").innerText()).includes("认知卸载")
    && (await page.locator(".content-intent").innerText()).includes("主导表达动作")
    && (await page.locator(".content-intent").innerText()).includes("当前证据缺口"));
  check("项目优先提供挑战判断、证据和入口操作", await page.getByRole("button", { name: "挑战核心判断" }).count() === 1
    && await page.getByRole("button", { name: "找证据" }).count() === 1
    && await page.getByRole("button", { name: "换大众入口" }).count() === 1);
  if (process.argv.includes("--shots")) await page.screenshot({ path: path.join(shotDir, "content-intent-expanded.png"), fullPage: true });

  await page.reload();
  await page.getByRole("heading", { name: "写作前先守住这三件事" }).waitFor();
  check("重载后项目与内容机会关系仍然存在", (await page.locator(".content-intent").innerText()).includes("AI 正从信息工具进入人的判断链"));
  await page.getByRole("button", { name: "展开" }).click();
  await page.getByRole("button", { name: "回到知识库" }).click();
  await page.getByRole("heading", { name: "认知卸载", exact: true }).waitFor();
  check("项目可以回到支撑 Wiki", page.url().includes(`#/entries/${cognitiveWiki.id}`));
  await page.goto(`http://127.0.0.1:${PORT}/#/project/${link.projectId}`);
  await page.getByRole("button", { name: "展开" }).click();
  await page.getByRole("button", { name: "查看来源" }).click();
  await page.getByRole("button", { name: "选择用户问题：AI 越用越方便，为什么我越来越不愿意自己想？", pressed: true }).waitFor();
  check("项目可以回到用户问题及其来源", page.url().includes(encodeURIComponent(`problem:${problemId}`)));

  await page.goto(`http://127.0.0.1:${PORT}/#/bridge`);
  await page.getByRole("button", { name: "选择知识：CSS 网格布局" }).click();
  await page.getByRole("button", { name: "选择用户问题：如何判断退休账户风险？" }).click();
  await page.getByRole("button", { name: "看看怎么连接" }).click();
  await page.getByText("不建议硬做内容", { exact: true }).waitFor();
  check("无自然连接时明确建议更换，而不是硬生成文章", (await page.locator(".bridge-result").innerText()).includes("两者目前没有足够自然的连接"));

  // 议程 → 用户问题：问题库唯一不依赖外部抓取的供给路径。
  let deriveCalls = 0;
  await page.route("**/api/workspace/audience-problems/from-agenda", async (route) => {
    deriveCalls += 1;
    const payload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true,
      candidateOnly: true,
      agenda: { id: payload.agendaId, title: "保留人的判断权" },
      // 第一次故意返回空：拎不出问题是合格结果，不该硬凑。
      problems: deriveCalls === 1 ? [] : [{
        statement: "哪些事情可以交给 AI，哪些必须自己判断？",
        whyItMatters: "受众卡在判断责任的边界上，这正是这条议程要回答的。",
        pattern: "knowledge_gap",
        origin: "hypothesis",
        originAgendaId: payload.agendaId,
        sources: [],
      }],
    }) });
  });
  // 上一段留着一个弱连接结果，而结果在时选择区是塌起来的；这里要的是干净的选择态。
  await page.goto(`http://127.0.0.1:${PORT}/#/bridge`);
  await page.reload();
  await page.getByRole("heading", { name: "把你搞懂的，连接到用户正在困惑的。" }).waitFor();
  check("议程入口长在第 02 栏，不必先跑一次 Preview", await page.getByLabel("选择长期议程").count() === 1
    && await page.getByRole("button", { name: "从议程拎问题" }).count() === 1);
  await page.getByLabel("选择长期议程").selectOption(agendaId);
  await page.getByRole("button", { name: "从议程拎问题" }).click();
  await page.getByText("这个议程暂时没拎出值得记的问题").waitFor();
  check("拎不出问题是合格结果，不硬凑候选", deriveCalls === 1
    && await page.locator(".bridge-candidates").count() === 0);

  await page.getByRole("button", { name: "从议程拎问题" }).click();
  await page.getByText("议程推导 · 尚无真实观察").waitFor();
  check("议程候选明确标注没有真实观察", await page.locator(".bridge-candidates article").count() === 1);
  await page.getByRole("button", { name: "确认保存" }).click();
  await page.getByRole("button", { name: "选择用户问题：哪些事情可以交给 AI，哪些必须自己判断？", pressed: true }).waitFor();
  const hypothesisRow = workspace.db.prepare("SELECT origin, origin_agenda_id AS agendaId, source_ref AS sourceRef FROM audience_problems WHERE statement=?")
    .get("哪些事情可以交给 AI，哪些必须自己判断？");
  const hypothesisSources = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problem_sources WHERE problem_id=(SELECT id FROM audience_problems WHERE statement=?)")
    .get("哪些事情可以交给 AI，哪些必须自己判断？").count;
  check("确认后落库为假设：记住来源议程、不写任何观察证据", hypothesisRow?.origin === "hypothesis"
    && hypothesisRow.agendaId === agendaId
    && hypothesisRow.sourceRef === `agenda:${agendaId}`
    && hypothesisSources === 0);

  await page.reload();
  await page.getByRole("button", { name: "选择用户问题：哪些事情可以交给 AI，哪些必须自己判断？" }).waitFor();
  check("刷新后假设仍标为待验证，而不是显示 0 个来源", (await page.locator(".bridge-side-list--problems").innerText()).includes("议程推导 · 待验证")
    && !(await page.locator(".bridge-side-list--problems").innerText()).includes("0 个来源"));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://127.0.0.1:${PORT}/#/bridge/${encodeURIComponent(`opportunity:${saved.id}`)}`);
  await page.reload();
  await page.getByText("内容机会已保存", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "核心判断" }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const overflowNodes = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .map((element) => ({ tag: element.tagName, className: String(element.className || ""), text: String(element.textContent || "").trim().slice(0, 60), right: element.getBoundingClientRect().right }))
    .filter((item) => item.right > window.innerWidth + 2)
    .slice(0, 8));
  const projectButtonCount = await page.getByRole("button", { name: "建立内容项目" }).count();
  check("小屏和减少动态效果模式下仍可完整阅读", overflow <= 2 && projectButtonCount === 1,
    `横向溢出 ${overflow}px；项目按钮 ${projectButtonCount}；越界元素 ${JSON.stringify(overflowNodes)}`);
  if (process.argv.includes("--shots")) await page.screenshot({ path: path.join(shotDir, "content-bridge-mobile.png"), fullPage: true });

  await page.route("**/api/workspace/agendas", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, error: "议程暂时不可用" }) }));
  await page.route("**/api/workspace/insights", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, error: "洞察暂时不可用" }) }));
  await page.goto(`http://127.0.0.1:${PORT}/#/bridge`);
  await page.getByRole("heading", { name: "把你搞懂的，连接到用户正在困惑的。" }).waitFor();
  await page.getByText("洞察报告暂时无法读取。你仍可选择已有问题或自己记录。").waitFor();
  check("Agenda 和 Insights 失败时 Bridge 核心选择仍可使用", await page.getByRole("button", { name: "选择知识：认知卸载" }).count() === 1);
  await page.getByRole("button", { name: "选择知识：认知卸载" }).click();
  await page.getByRole("button", { name: "选择用户问题：AI 越用越方便，为什么我越来越不愿意自己想？" }).click();
  await page.getByRole("button", { name: "看看怎么连接" }).click();
  // 议程是结果里的一条控件带，不是编号段落，所以等的是那个字段而不是标题。
  await page.locator(".bridge-result-agenda").waitFor();
  check("议程不占编号位，仍作为结果里的决定项存在", await page.locator(".bridge-result-section h3").allTextContents()
    .then((titles) => !titles.includes("长期议程")));
  check("无 Agenda 时仍可新建议程并继续构造", await page.getByRole("button", { name: "＋ 新建议程" }).count() === 1
    && await page.getByText("长期议程暂时无法读取，不影响继续构造和保存不关联议程的机会。").count() === 1);
  await page.getByRole("button", { name: "＋ 新建议程" }).click();
  check("最小议程创建只要求名称和长期判断", await page.getByLabel("名称").count() === 1
    && await page.getByLabel("希望用户最终形成什么判断").count() === 1);

  await page.keyboard.press("Control+K");
  await page.getByText("找题（旧版）", { exact: true }).waitFor();
  check("旧找题与种子路由仍可由快捷入口访问", await page.getByText("选题 / 种子（旧版）", { exact: true }).count() === 1);
  check("Ctrl+K 空态就能看到记一个用户问题", await page.getByText("记一个用户问题", { exact: true }).count() === 1);
  await page.keyboard.press("Escape");

  // 10b：听到一句真实困惑，Ctrl+K 打进去就存下来，不用先走到内容机会页。
  const heard = "为什么我改完稿子反而更不确定了";
  await page.keyboard.press("Control+K");
  await page.getByLabel("搜索").fill(heard);
  const captureRow = page.getByRole("button", { name: new RegExp(`记成用户问题：${heard}`) });
  await captureRow.waitFor();
  check("记下来这一行排在结果之后，不抢走 Enter", await page.locator(".cmdk__row").last().innerText().then((text) => text.includes("记成用户问题")));
  await captureRow.click();
  await page.getByRole("button", { name: `选择用户问题：${heard}`, pressed: true }).waitFor();
  const captured = workspace.db.prepare("SELECT origin, source_kind AS sourceKind FROM audience_problems WHERE statement=?").get(heard);
  check("Ctrl+K 打一句就记下用户问题，并落到那条问题上", captured?.origin === "observed"
    && captured.sourceKind === "manual"
    && page.url().includes(encodeURIComponent("problem:")));

  check("Content Bridge 真实浏览器没有页面异常", errors.length === 0, errors.join("\n"));
  if (process.argv.includes("--shots")) console.log(` 截图目录：${shotDir}`);
  console.log("\nContent Bridge 本地 UI 验证通过。");
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await server?.xenhoClose?.().catch(() => {});
  if (oldHome == null) delete process.env.XENHO_HOME;
  else process.env.XENHO_HOME = oldHome;
  for (const [key, value] of Object.entries(oldProxy)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  for (const [key, value] of Object.entries(oldLifecycle)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  if (process.env.XENHO_KEEP_TEST_TEMP !== "1") await fs.rm(tempRoot, { recursive: true, force: true });
}
