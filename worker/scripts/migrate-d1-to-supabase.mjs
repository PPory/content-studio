// D1 → Supabase 影子迁移。
//
// 默认只读远程 D1 并验证、汇总；显式传 --apply 才会写 Supabase。
// D1 在整个过程中始终只读。Supabase 采用原主键幂等 upsert，重复执行不会复制数据。
//
// 用法（在 worker/）：
//   node scripts/migrate-d1-to-supabase.mjs --env-file ../workbench/.env
//   node scripts/migrate-d1-to-supabase.mjs --env-file ../workbench/.env --apply
//   node scripts/migrate-d1-to-supabase.mjs --env-file ../workbench/.env --apply --allow-extra
//   node scripts/migrate-d1-to-supabase.mjs --env-file ../workbench/.env --apply --archive-extra

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PERSONAL_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const WRANGLER_BIN = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

const TABLES = [
  { name: "inbox", conflict: "workspace_id,id" },
  { name: "topics", conflict: "workspace_id,id" },
  { name: "drafts", conflict: "workspace_id,id" },
  { name: "materials", conflict: "workspace_id,id" },
  { name: "tags", conflict: "workspace_id,id" },
  { name: "material_tags", conflict: "workspace_id,material_id,tag_id" },
  { name: "inbox_tags", conflict: "workspace_id,inbox_id,tag_id" },
  { name: "topic_materials", conflict: "workspace_id,topic_id,material_id" },
  { name: "topic_inbox", conflict: "workspace_id,topic_id,inbox_id" },
  { name: "comments", conflict: "workspace_id,id" },
  { name: "task_log", conflict: "workspace_id,task_key" },
  { name: "settings", conflict: "workspace_id,key" },
  { name: "agent_tasks", conflict: "workspace_id,id", optional: true },
  { name: "external_documents", conflict: "workspace_id,id" },
  { name: "seeds", conflict: "workspace_id,id" },
];

function parseArgs(argv) {
  const args = { apply: false, allowExtra: false, archiveExtra: false, envFile: "", snapshot: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--allow-extra") args.allowExtra = true;
    else if (arg === "--archive-extra") args.archiveExtra = true;
    else if (arg === "--env-file") args.envFile = argv[++index] || "";
    else if (arg === "--snapshot") args.snapshot = argv[++index] || "";
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`不认识的参数：${arg}`);
  }
  return args;
}

function parseEnv(raw) {
  const values = {};
  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function configOf(args) {
  let fileEnv = {};
  if (args.envFile) {
    const envPath = path.resolve(process.cwd(), args.envFile);
    fileEnv = parseEnv(await readFile(envPath, "utf8"));
  }
  const url = String(process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_SECRET_KEY || fileEnv.SUPABASE_SECRET_KEY || "").trim();
  const workspaceId = String(process.env.SUPABASE_WORKSPACE_ID || fileEnv.SUPABASE_WORKSPACE_ID || PERSONAL_WORKSPACE_ID).trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error("缺少有效的 SUPABASE_URL");
  if (!key) throw new Error("缺少 SUPABASE_SECRET_KEY");
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error("SUPABASE_WORKSPACE_ID 不是有效 UUID");
  return { url, key, workspaceId };
}

function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRANGLER_BIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`wrangler 读取失败（${code}）：${stderr.trim().slice(0, 500)}`));
    });
  });
}

async function d1Query(sql) {
  const stdout = await runWrangler([
    "d1", "execute", "content-pipeline", "--remote", "--json", "--command", sql,
  ]);
  const start = stdout.indexOf("[");
  if (start < 0) throw new Error("wrangler 没有返回 JSON");
  const payload = JSON.parse(stdout.slice(start));
  if (!payload[0]?.success) throw new Error("D1 查询未成功");
  return payload[0].results || [];
}

function scrubValue(value, stats) {
  if (typeof value === "string") {
    const matches = value.match(/\u0000/g);
    if (matches) stats.nulCharacters += matches.length;
    return value.replaceAll("\u0000", "");
  }
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, stats));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubValue(item, stats)]));
  }
  return value;
}

async function readSnapshot(config) {
  const existing = await d1Query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const existingNames = new Set(existing.map((row) => row.name));
  const stats = { nulCharacters: 0 };
  const tables = {};
  for (const table of TABLES) {
    if (!existingNames.has(table.name)) {
      if (table.optional) {
        tables[table.name] = [];
        continue;
      }
      throw new Error(`远程 D1 缺少必需表：${table.name}`);
    }
    const rows = await d1Query(`SELECT * FROM ${table.name}`);
    tables[table.name] = rows.map((row) => scrubValue({ ...row, workspace_id: config.workspaceId }, stats));
  }
  return {
    meta: {
      source: "cloudflare-d1:content-pipeline",
      workspace_id: config.workspaceId,
      exported_at: new Date().toISOString(),
      nul_characters_removed: stats.nulCharacters,
    },
    tables,
  };
}

async function supabaseRequest(config, endpoint, options = {}) {
  const response = await fetch(`${config.url}${endpoint}`, {
    ...options,
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      ...options.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase ${endpoint} 写入失败（${response.status}）：${detail.slice(0, 500)}`);
  }
  return response;
}

async function applySnapshot(config, snapshot) {
  for (const table of TABLES) {
    const rows = snapshot.tables[table.name] || [];
    if (!rows.length) continue;
    const query = new URLSearchParams({ on_conflict: table.conflict });
    await supabaseRequest(config, `/rest/v1/${table.name}?${query}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (table.name === "tags") {
      await supabaseRequest(config, "/rest/v1/rpc/reset_content_studio_tag_sequence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    }
  }
}

async function archiveExtraProjectRows(config, snapshot) {
  const archived = {};
  for (const table of TABLES.filter(({ name }) => name === "topics" || name === "drafts")) {
    const query = new URLSearchParams({
      workspace_id: `eq.${config.workspaceId}`,
      deleted_at: "is.null",
      select: "id",
    });
    const response = await supabaseRequest(config, `/rest/v1/${table.name}?${query}`, {
      headers: { accept: "application/json", range: "0-9999" },
    });
    const actualRows = await response.json();
    const expectedIds = new Set((snapshot.tables[table.name] || []).map((row) => row.id));
    const staleRows = actualRows.filter((row) => !expectedIds.has(row.id));
    for (const row of staleRows) {
      const filters = new URLSearchParams({
        workspace_id: `eq.${config.workspaceId}`,
        id: `eq.${row.id}`,
      });
      await supabaseRequest(config, `/rest/v1/${table.name}?${filters}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      });
    }
    if (staleRows.length) archived[table.name] = staleRows.length;
  }
  return archived;
}

function sameImportedValue(expected, actual) {
  if (expected === actual) return true;
  if (typeof expected === "number" && typeof actual === "number") return Number(expected) === Number(actual);
  return false;
}

async function verifySnapshot(config, snapshot, { allowExtra = false } = {}) {
  const extras = {};
  for (const table of TABLES) {
    const query = new URLSearchParams({
      workspace_id: `eq.${config.workspaceId}`,
      select: "*",
    });
    if (table.name === "external_documents") query.set("remote_missing_at", "is.null");
    const response = await supabaseRequest(config, `/rest/v1/${table.name}?${query}`, {
      headers: { accept: "application/json", range: "0-9999" },
    });
    const actualRows = await response.json();
    const expectedRows = snapshot.tables[table.name] || [];
    const keys = table.conflict.split(",");
    const rowKey = (row) => keys.map((key) => JSON.stringify(row[key])).join("|");
    const actualByKey = new Map(actualRows.map((row) => [rowKey(row), row]));
    const expectedKeys = new Set(expectedRows.map(rowKey));
    for (const expected of expectedRows) {
      const actual = actualByKey.get(rowKey(expected));
      if (!actual) throw new Error(`${table.name} 缺少主键 ${rowKey(expected)}`);
      for (const [column, value] of Object.entries(expected)) {
        if (!sameImportedValue(value, actual[column])) {
          throw new Error(`${table.name} ${rowKey(expected)} 的 ${column} 与 D1 不一致`);
        }
      }
    }
    const extraCount = actualRows.filter((row) => {
      if (expectedKeys.has(rowKey(row))) return false;
      if ((table.name === "topics" || table.name === "drafts") && row.deleted_at) return false;
      return true;
    }).length;
    if (extraCount) extras[table.name] = extraCount;
    if (extraCount && !allowExtra) {
      throw new Error(`${table.name} 比当前 D1 多 ${extraCount} 行；未自动删除，请确认来源后再清理`);
    }
  }
  return extras;
}

function printSummary(snapshot, mode) {
  const rows = Object.values(snapshot.tables).reduce((sum, tableRows) => sum + tableRows.length, 0);
  console.log(`${mode}：${rows} 行`);
  for (const table of TABLES) console.log(`  ${table.name}: ${snapshot.tables[table.name].length}`);
  console.log(`  正文空字符清理: ${snapshot.meta.nul_characters_removed}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("node scripts/migrate-d1-to-supabase.mjs [--env-file <path>] [--snapshot <path>] [--apply] [--allow-extra] [--archive-extra]");
    return;
  }
  if (args.archiveExtra && !args.apply) throw new Error("--archive-extra 必须与 --apply 一起使用");
  const config = await configOf(args);
  const snapshot = await readSnapshot(config);
  printSummary(snapshot, "D1 只读快照检查完成");
  if (args.snapshot) {
    const snapshotPath = path.resolve(process.cwd(), args.snapshot);
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(`  快照已写入: ${snapshotPath}`);
  }
  if (!args.apply) {
    console.log("未写入 Supabase；确认后加 --apply 执行幂等影子导入。");
    return;
  }
  await applySnapshot(config, snapshot);
  const archived = args.archiveExtra ? await archiveExtraProjectRows(config, snapshot) : {};
  const extras = await verifySnapshot(config, snapshot, { allowExtra: args.allowExtra || args.archiveExtra });
  printSummary(snapshot, "Supabase 影子导入完成");
  console.log("  当前 D1 的每一行、主键和导入字段已回读核对一致");
  if (Object.keys(archived).length) {
    console.log(`  已可恢复停用旧快照：${Object.entries(archived).map(([table, count]) => `${table} ${count}`).join(" / ")}`);
  }
  if (Object.keys(extras).length) {
    console.log(`  Supabase 旧快照残留：${Object.entries(extras).map(([table, count]) => `${table} ${count}`).join(" / ")}`);
    console.log("  这些记录未自动删除");
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
