// 备份 → 恢复的往返。
//
// **这里测的是「需要恢复的那天才会暴露」的东西。** 备份任务本身跑没跑成，你在 vault
// 里看得见；转义写错、表顺序漂了，只有在恢复时才炸——而那时候你正在救火。
// 所以覆盖的重点不是「能不能生成」，是「生成的东西能不能用」。

import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKUP_TABLES, backupBaseName, dumpTables } from "../src/tasks/backup.js";
import { sqlLiteral, sqlForTable, sqlFromDump } from "../scripts/restore-backup.mjs";

test("backupBaseName 是 d1-YYYY-MM-DD", () => {
  assert.equal(backupBaseName(new Date("2026-08-16T20:00:00Z")), "d1-2026-08-16");
});

test("sqlLiteral 用两个单引号转义，不用反斜杠", () => {
  // SQLite 里反斜杠不是转义字符。照 MySQL 的习惯写 \' 会把反斜杠本身存进去
  assert.equal(sqlLiteral("it's"), "'it''s'");
  assert.equal(sqlLiteral("C:\\path"), "'C:\\path'");
});

test("sqlLiteral 原样留住换行和中文", () => {
  // 正文列存的就是 Markdown，多行是常态；转义成 \n 的话恢复出来的正文就废了
  assert.equal(sqlLiteral("第一行\n第二行"), "'第一行\n第二行'");
});

test("sqlLiteral 区分 NULL 和空串", () => {
  // views 那几个指标列「没填 ≠ 0」，NULL 变成 '' 就把这个区别抹掉了
  assert.equal(sqlLiteral(null), "NULL");
  assert.equal(sqlLiteral(undefined), "NULL");
  assert.equal(sqlLiteral(""), "''");
  assert.equal(sqlLiteral(0), "0");
});

test("sqlLiteral 遇到不认识的类型直接抛", () => {
  // 安静地 String() 一下会让恢复出来的数据和原来不是一回事，而且没人会发现
  assert.throws(() => sqlLiteral({ a: 1 }), /不认识的值类型/);
  assert.throws(() => sqlLiteral(NaN), /不是有限数字/);
});

test("sqlForTable 的列名从行自己取", () => {
  const sql = sqlForTable("settings", [{ key: "model", value: "x", updated_at: 1 }]);
  assert.equal(sql.length, 1);
  assert.equal(sql[0], "INSERT INTO settings (key, value, updated_at) VALUES ('model', 'x', 1);");
});

test("sqlForTable 空表不产语句", () => {
  assert.deepEqual(sqlForTable("comments", []), []);
  assert.deepEqual(sqlForTable("comments", undefined), []);
});

test("恢复顺序按 BACKUP_TABLES 走，不按 dump 里的 key 顺序", () => {
  // ⚠️ 这条是整个备份链路最容易安静坏掉的地方。JSON 的 key 顺序碰巧和插入顺序
  // 一致，于是「照着 key 顺序来」能跑很久都不出事——直到某次 dump 的 key 顺序变了，
  // 恢复报 FOREIGN KEY constraint failed，而那天你正需要它。
  const sql = sqlFromDump({
    generatedAt: "2026-08-16T20:00:00.000Z",
    tables: {
      // 故意反着写：materials 引用 drafts，drafts 引用 topics
      materials: [{ id: "m1", draft_id: "d1" }],
      drafts: [{ id: "d1", topic_id: "t1" }],
      topics: [{ id: "t1" }],
    },
  });
  const order = ["topics", "drafts", "materials"].map((t) => sql.indexOf(`INSERT INTO ${t} `));
  assert.ok(order.every((i) => i > 0), "三张表都要出现");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "父表必须排在子表前面");
});

test("BACKUP_TABLES 里父表都排在子表前面", () => {
  // 外键关系抄自 schema.sql。加表时这条会提醒你插对位置
  const deps = {
    materials: ["inbox", "drafts"],
    drafts: ["topics"],
    material_tags: ["materials", "tags"],
    inbox_tags: ["inbox", "tags"],
    topic_materials: ["topics", "materials"],
    topic_inbox: ["topics", "inbox"],
  };
  for (const [table, parents] of Object.entries(deps)) {
    const at = BACKUP_TABLES.indexOf(table);
    assert.notEqual(at, -1, `${table} 不在备份清单里`);
    for (const parent of parents) {
      const pat = BACKUP_TABLES.indexOf(parent);
      assert.notEqual(pat, -1, `${parent} 不在备份清单里`);
      assert.ok(pat < at, `${parent} 必须排在 ${table} 前面`);
    }
  }
});

test("sqlFromDump 不是备份文件就抛", () => {
  assert.throws(() => sqlFromDump({}), /不是一份备份文件/);
  assert.throws(() => sqlFromDump(null), /不是一份备份文件/);
});

/**
 * **真 schema 上的往返：备份 → 恢复 → 逐行比对。**
 *
 * 上面那些测的是「生成的字符串长得对不对」，这条测的是「它塞回数据库跑不跑得起来」。
 * 两件事之间还隔着一整套 CHECK 约束、NOT NULL、外键顺序和 SQLite 的字面量解析——
 * 而这一段恰好是**你只会在真的需要恢复那天才走一遍**的代码。
 *
 * 用 `node:sqlite`（Node 22.5+ 内置）而不是起 wrangler：D1 底下就是 SQLite，
 * 而这里要验的是 SQL 本身，不是 D1 的网络行为。拿不到就跳过——`node --test` 是
 * 每次改完都要跑的命令，不该因为 Node 版本旧了就整个红掉。
 */
test("整库往返：真 schema 上恢复出来的数据和备份前逐行一致", async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return t.skip("这个 Node 没有 node:sqlite");
  }
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  // 中文路径：必须走 fileURLToPath，URL.pathname 拿到的是百分号编码
  const schema = await readFile(fileURLToPath(new URL("../schema.sql", import.meta.url)), "utf8");

  const source = new DatabaseSync(":memory:");
  source.exec(schema);
  // 挑的都是「转义写错就会坏」的值：单引号、真换行、字面 \n、反斜杠、NULL vs 0。
  // 还有一条外键链 inbox → materials 和 topics → drafts → materials
  source.exec(`
    INSERT INTO inbox (id, title, kind, body, status, created_at, updated_at)
      VALUES ('01M0', '他说''复利''很重要', '想法', '第一行
第二行\\n这是字面的', '待选题', 100, 100);
    INSERT INTO topics (id, title, viewpoint, status, created_at, updated_at)
      VALUES ('t1', 'C:\\path 里的反斜杠', '', '已成稿', 101, 101);
    INSERT INTO drafts (id, topic_id, headline, body, platform, task_key, views, likes, created_at, updated_at)
      VALUES ('d1', 't1', '标题', '# 标题

正文', 'X', 'k1', NULL, 0, 102, 102);
    INSERT INTO materials (id, title, content, type, inbox_id, draft_id, created_at, updated_at)
      VALUES ('m1', '金句', '原话', '金句/原话', '01M0', 'd1', 103, 103);
    INSERT INTO tags (id, name) VALUES (1, '写作');
    INSERT INTO material_tags (material_id, tag_id) VALUES ('m1', 1);
    INSERT INTO settings (key, value, updated_at) VALUES ('model.draft', 'opus', 104);
  `);

  const env = {
    DB: {
      prepare(sql) {
        const rows = source.prepare(sql).all();
        return { bind: () => ({ all: async () => ({ results: rows }) }) };
      },
    },
  };

  const dump = await dumpTables(env);
  // 恢复的目标是**刚建好表的空库**，和脚本头部写的用法一致
  const restored = new DatabaseSync(":memory:");
  restored.exec(schema);
  restored.exec(sqlFromDump(dump));

  for (const table of BACKUP_TABLES) {
    assert.deepEqual(
      restored.prepare(`SELECT * FROM ${table}`).all(),
      source.prepare(`SELECT * FROM ${table}`).all(),
      `${table} 恢复后和原来不一致`
    );
  }
  // 抽一条最容易被转义弄坏的值单独盯一眼，避免 deepEqual 两边同时错还相等
  const back = restored.prepare("SELECT title, body FROM inbox WHERE id = '01M0'").get();
  assert.equal(back.title, "他说'复利'很重要");
  assert.ok(back.body.includes("第一行\n第二行"), "真换行没了");
  assert.ok(back.body.includes("\\n这是字面的"), "字面的 \\n 被当成换行还原了");
});

test("dumpTables 覆盖清单里的每一张表", async () => {
  // 假 D1：只记下问过哪些表。真正要兜住的是「加了表却没进备份」——
  // 那种漏法在日志里长得和成功一模一样
  const asked = [];
  const env = {
    DB: {
      prepare(sql) {
        asked.push(sql.replace("SELECT * FROM ", ""));
        return { bind: () => ({ all: async () => ({ results: [] }) }) };
      },
    },
  };
  const dump = await dumpTables(env);
  assert.deepEqual(asked, BACKUP_TABLES);
  assert.deepEqual(Object.keys(dump.tables), BACKUP_TABLES);
  assert.equal(dump.version, 1);
});
