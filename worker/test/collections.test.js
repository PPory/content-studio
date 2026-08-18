import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { canonicalizeUrl, hashCollectionText } from "../src/lib/collection-key.js";
import { collectionTitle } from "../src/lib/collection-title.js";

test("链接去锚点、追踪参数并固定查询顺序", () => {
  assert.equal(canonicalizeUrl("HTTPS://Example.com/a/?utm_source=x&b=2&a=1#part"), "https://example.com/a?a=1&b=2");
  assert.equal(canonicalizeUrl("javascript:alert(1)"), "");
});

test("文本去重指纹忽略大小写、全半角和空白差异", async () => {
  assert.equal(await hashCollectionText("ＡI  很好"), await hashCollectionText("ai 很好"));
  assert.equal(await hashCollectionText(""), "");
});

test("浏览器收藏标题不再重复整段社交帖子", () => {
  const selection = "Friendly reminder that you choose your reactions. You don't have to go into a fit of rage.";
  assert.equal(collectionTitle({
    title: `(2) DAN KOE (@thedankoe): “${selection}`,
    selection,
    url: "https://x.com/thedankoe/status/1",
    source: "浏览器扩展",
  }), "DAN KOE (@thedankoe) 的帖子");
  assert.equal(collectionTitle({
    title: `DAN KOE (@thedankoe): \"${selection}`,
    selection,
    url: "https://substack.com/@thedankoe/note/c-1",
    source: "浏览器扩展",
  }), "DAN KOE (@thedankoe) 的帖子");
});

test("普通网页保留有效标题，重复标题退回站点摘录", () => {
  assert.equal(collectionTitle({ title: "一篇真正的文章标题", selection: "这里是文章中的一段正文，内容与标题不同。", url: "https://example.com/a", source: "浏览器扩展" }), "一篇真正的文章标题");
  assert.equal(collectionTitle({ title: "这里是重复的正文标题而且长度足够用于判断", selection: "这里是重复的正文标题而且长度足够用于判断，后面还有正文。", url: "https://example.com/a", source: "浏览器扩展" }), "example.com · 摘录");
  assert.equal(collectionTitle({ title: "用户亲自填写的标题", selection: "用户亲自填写的标题和正文相同也应该保留", url: "https://example.com/a", source: "工作台" }), "用户亲自填写的标题");
});

test("兼容迁移保留旧灵感行为并补齐收藏字段", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE inbox (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '想法', link TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', card_markdown TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '待初筛', value_judgment TEXT NOT NULL DEFAULT '', verdict TEXT NOT NULL DEFAULT '',
    vault_path TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  ); INSERT INTO inbox (id,title,created_at,updated_at) VALUES ('old','旧灵感',1,1);`);
  db.exec(fs.readFileSync(new URL("../migrations/0001_collections_v1.sql", import.meta.url), "utf8"));
  const old = db.prepare("SELECT capture_origin, processing_mode, review_status FROM inbox WHERE id='old'").get();
  assert.deepEqual({ ...old }, { capture_origin: "idea", processing_mode: "triage", review_status: "kept" });
  db.exec("INSERT INTO inbox (id,title,capture_origin,processing_mode,review_status,created_at,updated_at) VALUES ('new','收藏','collection','hold','pending',2,2)");
  assert.equal(db.prepare("SELECT processing_mode FROM inbox WHERE id='new'").get().processing_mode, "hold");
});

test("初筛 SQL 必须排除 hold 收藏", () => {
  const source = fs.readFileSync(new URL("../src/tasks/triage.js", import.meta.url), "utf8");
  assert.match(source, /processing_mode = 'triage'/);
  assert.match(source, /row\.processing_mode !== "triage"/);
});

test("收件箱阅读优先展示划取内容，不把整页噪音拼进正文", () => {
  const source = fs.readFileSync(new URL("../src/workbench.js", import.meta.url), "utf8");
  assert.match(source, /viewKey === "collections" \? row\.selection \|\| row\.body/);
  assert.doesNotMatch(source, /viewKey === "collections" \? \[row\.selection, row\.body\]/);
});

test("收件箱删除不能越权删除同表里的灵感", () => {
  const source = fs.readFileSync(new URL("../src/workbench.js", import.meta.url), "utf8");
  assert.match(source, /body\.view === "collections" && row\?\.capture_origin !== "collection"/);
});
