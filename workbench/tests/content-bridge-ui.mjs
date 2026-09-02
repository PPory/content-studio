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

function strongCandidate({ dominantAction = "judgment", agendaId = "", wikiId, problemId, problemSource, freshness } = {}) {
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
        { id: "problem", type: "problem", label: "AI 使用中的判断依赖", source_kind: problemSource?.sourceKind || "audience_problem", source_id: problemSource?.sourceId || problemId },
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
      problemCandidate: payload.problemCandidate || null,
      agendaId: payload.agendaId || null,
    });
    /**
     * 还没入库的候选没有 audience_problem id，所以问题要素引用的是**那段原话**。
     * 这正是「发展这条不写库」在数据上的样子：证据是真的，问题还不是一条记录。
     */
    const problemSource = payload.problemCandidate
      ? { sourceKind: "feedback", sourceId: `raw:${payload.problemCandidate.evidence[0].rawSourceId}` }
      : { sourceKind: "audience_problem", sourceId: payload.audienceProblemId };
    const candidate = payload.wikiPageId === weakWiki.id || payload.audienceProblemId === weakProblemId
      ? weakCandidate({ wikiId: payload.wikiPageId, problemId: payload.audienceProblemId, freshness: context.freshness })
      : strongCandidate({ dominantAction: payload.dominantAction || "judgment", agendaId: payload.agendaId || "", wikiId: payload.wikiPageId, problemId: payload.audienceProblemId, problemSource, freshness: context.freshness });
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

  /**
   * ⚠️ **`#/bridge` 的第一屏是 AI 发现，不再是两栏选择器。**
   * 手动挑两个东西连起来没有删，它退到 `#/bridge/manual`——
   * 「我已经知道想连哪两个」是一条真实的路，只是不该是每天打开内容看到的第一件事。
   */
  await page.goto(`http://127.0.0.1:${PORT}/#/bridge`);
  await page.getByRole("heading", { name: "最近有什么值得讲", exact: true }).waitFor();
  check("内容首页问的是「最近有什么值得讲」，不是让人先挑两个东西",
    await page.locator(".bridge-picker").count() === 0
    && await page.getByRole("button", { name: /帮我看看最近有什么值得讲/ }).count() === 1);
  check("首页没有一排 Wiki / 问题筛选器",
    await page.locator(".bridge-side-list").count() === 0
    && await page.locator(".bridge-agenda-pick").count() === 0);
  check("手动探索仍然在，只是退成次级入口",
    await page.getByRole("button", { name: "手动探索" }).count() === 1);

  await page.getByRole("button", { name: "手动探索" }).click();
  await page.locator(".bridge-picker").waitFor();
  check("手动探索走 #/bridge/manual，老深链不受影响", page.url().endsWith("#/bridge/manual"));
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
  check("有结果时选择区收起，结果落在第一屏", await page.locator(".bridge-picker").count() === 0
    && (await page.locator(".bridge-bar__title").innerText()).includes("认知卸载")
    && resultTop < 500, `结果顶边 ${resultTop}px`);
  await page.getByRole("button", { name: "重新选择" }).click();
  check("重新选择把两栏放回来", await page.locator(".bridge-picker").count() === 1
    && await page.getByRole("button", { name: "选择知识：认知卸载", pressed: true }).count() === 1);
  await page.getByRole("button", { name: "收起选择" }).click();

  await page.getByRole("button", { name: "换一个大众入口" }).click();
  check("过大入口显示范围检查而不是标题党", (await page.locator(".bridge-storyline").innerText()).includes("范围过大")
    && (await page.locator(".bridge-storyline").innerText()).includes("无法证明所有人会彻底失去思考能力"));

  /**
   * ⚠️ **没有真实经历时，「经历型」这颗按钮根本不摆出来。**
   * 上一版摆着它、点下去跑一次模型、返回一份「如果你确实有……」的条件式候选——
   * 那是一份没有依据的空壳，用户读完选了它，写作时才发现没有故事可讲。
   */
  check("没有个人经历时不提供经历型这条路线",
    await page.getByRole("button", { name: "经历型" }).count() === 0
    && await page.getByRole("button", { name: "判断型" }).count() === 1);

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

  check("主动作只在顶栏出现一次，底部不重复", await page.getByRole("button", { name: "保存为内容机会", exact: true }).count() === 1);
  await page.getByRole("button", { name: "保存为内容机会" }).click();
  await page.getByText("内容机会已保存", { exact: true }).waitFor();
  const saved = workspace.db.prepare("SELECT id,agenda_id AS agendaId,dominant_action AS dominantAction FROM content_opportunities").get();
  // ⚠️ 这里是 judgment 而不是 experience：这个工作区一条个人经历都没有，
  // 经历型那条路线现在压根不摆出来，自然也存不进一条标着经历型的机会。
  check("用户确认后才把结构化机会写入 SQLite", Boolean(saved?.id) && saved.agendaId === agendaId && saved.dominantAction === "judgment");
  // 退回内容首页：已保存的机会现在长在 AI 发现下面的「进行中」里
  await page.getByRole("button", { name: "← 内容" }).click();
  await page.locator(".bridge-opp-list").waitFor();
  check("保存后回到内容首页，这一条在「进行中」里", (await page.locator(".bridge-opp-list").innerText()).includes("AI 正从信息工具进入人的判断链，关键不是少用，而是保留判断权。")
    && (await page.locator(".bridge-opp-list").innerText()).includes("认知卸载")
    && (await page.locator(".discovery-saved").innerText()).includes("进行中"));
  // 从首页点回这一条：这是真实回来的路径，同时验证已保存机会能被还原
  await page.locator(".bridge-opp-list button").first().click();
  await page.getByRole("heading", { name: "核心判断" }).waitFor();
  check("从概览点进去能还原已保存的机会", await page.getByRole("button", { name: "建立内容项目" }).count() === 1
    && (await page.locator(".bridge-bar__title").innerText()).includes("认知卸载"));

  if (process.argv.includes("--shots")) {
    await fs.mkdir(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, "content-bridge-desktop.png"), fullPage: true });
  }

  let outlineCalls = 0;
  let draftCalls = 0;
  await page.route("**/api/workspace/projects/*/outline", async (route) => {
    // ⚠️ 同一个地址上 GET 是「把存着的结构接回来」，POST 才是「搭一个」。
    // 不分的话，进页面读一次缓存就被算成跑了一次模型。
    if (route.request().method() !== "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, outline: null, markdown: "" }) });
    }
    outlineCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, candidateOnly: true, model: "test-project",
      outline: {
        sections: [
          { heading: "先承认：AI 确实该多用", purpose: "把最强的反方立起来。", uses: [{ id: "problem", label: "AI 使用中的判断依赖", typeLabel: "问题", origin: "用户原话" }], beats: [] },
          { heading: "它什么时候不成立", purpose: "用认知卸载指出被交出去的是判断。", uses: [{ id: "concept", label: "认知卸载", typeLabel: "概念", origin: "Wiki · 认知卸载" }], beats: [] },
        ],
        note: "按选定的讲法排的。",
        unused: [{ id: "claim", label: "保留人的判断权", typeLabel: "判断" }],
      },
      markdown: "## 先承认：AI 确实该多用\n\n> 把最强的反方立起来。\n\n## 它什么时候不成立\n\n> 用认知卸载指出被交出去的是判断。",
      context: { empty: true },
    }) });
  });
  await page.route("**/api/workspace/projects/*/draft-candidate", async (route) => {
    draftCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, candidateOnly: true, model: "test-project",
      title: "把判断留下来",
      body: "## 先承认：AI 确实该多用\n\n多数任务交出去是对的。\n\n## 它什么时候不成立\n\n认知卸载说明，被一起交出去的常常是判断。\n",
      note: "按结构写了两节。",
      context: { empty: true },
    }) });
  });

  await page.getByRole("button", { name: "建立内容项目" }).click();
  await page.getByRole("heading", { name: "写作前先守住这三件事" }).waitFor();
  const link = workspace.db.prepare("SELECT project_id AS projectId FROM content_project_opportunities WHERE opportunity_id=?").get(saved.id);

  /**
   * 13：建了项目之后的第一步。
   *
   * ⚠️ **不自动生成全文。** 一上来给一篇完整的稿，人会本能地去改它，
   * 而不是先想自己要讲什么；而那篇稿是照着「一般文章该怎么写」写的。
   */
  await page.getByRole("heading", { name: "先搭一个结构，再起稿" }).waitFor();
  const draftBytes = () => workspace.db.prepare("SELECT COALESCE(SUM(length(body_markdown)),0) AS size FROM drafts WHERE project_id=?").get(link.projectId).size;
  const emptyDraft = draftBytes();
  check("建了项目不自动起稿，正文还是空的", outlineCalls === 0 && draftCalls === 0 && emptyDraft === 0);
  check("这一步不问任何问题，继承来的意图是只读的",
    (await page.locator(".project-start__intent").innerText()).includes("AI 正从信息工具进入人的判断链")
    && await page.locator(".project-start input, .project-start textarea").count() === 0);

  await page.getByRole("button", { name: /帮我搭一个结构/ }).click();
  await page.locator(".project-start__outline").waitFor();
  check("结构候选每一节都说清作用和用哪条材料",
    (await page.locator(".project-start__outline").innerText()).includes("把最强的反方立起来")
    && (await page.locator(".project-start__outline").innerText()).includes("认知卸载（Wiki · 认知卸载）"));
  check("没被安排上的材料要说出来", (await page.locator(".project-start__unused").innerText()).includes("保留人的判断权"));
  check("搭结构不写正文", draftBytes() === emptyDraft);
  check("没有个人经历时说清这篇不会出现第一人称经历",
    (await page.locator(".project-start__gate").innerText()).includes("个人经历"));

  /**
   * ⚠️ 顶栏那颗「建立主稿」和这一栏的「照这个结构起稿」当时是并排两颗实心黑，
   * 而它们指向同一件事：开始写。这一栏亮着的时候，顶栏那颗退成次级。
   */
  check("开写前那一栏亮着时，一屏只有一颗主动作",
    await page.locator(".project-bar .btn-primary").count() === 0
    && await page.locator(".project-start .btn-primary").count() === 1
    && await page.getByRole("button", { name: "建立主稿" }).count() === 1);

  await page.getByRole("button", { name: "照这个结构起稿" }).click();
  await page.locator(".md-candidate-focus, .cm-content").first().waitFor();
  await page.waitForFunction(() => document.querySelector(".cm-content")?.innerText?.includes("认知卸载说明"), null, { timeout: 15_000 });
  check("起稿以候选形式进正文，等你逐处采纳", draftCalls === 1);
  check("起稿本身不写库，正文要等保存", draftBytes() === emptyDraft);
  if (process.argv.includes("--shots")) await page.screenshot({ path: path.join(shotDir, "project-start-draft.png"), fullPage: true });

  await page.reload();
  await page.getByRole("heading", { name: "写作前先守住这三件事" }).waitFor();
  check("没采纳就刷新，正文仍然是空的", draftBytes() === emptyDraft);
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

  await page.goto(`http://127.0.0.1:${PORT}/#/bridge/new`);
  await page.locator(".bridge-picker").waitFor();
  await page.getByRole("button", { name: "选择知识：CSS 网格布局" }).click();
  await page.getByRole("button", { name: "选择用户问题：如何判断退休账户风险？" }).click();
  await page.getByRole("button", { name: "看看怎么连接" }).click();
  await page.getByText("不建议硬做内容", { exact: true }).waitFor();
  check("无自然连接时明确建议更换，而不是硬生成文章", (await page.locator(".bridge-result").innerText()).includes("两者目前没有足够自然的连接"));
  // 系统说了不建议，主动作就不能还是「保存」——否则判断和引导互相矛盾。
  check("弱连接时主动作是换一个，保存退成次级", await page.getByRole("button", { name: "换一个知识或问题" }).count() === 1
    && await page.getByRole("button", { name: "仍然保存为内容机会" }).count() === 1
    && await page.getByRole("button", { name: "保存为内容机会", exact: true }).count() === 0);
  await page.getByRole("button", { name: "换一个知识或问题" }).click();
  check("换一个知识或问题把两栏放回来", await page.locator(".bridge-picker").count() === 1);

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
  await page.goto(`http://127.0.0.1:${PORT}/#/bridge/manual`);
  await page.reload();
  await page.locator(".bridge-picker").waitFor();
  check("议程入口长在问题库panel，不必先跑一次 Preview", await page.getByLabel("选择长期议程").count() === 1
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
  await page.getByRole("button", { name: "选择用户问题：哪些事情可以交给 AI，哪些必须自己判断？" }).waitFor();
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
  await page.goto(`http://127.0.0.1:${PORT}/#/bridge/new`);
  await page.locator(".bridge-picker").waitFor();
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
  check("Ctrl+K 空态就能看到记录用户原话", await page.getByText("记录一段用户原话", { exact: true }).count() === 1);
  await page.keyboard.press("Escape");

  /**
   * 10b：听到一句真实困惑，Ctrl+K 打进去就存下来，不用先走到内容机会页。
   *
   * ⚠️ **这一行原来直接建了一条 `origin=observed` 的用户问题**，并且把刚打的那行字
   * 同时当成「问题」和「逐字证据」。那条证据只是把 statement 复制了一遍，
   * 等于把人工记录写成观察。现在它只把**原话**收进不可变证据层，
   * 问题由 AI 之后从原话里读，而且读出来仍然只是候选。
   */
  const heard = "为什么我改完稿子反而更不确定了";
  const problemsBefore = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
  await page.keyboard.press("Control+K");
  await page.getByLabel("搜索").fill(heard);
  const captureRow = page.getByRole("button", { name: new RegExp(`记成用户原话：${heard}`) });
  await captureRow.waitFor();
  check("记下来这一行排在结果之后，不抢走 Enter", await page.locator(".cmdk__row").last().innerText().then((text) => text.includes("记成用户原话")));
  await captureRow.click();
  const voiceDialog = page.getByRole("dialog", { name: "记录用户声音" });
  await voiceDialog.waitFor();
  check("打进去的那句不用再打一遍", await voiceDialog.getByLabel("原话").inputValue() === heard);
  check("只要一个输入框，不问问题名称和为什么值得关注",
    await voiceDialog.getByLabel("为什么值得关注").count() === 0);

  const pasted = [
    "小林：AI 工具每周都在出新的，我到底该学哪个？",
    "阿泽：我也是，收藏夹里躺了二十个教程，一个都没打开。",
    "小林：感觉不学就落后，学了又用不上，挺焦虑的。",
  ].join("\n");
  await voiceDialog.getByLabel("原话").fill(pasted);
  check("按粘进来的样子先替你选了种类", await voiceDialog.getByRole("button", { name: "群聊", pressed: true }).count() === 1);
  await voiceDialog.getByRole("button", { name: "记下这段原话" }).click();
  await voiceDialog.getByText("已经记下来了").waitFor();

  const rawRow = workspace.db.prepare("SELECT kind, body FROM audience_raw_sources ORDER BY ingested_at DESC LIMIT 1").get();
  check("原话逐字进入不可变证据层", rawRow?.kind === "group_chat" && rawRow.body === pasted);
  check("记原话不再顺手伪造一条「观察到的」用户问题",
    workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count === problemsBefore);
  assert.throws(
    () => workspace.db.prepare("UPDATE audience_raw_sources SET body='改过的' WHERE id=(SELECT id FROM audience_raw_sources ORDER BY ingested_at DESC LIMIT 1)").run(),
    /不可变证据/,
  );
  check("存进去的原话在真实运行时也改不了", true);
  /**
   * ⚠️ **记完原话之后要有一条直路。**
   * 只靠 AI 发现的话，一次只给三五条连接；没被挑中的那些原话里的困惑
   * 就再也没有出口了。
   */
  let voiceProblemCalls = 0;
  await page.route("**/api/workspace/audience-voices/*/problem-candidates", async (route) => {
    voiceProblemCalls += 1;
    // ⚠️ 这段原话刚粘完，id 只有库里知道；不要引用后面才声明的变量。
    const justPasted = workspace.db.prepare("SELECT id FROM audience_raw_sources ORDER BY ingested_at DESC LIMIT 1").get();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, candidateOnly: true, model: "test-voice",
      problems: [{
        statement: "AI 工具这么多，我到底该按什么顺序学？",
        whyItMatters: "选择成本正在挤掉真正的学习时间。",
        pattern: "feedback",
        origin: "observed",
        sourceKind: "feedback",
        sources: [{ sourceKind: "feedback", sourceId: `raw:${justPasted.id}`, evidenceText: "感觉不学就落后，学了又用不上，挺焦虑的", observedAt: new Date().toISOString() }],
      }],
    }) });
  });

  const problemsBeforeVoice = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
  await voiceDialog.getByRole("button", { name: "从这段里读用户问题" }).click();
  await voiceDialog.locator(".voice-problem").first().waitFor();
  check("记完原话可以当场读出用户问题", voiceProblemCalls === 1);
  check("候选带着它的原话依据",
    (await voiceDialog.locator(".voice-problem").innerText()).includes("原话："));
  check("读问题本身不写库",
    workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count === problemsBeforeVoice);

  await voiceDialog.getByRole("button", { name: "完成" }).click();

  /**
   * 11：AI 发现的完整一轮。
   *
   * 上一段刚把一段真实群聊粘进了不可变证据层，这里验的就是这次重构的核心体感：
   * **不用先挑 Wiki、也不用先维护用户问题**，点一次就能拿到几条有理由、有原话的连接；
   * 「发展这条」仍然一个字都不写库，直到用户确认保存。
   */
  const rawVoice = workspace.db.prepare("SELECT id FROM audience_raw_sources ORDER BY ingested_at DESC LIMIT 1").get();
  const discoveryQuote = "AI 工具每周都在出新的，我到底该学哪个？";
  let scanCalls = 0;
  await page.route("**/api/workspace/content-discovery/scan", async (route) => {
    scanCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true,
      reused: false,
      stale: false,
      staleReason: "",
      scan: {
        scannedAt: new Date().toISOString(),
        model: "test-discovery",
        read: { wikiPages: 2, problems: 3, voices: 1, pendingVoices: 1, reusedVoices: 0, voiceChars: 120 },
        nothingFoundReason: "",
        missing: [],
        connections: [{
          problem: {
            existingProblemId: null,
            statement: "AI 工具每周都在出新的，我到底该学哪个？",
            whyItMatters: "选择成本正在挤掉真正的学习时间。",
            origin: "observed",
            originAgendaId: null,
            evidenceLabel: "1 段可逐字回溯的真实原话",
            evidence: [{ rawSourceId: rawVoice.id, quote: discoveryQuote, kind: "group_chat", kindLabel: "群聊", sourceName: "", observedAt: new Date().toISOString() }],
          },
          knowledgeAnchors: [{ wikiPageId: cognitiveWiki.id, title: "认知卸载", pageType: "concept", summary: "", reason: "这条知识把问题从「选哪个」改写成「什么该自己判断」。" }],
          fit: "strong",
          fitReason: "问题问的是工具选择，而这条知识给的是判断边界。",
          knowledgeExplanation: "认知卸载解释了人为什么倾向于把选择交出去。",
          coreClaim: "学 AI 不该从工具清单开始，而该从自己真正要解决的问题开始。",
          cognitiveGap: "大众把它当成工具选择题，其实是判断边界问题。",
          agendaSuggestion: { agendaId: null, agendaTitle: "", status: "none", reason: "" },
          evidenceGaps: ["还缺一个真实案例说明这个顺序确实更省时间。"],
        }],
      },
    }) });
  });

  /**
   * ⚠️ **扫描的输入之一要看得见。**
   * 不显示的话，用户会奇怪结果为什么偏向某个方向，也看不出系统把什么
   * 当成了「他最近在想的」——而这一段里**只有他自己打的字**。
   */
  const assistantClaim = "研究已经证明认知卸载会让人的判断力永久下降。";
  const conversationId = `chat-${Date.now()}`;
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id: conversationId, type: "ai_conversation" });
    workspace.db.prepare(`INSERT INTO ai_conversations(id,title,scope_type,scope_id,model,record_json,permission_mode,title_mode)
      VALUES (?,?,'global','01TESTSCOPE0000000000000AA','test',?,'daily','auto')`)
      .run(conversationId, "认知卸载和判断权", JSON.stringify({
        id: conversationId,
        messages: [
          { role: "user", text: "我最近一直在想，AI 越用越顺之后，人是不是把判断也一起交出去了。" },
          { role: "assistant", text: assistantClaim },
        ],
      }));
  });

  await page.goto(`http://127.0.0.1:${PORT}/#/bridge`);
  await page.getByRole("heading", { name: "最近有什么值得讲", exact: true }).waitFor();
  await page.getByRole("button", { name: /最近你在助手里想的/ }).click();
  const researchText = await page.locator(".discovery-research").innerText();
  check("最近在助手里想的东西摆出来了，扫描会参考它",
    researchText.includes("认知卸载和判断权") && researchText.includes("把判断也一起交出去"));
  /**
   * ⚠️ 这一条是 P6 的关键：AI 说过的话不能出现在这里，也不能进事实层。
   * 它看起来和事实一模一样，而且往往写得比事实更顺。
   */
  check("AI 说过的话一个字都没出现", !researchText.includes("研究已经证明"));
  check("并且当面说清它为什么不能当证据",
    (await page.locator(".discovery-research__gate").innerText()).includes("不算事实"));

  /**
   * ⚠️ **长期议程是观察出来的，不是填出来的。**
   * 数据不够时这一栏要说的是「还差多少」——带数字，因为「还差 3 条」
   * 是一件能完成的事，「数据不足」不是。这也是这个工作区此刻的真实状态。
   */
  const agendaText = await page.locator(".discovery-agenda").innerText();
  check("还看不出长期议程时如实说，而不是画一个候选",
    agendaText.includes("还看不出一条长期议程"));
  check("还差多少带着数字", /再攒 \d+ 条内容机会/.test(agendaText));
  check("并且指出手工那条路一直在",
    await page.locator(".discovery-agenda").getByRole("button", { name: "自己写一条" }).count() === 1);
  check("不够的时候不给「看看有没有」那颗按钮",
    await page.getByRole("button", { name: /看看有没有一条长期议程/ }).count() === 0);


  const problemsBeforeDiscovery = workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count;
  await page.goto(`http://127.0.0.1:${PORT}/#/bridge`);
  await page.getByRole("heading", { name: "最近有什么值得讲", exact: true }).waitFor();
  check("进页面不自动烧模型", scanCalls === 0);
  await page.getByRole("button", { name: /帮我看看最近有什么值得讲/ }).click();
  await page.locator(".discovery-card").first().waitFor();

  const cardText = await page.locator(".discovery-card").first().innerText();
  check("卡片说清谁在困惑什么、用我的什么知识、可能留下什么判断",
    cardText.includes("AI 工具每周都在出新的") && cardText.includes("认知卸载")
    && cardText.includes("学 AI 不该从工具清单开始"));
  check("证据说的是「可逐字回溯的真实原话」，不是笼统的「N 条反馈」",
    cardText.includes("1 段可逐字回溯的真实原话"));
  check("不显示分数、热度或爆款概率",
    !/\d+\s*分|热度|爆款/.test(cardText) && cardText.includes("很自然"));
  await page.getByRole("button", { name: "看原话" }).click();
  check("原话可以当场展开核对", (await page.locator(".discovery-quotes").innerText()).includes(discoveryQuote));
  check("扫描一条业务数据都没写",
    workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count === problemsBeforeDiscovery
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count === 1);

  /**
   * 12：构造工作台。
   *
   * ⚠️ **「发展这条」的落点不再是那份完整分析。** 完整分析回答的是「这条能不能连」，
   * 而这一步要回答的是「这件事可以怎么讲」——它有好几个答案，而上一版只给一个。
   */
  const constructionFreshness = () => buildContentBridgeContext(workspace, {
    wikiPageId: cognitiveWiki.id,
    problemCandidate: {
      statement: "AI 工具每周都在出新的，我到底该学哪个？",
      summary: "选择成本正在挤掉真正的学习时间。",
      origin: "observed",
      evidence: [{ rawSourceId: rawVoice.id, quote: discoveryQuote }],
    },
    includeExperiences: true,
    scope: "workspace",
  }).freshness;

  const elementsA = [
    { id: "p", type: "problem", label: "该学哪个工具", source_kind: "feedback", source_id: `raw:${rawVoice.id}`, role: "现实入口" },
    { id: "m", type: "concept", label: "认知卸载", source_kind: "wiki_page", source_id: cognitiveWiki.id, role: "解释为什么会外包判断" },
    { id: "j", type: "judgment", label: "先定任务再挑工具" },
  ];
  // ⚠️ B 用的是**另一页 Wiki**：锚点只是入口，这一条正是要证明构造能跳出锚点。
  const elementsB = [
    { id: "k", type: "concept", label: "CSS 网格布局", source_kind: "wiki_page", source_id: weakWiki.id, role: "举一个表层技能的例子" },
    { id: "a", type: "concept", label: "认知卸载", source_kind: "wiki_page", source_id: cognitiveWiki.id, role: "给出判断标准" },
    { id: "j2", type: "judgment", label: "标准而不是禁令" },
  ];
  const routeA = {
    id: "A", label: "从工具焦虑进入", dominantAction: "knowledge",
    entry: "AI 工具这么多，我到底该学哪个？",
    storyline: "从工具焦虑进入 → 用认知卸载解释判断为什么被外包 → 给出学习顺序。",
    keyRelation: "先解释机制，再把机制变成可执行的顺序。",
    risk: "容易讲成一篇知识科普，读完没有下一步。",
    coreClaim: "工具焦虑的根源是把判断权连同任务一起交了出去。",
    knowledgeExplanation: "认知卸载说明人会把认知任务交给工具。",
    cognitiveGap: "大众以为要追上每一个工具。",
    supportingElements: elementsA.map((item) => ({ id: item.id, type: item.type, label: item.label, sourceKind: item.source_kind || "", sourceId: item.source_id || "", role: item.role || "" })),
    evidenceGaps: ["还缺一个跨工具迁移同一套流程的实测。"],
    counterarguments: [{ claim: "有些新工具确实值得早追。", response: "那也该由任务决定。" }],
    construction: {
      route: { id: "A", storyline: "从工具焦虑进入 → 用认知卸载解释判断为什么被外包 → 给出学习顺序。", key_relation: "先解释机制，再把机制变成可执行的顺序。", risk: "容易讲成一篇知识科普，读完没有下一步。" },
      elements: elementsA.map(({ role, ...rest }) => ({ ...rest, source_kind: rest.source_kind || "", source_id: rest.source_id || "" })),
      relations: [{ from: "p", to: "m", type: "problem_to_mechanism", explanation: "用认知卸载解释焦虑从哪来。" }],
      entry_options: [{ text: "AI 工具这么多，我到底该学哪个？", scope_check: { status: "supported", reason: "正文能回答。" } }],
      evidence_gaps: [{ claim: "还缺一个跨工具迁移同一套流程的实测。", needed: "", source_refs: [] }],
      counterarguments: [{ claim: "有些新工具确实值得早追。", response: "那也该由任务决定。" }],
    },
  };
  const routeB = {
    ...routeA,
    id: "B", label: "从反方进入", dominantAction: "judgment",
    entry: "追新工具真的错了吗？",
    storyline: "先承认追新有回报 → 指出它什么时候不成立 → 给出判断标准。",
    risk: "承认反方之后，容易收不回来。",
    coreClaim: "追新工具不总是错的，错的是没有一个决定什么时候追的标准。",
    supportingElements: elementsB.map((item) => ({ id: item.id, type: item.type, label: item.label, sourceKind: item.source_kind || "", sourceId: item.source_id || "", role: item.role || "" })),
    construction: {
      route: { id: "B", storyline: "先承认追新有回报 → 指出它什么时候不成立 → 给出判断标准。", key_relation: "用反方逼出一个标准。", risk: "承认反方之后，容易收不回来。" },
      elements: elementsB.map(({ role, ...rest }) => ({ ...rest, source_kind: rest.source_kind || "", source_id: rest.source_id || "" })),
      relations: [{ from: "k", to: "a", type: "challenge", explanation: "反方逼出一个标准。" }],
      entry_options: [{ text: "追新工具真的错了吗？", scope_check: { status: "supported", reason: "正文能回答。" } }],
      evidence_gaps: [{ claim: "还缺一个跨工具迁移同一套流程的实测。", needed: "", source_refs: [] }],
      counterarguments: [{ claim: "有些新工具确实值得早追。", response: "那也该由任务决定。" }],
    },
  };

  let routeCalls = 0;
  let refineCalls = 0;
  await page.route("**/api/workspace/content-construction/routes", async (route) => {
    routeCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, candidateOnly: true, routes: [routeA, routeB], droppedAsSame: 1, note: "",
      experienceAvailable: false, poolSize: { wikiPages: 2, materials: 0, experiences: 0, cards: 0, pastClaims: 1 },
      freshness: constructionFreshness(), model: "test-construction",
    }) });
  });
  await page.route("**/api/workspace/content-construction/refine", async (route) => {
    refineCalls += 1;
    const payload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, candidateOnly: true,
      route: { ...payload.route, coreClaim: "在多数任务上，先定清楚任务比先挑工具更省时间。" },
      note: "把结论从「根源是」收成了「在多数任务上」，入口和材料没动。",
      experienceAvailable: false, freshness: constructionFreshness(), model: "test-construction",
    }) });
  });

  await page.getByRole("button", { name: "发展这条" }).click();
  await page.getByRole("heading", { name: /Xenho 找到 \d+ 种讲法/ }).waitFor();
  check("发展这条进的是构造工作台，不是那份完整分析", routeCalls === 1
    && await page.getByRole("heading", { name: "核心判断" }).count() === 0);
  check("发展这条仍然不写库",
    workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count === problemsBeforeDiscovery);

  const cardsText = await page.locator(".route-card").allInnerTexts();
  check("给的是两条讲法，不是一个答案", cardsText.length === 2);
  check("两条的主导动作、入口和判断都不一样",
    cardsText[0].includes("知识型") && cardsText[1].includes("判断型")
    && cardsText[0].includes("工具焦虑的根源") && cardsText[1].includes("追新工具不总是错的"));
  check("每条都写明用了哪些材料、为什么这样组织、最容易出什么问题",
    cardsText[0].includes("用到的材料") && cardsText[0].includes("为什么这样组织") && cardsText[0].includes("这条最容易出的问题"));
  check("第二条用上了锚点以外的知识", cardsText[1].includes("CSS 网格布局"));
  check("重复的那条被去掉了，并且说了出来",
    (await page.locator(".construction-routes__head").innerText()).includes("1 条和上面重复"));
  check("没有个人经历时说清经历型这条路线为什么不在",
    (await page.locator(".construction-note--gate").innerText()).includes("个人经历"));

  await page.locator(".route-card").nth(1).getByRole("button", { name: "沿这个继续" }).click();
  await page.locator(".construction-ask").waitFor();
  check("选定之后只留当前这条，其他退成次级",
    await page.locator(".route-card").count() === 1
    && await page.getByRole("button", { name: /另外 1 种讲法/ }).count() === 1);

  await page.getByLabel("跟 Xenho 说").fill("结论太绝对了，收一点");
  await page.getByRole("button", { name: "继续推" }).click();
  await page.getByText("在多数任务上，先定清楚任务比先挑工具更省时间。").waitFor();
  check("一句话就能继续推这条讲法", refineCalls === 1);
  check("只改被要求的那部分，入口没动",
    (await page.locator(".route-card").innerText()).includes("追新工具真的错了吗？"));
  check("改过什么留在页面上", (await page.locator(".construction-history").innerText()).includes("结论太绝对了"));
  check("继续推同样不写库",
    workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count === problemsBeforeDiscovery);

  // 完整分析没有删，只是退成了次级入口。
  await page.getByRole("button", { name: "查看完整分析" }).click();
  await page.getByRole("heading", { name: "核心判断" }).waitFor();
  check("完整分析仍然可达，只是不再是默认", page.url().endsWith("#/bridge/analyze"));
  await page.goBack();
  await page.locator(".construction-ask").waitFor();
  check("从完整分析回来，这条讲法还在", (await page.locator(".route-card").innerText()).includes("在多数任务上"));

  await page.getByRole("button", { name: "保存为内容机会" }).click();
  await page.getByText("内容机会已保存", { exact: true }).waitFor();
  const fromDiscovery = workspace.db.prepare(`SELECT p.origin, s.source_id AS sourceId, s.evidence_text AS quote
    FROM audience_problems p JOIN audience_problem_sources s ON s.problem_id = p.id
    WHERE p.statement = ?`).get("AI 工具每周都在出新的，我到底该学哪个？");
  check("确认保存那一刻，用户问题和它的原话才第一次入库",
    workspace.db.prepare("SELECT COUNT(*) AS count FROM audience_problems").get().count === problemsBeforeDiscovery + 1
    && fromDiscovery.origin === "observed"
    && fromDiscovery.sourceId === `raw:${rawVoice.id}`
    && fromDiscovery.quote === discoveryQuote);
  const savedConstruction = JSON.parse(workspace.db.prepare(`SELECT construction_json AS json FROM content_opportunities
    ORDER BY created_at DESC LIMIT 1`).get().json);
  check("选中的那条讲法本身也存了下来，写作时还知道为什么这样排",
    savedConstruction.route?.storyline?.includes("先承认追新有回报")
    && Boolean(savedConstruction.route.risk));
  check("跨来源的要素完整保留，不只有锚点那一页",
    savedConstruction.elements.some((item) => item.source_id === weakWiki.id)
    && savedConstruction.elements.some((item) => item.source_id === cognitiveWiki.id));

  /**
   * 14：实验 AI。
   *
   * ⚠️ **这两处原来都是空白输入框。** 真实库里那条唯一结算过的实验，
   * 「发生了什么」写的是「数据比之前好点」——那句话没有任何人能复核，
   * 而它当时被记在了「观察」的位置上。
   */
  let hypothesisCalls = 0;
  let settlementCalls = 0;
  await page.route("**/api/workspace/projects/*/hypothesis-candidates", async (route) => {
    hypothesisCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, candidateOnly: true, model: "test-experiment",
      hypotheses: [
        { hypothesis: "用真实问题当入口，会比直接讲概念更容易被收藏。", why: "这一篇最大的策略变化就是问题入口。", signal: "收藏高于同平台中位数算成立；持平或更低算不成立。" },
        { hypothesis: "先承认反方再给标准，会更少引来抬杠。", why: "这条讲法把反方放在最前面。", signal: "评论里讨论标准而非否定立场的比例上升算成立。" },
      ],
    }) });
  });
  await page.route("**/api/workspace/experiments/*/settlement-preview", async (route) => {
    settlementCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, candidateOnly: true, model: "test-experiment",
      evidence: { hasEvidence: true },
      observations: [
        { text: "收藏 61，高于同平台过去 3 篇的中位数 19。", basisKind: "metric", metric: "collects", metricLabel: "收藏", value: 61, baseline: 19 },
        { text: "有读者说这篇让他想清楚了先定任务再挑工具。", basisKind: "feedback", quote: "这篇让我第一次想清楚该先定任务再挑工具。" },
      ],
      inferences: ["问题入口可能确实比概念入口更容易被收藏。", "读者普遍觉得这篇更实用。"],
      demoted: [{ text: "读者普遍觉得这篇更实用。", reason: "这句原话在反馈里逐字找不到" }],
      verdict: "supported",
      verdictReason: "收藏显著高于中位数，且有原话指向判断被接受。",
      learningCandidate: "下一篇继续用真实问题当入口，并在开头就把标准点出来。",
      nextExperiment: "验证把标准提到前三段会不会进一步提高收藏。",
      note: "",
      missing: [],
    }) });
  });

  /**
   * ⚠️ 假设那一栏长在**待发布**那一屏的右栏里——它要写在发布之前，
   * 所以它挨着发布动作，而不是正文上方。先把这个项目推到待发布。
   */
  // ⚠️ 用项目已有的主稿，不要另建一篇：`project_primary_drafts` 是 INSERT OR IGNORE，
  // 新建的那篇不会成为主稿，项目也就永远到不了「待发布」。
  const experimentDraft = workspace.db.prepare("SELECT draft_id AS id FROM project_primary_drafts WHERE project_id=?").get(link.projectId).id;
  workspace.domain.saveDraftRelease(experimentDraft, {
    title: "判断权", bodyMarkdown: "# 判断权' + BS + 'n' + BS + 'n正文足够长，可以进入待发布。", summary: "摘要",
    actor: "user", confirmed: true,
  });
  workspace.domain.transitionDraft(experimentDraft, "finish-writing", { actor: "user", confirmed: true });

  await page.goto(`http://127.0.0.1:${PORT}/#/project/${link.projectId}`);
  await page.getByRole("heading", { name: "这一篇在验证什么" }).waitFor({ timeout: 30_000 });
  check("发布前不再从空白框开始，先问「这一篇最值得验证什么」",
    await page.getByRole("button", { name: "这一篇最值得验证什么？" }).count() === 1
    && await page.getByRole("button", { name: "自己写一条" }).count() === 1
    && await page.locator(".experiment-record textarea").count() === 0);

  await page.getByRole("button", { name: "这一篇最值得验证什么？" }).click();
  await page.locator(".experiment-candidates article").first().waitFor();
  check("给了几条可以被否掉的假设", hypothesisCalls === 1
    && await page.locator(".experiment-candidates article").count() === 2);
  check("每条都说清怎么算成立",
    (await page.locator(".experiment-candidates").innerText()).includes("怎么算成立"));

  const experimentsBefore = workspace.db.prepare("SELECT COUNT(*) AS count FROM content_experiments").get().count;
  check("提候选不建实验", experimentsBefore === 0);
  await page.locator(".experiment-candidates article").first().getByRole("button", { name: "就验证这条" }).click();
  await page.getByText("用真实问题当入口，会比直接讲概念更容易被收藏。").first().waitFor();
  const recorded = workspace.db.prepare("SELECT id, hypothesis_markdown AS hypothesis, verdict FROM content_experiments").get();
  check("确认之后才记下这条假设", recorded?.verdict === "open"
    && recorded.hypothesis.includes("用真实问题当入口"));

  console.log(" ·  实验 AI 的结算预览需要一条发布记录，这里只验到假设那一步");

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
