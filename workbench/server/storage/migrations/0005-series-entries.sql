-- 合集条目重建。
--
-- 0004 的 `series_chapters` 是上一版「系列策划」的骨架：条目自带标题和摘要、
-- 可以没有文章（大纲里的空章节）、而且 `project_id` 上挂着一条**全局** UNIQUE。
-- 三条都和现在的产品语义相反：
--
--   1. 全局 UNIQUE 让一篇文章只能进一个合集，而且已归属的文章在选择器里**静默消失**；
--   2. 空章节这条分支没有任何界面能造出来，却让每一行多出「待开始 / 选择文章」的死路；
--   3. 条目标题和文章标题双写，改了文章标题合集里还是旧的。
--
-- ⚠️ `content_series` 上的 `audience` / `outcome` / `status` 三列**已退役**。
-- 它们各自挂着 column-level CHECK，SQLite 的 DROP COLUMN 会拒绝；而在 migration
-- 事务里重建带 FK 子表的父表不安全（`PRAGMA foreign_keys` 在事务内是 no-op）。
-- 所以留列不用。域层和 DTO 不再读写它们，**不要重新接线**。

CREATE TABLE series_entries (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES content_series(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('article', 'section')),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  heading TEXT NOT NULL DEFAULT '' CHECK (length(heading) <= 120),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  position INTEGER NOT NULL CHECK (position > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (series_id, position),
  CHECK (
    (kind = 'article' AND project_id IS NOT NULL AND heading = '')
    OR
    (kind = 'section' AND project_id IS NULL AND length(heading) > 0)
  )
) STRICT;

-- 同一合集里不重复；跨合集不限制——一篇文章可以同时属于多个合集。
CREATE UNIQUE INDEX series_entries_article_unique
  ON series_entries(series_id, project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX series_entries_series_idx ON series_entries(series_id, position);
CREATE INDEX series_entries_project_idx ON series_entries(project_id);

-- 迁移已有归类：只搬真的挂了文章的条目，空章节丢弃。
-- ⚠️ 必须重排 position：丢掉空章节会在序号里留洞，前端的「第 N 篇」会跳号。
INSERT INTO series_entries(id, series_id, kind, project_id, heading, note, position, created_at, updated_at)
SELECT
  id,
  series_id,
  'article',
  project_id,
  '',
  summary,
  ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY position),
  created_at,
  updated_at
FROM series_chapters
WHERE project_id IS NOT NULL;

DROP TABLE series_chapters;
