import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readSheet } from "../lib/sheet.mjs";

const sha = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const idFor = (kind, value) => `local-${kind}-${sha(value).slice(0, 24)}`;
const number = (value) => {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
};

async function readOptional(file) {
  try { return await fs.readFile(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function revisionBody(scope, item) {
  const blocks = [
    `# ${item.label || "编辑器修订"}`,
    item.instruction ? `## 指令\n\n${item.instruction}` : "",
    item.original ? `## 原文\n\n${item.original}` : "",
    item.candidate ? `## 候选\n\n${item.candidate}` : "",
    ...(item.generations || []).map((entry, index) => `## 生成候选 ${index + 1}\n\n${entry.text || ""}`),
    `迁移来源：${scope}`,
  ];
  return blocks.filter(Boolean).join("\n\n");
}

function backedUpBrowserKey(key) {
  return /^workbench:reading/.test(key) || /^workbench:bookmarks/.test(key) || key === "wechat-typeset";
}

function browserEntries(parsed) {
  if (Array.isArray(parsed?.entries)) {
    return parsed.entries.map((entry) => ({
      key: String(entry?.key || ""),
      origin: String(entry?.origin || ""),
      value: entry?.value ?? "",
    }));
  }
  const state = parsed.browser && typeof parsed.browser === "object" ? parsed.browser : parsed;
  return Object.entries(state || {}).map(([key, value]) => ({ key, origin: "", value }));
}

export async function collectLocalSource({ workbenchDir, browserFile = "" }) {
  const dataDir = path.join(workbenchDir, "data");
  const configDir = path.join(workbenchDir, "config");
  const records = { externalPublications: [], accountMetrics: [], workspaceSettings: [], knowledgeItems: [] };
  const assets = [];
  const assetFiles = [];
  const inventory = { files: {}, browserKeys: 0 };

  const addRaw = async (file, label) => {
    const bytes = await readOptional(file);
    if (!bytes) return null;
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    const relative = `assets/local/raw/${digest}-${path.basename(file)}`;
    const id = `local-raw-${digest.slice(0, 24)}`;
    assets.push({ id, path: relative, type: "import", originalName: path.basename(file), mimeType: path.extname(file) === ".json" ? "application/json" : "text/csv" });
    assetFiles.push({ source: "local", path: relative, bytes });
    inventory.files[label] = { byteSize: bytes.length, sha256: digest };
    return bytes;
  };

  const postsBytes = await addRaw(path.join(dataDir, "posts.csv"), "posts");
  if (postsBytes) {
    const { rows } = readSheet(postsBytes, "posts.csv");
    for (const row of rows) {
      if (!row.date || !row.platform || (!row.title && !row.url)) continue;
      const key = row.url ? `url:${row.url}` : `${row.platform}\u0000${row.date}\u0000${row.title}`;
      records.externalPublications.push({
        id: idFor("publication", key), platform: row.platform, title: row.title || row.url, publishedUrl: row.url || "",
        publishedAt: `${row.date}T00:00:00.000Z`, views: number(row.views), likes: number(row.likes), comments: number(row.comments),
        collects: number(row.collects), shares: number(row.shares), source: "import", createdAt: `${row.date}T00:00:00.000Z`,
      });
    }
  }

  const metricsBytes = await addRaw(path.join(dataDir, "metrics.csv"), "metrics");
  if (metricsBytes) {
    const { rows } = readSheet(metricsBytes, "metrics.csv");
    for (const row of rows) {
      if (!row.date) continue;
      const platform = row.platform || "全部账号";
      records.accountMetrics.push({
        id: idFor("account", `${platform}\u0000${row.date}`), metricDate: row.date, platform,
        followers: number(row.followers ?? row.fans), views: number(row.views), note: row.note || row.notes || "",
        createdAt: `${row.date}T00:00:00.000Z`,
      });
    }
  }

  const revisionBytes = await addRaw(path.join(dataDir, "editor-revisions.json"), "editorRevisions");
  if (revisionBytes) {
    const store = JSON.parse(revisionBytes.toString("utf8"));
    for (const [scope, document] of Object.entries(store.documents || {})) {
      for (const item of document?.items || []) {
        if (!item?.id) continue;
        records.knowledgeItems.push({
          id: idFor("editor-revision", `${scope}\u0000${item.id}`), knowledgeKind: "knowledge_card",
          title: item.label || `编辑器修订 ${item.id}`, bodyMarkdown: revisionBody(scope, item), quoteText: item.original || "",
          locator: `legacy-editor-revision:${scope}:${item.id}`, createdAt: item.createdAt || document.updatedAt,
          updatedAt: item.updatedAt || document.updatedAt || item.createdAt,
        });
      }
    }
  }

  let configFiles = [];
  try { configFiles = (await fs.readdir(configDir, { withFileTypes: true })).filter((item) => item.isFile() && item.name.endsWith(".json")); } catch {}
  for (const entry of configFiles) {
    const bytes = await addRaw(path.join(configDir, entry.name), `config:${entry.name}`);
    if (!bytes) continue;
    try { records.workspaceSettings.push({ key: `legacy_config:${entry.name}`, value: JSON.parse(bytes.toString("utf8")) }); } catch {}
  }

  if (browserFile) {
    const bytes = await addRaw(browserFile, "browserLocal");
    if (bytes) {
      const parsed = JSON.parse(bytes.toString("utf8"));
      for (const { key, origin, value } of browserEntries(parsed)) {
        if (!backedUpBrowserKey(key)) continue;
        const scope = origin ? `${origin}:` : "";
        records.workspaceSettings.push({ key: `legacy_browser:${scope}${key}`, value: String(value) });
        inventory.browserKeys += 1;
      }
    }
  }

  return { source: { records, assets, inventory, skipped: { retiredAttentionPlan: inventory.files["config:attention.json"] ? 1 : 0 } }, assetFiles };
}
