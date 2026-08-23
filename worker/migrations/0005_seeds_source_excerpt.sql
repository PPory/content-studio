-- 种子记下来源正文，让项目页右栏能就地读，而不是只给一个要跳出去的链接。
--
-- ⚠️ 两列缺一不可：
--   source_excerpt    抓到的正文（截断存）
--   source_fetched_at 抓过没有。**没有它的话，一篇永远抓不到的文章会在你每次
--                     打开项目页时重试一遍**——而公众号/知乎/小红书/抖音/B站
--                     本来就抓不到（要浏览器）。
--                     `fetched_at > 0 且 excerpt 为空` = 抓过、确实抓不到。
--
-- ⚠️ 没有动 source_kind 的 CHECK，也没有重建表：source_kind 是**只写不读**的
--    溯源字段，界面按 source_title / source_url 渲染，加新来源不需要动它。
ALTER TABLE seeds ADD COLUMN source_excerpt    TEXT    NOT NULL DEFAULT '';
ALTER TABLE seeds ADD COLUMN source_fetched_at INTEGER NOT NULL DEFAULT 0;
