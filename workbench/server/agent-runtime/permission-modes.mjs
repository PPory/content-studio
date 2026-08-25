import fs from "node:fs/promises";
import path from "node:path";
import { WB_ROOT } from "../lib/vault-dirs.mjs";

export const DEFAULT_PERMISSION_MODE = "daily";

const COMMON_TOOLS = [
  "project_read",
  "material_evidence",
  "publication_metrics",
  "knowledge_search",
  "workspace_list",
  "workspace_search",
  "workspace_read",
  "hotspot_search",
  "attachment_read",
  "skill_read",
  "vault_list",
  "vault_read",
  "annotation_list",
  "web_search",
  "web_fetch",
  "propose_content_create",
  "submit_expert_report",
];

export const PERMISSION_MODES = Object.freeze({
  daily: Object.freeze({
    id: "daily",
    label: "日常",
    description: "只读资料、检索、联网、附件、技能和候选操作。",
    warning: "",
    capabilities: Object.freeze(["read", "search", "network", "propose"]),
    tools: Object.freeze(COMMON_TOOLS),
  }),
  creative: Object.freeze({
    id: "creative",
    label: "创作",
    description: "在日常能力上，增加个人工作台目录内的新建与受控编辑候选。",
    warning: "所有写入仍需你在动作卡中确认。",
    capabilities: Object.freeze(["read", "search", "network", "propose", "workspace-write"]),
    tools: Object.freeze([
      ...COMMON_TOOLS,
      "document_create",
      "document_update",
      "annotation_append",
      "reference_insert",
    ]),
  }),
  developer: Object.freeze({
    id: "developer",
    label: "开发",
    description: "增加项目文件读写、编辑和 PowerShell 候选，仅用于明确的开发任务。",
    warning: "开发模式可触及项目代码和命令；切入前请确认当前任务确实需要。所有改变仍需动作卡确认。",
    capabilities: Object.freeze(["read", "search", "network", "propose", "workspace-write", "project-write", "execute"]),
    tools: Object.freeze([
      ...COMMON_TOOLS,
      "document_create",
      "document_update",
      "annotation_append",
      "reference_insert",
      "project_file_read",
      "workspace_write",
      "workspace_edit",
      "workspace_powershell",
      "write",
      "edit",
      "powershell",
    ]),
  }),
});

export function normalizePermissionMode(value) {
  const id = String(value || "").trim().toLowerCase();
  return PERMISSION_MODES[id] ? id : DEFAULT_PERMISSION_MODE;
}

export function permissionModeCatalog() {
  return Object.values(PERMISSION_MODES).map(({ tools: _tools, ...item }) => item);
}

export function assertModeTool(mode, toolName) {
  const selected = PERMISSION_MODES[normalizePermissionMode(mode)];
  if (!selected.tools.includes(toolName)) {
    throw Object.assign(new Error(`${selected.label}模式不允许使用 ${toolName}`), {
      status: 403,
      code: "AGENT_PERMISSION_DENIED",
    });
  }
  return selected;
}

function badPath(message = "路径越界，拒绝访问") {
  throw Object.assign(new Error(message), { status: 400, code: "AGENT_PATH_DENIED" });
}

function normalizeRelative(input, { allowHidden = false } = {}) {
  const raw = String(input || "").trim().replaceAll("\\", "/");
  if (!raw || raw.includes("\0") || path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) badPath();
  const normalized = path.posix.normalize(raw);
  if (normalized === ".." || normalized.startsWith("../") || normalized.split("/").includes("..")) badPath();
  if (!allowHidden && normalized !== "." && normalized.split("/").some((part) => part.startsWith("."))) badPath("不允许访问隐藏目录或隐藏文件");
  return normalized.replace(/^\.\//, "");
}

export async function findProjectRoot(start = process.cwd()) {
  let current = path.resolve(start);
  for (;;) {
    try {
      const stat = await fs.stat(path.join(current, ".git"));
      if (stat.isDirectory() || stat.isFile()) return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

async function nearestExistingParent(candidate) {
  let current = candidate;
  for (;;) {
    try { return await fs.realpath(current); } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function assertNoSymlinkEscape(root, candidate) {
  const realRoot = await fs.realpath(root);
  const realParent = await nearestExistingParent(candidate);
  const relative = path.relative(realRoot, realParent);
  if (relative.startsWith("..") || path.isAbsolute(relative)) badPath("路径经过了工作台范围外的链接，拒绝访问");
}

export async function resolveVaultPath(env, relativePath, { write = false, markdownOnly = false } = {}) {
  const configured = String(env.VAULT_ROOT || "").trim();
  if (!configured) throw Object.assign(new Error("未配置知识库目录"), { status: 400 });
  const root = path.resolve(configured);
  const relative = normalizeRelative(relativePath);
  const candidate = path.resolve(root, relative);
  const inside = path.relative(root, candidate);
  if (inside.startsWith("..") || path.isAbsolute(inside)) badPath();
  await assertNoSymlinkEscape(root, candidate);
  if (write && !(relative === WB_ROOT || relative.startsWith(`${WB_ROOT}/`))) {
    badPath("创作写入只能位于个人工作台目录内");
  }
  if (markdownOnly && path.extname(candidate).toLowerCase() !== ".md") {
    badPath("创作工具只允许处理 Markdown 文件");
  }
  return { root, relative, absolute: candidate };
}

export async function resolveProjectPath(relativePath, { write = false, allowSkills = false } = {}) {
  const root = await findProjectRoot();
  const relative = normalizeRelative(relativePath, { allowHidden: allowSkills });
  if (allowSkills && !(relative === ".agents/skills" || relative.startsWith(".agents/skills/"))) badPath("只能读取项目 Skill 文件");
  const candidate = path.resolve(root, relative);
  const inside = path.relative(root, candidate);
  if (inside.startsWith("..") || path.isAbsolute(inside)) badPath();
  await assertNoSymlinkEscape(root, candidate);
  const blocked = relative.split("/").some((part) => [".git", ".xenho", "node_modules"].includes(part));
  if (blocked && write) badPath("开发写入不能修改版本库元数据、运行状态或依赖目录");
  return { root, relative, absolute: candidate };
}

export function assertConversationIdle(active, key) {
  if (active.has(key)) {
    throw Object.assign(new Error("当前回复完成后才能切换权限模式"), { status: 409, code: "AGENT_MODE_LOCKED" });
  }
}
