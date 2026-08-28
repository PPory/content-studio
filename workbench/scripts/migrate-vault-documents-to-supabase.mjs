// 把 vault 中不属于书架、也不是 D1 业务归档副本的独立文档迁到 Supabase。
// 默认只读检查；显式传 --apply 才写入。Obsidian 文件始终不改动。

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DIRS } from "../server/lib/vault-dirs.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PERSONAL_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const SOURCES = [
  { kind: "insight", dir: DIRS.insight, recursive: false },
  { kind: "plan", dir: DIRS.plan, recursive: false },
  { kind: "knowledge", dir: DIRS.knowledge, recursive: true },
  { kind: "webnote", dir: DIRS.webnote, recursive: true },
];

function parseArgs(argv) {
  const args = { apply: false, envFile: path.join(ROOT, ".env") };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--env-file") args.envFile = argv[++index] || "";
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function configOf(args) {
  const fileEnv = parseEnv(await fs.readFile(path.resolve(args.envFile), "utf8"));
  const url = String(process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_SECRET_KEY || fileEnv.SUPABASE_SECRET_KEY || "").trim();
  const workspaceId = String(process.env.SUPABASE_WORKSPACE_ID || fileEnv.SUPABASE_WORKSPACE_ID || PERSONAL_WORKSPACE_ID).trim();
  const vaultRoot = path.resolve(String(process.env.VAULT_ROOT || fileEnv.VAULT_ROOT || "").trim());
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error("缺少有效的 SUPABASE_URL");
  if (!key) throw new Error("缺少 SUPABASE_SECRET_KEY");
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error("SUPABASE_WORKSPACE_ID 不是有效 UUID");
  if (!vaultRoot) throw new Error("缺少 VAULT_ROOT");
  return { url, key, workspaceId, vaultRoot };
}

async function markdownFiles(root, source) {
  const base = path.join(root, ...source.dir.split("/"));
  const out = [];
  async function visit(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (source.recursive && !entry.name.startsWith("_")) await visit(absolute);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      if (/\.(?:notes|highlights)\.md$/i.test(entry.name)) continue;
      out.push(absolute);
    }
  }
  await visit(base);
  return out;
}

function splitFrontmatter(markdown) {
  const match = String(markdown).match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? { frontmatter: match[0], body: markdown.slice(match[0].length) } : { frontmatter: "", body: markdown };
}

function titleOf(body, file) {
  const heading = String(body).match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (heading || path.basename(file, path.extname(file))).slice(0, 800);
}

async function readDocuments(config) {
  const documents = [];
  for (const source of SOURCES) {
    for (const absolute of await markdownFiles(config.vaultRoot, source)) {
      const raw = await fs.readFile(absolute, "utf8");
      const stat = await fs.stat(absolute);
      const { frontmatter, body } = splitFrontmatter(raw.replaceAll("\u0000", ""));
      const sourcePath = path.relative(config.vaultRoot, absolute).split(path.sep).join("/");
      documents.push({
        workspace_id: config.workspaceId,
        kind: source.kind,
        source_key: sourcePath.normalize("NFC"),
        title: titleOf(body, absolute),
        body,
        source_path: sourcePath,
        metadata: {
          migrated_from: "obsidian",
          size_bytes: stat.size,
          frontmatter,
        },
        content_hash: crypto.createHash("sha256").update(body, "utf8").digest("hex"),
        created_at: stat.birthtime.toISOString(),
        updated_at: stat.mtime.toISOString(),
      });
    }
  }
  documents.sort((left, right) => left.source_key.localeCompare(right.source_key, "zh"));
  return documents;
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
    throw new Error(`Supabase ${endpoint} 失败（${response.status}）：${detail.slice(0, 500)}`);
  }
  return response;
}

async function applyDocuments(config, documents) {
  if (!documents.length) return;
  const query = new URLSearchParams({ on_conflict: "workspace_id,kind,source_key" });
  await supabaseRequest(config, `/rest/v1/content_documents?${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(documents),
  });
}

async function verifyDocuments(config, documents) {
  const query = new URLSearchParams({ workspace_id: `eq.${config.workspaceId}`, select: "kind,source_key,title,body,content_hash" });
  const response = await supabaseRequest(config, `/rest/v1/content_documents?${query}`, {
    headers: { accept: "application/json", range: "0-9999" },
  });
  const actual = await response.json();
  const byKey = new Map(actual.map((row) => [`${row.kind}\0${row.source_key}`, row]));
  for (const expected of documents) {
    const row = byKey.get(`${expected.kind}\0${expected.source_key}`);
    if (!row) throw new Error(`Supabase 缺少 ${expected.source_key}`);
    if (row.title !== expected.title || row.body !== expected.body || row.content_hash !== expected.content_hash) {
      throw new Error(`Supabase 回读不一致：${expected.source_key}`);
    }
  }
}

function printSummary(documents, message) {
  const counts = Object.fromEntries(SOURCES.map((source) => [source.kind, 0]));
  for (const document of documents) counts[document.kind] += 1;
  console.log(`${message}：${documents.length} 份`);
  for (const source of SOURCES) console.log(`  ${source.kind}: ${counts[source.kind]}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("node scripts/migrate-vault-documents-to-supabase.mjs [--env-file <path>] [--apply]");
    return;
  }
  const config = await configOf(args);
  const documents = await readDocuments(config);
  printSummary(documents, "vault 只读检查完成");
  if (!args.apply) {
    console.log("未写入 Supabase；确认后加 --apply 执行幂等迁移。");
    return;
  }
  await applyDocuments(config, documents);
  await verifyDocuments(config, documents);
  printSummary(documents, "Supabase 文档迁移并回读核对完成");
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
