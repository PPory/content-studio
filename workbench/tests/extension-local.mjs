import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createServer } from "vite";
import { workbenchApi } from "../server/vite-plugin-workbench.mjs";

const PROJECT = path.resolve(import.meta.dirname, "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-extension-local-"));
const xenhoHome = path.join(tempRoot, "Xenho");
const checks = [];
const check = (name, pass, detail = "") => {
  assert(pass, detail || name);
  checks.push(name);
  console.log(` ✓ ${name}`);
};

const manifest = JSON.parse(await fs.readFile(path.join(PROJECT, "extension", "manifest.json"), "utf8"));
const background = await fs.readFile(path.join(PROJECT, "extension", "background.js"), "utf8");
const readme = await fs.readFile(path.join(PROJECT, "extension", "README.md"), "utf8");

check("扩展只连接本机工作台", manifest.manifest_version === 3 && manifest.host_permissions?.join() === "http://127.0.0.1:5180/*");
check("扩展使用本地工作区第三版协议", background.includes('const PROTOCOL_VERSION = 3') && readme.includes("SQLite"));
check("永久失败收藏单独保存，不阻塞后续补传", background.includes('const FAILED_KEY = "failedCollectionIntakesV1"') && background.includes("const permanent =") && background.includes("continue;"));

function chromeEvent() {
  const listeners = [];
  return { listeners, addListener(listener) { listeners.push(listener); } };
}

function chromeStorageArea(store) {
  return {
    async get(key) { return typeof key === "string" ? { [key]: store[key] } : { ...store }; },
    async set(values) { Object.assign(store, values); },
    async remove(key) { delete store[key]; },
  };
}

function sendBackground(listener, message, sender = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("background response timeout")), 2_000);
    listener(message, sender, (value) => { clearTimeout(timer); resolve(value); });
  });
}

async function exercisePoisonQueue() {
  const sessionStore = {};
  const localStore = {};
  const onMessage = chromeEvent();
  let online = false;
  let intakeCalls = 0;
  const sandbox = {
    AbortController,
    Response,
    TextDecoder,
    URL,
    crypto,
    setTimeout,
    clearTimeout,
    console,
    fetch: async (url) => {
      if (!online) throw new TypeError("connection refused");
      if (String(url).endsWith("/api/extension/status")) return new Response(JSON.stringify({ ok: true, pairToken: "pair-token-0123456789", product: "content-studio", protocolVersion: 3, ready: true, services: { workspace: true }, capabilities: { collectionsV1: true, localWorkspace: true } }), { status: 200, headers: { "content-type": "application/json" } });
      if (String(url).endsWith("/api/extension/intake")) {
        intakeCalls += 1;
        return intakeCalls === 1
          ? new Response(JSON.stringify({ ok: false, error: "永久无效内容" }), { status: 400, headers: { "content-type": "application/json" } })
          : new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected ${url}`);
    },
    chrome: {
      runtime: { onInstalled: chromeEvent(), onStartup: chromeEvent(), onMessage, onConnect: chromeEvent() },
      sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
      alarms: { create() {}, onAlarm: chromeEvent() },
      storage: { session: chromeStorageArea(sessionStore), local: chromeStorageArea(localStore) },
    },
  };
  vm.runInNewContext(background, sandbox, { filename: "extension/background.js" });
  const listener = onMessage.listeners[0];
  const sender = { tab: { id: 8, title: "测试网页", url: "https://example.com/article" } };
  for (const selection of ["第一条离线收藏", "第二条离线收藏"]) {
    const queued = await sendBackground(listener, { type: "XENHO_CAPTURE", action: "intake", target: "collection", eventTrusted: true, context: { selection, context: selection, title: "测试网页", url: sender.tab.url } }, sender);
    assert.equal(queued.queued, true);
  }
  online = true;
  const status = await sendBackground(listener, { type: "XENHO_STATUS" });
  return { status, localStore, intakeCalls };
}

const poison = await exercisePoisonQueue();
check("一条永久失败不会堵住下一条收藏", poison.status.ok === true && poison.status.synced === 1 && poison.status.pending === 0 && poison.intakeCalls === 2);
check("永久失败进入可核对队列", poison.localStore.failedCollectionIntakesV1?.length === 1 && poison.localStore.pendingCollectionIntakesV1?.length === 0);

const server = await createServer({
  root: PROJECT,
  configFile: false,
  logLevel: "error",
  plugins: [workbenchApi({ XENHO_HOME: xenhoHome })],
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});

try {
  await server.listen();
  const port = server.httpServer.address().port;
  const base = `http://127.0.0.1:${port}`;
  const origin = "chrome-extension://xenho-local-test";
  const marker = { Origin: origin, "X-Xenho-Extension": "1" };

  const blocked = await fetch(`${base}/api/extension/status`);
  check("没有扩展来源和标记的请求被拒绝", blocked.status === 403);

  const statusRes = await fetch(`${base}/api/extension/status`, { headers: marker });
  const status = await statusRes.json();
  check("扩展临时令牌绑定当前来源", statusRes.ok && status.protocolVersion === 3 && status.services?.workspace === true && status.capabilities?.localWorkspace === true);
  const auth = { ...marker, "X-Xenho-Token": status.pairToken };

  const other = await fetch(`${base}/api/extension/status`, { headers: { Origin: "chrome-extension://other", "X-Xenho-Extension": "1" } });
  check("另一个扩展来源不能复用配对", other.status === 403);

  const intakeRes = await fetch(`${base}/api/extension/intake`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ clientRequestId: "extension-local-1", target: "material", title: "本地扩展素材", content: "只写入隔离 SQLite", url: "https://example.com/a" }) });
  const intake = await intakeRes.json();
  const workspace = await server.xenhoWorkspace;
  check("扩展入库直接写入隔离 SQLite", intakeRes.ok && intake.ok && workspace.repository.getEntity(intake.id)?.type === "material");

  const annotationRes = await fetch(`${base}/api/extension/annotation`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/a?utm_source=test", title: "测试网页", selection: "值得留下的句子", body: "我的判断" }) });
  const annotation = await annotationRes.json();
  const note = annotation.noteItems[0];
  check("网页批注写入本地知识条目", annotationRes.ok && note?.id && workspace.repository.getEntity(note.id)?.type === "knowledge_item");

  const editRes = await fetch(`${base}/api/extension/annotation/edit`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/a", id: note.id, expectedVersion: note.stamp, body: "更新后的判断" }) });
  const edited = await editRes.json();
  const removeRes = await fetch(`${base}/api/extension/annotation/edit`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/a", id: note.id, expectedVersion: edited.noteItems[0].stamp, remove: true }) });
  const removed = await removeRes.json();
  check("网页批注可编辑并进入回收站", editRes.ok && removeRes.ok && removed.noteItems.length === 0 && workspace.repository.getEntity(note.id, { includeDeleted: true }).deletedAt);

  // ── 划中的话记进证据层 ─────────────────────────────────────────────
  //
  // ⚠️ 这条路存在是因为 API 抓不到中文平台（知乎 403、小红书登录墙），
  // 而浏览器里有登录态。所以它的正确性直接决定中文受众声音进不进得来。
  const quote = "每次都想着先收藏，收藏完就再也没打开过";
  const voiceRes = await fetch(`${base}/api/extension/audience-voice`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ url: "https://www.xiaohongshu.com/explore/abc?utm_source=x", title: "小红书笔记", selection: quote, kind: "comment" }) });
  const voice = await voiceRes.json();
  check("划中的话写入不可变证据层", voiceRes.ok && workspace.repository.getEntity(voice.voiceId)?.type === "audience_raw_source");
  check("存的就是划中那段字，没有被改写", workspace.audienceRaw.source(voice.voiceId).body === quote);
  check("来源链接跟着存下来并去掉了跟踪参数",
    workspace.audienceRaw.source(voice.voiceId).sourceUrl === "https://www.xiaohongshu.com/explore/abc");

  const againRes = await fetch(`${base}/api/extension/audience-voice`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ url: "https://www.xiaohongshu.com/explore/abc", title: "小红书笔记", selection: quote, kind: "comment" }) });
  const again = await againRes.json();
  check("同一段话划第二次说「已经记过」而不是再记一条",
    again.duplicate === true && again.voiceId === voice.voiceId
    && workspace.db.prepare("SELECT COUNT(*) AS c FROM audience_raw_sources").get().c === 1);

  const emptyRes = await fetch(`${base}/api/extension/audience-voice`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/a", title: "x", selection: "  ", kind: "comment" }) });
  check("没选中东西时说清要先选", emptyRes.status === 400);

  const badKindRes = await fetch(`${base}/api/extension/audience-voice`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/a", title: "x", selection: "有内容", kind: "made_up" }) });
  check("种类必须是领域层定义过的那几种", badKindRes.status === 400);

  const statusBody = await (await fetch(`${base}/api/extension/status`, { headers: auth })).json();
  check("种类清单由工作台下发，扩展不自己抄一份",
    statusBody.capabilities.audienceVoiceV1 === true
    && statusBody.audienceKinds.some((item) => item.key === "comment" && item.label));

  const askRes = await fetch(`${base}/api/extension/ask`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ mode: "解释", selection: "只做配置检查" }) });
  const ask = await askRes.json();
  check("未配置模型时扩展 AI 本地拒绝且不发远程调用", askRes.status === 503 && ask.error === "本地 Pi 模型尚未配置");
  check("隔离工作区数据库完整性通过", workspace.check().ok);
} finally {
  await server.close();
  await server.xenhoClose?.();
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log(`\n ✓ ${checks.length} 项扩展本地工作区边界全部通过`);
