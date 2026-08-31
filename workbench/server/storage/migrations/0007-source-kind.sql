-- 资料的「这是什么」维度。
--
-- ⚠️ **不要拿 `metadata_json.kind`（藏书 / 资料）当分类用。** 那两个值是**权限开关**：
-- 藏书正文只读，因为「改了它，从书里摘的引用就不可信了」。词条的每条事实都挂着一个
-- 来源实体，来源能被随手改写的话事实就不可验证——所以那一位必须继续只表达可写性。
--
-- 知识库要的是另一个维度：这份东西是一本书、一门课、一篇文档，还是我自己写的。
-- 它决定的是**怎么归置和怎么读**，和能不能改正文正交：一门课同样是只读的。
--
-- 书架因此成为知识库的一个子集（`source_kind = '书籍'`），而不是所有资料的容器。

ALTER TABLE books ADD COLUMN source_kind TEXT NOT NULL DEFAULT '书籍'
  CHECK (source_kind IN ('书籍', '课程', '文档', '文章'));

CREATE INDEX books_source_kind_idx ON books(source_kind);
