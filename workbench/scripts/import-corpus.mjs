#!/usr/bin/env node
// 冷启动语料导入。把一个本地目录里的 md 和飞书导出 zip 变成书架上的「资料」，
// 供词条层做原始来源。
//
//   node scripts/import-corpus.mjs "<目录>"            # 预演，只看会导入什么
//   node scripts/import-corpus.mjs "<目录>" --commit   # 真的写进当前工作区
//
// ⚠️ **默认是预演。** 这个脚本写的是用户唯一的真源库，而「导进去什么」这件事
// 光看目录名判断不了——一个 146KB 的文档会切成几节、哪些图是死链、哪本书重名了，
// 都得先摆出来。看过再决定，比导完再收拾便宜得多。
//
// 分组规则：顶层的每个目录 = 一本书（里面的文件是它的章节）；顶层每个孤立的
// md / zip = 各自一本书。

import fs from "node:fs/promises";
import path from "node:path";
import { planDocument, readFeishuArchive, sortSourceNames } from "../server/lib/corpus.mjs";
import { createBookRecord } from "../server/routes/books-local.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";

const SOURCE_EXTENSIONS = new Set([".md", ".markdown", ".zip"]);

function mimeOf(name) {
  const ext = path.extname(name).toLowerCase();
  return ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
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

async function scan(root) {
  const books = [];
  for (const item of sortSourceNames((await fs.readdir(root, { withFileTypes: true })).map((entry) => entry.name))) {
    const absolute = path.join(root, item);
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      const files = sortSourceNames((await fs.readdir(absolute)).filter((name) => SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase())));
      if (files.length) books.push({ title: item, sources: files.map((name) => path.join(absolute, name)) });
    } else if (SOURCE_EXTENSIONS.has(path.extname(item).toLowerCase())) {
      books.push({ title: path.basename(item, path.extname(item)), sources: [absolute] });
    }
  }
  return books;
}

async function buildBook(book, { workspace = null } = {}) {
  const chapters = [];
  let dead = 0;
  let images = 0;
  for (const [index, source] of book.sources.entries()) {
    const { title, text, images: archiveImages } = await readSource(source);
    let body = text;
    // zip 里的图进资产库，正文只留可移植的资产 URI。没有 workspace（预演）就只数个数。
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
    // 切出来的小节要带上它出自哪个文件——`第一节` 这种名字在书架目录里彼此分不开。
    // 但整篇没切开时不要写成「X · X」。
    for (const section of planned.sections) {
      chapters.push({ title: (section.title === title ? title : `${title} · ${section.title}`).slice(0, 100), text: section.text });
    }
  }
  return { chapters, dead, images };
}

const [, , rootArgument, ...flags] = process.argv;
const commit = flags.includes("--commit");
if (!rootArgument) {
  console.error("用法：node scripts/import-corpus.mjs <目录> [--commit]");
  process.exit(1);
}
const root = path.resolve(rootArgument);

const workspace = await openWorkspace({});
try {
  const books = await scan(root);
  if (!books.length) {
    console.log(`${root} 下没有可导入的 md / zip。`);
    process.exit(0);
  }
  console.log(`${commit ? "导入" : "预演"}：${root}`);
  console.log(`工作区：${workspace.paths.databaseFile}\n`);

  let totalChapters = 0;
  let totalChars = 0;
  let totalDead = 0;
  for (const book of books) {
    const existing = workspace.db.prepare(`SELECT b.id FROM books b JOIN entities e ON e.id = b.id AND e.deleted_at IS NULL WHERE b.title = ?`).get(book.title);
    if (existing) {
      console.log(`  跳过  ${book.title}（书架上已经有了）`);
      continue;
    }
    const built = await buildBook(book, { workspace: commit ? workspace : null });
    const chars = built.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
    totalChapters += built.chapters.length;
    totalChars += chars;
    totalDead += built.dead;
    const notes = [`${book.sources.length} 个文件`, `${built.chapters.length} 节`, `${chars.toLocaleString()} 字符`];
    if (built.images) notes.push(`${built.images} 张图`);
    if (built.dead) notes.push(`${built.dead} 处失效图链`);
    console.log(`  ${commit ? "导入" : "待导"}  ${book.title}　　${notes.join(" / ")}`);
    if (commit) await createBookRecord(workspace, { title: book.title, kind: "资料", chapters: built.chapters });
  }

  console.log(`\n合计 ${totalChapters} 节、${totalChars.toLocaleString()} 字符${totalDead ? `，${totalDead} 处飞书失效图链已替换为占位说明` : ""}。`);
  if (!commit) console.log("这是预演，没有写入。确认无误后加 --commit 再跑一次。");
} finally {
  workspace.close();
}
