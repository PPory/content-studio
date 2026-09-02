-- 一条用户问题可以从同一段原话里引用多句。
--
-- ⚠️ **这是一次真实故障的修复，不是整理。**
-- 一段群聊里有两句都在说同一个困惑，AI 把两句都取了出来——写库时撞主键
-- `(problem_id, source_kind, source_id)`，用户点了「保存为内容机会」，
-- 屏幕上弹出的是一句原样的 `UNIQUE constraint failed: audience_problem_sources...`。
-- 上一版的权宜之计是**丢掉第二句**：留下的证据仍然逐字为真，但一条问题
-- 到底有几句话撑着，是判断它有多硬的直接依据，丢掉就等于把证据变弱了。
--
-- 新主键把 `evidence_text` 也算进去：同一段原话里的不同句子各占一行，
-- 而一模一样的句子重复提交仍然会被主键挡掉——那种重复是错误，不是证据。
--
-- ⚠️ **为什么这张表可以重建，而 `audience_problems` 不行。**
-- 0013 记过：那张表被 `audience_problem_sources`（CASCADE）和
-- `content_opportunities`（RESTRICT）指着，migration 又跑在事务里、
-- `foreign_keys=ON` 且事务内改不了这个 pragma，`DROP TABLE` 会触发那些动作。
-- 而这张表是**叶子**：没有任何表引用它，删掉它不触发任何级联。
--
-- ⚠️ **但要先把读它的那个触发器摘掉。**
-- `ALTER TABLE ... RENAME TO` 会重新解析库里所有触发器以更新引用；
-- 那一刻旧表已经删了，`audience_raw_sources_cited_restrict` 的函数体里
-- 还写着它的名字，于是整条 migration 挂在
-- 「error in trigger …: no such table: main.audience_problem_sources」上。
-- 摘掉、重建完再原样建回来。

DROP TRIGGER audience_raw_sources_cited_restrict;

CREATE TABLE audience_problem_sources_next (
  problem_id TEXT NOT NULL REFERENCES audience_problems(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('hotspot', 'insight_report', 'social_post', 'comment', 'feedback', 'manual')),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 500),
  evidence_text TEXT NOT NULL CHECK (length(evidence_text) BETWEEN 1 AND 8000),
  observed_at TEXT NOT NULL,
  PRIMARY KEY (problem_id, source_kind, source_id, evidence_text)
) STRICT;

INSERT INTO audience_problem_sources_next(problem_id, source_kind, source_id, evidence_text, observed_at)
  SELECT problem_id, source_kind, source_id, evidence_text, observed_at FROM audience_problem_sources;

DROP TABLE audience_problem_sources;

ALTER TABLE audience_problem_sources_next RENAME TO audience_problem_sources;

CREATE INDEX audience_problem_sources_source_idx ON audience_problem_sources(source_kind, source_id);
-- 「这段原话被几条问题引用过」要走这个前缀查询，重建之后得把它加回来。
CREATE INDEX audience_problem_sources_problem_idx ON audience_problem_sources(problem_id);

-- 原样建回来：已经被引用的原始声音仍然不能删。
CREATE TRIGGER audience_raw_sources_cited_restrict
BEFORE DELETE ON audience_raw_sources
BEGIN
  SELECT RAISE(ABORT, '这段原始声音已经被用户问题引用为证据，不能删除')
  WHERE EXISTS (SELECT 1 FROM audience_problem_sources WHERE source_id = 'raw:' || OLD.id);
END;
