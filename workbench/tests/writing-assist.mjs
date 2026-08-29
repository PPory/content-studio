/** AI 协作的真实浏览器闭环：推动、梳理和候选写作都必须由用户明确采用。 */
import { createServer } from "vite";
import { createRequire } from "node:module";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STAGE6_SHOT_DIR = path.join(ROOT, "tmp", "stage6-production");
const STAGE7_SHOT_DIR = path.join(ROOT, "tmp", "stage7-inline-ai");
const STAGE7_1_SHOT_DIR = path.join(ROOT, "tmp", "stage7-1-inline-ai");
await fs.mkdir(STAGE6_SHOT_DIR, { recursive: true });
await fs.mkdir(STAGE7_SHOT_DIR, { recursive: true });
await fs.mkdir(STAGE7_1_SHOT_DIR, { recursive: true });
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
const revisionRequests = [];
// 正文里那次问答「搬」进右栏的请求。**搬**不是重问，所以它不该同时出现在 assistantRequests 里。
const assistantAdopted = [];
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
await page.route("**/api/pipe/text-revision", async (route) => {
  const body = route.request().postDataJSON();
  revisionRequests.push(body);
  const rejected = body.instruction?.includes("真实性拒绝");
  /**
   * 自由指令回来的东西**确实是这段字的改动版**时，结果该落进正文画 diff，不是停在卡片里。
   * 这条判据看的是回来的东西（`looksLikeEdit`），不是用户怎么唤起的。
   */
  if (body.instruction?.includes("润色优化")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: body.mode, kind: "改写", text: `${body.selected}，再说透一点。`, grounding: { used: [], skipped: [], unverified: [], gate: "passed" } }) });
  }
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
  if (url.pathname.endsWith("/adopt")) {
    const adoptBody = request.postDataJSON();
    assistantAdopted.push(adoptBody);
    // ⚠️ **不动 `assistantMessages`。** 搬过去的是**另一段**对话，混进当前这段会让
    // 后面那些「第一条助手消息是什么」的断言读到别人的消息。
    const adoptedMessages = [
      { id: "user-adopt", role: "user", text: adoptBody.prompt, createdAt: new Date().toISOString(), origin: "editor" },
      { id: "assistant-adopt", role: "assistant", text: adoptBody.answer, createdAt: new Date().toISOString(), engine: "Pi Agent SDK", origin: "editor" },
    ];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversation: { id: "chat-adopted", title: "改写这一段", messages: adoptedMessages, actions: [], attachments: [], permissionMode: "daily", model: "test-model" } }) });
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
async function inlineMenuLayout(editorSelector) {
  return page.evaluate((selector) => {
    const menu = document.querySelector(".text-revision-menu");
    const editor = document.querySelector(selector);
    if (!menu || !editor) return null;
    const menuRect = menu.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    return {
      menu: { left: menuRect.left, top: menuRect.top, right: menuRect.right, bottom: menuRect.bottom },
      editor: {
        left: Math.max(0, editorRect.left),
        top: Math.max(0, editorRect.top),
        right: Math.min(window.innerWidth, editorRect.right),
        bottom: Math.min(window.innerHeight, editorRect.bottom),
      },
      placement: menu.dataset.placement,
    };
  }, editorSelector);
}

async function assertInlineMenuInside(editorSelector, label) {
  const layout = await inlineMenuLayout(editorSelector);
  assert(layout
    && layout.menu.left >= layout.editor.left + 7
    && layout.menu.right <= layout.editor.right - 7
    && layout.menu.top >= layout.editor.top + 7
    && layout.menu.bottom <= layout.editor.bottom - 7,
  `${label} 越出编辑器可视区域：${JSON.stringify(layout)}`);
  return layout;
}

async function moveCursorNearViewportBottom(editorSelector) {
  await page.focus(`${editorSelector} .cm-content`);
  await page.keyboard.press("Control+End");
  await page.evaluate((selector) => {
    const editor = document.querySelector(selector);
    const scroller = editor?.querySelector(".cm-scroller");
    const cursor = editor?.querySelector(".cm-cursor");
    if (!scroller || !cursor) return;
    const boundary = scroller.getBoundingClientRect();
    const caret = cursor.getBoundingClientRect();
    const desiredBottom = boundary.bottom - 14;
    scroller.scrollTop = Math.max(0, scroller.scrollTop - (desiredBottom - caret.bottom));
  }, editorSelector);
  await page.waitForTimeout(120);
}

/**
 * 编辑器里**真正的正文**。
 *
 * ⚠️ 不能直接读 `.cm-line` 的 textContent：行里现在挂着两类不属于文档的 widget——
 * diff 的新增文字（`.cm-diff-ins`，采纳前正文一个字节都没改）和光标行的灰字提示
 * （`.cm-line-affordance`）。把它们算进来的话，「候选生成前后正文没变」这条断言
 * 会在功能完全正确的时候失败。
 */
function editorValue(selector) {
  return page.$eval(selector, (content) => Array.from(content.children)
    .filter((line) => line.classList.contains("cm-line"))
    .map((line) => {
      const copy = line.cloneNode(true);
      copy.querySelectorAll(".cm-diff-ins, .cm-line-affordance").forEach((node) => node.remove());
      return copy.textContent;
    })
    .join("\n"));
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
   * ⚠️ **必须挑一个正文可编辑的项目。** 内联 AI 写作动作只在 target 可编辑时出现；
   * 待发布、待复盘的正文是只读的，盲点第一个会让后续能力矩阵断言失去意义。
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
    // 模型现在每个输入框都有：在哪儿写字，就在哪儿决定用哪个模型发出去。
    // 保持安静的是**权限和风格**——会话级设置，只在完整工作区设一次。
    assert(await page.$(".project-assistant .assistant-composer__model"), "项目协作栏的输入框不能选模型");
    assert(!(await page.$(".project-assistant .assistant-composer__access")) && !(await page.$(".project-assistant .assistant-composer__style")), "Project Composer 仍常驻显示权限或风格");
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

    const edgeDocument = [
      "顶部一行用于验证光标靠近标题、编辑器左侧和右侧时，内联 AI 菜单仍然只占正文可视区域而不遮挡两侧面板。",
      "左边界选区从这里开始，接下来会跨过多行，验证真实选区矩形。",
      ...Array.from({ length: 42 }, (_, index) => `第 ${index + 1} 行正文用于滚动定位；菜单必须跟随真实光标重排，而不是使用页面固定偏移。`),
    ].join("\n");
    await page.click(".project-draft .cm-content");
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(edgeDocument);

    await page.keyboard.press("Control+Home");
    for (let index = 0; index < 8; index += 1) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Alt+Enter");
    await page.waitForSelector(".inline-ai-prompt");
    const projectTopLayout = await assertInlineMenuInside(".project-draft .cm-scroller", "Project 顶部光标菜单");
    assert(projectTopLayout.placement === "below", `Project 顶部光标菜单没有向下翻转：${JSON.stringify(projectTopLayout)}`);
    await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1366-project-cursor-top.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await page.waitForSelector(".inline-ai-prompt", { state: "detached" });
    assert(await page.evaluate(() => document.activeElement?.classList.contains("cm-content")), "Project 光标菜单 Esc 后没有恢复编辑器焦点");

    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Alt+Enter");
    await page.waitForSelector(".inline-ai-prompt");
    await assertInlineMenuInside(".project-draft .cm-scroller", "Project 左侧光标菜单");
    await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1366-project-cursor-left.png"), fullPage: false });
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+Home");
    await page.keyboard.press("End");
    await page.keyboard.press("Alt+Enter");
    await page.waitForSelector(".inline-ai-prompt");
    await assertInlineMenuInside(".project-draft .cm-scroller", "Project 右侧光标菜单");
    await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1366-project-cursor-right.png"), fullPage: false });
    await page.keyboard.press("Escape");

    await moveCursorNearViewportBottom(".project-draft");
    await page.keyboard.press("Alt+Enter");
    await page.waitForSelector(".inline-ai-prompt");
    const projectBottomLayout = await assertInlineMenuInside(".project-draft .cm-scroller", "Project 底部光标菜单");
    assert(projectBottomLayout.placement === "above", `Project 底部光标菜单没有向上翻转：${JSON.stringify(projectBottomLayout)}`);
    await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1366-project-cursor-bottom.png"), fullPage: false });
    await page.keyboard.press("Escape");

    await page.focus(".project-draft .cm-content");
    await page.keyboard.press("Control+Home");
    for (let index = 0; index < 20; index += 1) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Alt+Enter");
    await page.waitForSelector(".inline-ai-prompt");
    const middleBeforeScroll = await assertInlineMenuInside(".project-draft .cm-scroller", "Project 滚动前的光标菜单");
    await page.$eval(".main", (item) => { item.scrollTop += 48; });
    await page.waitForTimeout(180);
    const middleAfterScroll = await assertInlineMenuInside(".project-draft .cm-scroller", "Project 滚动后的光标菜单");
    assert(Math.abs(middleAfterScroll.menu.top - middleBeforeScroll.menu.top) > 10, `Project 滚动后光标菜单没有跟随锚点重定位：${JSON.stringify({ middleBeforeScroll, middleAfterScroll })}`);
    await page.keyboard.press("Escape");

    await page.focus(".project-draft .cm-content");
    await page.keyboard.press("Control+Home");
    await page.$eval(".project-draft .cm-content", (item) => {
      item.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
      item.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", altKey: true, isComposing: true, keyCode: 229 }));
    });
    await page.waitForTimeout(100);
    assert(!(await page.$(".inline-ai-prompt")), "Project 中文输入法 composition 期间误触发 Alt+Enter 菜单");
    await page.$eval(".project-draft .cm-content", (item) => item.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中" })));

    await page.keyboard.press("Control+Home");
    for (let index = 0; index < 3; index += 1) await page.keyboard.press("Shift+ArrowDown");
    await page.waitForSelector(".text-revision-menu");
    await assertInlineMenuInside(".project-draft .cm-scroller", "Project 左边界长选区菜单");
    await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1366-project-selection-left.png"), fullPage: false });
    // 方向键在**三段之间连续走**：格式那排走完接着走 AI 技能，不用先跳出面板再进来
    const projectMenuOrder = await page.$$eval(".selection-menu [data-inline-ai-action=true]", (items) => items.map((item) => item.getAttribute("aria-label") || item.textContent.trim()));
    assert(projectMenuOrder[0] === "加粗" && projectMenuOrder.includes("纠错") && !projectMenuOrder.includes("标题级别"),
      `选区面板没有把格式和 AI 技能排进同一条焦点链，或块类型下拉又回来了：${projectMenuOrder.join("/")}`);
    // 面板打开时**没有元素抢焦点**（选区还在，用户可能只是想继续调选区），
    // 所以第一次 ArrowRight 才落到第 0 项——走到第 N 项要按 N+1 次
    const correctIndex = projectMenuOrder.indexOf("纠错");
    for (let index = 0; index <= correctIndex; index += 1) await page.keyboard.press("ArrowRight");
    const projectKeyboardAction = await page.evaluate(() => document.activeElement?.textContent?.trim());
    assert(projectKeyboardAction === "纠错", `Project 方向键没有走到 AI 技能那一段：${projectKeyboardAction}`);
    const beforeKeyboardCandidate = await editorValue(".project-draft .cm-content");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".project-draft .revision-bar");
    assert((await editorValue(".project-draft .cm-content")).replace(/\n/g, "") === beforeKeyboardCandidate.replace(/\n/g, ""), "Project Enter 执行 Candidate 前修改了正文");
    // diff 就画在正文原位置：删掉的字带删除线，新增的字是零宽 widget
    assert(await page.$(".project-draft .cm-diff-ins, .project-draft .cm-diff-del"), "候选没有在正文原位置画出 diff");
    await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1366-project-candidate.png"), fullPage: false });
    // 焦点此刻在正文里（人正在读那段 diff），快捷键必须在这儿就能用
    await page.focus(".project-draft .cm-content");
    await page.keyboard.press("Control+Backspace");
    await page.waitForSelector(".project-draft .revision-bar", { state: "detached" });

    await page.focus(".project-draft .cm-content");
    await page.keyboard.press("Control+Home");
    for (let index = 0; index < 8; index += 1) await page.keyboard.press("Shift+ArrowRight");
    await page.waitForSelector(".text-revision-menu");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".text-revision-menu", { state: "detached" });
    assert(await page.evaluate(() => document.activeElement?.classList.contains("cm-content") && !window.getSelection().isCollapsed), "Project 选区菜单 Esc 后没有恢复原选区与编辑器焦点");
    await page.keyboard.press("ArrowLeft");
    for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
    await page.waitForSelector(".text-revision-menu");
    await page.click(".project-draft__title");
    await page.waitForSelector(".text-revision-menu", { state: "detached" });

    await page.setViewportSize({ width: 1180, height: 768 });
    await page.click(".project-draft .cm-content");
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Alt+Enter");
    await page.waitForSelector(".inline-ai-prompt");
    await assertInlineMenuInside(".project-draft .cm-scroller", "1180 Project 光标菜单");
    await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1180-project-cursor-menu.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Home");
    for (let index = 0; index < 18; index += 1) await page.keyboard.press("Shift+ArrowRight");
    await page.waitForSelector(".text-revision-menu");
    await assertInlineMenuInside(".project-draft .cm-scroller", "1180 Project 选区菜单");
    await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1180-project-selection-menu.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1366, height: 768 });

    await page.click(".project-draft .cm-content");
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText("收藏处理的是焦虑，不是信息。");
    await page.keyboard.press("Control+End");
    const projectCursorBefore = await editorValue(".project-draft .cm-content");
    await page.keyboard.press("Alt+Enter");
    await page.waitForSelector(".inline-ai-prompt");
    /**
     * 输入条**只有一条输入框**（Notion 按空格之后就是这样）。
     * 不用打字就能起的那两件事住在 `/` 菜单的「建议」组里，不在这儿排成一排按钮。
     */
    assert(await page.evaluate(() => document.activeElement === document.querySelector('.inline-ai-prompt input[aria-label="让 AI 写什么"]')),
      "行内 AI 输入条没有把焦点放在输入框上");
    assert(!(await page.$(".inline-ai-prompt [data-inline-ai-action=true]")), "行内 AI 输入条又挂上了预设按钮排");
    assert(!(await page.$(".project-draft .writing-assist__trigger")), "Project 编辑器仍有常驻 AI 按钮");
    await page.screenshot({ path: path.join(STAGE7_SHOT_DIR, "project-cursor-menu.png"), fullPage: false });
    await page.keyboard.press("Escape");
    // 「想一想」从 `/` 的建议组进来
    await page.focus(".project-draft .cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("/");
    await page.waitForSelector(".block-insert-menu");
    /**
     * **生成新内容和回答问题进「回答卡」，不进 diff。**
     *
     * 它们没有「原文」可比——用户要的是一段新的字或一个答案。硬塞进 diff 的结果是
     * 答案顶掉原文：选中一段问「这段在讲什么」会变成一次改写。卡片里正文一个字不动。
     */
    await page.click('.block-insert-menu__group > button:has-text("想一想")');
    await page.waitForSelector(".project-draft .ai-answer");
    assert(!(await page.$(".project-draft .revision-bar")), "想一想不该产生候选 diff");
    assert((await editorValue(".project-draft .cm-content")) === projectCursorBefore, "想一想不应修改正文");
    assert(requests.at(-1)?.mode === "nudge" && requests.at(-1)?.cursor === projectCursorBefore.length, "Project 光标位置没有交给想一想");
    await page.screenshot({ path: path.join(STAGE7_SHOT_DIR, "project-answer-card.png"), fullPage: false });
    // 卡片上没有「替换所选内容」——这次不是从选区来的
    await page.waitForSelector(".project-draft .ai-answer__actions");
    const cursorAnswerActions = await page.$$eval(".project-draft .ai-answer__actions button", (items) => items.map((item) => item.getAttribute("aria-label")));
    assert(cursorAnswerActions.join("/") === "重试/在下面插入/对话", `光标处回答卡的动作不是三颗图标：${cursorAnswerActions.join("/")}`);
    // **点别处 = 看完了**：卡片直接关掉，正文一个字不动
    await page.click(".project-draft .cm-content", { position: { x: 40, y: 8 } });
    await page.waitForSelector(".project-draft .ai-answer", { state: "detached" });
    assert((await editorValue(".project-draft .cm-content")) === projectCursorBefore, "点别处关掉回答卡后正文发生了变化");

    // 「在下面插入」→ 续写底纹，点别处即落定
    await page.focus(".project-draft .cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("/");
    await page.waitForSelector(".block-insert-menu");
    await page.click('.block-insert-menu__group > button:has-text("续写这一段")');
    await page.waitForSelector(".project-draft .ai-answer");
    assert((await editorValue(".project-draft .cm-content")) === projectCursorBefore, "回答卡在插入前修改了正文");
    await page.screenshot({ path: path.join(STAGE7_SHOT_DIR, "project-inline-candidate.png"), fullPage: false });
    await page.click('.project-draft .ai-answer__actions button[aria-label="在下面插入"]');
    await page.waitForSelector(".project-draft .ai-answer", { state: "detached" });
    await page.waitForSelector(".project-draft .cm-ai-draft");
    assert((await editorValue(".project-draft .cm-content")) !== projectCursorBefore, "在下面插入没有把内容写进正文");
    await page.keyboard.press("Control+Z");
    await page.waitForFunction((before) => {
      const lines = [...document.querySelectorAll(".project-draft .cm-content > .cm-line")];
      const text = lines.map((line) => { const copy = line.cloneNode(true); copy.querySelectorAll(".cm-diff-ins, .cm-line-affordance").forEach((n) => n.remove()); return copy.textContent; }).join("\n");
      return text === before;
    }, projectCursorBefore);
    await page.focus(".project-draft .cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Alt+Enter");
    await page.fill('.inline-ai-prompt input[aria-label="让 AI 写什么"]', "写一个克制的过渡段");
    const requestsBeforeComposition = requests.length;
    await page.$eval('.inline-ai-prompt input[aria-label="让 AI 写什么"]', (item) => {
      item.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "段" }));
      item.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", isComposing: true, keyCode: 229 }));
    });
    await page.waitForTimeout(100);
    assert(requests.length === requestsBeforeComposition && await page.$(".inline-ai-prompt"), "Project 自定义输入 composition 期间误提交");
    await page.$eval('.inline-ai-prompt input[aria-label="让 AI 写什么"]', (item) => item.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "段" })));
    await page.keyboard.press("Enter");
    await page.waitForSelector(".project-draft .ai-answer");
    assert(requests.at(-1)?.mode === "paragraph" && requests.at(-1)?.expert?.includes("本次生成要求：写一个克制的过渡段"), "自由指令没有沿用原有生成能力");
    await page.click(".project-draft .cm-content", { position: { x: 40, y: 8 } });
    await page.waitForSelector(".project-draft .ai-answer", { state: "detached" });

    /**
     * L1 入口：空行灰字 → 空格 → 行内 AI；`/` → 块菜单。
     * 这两条是这一轮的核心——功能一直都在，只是以前只有 `Alt+Enter` 知道怎么进来。
     */
    await page.click(".project-draft .cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".project-draft .cm-line-affordance__hint");
    assert((await page.textContent(".project-draft .cm-line-affordance__hint")).includes("空格"), "空行没有写出内联 AI 的入口");
    /**
     * ⚠️ **行首 `+` 对齐第一行，不是对齐整段的中线。**
     * `.cm-line` 的一「行」是整个逻辑段落（开了自动换行）：两行的段落里，
     * `top: 50%` 会把 `+` 卡在两行之间。
     *
     * ⚠️ **空行的光标压回字的高度，而这一行的总高度不能变**——变了就会在光标
     * 移进移出空行时上下抖。原生光标高度是行框画的，CSS 管不到，只能压行高、
     * 用 padding 把高度补回来。
     */
    const affordanceGeometry = await page.evaluate(() => {
      const cm = document.querySelector(".project-draft .cm-content");
      const lines = [...cm.querySelectorAll(".cm-line")];
      const wrapped = lines.find((line) => line.getClientRects().length > 1 && !line.querySelector(".cm-line-affordance"));
      const emptyLine = document.querySelector(".project-draft .cm-empty-caret-line");
      const plainSingle = lines.find((line) => line.textContent.trim() && line.getClientRects().length === 1);
      const hint = document.querySelector(".project-draft .cm-line-affordance__hint");
      const add = document.querySelector(".project-draft .cm-line-affordance__add");
      const style = getComputedStyle(cm);
      return {
        emptyHeight: emptyLine?.getBoundingClientRect().height ?? 0,
        plainHeight: plainSingle?.getBoundingClientRect().height ?? 0,
        emptyLineHeight: emptyLine ? parseFloat(getComputedStyle(emptyLine).lineHeight) : 0,
        baseLineHeight: parseFloat(style.lineHeight),
        fontSize: parseFloat(style.fontSize),
        addCenter: add ? add.getBoundingClientRect().top + add.getBoundingClientRect().height / 2 : 0,
        hintCenter: hint ? hint.getBoundingClientRect().top + hint.getBoundingClientRect().height / 2 : 0,
        addWidth: add?.getBoundingClientRect().width ?? 0,
        wrappedRectCount: wrapped ? wrapped.getClientRects().length : 0,
      };
    });
    assert(Math.abs(affordanceGeometry.emptyHeight - affordanceGeometry.plainHeight) <= 1,
      `压了空行行高之后这一行的总高度变了，光标进出会抖：${JSON.stringify(affordanceGeometry)}`);
    assert(affordanceGeometry.emptyLineHeight < affordanceGeometry.baseLineHeight
      && affordanceGeometry.emptyLineHeight <= affordanceGeometry.fontSize * 1.3,
      `空行的行高没有压到字的高度，光标仍然比字高：${JSON.stringify(affordanceGeometry)}`);
    assert(Math.abs(affordanceGeometry.addCenter - affordanceGeometry.hintCenter) <= 2,
      `行首 + 和这一行的字没有对齐：${JSON.stringify(affordanceGeometry)}`);
    assert(affordanceGeometry.addWidth >= 20, `行首 + 比正文小一圈：${affordanceGeometry.addWidth}`);
    const beforeSpace = await editorValue(".project-draft .cm-content");
    await page.keyboard.press(" ");
    await page.waitForSelector(".inline-ai-prompt");
    assert((await editorValue(".project-draft .cm-content")) === beforeSpace, "空格劫持成 AI 之后仍然插入了空格");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".inline-ai-prompt", { state: "detached" });
    // 有字的行上空格仍然是空格
    await page.keyboard.type("已经写了字");
    await page.keyboard.press(" ");
    await page.waitForTimeout(80);
    assert(!(await page.$(".inline-ai-prompt")), "有字的行上空格误触发了 AI");
    assert((await editorValue(".project-draft .cm-content")).endsWith("已经写了字 "), "有字的行上空格没有正常插入");
    // `/` 开块菜单，继续打字即过滤，选中后斜杠和过滤词一起被吃掉
    await page.keyboard.press("Enter");
    await page.keyboard.press("/");
    await page.waitForSelector(".block-insert-menu");
    const blockGroups = await page.$$eval(".block-insert-menu__group > small", (items) => items.map((item) => item.textContent.trim()));
    assert(blockGroups.join("/") === "建议/基本区块/媒体", `块菜单分组不对：${blockGroups.join("/")}`);
    await page.screenshot({ path: path.join(STAGE7_SHOT_DIR, "project-block-menu.png"), fullPage: false });
    await page.keyboard.type("标题");
    await page.waitForFunction(() => document.querySelectorAll(".block-insert-menu__group > button").length === 3);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".block-insert-menu", { state: "detached" });
    assert((await editorValue(".project-draft .cm-content")).endsWith("# "), `选中标题 1 后没有吃掉 /标题：${await editorValue(".project-draft .cm-content")}`);
    /**
     * ⚠️ 光标必须落在记号**后面**。落在前面的话接着打的字会跑到 `#` 前，整行不再是标题——
     * 这是用真实打字验的，不看 DOM offset：行里还挂着 `+` 那个 widget，
     * `anchorOffset` 数的是渲染节点里的位置，不是文档里的位置。
     */
    await page.keyboard.type("标题内容");
    assert((await editorValue(".project-draft .cm-content")).endsWith("# 标题内容"), `选完标题后打的字没有落在记号后面：${JSON.stringify(await editorValue(".project-draft .cm-content"))}`);

    /**
     * ⚠️ **采纳之后 `/` 还要能用。** 用户实际的动线是「生成 → 采纳 → 接着在下一行按 /」，
     * 而这一步最容易坏在 `inlineLayerReady`——只要 `textRevisionField.active` 没清干净，
     * 它就一直返回 false，现象是斜杠打进了正文但菜单不出来。
     */
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText("收藏处理的是焦虑，不是信息。");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("/");
    await page.waitForSelector(".block-insert-menu");
    await page.click('.block-insert-menu__group > button:has-text("续写这一段")');
    await page.waitForSelector(".project-draft .ai-answer");
    await page.click('.project-draft .ai-answer__actions button[aria-label="在下面插入"]');
    await page.waitForSelector(".project-draft .ai-answer", { state: "detached" });
    await page.focus(".project-draft .cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("/");
    await page.waitForSelector(".block-insert-menu", { timeout: 4000 });
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+A");
    await page.keyboard.insertText("收藏处理的是焦虑，不是信息。");
    await page.click(".project-draft .cm-content");
    await page.keyboard.press("Control+Home");
    for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
    await page.waitForSelector(".text-revision-menu");
    await page.screenshot({ path: path.join(STAGE7_SHOT_DIR, "project-selection-menu.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await page.waitForSelector(".text-revision-menu", { state: "detached" });

    const beforeSuggestionRequests = assistantRequests.length;
    // 入口卡现在在输入器**下面**（空态时输入器居中，卡片是它的兜底），
    // 所以不再是 .assistant-empty 的后代，而是 dialog 的直接子元素。
    await page.click(".assistant-empty__actions[data-scope='project'] button:first-child");
    assert((await page.inputValue(".project-assistant .assistant-composer textarea")).length > 8, "空态建议没有填入 Composer");
    assert(assistantRequests.length === beforeSuggestionRequests, "空态建议被自动发送");
    await page.fill(".project-assistant .assistant-composer textarea", "@");
    const experts = await page.$$eval(".project-assistant .assistant-command-menu [role=menuitem] b", (items) => items.map((item) => item.textContent.trim()));
    assert(experts.join("/") === "写作教练/素材顾问/审稿顾问/事实核查", `专家菜单不完整：${experts.join("/")}`);
    // 同一个菜单现在有两种结果：不带报告的专家插一段提及，检查类专家直接起任务。
    // 菜单里必须写清楚是哪种，否则只能点一次才知道。
    const runHints = await page.$$eval(".project-assistant .assistant-command-menu [role=menuitem]", (items) => items.map((item) => `${item.querySelector("b").textContent.trim()}|${item.querySelector("small")?.textContent || ""}`));
    assert(runHints.filter((item) => item.includes("跑一次并出报告")).length === 3, `检查类专家没有标出会起任务：${runHints.join(" / ")}`);
    await page.locator('.project-assistant .assistant-command-menu [role=menuitem]:has-text("写作教练")').evaluate((item) => item.click());
    assert((await page.inputValue(".project-assistant .assistant-composer textarea")).includes("@写作教练"), "普通专家没有插入提及");
    await page.fill(".project-assistant .assistant-composer textarea", "");
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

    /**
     * ⚠️ **右栏那颗「插入」在光标处就是插入，不是候选审阅。**
     *
     * 候选审阅回答的是「改成这样好不好」——它得有原文可比。光标处插入时原文是空串，
     * 一条 250 字的回复于是被判成「章节」，弹出整屏「章节审阅」：
     * 一次插入被当成一次全篇改造，而屏幕上根本没有第二个版本可比。
     * 判据和 `looksLikeEdit` 是同一条：在改已有的字才审阅，产出新的字就插入。
     */
    const beforeCandidate = await editorValue(".project-draft .cm-content");
    await page.click(".project-draft .cm-content");
    await page.keyboard.press("Control+End");
    await page.click('.project-assistant .assistant-message--assistant button[aria-label="插入正文"]');
    await page.waitForSelector(".project-draft .cm-ai-draft");
    assert(!(await page.$(".md-candidate-focus")), "光标处插入弹出了整屏章节审阅");
    const afterInsert = await editorValue(".project-draft .cm-content");
    assert(afterInsert !== beforeCandidate && afterInsert.startsWith(beforeCandidate), "插入没有落到正文末尾");
    // 动作条只有图标：一栏对话里这排字比要读的回复还抢眼
    const messageActions = await page.$$eval(".project-assistant .assistant-message--assistant footer button", (items) => items.map((item) => item.textContent.trim()));
    assert(messageActions.every((label) => label === ""), `回复动作条又挂上了文字：${messageActions.join("/")}`);
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-inline-candidate.png"), fullPage: false });
    // 插进来的字带底纹（和续写、回答卡「在下面插入」同一条路），撤销走 Ctrl+Z
    assert((await page.textContent(".project-draft .cm-ai-draft")).length > 0, "插进来的字没有带上 AI 底纹");
    await page.click(".project-draft .cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Control+Z");
    await page.waitForFunction((expected) => (document.querySelector(".project-draft .cm-content")?.textContent || "").length <= expected, beforeCandidate.length + 8);

    /**
     * ⚠️ **「这一轮 AI 读到什么」住在输入框里，不在顶上那条 header 里。**
     * 你正要打字的地方，才是需要知道它读什么的时刻。
     */
    assert(await page.$(".project-assistant .assistant-composer .project-assistant__context-trigger"), "上下文入口没有跟着输入框走");
    /**
     * ⚠️ **芯片写这一篇的名字，不是写「当前稿件」。**
     * 分类名对任何一篇都成立，看了等于没看；这颗芯片要回答的是「AI 读的是哪一篇」。
     * 「暂无素材」也撤了——素材清单在面板里就有，这儿写它只是每次都在提醒你少干了件事。
     */
    const contextChipText = (await page.textContent(".project-assistant__context-trigger")).trim();
    const draftTitle = (await page.inputValue(".project-draft__title")).trim();
    assert(draftTitle && contextChipText.includes(draftTitle.slice(0, 8)), `上下文芯片没有写这一篇的标题：${JSON.stringify({ contextChipText, draftTitle })}`);
    assert(!contextChipText.includes("当前稿件") && !/素材/.test(contextChipText), `上下文芯片还留着分类名或素材计数：${contextChipText}`);
    assert(!(await page.$(".project-assistant .assistant-pane__context .project-assistant__context-trigger")), "header 里还留着一份上下文入口");
    await page.click(".project-assistant__context-trigger");
    await page.waitForSelector(".project-context-panel");
    // 面板必须向上开：触发器在最底下的输入框上，向下开等于开到视口外面
    const contextPanelBox = await page.locator(".project-context-panel").boundingBox();
    const composerBox = await page.locator(".project-assistant .assistant-composer").boundingBox();
    assert(contextPanelBox.y + contextPanelBox.height <= composerBox.y + 2, `上下文面板没有向上展开：${JSON.stringify({ contextPanelBox, composerBox })}`);
    const contextText = await page.textContent(".project-context-panel");
    assert(contextText.includes("当前主稿"), "上下文面板没有说明当前带上了什么");
    // 「项目检查」搬去输入框的 `@` 了：这块面板只回答「这一轮 AI 读到什么」，
    // 不再把最低频的执行按钮摆在最显眼的地方。
    assert(!contextText.includes("项目检查") && !(await page.$(".project-context-panel__reports")), "上下文面板又长回项目检查");
    assert(!contextText.includes("已核验"), "上下文面板仍在每条素材重复显示已核验文字");
    assert((await page.$$(".project-context-material")).length === 10 && contextText.includes("待核验"), "10 条素材 Context 没有完整滚动列表或待核验状态");
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-context-10.png"), fullPage: false });
    // 点空白就收起。**每一个点开的浮层都要遵守这条**——否则用户得记住哪个能点外面关、
    // 哪个必须回去点原来那颗按钮，记不住的结果是每次都先试一下。
    await page.click(".project-assistant .assistant-composer textarea");
    await page.waitForSelector(".project-context-panel", { state: "detached" });
    /**
     * 检查现在和别的专家同一个入口：`@审稿顾问`。
     * 选中它不是插一段提及而是**直接起任务**，所以那半截 `@…` 必须自己消失——
     * 留在输入框里的话，下一句话会莫名其妙带上一个没人再用的提及。
     */
    await page.fill(".project-assistant .assistant-composer textarea", "@审稿");
    await page.locator('.project-assistant .assistant-command-menu [role=menuitem]:has-text("审稿顾问")').evaluate((item) => item.click());
    assert((await page.inputValue(".project-assistant .assistant-composer textarea")) === "", "起检查任务后输入框里还留着半截 @ 命令");
    // 状态芯片**只在有话说的时候出现**：跑着的时候报进度，报告好了给入口，看过就没了。
    await page.waitForSelector('.project-assistant__run-chip[data-state="running"]');
    await page.waitForSelector('.project-assistant__run-chip[data-state="ready"]', { timeout: 10000 });
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-run-chip.png"), fullPage: false });
    await page.click('.project-assistant__run-chip[data-state="ready"]');
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
    await page.waitForSelector(".project-draft .revision-bar");
    assert(await page.$(".project-assistant:not([data-reviewing])"), "退出报告后项目会话没有恢复");
    assert((await page.textContent(".project-assistant .assistant-thread")).includes("真实场景"), "退出报告后原会话内容丢失");
    await page.click('.project-draft .revision-bar .revision-bar__actions button[aria-label="弃用"]');

    /**
     * ⚠️ **收起之后那片区域必须留一个标记。**
     * 这一列收起就是整列消失，消失之后那儿什么都没有——想让它回来只能抬头去顶栏。
     * 浮标让「收起」和「展开」成为同一处的两个状态。栏开着时它不该出现。
     */
    assert(!(await page.$(".assistant-orb")), "协作栏开着的时候也画了浮标");
    await page.click('.project-assistant button[aria-label="收起协作区"]');
    await page.waitForSelector(".assistant-orb");
    assert(!(await page.locator(".project-assistant .assistant-composer").isVisible()), "收起之后协作栏还在");
    const orbBox = await page.locator(".assistant-orb").boundingBox();
    const viewport = page.viewportSize();
    assert(orbBox.x + orbBox.width > viewport.width - 120 && orbBox.y + orbBox.height > viewport.height - 120,
      `浮标没有停在右下角这一列消失的地方：${JSON.stringify(orbBox)}`);
    /**
     * 说明**指到才出现**。常驻的话这行字一直浮在正文右下角——它是给第一次见到这个
     * 圆圈的人看的，之后每一屏正文都要绕开它。键盘聚焦也算「指到」。
     */
    const orbLabel = async () => page.evaluate(() => Number(getComputedStyle(document.querySelector(".assistant-orb__label")).opacity));
    assert(await orbLabel() === 0, "浮标说明常驻在正文上");
    await page.hover(".assistant-orb__button");
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".assistant-orb__label")).opacity) === 1);
    await page.mouse.move(10, 10);
    await page.focus(".assistant-orb__button");
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".assistant-orb__label")).opacity) === 1);
    await page.click(".assistant-orb__button");
    await page.waitForSelector(".assistant-orb", { state: "detached" });
    await page.waitForFunction(() => document.activeElement === document.querySelector(".project-assistant .assistant-composer textarea"));

    /**
     * ⚠️ **侧栏里没有历史入口**，所以这里也没有「翻回上一段」这条路可测。
     * 这一栏是「现在这段对话」的地方；旧会话不该由一个 420px 的抽屉来翻。
     * 钉住的是「它没有长回来」，判据在 smoke 的 Stage 6。
     */
    assert(!(await page.$('.project-assistant [aria-label="最近会话"]')), "侧栏又长出历史对话入口");
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
    await page.locator('.selection-menu__skills button:has-text("纠错")').evaluate((item) => item.click());
    await page.waitForSelector(".md-candidate-focus .candidate-card .revision-diff");
    assert(/章节审阅|全文审阅/.test(await page.textContent(".md-candidate-focus")) && (await page.textContent(".md-candidate-focus")).includes("弃用并结束审阅"), "大章节或全文 Candidate 没有进入专注审阅或退出文案不清楚");
    // 专注审阅是**单栏 diff**：不再上面压一块原文、下面一个装新文本的框
    assert(!(await page.$(".md-candidate-focus textarea")) && !(await page.$(".md-candidate-focus__original")), "专注审阅仍在并排展示原文与候选文本框");
    /**
     * ⚠️ **专注审阅不吃「点别处即采纳」。** 那一屏整个就是候选，点进去读和滚动都是审阅动作；
     * 而全文替换按产品硬约束必须明确确认——「移开注意力」在这儿不构成同意。
     */
    await page.click(".md-candidate-focus .revision-diff", { position: { x: 20, y: 10 } });
    await page.waitForTimeout(150);
    assert(await page.$(".md-candidate-focus .revision-bar"), "专注审阅被点别处静默采纳了");
    assert(!(await page.$(".cm-text-revision-host .revision-bar")), "大章节 Candidate 仍被压在正文内联位置");
    assert(!(await page.locator(".project-assistant").isVisible()), "大章节或全文 Candidate 专注审阅时没有折叠协作右栏");
    await page.screenshot({ path: path.join(STAGE6_SHOT_DIR, "1366-project-focused-candidate.png"), fullPage: false });
    await page.click('.md-candidate-focus .revision-bar__actions button[aria-label="弃用"]');
    await page.waitForFunction(() => !document.querySelector(".project-assistant")?.dataset.reviewing);
    await page.waitForTimeout(120);
    const railAfterFocusedReview = await page.$eval(".project-assistant .assistant-thread", (thread) => ({ scrollTop: thread.scrollTop, messages: [...thread.querySelectorAll(".assistant-message__markdown, .assistant-message__user > p")].map((item) => item.textContent) }));
    assert(JSON.stringify(railAfterFocusedReview.messages) === JSON.stringify(railBeforeFocusedReview.messages) && Math.abs(railAfterFocusedReview.scrollTop - railBeforeFocusedReview.scrollTop) <= 2, `专注审阅退出后会话或滚动位置没有恢复：${JSON.stringify({ before: { scrollTop: railBeforeFocusedReview.scrollTop, messages: railBeforeFocusedReview.messages.length }, after: { scrollTop: railAfterFocusedReview.scrollTop, messages: railAfterFocusedReview.messages.length } })}`);
    await page.setViewportSize({ width: 1440, height: 900 });

    console.log("✓ 项目协作区收敛为轻量 Header、上下文、对话与极简 Composer");
    console.log("✓ 空态建议只填入 Composer，@Expert 与 /Skill 只由输入字符触发");
    console.log("✓ 短 Candidate 在正文内联审阅，采纳前不修改正文");
    console.log("✓ Report 正面结果进入值得保留，finding 与正文可双向定位");
    console.log("✓ 检查由 @专家 起任务，报告审阅退出后恢复原对话");
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
  assert((await page.$$(".ws-edit .writing-assist__trigger")).length === 0, "Reading 编辑器仍保留旧 WritingAssist 常驻按钮");
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("ArrowRight");
  const existingBefore = await editorValue(".ws-edit .cm-content");
  await page.keyboard.press("Alt+Enter");
  await page.waitForSelector(".inline-ai-prompt");
  const promptInputFocused = await page.evaluate(() => document.activeElement === document.querySelector('.inline-ai-prompt input[aria-label="让 AI 写什么"]'));
  assert(promptInputFocused, "Reading 行内 AI 输入条打开后没有把键盘焦点交给输入框");
  assert(!(await page.$(".inline-ai-prompt [data-inline-ai-action=true]")), "Reading 行内 AI 输入条又挂上了预设按钮排");
  await assertInlineMenuInside(".ws-edit .cm-scroller", "Reading 标题附近光标菜单");
  await page.screenshot({ path: path.join(STAGE7_SHOT_DIR, "reading-cursor-menu.png"), fullPage: false });
  await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1366-reading-cursor-title.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await page.focus(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("/");
  await page.waitForSelector(".block-insert-menu");
  await page.click('.block-insert-menu__group > button:has-text("想一想")');
  await page.waitForFunction(() => document.querySelector(".ws-edit .ai-answer p")?.textContent.includes("读者最可能反对"));
  const existingNudge = requests.filter((item) => item.mode === "nudge").at(-1);
  // ⚠️ 生成用的是**真实光标位置**，不是卡片挂靠的行尾——两者混成一个值时「想一想」会按行尾提问
  assert(existingNudge?.cursor === 12 && existingNudge.cursor < existingNudge.content.length, "Reading 想一想仍然按文末而不是当前光标请求");
  assert((await editorValue(".ws-edit .cm-content")) === existingBefore, "Reading 想一想修改了正文");
  await page.screenshot({ path: path.join(STAGE7_SHOT_DIR, "reading-edit-mode.png"), fullPage: false });
  await page.click(".ws-edit .cm-content", { position: { x: 40, y: 8 } });
  await page.waitForSelector(".ws-edit .ai-answer", { state: "detached" });
  await page.focus(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("/");
  await page.waitForSelector(".block-insert-menu");
  await page.click('.block-insert-menu__group > button:has-text("续写这一段")');
  await page.waitForSelector(".ws-edit .ai-answer");
  assert(!(await editorValue(".ws-edit .cm-content")).includes(paragraph), "Reading 回答卡在插入前写入了正文");
  await page.screenshot({ path: path.join(STAGE7_SHOT_DIR, "reading-inline-candidate.png"), fullPage: false });
  await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1366-reading-candidate.png"), fullPage: false });
  /**
   * 「在下面插入」插在**这一块下面**，不是插在光标那个字符位置上。
   * 名字就是这么写的，Notion 也是这个语义——生成出来的是一个新段落，
   * 塞进句子中间只会把原来那句话劈成两半。
   */
  await page.click('.ws-edit .ai-answer__actions button[aria-label="在下面插入"]');
  await page.waitForSelector(".ws-edit .ai-answer", { state: "detached" });
  const existingAfter = await editorValue(".ws-edit .cm-content");
  const firstLineBefore = existingBefore.split("\n")[0];
  assert(existingAfter.startsWith(firstLineBefore) && existingAfter.includes(paragraph), "Reading 在下面插入没有把生成内容放到这一块下面");
  assert(existingAfter.indexOf(paragraph) >= firstLineBefore.length, "Reading 在下面插入把内容塞进了句子中间");
  const editorFocusRestored = await page.evaluate(() => document.activeElement?.classList.contains("cm-content"));
  assert(editorFocusRestored, "Reading 插入后没有把焦点还给正文");
  await moveCursorNearViewportBottom(".ws-edit");
  await page.keyboard.press("Alt+Enter");
  await page.waitForSelector(".inline-ai-prompt");
  const readingBottomLayout = await assertInlineMenuInside(".ws-edit .cm-scroller", "Reading 视口底部光标菜单");
  assert(readingBottomLayout.placement === "above", `Reading 底部光标菜单没有向上翻转：${JSON.stringify(readingBottomLayout)}`);
  await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1366-reading-cursor-bottom.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await page.focus(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  await page.waitForTimeout(120);
  const readingDocumentBeforeRevision = await editorValue(".ws-edit .cm-content");

  /**
   * ⚠️ **选区上的自由指令不默认成改写。** 那句话可能是「翻译成英文」，也可能是
   * 「这段在讲什么」——我们无从判断它是不是一次改写，默认成改写就会用答案顶掉原文。
   * 它就是**一条回复**：读完点别处就算，要放进文章才点「在下面插入」。
   */
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForSelector(".text-revision-menu");
  await page.fill('.selection-menu__command input[aria-label="改写要求"]', "更克制");
  /**
   * ⚠️ **焦点进了面板的输入框，那段被选中的字仍然要看得出来是被选中的。**
   * 原生选区高亮只在拥有选区的元素有焦点时才画——点进这个输入框，正文里那片黄
   * 当场消失，用户正要为那段字写指令，却看不到那段字。
   */
  const heldSelection = await page.evaluate(() => {
    const node = document.querySelector(".ws-edit .cm-held-selection");
    return {
      focusInPanel: Boolean(document.activeElement?.closest(".selection-menu")),
      text: node?.textContent || "",
      wash: node ? getComputedStyle(node).backgroundColor : "",
    };
  });
  assert(heldSelection.focusInPanel, "指令输入框没有拿到焦点，这条测的场景没发生");
  assert(heldSelection.text.length > 0 && heldSelection.wash && heldSelection.wash !== "transparent" && heldSelection.wash !== "rgba(0, 0, 0, 0)",
    `焦点离开正文后选中的那段字失去了底色：${JSON.stringify(heldSelection)}`);
  await page.click('.selection-menu__command button[aria-label="开始改写"]');
  await page.waitForSelector(".ws-edit .ai-answer");
  assert(!(await page.$(".ws-edit .revision-bar")), "选区自由指令被默认当成了改写");
  assert(await page.$(".ws-edit .cm-answer-source"), "回答卡没有标出它回答的是哪一段");
  assert((await editorValue(".ws-edit .cm-content")) === readingDocumentBeforeRevision, "回答卡在用户决定前改了正文");
  // 三颗图标：重试 / 在下面插入 / 对话。没有「丢弃」——点别处就是丢弃
  await page.waitForSelector(".ws-edit .ai-answer__actions");
  const answerActions = await page.$$eval(".ws-edit .ai-answer__actions button", (items) => items.map((item) => item.getAttribute("aria-label")));
  assert(answerActions.join("/") === "重试/在下面插入/对话", `回答卡动作不是三颗图标：${answerActions.join("/")}`);
  await page.screenshot({ path: path.join(STAGE7_SHOT_DIR, "reading-answer-card.png"), fullPage: false });
  /**
   * ⚠️ **「对话」是把刚发生的这一轮搬到右栏，不是重新问一遍。**
   * 上一版把指令重新发过去，模型再答一次——用户刚读完的那段在右栏消失了，
   * 换成同一个问题的第二个答案。搬过去的两条必须是真实发生过的那一问一答。
   */
  const chatTurnsBeforeDiscuss = assistantRequests.length;
  await page.click('.ws-edit .ai-answer__actions button[aria-label="对话"]');
  await page.waitForSelector(".ws-edit .ai-answer", { state: "detached" });
  for (let index = 0; index < 60 && !assistantAdopted.length; index += 1) await page.waitForTimeout(50);
  assert((await editorValue(".ws-edit .cm-content")) === readingDocumentBeforeRevision, "转到对话改了正文");
  const adopted0 = assistantAdopted.at(-1);
  assert(adopted0?.prompt?.includes("更克制") && adopted0.prompt.includes(">"), `搬进右栏的指令没带上他选中的原文：${JSON.stringify(adopted0)}`);
  assert(adopted0?.answer?.trim(), "搬进右栏的只有问题，没有那段已经读完的答案");
  assert(assistantRequests.length === chatTurnsBeforeDiscuss, "点「对话」又向模型问了一遍");
  assert(revisionRequests[legacyRevisionStart]?.instruction === "更克制", "自由指令没有发给 AI");

  /**
   * 改写本身走**预设技能**：那才是「有原文可比」的那条路，就地出 diff。
   */
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForSelector(".text-revision-menu");
  await page.click('.selection-menu__skills button:has-text("润色")');
  await page.waitForSelector(".ws-edit .revision-bar");
  const groundingText = await page.textContent(".candidate-grounding");
  assert(groundingText.includes("已使用 1") && groundingText.includes("已跳过 2") && groundingText.includes("未经核验 1"), "Grounding used/skipped/unverified 没有默认显示");
  assert(groundingText.includes("去核验") && groundingText.includes("仍然使用"), "skipped 没有给出下一步");
  const compareDocument = await editorValue(".ws-edit .cm-content");
  const visuallySplitDocument = `${readingDocumentBeforeRevision.slice(0, 12)}\n${readingDocumentBeforeRevision.slice(12)}`;
  const compareDiffAt = Array.from({ length: Math.max(compareDocument.length, visuallySplitDocument.length) }, (_, index) => index).find((index) => compareDocument[index] !== visuallySplitDocument[index]) ?? -1;
  assert(compareDocument === visuallySplitDocument, `对比阶段除候选卡片占位外改变了正文内容：${JSON.stringify({ compareLength: compareDocument.length, expectedLength: visuallySplitDocument.length, diffAt: compareDiffAt, actual: compareDocument.slice(Math.max(0, compareDiffAt - 40), compareDiffAt + 140), expected: visuallySplitDocument.slice(Math.max(0, compareDiffAt - 40), compareDiffAt + 140), selected: revisionRequests[legacyRevisionStart]?.selected })}`);
  await page.focus(".ws-edit .cm-content");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("临时变化");
  await page.waitForFunction(() => document.querySelector(".ws-edit .cm-content")?.textContent.includes("临时变化"));
  await page.keyboard.press("Control+Home");
  await page.waitForSelector('.revision-bar[data-status="stale"]');
  assert(await page.locator('.revision-bar__actions button[aria-label="采纳"]').isDisabled(), "stale Candidate 仍然可以采纳");
  /**
   * ⚠️ **stale 不能被「点别处」带走。**
   *
   * 「点别处即采纳」是默认路径，但正文已经在候选生成之后变过——这时候落地会覆盖新内容。
   * 这条是硬闸不是手感：点别处只关掉注意力，候选留在原地等一个明确的决定。
   */
  await page.click(".ws-edit .ws-edit__title, .ws-edit .cm-content", { position: { x: 5, y: 5 } }).catch(() => page.click(".ws-edit .cm-content"));
  await page.waitForTimeout(150);
  assert(await page.$('.revision-bar[data-status="stale"]'), "stale Candidate 被点别处静默采纳了");
  // 顶栏撤了，撤销走键盘（和所有编辑器一样）
  await page.focus(".ws-edit .cm-content");
  await page.keyboard.press("Control+Z");
  await page.focus(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  await page.waitForTimeout(300);
  const restoredStatus = await page.evaluate(() => document.querySelector(".revision-bar")?.dataset.status ?? "missing");
  assert(["ready", "edited"].includes(restoredStatus), "正文撤销后 Candidate 状态未恢复：" + restoredStatus);
  const afterStaleUndo = await editorValue(".ws-edit .cm-content");
  assert(!afterStaleUndo.includes("临时变化"), "stale 测试撤销后仍残留正文变化：" + afterStaleUndo.slice(-40));
  /**
   * diff **就画在正文原位置**：删掉的字带删除线，新增的字是零宽 widget。
   * 「没动的字不加任何装饰」是这一屏的关键——只有这样读到的才是「改完之后的文章」。
   */
  const compareStyle = await page.evaluate(() => {
    const del = document.querySelector(".ws-edit .cm-diff-del");
    const ins = document.querySelector(".ws-edit .cm-diff-ins");
    return {
      hasDel: Boolean(del),
      hasIns: Boolean(ins),
      strike: del ? getComputedStyle(del).textDecorationLine : "",
      wash: ins ? getComputedStyle(ins).backgroundColor : "",
      untouched: !document.querySelector(".ws-edit .cm-text-revision-original"),
    };
  });
  assert(compareStyle.hasDel && compareStyle.strike.includes("line-through"), "被删掉的字没有删除线");
  assert(compareStyle.hasIns && compareStyle.wash !== "transparent" && compareStyle.wash !== "rgba(0, 0, 0, 0)", "新增的字没有底色");
  assert(compareStyle.untouched, "定稿之后仍在整段划掉，而不是逐字 diff");
  assert(!(await page.$(".ws-edit .revision-bar textarea")), "决策栏又出现了可编辑候选文本框");
  // 「调整要求重新生成」收在「重试」后面：十次审阅九次是直接决定
  await page.click('.revision-bar__retry');
  await page.fill('.revision-bar__command input[aria-label="调整候选要求"]', "更克制、更直接");
  await page.click('.revision-bar__command button[aria-label="按当前要求重新生成"]');
  await page.waitForFunction(() => document.querySelector(".ws-edit .cm-diff-ins")?.textContent.includes("第二版候选"));
  assert(revisionRequests.at(-1)?.instruction === "更克制、更直接", "重新生成没有沿用调整后的要求");
  await page.screenshot({ path: path.join(ROOT, "tmp", "text-revision-review.png"), fullPage: false });
  const secondCandidate = await page.textContent(".ws-edit .cm-diff-ins");
  await page.click('.revision-bar__actions button[aria-label="采纳"]');
  await page.waitForSelector(".revision-bar", { state: "detached" });
  const revisedAfter = await editorValue(".ws-edit .cm-content");
  assert(revisedAfter.startsWith(secondCandidate.slice(0, 8)), "采纳没有精确替换原选区前缀：" + JSON.stringify(revisedAfter.slice(0, 160)));
  /**
   * ⚠️ **AI 历史的界面撤了，但记录还在服务端——覆盖不能跟着界面一起丢。**
   * 改成直接查落库的那几条：原文和最终候选都要在，状态要对。
   */
  const savedRevisions = [...revisionDocuments.values()].flat();
  const adopted = savedRevisions.find((item) => item.status === "adopted");
  assert(adopted, "采纳没有写进修订历史");
  assert(adopted.original?.includes(existingAfter.slice(0, 8)) && adopted.candidate?.includes(secondCandidate.slice(0, 8)),
    `修订历史没有同时保留原文和最终候选：${JSON.stringify({ original: adopted.original?.slice(0, 40), candidate: adopted.candidate?.slice(0, 40) })}`);
  /**
   * ⚠️ **自由指令回来的如果是「这段字的改动版」，就落进正文画 diff。**
   *
   * 上一版按「用户怎么唤起」判：预设技能算改字，自由指令一律算产新字。于是「选中一段，
   * 输入『润色优化一下』」停在一张卡里——用户要看的是**文章变成什么样**，
   * 而卡片给的是「另一段字，要不要插到下面去」，位置都不对。
   */
  const editLikeStart = revisionRequests.length;
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 10; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForSelector(".text-revision-menu");
  const editLikeOriginal = await page.evaluate(() => window.getSelection().toString());
  await page.fill('.selection-menu__command input[aria-label="改写要求"]', "润色优化一下");
  await page.click('.selection-menu__command button[aria-label="开始改写"]');
  await page.waitForSelector(".ws-edit .revision-bar");
  assert(!(await page.$(".ws-edit .ai-answer")), "像改写的自由指令结果还停在回答卡里");
  assert(await page.$(".ws-edit .cm-diff-ins"), "落进正文之后没有画出逐字 diff");
  assert(revisionRequests[editLikeStart]?.instruction === "润色优化一下", "自由指令没有原样发出去");
  assert((await editorValue(".ws-edit .cm-content")).startsWith(editLikeOriginal), "还没决定就改了正文");
  // 选区面板不能和结果叠在一起：选区还在不等于此刻要对选区动手
  assert(!(await page.$(".text-revision-menu[data-kind=\"selection\"]")), "结果出来之后选区面板还开着");
  await page.click('.revision-bar__actions button[aria-label="弃用"]');
  await page.waitForSelector(".ws-edit .revision-bar", { state: "detached" });

  await page.click('.ws-edit__foot button:has-text("取消")');

  // 编辑器卸载再打开，正文和记录都还在。
  await page.click('.doc-actions button:has-text("编辑")');
  await page.waitForSelector(".ws-edit .cm-content", { timeout: 8000 });

  /**
   * **点别处 = 采纳。** 默认结果就是「接受」：读完 diff 想接着写下一句时，
   * 不该再要求一次点击去说「是」。`✓` 只是显式确认，`弃用` 才是要主动做的那个动作。
   */
  const beforeClickAway = await editorValue(".ws-edit .cm-content");
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.click('.selection-menu__skills button:has-text("纠错")');
  await page.waitForSelector(".ws-edit .revision-bar");
  const clickAwayCandidate = await page.textContent(".ws-edit .cm-diff-ins");
  await page.click(".ws-edit .cm-content", { position: { x: 30, y: 8 } });
  await page.waitForSelector(".ws-edit .revision-bar", { state: "detached" });
  const afterClickAway = await editorValue(".ws-edit .cm-content");
  assert(afterClickAway !== beforeClickAway && afterClickAway.includes(clickAwayCandidate.slice(0, 6)),
    `点正文别处没有采纳候选：${JSON.stringify({ before: beforeClickAway.slice(0, 60), after: afterClickAway.slice(0, 60) })}`);
  assert([...revisionDocuments.values()].flat().some((item) => item.status === "adopted"), "点别处采纳没有进入持久修订历史");

  // 弃用只记录决定，不改变正文；结果同样进入持久历史。
  const beforeDiscard = await editorValue(".ws-edit .cm-content");
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.click('.selection-menu__skills button:has-text("纠错")');
  await page.waitForSelector(".ws-edit .revision-bar");
  await page.click('.revision-bar__actions button[aria-label="弃用"]');
  await page.waitForSelector(".revision-bar", { state: "detached" });
  assert(await editorValue(".ws-edit .cm-content") === beforeDiscard, "弃用修订后正文发生了变化");
  assert([...revisionDocuments.values()].flat().some((item) => item.status === "discarded"), "弃用决定没有进入持久修订历史");

  const beforeRejected = await editorValue(".ws-edit .cm-content");
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForSelector(".text-revision-menu");
  await page.fill('.selection-menu__command input[aria-label="改写要求"]', "触发真实性拒绝");
  await page.click('.selection-menu__command button[aria-label="开始改写"]');
  /**
   * ⚠️ **服务端的真实性 gate 在回答卡上同样是硬闸。**
   * 卡片是一条新的落地路径（插入 / 替换）；不看 `grounding.gate` 就等于给 gate 开后门。
   */
  await page.waitForSelector('.ws-edit .ai-answer[data-status="failed"]');
  assert((await page.textContent(".ws-edit .ai-answer")).includes("个人经历缺少服务端证据，候选未放行"), "gate rejected 没有显示服务端原因");
  assert(!(await page.$('.ws-edit .ai-answer__actions button[aria-label="在下面插入"]')), "gate rejected 的回答卡仍然能落地");
  await page.click(".ws-edit .cm-content", { position: { x: 40, y: 8 } });
  await page.waitForSelector(".ws-edit .ai-answer", { state: "detached" });
  assert((await editorValue(".ws-edit .cm-content")) === beforeRejected, "gate rejected 的回答卡关掉后改变了正文");
  await page.click('.ws-edit__foot button:has-text("取消")');
  await page.keyboard.press("Alt+Enter");
  await page.waitForTimeout(100);
  assert(!(await page.$(".inline-ai-prompt")) && !(await page.$(".text-revision-menu")), "Reading 只读模式仍出现正文修改动作");
  await page.screenshot({ path: path.join(STAGE7_1_SHOT_DIR, "1366-reading-readonly.png"), fullPage: false });

  await page.evaluate(() => localStorage.removeItem("xenho-assistant-model"));
  await page.goto(`http://127.0.0.1:${PORT}/#/content`, { waitUntil: "networkidle" });
  await page.click('.sidebar .nav-item:has-text("AI助手")');
  await page.waitForSelector(".assistant-page .assistant-pane--standalone");
  assert(page.url().includes("#/assistant"), "左侧 AI 助手没有打开独立对话页");
  assert(!(await page.$(".assistant-pane--standalone .assistant-history")), "独立助手打开时历史对话栏没有默认收起");
  // 左：附件 + 权限（会话级）。右：模型 + 发送（发送级）。
  // 模型是「这一条用哪个发出去」，属于发送动作的一部分，必须贴着发送键。
  assert(await page.$(".assistant-pane--standalone .assistant-composer__left .assistant-composer__attach"), "输入框左侧没有附件入口");
  assert(await page.$(".assistant-pane--standalone .assistant-composer__left .assistant-composer__access"), "输入框左侧没有权限入口");
  assert(await page.$(".assistant-pane--standalone .assistant-composer__right .assistant-composer__model"), "模型选择没有贴着右下角的发送键");
  // 权限菜单必须从**权限按钮**上方长出来，不是从整条输入器顶边长出来
  await page.click(".assistant-pane--standalone .assistant-composer__access");
  await page.waitForSelector(".assistant-pane--standalone .assistant-permission-menu");
  const accessBox = await page.locator(".assistant-pane--standalone .assistant-composer__access").boundingBox();
  const accessMenuBox = await page.locator(".assistant-pane--standalone .assistant-permission-menu").boundingBox();
  assert(accessBox && accessMenuBox && Math.abs(accessMenuBox.x - accessBox.x) <= 2 && accessBox.y - (accessMenuBox.y + accessMenuBox.height) <= 12 && accessMenuBox.y + accessMenuBox.height <= accessBox.y, `权限菜单和权限按钮分了家：menu=${JSON.stringify(accessMenuBox)} button=${JSON.stringify(accessBox)}`);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".assistant-pane--standalone .assistant-permission-menu", { state: "detached" });
  assert((await page.textContent(".assistant-pane--standalone .assistant-composer__model")).includes("claude-sonnet-4-6"), "新对话没有默认使用 claude-sonnet-4-6");
  await page.click(".assistant-pane--standalone .assistant-composer__model");
  await page.waitForSelector(".assistant-pane--standalone .assistant-command-menu--models");
  await page.click(".assistant-pane__context");
  await page.waitForSelector(".assistant-pane--standalone .assistant-command-menu--models", { state: "detached" });
  await page.click(".assistant-pane--standalone .assistant-composer__model");
  await page.click('.assistant-pane--standalone .assistant-command-menu--models .assistant-model-group > button:has-text("测试模型 2")');
  assert(await page.evaluate(() => localStorage.getItem("xenho-assistant-model")) === "test-model-2", "用户选择的模型没有写入本地偏好");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".assistant-page .assistant-pane--standalone");
  assert((await page.textContent(".assistant-pane--standalone .assistant-composer__model")).includes("测试模型 2"), "刷新后没有保持用户改动的模型");
  await page.click(".assistant-pane--standalone .assistant-composer__model");
  await page.waitForSelector(".assistant-pane--standalone .assistant-command-menu--models");
  const modelButtonBox = await page.locator(".assistant-pane--standalone .assistant-composer__model").boundingBox();
  const modelMenuBox = await page.locator(".assistant-pane--standalone .assistant-command-menu--models").boundingBox();
  // 菜单要从自己的触发器上方长出来，不能从对面飞过来。
  assert(modelButtonBox && modelMenuBox && modelMenuBox.y + modelMenuBox.height <= modelButtonBox.y && Math.abs(modelMenuBox.x + modelMenuBox.width - modelButtonBox.x - modelButtonBox.width) <= 3, "模型面板没有从模型按钮上方向右对齐展开");
  assert(modelMenuBox.width <= 322, `模型面板仍然过宽：${modelMenuBox.width}`);
  const modelRows = await page.$$eval(".assistant-pane--standalone .assistant-command-menu--models .assistant-model-group > button", (items) => items.map((item) => {
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
  assert((await page.textContent(".assistant-history__delete-confirm")).includes("删除后无法恢复"), "删除没有显示永久删除警告");
  await page.click('.assistant-history__delete-confirm button:has-text("永久删除")');
  await page.waitForSelector('.assistant-history__item:has-text("最近对话")', { state: "detached" });
  assert(!assistantConversationItems.some((item) => item.id === "chat-recent"), "确认删除后历史记录仍在列表中");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".assistant-page .assistant-pane--standalone");
  await page.click(".assistant-history-toggle");
  assert(!(await page.$('.assistant-history__item:has-text("最近对话")')), "刷新后已删除的历史记录重新出现");
  await page.click('.assistant-history__filters button:has-text("已归档")');
  assert((await page.textContent(".assistant-history")).includes("归档对话"), "已归档视图没有展示归档对话");
  await page.click(".assistant-history-toggle");
  /**
   * ⚠️ **量的是「贴着这一页的底」，不是「贴着那张画布的底」。**
   * `.assistant-page__canvas` 已经撤了——那是套在 `.main` 里面的第二层白圆角卡片，
   * 而 `.main` 本身就是浮在应用底色上的面板，白框套白框。
   * 要钉的规矩没变（输入框永远在最底下、AI 跑起来时不许位移），换的只是参照物。
   */
  const pageBox = await page.locator(".assistant-page").boundingBox();
  /**
   * 空态：**输入框在中间，入口卡在它下面。**
   * 这一屏用户要做的第一件事是打字，输入框必须落在视线中心；
   * 入口卡是「不知道说什么时的备选」，优先级低于直接开口，所以排在下面。
   */
  const emptyComposer = await page.locator(".assistant-pane--standalone .assistant-composer").boundingBox();
  const startersBox = await page.locator(".assistant-pane--standalone .assistant-empty__actions").boundingBox();
  const emptyGap = pageBox && emptyComposer ? pageBox.y + pageBox.height - emptyComposer.y - emptyComposer.height : -1;
  assert(emptyGap > 80, `空态输入框仍然钉在页底，没有居中：gap=${emptyGap}`);
  assert(startersBox && startersBox.y >= emptyComposer.y + emptyComposer.height - 1, "空态入口卡没有排在输入框下方");
  assert(Math.abs(startersBox.x - emptyComposer.x) <= 1 && Math.abs(startersBox.width - emptyComposer.width) <= 1, "空态入口卡和输入框左右没有对齐");
  // ⚠️ 顺便钉住「没有第二层容器」：它回来一次就又是白框套白框
  assert(!(await page.$(".assistant-page__canvas")), "独立对话页又套回了一层画布容器");
  await page.fill('.assistant-pane--standalone textarea[placeholder*="问任何问题"]', "帮我找一个值得继续思考的问题");
  await page.click('.assistant-pane--standalone button[aria-label="发送"]');
  await page.waitForSelector(".assistant-pane--standalone .assistant-working");
  // 发出去之后：入口卡收起，输入框回到页底并**在整轮生成期间不再位移**。
  assert(!(await page.$(".assistant-pane--standalone .assistant-empty__actions")), "发送后空态入口卡没有收起");
  const composerDuring = await page.locator(".assistant-pane--standalone .assistant-composer").boundingBox();
  const composerGap = pageBox.y + pageBox.height - composerDuring.y - composerDuring.height;
  assert(composerGap >= 10 && composerGap <= 40, `发送后输入框没有回到这一页的底部：gap=${composerGap}`);
  await page.waitForFunction(() => document.querySelector(".assistant-pane--standalone .assistant-message--assistant")?.textContent.includes("0.2s"));
  const composerAfter = await page.locator(".assistant-pane--standalone .assistant-composer").boundingBox();
  assert(Math.abs(composerAfter.y - composerDuring.y) < 2, "AI 运行时输入框发生了位移");
  assert(await page.$('.assistant-pane--standalone .assistant-message--user button[aria-label="复制消息"]'), "用户消息没有直接复制操作");
  assert(await page.$('.assistant-pane--standalone .assistant-message--user button[aria-label="编辑并重新发送"]'), "最新用户消息没有编辑操作");
  const userBubbleBox = await page.locator(".assistant-pane--standalone .assistant-message__user > p").last().boundingBox();
  const userActionsBox = await page.locator(".assistant-pane--standalone .assistant-message__user-actions").last().boundingBox();
  assert(userBubbleBox && userActionsBox && userActionsBox.y >= userBubbleBox.y + userBubbleBox.height && Math.abs(userActionsBox.x + userActionsBox.width - userBubbleBox.x - userBubbleBox.width) <= 2, "用户消息操作没有贴在气泡下方右侧");
  await page.screenshot({ path: path.join(ROOT, "tmp", "assistant-standalone-final.png"), fullPage: false });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: path.join(ROOT, "tmp", "assistant-standalone-final-1920.png"), fullPage: false });
  assert(!(await page.$('.assistant-pane--standalone button[aria-label="插入正文"]')), "独立对话不应出现稿件插入操作");
  console.log("✓ 左侧 AI 助手打开独立对话页，空态输入框居中、发送后回到页底");
  assert(errors.length === 0, `浏览器报错：${errors.join(" | ")}`);
  console.log("✓ Project 与 Reading 共用选区和光标内联 AI，旧 WritingAssist 入口未回归");
  console.log("✓ 想一想和自由指令进回答卡，续写插入走底纹，预设技能才出 diff");
  console.log("✓ /Skill 可以选择已注册的 interview-to-draft Skill");
  console.log("✓ 两个编辑入口都有选区修订工具，采纳前正文保持不变");
  console.log("✓ 局部修订在正文原位置画 diff，支持自定义要求、重试、stale 检测和精确采纳");
  console.log("✓ Grounding 展示 used/skipped/unverified，服务端拒绝会进入 failed");
  console.log("✓ 弃用修订不改变正文，并持久记录弃用决定");
  console.log("✓ 修订历史跨编辑器重开仍可回看原文与最终候选");
  console.log("✓ 浏览器控制台 0 错误");
} finally {
  await browser.close();
  await server.close();
}
