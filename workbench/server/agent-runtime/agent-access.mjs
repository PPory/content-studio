import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { findProjectRoot } from "./permission-modes.mjs";

const BLOCKED_PARTS = new Set([".git", "node_modules", ".xenho"]);
const clean = (value, max = 2_000) => String(value || "").trim().slice(0, max);

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
    focusPath: clean(item.focusPath, 1_000),
  };
}

export async function agentAccess(env = {}) {
  const projectRoot = await findProjectRoot();
  const developer = env.AGENT_PERMISSION_MODE === "developer";
  const mounts = [{ id: "workbench", label: "Xenho OS 工作台", root: projectRoot, kind: "workbench", builtin: true, write: developer, execute: developer }];
  const vault = clean(env.VAULT_ROOT);
  if (vault) {
    try {
      mounts.push({ id: "vault", label: "本地知识库", root: await fs.realpath(path.resolve(vault)), kind: "vault", builtin: true, write: false, execute: false });
    } catch {}
  }
  for (const item of Array.isArray(env.AGENT_SESSION_MOUNTS) ? env.AGENT_SESSION_MOUNTS : []) {
    try {
      const root = await fs.realpath(path.resolve(clean(item.root)));
      const stat = await fs.stat(root);
      if (!stat.isDirectory() || mounts.some((mount) => mount.id === clean(item.id, 80))) continue;
      const kind = item.kind === "file" ? "file" : "folder";
      const onlyPath = kind === "file" ? path.basename(clean(item.onlyPath, 1_000)) : "";
      if (kind === "file") {
        const target = await fs.realpath(path.join(root, onlyPath));
        if (!(await fs.stat(target)).isFile() || path.dirname(target).toLowerCase() !== root.toLowerCase()) continue;
      }
      mounts.push({ id: clean(item.id, 80), label: clean(item.label, 120) || path.basename(root), root, focusPath: clean(item.focusPath, 1_000), onlyPath, kind, builtin: false, write: developer, execute: developer && kind === "folder" });
    } catch {}
  }
  return {
    mounts,
    public: mounts.map(publicMount),
    summary: {
      mountCount: mounts.length,
      externalCount: mounts.filter((item) => !item.builtin).length,
      network: Boolean(clean(env.BRAVE_SEARCH_API_KEY) || clean(env.FIRECRAWL_API_KEY) || clean(env.FIRECRAWL_BASE_URL)),
      hotspots: true,
    },
  };
}

function pathCandidates(message) {
  const text = String(message || "");
  const found = [];
  for (const match of text.matchAll(/["'“”‘’`]([A-Za-z]:[\\/][^"'“”‘’`\r\n]+)["'“”‘’`]/g)) found.push(match[1]);
  for (const line of text.split(/\r?\n/)) {
    if (!/(?:读取|打开|看看|看下|检查|分析|搜索|列出|项目|文件夹|目录|内容)/u.test(line)) continue;
    for (const match of line.matchAll(/(?:^|[\s（(])([A-Za-z]:[\\/][^\r\n]+)/g)) found.push(match[1]);
  }
  return [...new Set(found.map((item) => item.trim().replace(/[，。；;！!？?）)】\]]+$/u, "")).filter(Boolean))];
}

async function existingUserPath(value) {
  let candidate = clean(value).replaceAll("/", path.sep);
  if (!path.win32.isAbsolute(candidate) || /^\\\\/.test(candidate) || /[?*]/.test(candidate) || candidate.slice(2).includes(":")) return null;
  for (;;) {
    try {
      const absolute = await fs.realpath(path.resolve(candidate));
      const stat = await fs.stat(absolute);
      return { absolute, stat };
    } catch (error) {
      if (error?.code !== "ENOENT") return null;
      const cut = Math.max(candidate.lastIndexOf(" "), candidate.lastIndexOf("\t"));
      if (cut <= 2) return null;
      candidate = candidate.slice(0, cut).trimEnd();
    }
  }
}

export async function agentMountsFromUserMessage(message) {
  const mounts = [];
  for (const candidate of pathCandidates(message).slice(0, 6)) {
    const resolved = await existingUserPath(candidate);
    if (!resolved) continue;
    const file = resolved.stat.isFile();
    const root = file ? path.dirname(resolved.absolute) : resolved.absolute;
    const focusPath = file ? path.basename(resolved.absolute) : ".";
    const kind = file ? "file" : "folder";
    const fingerprint = file ? resolved.absolute.toLowerCase() : root.toLowerCase();
    if (mounts.some((item) => item.id === `local-${crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 12)}`)) continue;
    mounts.push({
      id: `local-${crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 12)}`,
      label: file ? path.basename(resolved.absolute) : path.basename(root),
      root,
      focusPath,
      onlyPath: file ? focusPath : "",
      kind,
    });
  }
  return mounts;
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
  let relative = safeRelative(relativePath);
  if (mount.kind === "file") {
    if (![".", mount.onlyPath].includes(relative)) denied("这个授权只允许读取指定文件");
    relative = mount.onlyPath;
  }
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
