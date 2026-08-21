-- 内容项目阶段 4：每个稿件保存自己的发布包，不把封面和平台差异塞进正文。

ALTER TABLE drafts ADD COLUMN cover_url TEXT NOT NULL DEFAULT '';
ALTER TABLE drafts ADD COLUMN cover_text TEXT NOT NULL DEFAULT '';
ALTER TABLE drafts ADD COLUMN cover_note TEXT NOT NULL DEFAULT '';
ALTER TABLE drafts ADD COLUMN keywords_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE drafts ADD COLUMN interaction_goal TEXT NOT NULL DEFAULT '';
