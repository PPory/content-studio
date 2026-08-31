-- 词条层（本地 LLM Wiki）。
--
-- 库里在这条迁移之前**只会堆积，不会复利**：素材、知识卡、收藏各自成岛，
-- `entity_relations` 建好了但一行没有。新存一条不会让已存的更有用。
--
-- 让知识复利只有三个操作：**归并**（新事实落到已有词条上）、**矛盾**
-- （冲突被记录而不是被静默覆盖）、**连接**（两个原本无关的东西被链起来）。
-- 这条迁移建的是承载前两个的表；第三个复用 `entity_relations`，不新建表。
--
-- ⚠️ **事实是行，不是 markdown 里的一行文本。**
-- 参照的那套飞书实现把事实写成 `- 内容（来源：文件名）` 的 bullet，来源是字符串。
-- 字符串没法 join、没法 count、没法 diff——「找矛盾」就只能让模型读全库然后祈祷。
-- 存成行之后，矛盾候选是一句 SQL（同词条、不同来源、都还 active），
-- 数据库先把搜索空间缩到几条，AI 只判断这几条。这是 lint 在 50 个词条能用
-- 和在 2000 个词条还能用的区别。

CREATE TABLE entries (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  -- stance = 「我的主张」。Karpathy 原文是研究型 wiki，没有这一层；
  -- 但对内容创作者来说「我对 X 的立场是什么、说过几次、有没有自相矛盾」是刚需。
  -- 它的来源指向自己的稿件和发布记录，所以观点一致性和事实矛盾走同一套机制。
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('concept', 'product', 'method', 'person', 'work', 'stance')),
  definition TEXT NOT NULL DEFAULT '' CHECK (length(definition) <= 500),
  definition_source_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  -- 孤儿打点。**不硬拦**：批量入库时第一个词条无处可链，硬拦会死锁。
  -- 建立关系时清零，查孤儿队列走这一列。
  orphan_since TEXT
) STRICT;

CREATE UNIQUE INDEX entries_name_unique ON entries(name);
CREATE INDEX entries_kind_idx ON entries(entry_kind);
CREATE INDEX entries_orphan_idx ON entries(orphan_since) WHERE orphan_since IS NOT NULL;

CREATE TABLE entry_facts (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  statement TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 2000),
  -- ⚠️ NOT NULL 且 RESTRICT：**没有来源的事实进不来**，来源实体也不能被硬删掉
  -- 留下悬空事实。这是真实性硬闸在词条层的落点。
  source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  source_locator TEXT NOT NULL DEFAULT '' CHECK (length(source_locator) <= 200),
  -- 这条事实「在什么时间点为真」，不是写入时间。过期检测比的是它。
  asserted_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'disputed')),
  superseded_by TEXT REFERENCES entry_facts(id) ON DELETE SET NULL,
  conflicts_with TEXT REFERENCES entry_facts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- 新资料推翻旧论断 → superseded，指向那条新的；
  -- 两条都站得住又互相打架 → disputed，互指。**两种都不是删除。**
  CHECK (status <> 'superseded' OR superseded_by IS NOT NULL),
  CHECK (status <> 'disputed' OR conflicts_with IS NOT NULL),
  CHECK (status <> 'active' OR (superseded_by IS NULL AND conflicts_with IS NULL)),
  CHECK (id <> superseded_by),
  CHECK (id <> conflicts_with)
) STRICT;

-- 矛盾候选查询走这条：同一词条下还 active 的事实。
CREATE INDEX entry_facts_entry_idx ON entry_facts(entry_id, status);
-- 「这份资料贡献了哪些事实」——删除来源前要查，词条页要显示。
CREATE INDEX entry_facts_source_idx ON entry_facts(source_entity_id);
