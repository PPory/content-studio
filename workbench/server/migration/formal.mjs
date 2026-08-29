import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openWorkspace } from "../storage/workspace.mjs";
import { defaultXenhoHome } from "../storage/workspace-paths.mjs";
import { rehearseMigration } from "./rehearsal.mjs";
import { loadMigrationSnapshot } from "./snapshot.mjs";

const exists = (target) => fs.stat(target).then(() => true, (error) => {
  if (error.code === "ENOENT") return false;
  throw error;
});

const safeStamp = (date) => date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
const fileSha256 = async (file) => crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");

function formalMarkdown(report) {
  const lines = [
    "# 本地优先正式迁移对账报告", "",
    `- 结果：${report.ok ? "通过" : "未通过"}`,
    `- 正式切换：${report.formalizedAt}`,
    `- 快照清单 SHA-256：${report.snapshotManifestSha256}`,
    `- 工作区：${report.targetXenhoHome}`,
    `- 完整恢复点：${report.restorePointRelativePath}`, "",
    "## 来源数量", "",
  ];
  for (const [source, counts] of Object.entries(report.sourceCounts || {})) {
    lines.push(`- ${source}：${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join("，")}`);
  }
  lines.push("", "## 结果汇总", "", `- 导入：${report.results.imported}`, `- 去重：${report.results.deduplicated}`, `- 跳过：${report.results.skipped}`, `- 冲突：${report.results.conflicts}`, `- 失败：${report.results.failed}`, `- 缺失资源：${report.results.missingAssets}`, "", "## 逐类对账", "");
  for (const item of report.reconciliation || []) lines.push(`- ${item.category}：预期 ${item.expected}，实际 ${item.actual}，${item.ok ? "一致" : "不一致"}`);
  lines.push("", "完整 ID、正文哈希、关系哈希、资源清单与问题列表见同目录 migration-reconciliation.json。", "", "本报告不授权删除任何飞书、Supabase、D1、Worker 或 Obsidian 资源。", "");
  return lines.join("\n");
}

export async function formalMigration({ snapshotDir, targetXenhoHome, confirmedManifestSha256, homeDir, now = new Date() }) {
  const target = path.resolve(String(targetXenhoHome || ""));
  const expected = path.resolve(defaultXenhoHome(homeDir ? { homeDir } : {}));
  if (target !== expected) throw new Error(`正式迁移目标必须是默认单工作区：${expected}`);
  if (await exists(target)) throw new Error("正式迁移目标已存在，拒绝覆盖");
  const snapshot = await loadMigrationSnapshot(snapshotDir);
  if (!/^[a-f0-9]{64}$/i.test(String(confirmedManifestSha256 || "")) || snapshot.manifestSha256 !== String(confirmedManifestSha256).toLowerCase()) {
    throw new Error("正式迁移确认的快照哈希不匹配");
  }

  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-formal-migration-"));
  const candidate = path.join(staging, "candidate");
  const rehearsalReportDir = path.join(staging, "reconciliation");
  let promoted = false;
  let volumeStaging = "";
  try {
    const rehearsal = await rehearseMigration({ snapshotDir, targetXenhoHome: candidate, reportDir: rehearsalReportDir, now });
    if (!rehearsal.ok) throw new Error("正式切换前的最终隔离重建未通过");

    const backupName = `Migration-Source-${safeStamp(now)}`;
    const backupRoot = path.join(candidate, "Backups", backupName);
    const snapshotBackup = path.join(backupRoot, "source-snapshot");
    const reportDir = path.join(backupRoot, "migration-report");
    await fs.mkdir(reportDir, { recursive: true });
    await fs.cp(snapshotDir, snapshotBackup, { recursive: true, errorOnExist: true, force: false });
    const copied = await loadMigrationSnapshot(snapshotBackup);
    if (copied.manifestSha256 !== snapshot.manifestSha256) throw new Error("恢复点快照哈希复验失败");

    const formalizedAt = new Date(now).toISOString();
    const formalReport = {
      ...rehearsal,
      mode: "formal",
      formalizedAt,
      targetXenhoHome: target,
      restorePointRelativePath: path.relative(candidate, backupRoot).replaceAll("\\", "/"),
    };
    const reportJson = path.join(reportDir, "migration-reconciliation.json");
    await fs.writeFile(reportJson, `${JSON.stringify(formalReport, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(reportDir, "migration-reconciliation.md"), formalMarkdown(formalReport), "utf8");

    const workspace = await openWorkspace({ xenhoHome: candidate, now });
    try {
      if (!workspace.check().ok) throw new Error("正式候选工作区 SQLite 复验失败");
      workspace.repository.setMetadata("migration_formal", {
        manifestSha256: snapshot.manifestSha256,
        formalizedAt,
        restorePoint: formalReport.restorePointRelativePath,
      }, { now });
    } finally {
      workspace.close();
    }
    await fs.writeFile(path.join(backupRoot, "restore-point.json"), `${JSON.stringify({
      format: "xenho-migration-restore-point",
      formatVersion: 1,
      createdAt: formalizedAt,
      snapshotManifestSha256: snapshot.manifestSha256,
      reconciliationSha256: await fileSha256(reportJson),
      snapshot: "source-snapshot/manifest.json",
      report: "migration-report/migration-reconciliation.json",
    }, null, 2)}\n`, "utf8");

    await fs.mkdir(path.dirname(target), { recursive: true });
    if (await exists(target)) throw new Error("正式迁移目标在切换前已出现，拒绝覆盖");
    try {
      await fs.rename(candidate, target);
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      volumeStaging = await fs.mkdtemp(path.join(path.dirname(target), ".xenho-migration-stage-"));
      const sameVolumeCandidate = path.join(volumeStaging, "candidate");
      await fs.cp(candidate, sameVolumeCandidate, { recursive: true, errorOnExist: true, force: false });
      const copiedWorkspace = await openWorkspace({ xenhoHome: sameVolumeCandidate, now });
      try {
        if (!copiedWorkspace.check().ok) throw new Error("跨盘复制后 SQLite 复验失败");
        for (const asset of formalReport.assets) {
          const verified = await copiedWorkspace.assets.verify(asset.targetId);
          if (!verified.ok || verified.sha256 !== asset.sha256 || verified.byteSize !== asset.byteSize) {
            throw new Error(`跨盘复制后资源复验失败：${asset.targetId}`);
          }
        }
      } finally {
        copiedWorkspace.close();
      }
      if (await exists(target)) throw new Error("跨盘复制期间正式目标已出现，拒绝覆盖");
      await fs.rename(sameVolumeCandidate, target);
    }
    promoted = true;

    const reopened = await openWorkspace({ xenhoHome: target, now });
    try {
      if (!reopened.check().ok) throw new Error("正式工作区重开后 SQLite 复验失败");
    } finally {
      reopened.close();
    }
    return {
      ok: true,
      targetXenhoHome: target,
      snapshotManifestSha256: snapshot.manifestSha256,
      results: formalReport.results,
      reportDir: path.join(target, formalReport.restorePointRelativePath, "migration-report"),
      restorePoint: path.join(target, formalReport.restorePointRelativePath),
    };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
    if (volumeStaging) await fs.rm(volumeStaging, { recursive: true, force: true });
    if (!promoted && await exists(target)) {
      throw new Error("正式切换未完成但目标目录已出现，已保留现场，拒绝清理");
    }
  }
}
