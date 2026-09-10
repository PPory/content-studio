-- 「移除方向」需要一个可恢复的标记位。
--
-- ⚠️ intel_directions 不是 entity（id 没有 REFERENCES entities(id)），所以拿不到
-- 全库那套 entities.deleted_at 软删除。改成 entity 要回填已有行的 entity 记录，
-- 风险比这一列大得多；而这张表存的只是「你手动保存过的候选快照」，
-- 一个标记位就够——已带入选题的正文在 researches 里，不受影响。
--
-- 纯加列、有默认值、不改一行既有数据。
ALTER TABLE intel_directions ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0;
