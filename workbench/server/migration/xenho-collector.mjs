import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const stableId = (kind, value) => `xenho-${kind}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function walk(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  await visit(root);
  return files;
}

function scopeType(scope) {
  return String(scope).startsWith("reader:") ? "reading" : String(scope).startsWith("project:") ? "project" : "global";
}

function messageId(conversationId, message, seen) {
  const original = String(message.id || "").trim();
  if (original && !seen.has(original)) { seen.add(original); return original; }
  const id = stableId("message", `${conversationId}\u0000${original}\u0000${message.createdAt || ""}\u0000${message.role || ""}`);
  seen.add(id);
  return id;
}

export async function collectXenhoSource({ xenhoDir }) {
  const root = path.resolve(xenhoDir);
  const allFiles = await walk(root);
  const conversationFiles = allFiles.filter((file) => path.basename(file) === "conversation.json" && file.includes(`${path.sep}assistant${path.sep}`));
  const records = { conversations: [], conversationAssets: [], messages: [] };
  const assets = [];
  const assetFiles = [];
  const attachmentFiles = new Set();
  const seenMessages = new Set();
  const missingAttachments = [];
  let emptyConversations = 0;

  for (const file of conversationFiles) {
    let record;
    try { record = JSON.parse(await fs.readFile(file, "utf8")); } catch { continue; }
    const messages = Array.isArray(record.messages) ? record.messages : [];
    const attachments = Array.isArray(record.attachments) ? record.attachments : [];
    if (!messages.length && !attachments.length && record.titleMode !== "manual") { emptyConversations += 1; continue; }
    const conversationId = String(record.id || path.basename(path.dirname(file))).trim();
    if (!conversationId) continue;
    const migratedAttachments = [];
    for (const item of attachments) {
      const candidate = String(item.originalPath || "").trim();
      const absolute = candidate ? path.resolve(candidate) : "";
      if (!absolute || !inside(root, absolute)) {
        missingAttachments.push({ conversationId, id: item.id || "", reason: "附件路径不在 .xenho 内" });
        migratedAttachments.push({ ...item, assetId: "", originalPath: "" });
        continue;
      }
      let bytes;
      try { bytes = await fs.readFile(absolute); } catch {
        missingAttachments.push({ conversationId, id: item.id || "", reason: "附件文件缺失" });
        migratedAttachments.push({ ...item, assetId: "", originalPath: "" });
        continue;
      }
      attachmentFiles.add(absolute.toLowerCase());
      const digest = sha(bytes);
      const assetId = stableId("attachment", digest);
      const relative = `assets/xenho/attachments/${digest}${path.extname(absolute).toLowerCase() || ".bin"}`;
      const mimeType = String(item.imageRef?.mediaType || item.type || "application/octet-stream");
      assets.push({ id: assetId, path: relative, type: mimeType.startsWith("image/") ? "image" : "attachment", originalName: item.name || path.basename(absolute), mimeType });
      assetFiles.push({ source: "xenho", path: relative, bytes });
      const migrated = { ...item, assetId, originalPath: "" };
      migratedAttachments.push(migrated);
      records.conversationAssets.push({ conversationId, assetId, displayName: migrated.name || "", extractedText: migrated.extractedText || "", usedAt: migrated.usedAt || null, createdAt: migrated.createdAt || record.createdAt });
    }
    const stored = { ...record, id: conversationId, attachments: migratedAttachments };
    records.conversations.push({
      id: conversationId, title: record.title || "历史会话", scopeType: scopeType(record.scopeId), scopeId: record.scopeId || "global",
      model: record.model || "", record: stored, permissionMode: record.permissionMode || "daily", titleMode: record.titleMode || "auto",
      pinnedAt: record.pinnedAt || null, archivedAt: record.archivedAt || null, activeTurn: record.activeTurn || null, lastTurn: record.lastTurn || null,
      sessionMetadata: { piSessionId: record.piSessionId || record.harnessSessionId || "", piSessionFile: record.piSessionFile || "", pathGrants: record.pathGrants || [], replayHistory: Boolean(record.replayHistory) },
      createdAt: record.createdAt, updatedAt: record.updatedAt || record.createdAt,
    });
    messages.forEach((message, index) => records.messages.push({
      id: messageId(conversationId, message, seenMessages), conversationId, sequence: index + 1,
      role: ["system", "user", "assistant", "tool"].includes(message.role) ? message.role : "user", bodyMarkdown: message.text || "",
      metadata: { ...message, id: undefined, text: undefined, originalId: message.id || "" }, createdAt: message.createdAt || record.createdAt,
    }));
  }

  for (const file of allFiles) {
    if (attachmentFiles.has(file.toLowerCase())) continue;
    const bytes = await fs.readFile(file);
    const digest = sha(bytes);
    const relativeSource = path.relative(root, file).split(path.sep).join("/");
    const relative = `assets/xenho/history/${digest}-${path.basename(file)}`;
    assets.push({ id: stableId("history", `${relativeSource}\u0000${digest}`), path: relative, type: "import", originalName: relativeSource, mimeType: file.endsWith(".json") ? "application/json" : file.endsWith(".jsonl") ? "application/x-ndjson" : "application/octet-stream" });
    assetFiles.push({ source: "xenho", path: relative, bytes });
  }

  return {
    source: {
      records, assets,
      inventory: { files: allFiles.length, byteSize: (await Promise.all(allFiles.map((file) => fs.stat(file)))).reduce((sum, item) => sum + item.size, 0), conversationFiles: conversationFiles.length },
      skipped: { emptyConversations }, missingAttachments,
    },
    assetFiles,
  };
}
