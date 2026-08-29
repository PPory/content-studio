import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readBookMarks } from "../lib/marks.mjs";
import { DIRS, WB_ROOT } from "../lib/vault-dirs.mjs";
import { isChapterFile, listBooks, parseFrontmatter, splitFrontmatter } from "../lib/vault.mjs";

const stableId = (kind, value) => `obsidian-${kind}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

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

function mime(file) {
  return { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf", ".epub": "application/epub+zip" }[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function readingStatus(value) {
  const text = String(value || "").trim();
  return ["未读", "在读", "读完", "搁置"].includes(text) ? text : "未读";
}

export async function collectObsidianSource({ vaultRoot }) {
  const workbenchRoot = path.join(vaultRoot, WB_ROOT);
  const stat = await fs.stat(workbenchRoot);
  if (!stat.isDirectory()) throw new Error("Obsidian 工作台专用目录不存在或不是目录");
  const records = { books: [], bookDocuments: [], bookMarks: [], knowledgeItems: [] };
  const assets = [];
  const assetFiles = [];
  const assetByAbsolute = new Map();

  const addAsset = async (file, type) => {
    const absolute = path.resolve(file);
    if (assetByAbsolute.has(absolute)) return assetByAbsolute.get(absolute);
    const bytes = await fs.readFile(absolute);
    const digest = sha(bytes);
    const id = stableId("asset", `${path.relative(workbenchRoot, absolute)}\u0000${digest}`);
    const relative = `assets/obsidian/${digest}${path.extname(absolute).toLowerCase() || ".bin"}`;
    assets.push({ id, path: relative, type, originalName: path.basename(absolute), mimeType: mime(absolute) });
    assetFiles.push({ source: "obsidian", path: relative, bytes });
    assetByAbsolute.set(absolute, id);
    return id;
  };

  const books = await listBooks(vaultRoot, DIRS.shelf) || [];
  for (const book of books) {
    const bookId = stableId("book", book.dir);
    const bookDir = path.join(vaultRoot, ...book.dir.split("/"));
    const all = await walk(bookDir);
    const originals = all.filter((file) => [".pdf", ".epub"].includes(path.extname(file).toLowerCase()));
    const sourceAssetId = originals.length ? await addAsset(originals[0], "book") : null;
    for (const file of all.filter((item) => !item.toLowerCase().endsWith(".md") && !originals.includes(item))) await addAsset(file, mime(file).startsWith("image/") ? "image" : "attachment");
    const bookRaw = await fs.readFile(path.join(bookDir, "book.md"), "utf8").catch(() => "");
    const meta = parseFrontmatter(bookRaw).meta;
    records.books.push({ id: bookId, title: book.name, author: book.author || "", readingStatus: readingStatus(book.status), sourceAssetId, metadata: { ...meta, vaultPath: book.dir, kind: book.kind, tags: book.tags }, createdAt: book.importedAt || (await fs.stat(bookDir)).birthtime.toISOString() });
    const documentByPath = new Map();
    const documents = [];
    if (bookRaw.trim()) documents.push({ relative: book.bookPath, title: book.name, body: splitFrontmatter(bookRaw).body });
    for (const chapter of book.chapters || []) {
      const file = path.join(vaultRoot, ...chapter.path.split("/"));
      documents.push({ relative: chapter.path, title: chapter.title || path.basename(chapter.path, ".md"), body: splitFrontmatter(await fs.readFile(file, "utf8")).body });
    }
    documents.forEach((document, index) => {
      const id = stableId("book-document", document.relative);
      documentByPath.set(document.relative, id);
      records.bookDocuments.push({ id, bookId, title: document.title, bodyMarkdown: document.body, documentOrder: index + 1, createdAt: records.books.at(-1).createdAt });
    });
    const fallbackDocumentId = records.bookDocuments.find((item) => item.bookId === bookId)?.id;
    const marks = await readBookMarks(vaultRoot, book.dir);
    for (const chapter of marks.chapters || []) {
      const documentId = documentByPath.get(chapter.path) || fallbackDocumentId;
      if (!documentId) continue;
      for (const item of chapter.items || []) records.bookMarks.push({
        id: stableId("book-mark", `${book.dir}\u0000${chapter.path}\u0000${item.id}`), bookId, documentId,
        markKind: item.kind === "note" ? "note" : "highlight", quoteText: item.quote || "", noteMarkdown: item.note || "", color: item.color || "", createdAt: item.at || records.books.at(-1).createdAt,
      });
    }
  }

  for (const [directory, kind] of [[DIRS.insight, "knowledge_card"], [DIRS.knowledge, "knowledge_card"], [DIRS.webnote, "web_annotation"]]) {
    const absolute = path.join(vaultRoot, ...directory.split("/"));
    for (const file of await walk(absolute)) {
      if (!file.toLowerCase().endsWith(".md") || !isChapterFile(path.basename(file))) continue;
      const relative = path.relative(vaultRoot, file).split(path.sep).join("/");
      const raw = await fs.readFile(file, "utf8");
      const { meta, body } = parseFrontmatter(raw);
      records.knowledgeItems.push({
        id: stableId("knowledge", relative), knowledgeKind: kind, title: String(meta.title || path.basename(file, ".md")), bodyMarkdown: body,
        quoteText: String(meta.quote || ""), sourceUrl: String(meta.url || meta.source || ""), locator: relative,
        createdAt: (await fs.stat(file)).birthtime.toISOString(), updatedAt: (await fs.stat(file)).mtime.toISOString(),
      });
    }
  }

  const mediaRoot = path.join(vaultRoot, ...DIRS.media.split("/"));
  for (const file of await walk(mediaRoot)) await addAsset(file, mime(file).startsWith("image/") ? "image" : "attachment");
  const allWorkbenchFiles = await walk(workbenchRoot);
  return {
    source: {
      workspaceScope: WB_ROOT, records, assets,
      inventory: { files: allWorkbenchFiles.length, byteSize: (await Promise.all(allWorkbenchFiles.map((file) => fs.stat(file)))).reduce((sum, item) => sum + item.size, 0), books: books.length },
      skipped: { archive: "D1 authoritative", plan: "retired", hot: "regenerable" },
    },
    assetFiles,
  };
}
