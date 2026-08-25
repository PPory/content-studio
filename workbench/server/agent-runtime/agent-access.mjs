import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../lib/safe-write.mjs";
import { findProjectRoot } from "./permission-modes.mjs";

const DEFAULT_ACCESS_FILE = path.resolve(process.cwd(), ".xenho", "assistant", "access.json");
const BLOCKED_PARTS = new Set([".git", "node_modules", ".xenho"]);

const clean = (value, max = 2_000) => String(value || "").trim().slice(0, max);
const accessFile = (env = {}) => path.resolve(clean(env.AGENT_ACCESS_FILE) || DEFAULT_ACCESS_FILE);

function denied(message = "路径越过了已授权的工作区") {
  throw Object.assign(new Error(message), { status: 403, code: "AGENT_PATH_DENIED" });
}

function safeRelative(value = ".") {
  const raw = clean(value).replaceAll("\\", "/") || ".";
  if (raw.includes("\0") || raw.includes(":")) denied("相对路径不能包含设备名或数据流");
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) denied("工具只接受工作区内的相对路径");
  const normalized = path.posix.normalize(raw);
  if (normalized === ".." || normalized.startsWith("../") || normalized.split("/").includes("..")) denied();
  return normalized.replace(/^\.\//, "") || ".";
}

async function readStored(env = {}) {
  try {
    const data = JSON.parse(await fs.readFile(accessFile(env), "utf8"));
    return { version: 1, mounts: Array.isArray(data.mounts) ? data.mounts : [] };
  } catch {
    return { version: 1, mounts: [] };
  }
}

async function writeStored(data, env = {}) {
  const file = accessFile(env);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, JSON.stringify({ version: 1, mounts: data.mounts }, null, 2), { verify: JSON.parse });
}

function publicMount(item) {
  return {
    id: item.id,
    label: item.label,
    path: item.root,
    kind: item.kind,
    builtin: Boolean(item.builtin),
    read: true,
    write: Boolean(item.write),
    execute: Boolean(item.execute),
  };
}

export async function agentAccess(env = {}) {
  const projectRoot = await findProjectRoot();
  const stored = await readStored(env);
  const mounts = [{ id: "workbench", label: "Xenho OS 工作台", root: projectRoot, kind: "workbench", builtin: true, write: true, execute: true }];
  const vault = clean(env.VAULT_ROOT);
  if (vault) {
    try {
      mounts.push({ id: "vault", label: "Obsidian 知识库", root: await fs.realpath(path.resolve(vault)), kind: "vault", builtin: true, write: false, execute: false });
    } catch {}
  }
  for (const item of stored.mounts) {
    try {
      const root = await fs.realpath(path.resolve(clean(item.root)));
      const stat = await fs.stat(root);
      if (!stat.isDirectory() || mounts.some((mount) => mount.root.toLowerCase() === root.toLowerCase())) continue;
      mounts.push({ id: clean(item.id, 80), label: clean(item.label, 120) || path.basename(root), root, kind: "folder", builtin: false, write: Boolean(item.write), execute: Boolean(item.execute) });
    } catch {}
  }
  return {
    mounts,
    public: mounts.map(publicMount),
    summary: {
      mountCount: mounts.length,
      externalCount: mounts.filter((item) => !item.builtin).length,
      vault: mounts.some((item) => item.kind === "vault"),
      network: Boolean(clean(env.BRAVE_SEARCH_API_KEY) || clean(env.FIRECRAWL_API_KEY) || clean(env.FIRECRAWL_BASE_URL)),
      hotspots: true,
    },
  };
}

export async function addAgentMount(env, input = {}) {
  const requested = clean(input.path);
  if (!requested || !path.isAbsolute(requested) || /^\\\\/.test(requested)) denied("请选择本机磁盘上的绝对文件夹路径");
  const root = await fs.realpath(path.resolve(requested));
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw Object.assign(new Error("授权路径必须是文件夹"), { status: 400 });
  const current = await agentAccess(env);
  if (current.mounts.some((item) => item.root.toLowerCase() === root.toLowerCase())) throw Object.assign(new Error("这个文件夹已经在访问范围内"), { status: 409 });
  const stored = await readStored(env);
  const item = {
    id: `folder-${crypto.createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 12)}`,
    label: clean(input.label, 120) || path.basename(root),
    root,
    write: Boolean(input.write),
    execute: Boolean(input.execute && input.write),
  };
  stored.mounts.push(item);
  await writeStored(stored, env);
  return publicMount({ ...item, kind: "folder", builtin: false });
}

export async function removeAgentMount(id, env = {}) {
  const mountId = clean(id, 80);
  if (!mountId.startsWith("folder-")) throw Object.assign(new Error("内置工作区不能移除"), { status: 400 });
  const stored = await readStored(env);
  const next = stored.mounts.filter((item) => item.id !== mountId);
  if (next.length === stored.mounts.length) throw Object.assign(new Error("没有找到这个授权文件夹"), { status: 404 });
  await writeStored({ ...stored, mounts: next }, env);
  return true;
}

async function nearestExisting(candidate) {
  let current = candidate;
  for (;;) {
    try { return await fs.realpath(current); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

export async function resolveAgentMountPath(env, mountId, relativePath = ".", { write = false, execute = false } = {}) {
  const access = await agentAccess(env);
  const mount = access.mounts.find((item) => item.id === clean(mountId, 80));
  if (!mount) throw Object.assign(new Error("这个工作区尚未授权"), { status: 403 });
  if (write && !mount.write) throw Object.assign(new Error("这个工作区只有读取权限"), { status: 403 });
  if (execute && !mount.execute) throw Object.assign(new Error("这个工作区没有命令执行权限"), { status: 403 });
  const relative = safeRelative(relativePath);
  const parts = relative.split("/");
  if (write && parts.some((part) => BLOCKED_PARTS.has(part.toLowerCase()))) denied("不能写入依赖、版本库元数据或 Agent 状态目录");
  const candidate = path.resolve(mount.root, relative);
  const inside = path.relative(mount.root, candidate);
  if (inside.startsWith("..") || path.isAbsolute(inside)) denied();
  const realRoot = await fs.realpath(mount.root);
  const realParent = await nearestExisting(candidate);
  const linked = path.relative(realRoot, realParent);
  if (linked.startsWith("..") || path.isAbsolute(linked)) denied("路径经过了授权范围外的链接");
  return { mount, relative, absolute: candidate };
}

export async function agentPathStamp(absolutePath) {
  try {
    const stat = await fs.stat(absolutePath, { bigint: true });
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs].map(String).join(":");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

export const agentAccessFile = (env = {}) => accessFile(env);
