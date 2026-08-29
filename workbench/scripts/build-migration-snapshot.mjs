import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEnv } from "vite";
import { collectD1Source } from "../server/migration/d1-collector.mjs";
import { collectLocalSource } from "../server/migration/local-collector.mjs";
import { collectObsidianSource } from "../server/migration/obsidian-collector.mjs";
import { collectFeishuSource, collectSupabaseSource, referencedMediaIds } from "../server/migration/remote-collectors.mjs";
import { writeMigrationSnapshot } from "../server/migration/snapshot.mjs";
import { collectXenhoSource } from "../server/migration/xenho-collector.mjs";
import { collectWorkspaceDelta } from "../server/migration/workspace-delta-collector.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}
function has(name) { return process.argv.includes(name); }
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const d1Export = path.resolve(option("--d1-export") || "");
const output = path.resolve(option("--output") || await fs.mkdtemp(path.join(os.tmpdir(), "xenho-migration-snapshot-")));
const browserFile = option("--browser") ? path.resolve(option("--browser")) : "";
const d1SeedsFile = option("--d1-seeds") ? path.resolve(option("--d1-seeds")) : "";
const workspaceDelta = option("--workspace-delta") ? path.resolve(option("--workspace-delta")) : "";
const skipRemote = has("--skip-remote");
if (!option("--d1-export")) throw new Error("缺少 --d1-export <Wrangler 只读导出 SQL>");
if (!inside(path.resolve(os.tmpdir()), output) || output === path.resolve(os.tmpdir())) throw new Error("迁移快照必须写入系统临时目录中的独立目录");

const workbenchDir = process.cwd();
const env = loadEnv("development", workbenchDir, "");
const tempDbDir = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-d1-normalize-"));
try {
  let seedRows = null;
  if (d1SeedsFile) {
    const payload = JSON.parse(await fs.readFile(d1SeedsFile, "utf8"));
    seedRows = Array.isArray(payload) ? (payload[0]?.results || payload) : (payload.results || payload.result?.[0]?.results);
    if (!Array.isArray(seedRows)) throw new Error("--d1-seeds 不是 Wrangler JSON 查询结果");
  }
  const d1 = await collectD1Source({ sqlFile: d1Export, tempDir: tempDbDir, seedRows });
  const local = await collectLocalSource({ workbenchDir, browserFile });
  if (workspaceDelta) {
    const delta = await collectWorkspaceDelta({ xenhoHome: workspaceDelta, tempDir: tempDbDir });
    for (const [category, rows] of Object.entries(delta.source.records)) local.source.records[category] = [...(local.source.records[category] || []), ...rows];
    local.source.assets.push(...delta.source.assets);
    local.source.inventory.workspaceDelta = delta.source.inventory;
    local.assetFiles.push(...delta.assetFiles);
  }
  const xenho = await collectXenhoSource({ xenhoDir: path.join(workbenchDir, ".xenho") });
  const obsidian = await collectObsidianSource({ vaultRoot: env.VAULT_ROOT });
  let supabase = { source: { records: {}, assets: [], inventory: { skipped: true }, missingAssets: [] }, assetFiles: [] };
  let feishu = { records: {}, assets: [], checks: { mappedDocuments: [] }, inventory: { skipped: true } };
  if (!skipRemote) {
    supabase = await collectSupabaseSource({ env, mediaIds: referencedMediaIds(d1) });
    feishu = await collectFeishuSource({ mappings: d1.feishuMappings, draftsById: new Map(d1.records.drafts.map((item) => [item.id, item])) });
  }
  const sources = { d1, local: local.source, xenho: xenho.source, obsidian: obsidian.source, supabase: supabase.source, feishu };
  await writeMigrationSnapshot({ directory: output, sources, assetFiles: [...local.assetFiles, ...xenho.assetFiles, ...obsidian.assetFiles, ...supabase.assetFiles] });
  console.log(JSON.stringify({
    ok: true, mode: skipRemote ? "local-read-only" : "remote-read-only",
    output,
    counts: Object.fromEntries(Object.entries(sources).map(([source, value]) => [source, { records: Object.values(value.records || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0), assets: value.assets?.length || 0 }])),
  }, null, 2));
} finally {
  await fs.rm(tempDbDir, { recursive: true, force: true });
}
