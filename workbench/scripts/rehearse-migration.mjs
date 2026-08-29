import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rehearseMigration } from "../server/migration/rehearsal.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const snapshotDir = option("--snapshot");
const targetXenhoHome = option("--target") || await fs.mkdtemp(path.join(os.tmpdir(), "xenho-migration-target-"));
const reportDir = option("--report") || path.join(targetXenhoHome, "Reports");
if (!snapshotDir) throw new Error("用法：npm run migration:rehearse -- --snapshot <只读快照目录> [--target <系统临时目录>] [--report <报告目录>]");

const report = await rehearseMigration({ snapshotDir, targetXenhoHome, reportDir });
console.log(JSON.stringify({ ok: report.ok, targetXenhoHome, reportDir, results: report.results }, null, 2));
if (!report.ok) process.exitCode = 1;
