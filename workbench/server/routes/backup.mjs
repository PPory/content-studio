import { json, fail, readJsonBody, readRawBody } from "../lib/http.mjs";
import {
  createWorkspaceBundle,
  previewWorkspaceBundle,
  stageWorkspaceRestore,
  workspaceBackupStatus,
} from "../backup/workspace-backup.mjs";

async function currentWorkspace(value) {
  const workspace = await value;
  if (!workspace?.db?.open) {
    throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  }
  return workspace;
}

function sendBundle(res, bundle) {
  const label = bundle.manifest.kind === "full" ? "full-backup" : "portable";
  const extension = bundle.manifest.kind === "full" ? "xenho-backup" : "xenho-export.zip";
  const name = `xenho-${label}-${bundle.manifest.createdAt.slice(0, 19).replace(/[:T]/g, "-")}.${extension}`;
  res.writeHead(200, {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "content-length": String(bundle.bytes.length),
    "x-xenho-bundle-sha256": bundle.archiveSha256,
    "cache-control": "no-store",
  });
  res.end(bundle.bytes);
}

export const backupRoutes = [
  {
    method: "GET",
    path: "/api/backup/status",
    async handler({ res, workspace }) {
      try {
        json(res, { ok: true, ...(await workspaceBackupStatus(await currentWorkspace(workspace))) });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
  {
    method: "POST",
    path: "/api/backup/export",
    async handler({ req, res, workspace }) {
      try {
        const body = await readJsonBody(req);
        const kind = body.kind === "full" ? "full" : "portable";
        const bundle = await createWorkspaceBundle(await currentWorkspace(workspace), {
          kind,
          includeBookAssets: body.includeBookAssets === true,
        });
        sendBundle(res, bundle);
      } catch (error) {
        if (!res.headersSent) fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
  {
    method: "POST",
    path: "/api/backup/restore",
    async handler({ req, res, url, workspace }) {
      try {
        const bytes = await readRawBody(req, 1_500_000_000);
        if (!bytes.length) return fail(res, "没有收到工作区备份文件", { status: 400 });
        const active = await currentWorkspace(workspace);
        if (url.searchParams.get("dry") === "1") {
          return json(res, { ok: true, dry: true, ...(await previewWorkspaceBundle(active, bytes)) });
        }
        const out = await stageWorkspaceRestore(active, bytes, {
          confirmedSha256: String(url.searchParams.get("confirm") || ""),
        });
        json(res, { ok: true, ...out });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
  {
    method: "POST",
    path: "/api/backup/snapshot/:key/restore",
    async handler({ res }) {
      fail(res, "旧文件快照恢复已停用", {
        status: 410,
        hint: "现在使用完整工作区恢复点；先预览整包数量与哈希，再确认并重启切换。",
      });
    },
  },
];
