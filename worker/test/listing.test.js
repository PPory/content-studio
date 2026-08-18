// 工作台列表的排序与游标。
//
// 这一组钉的是一个**真出过、而且不报错**的 bug：三处列表查询都写着 `ORDER BY id DESC`，
// 注释里的理由是「ULID 字典序即时间序」——那句话对纯 ULID 成立，但这个库的 id 有两种格式
//（迁移过来的是小写 UUID，新建的是 ULID）。结果是新建的行整体沉到所有旧行后面：
// 8-16 写的稿排在 7-05 那篇的后面，而界面上看不出任何异常，只会以为「东西没进来」。
import test from "node:test";
import assert from "node:assert/strict";

import { LIST_ORDER, cursorClause, encodeCursor } from "../src/lib/db.js";

test("排序判据是 updated_at，不是 id", () => {
  assert.match(LIST_ORDER, /^ORDER BY updated_at DESC/);
  assert.doesNotMatch(LIST_ORDER, /^ORDER BY id/);
});

/**
 * ⚠️ **必须和卡片上显示的那个日期是同一列。** 卡片显示的是 `decorate` 给的
 * `editedAt`（= `updated_at`），而 `/wb/*` 压根不回 `createdAt`。改成按 `created_at` 排
 * 的话，七月建、八月改过的那条会显示着「08-14」却躺在显示「07-08」的那条下面——
 * **屏幕上的日期上下乱跳，看着就是排序坏了**。要换判据就得同时换卡片显示的字段，
 * 这条断言是拦住「只改一半」的。
 */
test("排序判据和卡片上显示的 editedAt 是同一列", () => {
  assert.match(LIST_ORDER, /updated_at/);
  assert.doesNotMatch(LIST_ORDER, /created_at/);
});

/**
 * ⚠️ **次级排序键不是装饰。** `updated_at` 是秒，而一轮初筛能在同一秒里写进 6–8 张素材卡
 *（线上实测：`2026-07-05 08:33:00` 上并列 8 行）。并列时顺序不稳定的话，游标指向的那一行
 * 下次查询可能排到了别处——**翻页会漏行，也会重复**。
 */
test("并列时用 id 兜底，保证顺序稳定", () => {
  assert.match(LIST_ORDER, /updated_at DESC, id DESC$/);
});

test("游标带上 updated_at 和 id 两段", () => {
  assert.equal(encodeCursor({ updated_at: 1786887317, id: "01M04N9QE2AST4S8V2KXCPT3Z3" }), "1786887317.01M04N9QE2AST4S8V2KXCPT3Z3");
  assert.equal(encodeCursor(null), null);
  assert.equal(encodeCursor(undefined), null);
});

test("游标条件摊开成 OR，不依赖行值比较", () => {
  const { sql, params } = cursorClause("1786887317.01M04N9QE2AST4S8V2KXCPT3Z3");
  // 不用 `(updated_at, id) < (?, ?)`：D1 底下的 SQLite 版本不由我们定，
  // 而这条错了的表现是「翻页少几行」——同样是不报错的那一类
  assert.equal(sql, "(updated_at < ? OR (updated_at = ? AND id < ?))");
  assert.deepEqual(params, [1786887317, 1786887317, "01M04N9QE2AST4S8V2KXCPT3Z3"]);
});

test("UUID 做游标也认（迁移过来的行同样要能翻页）", () => {
  const { params } = cursorClause("1783910760.3b91922f-bc32-8130-b46c-fc0233761e31");
  assert.deepEqual(params, [1783910760, 1783910760, "3b91922f-bc32-8130-b46c-fc0233761e31"]);
});

/**
 * ⚠️ **认不出的游标当成没有游标，绝不抛错。** 旧格式是裸 id；换新格式部署的那一刻，
 * 正开着页面的人点「加载更多」拿来问的就是旧游标。这时宁可让他看到重复几条
 *（刷新一次就好），也不要甩一个 500——那看起来是「工作台坏了」。
 */
test("旧格式和垃圾游标一律退回第一页", () => {
  for (const bad of ["", null, undefined, "01M04N9QE2AST4S8V2KXCPT3Z3", "3b91922f-bc32-8130-b46c-fc0233761e31", "abc.def", "..", "1786887317."]) {
    assert.deepEqual(cursorClause(bad), { sql: "", params: [] }, `游标 ${JSON.stringify(bad)} 应该被当成没有游标`);
  }
});
