import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPiTools } from "../server/agent-runtime/pi-tools.mjs";
import { agentAccess, agentMountsFromUserMessage, resolveAgentMountPath } from "../server/agent-runtime/agent-access.mjs";
import { permissionModeCatalog, PERMISSION_MODES, resolveProjectPath } from "../server/agent-runtime/permission-modes.mjs";
import { PI_RUNTIME_VERSION, piImageContent, piRuntimeInfo, probePiRuntime } from "../server/agent-runtime/pi-runtime.mjs";
import {
  assistantConversations,
  assistantExperts,
  assistantSkills,
  configureAssistantWorkspace,
  createAssistantConversation,
  manageAssistantConversation,
} from "../server/agent-runtime/assistant-runner.mjs";
import { XENHO_QUALITY_NINE } from "../server/lib/quality-nine.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { documentVersion } from "../src/lib/document-version.js";

const info = await piRuntimeInfo({});
assert.equal(info.available, true, info.reason);
assert.equal(info.version, PI_RUNTIME_VERSION);
assert.deepEqual(info.versions, {
  "@earendil-works/pi-coding-agent": "0.84.3",
  "@earendil-works/pi-ai": "0.84.3",
});
assert.equal(info.configured, false, "空配置不该被误判为可执行");
assert.deepEqual(piImageContent(Buffer.from([1, 2, 3]), "image/png"), { type: "image", data: "AQID", mimeType: "image/png" });
assert.equal(XENHO_QUALITY_NINE.length, 9, "Xenho 品控问题必须保持九项唯一真源");
assert.equal(new Set(XENHO_QUALITY_NINE.map((item) => item.id)).size, 9, "品控九问 id 重复");

const modes = permissionModeCatalog();
assert.deepEqual(modes.map((item) => item.id), ["daily", "creative", "developer"]);
assert(!PERMISSION_MODES.daily.tools.includes("document_create"));
assert(!PERMISSION_MODES.creative.tools.includes("document_create"));
assert(!PERMISSION_MODES.developer.tools.includes("document_create"));
assert(!PERMISSION_MODES.creative.tools.includes("powershell"));
assert(PERMISSION_MODES.developer.tools.includes("powershell"));
assert(PERMISSION_MODES.daily.tools.includes("workbench_projects"));

const skills = await assistantSkills();
assert.deepEqual(skills.items.map((item) => item.id).sort(), ["fact-check", "idea-dialogue", "interview-to-draft", "material-extraction", "material-gap", "publish-review", "topic-clustering", "xenho-quality-nine"]);
assert(skills.items.every((item) => item.source === ".agents/skills"));
assert.equal(assistantExperts().items.length, 6);
assert.notEqual(documentVersion({ title: "A", body: "第一版" }), documentVersion({ title: "A", body: "第二版" }));

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-pi-runtime-"));
const xenhoHome = path.join(tempRoot, "Xenho");
const outside = path.join(tempRoot, "authorized-folder");
const actionsFile = path.join(tempRoot, "actions.jsonl");
let workspace = await openWorkspace({ xenhoHome });

try {
  configureAssistantWorkspace(workspace);
  assert(path.resolve(workspace.paths.root).startsWith(path.resolve(tempRoot)), "测试工作区必须位于系统临时目录");
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, "source.txt"), "isolated source", "utf8");

  const projectId = workspace.domain.createProject({ title: "隔离 Pi 项目", confirmed: true, actor: "user", now: new Date() });
  const draftId = workspace.domain.createDraft({ projectId, title: "隔离 Pi 项目", bodyMarkdown: "本地正文", platform: "公众号", actor: "user", now: new Date() });
  workspace.domain.setPrimaryDraft(projectId, draftId, { actor: "user", now: new Date() });

  await assert.rejects(() => resolveProjectPath("../outside.txt", { write: true }), /路径越界/);
  await assert.rejects(() => resolveProjectPath("node_modules/blocked.txt", { write: true }), /依赖目录/);

  const [external] = await agentMountsFromUserMessage(`请读取项目目录 "${outside}"`);
  assert(external && external.kind === "folder", "明确授权目录没有生成对话级挂载");
  assert.deepEqual(await agentMountsFromUserMessage(`错误日志：${outside}`), [], "没有访问意图的路径不该自动授权");
  assert.deepEqual(await agentMountsFromUserMessage("请读取 \\\\server\\share"), [], "UNC 路径不该自动授权");

  const dailyEnv = { AGENT_SESSION_MOUNTS: [external], AGENT_PERMISSION_MODE: "daily" };
  const dailyAccess = await agentAccess(dailyEnv);
  assert(dailyAccess.public.every((item) => !item.write && !item.execute), "日常模式必须保持只读");
  const developerEnv = { AGENT_SESSION_MOUNTS: [external], AGENT_PERMISSION_MODE: "developer" };
  const developerAccess = await agentAccess(developerEnv);
  assert(developerAccess.public.some((item) => item.id === external.id && item.write && item.execute));
  assert.equal((await resolveAgentMountPath(developerEnv, external.id, "source.txt")).absolute, path.join(outside, "source.txt"));
  await assert.rejects(() => resolveAgentMountPath(developerEnv, external.id, "../outside"), /越过/);
  await assert.rejects(() => resolveAgentMountPath(developerEnv, external.id, "source.txt:stream"), /数据流/);

  const imageAttachmentPath = path.join(tempRoot, "attachment.png");
  await fs.writeFile(imageAttachmentPath, Buffer.from([1, 2, 3]));
  const context = {
    workspace,
    project: { id: projectId, title: "隔离 Pi 项目" },
    attachments: [
      { id: "image-1", name: "attachment.png", kind: "image", type: "image/png", originalPath: imageAttachmentPath, imageRef: { mediaType: "image/png" } },
      { id: "text-1", name: "note.txt", kind: "text", type: "text/plain", extractedText: "已导入 SQLite 的附件文本" },
    ],
    localSources: [],
    projectMaterials: [],
  };
  const daily = createPiTools({ env: dailyEnv, mode: "daily", context, actionsFile });
  const creative = createPiTools({ env: dailyEnv, mode: "creative", context, actionsFile });
  const developer = createPiTools({ env: developerEnv, mode: "developer", context, actionsFile });
  const allNames = new Set(developer.map((item) => item.name));
  for (const name of ["workbench_projects", "knowledge_search", "workspace_list", "workspace_search", "workspace_read", "workspace_write", "workspace_edit", "workspace_powershell", "hotspot_search", "attachment_read", "web_search", "web_fetch"]) {
    assert(allNames.has(name), `缺少 Pi defineTool：${name}`);
  }
  for (const name of ["vault_list", "vault_read", "annotation_list", "document_create", "document_update", "annotation_append", "reference_insert"]) {
    assert(!allNames.has(name), `本地优先运行时不应暴露旧 vault 工具：${name}`);
  }
  const execute = (items, name, params) => items.find((item) => item.name === name).execute("test-call", params, undefined, undefined, {});
  const imageAttachment = await execute(daily, "attachment_read", { id: "image-1" });
  assert.deepEqual(imageAttachment.content, [
    { type: "text", text: "图片附件：attachment.png" },
    { type: "image", data: "AQID", mimeType: "image/png" },
  ]);
  const textAttachment = JSON.parse((await execute(daily, "attachment_read", { id: "text-1" })).content[0].text);
  assert.equal(textAttachment.text, "已导入 SQLite 的附件文本");
  const overview = JSON.parse((await execute(daily, "workbench_projects", {})).content[0].text);
  assert.equal(overview.total, 1);
  assert.equal(overview.projects[0].id, projectId);
  const localRead = await execute(daily, "workspace_read", { mountId: external.id, path: "source.txt" });
  assert.match(localRead.content[0].text, /isolated source/);
  await assert.rejects(() => execute(daily, "workspace_write", { mountId: external.id, path: "new.txt", content: "x" }), /日常模式不允许/);
  await execute(developer, "workspace_write", { mountId: external.id, path: "new.txt", content: "candidate" });
  await execute(developer, "workspace_edit", { mountId: external.id, path: "source.txt", oldText: "isolated", newText: "candidate" });
  await assert.rejects(() => fs.access(path.join(outside, "new.txt")), { code: "ENOENT" });
  await assert.rejects(() => execute(creative, "powershell", { command: "Get-Location" }), /创作模式不允许/);
  await assert.rejects(() => execute(developer, "powershell", { command: "Remove-Item -Recurse ." }), /破坏性删除/);
  const queued = (await fs.readFile(actionsFile, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(queued.length, 2);
  assert(queued.every((item) => ["workspace_write", "workspace_edit"].includes(item.type)));

  const scope = `draft:${draftId}`;
  const first = await createAssistantConversation(scope);
  const second = await createAssistantConversation(scope);
  await manageAssistantConversation(scope, first.id, { action: "rename", title: "手动标题 A" });
  await manageAssistantConversation(scope, second.id, { action: "rename", title: "手动标题 B" });
  await manageAssistantConversation(scope, first.id, { action: "pin" });
  let index = await assistantConversations(scope);
  assert.equal(index.items[0].id, first.id, "置顶对话没有排在前面");
  await manageAssistantConversation(scope, second.id, { action: "archive" });
  assert((await assistantConversations(scope)).items.find((item) => item.id === second.id)?.archivedAt);
  await manageAssistantConversation(scope, second.id, { action: "restore" });
  assert(!(await assistantConversations(scope)).items.find((item) => item.id === second.id)?.archivedAt);
  await manageAssistantConversation(scope, first.id, { action: "delete" });
  assert(!(await assistantConversations(scope)).items.some((item) => item.id === first.id));
  const deleted = workspace.db.prepare("SELECT deleted_at FROM entities WHERE id=?").get(first.id);
  assert(deleted?.deleted_at, "删除对话必须进入 SQLite 软删除状态");
  assert(workspace.db.prepare("SELECT record_json FROM ai_conversations WHERE id=?").get(first.id)?.record_json, "软删除不能丢失恢复数据");
  assert.equal(workspace.check().ok, true);

  workspace.close();
  workspace = await openWorkspace({ xenhoHome });
  configureAssistantWorkspace(workspace);
  const reopened = await assistantConversations(scope);
  assert(reopened.items.some((item) => item.id === second.id), "重开后未保留有效对话");
  assert(!reopened.items.some((item) => item.id === first.id), "重开后软删除对话重新出现");

  const probe = await probePiRuntime();
  assert.equal(probe.ok, true);
  assert.equal(probe.version, "0.84.3");
} finally {
  if (workspace?.db?.open) workspace.close();
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log("✓ Pi Agent SDK、权限预设、本地工具与隔离工作区已校验");
console.log("✓ AI 会话使用 SQLite 软删除，并通过关闭重开验证");
console.log("✓ 测试只使用系统临时目录，没有读写真实个人工作区或历史存储");
