-- 学习闭环的核心对象：一次内容实验。
--
-- 现役复盘已经有依据 / 结论 / 下一篇实验，缺的是**事前假设**。
-- 没有假设，复盘只能描述发生了什么，答不了「我猜对了没有」——
-- 而「我更新了什么判断」正是从这个差额里长出来的。
--
-- ⚠️ **假设必须先于发布记录**，这是 CHECK 之外由领域层强制的一条：
-- 发布之后再补的「假设」是事后诸葛，它让整条闭环失去意义。
-- 所以 recorded_at 是必填，settle 时会拿它和发布时间比。
--
-- ⚠️ 不和 reviews 合并，也是故意的。reviews 挂在 publication 上、一篇一条，
-- 讲的是「这次发布表现如何」；实验挂在 project 上，讲的是
-- 「我这次想验证什么，验完学到了什么」。一个项目可以先记假设再决定发不发。

CREATE TABLE content_experiments (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hypothesis_markdown TEXT NOT NULL CHECK (length(hypothesis_markdown) BETWEEN 1 AND 4000),
  recorded_at TEXT NOT NULL,
  publication_id TEXT REFERENCES publication_records(id) ON DELETE SET NULL,
  outcome_markdown TEXT NOT NULL DEFAULT '' CHECK (length(outcome_markdown) <= 4000),
  learning_markdown TEXT NOT NULL DEFAULT '' CHECK (length(learning_markdown) <= 4000),
  verdict TEXT NOT NULL DEFAULT 'open' CHECK (verdict IN ('open', 'supported', 'mixed', 'refuted')),
  settled_at TEXT,
  CHECK ((verdict = 'open' AND settled_at IS NULL) OR (verdict <> 'open' AND settled_at IS NOT NULL)),
  -- 结算过的实验必须同时给出发生了什么和学到了什么，否则它只是个空壳
  CHECK (verdict = 'open' OR (length(trim(outcome_markdown)) > 0 AND length(trim(learning_markdown)) > 0))
) STRICT;

CREATE INDEX content_experiments_project_idx ON content_experiments(project_id, recorded_at DESC);
CREATE INDEX content_experiments_verdict_idx ON content_experiments(verdict, recorded_at DESC);
CREATE UNIQUE INDEX content_experiments_publication_unique
  ON content_experiments(publication_id) WHERE publication_id IS NOT NULL;

-- 复盘学到的东西回流成用户问题时，留下是从哪一次实验来的。
CREATE TABLE experiment_problem_links (
  experiment_id TEXT NOT NULL REFERENCES content_experiments(id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL REFERENCES audience_problems(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (experiment_id, problem_id)
) STRICT;

CREATE INDEX experiment_problem_links_problem_idx ON experiment_problem_links(problem_id);
