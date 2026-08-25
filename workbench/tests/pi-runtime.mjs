import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPiTools } from "../server/agent-runtime/pi-tools.mjs";
import { addAgentMount, agentAccess, removeAgentMount, resolveAgentMountPath } from "../server/agent-runtime/agent-access.mjs";
import { permissionModeCatalog, PERMISSION_MODES, resolveProjectPath, resolveVaultPath } from "../server/agent-runtime/permission-modes.mjs";
import { PI_RUNTIME_VERSION, piRuntimeInfo, probePiRuntime } from "../server/agent-runtime/pi-runtime.mjs";
import { assistantExperts, assistantSkills } from "../server/agent-runtime/assistant-runner.mjs";
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
const env = { VAULT_ROOT: vault, AGENT_ACCESS_FILE: path.join(tempRoot, "access.json") };
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

const external = await addAgentMount(env, { path: outside, label: "外部项目", write: true, execute: true });
  const access = await agentAccess(env);
  assert(access.public.some((item) => item.id === external.id && item.write && item.execute));
  assert.equal((await resolveAgentMountPath(env, external.id, "secret.md")).absolute, path.join(outside, "secret.md"));
  await assert.rejects(() => resolveAgentMountPath(env, external.id, "../vault"), /越过了已授权|越过/);
  await assert.rejects(() => resolveAgentMountPath(env, external.id, "secret.md:stream"), /数据流/);
  await assert.rejects(() => addAgentMount(env, { path: "\\\\server\\share" }), /本机磁盘/);
  await assert.rejects(() => resolveAgentMountPath(env, external.id, ".GIT/config", { write: true }), /版本库元数据/);

  const context = { project: { title: "临时" }, attachments: [], localSources: [], projectMaterials: [] };
  const daily = createPiTools({ env, mode: "daily", context, actionsFile });
  const creative = createPiTools({ env, mode: "creative", context, actionsFile });
  const developer = createPiTools({ env, mode: "developer", context, actionsFile });
  const required = ["workspace_list", "workspace_search", "workspace_read", "workspace_write", "workspace_edit", "workspace_powershell", "hotspot_search", "vault_list", "vault_read", "annotation_list", "document_create", "document_update", "annotation_append", "reference_insert", "web_search", "web_fetch"];
  const allNames = new Set(developer.map((item) => item.name));
  for (const name of required) assert(allNames.has(name), `缺少 Pi defineTool：${name}`);
  const execute = (items, name, params) => items.find((item) => item.name === name).execute("test-call", params, undefined, undefined, {});
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
  await removeAgentMount(external.id, env);
  await assert.rejects(() => resolveAgentMountPath(env, external.id, "secret.md"), /尚未授权/);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

const probe = await probePiRuntime();
assert.equal(probe.ok, true);
assert.equal(probe.version, "0.84.3");
console.log("✓ Pi Agent SDK 0.84.3 已完成直接 SDK、defineTool、Skill 和会话标识校验");
console.log("✓ daily / creative / developer 能力预设、外部工作区授权、候选写入和越界防护已校验");
console.log("✓ Xenho 品控九问保持九项唯一真源");
