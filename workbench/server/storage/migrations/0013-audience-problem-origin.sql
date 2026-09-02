-- 用户问题的「这是观察还是假设」维度。
--
-- 议程推导出来的问题不是观察到的，是创作者对受众的预测。它和「有人在评论里真的
-- 这么问了」是两类东西，必须一眼分得出来——不只在创建那一刻，而是永远。
--
-- ⚠️ **没有往 `source_kind` 加一个 `agenda` 取值，这是故意的。**
-- 一来 `audience_problems.source_kind` 和 `audience_problem_sources.source_kind` 都是
-- CHECK 约束，加值要重建表；而 migration 在 `db.transaction()` 里执行、`foreign_keys=ON`
-- 且事务内改不了这个 pragma，`DROP TABLE audience_problems` 会触发
-- `audience_problem_sources` 的 CASCADE 和 `content_opportunities` 的 RESTRICT。
-- 二来更重要：**在哪看到的**和**这是观察还是假设**本来就是两个正交维度。
-- 一条假设将来被真实观察证实时，补一条 source 行、把 origin 翻成 'observed' 就行，
-- 不需要换一个 source_kind——那样反而会把它原本的出处抹掉。
--
-- 已有数据由 DEFAULT 'observed' 落位：现存的问题都来自洞察提取或手动记录，
-- 它们确实是观察，不是假设。

ALTER TABLE audience_problems ADD COLUMN origin TEXT NOT NULL DEFAULT 'observed'
  CHECK (origin IN ('observed', 'hypothesis'));

ALTER TABLE audience_problems ADD COLUMN origin_agenda_id TEXT
  REFERENCES content_agendas(id) ON DELETE SET NULL;

CREATE INDEX audience_problems_origin_idx ON audience_problems(origin, updated_at DESC);
