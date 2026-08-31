import fs from "node:fs/promises";
import path from "node:path";
import { planDocument, readFeishuArchive, sortSourceNames } from "./corpus.mjs";

const SOURCE_EXTENSIONS = new Set([".md", ".markdown", ".zip"]);

function mimeOf(name) {
  const ext = path.extname(name).toLowerCase();
  return ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function sourceFiles(directory, root) {
  const files = [];
  for (const name of sortSourceNames(await fs.readdir(directory))) {
    const absolute = path.join(directory, name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error("语料目录不允许符号链接：" + absolute);
    const real = await fs.realpath(absolute);
    if (!inside(root, real)) throw new Error("语料路径越界：" + absolute);
    if (stat.isDirectory()) files.push(...await sourceFiles(real, root));
    else if (SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase())) files.push(real);
  }
  return files;
}

async function readSource(absolutePath) {
  const ext = path.extname(absolutePath).toLowerCase();
  const bytes = await fs.readFile(absolutePath);
  if (ext === ".zip") {
    const archive = readFeishuArchive(bytes, { fileName: path.basename(absolutePath) });
    return { title: archive.title, text: archive.text, images: archive.images };
  }
  return { title: path.basename(absolutePath, ext), text: new TextDecoder("utf-8").decode(bytes), images: [] };
}

export async function scanCorpusRoot(root) {
  const realRoot = await fs.realpath(root);
  const books = [];
  for (const item of sortSourceNames((await fs.readdir(realRoot, { withFileTypes: true })).map((entry) => entry.name))) {
    const absolute = path.join(realRoot, item);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error("语料目录不允许符号链接：" + absolute);
    if (stat.isDirectory()) {
      const files = await sourceFiles(absolute, realRoot);
      if (files.length) books.push({ title: item, sources: files });
    } else if (SOURCE_EXTENSIONS.has(path.extname(item).toLowerCase())) {
      books.push({ title: path.basename(item, path.extname(item)), sources: [absolute] });
    }
  }
  return books;
}

export async function buildCorpusBook(book, { workspace = null } = {}) {
  const chapters = [];
  let dead = 0;
  let images = 0;
  for (const [index, source] of book.sources.entries()) {
    const { title, text, images: archiveImages } = await readSource(source);
    let body = text;
    for (const image of archiveImages) {
      images += 1;
      if (!workspace) continue;
      const asset = await workspace.assets.importBuffer({
        bytes: image.bytes, type: "image", originalName: path.basename(image.name), mimeType: mimeOf(image.name),
      });
      body = body.split(image.name).join(asset.uri);
    }
    const planned = planDocument({ title, text: body, order: index + 1 });
    dead += planned.dead;
    chapters.push(...planned.sections.map((section) => ({ title: section.title.slice(0, 100), text: section.text })));
  }
  return { chapters, dead, images };
}