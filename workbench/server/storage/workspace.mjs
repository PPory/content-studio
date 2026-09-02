import fs from "node:fs/promises";
import { atomicWrite } from "../lib/safe-write.mjs";
import { AssetStore } from "./asset-store.mjs";
import { createUlid, isUlid } from "./ids.mjs";
import { WORKSPACE_SCHEMA_VERSION } from "./migrations.mjs";
import { checkWorkspaceDatabase, openWorkspaceDatabase } from "./sqlite.mjs";
import { resolveWorkspacePaths } from "./workspace-paths.mjs";
import { WorkspaceRepository } from "./workspace-repository.mjs";
import { WorkspaceDomain } from "../domain/workspace-domain.mjs";
import { ContentBridgeDomain } from "../domain/content-bridge.mjs";
import { ContentExperimentDomain } from "../domain/content-experiments.mjs";
import { AudienceRawDomain } from "../domain/audience-raw.mjs";
import { JobStore } from "../jobs/job-store.mjs";

const FORMAT_VERSION = 1;
const isoNow = (now = new Date()) => new Date(now).toISOString();

async function readManifest(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error("workspace.json 不是有效 JSON，拒绝覆盖");
    throw error;
  }
}

function validateManifest(manifest) {
  if (!manifest || manifest.format !== "xenho-workspace" || manifest.formatVersion !== FORMAT_VERSION || !isUlid(manifest.workspaceId)) {
    throw new Error("workspace.json 格式或版本不受支持");
  }
  if (manifest.database !== "workspace.sqlite" || manifest.assets !== "assets") {
    throw new Error("workspace.json 的数据库或资源目录声明无效");
  }
  return manifest;
}

export async function ensureWorkspaceLayout(paths, { now } = {}) {
  await Promise.all([
    fs.mkdir(paths.imageAssetsDir, { recursive: true }),
    fs.mkdir(paths.bookAssetsDir, { recursive: true }),
    fs.mkdir(paths.attachmentAssetsDir, { recursive: true }),
    fs.mkdir(paths.importAssetsDir, { recursive: true }),
    fs.mkdir(paths.stagingDir, { recursive: true }),
    fs.mkdir(paths.backupsDir, { recursive: true }),
    fs.mkdir(paths.exportsDir, { recursive: true }),
  ]);
  const existing = await readManifest(paths.manifestFile);
  if (existing) return validateManifest(existing);
  const createdAt = isoNow(now);
  const manifest = {
    format: "xenho-workspace",
    formatVersion: FORMAT_VERSION,
    workspaceId: createUlid(new Date(createdAt).getTime()),
    createdAt,
    database: "workspace.sqlite",
    assets: "assets",
  };
  await atomicWrite(paths.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { verify: (text) => validateManifest(JSON.parse(text)) });
  return manifest;
}

export async function openWorkspace(options = {}) {
  const paths = resolveWorkspacePaths(options);
  const manifest = await ensureWorkspaceLayout(paths, options);
  const db = openWorkspaceDatabase(paths.databaseFile, options);
  try {
    const repository = new WorkspaceRepository(db);
    const databaseWorkspaceId = repository.getMetadata("workspace_id");
    if (databaseWorkspaceId && databaseWorkspaceId !== manifest.workspaceId) {
      throw new Error("workspace.json 与 workspace.sqlite 的工作区 ID 不一致");
    }
    repository.transaction((repo) => {
      if (!databaseWorkspaceId) repo.setMetadata("workspace_id", manifest.workspaceId, options);
      repo.setMetadata("format_version", FORMAT_VERSION, options);
      repo.setMetadata("schema_version", WORKSPACE_SCHEMA_VERSION, options);
    });
    const repositoryAssets = new AssetStore({ db, paths });
    const domain = new WorkspaceDomain({ db, repository });
    const contentBridge = new ContentBridgeDomain({ db, repository, workspaceDomain: domain });
    const experiments = new ContentExperimentDomain({ db, repository, workspaceDomain: domain });
    const audienceRaw = new AudienceRawDomain({ db, repository, workspaceDomain: domain });
    const jobs = new JobStore(db);
    return {
      paths,
      manifest,
      db,
      repository,
      domain,
      contentBridge,
      experiments,
      audienceRaw,
      jobs,
      assets: repositoryAssets,
      check: () => checkWorkspaceDatabase(db),
      close: () => { if (db.open) db.close(); },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

export { FORMAT_VERSION as WORKSPACE_FORMAT_VERSION };
