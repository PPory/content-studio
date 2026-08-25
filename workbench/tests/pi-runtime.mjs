import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createPiTools } from "../server/agent-runtime/pi-tools.mjs";
import { agentAccess, agentMountsFromUserMessage, resolveAgentMountPath } from "../server/agent-runtime/agent-access.mjs";
import { permissionModeCatalog, PERMISSION_MODES, resolveProjectPath, resolveVaultPath } from "../server/agent-runtime/permission-modes.mjs";
import { PI_RUNTIME_VERSION, piRuntimeInfo, probePiRuntime } from "../server/agent-runtime/pi-runtime.mjs";
import { assistantConversations, assistantExperts, assistantSkills, createAssistantConversation, manageAssistantConversation } from "../server/agent-runtime/assistant-runner.mjs";
import { guidedSessionId } from "../server/agent-runtime/guided-runner.mjs";
import { XENHO_QUALITY_NINE } from "../server/lib/quality-nine.mjs";
import { WB_ROOT } from "../server/lib/vault-dirs.mjs";
import { documentVersion } from "../src/lib/document-version.js";

const info = await piRuntimeInfo({});
assert.equal(info.available, true, info.reason);
assert.equal(info.version, PI_RUNTIME_VERSION);
assert.deepEqual(info.versions, {
  "@earendil-works/pi-coding-agent": "0.84.3",
  "@earendil-works/pi-ai": "0.84.3",
});
assert.equal(info.configured, false, "空配置不该被误判为可执行");
assert.equal(XENHO_QUALITY_NINE.length, 9, "Xenho 品控问题必须保持九项唯一真源");
assert.equal(new Set(XENHO_QUALITY_NINE.map((item) => item.id)).size, 9, "品控九问 id 重复");

const modes = permissionModeCatalog();
assert.deepEqual(modes.map((item) => item.id), ["daily", "creative", "developer"]);
assert(!PERMISSION_MODES.daily.tools.includes("document_create"));
assert(PERMISSION_MODES.creative.tools.includes("document_create"));
assert(!PERMISSION_MODES.creative.tools.includes("powershell"));
assert(PERMISSION_MODES.developer.tools.includes("powershell"));
assert(PERMISSION_MODES.daily.tools.includes("workbench_projects"), "工作台实时状态必须在日常模式可读");

const skills = await assistantSkills();
assert.deepEqual(skills.items.map((item) => item.id).sort(), ["fact-check", "idea-dialogue", "interview-to-draft", "material-extraction", "material-gap", "publish-review", "topic-clustering", "xenho-quality-nine"]);
assert(skills.items.every((item) => item.source === ".agents/skills"), "Skill 必须只来自 .agents/skills");
assert.equal(assistantExperts().items.length, 6);
assert.notEqual(documentVersion({ title: "A", body: "第一版" }), documentVersion({ title: "A", body: "第二版" }));
const restored = "50879135-9d18-49a3-bab4-d8aab36be661";
assert.equal(guidedSessionId(restored), restored);
assert.match(guidedSessionId(""), /^[0-9a-f-]{36}$/i);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-pi-permissions-"));
const vault = path.join(tempRoot, "vault");
const outside = path.join(tempRoot, "outside");
const actionsFile = path.join(tempRoot, "actions.jsonl");
await fs.mkdir(path.join(vault, WB_ROOT), { recursive: true });
await fs.mkdir(outside, { recursive: true });
await fs.writeFile(path.join(vault, WB_ROOT, "read.md"), "# 临时文档\n", "utf8");
await fs.writeFile(path.join(outside, "secret.md"), "outside", "utf8");
const workerProjects = [
  { id: "p-writing", title: "写作项目", stage: "写作中", stageReason: "主稿仍在写作", nextAction: "继续写作", blockers: [], updatedAt: "2026-08-25T01:00:00.000Z" },
  { id: "p-release", title: "待发项目", stage: "待发布", stageReason: "诊断已通过", nextAction: "去排版发布", blockers: [], updatedAt: "2026-08-25T02:00:00.000Z" },
  { id: "p-legal", title: "新状态项目", stage: "等待法务", stageReason: "等待新增流程", nextAction: "确认授权", blockers: ["版权待确认"], updatedAt: "2026-08-25T03:00:00.000Z" },
];
const workerServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/wb/projects" || req.headers["x-workbench-key"] !== "test-key") {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "not found" }));
  }
  const counts = Object.fromEntries([...new Set(workerProjects.map((item) => item.stage))].map((stage) => [stage, workerProjects.filter((item) => item.stage === stage).length]));
  const selected = url.searchParams.get("stage") ? workerProjects.filter((item) => item.stage === url.searchParams.get("stage")) : workerProjects;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, projects: selected, counts, total: selected.length, nextCursor: null }));
});
await new Promise((resolve) => workerServer.listen(0, "127.0.0.1", resolve));
const workerAddress = workerServer.address();
const env = { VAULT_ROOT: vault, WORKER_URL: `http://127.0.0.1:${workerAddress.port}`, WORKBENCH_KEY: "test-key" };
try {
  await assert.rejects(() => resolveVaultPath(env, "../outside/secret.md"), /路径越界/);
  await assert.rejects(() => resolveVaultPath(env, path.join(outside, "secret.md")), /路径越界/);
  await assert.rejects(() => resolveVaultPath(env, ".obsidian/config"), /隐藏目录/);
  await assert.rejects(() => resolveProjectPath("../outside.txt", { write: true }), /路径越界/);
  await assert.rejects(() => resolveProjectPath("node_modules/blocked.txt", { write: true }), /依赖目录/);

  const junction = path.join(vault, WB_ROOT, "outside-link");
  try {
    await fs.symlink(outside, junction, "junction");
    await assert.rejects(() => resolveVaultPath(env, `${WB_ROOT}/outside-link/secret.md`), /范围外的链接/);
  } catch (error) {
    if (!["EPERM", "EACCES", "UNKNOWN"].includes(error?.code)) throw error;
  }

  const [external] = await agentMountsFromUserMessage(`请读取项目目录 "${outside}"`);
  assert(external && external.kind === "folder", "本轮消息中的真实目录没有生成对话级授权");
  assert.deepEqual(await agentMountsFromUserMessage(`错误日志：${outside}`), [], "无访问意图的日志路径不该自动授权");
  assert.deepEqual(await agentMountsFromUserMessage("请读取 \\\\server\\share"), [], "UNC 路径不该自动授权");
  const dailyAccess = await agentAccess({ ...env, AGENT_SESSION_MOUNTS: [external], AGENT_PERMISSION_MODE: "daily" });
  assert(dailyAccess.public.every((item) => !item.write && !item.execute), "日常模式下工作台和本地项目必须保持只读");
  const sessionEnv = { ...env, AGENT_SESSION_MOUNTS: [external], AGENT_PERMISSION_MODE: "developer" };
  const access = await agentAccess(sessionEnv);
  assert(access.public.some((item) => item.id === external.id && item.write && item.execute));
  assert.equal((await resolveAgentMountPath(sessionEnv, external.id, "secret.md")).absolute, path.join(outside, "secret.md"));
  await assert.rejects(() => resolveAgentMountPath(sessionEnv, external.id, "../vault"), /越过了已授权|越过/);
  await assert.rejects(() => resolveAgentMountPath(sessionEnv, external.id, "secret.md:stream"), /数据流/);
  await assert.rejects(() => resolveAgentMountPath(sessionEnv, external.id, ".GIT/config", { write: true }), /版本库元数据/);

  const [singleFile] = await agentMountsFromUserMessage(`请打开文件 "${path.join(outside, "secret.md")}"`);
  const fileEnv = { ...env, AGENT_SESSION_MOUNTS: [singleFile], AGENT_PERMISSION_MODE: "daily" };
  assert.equal((await resolveAgentMountPath(fileEnv, singleFile.id, ".")).absolute, path.join(outside, "secret.md"));
  await assert.rejects(() => resolveAgentMountPath(fileEnv, singleFile.id, "sibling.md"), /只允许读取指定文件/);

  const context = { project: { title: "临时" }, attachments: [], localSources: [], projectMaterials: [] };
  const daily = createPiTools({ env: sessionEnv, mode: "daily", context, actionsFile });
  const creative = createPiTools({ env: sessionEnv, mode: "creative", context, actionsFile });
  const developer = createPiTools({ env: sessionEnv, mode: "developer", context, actionsFile });
  const required = ["workbench_projects", "workspace_list", "workspace_search", "workspace_read", "workspace_write", "workspace_edit", "workspace_powershell", "hotspot_search", "vault_list", "vault_read", "annotation_list", "document_create", "document_update", "annotation_append", "reference_insert", "web_search", "web_fetch"];
  const allNames = new Set(developer.map((item) => item.name));
  for (const name of required) assert(allNames.has(name), `缺少 Pi defineTool：${name}`);
  const execute = (items, name, params) => items.find((item) => item.name === name).execute("test-call", params, undefined, undefined, {});
  const overview = JSON.parse((await execute(daily, "workbench_projects", {})).content[0].text);
  assert.equal(overview.counts["等待法务"], 1, "新增状态没有从 Worker 动态返回");
  assert.equal(overview.projects.length, 3, "工作台状态工具没有返回当前项目");
  const legalOnly = JSON.parse((await execute(daily, "workbench_projects", { stage: "等待法务" })).content[0].text);
  assert.deepEqual(legalOnly.projects.map((item) => item.id), ["p-legal"], "状态筛选没有原样交给 Worker");
  await assert.rejects(() => execute(daily, "document_create", { path: `${WB_ROOT}/daily.md`, content: "x" }), /日常模式不允许/);
  const localRead = await execute(daily, "workspace_read", { mountId: external.id, path: "secret.md" });
  assert.match(localRead.content[0].text, /outside/);
  await assert.rejects(() => execute(daily, "workspace_write", { mountId: external.id, path: "new.txt", content: "x" }), /日常模式不允许/);
  await execute(developer, "workspace_write", { mountId: external.id, path: "new.txt", content: "candidate" });
  await execute(developer, "workspace_edit", { mountId: external.id, path: "secret.md", oldText: "outside", newText: "candidate" });
  await assert.rejects(() => fs.access(path.join(outside, "new.txt")), { code: "ENOENT" });
  await execute(creative, "document_create", { path: `${WB_ROOT}/creative.md`, content: "候选" });
  await assert.rejects(() => fs.access(path.join(vault, WB_ROOT, "creative.md")), { code: "ENOENT" });
  const queued = (await fs.readFile(actionsFile, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(queued.find((item) => item.type === "workspace_write")?.expectedStamp, "");
  assert.match(queued.find((item) => item.type === "workspace_edit")?.expectedStamp || "", /:/);
  assert.equal(queued.at(-1).type, "document_create");
  assert.equal(queued.at(-1).permissionMode, "creative");
  await assert.rejects(() => execute(creative, "powershell", { command: "Get-Location" }), /创作模式不允许/);
  await assert.rejects(() => execute(developer, "powershell", { command: "Remove-Item -Recurse ." }), /破坏性删除/);

} finally {
  await new Promise((resolve) => workerServer.close(resolve));
  await fs.rm(tempRoot, { recursive: true, force: true });
}

const conversationScope = `test-conversations-${crypto.randomUUID()}`;
const conversationScopeKey = crypto.createHash("sha256").update(conversationScope).digest("hex").slice(0, 24);
const conversationStore = path.resolve(process.cwd(), ".xenho", "assistant", conversationScopeKey);
try {
  const first = await createAssistantConversation(conversationScope);
  const second = await createAssistantConversation(conversationScope);
  await manageAssistantConversation(conversationScope, first.id, { action: "rename", title: "手动标题 A" });
  await manageAssistantConversation(conversationScope, second.id, { action: "rename", title: "手动标题 B" });
  await manageAssistantConversation(conversationScope, first.id, { action: "pin" });
  let index = await assistantConversations(conversationScope);
  assert.equal(index.items[0].id, first.id, "置顶对话没有排在最近列表前面");
  await manageAssistantConversation(conversationScope, second.id, { action: "archive" });
  index = await assistantConversations(conversationScope);
  assert.equal(index.activeId, first.id, "归档当前对话后没有回退到下一条最近对话");
  assert(index.items.find((item) => item.id === second.id)?.archivedAt, "归档时间没有进入对话摘要");
  await manageAssistantConversation(conversationScope, second.id, { action: "restore" });
  assert(!(await assistantConversations(conversationScope)).items.find((item) => item.id === second.id)?.archivedAt, "恢复对话没有清除归档状态");
  await manageAssistantConversation(conversationScope, first.id, { action: "delete" });
  assert(!(await assistantConversations(conversationScope)).items.some((item) => item.id === first.id), "删除后的对话仍出现在历史列表");
  assert((await fs.readdir(path.join(conversationStore, ".trash"))).some((name) => name.startsWith(first.id)), "删除没有进入本地回收目录");
} finally {
  await fs.rm(conversationStore, { recursive: true, force: true });
}

const probe = await probePiRuntime();
assert.equal(probe.ok, true);
assert.equal(probe.version, "0.84.3");
console.log("✓ Pi Agent SDK 0.84.3 已完成直接 SDK、defineTool、Skill 和会话标识校验");
console.log("✓ daily / creative / developer 能力预设、消息内对话级工作区授权、候选写入和越界防护已校验");
console.log("✓ 历史对话的重命名、置顶、归档、恢复、删除与 activeId 回退已校验");
console.log("✓ Xenho 品控九问保持九项唯一真源");
