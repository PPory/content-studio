-- 内容项目阶段 2：明确母版、变体父稿和创作流程状态。
-- 全部是可审计的增量列，不重建 topics/drafts，避免历史发布数据和外键关系受损。

ALTER TABLE topics ADD COLUMN primary_draft_id TEXT;

ALTER TABLE drafts ADD COLUMN workflow_status TEXT NOT NULL DEFAULT '写作中'
  CHECK (workflow_status IN ('写作中','待诊断','待发布','已发布','已弃用'));
ALTER TABLE drafts ADD COLUMN parent_draft_id TEXT REFERENCES drafts(id) ON DELETE SET NULL;

-- 只有“单稿项目”可以无歧义地回填母版；多稿项目留空，交给用户确认，不按时间或标题猜。
UPDATE topics
SET primary_draft_id = (
  SELECT d.id FROM drafts d WHERE d.topic_id = topics.id LIMIT 1
)
WHERE 1 = (SELECT COUNT(*) FROM drafts d WHERE d.topic_id = topics.id);

-- 已发布是现有数据库里的确定事实，其余旧“待修改”安全落到写作中。
UPDATE drafts SET workflow_status = '已发布' WHERE status = '已发布';

CREATE INDEX IF NOT EXISTS idx_drafts_workflow ON drafts(workflow_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_drafts_parent ON drafts(parent_draft_id);
