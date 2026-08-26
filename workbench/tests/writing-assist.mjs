/** AI 协作的真实浏览器闭环：推动、梳理和候选写作都必须由用户明确采用。 */
import { createServer } from "vite";
import { createRequire } from "node:module";

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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
      questions: Array.from({ length: 9 }, (_, index) => ({ id: `q${index + 1}`, status: index < 7 ? "pass" : "revise", finding: `品控问题 ${index + 1}`, direction: index < 7 ? "保留" : "补一处具体情境" })),
      mustFix: ["补充一个读者当下会遇到的具体场景"],
    } : {
      kind,
      summary: "共提取一项可核查表述，目前证据不足。",
      claims: [{ quote: "增长 30%", location: "第二段", status: "待核", risk: "缺少统计口径", suggestion: "补充来源和年份", localSources: [], webSources: [{ title: "公开数据页", url: "https://example.com/data", excerpt: "需核对统计口径。" }] }],
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
  const text = revisionRequests.length === 1
    ? "第一版候选：把最重要的判断说清楚，再删掉不服务于这个判断的句子。"
    : "第二版候选：先说清最重要的判断，再删掉无关句子。";
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: body.mode, kind: "润色", text }) });
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
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversation: { messages: assistantMessages, actions: [], attachments: [], permissionMode: "daily", model: "test-model" } }) });
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
  const body = request.postDataJSON();
  assistantRequests.push(body);
  const sentAttachmentIds = assistantAttachments.filter((item) => !item.usedAt).map((item) => item.id);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assistantMessages = [
    ...assistantMessages,
    { id: `user-${assistantMessages.length}`, role: "user", text: body.message, attachmentIds: sentAttachmentIds, createdAt: new Date().toISOString() },
    { id: `assistant-${assistantMessages.length}`, role: "assistant", text: "建议先把读者最难承认的代价写出来，再用一个真实场景支撑。", createdAt: new Date().toISOString(), engine: "Pi Agent SDK", durationMs: 180 },
  ];
  assistantAttachments = assistantAttachments.map((item) => sentAttachmentIds.includes(item.id) ? { ...item, usedAt: new Date().toISOString() } : item);
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversation: { messages: assistantMessages, attachments: assistantAttachments, actions: [], permissionMode: "daily", model: body.model || "test-model" } }) });
});

function assert(value, message) {
  if (!value) throw new Error(message);
}

function editorValue(selector) {
  return page.$eval(selector, (content) => Array.from(content.children).filter((line) => line.classList.contains("cm-line")).map((line) => line.textContent).join("\n"));
}

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
    const railTabs = await page.$$eval(".project-assistant__tabs button", (items) => items.map((item) => item.textContent.trim().replace(/\d+$/, "")));
    assert(railTabs.join("/") === "AI 助手/项目素材/检查报告", `右栏入口不完整：${railTabs.join("/")}`);
    assert(!(await page.$(".project-draft .writing-assist__trigger")) && !(await page.$('.project-draft .writing-tool-btn:has-text("检查")')), "项目编辑器仍保留重复的 AI 协作或检查入口");

    await page.click(".project-draft .cm-content");
    await page.keyboard.type("收藏处理的是焦虑，而不是内容。");
    await page.selectOption(".assistant-context-style select", "story-led");
    assert(styleSaves.length === 0, "编辑器调用风格时不该修改或保存提示词");
    assert(await page.evaluate(() => localStorage.getItem("xenho-assistant-model")) === "test-model", "AI 助手没有记住已用模型");

    assert(!(await page.$('.assistant-composer footer button:has-text("专家")')) && !(await page.$('.assistant-composer footer button:has-text("Skill")')), "输入框底部仍显示专家或 Skill 按钮");
    assert(await page.$(".assistant-composer .assistant-composer__access"), "输入框底部没有唯一的权限入口");
    await page.click(".assistant-composer__access");
    assert((await page.$$(".assistant-permission-menu > button")).length === 3, "权限浮层没有三种预设");
    const permissionText = await page.textContent(".assistant-permission-menu");
    assert(!permissionText.includes("可访问范围") && !permissionText.includes("允许修改与命令"), "权限浮层仍混入路径或命令设置");
    await page.keyboard.press("Escape");
    assert(!(await page.$(".assistant-pane__context .assistant-mode-select")), "权限仍占在对话顶栏");
    await page.fill(".assistant-composer textarea", "@");
    const experts = await page.$$eval(".assistant-command-menu [role=menuitem] b", (items) => items.map((item) => item.textContent.trim()));
    assert(experts.join("/") === "写作教练/素材顾问/审稿顾问/事实核查", `专家菜单不完整：${experts.join("/")}`);
    await page.click('.assistant-command-menu header button');
    await page.fill(".assistant-composer textarea", "/");
    const skills = await page.$$eval(".assistant-command-menu [role=menuitem] b", (items) => items.map((item) => item.textContent.trim()));
    assert(skills.join("/") === "fact-check/idea-dialogue/interview-to-draft/material-extraction/material-gap/publish-review/topic-clustering/xenho-quality-nine", "Skill 菜单不完整：" + skills.join("/"));
    await page.click('.assistant-command-menu [role=menuitem]:has-text("fact-check")');
    assert((await page.inputValue(".assistant-composer textarea")).includes("/fact-check"), "选择 Skill 后没有插入 Pi Skill 命令");
    await page.fill(".assistant-composer textarea", "");
    await page.click(".project-draft .cm-content");
    await page.keyboard.press("Control+Home");
    for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
    await page.waitForFunction(() => document.querySelector(".assistant-context-chip[data-live=true]")?.textContent.includes("选中 6 字"));
    assert((await editorValue(".project-draft .cm-content")).startsWith("收藏处理的是"), "选择 Skill 前后不应改动正文");

    await page.click(".project-draft .cm-content");
    await page.keyboard.press("Control+End");
    await page.fill('.assistant-composer textarea[placeholder*="问当前内容"]', "给我一个具体的修改建议");
    await page.click('.assistant-composer button[aria-label="发送"]');
    await page.waitForSelector(".assistant-working");
    const orbit = await page.$eval(".assistant-orbit", (item) => getComputedStyle(item).animationName);
    assert(orbit !== "none", "Pi 工作状态没有动态指示");
    await page.waitForFunction(() => document.querySelector(".assistant-message--assistant")?.textContent.includes("真实场景"));
    assert(assistantRequests.at(-1)?.style?.id === "story-led", "AI 助手没有使用编辑器里选择的本次写作风格");
    assert(assistantRequests.at(-1)?.document?.body.includes("收藏处理的是焦虑"), "AI 助手没有收到当前全文");
    const beforeCandidate = await editorValue(".project-draft .cm-content");
    assert(!beforeCandidate.includes("读者最难承认"), "AI 回复在确认前写进了正文");
    await page.click('.assistant-message--assistant button:has-text("作为候选插入")');
    await page.waitForSelector(".cm-ai-draft");
    assert((await editorValue(".project-draft .cm-content")).includes("读者最难承认"), "明确插入候选后正文没有出现内容");
    await page.click('.ai-draft-review button[aria-label="确认采用这段，移除底纹"]');
    await page.waitForSelector(".ai-draft-review", { state: "detached" });

    await page.click('.project-assistant__tabs button:has-text("检查报告")');
    const reportTabs = await page.$$eval(".assistant-reports > nav button", (items) => items.map((item) => item.textContent.trim()));
    assert(reportTabs.join("/") === "素材查验/审稿建议/事实核查", `检查报告分类不完整：${reportTabs.join("/")}`);
    await page.click('.assistant-report-empty button:has-text("开始素材查验")');
    await page.waitForSelector(".assistant-report-running .assistant-orbit");
    await page.waitForSelector('.assistant-report-error button:has-text("重新检查")');
    await page.click('.assistant-report-error button:has-text("重新检查")');
    await page.waitForFunction(() => document.querySelector(".assistant-report-result")?.textContent.includes("本地知识卡"));
    assert((await page.textContent(".assistant-report-result")).includes("权威网页来源"), "持久报告没有展示本地与公开来源");

    await page.click('.project-assistant__tabs button:has-text("项目素材")');
    assert(await page.$(".project-assistant__materials"), "项目素材没有留在统一右栏");
    console.log("✓ 项目编辑器统一为 AI 助手、项目素材、检查报告三入口");
    console.log("✓ @ 专家、/ Skill、选区与本次风格均进入真实调用上下文");
    console.log("✓ 对话建议和选区修订都先给候选，明确采纳后才改正文");
    console.log("✓ 专家工作状态动态展示，失败可重试，报告关闭后仍有固定入口");
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
  assert(checks.length === 3 && checks.every((item) => /素材查缺|审一遍|事实核查/.test(item)), `检查任务不完整：${checks.join("/")}`);
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
  await page.waitForSelector(".text-revision-review textarea");
  assert(revisionRequests[legacyRevisionStart]?.instruction === "更克制", "自定义润色要求没有发给 AI");
  const compareDocument = await editorValue(".ws-edit .cm-content");
  const visuallySplitDocument = `${existingAfter.slice(0, 12)}\n${existingAfter.slice(12)}`;
  assert(compareDocument === visuallySplitDocument, "对比阶段除候选卡片占位外改变了正文内容");
  const compareStyle = await page.evaluate(() => ({
    strike: getComputedStyle(document.querySelector(".cm-text-revision-original")).textDecorationLine,
    wash: getComputedStyle(document.querySelector(".text-revision-review textarea")).backgroundColor,
  }));
  assert(compareStyle.strike.includes("line-through"), "对比状态的原文没有删除线");
  assert(compareStyle.wash !== "transparent" && compareStyle.wash !== "rgba(0, 0, 0, 0)", "修订候选没有轻量底纹");
  await page.fill('.text-revision-review__command input[aria-label="调整修订要求"]', "更克制、更直接");
  await page.click('.text-revision-review__command button[aria-label="重新生成"]');
  await page.waitForFunction(() => document.querySelector(".text-revision-review textarea")?.value.includes("第二版候选"));
  assert(revisionRequests[legacyRevisionStart + 1]?.instruction === "更克制、更直接", "重新生成没有沿用调整后的要求");
  await page.fill('.text-revision-review textarea[aria-label="AI 修订候选，可直接编辑"]', "这是用户调整后的最终候选。 ");
  await page.screenshot({ path: path.join(ROOT, "tmp", "text-revision-review.png"), fullPage: false });
  await page.click('.text-revision-review__decide button:has-text("采纳")');
  await page.waitForSelector(".text-revision-review", { state: "detached" });
  const revisedAfter = await editorValue(".ws-edit .cm-content");
  assert(revisedAfter === `这是用户调整后的最终候选。${existingAfter.slice(12)}`, "采纳没有精确替换原选区");
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
  console.log("✓ 局部修订支持自定义要求、重新生成、直接编辑和精确采纳");
  console.log("✓ 弃用修订不改变正文，并持久记录弃用决定");
  console.log("✓ 修订历史跨编辑器重开仍可回看原文与最终候选");
  console.log("✓ 浏览器控制台 0 错误");
} finally {
  await browser.close();
  await server.close();
}
