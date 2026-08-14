// /api/backup/* —— 导出、预览、恢复、快照回退。
//
// 导出走 **POST 而不是 GET**：浏览器的 localStorage（阅读进度、书签、阅读设置、
// 排版草稿）服务端读不到，只能由前端把它交上来一起打包。为一个「下载」动作用 POST
// 看着别扭，但另一条路是让前端自己压 zip——那要把 fflate 打进前端包，
// 而这个项目明确规定解析类依赖只在服务端跑。

import path from "node:path";
import { json, fail, readJsonBody, readRawBody } from "../lib/http.mjs";
import { snapshotKeepDays } from "../lib/safe-write.mjs";
import { backupStatus, exportBundle, previewBundle, restoreBundle, restoreSnapshot } from "../lib/backup.mjs";

const ROOT = () => process.cwd();

export const backupRoutes = [
  {
    method: "GET",
    path: "/api/backup/status",
    async handler({ res }) {
      try {
        json(res, { ok: true, ...(await backupStatus(ROOT(), { keepDays: snapshotKeepDays() })) });
      } catch (e) {
        fail(res, e.message);
      }
    },
  },
  {
    method: "POST",
    path: "/api/backup/export",
    async handler({ req, res, env }) {
      try {
        const body = await readJsonBody(req);
        const { zip, manifest } = await exportBundle(ROOT(), {
          browser: body.browser && typeof body.browser === "object" ? body.browser : {},
          vaultPath: (env.VAULT_ROOT || "").trim(),
        });
        const name = `xenho-workbench-backup-${manifest.generatedAt.slice(0, 19).replace(/[:T]/g, "-")}.zip`;
        res.writeHead(200, {
          "content-type": "application/zip",
          // 文件名里没有非 ASCII，但还是给 filename* ——以后加了中文名不用回头再修一次
          "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          "content-length": String(zip.length),
          "cache-control": "no-store",
        });
        res.end(zip);
      } catch (e) {
        if (!res.headersSent) fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
  {
    // 预览和恢复走同一条路径、同一份字节，靠 ?dry=1 分流：
    // 两个端点的话，「预览时说的」和「恢复时做的」迟早会不一样。
    method: "POST",
    path: "/api/backup/restore",
    async handler({ req, res, url }) {
      try {
        const bytes = await readRawBody(req, 200_000_000);
        if (!bytes.length) return fail(res, "没有收到备份文件", { status: 400 });
        if (url.searchParams.get("dry") === "1") {
          return json(res, { ok: true, dry: true, ...(await previewBundle(ROOT(), bytes)) });
        }
        const out = await restoreBundle(ROOT(), bytes, { keepDays: snapshotKeepDays() });
        json(res, { ok: true, ...out });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
  {
    method: "POST",
    path: "/api/backup/snapshot/:key/restore",
    async handler({ req, res, params }) {
      try {
        const b = await readJsonBody(req);
        const out = await restoreSnapshot(ROOT(), params.key, String(b.name || ""), { keepDays: snapshotKeepDays() });
        json(res, { ok: true, ...out });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
];

export const backupDir = () => path.resolve(ROOT(), "data", ".snapshots");
