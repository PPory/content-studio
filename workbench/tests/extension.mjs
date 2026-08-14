/**
 * 扩展边界测试：验证 manifest 权限、MV3 休眠恢复，以及迁移后的扩展 API 闭环。
 * 不碰真实 vault / D1；所有写入都落系统临时目录或本机假 Worker，并在结束时清理。
 */

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { workbenchApi } from "../server/vite-plugin-workbench.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 5197;
const vault = await fs.mkdtemp(path.join(os.tmpdir(), "wb-extension-"));
const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass, detail });

const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "extension", "manifest.json"), "utf8"));
const content = await fs.readFile(path.join(ROOT, "extension", "content.js"), "utf8");
const background = await fs.readFile(path.join(ROOT, "extension", "background.js"), "utf8");
const extensionReadme = await fs.readFile(path.join(ROOT, "extension", "README.md"), "utf8");
const panel = await fs.readFile(path.join(ROOT, "extension", "sidepanel.html"), "utf8");
const panelCss = await fs.readFile(path.join(ROOT, "extension", "sidepanel.css"), "utf8");
const panelJs = await fs.readFile(path.join(ROOT, "extension", "sidepanel.js"), "utf8");

check("扩展使用 Manifest V3", manifest.manifest_version === 3);
check("迁移后的扩展版本已升级", manifest.version === "0.2.0", manifest.version);
check("扩展只连接本机工作台", manifest.host_permissions?.join() === "http://127.0.0.1:5180/*", manifest.host_permissions?.join());
check("没有申请多余的高危权限", manifest.permissions?.join() === "sidePanel,storage", manifest.permissions?.join());
check("普通网页才注入划词入口", manifest.content_scripts?.[0]?.matches?.join() === "http://*/*,https://*/*", manifest.content_scripts?.[0]?.matches?.join());
check("工具条没有高亮和翻译", !content.includes('"highlight"') && !content.includes('"translate"'));
check("工具条保留五个入口", ["annotate", "ask", "chat", "topic", "intake"].every((key) => content.includes(`[\"${key}\"`)));
check("工具条入库提供两个工作台去处", [
  'data-target="material"',
  'data-target="inbox"',
  "素材库",
  "灵感库",
].every((token) => content.includes(token)));
check("入库选择使用紧凑双图标次级工具条", content.includes("grid-template-columns:repeat(2,30px)") && content.includes("width:30px;height:30px") && content.includes('class="choice-tip"'));
check("入库次级工具条与主工具条有明确层级", content.includes("background:#fbfaf7;color:#3f4148") && content.includes(".intake-menu::before") && content.includes("box-shadow:0 7px 16px rgba(0,0,0,.16)"));
check("提问入口使用灯泡图标", content.includes('ask: \'<path d="M9 18h6"/><path d="M10 22h4"/>'));
check("扩展后台只接受既定入库去处", background.includes('new Set(["material", "inbox"])') && background.includes("INTAKE_TARGETS.has(target)"));
check("入库继续经过扩展专用安全入口", background.includes('api("/api/extension/intake"') && background.includes("body: { target, cmd: \"\", content: context.selection, source: context.url }"));
check("配对信息保存在 Chrome 会话而不是易失全局变量", background.includes("chrome.storage.session.get(CONNECTION_KEY)") && background.includes("chrome.storage.session.set({ [CONNECTION_KEY]: connection })") && !background.includes("let pairToken"));
check("手动连接检测会绕过缓存", background.includes('connect(true).then(({ status })'));
check("插件文档明确使用 content-studio 与 D1", extensionReadme.includes("content-studio") && extensionReadme.includes("D1 流水线") && extensionReadme.includes("不再依赖或直连 Notion"));
check("多行选区按收笔端点定位", content.includes("function endpointRect") && content.includes("selection.focusNode") && content.includes("range.getClientRects()"));
check("右侧面板只有批注提问对话三栏", ["批注", "提问", "对话"].every((label) => panel.includes(`>${label}<`)));
check("右侧面板复用工作台字体与标记色", ["Noto Sans SC", "Space Grotesk", "JetBrains Mono", "--mark-yellow"].every((token) => panelCss.includes(token)));
check("右侧面板跟随工作台明暗主题", panelCss.includes("prefers-color-scheme: dark"));
check("对话空态不再占据独立区域", !panel.includes("直接问。第一轮") && !panelJs.includes("直接问。第一轮") && panelCss.includes(".chat-log:empty { display: none; }"));
check("新对话缩成加号按钮", panel.includes('aria-label="新对话"') && panel.includes('title="新对话">+</button>'));
check("四种提问方式压成一排", panelCss.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"));
check("提问提示不再使用容器边框", panelCss.includes(".hint-block { margin-top: 10px; padding: 0 2px;") && !panelCss.includes(".hint-block { margin-top: 9px; padding: 9px 10px; border:"));
check("对话输入框单独压低", panelCss.includes(".chat-composer textarea { height: 72px; min-height: 72px; max-height: 180px; }"));
check("中文界面和英文标记分别使用工作台字体", panel.includes("网页助手 <em>· WEB ASSIST</em>") && panelCss.includes(".brand span em") && panelCss.includes(".composer-foot kbd"));

const forwarded = [];
const pipelineServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  forwarded.push({
    url: req.url,
    key: req.headers["x-workbench-key"],
    body: text ? JSON.parse(text) : null,
  });
  if (req.url === "/wb/intake") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, dbType: "material" }));
  }
  if (req.url === "/wb/explain") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end("来自 D1 流水线的解释");
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: `unexpected ${req.url}` }));
});
await new Promise((resolve, reject) => {
  pipelineServer.once("error", reject);
  pipelineServer.listen(0, "127.0.0.1", resolve);
});
const pipelineAddress = pipelineServer.address();
const workerUrl = `http://127.0.0.1:${pipelineAddress.port}`;

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: "error",
  plugins: [workbenchApi({ VAULT_ROOT: vault, WORKER_URL: workerUrl, WORKBENCH_KEY: "extension-test-key" })],
  server: { host: "127.0.0.1", port: PORT, strictPort: true },
});

try {
  await server.listen();
  const base = `http://127.0.0.1:${PORT}`;
  const marker = { "X-Xenho-Extension": "1" };

  const blocked = await fetch(`${base}/api/extension/status`);
  check("没有扩展标记的请求被拒绝", blocked.status === 403, `HTTP ${blocked.status}`);

  const statusRes = await fetch(`${base}/api/extension/status`, { headers: marker });
  const status = await statusRes.json();
  check("扩展能临时配对", statusRes.ok && status.ok && status.pairToken?.length >= 24);
  check("只接受 content-studio 第二版协议", status.product === "content-studio" && status.protocolVersion === 2);
  check("D1 流水线配置完整时报告已就绪", status.ready === true && status.services?.pipeline === true);
  const auth = { ...marker, "X-Xenho-Token": status.pairToken };

  const noToken = await fetch(`${base}/api/extension/annotations?url=${encodeURIComponent("https://example.com/a")}`, { headers: marker });
  check("除配对外都必须带临时令牌", noToken.status === 401, `HTTP ${noToken.status}`);

  const hostile = await fetch(`${base}/api/extension/annotations?url=${encodeURIComponent("https://example.com/a")}`, {
    headers: { ...auth, Origin: "https://evil.example" },
  });
  check("普通网页来源即使猜到令牌也被拒绝", hostile.status === 403, `HTTP ${hostile.status}`);

  const intakeRes = await fetch(`${base}/api/extension/intake`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ target: "material", cmd: "", content: "迁移后的素材", source: "https://example.com/a" }),
  });
  const intake = await intakeRes.json();
  check("插件入库已映射到 D1 流水线", intakeRes.ok && intake.ok && intake.dbType === "material");
  const intakeForward = forwarded.find((item) => item.url === "/wb/intake");
  check("入库保留鉴权与原始内容", intakeForward?.key === "extension-test-key" && intakeForward?.body?.content === "迁移后的素材");

  const askRes = await fetch(`${base}/api/extension/ask`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ mode: "解释", selection: "被选中的内容" }),
  });
  check("插件提问已映射到新工作台 AI 流", askRes.ok && (await askRes.text()) === "来自 D1 流水线的解释");

  const chatRes = await fetch(`${base}/api/extension/chat`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: "{}",
  });
  const chat = await chatRes.json();
  check("插件对话已映射到新工作台 Agent", chatRes.status === 400 && chat.error === "message 不能为空");

  const saveRes = await fetch(`${base}/api/extension/annotation`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/a?utm_source=test", title: "测试网页", selection: "值得留下的句子", body: "我的第一条判断" }),
  });
  const saved = await saveRes.json();
  check("网页批注通过扩展端点写入", saveRes.ok && saved.noteItems?.length === 1, JSON.stringify(saved));

  const readRes = await fetch(`${base}/api/extension/annotations?url=${encodeURIComponent("https://example.com/a")}&title=${encodeURIComponent("标题变了")}`, { headers: auth });
  const read = await readRes.json();
  check("同一网页能读回自己的批注", readRes.ok && read.path === saved.path && read.noteItems?.[0]?.body === "我的第一条判断");

  const editRes = await fetch(`${base}/api/extension/annotation/edit`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/a", index: 0, stamp: read.noteItems[0].stamp, body: "改过的判断" }),
  });
  const edited = await editRes.json();
  check("网页批注可以编辑", editRes.ok && edited.noteItems?.[0]?.body === "改过的判断");

  const removeRes = await fetch(`${base}/api/extension/annotation/edit`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/a", index: 0, stamp: edited.noteItems[0].stamp, remove: true }),
  });
  const removed = await removeRes.json();
  check("网页批注可以删除", removeRes.ok && removed.noteItems?.length === 0);
} finally {
  await server.close();
  await new Promise((resolve) => pipelineServer.close(resolve));
  await fs.rm(vault, { recursive: true, force: true });
}

console.log("");
for (const item of checks) console.log(` ${item.pass ? "✓" : "✗"} ${item.name}${item.detail ? `  ← ${item.detail}` : ""}`);
const failed = checks.filter((item) => !item.pass).length;
console.log(`\n ${checks.length - failed}/${checks.length} 通过\n`);
process.exit(failed ? 1 : 0);
