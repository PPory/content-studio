/** AI 协作的真实浏览器闭环：推动、梳理和候选写作都必须由用户明确采用。 */
import { createServer } from "vite";
import { createRequire } from "node:module";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STAGE6_SHOT_DIR = path.join(ROOT, "tmp", "stage6-production");
await fs.mkdir(STAGE6_SHOT_DIR, { recursive: true });
const PORT = 5202;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const roots = [ROOT, "C:/Users/Lenovo", process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : ""];
  for (const root of roots.filter(Boolean)) {
    try { return require(require.resolve("playwright", { paths: [root] })); } catch { /* 下一处 */ }
  }
  throw new Error("找不到 playwright");
}

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, "vite.config.mjs"),
  server: { port: PORT, strictPort: true, open: false },
  logLevel: "error",
});
await server.listen();

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error" && !/Failed to load resource/i.test(message.text())) errors.push(message.text());
});

let nudges = 0;
const requests = [];
const brainstormRequests = [];
const revisionRequests = [];
const styleSaves = [];
const expertStarts = [];
const assistantRequests = [];
let assistantMessages = [];
let assistantAttachments = [];
let assistantActions = [];
const assistantModelItems = [
  { id: "claude-sonnet-4-6", name: "claude-sonnet-4-6", ownedBy: "anthropic" },
  { id: "test-model", name: "测试模型", ownedBy: "Pi" },
  ...Array.from({ length: 10 }, (_, index) => ({ id: `test-model-${index + 2}`, name: `测试模型 ${index + 2}`, ownedBy: index % 2 ? "antigravity" : "openai" })),
];
let assistantConversationItems = [{ id: "chat-recent", title: "最近对话", preview: "继续讨论工作台", updatedAt: "2026-08-25T08:00:00.000Z", messageCount: 2, pinnedAt: "", archivedAt: "" }, { id: "chat-archived", title: "归档对话", preview: "已经整理完成", updatedAt: "2026-08-24T08:00:00.000Z", messageCount: 2, pinnedAt: "", archivedAt: "2026-08-25T09:00:00.000Z" }];
const expertRunStore = new Map();
const revisionDocuments = new Map();
const profileFixture = {
  ok: true,
  profile: { audience: "独立创作者", platform: "公众号", styleId: "clear-direct" },
  styles: [
    { id: "clear-direct", name: "清晰克制", description: "把判断和依据说清楚", enabled: true, instructions: "一句只承担一个意思。", defaultInstructions: "一句只承担一个意思。" },
    { id: "personal-insight", name: "个人思考", description: "从真实经历出发", enabled: true, instructions: "只使用真实经历。", defaultInstructions: "只使用真实经历。" },
    { id: "story-led", name: "故事推进", description: "用场景推进观点", enabled: true, instructions: "从真实场景进入。", defaultInstructions: "从真实场景进入。" },
    { id: "practical-guide", name: "实用拆解", description: "给出可执行动作", enabled: true, instructions: "把问题拆成少量步骤。", defaultInstructions: "把问题拆成少量步骤。" },
    { id: "sharp-opinion", name: "鲜明观点", description: "立场明确但有边界", enabled: true, instructions: "尽早亮出判断。", defaultInstructions: "尽早亮出判断。" },
    { id: "my-style", name: "我的风格", description: "由旧文校准出的个人表达画像", enabled: true, instructions: "保留个人判断和自然停顿。", defaultInstructions: "保留个人判断和自然停顿。" },
  ],
  experts: [
    { id: "topic-editor", name: "选题顾问", enabled: true, instructions: "只在找题和选题工作。" },
    { id: "writing-coach", name: "写作教练", enabled: true, instructions: "提供写作候选。" },
    { id: "material-researcher", name: "素材顾问", enabled: true, instructions: "检查素材缺口。" },
    { id: "quality-reviewer", name: "审稿顾问", enabled: true, instructions: "检查结构逻辑。" },
    { id: "style-coach", name: "风格顾问", enabled: true, instructions: "调整表达风格。" },
    { id: "fact-checker", name: "事实核查", enabled: true, instructions: "证据不足标待核。" },
  ],
  style: { id: "clear-direct", name: "清晰克制", instructions: "一句只承担一个意思。" },
};
await page.route("**/api/writing-profile", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profileFixture) }));
await page.route("**/api/writing-style", (route) => {
  const body = route.request().postDataJSON();
  styleSaves.push(body);
  const styles = profileFixture.styles.map((item) => item.id === body.id ? { ...item, instructions: body.instructions, customized: body.instructions !== item.defaultInstructions } : item);
  profileFixture.styles = styles;
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...profileFixture, styles }) });
});
await page.route("**/api/ai/knowledge-card", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ ok: true, card: { title: "收藏焦虑", conclusion: "收藏不能替代消化。", explanation: "需要把信息转成自己的判断。", evidence: "收藏处理的是焦虑。", boundaries: "", questions: "", personalUnderstanding: "", tags: ["内容创作"], evidenceStatus: "有原文支撑" } }),
}));
await page.route("**/api/vault/knowledge-card", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, card: { path: "99 - 个人工作台/06 - 知识卡片/收藏焦虑.md" } }) }));

await page.route("**/api/expert-runs**", (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[2];
  if (request.method() === "POST" && parts[3] === "cancel") {
    const run = { ...expertRunStore.get(id), status: "cancelled", stageLabel: "已中止" };
    expertRunStore.set(id, run);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, run }) });
  }
  if (request.method() === "POST" && parts.length === 2) {
    const input = request.postDataJSON();
    expertStarts.push(input);
    const kind = input.kind;
    const report = kind === "material-research" ? {
      kind,
      summary: "有一个关键观点仍缺公开数据，但本地知识卡已经提供了可用案例。",
      claims: [{ quote: "收藏处理的是焦虑", need: "数据与真实案例", gap: "仍缺一份近年的公开调查", localSources: [{ title: "本地知识卡", path: "知识库/收藏心理.md", excerpt: "收藏行为常被用来缓解错过信息的焦虑。" }], webSources: [{ title: "权威网页来源", url: "https://example.com/research", excerpt: "公开调查样本说明。" }] }],
      nextSteps: ["确认调查年份与样本范围"],
    } : kind === "quality-review" ? {
      kind,
      summary: "核心判断明确，但读者真实困境还需再具体一步。",
      strengths: [{ quote: "收藏处理的是焦虑", reason: "一句话抓住了核心矛盾。" }],
      questions: Array.from({ length: 9 }, (_, index) => ({ id: `q${index + 1}`, status: index < 6 ? "pass" : index < 8 ? "warn" : "fail", finding: `品控问题 ${index + 1}`, location: index < 6 ? "" : "第 1 段", direction: index < 6 ? "保留" : "补一处具体情境" })),
      mustFix: ["补充一个读者当下会遇到的具体场景"],
    } : {
      kind,
      summary: "共提取一项可核查表述，目前证据不足。",
      claims: [{ quote: "增长 30%", location: "第二段", status: "unsupported", risk: "缺少统计口径", suggestion: "补充来源和年份", localSources: [], webSources: [{ title: "公开数据页", url: "https://example.com/data", excerpt: "需核对统计口径。" }] }],
      nextSteps: ["确认原始数据表"],
    };
    const materialAttempt = expertStarts.filter((item) => item.kind === "material-research").length;
    const run = { id: `expert-test-${expertStarts.length}`, kind, status: "running", stageLabel: "专家正在研究并交叉核对", percent: 34, localSourceCount: 1, pendingReport: report, polls: 0, failAfterPoll: kind === "material-research" && materialAttempt === 1 };
    expertRunStore.set(run.id, run);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, run }) });
  }
  if (request.method() === "GET" && id) {
    const run = expertRunStore.get(id);
    if (run?.status === "running") {
      run.polls += 1;
      if (run.polls >= 2) Object.assign(run, run.failAfterPoll
        ? { status: "failed", stageLabel: "检查未完成", error: "专家模型连接失败", hint: "已读取配置，请确认本机代理正在运行。" }
        : { status: "done", stageLabel: "检查完成", percent: 100, report: run.pendingReport });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, run }) });
  }
  for (const run of expertRunStore.values()) {
    if (run.status !== "running") continue;
    run.polls += 1;
    if (run.polls >= 2) Object.assign(run, run.failAfterPoll
      ? { status: "failed", stageLabel: "检查未完成", error: "专家模型连接失败", hint: "已读取配置，请确认本机代理正在运行。" }
      : { status: "done", stageLabel: "检查完成", percent: 100, report: run.pendingReport });
  }
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, runs: [...expertRunStore.values()].reverse() }) });
});
await page.route("**/api/pipe/writing-assist", async (route) => {
  const body = route.request().postDataJSON();
  requests.push(body);
  if (body.mode === "nudge") {
    nudges += 1;
    await new Promise((resolve) => setTimeout(resolve, 260));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, mode: "nudge", kind: nudges === 1 ? "问题" : "新角度", text: nudges === 1 ? "你真正改变看法的那个瞬间是什么？" : "如果从读者最可能反对的地方往回写呢？" }),
    });
  }
  const reviews = {
    "material-audit": ["素材查缺", "已有依据：项目素材。\n仍缺什么：关键数据。\n下一步去哪找：素材库检索‘真实使用数据’。"],
    "quality-review": ["审稿报告", "值得保留：核心判断明确。\n需要调整：读者困境还不够具体。"],
    "fact-check": ["事实核查", "原表述：增长 30%。\n状态：待核。\n建议：补充来源。"],
  };
  if (reviews[body.mode]) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: body.mode, kind: reviews[body.mode][0], text: reviews[body.mode][1] }) });
  }
  const text = body.mode === "finish"
    ? Array.from({ length: 18 }, (_, index) => `第 ${index + 1} 步，把判断落到一个具体选择上。真正的结束不是再总结一次，而是让读者知道明天可以少做什么。`).join("\n\n")
    : "这不是缺少更多方法，而是还没有把眼前的矛盾说透。先把最不愿承认的那个代价写下来，下一步往往就会自己出现。";
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: body.mode, kind: body.mode === "finish" ? "完成全文" : "续写一段", text }) });
});
await page.route("**/api/agent/chat", async (route) => {
  const body = route.request().postDataJSON();
  brainstormRequests.push(body);
  const text = body.phase === "summary"
    ? "## 核心判断\n收藏处理的是焦虑，不是内容。\n\n## 可用经历或例子\n一次收藏后再也没打开。\n\n## 可能展开的要点\n用复述代替收藏。\n\n## 仍待回答的问题\n哪次真正改变了习惯？"
    : "最近一次你点完收藏、却再也没有打开，具体是什么内容？";
  return route.fulfill({
    status: 200,
    contentType: "text/plain; charset=utf-8",
    headers: { "x-session-id": "12345678-1234-1234-1234-123456789abc" },
    body: text,
  });
});
await page.route("**/api/pipe/text-revision", async (route) => {
  const body = route.request().postDataJSON();
  revisionRequests.push(body);
  const rejected = body.instruction?.includes("真实性拒绝");
  const text = rejected ? "这段不应进入可采纳状态。" : revisionRequests.length === 1
    ? "第一版候选：把最重要的判断说清楚，再删掉不服务于这个判断的句子。"
    : "第二版候选：先说清最重要的判断，再删掉无关句子。";
  const grounding = rejected ? {
    used: [], skipped: [], unverified: [{ quote: "我亲历了这件事", why: "服务端没有找到个人经历证据" }],
    gate: "rejected", gateDetail: "个人经历缺少服务端证据，候选未放行。",
  } : {
    used: [{ id: "m1", title: "真实案例" }],
    skipped: [{ id: "m2", title: "待核验数据", reason: "待核验" }, { id: "m3", title: "旁支案例", reason: "与当前主题不相关" }],
    unverified: [{ quote: "增长 40%", why: "没有可核对来源" }], gate: "passed",
  };
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: body.mode, kind: "润色", text, grounding }) });
});
await page.route("**/api/revisions**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === "GET") {
    const items = revisionDocuments.get(url.searchParams.get("scope")) || [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items }) });
  }
  const body = request.postDataJSON();
  if (url.pathname.endsWith("/move")) {
    const items = [...(revisionDocuments.get(body.from) || []), ...(revisionDocuments.get(body.to) || [])];
    revisionDocuments.set(body.to, items);
    revisionDocuments.delete(body.from);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items }) });
  }
  const current = revisionDocuments.get(body.scope) || [];
  const items = [body.item, ...current.filter((item) => item.id !== body.item.id)];
  revisionDocuments.set(body.scope, items);
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items }) });
});
await page.route("**/api/assistant/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === "GET" && url.pathname.endsWith("/models")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, models: { items: assistantModelItems, configured: "test-model" } }) });
  }
  if (request.method() === "GET" && url.pathname.endsWith("/skills")) {
    const names = ["fact-check", "idea-dialogue", "interview-to-draft", "material-extraction", "material-gap", "publish-review", "topic-clustering", "xenho-quality-nine"];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, skills: { items: names.map((name) => ({ id: name, name, description: "项目 Skill" })) } }) });
  }
  if (request.method() === "GET" && url.pathname.endsWith("/modes")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, modes: { defaultMode: "daily", items: [{ id: "daily", label: "日常" }, { id: "creative", label: "创作" }, { id: "developer", label: "开发", warning: "可触及项目代码和命令" }] } }) });
  }
  if (request.method() === "GET" && url.pathname.endsWith("/experts")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, experts: { items: profileFixture.experts } }) });
  }
  if (request.method() === "GET" && url.pathname.endsWith("/conversations")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversations: { items: assistantConversationItems } }) });
  }
  if (request.method() === "GET") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversation: { id: "chat-project", messages: assistantMessages, actions: assistantActions, attachments: [], permissionMode: "daily", model: "test-model" } }) });
  }
  if (request.method() === "POST" && url.pathname.endsWith("/attachment")) {
    const item = { id: `file-${assistantAttachments.length + 1}`, name: url.searchParams.get("filename") || "图片.png", type: "image/png", kind: "image", bytes: request.postDataBuffer()?.length || 0, characters: 0, createdAt: new Date().toISOString() };
    assistantAttachments.push(item);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversationId: "chat-upload", attachment: item }) });
  }
  if (url.pathname.endsWith("/conversation/manage")) {
    const body = request.postDataJSON();
    if (body.action === "rename") assistantConversationItems = assistantConversationItems.map((item) => item.id === body.conversationId ? { ...item, title: body.title } : item);
    if (body.action === "pin") assistantConversationItems = assistantConversationItems.map((item) => item.id === body.conversationId ? { ...item, pinnedAt: new Date().toISOString(), archivedAt: "" } : item);
    if (body.action === "unpin") assistantConversationItems = assistantConversationItems.map((item) => item.id === body.conversationId ? { ...item, pinnedAt: "" } : item);
    if (body.action === "archive") assistantConversationItems = assistantConversationItems.map((item) => item.id === body.conversationId ? { ...item, pinnedAt: "", archivedAt: new Date().toISOString() } : item);
    if (body.action === "restore") assistantConversationItems = assistantConversationItems.map((item) => item.id === body.conversationId ? { ...item, archivedAt: "" } : item);
    if (body.action === "delete") assistantConversationItems = assistantConversationItems.filter((item) => item.id !== body.conversationId);
    const conversation = assistantConversationItems.find((item) => item.id === body.conversationId);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversation: conversation ? { ...conversation, messages: assistantMessages, actions: [], attachments: [], permissionMode: "daily", model: "test-model" } : undefined, conversations: { items: assistantConversationItems }, deletedId: body.action === "delete" ? body.conversationId : undefined }) });
  }
  if (url.pathname.endsWith("/new")) {
    assistantMessages = [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversation: { messages: [] } }) });
  }
  if (url.pathname.endsWith("/cancel")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, cancelled: true }) });
  }
  if (url.pathname.endsWith("/action")) {
    const actionBody = request.postDataJSON();
    assistantActions = assistantActions.map((action) => action.id === actionBody.actionId ? { ...action, status: "applied", result: { ok: true } } : action);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversation: { id: "chat-project", messages: assistantMessages, actions: assistantActions, attachments: assistantAttachments, permissionMode: "daily", model: "test-model" } }) });
  }
  const body = request.postDataJSON();
  assistantRequests.push(body);
  const sentAttachmentIds = assistantAttachments.filter((item) => !item.usedAt).map((item) => item.id);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const actionBase = `action-${assistantMessages.length}`;
  assistantActions = [
    { id: `${actionBase}-reject`, type: "workspace_write", path: "候选/拒绝.md", status: "pending" },
    { id: `${actionBase}-apply`, type: "workspace_write", path: "候选/确认.md", status: "pending" },
    { id: `${actionBase}-apply-duplicate`, type: "workspace_write", path: "候选/确认.md", status: "pending" },
  ];
  assistantMessages = [
    ...assistantMessages,
    { id: `user-${assistantMessages.length}`, role: "user", text: body.message, attachmentIds: sentAttachmentIds, createdAt: new Date().toISOString() },
    { id: `assistant-${assistantMessages.length}`, role: "assistant", text: "建议先把读者最难承认的代价写出来，再用一个真实场景支撑。", actionIds: assistantActions.map((action) => action.id), createdAt: new Date().toISOString(), engine: "Pi Agent SDK", durationMs: 180 },
  ];
  assistantAttachments = assistantAttachments.map((item) => sentAttachmentIds.includes(item.id) ? { ...item, usedAt: new Date().toISOString() } : item);
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversation: { id: "chat-project", messages: assistantMessages, attachments: assistantAttachments, actions: assistantActions, permissionMode: "daily", model: body.model || "test-model" } }) });
});

function assert(value, message) {
  if (!value) throw new Error(message);
}

function editorValue(selector) {
  return page.$eval(selector, (content) => Array.from(content.children).filter((line) => line.classList.contains("cm-line")).map((line) => line.textContent).join("\n"));
}

const stage6Materials = Array.from({ length: 10 }, (_, index) => ({
  id: `stage6-material-${index + 1}`,
  title: `项目素材 ${index + 1}：收藏焦虑的真实观察`,
  type: index === 7 ? "数据/事实" : index === 8 ? "金句/原话" : "案例",
  verificationStatus: index === 7 ? "待核验" : "已核验",
}));
await page.route("**/api/pipe/projects/*", async (route) => {
  if (route.request().method() !== "GET") return route.continue();
  const response = await route.fetch();
  const payload = await response.json();
  if (payload?.project) payload.project.materials = stage6Materials;
  return route.fulfill({ response, contentType: "application/json", body: JSON.stringify(payload) });
});

try {
  /**
   * ⚠️ **上半段原来走的是创作弹层里那块编辑器，那一屏整个撤了。**
   * 写作只有一个地方（`#/project/:id`），所以「新稿编辑器」不再是一个独立的东西——
   * 这一段现在和下半段一样，测的都是**真正在用的那块编辑器**，只是入口不同：
   * 这儿从项目页进，下半段从稿件库的阅读区进。
   */
  await page.goto(`http://127.0.0.1:${PORT}/#/content`, { waitUntil: "networkidle" });
  await page.waitForSelector(".act-card, .ptable, .empty", { timeout: 20000 }).catch(async (cause) => {
    console.error("创作页实际内容：", (await page.locator("body").innerText()).slice(0, 1200));
    throw cause;
  });
  /**
   * ⚠️ **必须挑一个正文可编辑的项目。**
   * 「推动一下」（`WritingAssist`）只在 `writingEditable` 时才画——待发布、待复盘那几档
   * 正文是只读的。盲点第一个的话，这一段会挂在「等 `.writing-assist__trigger`」上超时，
   * 看着像功能坏了，而其实只是打开了一篇锁住的稿子。
   */
  const opened = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".act-card")].find((c) => /继续写作|开始写/.test(c.textContent));
    const go = card?.querySelector(".act-card__go") || card;
    if (go) { go.click(); return "卡片"; }
    const row = [...document.querySelectorAll(".ptable__row")].find((r) => /写作中/.test(r.textContent));
    if (row) { row.click(); return "表格行"; }
    return "";
  });
  assert(opened, "库里此刻没有一个「写作中」的项目，这一段验不了（不是缺陷，换条数据再跑）");
  await page.waitForSelector(".project-draft .cm-content", { timeout: 20000 });
  // 线上第一篇写作中项目可能已经有正文；这段要验空稿起始句，先只在浏览器里清空，绝不保存。
  await page.click(".project-draft .cm-content");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  const paragraph = "这不是缺少更多方法，而是还没有把眼前的矛盾说透。先把最不愿承认的那个代价写下来，下一步往往就会自己出现。";

  if (await page.$(".project-assistant")) {
    assert(!(await page.$(".project-assistant__tabs")), "Stage 6 项目协作区仍保留旧三页签");
    assert((await page.textContent(".assistant-pane--project-rail .assistant-pane__context")).includes("协作"), "项目协作区没有轻量 Header");
    assert(!(await page.$(".project-draft .writing-assist__trigger")) && !(await page.$('.project-draft .writing-tool-btn:has-text("检查")')), "项目编辑器仍保留重复的 AI 协作或检查入口");
    assert(!(await page.$(".project-assistant .assistant-composer__access")) && !(await page.$(".project-assistant .assistant-composer__model")) && !(await page.$(".project-assistant .assistant-composer__style")), "Project Composer 仍常驻显示模型、权限或风格");
    assert(!(await page.$('.project-assistant .assistant-composer footer button:has-text("专家")')) && !(await page.$('.project-assistant .assistant-composer footer button:has-text("Skill")')), "Project Composer 仍常驻显示 Expert 或 Skill");
    await page.setViewportSize({ width: 1366, height: 768 });
    const originalTitle = await page.inputValue(".project-draft__title");
    const longTitle = "这是一篇用来验证一千三百六十六像素宽度下长标题能够自然换行而不会被协作右栏裁切的项目稿件";
    await page.fill(".project-draft__title", longTitle);
    const titleLayout = await page.$eval(".project-draft__title", (item) => ({ height: item.getBoundingClientRect().height, scrollWidth: item.scrollWidth, clientWidth: item.clientWidth, value: item.value }));
    assert(titleLayout.value === longTitle && titleLayout.height > 54 && titleLayout.scrollWidth <= titleLayout.clientWidth + 1, `1366 长标题没有自然换行：${JSON.stringify(titleLayout)}`);
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-long-title.png"), fullPage: false });
    await page.fill(".project-draft__title", originalTitle);
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-empty.png"), fullPage: false });

    const beforeSuggestionRequests = assistantRequests.length;
    await page.click(".assistant-empty[data-scope='project'] .assistant-empty__actions button:first-child");
    assert((await page.inputValue(".project-assistant .assistant-composer textarea")).length > 8, "空态建议没有填入 Composer");
    assert(assistantRequests.length === beforeSuggestionRequests, "空态建议被自动发送");
    await page.fill(".project-assistant .assistant-composer textarea", "@");
    const experts = await page.$$eval(".project-assistant .assistant-command-menu [role=menuitem] b", (items) => items.map((item) => item.textContent.trim()));
    assert(experts.join("/") === "写作教练/素材顾问/审稿顾问/事实核查", `专家菜单不完整：${experts.join("/")}`);
    await page.keyboard.press("Escape");
    await page.fill(".project-assistant .assistant-composer textarea", "/");
    const skills = await page.$$eval(".project-assistant .assistant-command-menu [role=menuitem] b", (items) => items.map((item) => item.textContent.trim()));
    assert(skills.join("/") === "fact-check/idea-dialogue/interview-to-draft/material-extraction/material-gap/publish-review/topic-clustering/xenho-quality-nine", "Skill 菜单不完整：" + skills.join("/"));
    await page.locator('.project-assistant .assistant-command-menu [role=menuitem]:has-text("fact-check")').evaluate((item) => item.click());
    assert((await page.inputValue(".project-assistant .assistant-composer textarea")).includes("/fact-check"), "选择 Skill 后没有插入 Pi Skill 命令");
    await page.fill(".project-assistant .assistant-composer textarea", "");

    await page.click(".project-draft .cm-content");
    await page.keyboard.type("收藏处理的是焦虑，而不是内容。");
    await page.fill(".project-assistant .assistant-composer textarea", "给我一个具体的修改建议");
    await page.click('.project-assistant .assistant-composer button[aria-label="发送"]');
    await page.waitForSelector(".project-assistant .assistant-working");
    await page.waitForFunction(() => document.querySelector(".project-assistant .assistant-message--assistant")?.textContent.includes("真实场景"));
    assert(assistantRequests.at(-1)?.document?.body.includes("收藏处理的是焦虑"), "项目 Assistant 没有收到当前稿件");
    assert(!(await page.textContent(".project-assistant .assistant-message__user > p")).includes("undefined"), "用户消息渲染异常");
    const userBubbleColor = await page.$eval(".project-assistant .assistant-message__user > p", (item) => getComputedStyle(item).backgroundColor);
    const accentColor = await page.$eval(".project-assistant .assistant-composer button[aria-label='发送']", (item) => getComputedStyle(item).backgroundColor);
    assert(userBubbleColor !== accentColor, "项目用户消息仍使用大面积纯黑强调");
    assert(!(await page.textContent(".project-assistant .assistant-message--assistant > small")).includes("Pi Agent SDK"), "Project Assistant 仍显示 Pi Agent SDK 运行时信息");
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-conversation.png"), fullPage: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1440-project-conversation.png"), fullPage: false });
    await page.setViewportSize({ width: 1366, height: 768 });

    for (let index = 0; index < 4; index += 1) {
      const count = await page.locator(".project-assistant .assistant-message--assistant").count();
      await page.fill(".project-assistant .assistant-composer textarea", `继续讨论第 ${index + 2} 个具体问题`);
      await page.click('.project-assistant .assistant-composer button[aria-label="发送"]');
      await page.waitForFunction((before) => document.querySelectorAll(".project-assistant .assistant-message--assistant").length > before && !document.querySelector(".project-assistant .assistant-working"), count);
    }
    const bottomCards = page.locator(".project-assistant .assistant-action-card");
    await bottomCards.first().waitFor();
    const bottomLayout = await page.evaluate(() => {
      const card = [...document.querySelectorAll(".project-assistant .assistant-action-card")].at(-1)?.getBoundingClientRect();
      const composer = document.querySelector(".project-assistant .assistant-composer")?.getBoundingClientRect();
      const threadNode = document.querySelector(".project-assistant .assistant-thread");
      const thread = threadNode?.getBoundingClientRect();
      const end = threadNode?.querySelector(".assistant-thread__end")?.getBoundingClientRect();
      return card && composer && thread ? { cardBottom: card.bottom, composerTop: composer.top, threadBottom: thread.bottom, endBottom: end?.bottom, scrollTop: threadNode.scrollTop, scrollMax: threadNode.scrollHeight - threadNode.clientHeight } : null;
    });
    assert(bottomLayout && bottomLayout.cardBottom <= bottomLayout.composerTop, `最后一条 Action 被 Composer 遮挡：${JSON.stringify(bottomLayout)}`);
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-long-conversation.png"), fullPage: false });

    const actionCards = page.locator(".project-assistant .assistant-action-card");
    await actionCards.first().waitFor();
    assert(await actionCards.count() === 2, "连续相同的待确认 Action 没有去重");
    await actionCards.nth(0).getByRole("button", { name: "拒绝" }).click();
    assert((await actionCards.nth(0).textContent()).includes("已拒绝"), "Action 拒绝没有成为正式状态");
    await actionCards.nth(1).getByRole("button", { name: "确认写入" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll(".project-assistant .assistant-action-card")].some((item) => item.textContent.includes("已执行")));

    const beforeCandidate = await editorValue(".project-draft .cm-content");
    await page.click('.project-assistant .assistant-message--assistant button:has-text("作为候选插入")');
    await page.waitForSelector(".project-draft .candidate-card textarea");
    assert((await editorValue(".project-draft .cm-content")) === beforeCandidate, "Assistant 候选在采纳前写进了正文");
    assert(await page.$(".project-draft .cm-text-revision-host .candidate-card"), "短 Assistant 候选没有在正文原位置内联审阅");
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-inline-candidate.png"), fullPage: false });
    assert(((await page.textContent(".project-draft .candidate-card")).match(/采纳前不会写入正文/g) || []).length === 1, "Candidate 重复提示原文未改变");
    await page.focus(".project-draft .candidate-card textarea");
    await page.keyboard.press("Control+Backspace");
    await page.waitForSelector(".project-draft .candidate-card", { state: "detached" });
    assert((await editorValue(".project-draft .cm-content")) === beforeCandidate, "Candidate 键盘弃用改变了正文");

    await page.click(".project-assistant__context-trigger");
    await page.waitForSelector(".project-context-panel");
    const contextText = await page.textContent(".project-context-panel");
    assert(contextText.includes("当前主稿") && contextText.includes("项目检查"), "上下文面板没有说明当前稿件和按需检查");
    assert(!contextText.includes("已核验"), "上下文面板仍在每条素材重复显示已核验文字");
    assert((await page.$$(".project-context-material")).length === 10 && contextText.includes("待核验"), "10 条素材 Context 没有完整滚动列表或待核验状态");
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-context-10.png"), fullPage: false });
    await page.click('.project-context-panel__reports button:has-text("Xenho 品控九问")');
    await page.waitForFunction(() => [...document.querySelectorAll(".project-context-panel__reports button")].some((item) => item.textContent.includes("Xenho 品控九问") && item.textContent.includes("查看最近报告")), null, { timeout: 10000 });
    await page.click('.project-context-panel__reports button:has-text("Xenho 品控九问")');
    await page.waitForSelector(".project-report-review");
    assert(!(await page.locator(".project-assistant").isVisible()) && !(await page.locator(".project-draft").isVisible()), "报告审阅仍同时显示正文、报告和完整协作右栏");
    const reportText = await page.textContent(".project-report-review");
    assert(reportText.includes("值得保留") && reportText.includes("建议修改") && reportText.includes("高风险"), "报告没有区分正面结果与待处理 finding");
    assert(!reportText.includes("可选优化") && !reportText.includes("接受建议") && reportText.includes("生成候选"), "报告仍把 pass 映射成可选优化或使用错误动作名");
    const reportOrder = await page.evaluate(() => {
      const needsNode = document.querySelector(".project-report-findings__list > h3");
      const needs = needsNode?.getBoundingClientRect();
      const strengths = document.querySelector(".project-report-strengths");
      return needs && strengths ? { needsTop: needs.top, strengthsTop: strengths.getBoundingClientRect().top, strengthsOpen: strengths.open, label: needsNode.textContent } : null;
    });
    assert(reportOrder && reportOrder.label.includes("需要处理") && reportOrder.needsTop < reportOrder.strengthsTop && !reportOrder.strengthsOpen, `Report 首屏顺序或折叠状态错误：${JSON.stringify(reportOrder)}`);
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-report.png"), fullPage: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1440-project-report.png"), fullPage: false });
    await page.setViewportSize({ width: 1366, height: 768 });
    const firstFinding = page.locator(".project-report-findings__list > article").first();
    await firstFinding.click();
    assert(await firstFinding.getAttribute("data-current") === "true", "点击 finding 没有高亮当前项");
    const linkedBody = page.locator('.project-report-document [data-current="true"]');
    assert(await linkedBody.count() === 1, "finding 没有定位并高亮正文位置");
    await linkedBody.click();
    assert(await firstFinding.getAttribute("data-current") === "true", "点击正文位置没有反向定位 finding");
    await firstFinding.getByRole("button", { name: "生成候选" }).click();
    await page.waitForSelector(".project-draft .candidate-card");
    assert(await page.$(".project-assistant:not([data-reviewing])"), "退出报告后项目会话没有恢复");
    assert((await page.textContent(".project-assistant .assistant-thread")).includes("真实场景"), "退出报告后原会话内容丢失");
    await page.click('.project-draft .candidate-card .text-revision-review__decide button:has-text("弃用")');

    await page.click('.project-assistant .assistant-history-toggle[aria-label="最近会话"]');
    await page.waitForSelector(".project-assistant-history");
    const historyBefore = await page.textContent(".project-assistant-history");
    assert(historyBefore.includes("当前会话") && historyBefore.includes("最近对话"), "轻量项目历史缺少当前会话或最近会话");
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-history.png"), fullPage: false });
    await page.click(".project-assistant-history header button");
    await page.waitForSelector(".project-assistant .assistant-empty[data-scope='project']");
    await page.click('.project-assistant .assistant-history-toggle[aria-label="最近会话"]');
    assert((await page.textContent(".project-assistant-history")).includes("最近对话"), "新对话后旧会话从最近列表消失");
    await page.locator(".project-assistant-history nav button").first().click();
    await page.waitForSelector(".project-assistant .assistant-message--assistant");
    await page.setViewportSize({ width: 1180, height: 768 });
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1180-project-assistant-overlay.png"), fullPage: false });
    await page.setViewportSize({ width: 1366, height: 768 });
    const railBeforeFocusedReview = await page.$eval(".project-assistant .assistant-thread", (thread) => {
      thread.scrollTo({ top: Math.max(0, thread.scrollHeight - thread.clientHeight - 48), behavior: "instant" });
      return { scrollTop: thread.scrollTop, messages: [...thread.querySelectorAll(".assistant-message__markdown, .assistant-message__user > p")].map((item) => item.textContent) };
    });

    const largeSection = Array.from({ length: 18 }, (_, index) => `第${index + 1}段讨论收藏焦虑如何遮蔽真正的内容判断，并补充一个具体情境作为证据。`).join("\n\n");
    await page.click(".project-draft .cm-content");
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(largeSection);
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Control+Shift+Home");
    await page.waitForSelector(".text-revision-menu");
    await page.locator('.text-revision-menu__actions button:has-text("纠错")').evaluate((item) => item.click());
    await page.waitForSelector(".md-candidate-focus .candidate-card textarea");
    assert(/章节审阅|全文审阅/.test(await page.textContent(".md-candidate-focus")) && (await page.textContent(".md-candidate-focus")).includes("弃用并结束审阅"), "大章节或全文 Candidate 没有进入专注审阅或退出文案不清楚");
    assert(!(await page.$(".cm-text-revision-host .candidate-card")), "大章节 Candidate 仍被压在正文内联位置");
    assert(!(await page.locator(".project-assistant").isVisible()), "大章节或全文 Candidate 专注审阅时没有折叠协作右栏");
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-focused-candidate.png"), fullPage: false });
    await page.click('.md-candidate-focus .text-revision-review__decide button:has-text("弃用")');
    await page.waitForFunction(() => !document.querySelector(".project-assistant")?.dataset.reviewing);
    await page.waitForTimeout(120);
    const railAfterFocusedReview = await page.$eval(".project-assistant .assistant-thread", (thread) => ({ scrollTop: thread.scrollTop, messages: [...thread.querySelectorAll(".assistant-message__markdown, .assistant-message__user > p")].map((item) => item.textContent) }));
    assert(JSON.stringify(railAfterFocusedReview.messages) === JSON.stringify(railBeforeFocusedReview.messages) && Math.abs(railAfterFocusedReview.scrollTop - railBeforeFocusedReview.scrollTop) <= 2, `专注审阅退出后会话或滚动位置没有恢复：${JSON.stringify({ before: { scrollTop: railBeforeFocusedReview.scrollTop, messages: railBeforeFocusedReview.messages.length }, after: { scrollTop: railAfterFocusedReview.scrollTop, messages: railAfterFocusedReview.messages.length } })}`);
    await page.setViewportSize({ width: 1440, height: 900 });

    console.log("✓ 项目协作区收敛为轻量 Header、上下文、对话与极简 Composer");
    console.log("✓ 空态建议只填入 Composer，@Expert 与 /Skill 只由输入字符触发");
    console.log("✓ 短 Candidate 在正文内联审阅，采纳前不修改正文");
    console.log("✓ Report 正面结果进入值得保留，finding 与正文可双向定位");
    console.log("✓ 项目新对话保留最近会话，报告审阅退出后恢复原对话");
  } else {

  await page.click(".writing-assist__trigger");
  await page.waitForSelector(".writing-assist__result");
  const firstStarter = await page.textContent(".writing-assist__result > p");
  assert((await page.textContent(".writing-assist__result footer")).includes("2,560"), "没有显示真实的起始句库数量");
  const modes = await page.$$eval(".writing-assist__modes button", (buttons) => buttons.map((button) => button.textContent.trim()));
  assert(modes.join("/") === "想一想/聊一聊/帮我写", `协作方式不完整：${modes.join("/")}`);
  const iconActions = await page.evaluate(() => Array.from(document.querySelectorAll(".writing-assist__result footer button"), (button) => ({
    label: button.getAttribute("aria-label"),
    title: button.getAttribute("title"),
    text: button.textContent.trim(),
    icons: button.querySelectorAll("svg").length,
  })));
  assert(iconActions.every((item) => item.label && item.title && !item.text && item.icons === 1), "结果操作没有全部使用带悬停说明的图标按钮");
  await page.click('.writing-assist__result button[aria-label="换一句起始句"]');
  const secondStarter = await page.textContent(".writing-assist__result > p");
  assert(firstStarter !== secondStarter, "换一句没有换内容");
  await page.click('.writing-assist__result button[aria-label="用这句开头"]');
  await page.waitForFunction((text) => document.querySelector(".cm-content")?.textContent.includes(text), secondStarter);

  // 编辑器没有独立风格设置；只有“帮我写”需要选择本次调用的语气。
  assert(!(await page.$('.writing-tool-btn:has-text("风格")')), "编辑器仍保留了独立风格设置入口");
  await page.click(".writing-assist__trigger");
  await page.click('.writing-assist__modes button:has-text("帮我写")');
  await page.waitForSelector(".writing-assist__style-select select");
  const styleChoices = await page.$$eval(".writing-assist__style-select select option", (items) => items.map((item) => item.textContent.trim()));
  assert(styleChoices.length === 7 && styleChoices.some((item) => item.includes("故事推进")) && styleChoices.some((item) => item.includes("我的风格")), `风格选项不完整：${styleChoices.join("/")}`);
  await page.selectOption(".writing-assist__style-select select", "story-led");
  assert((await page.textContent(".writing-assist__style-select small")).includes("用场景推进观点"), "帮我写没有显示所选风格说明");
  assert(styleSaves.length === 0, "编辑器选择风格时不该改写或保存提示词");
  await page.click('.writing-assist__close');
  nudges = 0;
  for (let index = requests.length - 1; index >= 0; index -= 1) if (requests[index].mode === "nudge") requests.splice(index, 1);

  // 新稿编辑器同样支持选区工具条；Esc 只收起工具条，不改正文。
  await page.click(".project-draft .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForSelector(".text-revision-menu");
  const newEditorActions = await page.$$eval(".text-revision-menu__actions button:not(.text-revision-menu__close)", (buttons) => buttons.map((button) => button.textContent.trim()));
  assert(newEditorActions.join("/") === "润色/纠错/缩写/扩写/改写", `新稿选区工具不完整：${newEditorActions.join("/")}`);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".text-revision-menu", { state: "detached" });

  // 光标放在正文中间：请求位置、浮层位置和等待动画必须都以真实界面为准。
  await page.click(".project-draft .cm-content");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.click(".writing-assist__trigger");
  await page.waitForSelector(".writing-assist__wait");
  const loadingUi = await page.evaluate(() => {
    const card = document.querySelector(".writing-assist__card");
    const spinner = document.querySelector(".writing-assist__wait svg");
    const rect = card.getBoundingClientRect();
    return {
      position: getComputedStyle(card).position,
      centerOffset: Math.abs((rect.left + rect.right) / 2 - innerWidth / 2),
      top: rect.top,
      animation: getComputedStyle(spinner).animationName,
    };
  });
  assert(loadingUi.position === "fixed" && loadingUi.centerOffset < 2 && loadingUi.top < 120, "推动浮层没有固定在页面顶部中央");
  assert(loadingUi.animation !== "none", "等待图标没有播放转动动画");
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("改变看法"));
  assert(requests.find((item) => item.mode === "nudge")?.cursor === 3, "新建文章没有把当前光标位置发给 AI");

  // AI 协作只调用写作教练；选题顾问不再混进编辑器下拉框。
  assert(!(await page.$(".writing-assist__context select")) && /写作教练/.test(await page.textContent(".writing-assist__context")), "AI 协作仍在显示统一专家下拉框");
  await page.click('.writing-assist__modes button:has-text("想一想")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("读者最可能反对"));
  assert(nudges === 2, `小推动请求次数不对：${nudges}`);
  assert(requests.at(-1)?.expert?.includes("写作教练") && !requests.at(-1)?.style, "小推动不该套用写作风格");

  // 素材、审稿、核查是独立检查任务，结果只显示报告，不提供插入正文。
  await page.click('.writing-assist__close');
  await page.click('.writing-tool-btn:has-text("检查")');
  const checks = await page.$$eval(".writing-checks__menu > button", (items) => items.map((item) => item.textContent.trim()));
  assert(checks.length === 3 && checks.every((item) => /素材查缺|Xenho 品控九问|事实核查/.test(item)), `检查任务不完整：${checks.join("/")}`);
  await page.click(".project-draft .cm-content");
  await page.waitForSelector(".writing-checks__menu", { state: "detached" });
  await page.click('.writing-tool-btn:has-text("检查")');
  await page.click(".project-draft .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.click('.writing-tool-btn:has-text("检查")');
  await page.click('.writing-checks__menu > button:has-text("素材查缺")');
  await page.waitForSelector(".expert-activity");
  const expertAnimation = await page.$eval(".expert-activity", (item) => getComputedStyle(item).animationName);
  assert(expertAnimation === "expert-orbit", "专家工作指示器没有播放动画");
  await page.waitForSelector('.expert-retry:has-text("重试本次检查")');
  assert((await page.textContent(".expert-error")).includes("专家模型连接失败"), "专家错误没有显示真实连接原因");
  await page.click('.expert-retry:has-text("重试本次检查")');
  await page.waitForSelector(".expert-activity");
  await page.waitForFunction(() => document.querySelector(".expert-report")?.textContent.includes("本地知识卡"));
  const materialAudit = expertStarts.at(-1);
  assert(materialAudit?.kind === "material-research" && materialAudit?.document?.selection?.text?.length === 6, "素材顾问没有围绕当前选区启动真实研究任务");
  assert(expertStarts.filter((item) => item.kind === "material-research").length === 2, "重试没有重新启动同一项专家检查");
  assert((await page.textContent(".expert-report")).includes("权威网页来源"), "素材报告没有展示联网来源");
  assert(!(await page.$(".expert-task button[aria-label='插入光标处']")), "检查报告不该提供插入正文动作");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".expert-dialog", { state: "detached" });

  await page.click(".project-draft .cm-content");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.click(".writing-assist__trigger");
  await page.waitForSelector(".writing-assist__result");
  await page.click('.writing-assist__modes button:has-text("帮我写")');
  await page.selectOption(".writing-assist__style-select select", "story-led");
  await page.click('.writing-assist__choice button:has-text("续写一段")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("缺少更多方法"));
  const before = await editorValue(".cm-content");
  const paragraphRequest = requests.findLast((item) => item.mode === "paragraph");
  assert(paragraphRequest?.style?.includes("从真实场景进入。"), "帮我写没有按所选风格生成候选");
  assert(!before.includes("缺少更多方法"), "候选在确认前就写进了正文");
  await page.click('.writing-assist__result button[aria-label="插入光标处"]');
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("缺少更多方法"));
  await page.waitForSelector(".writing-assist__card", { state: "detached" });
  const after = await editorValue(".cm-content");
  assert(after === before.slice(0, 3) + paragraph + before.slice(3), "续写没有精确插入当前光标，或额外添加了换行");
  assert((await page.$$(".cm-ai-draft")).length > 0, "AI 续写插入后没有轻量底纹");
  const aiWash = await page.$eval(".cm-ai-draft", (node) => getComputedStyle(node).backgroundColor);
  assert(aiWash !== "rgba(0, 0, 0, 0)" && aiWash !== "transparent", "AI 续写底纹没有实际颜色");
  await page.screenshot({ path: path.join(ROOT, "tmp", "writing-assist-ai-pending.png"), fullPage: false });
  await page.keyboard.type("再补一句。");
  assert((await editorValue(".cm-content")).includes(paragraph + "再补一句。"), "不能直接在 AI 底纹范围内修改");
  await page.click('.ai-draft-review button[aria-label="回看 AI 插入时的原稿"]');
  await page.waitForSelector(".ai-draft-history");
  assert((await page.textContent(".ai-draft-history")).includes(paragraph), "回看历史里没有保留 AI 插入时的原稿");
  assert((await page.textContent(".ai-draft-history")).includes("已修改"), "修改 AI 续写后历史没有标出状态");
  await page.click('.ai-draft-history button[aria-label="关闭 AI 历史"]');
  await page.click('.ai-draft-review button[aria-label="确认采用这段，移除底纹"]');
  await page.waitForSelector(".ai-draft-review", { state: "detached" });
  assert((await page.$$(".cm-ai-draft")).length === 0, "确认采用后 AI 底纹没有消失");
  assert((await page.$$(".md-editor__ai-history")).length === 1, "确认采用后没有保留原稿回看入口");
  await page.click(".md-editor__ai-history");
  await page.waitForSelector(".ai-draft-history");
  assert((await page.textContent(".ai-draft-history")).includes(paragraph), "确认采用后无法再次回看 AI 原稿");
  await page.screenshot({ path: path.join(ROOT, "tmp", "writing-assist-ai-history.png"), fullPage: false });
  await page.click('.ai-draft-history button[aria-label="关闭 AI 历史"]');

  await page.click(".writing-assist__trigger");
  await page.waitForSelector(".writing-assist__wait");
  await page.waitForSelector(".writing-assist__result");
  await page.click('.writing-assist__modes button:has-text("帮我写")');
  await page.waitForSelector(".writing-assist__choice");
  await page.click('.writing-assist__choice button:has-text("完成全文")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("真正的结束"));
  const overflow = await page.evaluate(() => {
    const card = document.querySelector(".writing-assist__card");
    const content = document.querySelector(".writing-assist__result > p");
    return {
      cardHeight: card.getBoundingClientRect().height,
      scrolls: content.scrollHeight > content.clientHeight,
      overflowY: getComputedStyle(content).overflowY,
    };
  });
  assert(overflow.cardHeight <= 461 && overflow.scrolls && overflow.overflowY === "auto", "长结果没有限制窗口高度并在内部滚动");
  assert(!(await page.textContent(".cm-content")).includes("真正的结束"), "完成全文在确认前就写进了正文");
  await page.click('.writing-assist__result button[aria-label="插入光标处"]');
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("真正的结束"));

  // 「聊一聊」只逐问和整理线索：总结出现前后都不能静默改正文，最后由用户明确插入。
  await page.click(".writing-assist__trigger");
  await page.click('.writing-assist__modes button:has-text("聊一聊")');
  await page.waitForSelector(".writing-assist__welcome");
  await page.waitForTimeout(350);
  assert(!(await page.$(".writing-assist__error")), "切换到聊一聊时串进了上一种模式的错误");
  const beforeChat = await editorValue(".cm-content");
  await page.click('.writing-assist__welcome button:has-text("开始梳理")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__log")?.textContent.includes("具体是什么内容"));
  assert((await editorValue(".cm-content")) === beforeChat, "第一问自动改了正文");
  await page.click('.writing-assist__chat-actions button:has-text("整理线索")');
  await page.waitForSelector('.writing-assist__chat-actions button:has-text("插入正文")');
  assert((await editorValue(".cm-content")) === beforeChat, "整理线索在确认前改了正文");
  assert(brainstormRequests.length === 2 && brainstormRequests[1].phase === "summary", "聊一聊没有先问再整理");
  await page.click('.writing-assist__chat-actions button:has-text("插入正文")');
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("写作线索"));
  }

  // 用户日常改稿走的是稿件库覆盖层，不是上面的新建弹层；这里必须单独守住入口。
  const legacyRevisionStart = revisionRequests.length;
  await page.goto(`http://127.0.0.1:${PORT}/#/drafts`, { waitUntil: "networkidle" });
  /**
   * ⚠️ **浏览层早就从卡片墙换成列表行了**（`.wall-card__open` → `.doc-row__open`），
   * 这几行一直指着一个不存在的类名——**这个脚本没进 `package.json`，
   * 所以烂了很久也没人发现**。要加断言就顺手把它跑一遍。
   *
   * 挑一条**真有正文**的：后面几条量的是编辑器里的字，空稿会让它们全部落空。
   */
  await page.waitForSelector(".doc-row__open, .empty", { timeout: 25000 });
  assert((await page.$$(".doc-row__open")).length > 0, "稿件库没有可用于验证的稿件");
  const pickDraft = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".doc-row")];
    const full = rows.find((r) => (r.querySelector(".doc-row__excerpt")?.textContent || "").trim().length > 10);
    return rows.indexOf(full || rows[0]);
  });
  await page.click(`.doc-row__open >> nth=${Math.max(pickDraft, 0)}`);
  await page.waitForSelector('.doc-actions button:has-text("编辑")', { timeout: 25000 });
  await page.click('.doc-actions button:has-text("编辑")');
  await page.waitForSelector(".ws-edit .cm-content", { timeout: 8000 });
  assert((await page.$$(".ws-edit .writing-assist__trigger")).length === 1, "正式编辑器里没有推动按钮");
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("ArrowRight");
  const existingBefore = await editorValue(".ws-edit .cm-content");
  await page.click(".ws-edit .writing-assist__trigger");
  await page.waitForSelector(".ws-edit .writing-assist__result");
  const existingNudge = requests.filter((item) => item.mode === "nudge").at(-1);
  assert(existingNudge?.cursor === 12 && existingNudge.cursor < existingNudge.content.length, "正式编辑器仍然按文末而不是当前光标请求");
  await page.click('.ws-edit .writing-assist__modes button:has-text("帮我写")');
  await page.click('.ws-edit .writing-assist__choice button:has-text("续写一段")');
  await page.waitForFunction(() => document.querySelector(".ws-edit .writing-assist__result > p")?.textContent.includes("缺少更多方法"));
  await page.screenshot({ path: path.join(ROOT, "tmp", "writing-assist-existing-editor.png"), fullPage: false });
  await page.click('.ws-edit .writing-assist__result button[aria-label="插入光标处"]');
  await page.waitForFunction(() => document.querySelector(".ws-edit .cm-content")?.textContent.includes("缺少更多方法"));
  const existingAfter = await editorValue(".ws-edit .cm-content");
  assert(existingAfter === existingBefore.slice(0, 12) + paragraph + existingBefore.slice(12), "正式编辑器没有在当前光标精确插入");
  assert((await page.$$(".ws-edit .cm-ai-draft")).length > 0, "正式编辑器里的 AI 续写没有底纹");

  // 正式改稿：选区 → 自定义润色 → 对比 → 重写 → 编辑候选 → 采纳。
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForSelector(".text-revision-menu");
  await page.click('.text-revision-menu__actions button:has-text("润色")');
  await page.fill('.text-revision-menu__command input[aria-label="润色要求"]', "更克制");
  await page.click('.text-revision-menu__command button[aria-label="开始润色"]');
  await page.waitForSelector(".candidate-card textarea");
  assert(revisionRequests[legacyRevisionStart]?.instruction === "更克制", "自定义润色要求没有发给 AI");
  const groundingText = await page.textContent(".candidate-grounding");
  assert(groundingText.includes("已使用 1") && groundingText.includes("已跳过 2") && groundingText.includes("未经核验 1"), "Grounding used/skipped/unverified 没有默认显示");
  assert(groundingText.includes("去核验") && groundingText.includes("仍然使用"), "skipped 没有给出下一步");
  const compareDocument = await editorValue(".ws-edit .cm-content");
  const visuallySplitDocument = `${existingAfter.slice(0, 12)}\n${existingAfter.slice(12)}`;
  assert(compareDocument === visuallySplitDocument, "对比阶段除候选卡片占位外改变了正文内容");
  await page.focus(".ws-edit .cm-content");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("临时变化");
  await page.waitForFunction(() => document.querySelector(".ws-edit .cm-content")?.textContent.includes("临时变化"));
  await page.keyboard.press("Control+Home");
  await page.waitForSelector('.candidate-card[data-status="stale"]');
  assert(await page.locator('.candidate-card .text-revision-review__decide button:has-text("采纳")').isDisabled(), "stale Candidate 仍然可以采纳");
  await page.click('.ws-edit .md-editor__bar button[aria-label="撤销"]');
  await page.focus(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  await page.waitForTimeout(300);
  const restoredStatus = await page.evaluate(() => document.querySelector(".candidate-card")?.dataset.status ?? "missing");
  assert(["ready", "edited"].includes(restoredStatus), "正文撤销后 Candidate 状态未恢复：" + restoredStatus);
  const afterStaleUndo = await editorValue(".ws-edit .cm-content");
  assert(!afterStaleUndo.includes("临时变化"), "stale 测试撤销后仍残留正文变化：" + afterStaleUndo.slice(-40));
  const compareStyle = await page.evaluate(() => ({
    strike: getComputedStyle(document.querySelector(".cm-text-revision-original")).textDecorationLine,
    wash: getComputedStyle(document.querySelector(".text-revision-review textarea")).backgroundColor,
  }));
  assert(compareStyle.strike.includes("line-through"), "对比状态的原文没有删除线");
  assert(compareStyle.wash !== "transparent" && compareStyle.wash !== "rgba(0, 0, 0, 0)", "修订候选没有轻量底纹");
  await page.fill('.text-revision-review__command input[aria-label="调整候选要求"]', "更克制、更直接");
  await page.click('.text-revision-review__command button[aria-label="重新生成"]');
  await page.waitForFunction(() => document.querySelector(".text-revision-review textarea")?.value.includes("第二版候选"));
  assert(revisionRequests[legacyRevisionStart + 1]?.instruction === "更克制、更直接", "重新生成没有沿用调整后的要求");
  await page.fill('.text-revision-review textarea[aria-label="AI 正文候选，可直接编辑"]', "这是用户调整后的最终候选。 ");
  await page.screenshot({ path: path.join(ROOT, "tmp", "text-revision-review.png"), fullPage: false });
  await page.click('.text-revision-review__decide button:has-text("采纳")');
  await page.waitForSelector(".text-revision-review", { state: "detached" });
  const revisedAfter = await editorValue(".ws-edit .cm-content");
  const expectedRevisionPrefix = `这是用户调整后的最终候选。${existingAfter.slice(12)}`.slice(0, 160);
  assert(revisedAfter.startsWith(expectedRevisionPrefix), "采纳没有精确替换原选区前缀：" + JSON.stringify(revisedAfter.slice(0, 160)));
  await page.click(".ws-edit .md-editor__ai-history");
  await page.waitForSelector(".ai-draft-history");
  const historyText = await page.textContent(".ai-draft-history");
  assert(historyText.includes("已采纳") && historyText.includes(existingAfter.slice(0, 12)) && historyText.includes("这是用户调整后的最终候选。"), "修订历史没有同时保留原文和最终候选");
  await page.screenshot({ path: path.join(ROOT, "tmp", "text-revision-history.png"), fullPage: false });
  await page.click('.ai-draft-history button[aria-label="关闭 AI 历史"]');
  await page.click('.ws-edit__foot button:has-text("取消")');

  // 编辑器卸载再打开，记录仍从持久层读回来。
  await page.click('.doc-actions button:has-text("编辑")');
  await page.waitForSelector(".ws-edit .md-editor__ai-history", { timeout: 8000 });
  await page.click(".ws-edit .md-editor__ai-history");
  await page.waitForSelector(".ai-draft-history");
  assert((await page.textContent(".ai-draft-history")).includes("已采纳"), "重新打开稿件后修订历史没有恢复");
  await page.click('.ai-draft-history button[aria-label="关闭 AI 历史"]');

  // 弃用只记录决定，不改变正文；结果同样进入持久历史。
  const beforeDiscard = await editorValue(".ws-edit .cm-content");
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.click('.text-revision-menu__actions button:has-text("纠错")');
  await page.waitForSelector(".text-revision-review textarea");
  await page.click('.text-revision-review__decide button:has-text("弃用")');
  await page.waitForSelector(".text-revision-review", { state: "detached" });
  assert(await editorValue(".ws-edit .cm-content") === beforeDiscard, "弃用修订后正文发生了变化");
  await page.click(".ws-edit .md-editor__ai-history");
  await page.waitForSelector(".ai-draft-history");
  assert((await page.textContent(".ai-draft-history")).includes("已弃用"), "弃用决定没有进入持久修订历史");
  await page.click('.ai-draft-history button[aria-label="关闭 AI 历史"]');

  const beforeRejected = await editorValue(".ws-edit .cm-content");
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.click('.text-revision-menu__actions button:has-text("改写")');
  await page.fill('.text-revision-menu__command input[aria-label="改写要求"]', "触发真实性拒绝");
  await page.click('.text-revision-menu__command button[aria-label="开始改写"]');
  await page.waitForSelector('.candidate-card[data-status="failed"]');
  assert((await page.textContent(".candidate-card")).includes("个人经历缺少服务端证据，候选未放行"), "gate rejected 没有显示服务端原因");
  assert(await page.locator('.candidate-card .text-revision-review__decide button:has-text("采纳")').isDisabled(), "gate rejected Candidate 仍能采纳");
  await page.click('.candidate-card .text-revision-review__decide button:has-text("弃用")');
  assert((await editorValue(".ws-edit .cm-content")) === beforeRejected, "failed Candidate 弃用后改变了正文");
  await page.click('.ws-edit__foot button:has-text("取消")');

  await page.evaluate(() => localStorage.removeItem("xenho-assistant-model"));
  await page.goto(`http://127.0.0.1:${PORT}/#/content`, { waitUntil: "networkidle" });
  await page.click('.sidebar .nav-item:has-text("AI助手")');
  await page.waitForSelector(".assistant-page .assistant-pane--standalone");
  assert(page.url().includes("#/assistant"), "左侧 AI 助手没有打开独立对话页");
  assert(!(await page.$(".assistant-pane--standalone .assistant-history")), "独立助手打开时历史对话栏没有默认收起");
  assert((await page.$$(".assistant-pane--standalone .assistant-composer__left > button")).length === 2, "输入框左侧没有保持为附件与权限两个紧凑入口");
  assert(await page.$(".assistant-pane--standalone .assistant-composer__right .assistant-composer__model"), "模型选择没有放在输入框右侧");
  assert((await page.textContent(".assistant-pane--standalone .assistant-composer__model")).includes("claude-sonnet-4-6"), "新对话没有默认使用 claude-sonnet-4-6");
  await page.click(".assistant-pane--standalone .assistant-composer__model");
  await page.waitForSelector(".assistant-pane--standalone .assistant-command-menu--models");
  await page.click(".assistant-pane__context");
  await page.waitForSelector(".assistant-pane--standalone .assistant-command-menu--models", { state: "detached" });
  await page.click(".assistant-pane--standalone .assistant-composer__model");
  await page.click('.assistant-pane--standalone .assistant-command-menu--models > button:has-text("测试模型 2")');
  assert(await page.evaluate(() => localStorage.getItem("xenho-assistant-model")) === "test-model-2", "用户选择的模型没有写入本地偏好");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".assistant-page .assistant-pane--standalone");
  assert((await page.textContent(".assistant-pane--standalone .assistant-composer__model")).includes("测试模型 2"), "刷新后没有保持用户改动的模型");
  await page.click(".assistant-pane--standalone .assistant-composer__model");
  await page.waitForSelector(".assistant-pane--standalone .assistant-command-menu--models");
  const modelButtonBox = await page.locator(".assistant-pane--standalone .assistant-composer__model").boundingBox();
  const modelMenuBox = await page.locator(".assistant-pane--standalone .assistant-command-menu--models").boundingBox();
  assert(modelButtonBox && modelMenuBox && modelMenuBox.y + modelMenuBox.height <= modelButtonBox.y && Math.abs(modelMenuBox.x + modelMenuBox.width - modelButtonBox.x - modelButtonBox.width) <= 3, "模型面板没有从模型按钮上方向右对齐展开");
  assert(modelMenuBox.width <= 322, `模型面板仍然过宽：${modelMenuBox.width}`);
  const modelRows = await page.$$eval(".assistant-pane--standalone .assistant-command-menu--models > button", (items) => items.map((item) => {
    const box = item.getBoundingClientRect();
    return { y: box.y, bottom: box.bottom, height: box.height };
  }));
  assert(modelRows.length === assistantModelItems.length && modelRows.every((row) => row.height >= 44) && modelRows.slice(1).every((row, index) => row.y >= modelRows[index].bottom - 0.5), `模型列表行发生重叠：${JSON.stringify(modelRows)}`);
  await page.click(".assistant-pane--standalone .assistant-command-menu--models header button");
  const uploadImage = path.join(ROOT, "extension", "icons", "icon-64.png");
  await page.locator('.assistant-pane--standalone input[type="file"]').setInputFiles(uploadImage);
  await page.waitForSelector(".assistant-pane--standalone .assistant-attachments");
  assert(await page.inputValue('.assistant-pane--standalone textarea[placeholder*="问任何问题"]') === "", "上传图片后仍自动填写提示语");
  assert(!(await page.locator('.assistant-pane--standalone button[aria-label="发送"]').isDisabled()), "只有图片时发送按钮仍不可用");
  await page.click('.assistant-pane--standalone button[aria-label="发送"]');
  await page.waitForFunction(() => document.querySelectorAll(".assistant-pane--standalone .assistant-message--assistant").length > 0 && !document.querySelector(".assistant-pane--standalone .assistant-working"));
  assert(assistantRequests.at(-1)?.message === "", "纯图片发送被改写成了可见提示语");
  assert((await page.textContent(".assistant-pane--standalone .assistant-message__attachments")).includes("icon-64.png"), "图片没有作为用户消息发送出去");
  assert(!(await page.textContent(".assistant-pane--standalone .assistant-thread")).includes("请查看图片"), "对话中仍出现自动生成的图片提示语");
  assert(!(await page.$(".assistant-pane--standalone .assistant-composer .assistant-attachments")), "已发送图片仍滞留在输入框");
  assert(!(await page.$(".assistant-pane--standalone .assistant-composer__hint")), "输入框底部仍有常驻快捷键提示");
  assert(await page.$(".assistant-pane--standalone .assistant-composer__access"), "独立助手没有紧凑权限入口");
  assert((await page.textContent(".assistant-pane__context")).includes("历史对话") && !(await page.textContent(".assistant-pane__context")).includes("知识库 · 联网 · 文件 · Skill"), "助手顶栏没有收敛为历史对话入口");
  await page.click(".assistant-history-toggle");
  await page.waitForSelector(".assistant-history");
  assert((await page.textContent(".assistant-history")).includes("最近对话"), "历史栏没有展示最近对话");
  await page.click('.assistant-history__item:has-text("最近对话") .assistant-history__more');
  assert((await page.textContent(".assistant-history__menu")).includes("重命名") && (await page.textContent(".assistant-history__menu")).includes("置顶聊天") && (await page.textContent(".assistant-history__menu")).includes("归档") && (await page.textContent(".assistant-history__menu")).includes("删除"), "历史对话管理菜单不完整");
  await page.click(".assistant-history__menu > button.is-danger");
  await page.waitForSelector(".assistant-history__delete-confirm");
  assert((await page.textContent(".assistant-history__delete-confirm")).includes("原始记录会移入本地回收目录"), "删除没有显示可见的二次确认");
  await page.click('.assistant-history__delete-confirm button:has-text("确认删除")');
  await page.waitForSelector('.assistant-history__item:has-text("最近对话")', { state: "detached" });
  assert(!assistantConversationItems.some((item) => item.id === "chat-recent"), "确认删除后历史记录仍在列表中");
  await page.click('.assistant-history__filters button:has-text("已归档")');
  assert((await page.textContent(".assistant-history")).includes("归档对话"), "已归档视图没有展示归档对话");
  await page.click(".assistant-history-toggle");
  /**
   * ⚠️ **量的是「贴着这一页的底」，不是「贴着那张画布的底」。**
   * `.assistant-page__canvas` 已经撤了——那是套在 `.main` 里面的第二层白圆角卡片，
   * 而 `.main` 本身就是浮在应用底色上的面板，白框套白框。
   * 要钉的规矩没变（输入框永远在最底下、AI 跑起来时不许位移），换的只是参照物。
   */
  const composerBefore = await page.locator(".assistant-pane--standalone .assistant-composer").boundingBox();
  const pageBox = await page.locator(".assistant-page").boundingBox();
  const composerGap = pageBox && composerBefore ? pageBox.y + pageBox.height - composerBefore.y - composerBefore.height : -1;
  assert(composerBefore && composerGap >= 10 && composerGap <= 28, `独立对话输入框没有贴着这一页的底部：gap=${composerGap}`);
  // ⚠️ 顺便钉住「没有第二层容器」：它回来一次就又是白框套白框
  assert(!(await page.$(".assistant-page__canvas")), "独立对话页又套回了一层画布容器");
  await page.fill('.assistant-pane--standalone textarea[placeholder*="问任何问题"]', "帮我找一个值得继续思考的问题");
  await page.click('.assistant-pane--standalone button[aria-label="发送"]');
  await page.waitForSelector(".assistant-pane--standalone .assistant-working");
  const composerDuring = await page.locator(".assistant-pane--standalone .assistant-composer").boundingBox();
  assert(Math.abs(composerDuring.y - composerBefore.y) < 2, "AI 运行时输入框发生了位移");
  await page.waitForFunction(() => document.querySelector(".assistant-pane--standalone .assistant-message--assistant")?.textContent.includes("0.2s"));
  assert(await page.$('.assistant-pane--standalone .assistant-message--user button[aria-label="复制消息"]'), "用户消息没有直接复制操作");
  assert(await page.$('.assistant-pane--standalone .assistant-message--user button[aria-label="编辑并重新发送"]'), "最新用户消息没有编辑操作");
  const userBubbleBox = await page.locator(".assistant-pane--standalone .assistant-message__user > p").last().boundingBox();
  const userActionsBox = await page.locator(".assistant-pane--standalone .assistant-message__user-actions").last().boundingBox();
  assert(userBubbleBox && userActionsBox && userActionsBox.y >= userBubbleBox.y + userBubbleBox.height && Math.abs(userActionsBox.x + userActionsBox.width - userBubbleBox.x - userBubbleBox.width) <= 2, "用户消息操作没有贴在气泡下方右侧");
  await page.screenshot({ path: path.join(ROOT, "tmp", "assistant-standalone-final.png"), fullPage: false });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: path.join(ROOT, "tmp", "assistant-standalone-final-1920.png"), fullPage: false });
  assert(!(await page.$('.assistant-pane--standalone button:has-text("作为候选插入")')), "独立对话不应出现稿件插入操作");
  console.log("✓ 左侧 AI 助手打开独立对话页，输入框始终贴底");
  assert(errors.length === 0, `浏览器报错：${errors.join(" | ")}`);
  console.log("✓ 起始句可换、可插入");
  console.log("✓ 连续两次 AI 小推动都返回新结果");
  console.log("✓ 风格提示词不在编辑器修改，只在帮我写时选择并实际进入生成请求");
  console.log("✓ AI 协作固定由写作教练负责，不再出现统一专家下拉框");
  console.log("✓ 素材查缺启动可持续的专家任务，报告展示本地与网页来源且不改正文");
  console.log("✓ 浮层位于页面顶部中央，等待图标实际播放转动动画");
  console.log("✓ AI 续写先预览，并在当前光标精确插入、不额外换行");
  console.log("✓ 长结果限制高度并在浮层内部滚动");
  console.log("✓ 新建文章与稿件库正式编辑器都把当前光标发给 AI");
  console.log("✓ 图标按钮都有名称和悬停说明");
  console.log("✓ AI 续写可在底纹内修改、确认后退底纹，并能回看原稿");
  console.log("✓ 两个编辑入口都有选区修订工具，采纳前正文保持不变");
  console.log("✓ 局部修订支持自定义要求、重新生成、直接编辑、stale 检测和精确采纳");
  console.log("✓ Grounding 展示 used/skipped/unverified，服务端拒绝会进入 failed");
  console.log("✓ 弃用修订不改变正文，并持久记录弃用决定");
  console.log("✓ 修订历史跨编辑器重开仍可回看原文与最终候选");
  console.log("✓ 浏览器控制台 0 错误");
} finally {
  await browser.close();
  await server.close();
}
