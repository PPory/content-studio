// 自动发现「刚从平台后台下载下来、还没导进来」的导出文件。
//
// **为什么值得做**：手动那条路里最烦的不是点确认，是「打开文件对话框 → 翻到下载文件夹 →
// 在一堆文件里认出哪个是刚才下的」。而那三步机器全知道答案：文件就在下载目录、就是最近改的、
// 名字里多半带着平台名。能推断的不该让用户填，能一步完成的不该拆三步。
//
// 只读，只看两个目录，只认表格文件。**不递归子目录**——下载目录里的子文件夹是别人的东西。

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { guessPlatform, mergePosts, parseExport, readPosts } from "./posts.mjs";

const EXTS = new Set([".csv", ".xlsx", ".xlsm"]);
const MAX_AGE_DAYS = 30;
const MAX_FILES = 12;
const MAX_SIZE = 20_000_000;

/**
 * 找哪儿。默认是系统下载目录 + 项目里的 `data/inbox/`（想固定放一个地方的话用它）。
 * `.env` 的 `DOWNLOADS_DIR` 可以覆盖第一个——不是所有人的下载目录都在 `~/Downloads`。
 */
export function inboxDirs(env = {}) {
  return [env.DOWNLOADS_DIR || path.join(os.homedir(), "Downloads"), path.resolve(process.cwd(), "data", "inbox")];
}

/**
 * id 是路径的哈希，**不是路径本身**。
 *
 * 前端拿到 id 再回来要求导入某个文件——如果那个参数是路径，就等于开了一个「读任意文件」
 * 的口子（和 vault 的 safeJoin 是同一类问题）。哈希只有我们这次扫出来的文件才对得上，
 * 导入时再验一遍它落在允许的目录里，两道。
 */
const idOf = (p) => createHash("sha1").update(p).digest("hex").slice(0, 16);

async function listDir(dir) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return []; // 目录不存在很正常（没有 data/inbox/），不是错误
  }
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400_000;
  const out = [];
  for (const name of names) {
    if (name.startsWith("~$") || !EXTS.has(path.extname(name).toLowerCase())) continue;
    const abs = path.join(dir, name);
    try {
      const st = await fs.stat(abs);
      if (!st.isFile() || st.size > MAX_SIZE || st.mtimeMs < cutoff) continue;
      out.push({ abs, dir, name, size: st.size, mtime: new Date(st.mtimeMs).toISOString() });
    } catch {
      /* 权限或临时文件，跳过 */
    }
  }
  return out;
}

/**
 * 扫一遍 → 每份文件带上「导进来会发生什么」。
 *
 * **卡片上直接给出新增/更新的条数**，而不是只报个文件名：那样点之前就知道这一下会不会
 * 白点（多数时候是「已经导过了」）。代价是要真解析一遍，但这些文件就几百行、几十 KB。
 *
 * 解析失败的**不铺出来**：下载目录里本来就有一堆和这事无关的表格（对账单、报表），
 * 把它们列成「无法识别的导出文件」只会把真正要点的那一个埋掉。
 */
export async function scanInbox(env = {}) {
  const dirs = inboxDirs(env);
  const files = (await Promise.all(dirs.map(listDir))).flat().sort((a, b) => (a.mtime < b.mtime ? 1 : -1));

  const existing = await readPosts();
  const out = [];
  for (const f of files.slice(0, MAX_FILES * 2)) {
    if (out.length >= MAX_FILES) break;
    const platform = guessPlatform(f.name);
    try {
      const bytes = await fs.readFile(f.abs);
      // 猜不出平台时先按小红书试解析：这一步只是为了知道「它是不是一份内容导出」，
      // 平台名由用户在卡片上选，猜错了不会写进去
      const parsed = parseExport(bytes, { filename: f.name, platform: platform || "小红书", today: "" });
      if (!parsed.rows.length || !parsed.mapping.date) continue;
      const { added, updated } = mergePosts(existing, parsed.rows.map((r) => ({ ...r, platform: platform || "小红书" })));
      out.push({
        id: idOf(f.abs),
        name: f.name,
        dir: f.dir,
        mtime: f.mtime,
        platform,
        rows: parsed.rows.length,
        added: platform ? added : null, // 平台没定就别报数：换个平台这两个数就变了
        updated: platform ? updated : null,
        warnings: parsed.warnings,
        complete: !parsed.warnings.length,
      });
    } catch {
      /* 不是我们认得的表，当它不存在 */
    }
  }
  return { dirs, files: out };
}

/** 按 id 取回绝对路径，并**再验一次它确实在允许的目录里**（哈希对上了也不能省这一步）。 */
export async function resolveInboxFile(env, id) {
  const dirs = inboxDirs(env);
  for (const dir of dirs) {
    for (const f of await listDir(dir)) {
      if (idOf(f.abs) === id) {
        const rel = path.relative(dir, f.abs);
        if (rel.startsWith("..") || path.isAbsolute(rel)) break; // 不该发生，发生了就是有人在造 id
        return f;
      }
    }
  }
  return null;
}
