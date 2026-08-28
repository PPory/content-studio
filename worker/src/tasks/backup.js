// D1 整库备份 → vault（每周一次，`src/index.js` 里按 UTC 周日 20:00 触发）。
//
// **为什么需要它：D1 自带的只有 Time Travel，30 天、整库、只能在 Cloudflare 那一侧。**
// 它挡得住「我昨天误删了一批」，挡不住「三个月后才发现某次迁移写坏了」，也挡不住
// 账号本身出事。而 `deleteRow` 那条注释说得很清楚——这个库没有废纸篓，删了就是删了。
//
// 落到 vault 而不是 R2，是因为那条链路已经在跑而且**终点在你自己的硬盘上**：
// GitHub 仓库 → 本机 Obsidian Git 插件。一份数据同时存在于 D1、GitHub、你的电脑，
// 三个都归零才是真丢，这比多开一个 R2 bucket 划算得多。
//
// ---
//
// **这个 dump 的唯一消费者是 `scripts/restore-backup.mjs`。** 两边共用的约定只有两条：
// 顶层结构（version/generatedAt/counts/tables），和下面这张表顺序。改任一处都要改两边，
// 所以 `test/backup.test.js` 拿这个文件里的 `BACKUP_TABLES` 去驱动恢复脚本的测试——
// 顺序漂了会在那儿炸，而不是在你真的需要恢复的那天。

import { all } from "../lib/db.js";
import { isVaultEnabled, archiveBackup } from "../lib/vault.js";

/**
 * 要备份的表，**顺序即恢复时的插入顺序：被引用的表在前**。
 *
 * 外键链是 `materials → inbox / drafts`、`drafts → topics`、`*_tags → tags`，
 * 所以父表必须先插。恢复脚本原样按这个数组走，**加新表要插到依赖它的那张表前面，
 * 不是往末尾追加**——追加到末尾的后果是恢复时报 FOREIGN KEY constraint failed，
 * 而那是你最不想遇到报错的时刻。
 *
 * 十四张表 = 十四条查询，离 D1 每次调用 50 条的上限很远。
 */
export const BACKUP_TABLES = [
  "inbox", "topics", "drafts", "external_documents", "materials",
  "tags", "material_tags", "inbox_tags", "topic_materials", "topic_inbox",
  // ⚠️ `seeds` 有 `draft_id REFERENCES drafts(id)`，所以它必须排在 `drafts` 后面。
  // 往末尾追加正好满足这一条，但**别把这当成"追加就行"**——下一张表未必。
  "seeds",
  "comments", "task_log", "settings",
];

// 压完还超过这个数就别写了。GitHub Contents API 对大文件不保证，而一个写了一半的
// 备份比没有备份更糟——它看着存在。真撞上说明该换 R2 或分表写，不是调大这个数。
const MAX_BYTES = 8 * 1024 * 1024;

/** `d1-YYYY-MM-DD`。文件名里带日期，一眼能看出这份是什么时候的。 */
export function backupBaseName(date = new Date()) {
  return `d1-${date.toISOString().slice(0, 10)}`;
}

/** 全表读出来。返回的就是 SELECT * 的原始行，不做任何字段映射——备份要的是原样。 */
export async function dumpTables(env) {
  const tables = {};
  const counts = {};
  for (const name of BACKUP_TABLES) {
    // 表名来自上面那个常量数组，不是外部输入
    const rows = await all(env, `SELECT * FROM ${name}`);
    tables[name] = rows;
    counts[name] = rows.length;
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    counts,
    tables,
  };
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function runBackup(env) {
  if (!isVaultEnabled(env)) return { skipped: "vault_disabled" };

  const dump = await dumpTables(env);
  const gzipped = await gzip(JSON.stringify(dump));
  if (gzipped.byteLength > MAX_BYTES) {
    throw new Error(`备份 ${Math.round(gzipped.byteLength / 1024)}KB 超过上限，该换存储方案了`);
  }

  const base = backupBaseName();
  const path = await archiveBackup(env, base, gzipped);
  const rows = Object.values(dump.counts).reduce((a, b) => a + b, 0);
  return { path, rows, bytes: gzipped.byteLength, counts: dump.counts };
}
