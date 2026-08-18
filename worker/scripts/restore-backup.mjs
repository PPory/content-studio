// 把 `tasks/backup.js` 写进 vault 的那份 `.json.gz` 还原成 SQL。
//
//   node scripts/restore-backup.mjs <备份文件.json.gz> > tmp/restore.sql
//   npx wrangler d1 execute content-pipeline --remote --file=tmp/restore.sql
//
// **恢复的目标必须是一个空库**（先跑一遍 `schema.sql` 建表）。生成的是裸 `INSERT`，
// 不是 `INSERT OR REPLACE`、也不是 `OR IGNORE`：
//
//  * `OR REPLACE` 在有外键的表上是**先删后插**，会顺着 `ON DELETE CASCADE`
//    把子表的行一起带走——恢复动作反而删数据，这是最坏的一种「成功」。
//  * `OR IGNORE` 会把冲突安静地跳过，于是你以为恢复完了，实际少了多少行没人知道。
//
// 裸 INSERT 撞上已有行就直接报错停下，这是恢复场景里唯一正确的行为：**宁可不动，
// 也不要动一半**。
//
// ---
//
// 为什么转义这一步放在本机脚本里，而不是让 Worker 直接产 .sql：
// 转义写错的表现是「备份文件天天在生成，需要的那天发现恢复不了」。放在这边，
// 它是一个能跑 `node --test` 的纯函数（`test/backup.test.js` 覆盖），
// 而且真出问题时你看得到报错——Worker 那边只会往 vault 里安静地多写一个坏文件。

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { BACKUP_TABLES } from "../src/tasks/backup.js";

/**
 * 一个值 → SQL 字面量。
 *
 * SQLite 的字符串字面量里**只有单引号需要转义，写法是写两个**——反斜杠在 SQLite
 * 里不是转义字符（这点和 MySQL 不同，照 MySQL 的习惯加反斜杠反而会把反斜杠存进去）。
 * 换行、中文、引号都可以原样待在字面量里。
 */
export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`不是有限数字：${value}`);
    return String(value);
  }
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  // 这个库里没有 BLOB / BOOLEAN 列。真出现了就是 schema 变了而这个脚本没跟上，
  // 必须炸——安静地转成字符串会让恢复出来的数据和原来不是一回事。
  throw new Error(`不认识的值类型 ${typeof value}：${String(value).slice(0, 80)}`);
}

/** 一张表的所有 INSERT。列名从每一行自己取，不写死——schema 加列时不用改这里。 */
export function sqlForTable(name, rows) {
  if (!rows?.length) return [];
  return rows.map((row) => {
    const cols = Object.keys(row);
    const values = cols.map((c) => sqlLiteral(row[c])).join(", ");
    return `INSERT INTO ${name} (${cols.join(", ")}) VALUES (${values});`;
  });
}

/**
 * 整份 dump → SQL 文本。
 *
 * **按 `BACKUP_TABLES` 的顺序走，不按 dump 里 key 的顺序**：JSON 的 key 顺序碰巧
 * 一致，但那是巧合不是约定，而顺序错了就是外键报错。
 */
export function sqlFromDump(dump) {
  if (!dump || typeof dump !== "object" || !dump.tables) {
    throw new Error("不是一份备份文件：缺 tables");
  }
  const out = [
    `-- 从 ${dump.generatedAt || "未知时间"} 的备份恢复`,
    "-- 目标必须是刚建好表的空库（先跑 schema.sql）",
  ];
  for (const name of BACKUP_TABLES) {
    const rows = dump.tables[name];
    if (!rows?.length) continue;
    out.push(`-- ${name}: ${rows.length} 行`, ...sqlForTable(name, rows));
  }
  return `${out.join("\n")}\n`;
}

export function readDump(file) {
  const raw = fs.readFileSync(file);
  const json = file.endsWith(".gz") ? zlib.gunzipSync(raw) : raw;
  return JSON.parse(json.toString("utf8"));
}

// 被 test 引入时不跑主流程
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("用法：node scripts/restore-backup.mjs <备份文件.json.gz> > tmp/restore.sql");
    process.exit(1);
  }
  const dump = readDump(file);
  // 进度写 stderr，SQL 走 stdout——这样 `> restore.sql` 拿到的是干净的 SQL
  console.error(`备份时间 ${dump.generatedAt}，共 ${Object.values(dump.counts || {}).reduce((a, b) => a + b, 0)} 行`);
  process.stdout.write(sqlFromDump(dump));
}
