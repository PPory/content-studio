const API = "http://127.0.0.1:5180";
const PRODUCT = "content-studio";
const PROTOCOL_VERSION = 2;
const CONNECTION_KEY = "workbenchConnection";
const ALLOWED_ACTIONS = new Set(["annotate", "ask", "chat", "topic"]);
const INTAKE_TARGETS = new Set(["collection", "material", "inbox"]);
const MAX_SELECTION = 4000;
let connectionRequest = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

function cleanContext(raw, sender) {
  const tabUrl = String(sender.tab?.url || "");
  if (!/^https?:\/\//i.test(tabUrl)) throw new Error("这个页面不支持划取");
  const pageUrl = new URL(tabUrl);
  pageUrl.hash = "";
  const selection = String(raw?.selection || "").trim().slice(0, MAX_SELECTION);
  if (selection.length < 2) throw new Error("请先选中一段文字");
  return {
    captureId: crypto.randomUUID(),
    tabId: sender.tab.id,
    selection,
    context: String(raw?.context || "").trim().slice(0, 3000),
    title: String(raw?.title || sender.tab.title || pageUrl.hostname).replace(/[\r\n]+/g, " ").slice(0, 300),
    url: pageUrl.toString().slice(0, 2048),
    site: pageUrl.hostname,
    capturedAt: new Date().toISOString(),
  };
}

async function setCapture(context, action) {
  await chrome.storage.session.set({ currentCapture: { ...context, action } });
}

async function cachedConnection() {
  const stored = await chrome.storage.session.get(CONNECTION_KEY);
  const connection = stored[CONNECTION_KEY];
  if (!connection?.pairToken || connection?.status?.product !== PRODUCT || connection?.status?.protocolVersion !== PROTOCOL_VERSION) return null;
  return connection;
}

async function clearConnection() {
  await chrome.storage.session.remove(CONNECTION_KEY);
}

async function connect(force = false) {
  if (!force) {
    const cached = await cachedConnection();
    if (cached) return cached;
  }
  if (connectionRequest) return connectionRequest;
  connectionRequest = (async () => {
    let response;
    try {
      response = await fetch(`${API}/api/extension/status`, { headers: { "X-Xenho-Extension": "1" } });
    } catch {
      throw new Error("工作台未启动，请先打开 Xenho OS");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || !data.pairToken) throw new Error(data?.error || "扩展无法连接工作台");
    if (data.product !== PRODUCT || data.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error("检测到旧版工作台，请启动 content-studio 中的 Xenho OS");
    }
    if (data.capabilities?.collectionsV1 !== true) {
      throw new Error("工作台尚未完成 Inbox 迁移，请先迁移并部署 Worker");
    }
    const { pairToken, ...status } = data;
    const connection = { pairToken, status };
    await chrome.storage.session.set({ [CONNECTION_KEY]: connection });
    return connection;
  })();
  try {
    return await connectionRequest;
  } finally {
    connectionRequest = null;
  }
}

async function api(path, { method = "GET", body, signal } = {}, canRetry = true) {
  const connection = await connect();
  const headers = { "X-Xenho-Extension": "1", "X-Xenho-Token": connection.pairToken };
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new Error("工作台未启动，请先打开 Xenho OS");
  }
  if (response.status === 401 && canRetry) {
    await clearConnection();
    await connect(true);
    return api(path, { method, body, signal }, false);
  }
  return response;
}

async function intake(context, target) {
  if (!INTAKE_TARGETS.has(target)) throw new Error("不支持的入库位置");
  const response = await api("/api/extension/intake", {
    method: "POST",
    body: {
      target,
      cmd: "",
      content: target === "collection" ? context.context : context.selection,
      selection: context.selection,
      title: context.title,
      url: context.url,
      source: target === "collection" ? "浏览器扩展" : context.url,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || `保存失败（HTTP ${response.status}）`);
  return data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "XENHO_CAPTURE") {
    (async () => {
      if (!sender.tab?.id || !message.eventTrusted) throw new Error("操作未通过网页校验");
      const context = cleanContext(message.context, sender);
      if (message.action === "intake") {
        const target = String(message.target || "collection");
        const data = await intake(context, target);
        const detail = data.dbType ? `（${data.dbType}）` : "";
        sendResponse({ ok: true, message: target === "collection" ? "已收藏到收件箱" : target === "inbox" ? "已存入灵感库" : `已存入素材库${detail}` });
        return;
      }
      if (!ALLOWED_ACTIONS.has(message.action)) throw new Error("不支持的操作");
      // 必须紧跟用户点击调用，不能等网络请求；因此打开面板前只写 session storage。
      const opening = chrome.sidePanel.open({ tabId: sender.tab.id });
      await Promise.all([setCapture(context, message.action), opening]);
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: error.message || "操作失败" }));
    return true;
  }

  if (message?.type === "XENHO_CONTEXT") {
    chrome.storage.session.get("currentCapture").then(({ currentCapture }) => sendResponse({ ok: true, context: currentCapture || null }));
    return true;
  }

  if (message?.type === "XENHO_STATUS") {
    connect(true).then(({ status }) => sendResponse({
      ok: true,
      status,
    })).catch((error) => sendResponse({ ok: false, error: error.message || "连接失败" }));
    return true;
  }

  if (message?.type === "XENHO_API") {
    const allowed = new Set([
      "GET /api/extension/status",
      "GET /api/extension/annotations",
      "POST /api/extension/annotation",
      "POST /api/extension/annotation/edit",
      "POST /api/extension/ask",
      "POST /api/extension/chat",
      "POST /api/extension/intake",
    ]);
    (async () => {
      const method = String(message.method || "GET").toUpperCase();
      const url = new URL(String(message.path || ""), API);
      if (url.origin !== API || !allowed.has(`${method} ${url.pathname}`)) throw new Error("不支持的接口");
      const response = await api(`${url.pathname}${url.search}`, { method, body: message.body });
      const type = response.headers.get("content-type") || "";
      const text = await response.text();
      sendResponse({
        ok: response.ok,
        status: response.status,
        type,
        text,
        sessionId: response.headers.get("x-session-id") || "",
      });
    })().catch((error) => sendResponse({ ok: false, status: 0, error: error.message || "请求失败" }));
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "xenho-stream") return;
  let controller = null;
  let started = false;
  port.onMessage.addListener((message) => {
    if (message?.type === "ABORT") {
      controller?.abort();
      return;
    }
    if (message?.type !== "START" || started) return;
    started = true;
    const allowed = new Set(["/api/extension/ask", "/api/extension/chat"]);
    const path = String(message.path || "");
    if (!allowed.has(path)) {
      port.postMessage({ type: "error", error: "不支持的流式接口" });
      return;
    }
    controller = new AbortController();
    (async () => {
      const response = await api(path, { method: "POST", body: message.body || {}, signal: controller.signal });
      const type = response.headers.get("content-type") || "";
      if (!response.ok || type.includes("application/json")) {
        const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(data.hint ? `${data.error}；${data.hint}` : data.error || "AI 请求失败");
      }
      port.postMessage({ type: "start", sessionId: response.headers.get("x-session-id") || "" });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) port.postMessage({ type: "chunk", chunk });
      }
      const tail = decoder.decode();
      if (tail) port.postMessage({ type: "chunk", chunk: tail });
      port.postMessage({ type: "done" });
    })().catch((error) => {
      if (error?.name === "AbortError") port.postMessage({ type: "aborted" });
      else port.postMessage({ type: "error", error: error.message || "AI 请求失败" });
    });
  });
  port.onDisconnect.addListener(() => controller?.abort());
});
