-- 哪些来源已经被提炼过。
--
-- ⚠️ **不能靠「这份来源有没有产出事实」来推断。** 一份资料完全可能读完之后
-- 一条事实都不值得留（目录页、致谢、纯代码清单），而那和「还没读过」是两件事——
-- 用产出反推的话，这类文档会在每一轮里被反复重读，钱一直烧。
--
-- 也不靠 `local_jobs` 的幂等键：任务记录是运维数据，会被清理和归档，
-- 而「这份资料读过了」是业务事实，必须活得和资料一样久。

CREATE TABLE source_ingests (
  source_entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'applied', 'empty', 'failed')),
  model TEXT NOT NULL DEFAULT '',
  candidate_id TEXT REFERENCES action_candidates(id) ON DELETE SET NULL,
  entries_proposed INTEGER NOT NULL DEFAULT 0 CHECK (entries_proposed >= 0),
  facts_proposed INTEGER NOT NULL DEFAULT 0 CHECK (facts_proposed >= 0),
  relations_proposed INTEGER NOT NULL DEFAULT 0 CHECK (relations_proposed >= 0),
  contradictions_found INTEGER NOT NULL DEFAULT 0 CHECK (contradictions_found >= 0),
  -- 模型给了、但服务端逐字校验没通过而被丢掉的条数。**这个数要留着**：
  -- 它是判断「这个模型能不能用」的唯一硬指标，比读几条产出凭感觉判断可靠。
  rejected_ungrounded INTEGER NOT NULL DEFAULT 0 CHECK (rejected_ungrounded >= 0),
  error TEXT NOT NULL DEFAULT '',
  run_at TEXT NOT NULL
) STRICT;

CREATE INDEX source_ingests_status_idx ON source_ingests(status, run_at);
