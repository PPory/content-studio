#!/usr/bin/env node
// 冷启动语料导入。把一个本地目录里的 md 和飞书导出 zip 变成书架上的「资料」，
// 供词条层做原始来源。
//
//   node scripts/import-corpus.mjs "<目录>"                # 预演，只看会导入什么
//   node scripts/import-corpus.mjs "<目录>" --commit       # 真的写进当前工作区
//   node scripts/import-corpus.mjs "<目录>" --reclassify   # 只按目录结构回填归类，不导正文
//
// ⚠️ **默认是预演。** 这个脚本写的是用户唯一的真源库，而「导进去什么」这件事
// 光看目录名判断不了——目录里有多少章节文件、哪些图是死链、哪份来源重名了，
// 都得先摆出来。看过再决定，比导完再收拾便宜得多。
//
// 分组规则：顶层的每个目录 = 一份来源（递归读取其中的章节文件）；顶层每个孤立的
// md / zip = 各自一本书。

import path from "node:path";
import { classifySource } from "../server/lib/corpus.mjs";
import { buildCorpusBook, scanCorpusRoot } from "../server/lib/corpus-sources.mjs";
import { applyExistingCourseRepair, planExistingCourseRepair } from "../server/lib/corpus-repair.mjs";
import { writeFullWorkspaceBackup } from "../server/backup/workspace-backup.mjs";
import { createBookRecord } from "../server/routes/books-local.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";

/**
 * 导进来的默认是**藏书（正文只读）**，不是资料。
 *
 * 书架上这两个值不是分类，是权限开关——「改了它，从书里摘的引用就不可信了」。
 * 词条的每条事实都要挂一个来源实体，来源能被随手改写的话，事实就不可验证，
 * 真实性硬闸也就形同虚设。别人写的东西一律只读。
 *
 * 例外是自己写的：那是自己的想法，本来就该继续改。
 */
function kindFor(title) {
  return /^随笔|^我的|草稿$/.test(title) ? "资料" : "藏书";
}

const [, , rootArgument, ...flags] = process.argv;
const commit = flags.includes("--commit");
const reclassify = flags.includes("--reclassify");
const repairExisting = flags.includes("--repair-existing");
const onlyFlag = flags.find((flag) => flag.startsWith("--only="));
const only = onlyFlag ? onlyFlag.slice("--only=".length) : "";
if (!rootArgument) {
  console.error("用法：node scripts/import-corpus.mjs <目录> [--commit] [--repair-existing] [--only=名称]");
  process.exit(1);
}
const root = path.resolve(rootArgument);
const workspace = await openWorkspace({});
try {
  const scanned = await scanCorpusRoot(root);
  const books = only ? scanned.filter((book) => book.title === only) : scanned;
  if (!books.length) throw new Error(only ? "没有找到顶层目录：" + only : root + " 下没有可导入的 md / zip。");
  console.log((commit ? "写入" : "预演") + "：" + root);
  console.log("工作区：" + workspace.paths.databaseFile);

  const repairs = [];
  for (const source of books) {
    const book = workspace.db.prepare("SELECT b.id,b.title,b.source_kind AS sourceKind FROM books b JOIN entities e ON e.id=b.id AND e.deleted_at IS NULL WHERE b.title=?").get(source.title);
    if (book && repairExisting) {
      const built = await buildCorpusBook(source);
      repairs.push({ source, book, built, plan: planExistingCourseRepair(workspace, book, built.chapters) });
    }
  }

  if (commit && repairs.length) {
    const blocked = repairs.find((item) => item.plan.blocked);
    if (blocked) {
      const detail = Object.entries(blocked.plan.references).filter(([, count]) => count).map(([name, count]) => name + " " + count).join("、");
      throw new Error(blocked.book.title + " 已有关联数据（" + detail + "），已停止且未写入。");
    }
    const backup = await writeFullWorkspaceBackup(workspace, { category: "Manual" });
    console.log("恢复点：" + backup.file);
  }

  let totalChapters = 0;
  let totalChars = 0;
  for (const source of books) {
    const existing = workspace.db.prepare("SELECT b.id,b.title,b.source_kind AS sourceKind FROM books b JOIN entities e ON e.id=b.id AND e.deleted_at IS NULL WHERE b.title=?").get(source.title);
    if (existing && reclassify) {
      const own = kindFor(source.title) === "资料";
      const wanted = classifySource({ title: source.title, fileCount: source.sources.length, own });
      if (commit && existing.sourceKind !== wanted) workspace.db.prepare("UPDATE books SET source_kind=? WHERE id=?").run(wanted, existing.id);
      console.log("  " + (existing.sourceKind === wanted ? "不变" : commit ? "归类" : "待归类") + "  " + source.title + "  " + existing.sourceKind + (existing.sourceKind === wanted ? "" : " → " + wanted));
      continue;
    }
    if (existing && repairExisting) {
      const item = repairs.find((candidate) => candidate.book.id === existing.id);
      const chars = item.built.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
      const references = Object.entries(item.plan.references).filter(([, count]) => count).map(([name, count]) => name + " " + count).join("、");
      console.log("  " + (commit ? "修复" : "待修复") + "  " + source.title + "  " + item.plan.current.length + " → " + item.plan.wanted.length + " 章，移除 " + item.plan.removed.length + " 个误拆条目" + (references ? "；阻塞：" + references : ""));
      if (commit) applyExistingCourseRepair(workspace, existing, item.plan);
      totalChapters += item.plan.wanted.length;
      totalChars += chars;
      continue;
    }
    if (existing) {
      console.log("  跳过  " + source.title + "（书架上已经有了）");
      continue;
    }
    const built = await buildCorpusBook(source, { workspace: commit ? workspace : null });
    const chars = built.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
    const kind = kindFor(source.title);
    const sourceKind = classifySource({ title: source.title, fileCount: source.sources.length, own: kind === "资料" });
    console.log("  " + (commit ? "导入" : "待导") + "  " + source.title + "  " + source.sources.length + " 个文件 / " + built.chapters.length + " 章 / " + chars.toLocaleString() + " 字符");
    if (commit) await createBookRecord(workspace, { title: source.title, kind, sourceKind, chapters: built.chapters });
    totalChapters += built.chapters.length;
    totalChars += chars;
  }
  console.log("合计 " + totalChapters + " 章、" + totalChars.toLocaleString() + " 字符。");
  if (!commit) console.log("这是预演，没有写入。确认无误后加 --commit 再执行。");
} finally {
  workspace.close();
}
