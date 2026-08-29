import os from "node:os";
import path from "node:path";

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

export function defaultXenhoHome({ homeDir = os.homedir() } = {}) {
  return path.join(path.resolve(homeDir), "Documents", "Xenho");
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
