import { marked } from "./vendor/marked.esm.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  context: null,
  tab: "annotate",
  notes: [],
  asks: [],
  chat: [],
  engine: "claude",
  sessionId: "",
  askRun: null,
  chatRun: null,
};
const drafts = new Map();
let toastTimer = null;
let lastAutoTopic = "";
let askFrame = 0;

function message(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

async function api(path, { method = "GET", body } = {}) {
  const result = await message({ type: "XENHO_API", path, method, body });
  if (!result?.ok) {
    let data = null;
    try { data = JSON.parse(result?.text || ""); } catch { /* plain transport error */ }
    const reason = data?.error || result?.error || `请求失败（HTTP ${result?.status || 0}）`;
    throw new Error(data?.hint ? `${reason}；${data.hint}` : reason);
  }
  if (!String(result.type || "").includes("application/json")) return result.text;
  const data = JSON.parse(result.text || "{}");
  if (!data.ok) throw new Error(data.hint ? `${data.error}；${data.hint}` : data.error || "请求失败");
  return data;
}

function openStream(path, body, { onChunk, onSession } = {}) {
  const port = chrome.runtime.connect({ name: "xenho-stream" });
  let finished = false;
  const promise = new Promise((resolve, reject) => {
    port.onMessage.addListener((event) => {
      if (event.type === "start") onSession?.(event.sessionId || "");
      if (event.type === "chunk") onChunk?.(event.chunk || "");
      if (event.type === "done" || event.type === "aborted") {
        finished = true;
        resolve(event.type);
        port.disconnect();
      }
      if (event.type === "error") {
        finished = true;
        reject(new Error(event.error || "AI 请求失败"));
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!finished) reject(new Error("连接已中断"));
    });
    port.postMessage({ type: "START", path, body });
  });
  return { promise, abort: () => port.postMessage({ type: "ABORT" }) };
}

function notify(text, error = false) {
  const node = $("#toast");
  node.textContent = text;
  node.classList.toggle("error", error);
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), error ? 4200 : 2200);
}

function escapeHtml(text) {
  return String(text || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function renderMarkdown(target, text) {
  const template = document.createElement("template");
  template.innerHTML = marked.parse(escapeHtml(text || ""), { breaks: true });
  const allowed = new Set(["P", "H1", "H2", "H3", "H4", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "STRONG", "EM", "BR", "HR", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "DEL", "A"]);
  for (const node of [...template.content.querySelectorAll("*")]) {
    if (!allowed.has(node.tagName)) {
      node.replaceWith(document.createTextNode(node.textContent || ""));
      continue;
    }
    const href = node.tagName === "A" ? node.getAttribute("href") : "";
    for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
    if (node.tagName === "A") {
      let safe = "";
      try {
        const parsed = new URL(href, state.context?.url || "https://invalid.local/");
        if (/^https?:$/.test(parsed.protocol)) safe = parsed.href;
      } catch { /* invalid link */ }
      if (!safe) node.replaceWith(...node.childNodes);
      else {
        node.href = safe;
        node.target = "_blank";
        node.rel = "noreferrer";
      }
    }
  }
  target.replaceChildren(template.content.cloneNode(true));
}

function button(label, onClick, className = "") {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

function actionsFor(text, label) {
  const row = document.createElement("div");
  row.className = "card-actions";
  row.append(
    button("存为批注", async (event) => {
      await withBusy(event.currentTarget, () => saveGeneratedNote(text));
    }),
    button("存为素材", async (event) => {
      await withBusy(event.currentTarget, () => saveGeneratedMaterial(text, label));
    })
  );
  return row;
}

async function withBusy(node, task) {
  if (node.disabled) return;
  node.disabled = true;
  try { await task(); } catch (error) { notify(error.message, true); }
  finally { node.disabled = false; }
}

function setTab(tab) {
  state.tab = tab;
  for (const node of $$(".tabs button")) node.setAttribute("aria-selected", String(node.dataset.tab === tab));
  for (const node of $$(".panel")) node.classList.toggle("active", node.dataset.panel === tab);
}

async function checkConnection(showResult = false) {
  const node = $("#connection");
  node.className = "connection";
  node.querySelector("span").textContent = "连接中";
  try {
    const result = await message({ type: "XENHO_STATUS" });
    if (!result?.ok) throw new Error(result?.error || "连接失败");
    node.classList.add("ok");
    node.querySelector("span").textContent = result.status.ready ? "已连接" : "部分可用";
    if (showResult) notify(result.status.ready ? "工作台连接正常" : "已连接，部分服务尚未配置");
  } catch (error) {
    node.classList.add("bad");
    node.querySelector("span").textContent = "未连接";
    if (showResult) notify(error.message || "工作台未启动", true);
  }
}

async function applyContext(next) {
  if (!next?.captureId) return;
  const previous = state.context;
  if (previous?.captureId && previous.captureId !== next.captureId) drafts.set(previous.captureId, $("#annotation-input").value);
  const changed = previous?.captureId !== next.captureId;
  state.context = next;
  $("#empty").hidden = true;
  $("#workspace").hidden = false;
  $("#site").textContent = next.site;
  $("#page-title").textContent = next.title;
  $("#selection").textContent = next.selection;
  $("#source-link").href = next.url;
  $("#annotation-input").value = drafts.get(next.captureId) || "";

  if (changed) {
    state.askRun?.abort();
    state.chatRun?.abort();
    state.asks = [];
    state.chat = [];
    state.sessionId = "";
    renderAsk();
    renderChat();
  }
  const destination = next.action === "chat" ? "chat" : next.action === "annotate" ? "annotate" : "ask";
  setTab(destination);
  loadNotes();
  if (next.action === "topic" && lastAutoTopic !== next.captureId) {
    lastAutoTopic = next.captureId;
    setTimeout(() => runAsk("选题"), 0);
  }
}

async function loadNotes() {
  if (!state.context) return;
  const captureId = state.context.captureId;
  $("#notes-status").className = "inline-status";
  $("#notes-status").textContent = "正在读取这页的批注…";
  try {
    const query = new URLSearchParams({ url: state.context.url, title: state.context.title });
    const data = await api(`/api/extension/annotations?${query}`);
    if (state.context?.captureId !== captureId) return;
    state.notes = data.noteItems || [];
    $("#notes-status").textContent = state.notes.length ? "" : "这页还没有批注。";
    renderNotes();
  } catch (error) {
    if (state.context?.captureId !== captureId) return;
    state.notes = [];
    $("#notes-status").className = "inline-status error";
    $("#notes-status").textContent = error.message;
    renderNotes();
  }
}

function renderNotes() {
  $("#note-count").textContent = `${state.notes.length} 条`;
  const list = $("#notes-list");
  list.replaceChildren();
  for (const note of [...state.notes].reverse()) {
    const card = document.createElement("article");
    card.className = "note-card";
    const meta = document.createElement("div");
    meta.className = "card-meta";
    const stamp = document.createElement("span");
    stamp.textContent = note.stamp;
    const mark = document.createElement("strong");
    mark.textContent = "网页批注";
    meta.append(mark, stamp);
    const quote = document.createElement("p");
    quote.className = "note-quote";
    quote.textContent = `“${note.quote}”`;
    const body = document.createElement("div");
    body.className = "note-body rich";
    renderMarkdown(body, note.body);
    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      button("编辑", () => editNoteCard(card, note)),
      button("删除", () => removeNote(note), "danger")
    );
    card.append(meta, quote, body, actions);
    list.append(card);
  }
}

function editNoteCard(card, note) {
  if (card.querySelector("textarea")) return;
  const body = card.querySelector(".note-body");
  const actions = card.querySelector(".card-actions");
  const edit = document.createElement("textarea");
  edit.className = "note-edit";
  edit.value = note.body;
  body.replaceWith(edit);
  actions.replaceChildren(
    button("取消", renderNotes),
    button("保存修改", async (event) => {
      await withBusy(event.currentTarget, async () => {
        const data = await api("/api/extension/annotation/edit", {
          method: "POST",
          body: { url: state.context.url, title: state.context.title, index: note.index, stamp: note.stamp, body: edit.value },
        });
        state.notes = data.noteItems || [];
        renderNotes();
        notify("批注已更新");
      });
    })
  );
  edit.focus();
}

async function removeNote(note) {
  if (!confirm("删除这条批注？")) return;
  try {
    const data = await api("/api/extension/annotation/edit", {
      method: "POST",
      body: { url: state.context.url, title: state.context.title, index: note.index, stamp: note.stamp, remove: true },
    });
    state.notes = data.noteItems || [];
    $("#notes-status").textContent = state.notes.length ? "" : "这页还没有批注。";
    renderNotes();
    notify("批注已删除");
  } catch (error) { notify(error.message, true); }
}

async function saveNote() {
  const input = $("#annotation-input");
  const body = input.value.trim();
  if (!body) return notify("先写一点自己的想法", true);
  const captureId = state.context.captureId;
  const data = await api("/api/extension/annotation", {
    method: "POST",
    body: { url: state.context.url, title: state.context.title, selection: state.context.selection, body },
  });
  if (state.context?.captureId !== captureId) return;
  state.notes = data.noteItems || [];
  input.value = "";
  drafts.delete(captureId);
  $("#notes-status").textContent = "";
  renderNotes();
  notify("批注已写入本地知识库");
}

function scheduleAskRender() {
  if (askFrame) return;
  askFrame = requestAnimationFrame(() => { askFrame = 0; renderAsk(); });
}

function renderAsk() {
  const list = $("#ask-list");
  list.replaceChildren();
  $("#ask-empty").hidden = state.asks.length > 0;
  $("#stop-ask").hidden = !state.askRun;
  for (const node of $$("[data-mode]")) node.classList.toggle("running", state.asks.some((item) => item.mode === node.dataset.mode && item.status === "loading"));
  for (const item of state.asks) {
    const card = document.createElement("article");
    card.className = `result-card${item.status === "loading" && !item.text ? " loading" : ""}`;
    const meta = document.createElement("div");
    meta.className = "card-meta";
    const mode = document.createElement("strong");
    mode.textContent = item.mode;
    const status = document.createElement("span");
    status.textContent = item.status === "loading" ? "生成中…" : item.status === "error" ? "失败" : "已完成";
    meta.append(mode, status);
    const rich = document.createElement("div");
    rich.className = "rich";
    if (item.error) rich.textContent = item.error;
    else renderMarkdown(rich, item.text);
    card.append(meta, rich);
    if (item.status === "done" && item.text) card.append(actionsFor(item.text, `AI ${item.mode}`));
    list.append(card);
  }
}

async function runAsk(mode) {
  if (!state.context) return;
  state.askRun?.abort();
  let item = state.asks.find((candidate) => candidate.mode === mode);
  if (!item) {
    item = { mode, text: "", status: "loading", error: "" };
    state.asks.push(item);
  } else Object.assign(item, { text: "", status: "loading", error: "" });
  renderAsk();
  const run = openStream("/api/extension/ask", {
    mode,
    selection: state.context.selection,
    context: state.context.context,
    title: state.context.title,
  }, { onChunk: (chunk) => { item.text += chunk; scheduleAskRender(); } });
  state.askRun = run;
  renderAsk();
  try {
    const ended = await run.promise;
    item.status = ended === "aborted" ? "done" : "done";
  } catch (error) {
    item.status = "error";
    item.error = error.message;
  } finally {
    if (state.askRun === run) state.askRun = null;
    renderAsk();
  }
}

async function saveGeneratedNote(text) {
  const data = await api("/api/extension/annotation", {
    method: "POST",
    body: { url: state.context.url, title: state.context.title, selection: state.context.selection, body: text },
  });
  state.notes = data.noteItems || [];
  renderNotes();
  notify("已存为批注");
}

async function saveGeneratedMaterial(text, label) {
  await api("/api/extension/intake", {
    method: "POST",
    body: {
      target: "material",
      cmd: "",
      content: `${state.context.selection}\n\n---\n\n${label}\n${text}`,
      source: state.context.url,
    },
  });
  notify("已存入素材库");
}

function renderChat() {
  const log = $("#chat-log");
  log.replaceChildren();
  for (const item of state.chat) {
    const box = document.createElement("article");
    box.className = `message ${item.role}`;
    if (item.role === "system") box.textContent = item.text;
    else {
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = item.role === "user" ? "你" : item.engine === "codex" ? "CODEX" : "CLAUDE CODE";
      const body = document.createElement("div");
      body.className = item.role === "agent" ? "rich" : "";
      if (item.role === "agent") renderMarkdown(body, item.text || (item.pending ? "思考中…" : item.error || "没有收到回复"));
      else body.textContent = item.text;
      box.append(who, body);
      if (item.role === "agent" && !item.pending && item.text) box.append(actionsFor(item.text, `${who.textContent} 对话`));
    }
    log.append(box);
  }
  $("#stop-chat").hidden = !state.chatRun;
  $("#send-chat").disabled = !!state.chatRun;
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; boxScroll(); });
}

function boxScroll() {
  const last = $("#chat-log .message:last-child");
  last?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function sendChat() {
  if (!state.context || state.chatRun) return;
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return notify("先写下你的问题", true);
  input.value = "";
  state.chat.push({ role: "user", text });
  const reply = { role: "agent", engine: state.engine, text: "", pending: true, error: "" };
  state.chat.push(reply);
  renderChat();
  const run = openStream("/api/extension/chat", {
    message: text,
    agent: state.engine,
    sessionId: state.sessionId,
    docTitle: state.context.title,
    selection: state.context.selection,
    sourceUrl: state.context.url,
    pageContext: $("#include-context").checked ? state.context.context : "",
  }, {
    onSession: (id) => { if (id) state.sessionId = id; },
    onChunk: (chunk) => { reply.text += chunk; renderChat(); },
  });
  state.chatRun = run;
  renderChat();
  try {
    await run.promise;
  } catch (error) {
    reply.error = error.message;
    if (!reply.text) notify(error.message, true);
  } finally {
    reply.pending = false;
    if (state.chatRun === run) state.chatRun = null;
    renderChat();
  }
}

function resetChat(messageText = "") {
  state.chatRun?.abort();
  state.chatRun = null;
  state.sessionId = "";
  state.chat = messageText ? [{ role: "system", text: messageText }] : [];
  renderChat();
}

for (const tab of $$(".tabs button")) tab.addEventListener("click", () => setTab(tab.dataset.tab));
for (const mode of $$("[data-mode]")) mode.addEventListener("click", () => runAsk(mode.dataset.mode));
for (const engine of $$("[data-engine]")) engine.addEventListener("click", () => {
  if (state.engine === engine.dataset.engine) return;
  state.engine = engine.dataset.engine;
  for (const item of $$("[data-engine]")) item.setAttribute("aria-pressed", String(item.dataset.engine === state.engine));
  resetChat("已切换引擎，新引擎不会继承上一轮上下文。");
});

$("#connection").addEventListener("click", () => checkConnection(true));
$("#save-note").addEventListener("click", (event) => withBusy(event.currentTarget, saveNote));
$("#annotation-input").addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") { event.preventDefault(); $("#save-note").click(); }
});
$("#stop-ask").addEventListener("click", () => state.askRun?.abort());
$("#new-chat").addEventListener("click", () => resetChat());
$("#send-chat").addEventListener("click", sendChat);
$("#stop-chat").addEventListener("click", () => state.chatRun?.abort());
$("#chat-input").addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") { event.preventDefault(); sendChat(); }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.currentCapture?.newValue) applyContext(changes.currentCapture.newValue);
});

checkConnection();
message({ type: "XENHO_CONTEXT" }).then((result) => applyContext(result?.context)).catch(() => {});
