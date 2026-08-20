import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  MATERIAL_LIBRARY_CTE,
  MATERIAL_LIBRARY_STAGES,
  materialLibraryStage,
  materialLibraryWhere,
  parseMaterialLibraryQuery,
} from "../src/lib/material-library.js";

test("统一素材阶段只由真实字段和关系决定", () => {
  assert.equal(materialLibraryStage({ kind: "collection", reviewStatus: "pending" }), "待处理");
  assert.equal(materialLibraryStage({ kind: "collection", reviewStatus: "kept", status: "待初筛" }), "已收纳");
  assert.equal(materialLibraryStage({ kind: "collection", reviewStatus: "archived" }), "已归档");
  assert.equal(materialLibraryStage({ kind: "idea", status: "初筛失败/需人工" }), "待处理");
  assert.equal(materialLibraryStage({ kind: "idea", status: "已弃用" }), "已归档");
  assert.equal(materialLibraryStage({ kind: "idea", status: "待选题" }), "已收纳");
  assert.equal(materialLibraryStage({ kind: "material", verificationStatus: "待核验", topicIds: ["t"] }), "需核验");
  assert.equal(materialLibraryStage({ kind: "material", verificationStatus: "不适用", topicIds: ["t"] }), "已使用");
  assert.equal(materialLibraryStage({ kind: "material", verificationStatus: "已核验", draftIds: ["d"] }), "已使用");
  assert.equal(materialLibraryStage({ kind: "material", verificationStatus: "不适用" }), "可用素材");
});

test("SQL 聚合不重复转灵感的收藏，且六个阶段与规则一致", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE inbox (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, save_note TEXT NOT NULL DEFAULT '',
      selection TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', card_markdown TEXT NOT NULL DEFAULT '',
      review_status TEXT NOT NULL, status TEXT NOT NULL, verdict TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
      canonical_url TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', capture_origin TEXT NOT NULL,
      processing_mode TEXT NOT NULL DEFAULT 'triage', updated_at INTEGER NOT NULL
    );
    CREATE TABLE materials (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
      verification TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '', draft_id TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE topic_materials (topic_id TEXT NOT NULL, material_id TEXT NOT NULL);

    INSERT INTO inbox (id,title,kind,review_status,status,capture_origin,processing_mode,updated_at) VALUES
      ('c1','待整理','想法','pending','待初筛','collection','hold',11),
      ('c2','已转灵感的收藏','想法','kept','待初筛','collection','triage',10),
      ('c3','归档收藏','摘录','archived','存档备用','collection','hold',9),
      ('i1','待初筛灵感','想法','kept','待初筛','idea','triage',8),
      ('i2','失败灵感','想法','kept','初筛失败/需人工','idea','triage',7),
      ('i3','已收纳灵感','想法','kept','待选题','idea','triage',6),
      ('i4','弃用灵感','想法','kept','已弃用','idea','triage',5);
    INSERT INTO materials (id,title,type,verification,draft_id,updated_at) VALUES
      ('m1','待核验','数据/事实','待核验',NULL,4),
      ('m2','项目已用','核心观点','不适用',NULL,3),
      ('m3','稿件产出','平台反馈','不适用','d1',2),
      ('m4','可用','案例/故事','不适用',NULL,1);
    INSERT INTO topic_materials (topic_id,material_id) VALUES ('t1','m2');
  `);

  const rows = db.prepare(`${MATERIAL_LIBRARY_CTE} SELECT id, source_key, kind, stage FROM material_library ORDER BY updated_at DESC, id DESC`).all();
  assert.equal(rows.length, 11);
  assert.equal(rows.filter((row) => row.id === "c2").length, 1, "转灵感的收藏不能在两个旧入口重复出现");
  assert.deepEqual([...new Set(rows.map((row) => row.stage))].sort(), [...MATERIAL_LIBRARY_STAGES].sort());
  assert.equal(rows.find((row) => row.id === "m1").stage, "需核验");
  assert.equal(rows.find((row) => row.id === "m2").stage, "已使用");
  assert.equal(rows.find((row) => row.id === "m3").stage, "已使用");
  assert.equal(rows.find((row) => row.id === "m4").stage, "可用素材");
});

test("查询参数校验、限流与 bind 边界不可绕过", () => {
  const parsed = parseMaterialLibraryQuery(new URL("https://example.test/wb/materials?stage=%E9%9C%80%E6%A0%B8%E9%AA%8C&type=%E6%95%B0%E6%8D%AE%2F%E4%BA%8B%E5%AE%9E&verification=%E5%BE%85%E6%A0%B8%E9%AA%8C&pageSize=999&q=%25"));
  assert.equal(parsed.pageSize, 100);
  assert.equal(parsed.stage, "需核验");
  const where = materialLibraryWhere(parsed);
  assert.match(where.sql, /stage = \?/);
  assert.doesNotMatch(where.sql, /数据\/\u4e8b实|%25/);
  assert.ok(where.params.includes("数据/事实"));
  assert.throws(() => parseMaterialLibraryQuery(new URL("https://example.test/wb/materials?stage=随便")), /stage 不合法/);
  assert.throws(() => parseMaterialLibraryQuery(new URL("https://example.test/wb/materials?verification=已猜测")), /verification 不合法/);
});

test("/wb/materials 契约存在，两类旧列表状态不再串台", () => {
  const source = fs.readFileSync(new URL("../src/workbench.js", import.meta.url), "utf8");
  assert.match(source, /path === "materials" && request\.method === "GET"/);
  assert.match(source, /inbox:\s*\{[\s\S]*?status:\s*r\.status/);
  assert.match(source, /drafts:\s*\{[\s\S]*?status:\s*r\.workflow_status \|\|/);
  for (const field of ["items", "counts", "total", "facets", "nextCursor"]) {
    assert.match(source, new RegExp(`${field}[,:]`), `统一列表必须返回 ${field}`);
  }
});
