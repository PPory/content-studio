import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function absoluteRoot(value) {
  const root = String(value || "").trim();
  if (!root || !path.isAbsolute(root)) {
    throw new TypeError("Xenho 工作区根目录必须是绝对路径");
  }
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) {
    throw new TypeError("Xenho 工作区根目录不能是磁盘根目录");
  }
  return resolved;
}

function expandWindowsEnvironment(value, env = process.env) {
  return String(value).replace(/%([^%]+)%/g, (match, name) => env[name] || env[name.toUpperCase()] || match);
}

function windowsDocumentsDirectory() {
  try {
    const bytes = execFileSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "Personal"], { windowsHide: true });
    const output = new TextDecoder("gbk").decode(bytes);
    const match = output.match(/Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)$/m);
    if (match?.[1]?.trim()) return expandWindowsEnvironment(match[1].trim());
  } catch {}
  return "";
}

export function defaultXenhoHome({ homeDir, documentsDir, platform = process.platform } = {}) {
  const documents = documentsDir || (!homeDir && platform === "win32" ? windowsDocumentsDirectory() : "") || path.join(path.resolve(homeDir || os.homedir()), "Documents");
  return path.join(path.resolve(documents), "Xenho");
}

export function runtimeXenhoHome(env = {}, processEnv = process.env) {
  return processEnv.XENHO_HOME || env.XENHO_HOME || undefined;
}

export function resolveWorkspacePaths({ xenhoHome, env = {}, homeDir } = {}) {
  const root = absoluteRoot(xenhoHome || env.XENHO_HOME || defaultXenhoHome({ homeDir }));
  const workspaceDir = path.join(root, "Workspace");
  const assetsDir = path.join(workspaceDir, "assets");
  return Object.freeze({
    root,
    workspaceDir,
    databaseFile: path.join(workspaceDir, "workspace.sqlite"),
    manifestFile: path.join(workspaceDir, "workspace.json"),
    stagingDir: path.join(workspaceDir, ".staging"),
    assetsDir,
    imageAssetsDir: path.join(assetsDir, "images"),
    bookAssetsDir: path.join(assetsDir, "books"),
    attachmentAssetsDir: path.join(assetsDir, "attachments"),
    importAssetsDir: path.join(assetsDir, "imports"),
    backupsDir: path.join(root, "Backups"),
    exportsDir: path.join(root, "Exports"),
  });
}
