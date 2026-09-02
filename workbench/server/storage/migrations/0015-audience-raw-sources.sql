-- 现实世界原始用户声音的**不可变证据层**。
--
-- 用户真正的困惑不会先被整理成一条漂亮的 audience_problem，它先是一段群聊、
-- 一串评论、一条私信。这张表只保存那段原文，好让每一条 Audience Problem
-- 都能回到「谁真的这样说过」。
--
-- ⚠️ **它不是新的素材库，也不是新的一级管理对象。** materials 是可编辑的创作素材，
-- captures 是收藏箱（status 会被改），两者的正文都可以被改写——而证据一旦可改，
-- 「逐字定位」就不再证明任何事。这张表存在的唯一理由就是正文不会变。
--
-- ⚠️ **没有往 audience_problem_sources.source_kind 加新取值，这是故意的。**
-- 那是 STRICT 表上的 CHECK，加值要重建表；而 0013 已经记过为什么不能在
-- migration 事务里重建这条链上的表（foreign_keys=ON 且事务内改不了该 pragma，
-- DROP 会触发 CASCADE / RESTRICT）。
-- 这里改用仓库里已经在用的**来源前缀约定**（`insight:` / `agenda:` / `manual:` /
-- `experiment:`），原始声音的证据行写成 `source_id = 'raw:<id>'`。
-- 它比多一个枚举值更强：前缀能被解析回具体那条原文并**重新做一次逐字校验**，
-- 而一个枚举值只能说明「来自某种东西」。
--
-- 于是 audience_problems.source_kind 退化成一个粗粒度的旧列：真正的出处在证据行里。
-- 判断一条问题有没有真实证据，必须看证据行能不能解析回本表，
-- **不能只看 origin='observed'**——历史上手工录入的问题也是 observed。

CREATE TABLE audience_raw_sources (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('group_chat', 'comment', 'direct_message', 'interview', 'feedback', 'post', 'other')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 200000),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  source_name TEXT NOT NULL DEFAULT '' CHECK (length(source_name) <= 200),
  source_url TEXT NOT NULL DEFAULT '' CHECK (length(source_url) <= 2000),
  -- 这段话是什么时候被说出来的。用户没填就等于导入时间——**不猜**。
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  -- 最近一次被 Discovery 读过。让「只喂新导入和尚未分析的原文」可判定，
  -- 而不是每次重新扫描都把全部历史群聊再发一遍给模型。
  analyzed_at TEXT
) STRICT;

CREATE INDEX audience_raw_sources_ingested_idx ON audience_raw_sources(ingested_at DESC);
CREATE INDEX audience_raw_sources_analyzed_idx ON audience_raw_sources(analyzed_at, ingested_at DESC);
CREATE INDEX audience_raw_sources_hash_idx ON audience_raw_sources(content_sha256);

-- 不可变由**存储层**保证，不只由域层保证。
-- 域层不提供修改入口是一回事，「就算有人绕过域层也改不了」是另一回事——
-- 证据层要的是后者。录错了就新增一条，旧证据留在原地。
CREATE TRIGGER audience_raw_sources_immutable
BEFORE UPDATE OF kind, body, content_sha256, source_name, source_url, observed_at, ingested_at
ON audience_raw_sources
BEGIN
  SELECT RAISE(ABORT, '原始用户声音是不可变证据，不能修改；录错请新增一条');
END;

-- 已经被引用的证据不能删。audience_problem_sources.source_id 是自由文本，
-- 挂不了外键，所以这条 RESTRICT 由触发器承担。
CREATE TRIGGER audience_raw_sources_cited_restrict
BEFORE DELETE ON audience_raw_sources
BEGIN
  SELECT RAISE(ABORT, '这段原始声音已经被用户问题引用为证据，不能删除')
  WHERE EXISTS (SELECT 1 FROM audience_problem_sources WHERE source_id = 'raw:' || OLD.id);
END;
