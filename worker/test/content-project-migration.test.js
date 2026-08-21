import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = readFileSync(new URL("../migrations/0002_content_projects_v2.sql", import.meta.url), "utf8");
const releaseMigration = readFileSync(new URL("../migrations/0003_release_packages_v1.sql", import.meta.url), "utf8");

function oldDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE topics (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE drafts (
      id TEXT PRIMARY KEY,
      topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
      headline TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

test("项目 v2 迁移保留旧稿并只为单稿项目回填母版", () => {
  const db = oldDatabase();
  db.exec(`
    INSERT INTO topics VALUES ('one', '单稿', '已成稿'), ('many', '多稿', '已成稿');
    INSERT INTO drafts VALUES
      ('d-one', 'one', '唯一稿', '待修改', 1),
      ('d-a', 'many', 'A', '待修改', 2),
      ('d-b', 'many', 'B', '已发布', 3);
  `);
  db.exec(migration);

  const topics = db.prepare("SELECT id, primary_draft_id FROM topics ORDER BY id").all().map((row) => ({ ...row }));
  assert.deepEqual(topics, [
    { id: "many", primary_draft_id: null },
    { id: "one", primary_draft_id: "d-one" },
  ]);
  const drafts = db.prepare("SELECT id, workflow_status, parent_draft_id FROM drafts ORDER BY id").all().map((row) => ({ ...row }));
  assert.deepEqual(drafts, [
    { id: "d-a", workflow_status: "写作中", parent_draft_id: null },
    { id: "d-b", workflow_status: "已发布", parent_draft_id: null },
    { id: "d-one", workflow_status: "写作中", parent_draft_id: null },
  ]);
  db.close();
});

test("项目 v2 状态约束拒绝非法值", () => {
  const db = oldDatabase();
  db.exec(migration);
  db.exec("INSERT INTO topics VALUES ('one', '单稿', '待写', NULL)");
  assert.throws(
    () => db.exec("INSERT INTO drafts (id, topic_id, headline, status, updated_at, workflow_status) VALUES ('bad', 'one', '坏状态', '待修改', 1, '随便写')"),
    /CHECK constraint failed/
  );
  db.close();
});

test("发布包迁移保留旧稿并补齐空的发布信息", () => {
  const db = oldDatabase();
  db.exec("INSERT INTO topics VALUES ('one', '单稿', '已成稿')");
  db.exec("INSERT INTO drafts VALUES ('d-one', 'one', '唯一稿', '待修改', 1)");
  db.exec(migration);
  db.exec(releaseMigration);
  const row = { ...db.prepare("SELECT cover_url, cover_text, cover_note, keywords_json, interaction_goal FROM drafts WHERE id = 'd-one'").get() };
  assert.deepEqual(row, { cover_url: "", cover_text: "", cover_note: "", keywords_json: "[]", interaction_goal: "" });
  db.close();
});
