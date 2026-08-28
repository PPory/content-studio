// 把已进入 Supabase 的洞察、知识卡片、有效计划和网页批注首次同步到飞书。
// 默认只读预览；显式传 --apply 才创建目录/文档和保存映射。

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createFeishuDocument,
  documentFingerprint,
  fetchFeishuDocument,
  runLarkCli,
} from "../server/lib/feishu-sync.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PERSONAL_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const CHUNK_LIMIT = 18_000;
const ROUTES = {
  insight: "insights",
  knowledge: "knowledge",
  plan: "plans",
  webnote: "webnotes",
};

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
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error("缺少有效的 SUPABASE_URL");
  if (!key) throw new Error("缺少 SUPABASE_SECRET_KEY");
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error("SUPABASE_WORKSPACE_ID 不是有效 UUID");
  return { url, key, workspaceId };
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

async function rows(config, table, filters = {}) {
  const query = new URLSearchParams({ workspace_id: `eq.${config.workspaceId}`, select: "*", ...filters });
  const response = await supabaseRequest(config, `/rest/v1/${table}?${query}`, {
    headers: { accept: "application/json", range: "0-9999" },
  });
  return response.json();
}

async function upsert(config, table, conflict, value) {
  const query = new URLSearchParams({ on_conflict: conflict });
  const response = await supabaseRequest(config, `/rest/v1/${table}?${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(value),
  });
  const saved = await response.json();
  return saved[0];
}

function meaningful(document) {
  if (document.kind !== "plan") return true;
  return document.body
    .replace(/^#.*$/gm, "")
    .replace(/^\s*-\s*\[[ xX]\]\s*$/gm, "")
    .trim().length > 0;
}

function dateParts(document) {
  const match = `${document.source_key} ${document.title}`.match(/(20\d{2})-(\d{2})/);
  if (match) return { year: match[1], month: match[2] };
  const date = new Date(document.updated_at);
  return { year: String(date.getUTCFullYear()), month: String(date.getUTCMonth() + 1).padStart(2, "0") };
}

function chunksOf(markdown) {
  const text = String(markdown || "");
  if (text.length <= CHUNK_LIMIT) return [text];
  const chunks = [];
  let current = "";
  for (const block of text.split(/(\r?\n\s*\r?\n)/)) {
    if (current && current.length + block.length > CHUNK_LIMIT) {
      chunks.push(current);
      current = "";
    }
    if (block.length <= CHUNK_LIMIT) {
      current += block;
      continue;
    }
    for (let offset = 0; offset < block.length; offset += CHUNK_LIMIT) {
      if (current) chunks.push(current);
      current = block.slice(offset, offset + CHUNK_LIMIT);
    }
  }
  if (current || !chunks.length) chunks.push(current);
  return chunks;
}

function nodeTokenOf(url) {
  return String(url || "").match(/\/wiki\/([^/?#]+)/)?.[1] || "";
}

async function ensureNode(config, tree, { nodeKey, parentKey, title }) {
  if (tree.has(nodeKey)) return tree.get(nodeKey);
  const parent = tree.get(parentKey);
  if (!parent) throw new Error(`缺少飞书父节点：${parentKey}`);
  const created = await createFeishuDocument({
    title,
    markdown: `${title} 文档。`,
    wikiNode: parent.node_token,
  });
  const node = await upsert(config, "feishu_tree_nodes", "workspace_id,node_key", {
    workspace_id: config.workspaceId,
    node_key: nodeKey,
    node_token: nodeTokenOf(created.url),
    obj_token: created.id,
    obj_type: "docx",
    parent_node_token: parent.node_token,
    title,
  });
  tree.set(nodeKey, node);
  return node;
}

async function targetNode(config, tree, document) {
  const rootKey = ROUTES[document.kind];
  if (!rootKey) throw new Error(`没有配置飞书目录：${document.kind}`);
  if (document.kind === "webnote") return tree.get(rootKey);
  const { year, month } = dateParts(document);
  const yearKey = `${rootKey}/${year}`;
  await ensureNode(config, tree, { nodeKey: yearKey, parentKey: rootKey, title: year });
  if (document.kind !== "plan") return tree.get(yearKey);
  const monthKey = `${yearKey}/${month}`;
  await ensureNode(config, tree, { nodeKey: monthKey, parentKey: yearKey, title: `${month} 月` });
  return tree.get(monthKey);
}

async function bindingOf(config, document) {
  const found = await rows(config, "external_documents", {
    provider: "eq.feishu",
    entity_type: `eq.${document.kind}`,
    entity_id: `eq.${document.id}`,
  });
  return found[0] || null;
}

async function saveBinding(config, document, binding, remote, target, { contentHash, remoteHash }) {
  const now = Math.floor(Date.now() / 1000);
  return upsert(config, "external_documents", "workspace_id,provider,entity_type,entity_id", {
    workspace_id: config.workspaceId,
    id: binding?.id || crypto.randomUUID(),
    provider: "feishu",
    entity_type: document.kind,
    entity_id: document.id,
    external_id: remote.id,
    external_url: remote.url || binding?.external_url || "",
    container_id: target.node_token,
    content_hash: contentHash,
    remote_hash: remoteHash,
    last_source: "local",
    last_synced_at: now,
    created_at: binding?.created_at || now,
    updated_at: now,
  });
}

async function writeDocument(config, document, target) {
  const bodyChunks = chunksOf(document.body);
  const localHash = documentFingerprint(document.title, document.body);
  let binding = await bindingOf(config, document);
  let remote;
  if (binding) {
    remote = { ...(await fetchFeishuDocument(binding.external_id)), url: binding.external_url };
    const remoteHash = documentFingerprint(remote.title, remote.markdown);
    if (binding.content_hash === localHash && binding.remote_hash === remoteHash) return "none";
    if (binding.remote_hash && binding.remote_hash !== remoteHash) {
      throw new Error(`${document.title} 的飞书版本已修改，未自动覆盖`);
    }
    await runLarkCli([
      "docs", "+update", "--as", "user", "--doc", binding.external_id,
      "--mode", "overwrite", "--new-title", document.title, "--markdown", bodyChunks[0],
    ]);
  } else {
    const created = await createFeishuDocument({
      title: document.title,
      markdown: bodyChunks[0],
      wikiNode: target.node_token,
    });
    remote = { id: created.id, url: created.url, title: document.title, markdown: bodyChunks[0] };
    binding = await saveBinding(config, document, null, remote, target, {
      contentHash: "",
      remoteHash: documentFingerprint(remote.title, remote.markdown),
    });
  }
  for (const chunk of bodyChunks.slice(1)) {
    await runLarkCli(["docs", "+update", "--as", "user", "--doc", binding.external_id, "--mode", "append", "--markdown", chunk]);
  }
  const fetched = await fetchFeishuDocument(binding.external_id);
  await saveBinding(config, document, binding, { ...fetched, url: binding.external_url || remote.url }, target, {
    contentHash: localHash,
    remoteHash: documentFingerprint(fetched.title, fetched.markdown),
  });
  return binding.content_hash ? "update" : "create";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("node scripts/bootstrap-feishu-documents.mjs [--env-file <path>] [--apply]");
    return;
  }
  const config = await configOf(args);
  const documents = (await rows(config, "content_documents", { deleted_at: "is.null" })).filter(meaningful);
  const counts = Object.fromEntries(Object.keys(ROUTES).map((kind) => [kind, documents.filter((document) => document.kind === kind).length]));
  console.log(`可同步飞书文档：${documents.length} 份（${Object.entries(counts).map(([kind, count]) => `${kind} ${count}`).join(" / ")}）`);
  if (!args.apply) {
    console.log("未创建或修改飞书文档；确认后加 --apply 执行。");
    return;
  }
  const treeRows = await rows(config, "feishu_tree_nodes");
  const tree = new Map(treeRows.map((node) => [node.node_key, node]));
  const results = { create: 0, update: 0, none: 0, failed: 0 };
  for (const document of documents) {
    try {
      const target = await targetNode(config, tree, document);
      const action = await writeDocument(config, document, target);
      results[action] += 1;
      console.log(`  ${action}: ${document.kind} / ${document.title}`);
    } catch (error) {
      results.failed += 1;
      console.error(`  failed: ${document.kind} / ${document.title}：${error.message}`);
    }
  }
  console.log(`飞书同步完成：新建 ${results.create} / 更新 ${results.update} / 无变化 ${results.none} / 失败 ${results.failed}`);
  if (results.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
