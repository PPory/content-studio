import { formalMigration } from "../server/migration/formal.mjs";
import { defaultXenhoHome } from "../server/storage/workspace-paths.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const snapshotDir = option("--snapshot");
const confirmedManifestSha256 = option("--confirm-manifest");
const targetXenhoHome = option("--target") || defaultXenhoHome();
if (!snapshotDir || !confirmedManifestSha256) {
  throw new Error("用法：npm run migration:formal -- --snapshot <快照目录> --confirm-manifest <SHA-256> [--target <Documents\\Xenho>]");
}

const result = await formalMigration({ snapshotDir, targetXenhoHome, confirmedManifestSha256 });
console.log(JSON.stringify(result, null, 2));
