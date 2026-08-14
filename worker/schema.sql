-- content-pipeline 的 D1 结构。取代原来的 Notion 四库。
--
-- 三条贯穿全表的约定：
--
--  * **id 是 TEXT，两种格式共存。** 从 Notion 迁过来的行直接沿用它的 page UUID，
--    新建的行用 ULID（带时间前缀、可排序）。这样迁移不需要维护一张 id 映射表，
--    工作台和 vault frontmatter 里已经记下的任何 id 也都不会失效。
--  * **时间戳是 INTEGER（Unix 秒）**，不是 ISO 串。排序和区间查询都更快，展示时再格式化。
--  * **状态值保持中文**，因为它们要显示给人看；列名用英文，因为中文列名在 SQL 里
--    处处要加引号。CHECK 约束里的值必须和代码里的常量逐字一致——这正是 Notion 时代
--    「改个选项名代码就 400」那个坑的根治办法：这里对不上会在写入时立刻炸，而不是
--    在某个半年才走一次的分支里静默失败。

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 灵感库：Bot 收到的原始输入，初筛的入口
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbox (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,                    -- 原「一句话」
  kind          TEXT NOT NULL DEFAULT '想法'
                CHECK (kind IN ('文章链接','视频链接','想法','摘录')),
  link          TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT '',         -- 'Telegram' / '工作台·热点' 这类来源标记
  body          TEXT NOT NULL DEFAULT '',         -- 原始正文（摘录类才有）
  card_markdown TEXT NOT NULL DEFAULT '',         -- 初筛产出的素材卡
  status        TEXT NOT NULL DEFAULT '待初筛'
                CHECK (status IN ('待初筛','待选题','已选题','存档备用','已弃用','初筛失败/需人工')),
  value_judgment TEXT NOT NULL DEFAULT ''         -- 原「价值判断」，与 status 由同一个 value 推导
                CHECK (value_judgment IN ('','值得深挖','存档备用','建议弃用')),
  verdict       TEXT NOT NULL DEFAULT '',         -- 原「一句话判断」
  vault_path    TEXT,                             -- 阶段 2：归档后的 .md 路径
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 三个任务都是「按状态领一批」，这个索引是热路径
CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox(status, created_at);

-- ---------------------------------------------------------------------------
-- 素材库
-- ---------------------------------------------------------------------------
--
-- 类型集合是 triage.js（8 种）与 store.js（11 种）两份定义的并集。原来那两份不一致，
-- 表现是「延展问题」能被初筛写进去、却不在手工入库的白名单里。这里是唯一真源，
-- 代码侧的常量从这里抄，不要再各写一份。
CREATE TABLE IF NOT EXISTS materials (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,                    -- 原「素材」
  content       TEXT NOT NULL DEFAULT '',         -- 原「内容」
  type          TEXT NOT NULL DEFAULT '核心观点'
                CHECK (type IN (
                  '核心观点','金句/原话','数据/事实','案例/故事','框架/模型',
                  '反直觉点','个人经历','延展问题',
                  -- 以下三类由发布复盘自动产生，不要求手填
                  '标题样本','内容角度','平台反馈'
                )),
  source_url    TEXT NOT NULL DEFAULT '',         -- 原「出处」
  inbox_id      TEXT REFERENCES inbox(id) ON DELETE SET NULL,   -- 原「来源灵感」
  verification  TEXT NOT NULL DEFAULT '不适用'
                CHECK (verification IN ('不适用','待核验','已核验')),
  verification_note TEXT NOT NULL DEFAULT '',
  -- 发布复盘产出的素材（标题样本/内容角度/平台反馈）才有这三样，见 workbench.js
  -- 的 captureWinningFeedback：一篇稿子表现突出时，把「什么标题有效、什么角度有效」
  -- 沉淀回素材库，下次写作能直接用。
  draft_id      TEXT REFERENCES drafts(id) ON DELETE SET NULL,  -- 原「来源稿件」
  feedback_types TEXT NOT NULL DEFAULT '',        -- 原「反馈类型」多选，逗号分隔
  performance_basis TEXT NOT NULL DEFAULT '',     -- 原「表现依据」
  vault_path    TEXT,
  task_key      TEXT UNIQUE,                      -- 幂等，见下方说明
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_materials_inbox ON materials(inbox_id);
CREATE INDEX IF NOT EXISTS idx_materials_type ON materials(type, created_at);

-- ---------------------------------------------------------------------------
-- 标签：原来是 multi_select 字符串数组
-- ---------------------------------------------------------------------------
--
-- 拆成关联表的直接收益在 fetchSupplementary：原来要把同标签的 100 条候选整批拉回
-- Worker 再本地打分，现在一次 JOIN + GROUP BY 就能带着重合度排好序返回。
CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS material_tags (
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (material_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_material_tags_tag ON material_tags(tag_id);

CREATE TABLE IF NOT EXISTS inbox_tags (
  inbox_id TEXT NOT NULL REFERENCES inbox(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (inbox_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- 选题库
-- ---------------------------------------------------------------------------
--
-- `platform` 是**单值**，不是多选。draft.js 早就用 primaryPlatform 收敛成只写主平台了，
-- 让 schema 说实话——想写第二个平台就新建一个选题，比「勾三个只写第一个」诚实。
CREATE TABLE IF NOT EXISTS topics (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,                       -- 原「选题」
  viewpoint  TEXT NOT NULL DEFAULT '',            -- 原「核心观点」
  audience   TEXT NOT NULL DEFAULT '',            -- 原「目标读者」
  notes      TEXT NOT NULL DEFAULT '',            -- 原写在页面正文里的「写作要点」
  platform   TEXT NOT NULL DEFAULT ''
             CHECK (platform IN ('','公众号','X','小红书','视频号','YouTube')),
  priority   TEXT NOT NULL DEFAULT '中'
             CHECK (priority IN ('高','中','低')),
  status     TEXT NOT NULL DEFAULT '待写'
             CHECK (status IN ('待写','撰写中','已成稿','已发布','搁置')),
  draft_note TEXT NOT NULL DEFAULT '',            -- 成稿回执/失败提示，原来追加在选题正文里
  vault_path TEXT,
  task_key   TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status, created_at);

-- 选题 ↔ 素材：**只存真实引用**。标签检索来的补充候选不写这里——
-- 把「检索到过」和「真的用了」混为一谈，这张表就失去意义了。
CREATE TABLE IF NOT EXISTS topic_materials (
  topic_id    TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, material_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_materials_material ON topic_materials(material_id);

-- 选题 ↔ 来源灵感
CREATE TABLE IF NOT EXISTS topic_inbox (
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  inbox_id TEXT NOT NULL REFERENCES inbox(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, inbox_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_inbox_inbox ON topic_inbox(inbox_id);

-- ---------------------------------------------------------------------------
-- 稿件库
-- ---------------------------------------------------------------------------
--
-- `body` 在阶段 1 仍是正文真源；阶段 2 正文移进 Obsidian vault 之后，这一列只留作
-- 兜底副本，vault_path 成为权威。分两步是为了让阶段 1 的验收不依赖 GitHub 链路。
CREATE TABLE IF NOT EXISTS drafts (
  id         TEXT PRIMARY KEY,
  -- **可以为空**：Telegram 的 /推 是绕过「选题→撰写中→成稿」全流程的轻路径，
  -- 它产出的候选直接落稿件库，本来就没有对应选题。写成 NOT NULL 会让 /推 存不了。
  topic_id   TEXT REFERENCES topics(id) ON DELETE CASCADE,
  headline   TEXT NOT NULL,                       -- 原「标题」，LLM 起的
  summary    TEXT NOT NULL DEFAULT '',            -- 原「一句话摘要」
  body       TEXT NOT NULL DEFAULT '',
  platform   TEXT NOT NULL
             CHECK (platform IN ('公众号','X','小红书','视频号','YouTube')),
  status     TEXT NOT NULL DEFAULT '待修改'       -- 原「发布状态」
             CHECK (status IN ('待修改','已发布')),

  -- 发布复盘。工作台的「记录发布」一次写入这一整组，然后按 feedback_status
  -- 决定要不要把有效标题/角度沉淀回素材库。**状态不能靠 /wb/update 直接改成
  -- 「已发布」**，那条路被挡掉了，就是为了保证链接、时间、数据一起进来。
  published_url  TEXT NOT NULL DEFAULT '',
  published_at   TEXT NOT NULL DEFAULT '',        -- ISO 日期串，前端就是这么传的
  views      INTEGER,                             -- 五个指标都可空：没填 ≠ 0
  likes      INTEGER,
  comments   INTEGER,
  collects   INTEGER,
  shares     INTEGER,
  performance_summary TEXT NOT NULL DEFAULT '',
  feedback_status TEXT NOT NULL DEFAULT '未评估'
             CHECK (feedback_status IN ('未评估','样本不足','普通','表现突出','已沉淀')),

  vault_path TEXT,
  task_key   TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drafts_topic ON drafts(topic_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status, created_at);

-- ---------------------------------------------------------------------------
-- 评论（原 Notion 页面评论，工作台批注用）
-- ---------------------------------------------------------------------------
--
-- Notion 那边这是要单独开集成权限的能力，开不了就 403。自己存反而简单，
-- 而且不再受制于「批注只能挂在 Notion 页面上」。
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  entity     TEXT NOT NULL CHECK (entity IN ('inbox','materials','topics','drafts')),
  entity_id  TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity, entity_id, created_at);

-- ---------------------------------------------------------------------------
-- 任务幂等
-- ---------------------------------------------------------------------------
--
-- 取代原来「把『系统任务标识：xxx』写进页面正文、下次先读回正文查字符串」那套。
-- 那是被 Notion 没有唯一约束逼出来的，代价是任务标识污染了内容本身——用户在
-- Notion 里能看到这行系统噪音，导出的正文里也带着它。
--
-- 现在：业务行自己的 task_key 列负责「这行建过没有」（UNIQUE 约束顶住并发重复），
-- 这张表负责「这个副作用做过没有」（写正文、发通知这类没有对应业务行的动作）。
CREATE TABLE IF NOT EXISTS task_log (
  task_key  TEXT PRIMARY KEY,
  kind      TEXT NOT NULL,
  entity_id TEXT,
  done_at   INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- 关于全文检索：**故意没建 FTS5**
-- ---------------------------------------------------------------------------
--
-- 试过 `fts5(..., tokenize='trigram')`，实测不能用：trigram 对**少于 3 个字符的查询
-- 一律返回 0 命中**（'复利' 命中 0，'复利来' 命中 1）。而中文里最常用的检索词恰好
-- 就是两字词——复利、写作、杠杆、效率。SQLite 的默认分词器则根本切不开中文。
--
-- 更根本的是，补充料检索本来就不需要全文索引。原算法是拿**素材的标签**去匹配选题
-- 文本（`tags.filter(t => kwText.includes(t))`），用一张有限的标签词表绕开了中文分词
-- 这个问题——这是原设计里聪明的一步，SQL 化时应当保留而不是替换掉。
--
-- 需要模糊查正文的地方（工作台搜索）用 LIKE：这里是几千行的量级，全表扫是毫秒级。
-- 参照工作台 search.mjs 里那句「先量再优化」。真到了 LIKE 扛不住的那天，
-- 该上的也是向量检索（语义相关）而不是 FTS（字面匹配）。
