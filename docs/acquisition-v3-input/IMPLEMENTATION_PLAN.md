# Content Studio 情报采集 V3：Codex 执行方案

版本：1.0  
制定日期：2026-09-20  
交付类型：实施规格与验收要求，尚未修改项目代码或部署定时任务。  
本期目标：围绕已确定的信息来源，完成可持续运行、可追溯、可恢复的采集层，再衔接现有精选、选题和研究流程。

## 0. 给 Codex 的任务总说明

请在当前 Content Studio 本地仓库中执行本方案。先阅读仓库约定、当前代码和数据库迁移，再逐阶段实现。不要根据历史描述直接重建一套平行系统。

已确定的一级来源组只有四组：AIHOT、T2 媒体、社区、Follow Builders。Follow Builders 必须同步三个内容文件和一个状态文件，禁止仅接 X。Reddit 必须实现获准范围内的帖子与评论采集。

优先顺序：真实来源盘点 → 数据契约和持久化调度 → AIHOT 与 Follow Builders → 媒体和社区 → Reddit 评论 → 页面与现有流水线接入 → 故障测试与运行验收。

本方案中的默认频率、阈值和保留策略属于产品实施建议，均应配置化。只有官方文档明确写出的约束才作为外部协议要求。接口可用性、访问权限、内容使用权限和部署运行状态需要分别验证。

### 0.1 本次核查范围与可信度

- 已完整读取附件《T2媒体.xlsx》，共 14 条媒体配置；已完整读取《社区.xlsx》，共 26 条原始记录，内含重复来源、组合来源、获取方法和不同排序。
- 已通过 GitHub 读取 Follow Builders 的实际工作流、生成器相关段落和默认信源配置。生成器文件 blob SHA 为 `09183cea04f7fb69d699c6c79ef8c98f7566a495`，工作流 blob SHA 为 `7a1fa065c1aa964c834cb94e4bdbb8351ff355ea`。这是各文件的内容标识，不能作为整个仓库的 commit SHA 使用。
- 已核查 AIHOT 接入说明、Reddit Data API 官方文档及使用要求，参考资料见文末。
- 本次 Content Studio 只读连接返回 `SNAPSHOT_EXPIRED`，未返回可用的 `capturedAt`。因此没有验证当前数据库内容、线上运行健康或全部本地代码。
- 历史开发记录中的 V2 提交为 `b6f597b`，当时未推送远程。Codex 必须以本地实际分支和工作区为准，不回退到该提交、不覆盖其后的改动。
- 附带 `source-manifest.json` 是拟实施配置，尚未经过逐源联网验收。`source-inventory.original.json` 保留附件逐行内容、行号和文件哈希，防止清单整理时遗漏。

### 0.2 执行约束

1. 不默认购买 API、创建付费服务、修改生产凭据或部署新的云资源。
2. 不 fork Follow Builders，不运行其 `generate-feed.js`，不要求用户提供 X API 或播客转录服务密钥。仅消费上游已发布的文件。
3. 不自动安装整个 Follow Builders Skill、不复制其摘要与投递流程。项目内的采集器直接解析数据。
4. 不绕过付费墙、登录限制、验证码、访问审批或平台限流，不使用代理轮换掩盖身份。
5. 不删除现有来源、资料、精选、研究、收藏及引用关系，不自动重新启用用户关闭的信源。
6. 暂不重做精选算法、写作流程和整个页面架构。本期集中解决输入来源与采集可靠性。
7. API 凭据、网络或审批缺失时，将对应能力标记为阻塞，继续完成其他来源与隔离测试。不得把模拟响应当作真实接入成功。
8. 对已明确的产品范围直接实施；涉及额外付费、权限提升、不可逆迁移、公开分发内容时另行取得授权。

## 1. 先纠正会影响实现的几个边界

### 1.1 采集成功、内容完整、证据充分分别判断

AIHOT 的条目接口提供摘要、推荐信息和原文链接，不能据此宣称已经取得原文全文。T2 的 RSS 也可能只提供摘要。发现条目后先保存元数据，再由独立的正文任务补全。正文获取失败时保留链接和摘要，并明确标为 `summary_only` 或 `metadata_only`。[S1]

### 1.2 Follow Builders 上游状态不能替代本地状态

其 `state-feed.json` 记录上游已处理的 ID。当前生成器会在播客转录失败时也写入 `seenVideos`，并定期清理超过 7 天的状态。因此该文件可用于审计和缺口排查，但不能证明成功产出、不能恢复正文、不能直接用于跳过本地尚未导入的内容。[S3]

### 1.3 同一仓库版本允许各流更新时间不同

当前上游工作流允许单独运行 tweets、podcasts 或 blogs。四个文件必须固定到同一 commit SHA 读取，但三个 `generatedAt` 不必相同，也不能要求每次四个文件都发生变化。`state-feed.json` 本身未提供统一 `generatedAt`，应使用 commit、blob SHA 与实际抓取时间记录版本。[S2][S3]

### 1.4 多个发现入口不等于多个独立证据

同一篇媒体文章通过 AIHOT、RSS、Reddit 转贴进入系统，只增加发现路径和讨论信息，不能因此把独立证据数量加三。不同媒体讨论同一事件也不能只凭相似标题合并成同一原文。

### 1.5 Reddit 需要独立的授权与数据生命周期检查

采用获准的 Reddit Data API 与 OAuth。不要把未认证 `.json` 或 RSS 当成授权失败时的绕行方案。评论正文、作者信息、引用副本、索引和备份都必须支持删除同步。向外部模型发送 Reddit 内容的处理范围也必须与获准用途一致，不能仅以“没有训练模型”为依据认定允许。[S4][S5]

## 2. 来源范围与归一化清单

### 2.1 AIHOT：三条正式内容流

| 流 | 主要接口 | 内容定位 | 处理要求 |
| --- | --- | --- | --- |
| 精选 | `/api/v1/selected/snapshot`、`/api/v1/selected/changes` | 编辑筛选后的条目及摘要 | 首次快照，后续增量；新增、修改、撤选分别处理 |
| 热点 | `/api/v1/hot-topics` | 事件排名与热度信号 | 保存观察时间和上游指标；有需要时读取返回的事件 ID 对应详情 |
| 日报 | `/api/v1/dailies`、`/api/v1/dailies/latest`、`/api/v1/dailies/{date}` | 上游编辑报告 | 保存整份报告及内含引用；支持历史补采和修订 |

热点详情只使用上游返回的 `publicId` 请求 `/api/v1/stories/{publicId}`，不推测 ID。所有字段与分页参数以当次读取的 OpenAPI 为准。

AIHOT 使用边界：本方案用于个人或内部研究工作台。官方对于公开镜像、收费产品和其他商业分发有额外授权要求，实施时应检查实际用途，不自动将原始内容发布为镜像站。[S1][S8]

### 2.2 T2 媒体：保留附件全部 14 家

| 稳定配置键 | 来源 | 附件中的候选入口 |
| --- | --- | --- |
| `t2.techcrunch_ai` | TechCrunch AI | `https://techcrunch.com/category/artificial-intelligence/feed/` |
| `t2.the_verge_ai` | The Verge AI | `https://www.theverge.com/ai-artificial-intelligence/rss/index.xml` |
| `t2.the_decoder` | The Decoder | `https://the-decoder.com/feed/` |
| `t2.ars_technica` | Ars Technica | `https://feeds.arstechnica.com/arstechnica/index` |
| `t2.marktechpost` | MarkTechPost | `https://www.marktechpost.com/feed/` |
| `t2.mit_technology_review_ai` | MIT Technology Review AI | `https://www.technologyreview.com/topic/artificial-intelligence/feed/` |
| `t2.venturebeat_ai` | VentureBeat AI | `https://venturebeat.com/category/ai/feed/` |
| `t2.wired_ai` | Wired AI | `https://www.wired.com/feed/tag/ai/latest/rss` |
| `t2.last_week_in_ai` | Last Week in AI | `https://lastweekin.ai/feed/` |
| `t2.ithome` | IT之家 | `https://www.ithome.com/rss/` |
| `t2.jiqizhixin` | 机器之心 | `https://www.jiqizhixin.com/rss` |
| `t2.qbitai` | 量子位 | `https://www.qbitai.com/feed` |
| `t2.36kr` | 36氪 | `https://36kr.com/feed` |
| `t2.import_ai` | Import AI | `https://jack-clark.net/feed/` |

以上地址是待验证的配置输入，不能直接标成运行正常。导入时必须去除地址字段混入的中文说明、全角空格和多个地址，但保留原始字段供审计。

机器之心、36氪和 Import AI 等如发生迁址或入口变化，先检查官方当前入口、页面 `rel=alternate` 和文档。只有确认存在、可访问且允许使用的备用端点才进入配置。RSSHub、wechat2rss 都是待配置的可选服务，不能写一个占位地址就宣称有备用路径，也不能默认购买或部署它们。

媒体配置中的 `publisher` 必须是真实媒体身份；`rss`、`html`、`rsshub` 记录在 adapter/transport 字段。全站源可以先采元数据，再按关注配置安排正文补全；不以 AI 评分限制基础元数据采集。

### 2.3 社区：六个平台

**Hacker News**

保留首页、新帖关键词、热议三个逻辑方向。新帖关键词按 `AI`、`LLM`、`GPT`、`Claude` 拆开。附件中的 `hnrss.org` 应标为第三方 RSS 服务，不能标为 Hacker News 官方接口。可以使用核验后的 HN 官方 API 补充帖子信息，并在预算内读取 `kids` 评论树。HN 中文聚合入口保留为关闭状态的候选，避免默认重复采集。

**Reddit**

归一化后保留 11 个 subreddit：

`LocalLLaMA`、`MachineLearning`、`artificial`、`ClaudeAI`、`OpenAI`、`LocalLLM`、`ChatGPTCoding`、`AI_Agents`、`ArtificialInteligence`、`mcp`、`learnmachinelearning`。

`LocalLLaMA` 与 `LocalLLM` 分别保留。`ArtificialInteligence` 按附件原文保留，启用前验证真实社区名称及访问状态，不擅自按英语拼写修改。重复行合并，组合行拆开，每个结果保留原始行号。

RSS、JSON、`new`、`hot` 和评论排序属于获取方法或查询参数，不能都显示为不同 subreddit。正式主路径使用获准的 OAuth API，RSS 仅在明确允许并验证可用时作为同源替代发现入口。

**GitHub**

保留新仓发现，主题配置为 `llm`、`ai-agent`、`mcp`、`rag`、`generative-ai`。按时间窗口分页搜索，保存仓库 ID、首次发现时间、创建时间、最近推送时间及 stars/forks 的观察值。首次只有一个观察点时，不生成“增长速度”。分时间段处理搜索结果上限，并显示覆盖是否完整。

**arXiv**

保留 `cs.AI`、`cs.CL`、`cs.LG` 三个分类。首次先保存题名、作者、摘要、链接、arXiv ID 与版本号。跨分类以 arXiv ID 去重，版本独立记录。全文补全按关注和许可另建任务，禁止默认批量下载所有 PDF。

**Stack Overflow**

标签为 `openai`、`langchain`、`ollama`、`llm`、`chatgpt`，保留 `newest` 与 `votes` 两种观察方式。统一为一个平台适配器及多条查询配置，以 question ID 合并相同问题。阅读排名只算发现方式，不能当作问题真实性的证明。

**Dev.to**

开启标签方向 `ai`、`chatgpt`、`llm`。新增 `agents` 作为待验证可选标签，不自动猜测端点。全站 feed 作为关闭状态的候选保留。标签内容重复时按平台文章 ID 或规范原文地址合并。

### 2.4 Follow Builders：四个文件全部接入

上游仓库：`zarazhangrui/follow-builders`。

| 文件 | 角色 | 入库方式 |
| --- | --- | --- |
| `feed-x.json` | X 原帖及互动数据 | 每条 tweet 一份原始内容记录，保留作者、ID、原文、时间和引用关系 |
| `feed-blogs.json` | 官方博客文章 | 每篇文章一份原始内容记录，保留正文、原链接和发布日期 |
| `feed-podcasts.json` | 播客元数据与转录 | 每期节目一份父文档，完整保存上游实际提供的 transcript |
| `state-feed.json` | 上游去重及处理状态 | 保存在 connector 状态/批次快照层，不生成情报卡 |

同步上游 `config/default-sources.json` 作为版本化来源目录参考，禁止由目录变化自动启动新的直接付费抓取。此次核对配置有 26 个 X 账号、6 个播客和 2 个博客。这些数量表示配置范围，不能作为每期实际产出人数或内容数量。[S6]

上游当前每天 UTC 06:17 计划运行，允许手动执行单条流；计划触发时间不等于文件实际发布时间。[S2]

## 3. 当前系统先盘点，再接入

Codex 首先生成 `docs/intelligence-acquisition-audit.md`，每个发现都标出实际文件、导出函数、调用方和数据落点。

历史记录中可作为检索起点的路径包括：

```text
workbench/server/domain/intelligence.mjs
workbench/server/domain/intelligence-runner.mjs
workbench/server/domain/intelligence-channels.mjs
workbench/server/domain/intelligence-social.mjs
workbench/server/domain/intelligence-feed.mjs
workbench/server/domain/intelligence-editor.mjs
workbench/server/domain/intelligence-quality.mjs
workbench/server/domain/intelligence-evidence.mjs
workbench/server/domain/intelligence-source-meta.mjs
workbench/server/domain/intelligence-topics.mjs
workbench/server/routes/intelligence*.mjs
workbench/server/storage/migrations.mjs
workbench/server/storage/workspace.mjs
workbench/server/backup/workspace-backup.mjs
workbench/src/pages/Intelligence*.jsx
workbench/tests/intelligence*.mjs
```

同时在当前仓库中查找 `aihot`、`hot-collection`、`provider`、`acquisition`、`JobStore`、`scheduler`、`cron`、`insight`、`洞察`、`note-insights`、`SKILL.md` 和 Skill 注册入口。

盘点必须回答：

- 谁发起任务，谁真正发网络请求，是否有持久化队列和租约，窗口关闭时任务是否停止。
- `web`、`x`、`reddit`、`channels`、`aihot`、`local`、`manual` 分别表示平台、适配器还是内容来源。
- 旧 AIHOT 是否仍使用 `/api/public/*`；新版应依当前文档迁移至 v1。
- “洞察 Skill”究竟是采集入口、内容分析流程，还是独立脚本。未找到时记录搜索范围和结果，禁止编造调用链。
- 旧信源管理、旧热点收藏、手动记录、浏览器采集分别是否落入 `intel_sources`。
- 哪些功能已有可靠实现可复用，哪些只有枚举值、测试桩或按钮。

盘点过程只输出清单，不额外触发旧 Skill 的网络抓取，不安装未知依赖。新的采集层接入后，同一来源只保留一个生产调度责任方，避免新旧 runner 双重轮询。

## 4. 目标架构与职责

```text
信源目录与关注配置
        ↓
持久化调度器 / 手动同步 / 历史补采
        ↓
统一采集任务，按来源和认证主体限流
        ↓
AIHOT API │ RSS/Atom │ Reddit OAuth │ GitHub API │ Follow Builders 文件同步
        ↓
响应检查 → 原始快照 → 解析 → 标准化 → 身份去重 → 版本与发现关系
        ↓
原始资料库，允许只有元数据或摘要
        ↓
独立任务：正文补全 / 评论补采 / 删除复核 / 合法内容的分段索引
        ↓
现有情报整理、证据检查、精选与选题流程
```

基本要求：采集任务不依赖模型服务成功。模型不可用、预算为零或解读失败时，合法取得的内容仍可入库和阅读。AI 后处理单独有任务状态、失败重试和费用预算。

`intel_channels` 管理“持续从哪里取”，`intel_sources` 管理“具体取到了什么”。平台、发布者、发现路径、获取方式、内容形态分别建字段。

例如：

```json
{
  "sourceGroup": "follow_builders",
  "stream": "podcasts",
  "platform": "podcast",
  "publisherKey": "podcast:no-priors",
  "adapter": "follow_builders_feed",
  "sourceKind": "podcast_transcript",
  "externalId": "实际节目GUID",
  "discoveredVia": ["follow_builders"],
  "contentCompleteness": "provided_transcript"
}
```

`provided_transcript` 只描述实际收到转录文本，不能保证音频转录准确或覆盖全部节目。完整性需要另设缺失、异常短文本和 URL 精度检查。

## 5. 数据结构和幂等约束

以下是概念职责。Codex 必须先检查现有实现并复用；表名可按仓库规范调整，但交付时必须提供映射说明，不能缺少职责。

### 5.1 扩展现有 `intel_channels`

建议字段或等价配置：

`stable_key`、`source_group`、`stream`、`platform`、`publisher_key`、`adapter`、`endpoint`、`options_json`、`desired_enabled`、`enabled`、`validation_status`、`access_status`、`auth_ref`、`poll_policy_json`、`retention_policy_json`、`next_due_at`。

保留旧 `name/url/format/category/builtin` 字段的兼容读取。凭据仅通过 `auth_ref` 引用安全配置，不写入 data_json、前端接口或日志。

新清单的 `desiredEnabled=true` 表示期望纳入范围。实际 `enabled` 只在合法访问条件和端点校验通过后开启。用户此前关闭的来源保持关闭，清单升级不能覆盖用户的启停意图。

### 5.2 复用 JobStore，建立采集运行记录

优先使用已有持久化任务机制；若缺少可观察性，再新增 `acquisition_runs`。

必要信息：

`id`、`job_id`、`channel_id`、`job_kind`、`trigger`、`scheduled_slot`、`status`、`outcome`、`attempt`、`started_at`、`finished_at`、`lease_owner`、`lease_until`、`lease_generation`、`checkpoint_before`、`checkpoint_after`、`error_code`、`error_summary`、`stats_json`、`coverage_json`、`parser_version`。

状态采用 `queued/running/completed/failed/blocked/cancelled`。`completed` 的 outcome 分为 `success/partial/no_new/no_change`。是否需要重试通过 `next_retry_at` 或已有 JobStore 调度字段表达。

`scheduled_slot` 使用稳定 UTC 时间槽与任务种类构成唯一键，同一个来源和任务种类不能因多个窗口或进程重复创建。

### 5.3 采集检查点 `acquisition_checkpoints`

键为 `(channel_id, partition_key)`，其中 partition 可表达 Follow Builders 文件流、Reddit 排序流或正文补全任务。

存储上次成功消费的 cursor、已观察版本与已提交版本、etag、last_modified、最后应用的快照/commit、schema 版本。**网络响应成功后不能立即推进消费检查点；必须等本页结果持久化和本地事务提交。**

### 5.4 原始快照 `acquisition_snapshots`

存储 `(provider, upstream_version, artifact_path, payload_hash)` 唯一记录，以及请求元信息、HTTP 状态、响应类型、blob SHA、上游生成时间、原始载荷存储位置、访问与保留规则。

快照写临时文件、校验 hash 后原子重命名，再写数据库引用。网络下载不得占用长时间 SQLite 事务。重启后可清理无引用临时文件。

默认通用响应快照保留 30 天，受各来源授权和存储预算限制。**Reddit 不采用此通用期限，必须使用短保留及删除传播策略。** 有到期限制的内容不进入长期不可撤销备份。

### 5.5 扩展 `intel_sources`，保留现有引用

至少需要表达：

- 发布者与平台：`publisher_key/platform/source_kind/origin_kind`。
- 身份：`external_id/logical_document_key/canonical_url/original_url/source_url_precision`。
- 内容：`title/summary/body/content_hash/content_completeness/content_status`。
- 时间：`published_at/first_seen_at/last_seen_at/fetched_at/upstream_generated_at`。
- 版本：`revision_of_id/parser_version/payload_ref`。
- 讨论：`parent_item_id/root_item_id/platform_parent_id/platform_root_id`。
- 使用边界：`evidence_role/rights_status/retention_policy/expires_at/last_revalidated_at`。

数据库原有主键保持稳定，文章编辑生成新内容版本时保持旧版本引用可追溯。删除合规优先于保留旧正文，删除后的引用保留失效标记，不再展示被删文本。

媒体全文、播客转录、帖子、评论、日报分别设置内容类型。热点排名放在上游事件观察记录或既有 cluster 元信息中，不伪造一篇“原始新闻”。AIHOT 日报作为 `external_digest` 保存于原始资料层并保留报告结构；如需要出现在现有报告页，建立引用适配，避免混淆系统自产 `intel_reports`。

### 5.6 多路径发现与平台身份映射

新增或复用 `source_discoveries` 表达原文和渠道的多对多关系：

`source_id/channel_id/provider_item_id/first_seen_at/last_seen_at/upstream_item_url/metadata_json`。

如果一个逻辑文档对应多个平台记录 ID，需要可查询的 alias 映射。指标观察数据单独存时间序列或运行记录，不因分数变化创建新的全文版本。

规范化规则：

1. 平台内首先以稳定 ID 去重：Reddit fullname、X tweet ID、GitHub repository ID、arXiv ID、Stack Overflow question ID、播客 publisher + GUID。
2. 再使用经过验证的 canonical URL；只移除已知追踪参数，保留有语义的查询参数。
3. 内容 hash 用于检测正文版本与相同正文，不允许空文本、短模板、导航页参与跨来源合并。
4. 标题相似与同事件只用于建立 cluster 候选，不能单独触发文档合并。
5. 引文、评论、转推引用和被引用原帖各自保留身份与关系。多个评论即使正文相同也不合并成一条评论。
6. 来自多个渠道的同一文章保留全部发现关系，同时保持独立证据计数不膨胀。

### 5.7 长文与播客分段

保留上游实际提供的全文。建立带 `document_revision_id`、字符区间、段落顺序和可用时间戳的片段索引。片段以父文档 + 版本 + 区间幂等生成。

前端列表摘要可以截断；存储正文不能用列表的 600 字预览替代。全文分段不算多个独立来源，AI 输出的引用必须定位回父文档版本和原始片段。没有真实时间戳时只显示段落位置，不伪造音频时间。

## 6. 调度与故障恢复

### 6.1 运行模式

调度器必须有独立于网页、Vite 和浏览器标签的 headless 入口，优先复用项目已有 worker。提供 Windows 前台测试启动和任务计划程序配置说明，使用当前用户的最小权限，不未经确认安装系统服务。

本地电脑关机或休眠时不会继续采集。启动后执行补采。只有用户明确选择一直在线的机器并完成部署，才能宣称全天运行。禁止让网页内的 `setInterval` 承担正式后台任务。

调度按 UTC 持久化，按每个规则的 IANA 时区计算日历任务。AIHOT 日报和 Follow Builders 的产品展示可按 `Asia/Shanghai` 配置；用户界面显示自己的时区。不能把北京时间硬编码成系统所在时区。

### 6.2 默认策略

| 来源/任务 | 建议起始策略 | 说明 |
| --- | --- | --- |
| AIHOT 精选 | 每 30 分钟 | 首次快照后增量 |
| AIHOT 热点 | 每 30 分钟 | 保存每次观测，不伪造缺失历史曲线 |
| AIHOT 日报 | 上海时间 08:10 起检查；未发布则每 60 分钟重查，最多 4 次 | 仍未出现时显示待上游发布；次日补缺日期 |
| T2 高频媒体 | 每 60 分钟 | 配合条件请求与随机错峰 |
| T2 周刊/低频来源 | 每 6 小时 | 不因没有新文章报警 |
| HN、Reddit 帖子 | 每 60 分钟 | Reddit 仅在授权通过后运行 |
| Reddit 已入选线程 | 首次采集后约 6、24、48 小时复查 | 低活跃帖子停止常规跟踪，删除复核独立运行 |
| GitHub 新仓发现 | 每 6 小时 | 默认最近 7 天窗口、翻页与去重；补采按时间切片 |
| arXiv | 每 6 小时 | 首先元数据与摘要 |
| Stack Overflow、Dev.to | 每 2 小时 | 标签化发现 |
| Follow Builders | 每日上海时间 15:00 主同步 | 上游未更新或请求失败则每 60 分钟重查，最多 6 次；启动时检测缺失版本 |

这些频率是建议默认值，不构成来源发布承诺。条件请求尊重上游 Cache-Control、Retry-After、限流重置时间，不能靠添加随机参数绕过缓存。

### 6.3 通用请求策略

- 初始全局网络并发 4，同一主机并发 1，后续按实测调整。
- 标准请求 30 秒超时，单任务设置总时限、页面上限与字节上限；正文任务单独计时。
- 429 优先使用 Retry-After 或平台限流头；暂时性网络错误与 5xx 使用带随机抖动的指数退避。每个运行最多 3 次尝试，之后进入持久化重试，不无限等待。
- 401/403 分类为凭据、权限、审批或访问策略问题，停止自动高频重试。404 区分来源失效、内容删除和对象不可访问。
- 错误 HTML、验证码、登录页、JSON 错误对象，即使返回 200，也不能记录为成功解析。
- ETag 与 Last-Modified 按完整 URL、认证主体和请求表示隔离缓存，不跨源复用。
- 304 只表示传输对象未变。首次没有合法缓存时不能视为入库完成；解析器升级或上次应用失败时要继续处理缓存内容。
- HTTP 缓存和消费进度分别保存，避免收到新 ETag 后本地入库失败导致永远跳过该批。

### 6.4 持久化任务与事务要求

采用至少一次投递与幂等写入。通过租约、心跳及租约代次防止旧 worker 恢复后继续提交过期结果。取消请求必须传播至网络请求和子任务。

租约过期任务能够回收；进程中断不能把任务永远留在 running。停机重启后按来源合并错过的调度槽，创建可续传的 catch-up 任务，禁止补跑几百次相同的首页请求。

失败来源不阻止其他来源运行。失败正文不阻止已发现元数据入库。触及页数/条数预算必须保存 continuation 并显示 `partial`，禁止把截断当作完整采集。

### 6.5 健康指标

分开记录：`last_checked_at`、`last_transport_success_at`、`last_ingest_success_at`、`last_content_change_at`、`upstream_generated_at`、`last_complete_checkpoint`。

Follow Builders 可初始设置 36 小时为过期提醒、60 小时为严重过期，分别对三条内容流计算。对没有 generatedAt 的上游状态文件使用版本信息，并明确时间含义。低频媒体的健康依靠访问和解析成功率判断，不能按最新文章年龄一刀切。

运行结果必须显示发现数、解析数、新增数、更新数、重复数、仅摘要数、正文失败数、跳过数、删除数、未解析数和覆盖边界。真实 token 或费用未提供时留空，不估造金额。## 7. AIHOT 适配器实施细则

### 7.1 首次精选快照

1. 读取当前 OpenAPI 合同并验证 schema，使用 snapshot 接口分页。
2. 保存第一页返回的同步水位与分页信息，在快照完成前保留 bootstrap 状态。
3. 逐页幂等保存条目及发现关系，标明获取的是摘要还是正文。
4. 所有页面完成后再切换为正常增量模式；随后从该快照水位调用 changes，补上同步期间的变更。
5. 中途失败只重试未完成页面。不能因为一页没拿到就把未出现的旧条目标为撤选。

### 7.2 精选增量

逐页获取变化，在同一数据库事务中应用该页变化并提交新的消费 cursor。新增创建记录，修改保留版本或更新可变元数据，撤选更新 AIHOT 精选成员状态。

撤选只说明上游不再推荐，不等同于原文被删除，不应删除自己的收藏或其他来源关系。真正的内容删除另按来源协议和权利要求处理。

收到 `409 snapshot_required` 后进入重建快照流程，保留已有资料与引用。旧 `/api/public/*` 的 cursor 和 ETag 不带入 v1。请求参数只采用当前 OpenAPI 声明的参数。[S1]

### 7.3 热点

每次保存上游事件 ID、榜单位置、上游提供的指标、观测时间和关联条目。不要假设固定存在 `heat`、`sourceCount` 等字段，字段映射来自真实响应。

优先补全发生变化的热点详情，初始上限每轮 10 个事件，重复事件依据 ID 和更新时间跳过。与本地原文关联时使用实际原文链接或稳定 ID。上游 AI 综述标为 `upstream_synthesis`，不作为独立原始事实来源。

### 7.4 日报

日报日期采用上游规定的上海日历日期，保存 `report` 本体、发布日期、源站链接、内容 hash、上游归属及内部引用列表。首次默认补取可用的最近 7 天，后续按日期索引发现缺口。

相同日期内容修订后保存新版本。整份日报保存为一个上游报告文档；其中条目可以创建外部引用或补全任务，但不能仅按每段文字复制成新的独立新闻。

日报尚未发布时显示 `awaiting_upstream`，不要写成采集故障或伪造当天报告。下一次运行仍可补缺，不能只尝试一次后永远跳过。

## 8. Follow Builders 适配器实施细则

### 8.1 固定版本读取

主流程：

```text
确定当前 main 对应的 commit SHA
        ↓
列出从上次完成版本到当前版本之间涉及四个文件的变更提交
        ↓
按时间顺序处理各个需要导入的版本
        ↓
固定 commit SHA 读取四个 JSON
        ↓
校验结构、保存四份原始快照和每份 blob SHA
        ↓
导入 X、博客、播客；保存上游状态副本
        ↓
原子提交本批次本地结果与完整检查点
```

读取内容使用固定 commit 的文件接口或 raw URL，例如：

```text
https://raw.githubusercontent.com/zarazhangrui/follow-builders/{commitSha}/feed-x.json
https://raw.githubusercontent.com/zarazhangrui/follow-builders/{commitSha}/feed-blogs.json
https://raw.githubusercontent.com/zarazhangrui/follow-builders/{commitSha}/feed-podcasts.json
https://raw.githubusercontent.com/zarazhangrui/follow-builders/{commitSha}/state-feed.json
```

所有地址必须在同一已确定的 commit 下解析。不要依次读取会移动的 `main` 后，仅比较文件时间来判断一致性。

同一 blob 已在本地验证保存时可复用，无需重复下载。单文件下载失败可重试该文件，其他已下载文件保留在暂存区。四个文件未完成合法读取及结构检查前，不推进整批完成检查点；后续版本也不能默默越过这个缺口。无法修复时登记明确的 gap/隔离记录并在 UI 展示，继续其他 provider 的工作。

### 8.2 每条内容流分别判断状态

- 正常空数组且没有上游错误：`no_new`。
- HTTP 304 或 blob 不变：`no_change`；不代表上游今天已发布新一期。
- `errors` 非空且仍有有效内容：可导入有效内容，整流记为 `upstream_partial`。
- 空数组且有上游错误：标记上游失败或部分失败，不伪装成无内容。
- JSON 无效、schema 不兼容：保存可审计的错误，暂停该版本入库，保留上次可用结果。
- 单流更新模式下，其他流仍是旧版本属于允许状态；分别显示更新时间。

健康不能仅根据仓库最新 commit 时间判断，否则只更新文档也会被误认成新内容。使用对应文件的变化、各流 generatedAt 与 errors 共同判断。

### 8.3 上游状态文件的正确用法

完整保存 `seenTweets`、`seenVideos`、`seenArticles` 及未知扩展字段的原始副本；可提取计数与 hash 供诊断。

本地另维护 `imported_items` 或等价唯一约束，只在本地实际成功入库后写入。不能将上游 seen 集合灌入本地 imported 集合，也不能因上游状态清理而删除本地合法保留的资料。

`seenVideos` 出现但本地没有对应 transcript，只表示存在需要调查的差异。当前生成器的失败标记行为意味着差异未必是本地漏采。[S3]

### 8.4 历史版本补采

上游三个 feed 是每轮生成并覆盖的结果，不能当作完整历史集合。电脑离线数日后仅读取最新文件可能漏掉中间已发布内容。[S3]

必须实现：

- 每次首次导入默认回放最近 7 天可获取的相关文件版本，生成明确的覆盖起点。
- 之后依据本地最后完成的 commit 和变更历史补齐错过版本。
- 使用 GitHub commit 历史时按四个路径收集变更并去重提交，支持分页；不能只看仓库最近几个 commit。
- 默认一次补采任务最多处理 30 天和可配置的提交/字节预算。超预算保存 continuation，后续继续，不直接丢弃更早缺口。
- 分支被改写、历史不可获取或 API 额度不足时显示实际缺口，不宣称完整。
- 上游从未发布、已在上游筛掉或转录失败的内容无法通过历史回放补出。界面完整性表述限定为“已同步上游可取得的版本”。

### 8.5 X、博客和播客标准化

X 使用 tweet ID；保留原文、创建时间、作者归属及上游提供的互动指标、引用 ID。引用目标未出现在 feed 时记录外部引用与缺失上下文，不自动调用付费 X API 补全。

博客按规范原文地址识别。同一博客经 T1、AIHOT 或其他源重复发现时，只增加发现关系，不重复生成全文。

播客必须以 `publisherKey + guid` 识别。当前生成器在无法定位某一期视频时可能使用频道 URL，因此禁止用 YouTube 频道 URL 作为每期节目唯一键。[S3]

保存上游 transcript 全文及结构，不再默认调用外部转录服务。超长内容分段索引，保留 speaker 和实际存在的时间信息。抽取的结论需要保留“嘉宾观点/自述/实验描述”的归属，不能自动转成已验证事实。

### 8.6 费用边界

消费上游公开 JSON 的链路不调用 X 或转录服务 API，不要求对应付费密钥。GitHub 访问、网络、存储与自身模型推理仍按实际环境计费或消耗额度，不能把整个系统标为零成本。

公共 GitHub 接口遇到配额限制时退避；可使用用户已批准的只读 token 提高可用额度，但不得索要写权限，不得自动创建收费资源。严禁为了补采而运行上游生成器。

## 9. Reddit 帖子与评论采集

### 9.1 启用前检查

读取当前平台审批和用途要求，确认应用、OAuth、User-Agent、授权范围及数据处理用途。缺少许可时设置 `needs_approval`，缺少凭据时设置 `needs_credentials`。

本期只读，不需要发帖、回复、投票、私信或管理社区权限。不使用浏览器抓取或匿名 `.json` 绕过 Data API 的访问控制。外部 AI 处理默认禁用，待实际获准用途与第三方处理条件核实后再开放。[S4][S5]

### 9.2 帖子发现

按所列 subreddit 使用 `new` 补充新帖，使用 `hot` 观察活跃讨论。两种发现方式合并在同一 subreddit 配置下，按帖子 fullname 去重。帖子正文、作者归属、时间、score、num_comments 和可用的链接分别保存。

默认发现最近 48 小时的帖子，使用重叠时间窗口和稳定 ID 减少边界漏收。分页时间水位与平台返回游标按真实能力处理，不把热榜排序当稳定时间序列。补采能力受平台窗口限制，覆盖不完整时明确记录。

### 9.3 选择值得采评论的帖子

初始采用可解释规则，避免每个帖子的正文都要调用模型：

- 用户手动标记或已关联研究的帖子优先。
- 与关注词、问题词、工具名单相关，或正文/评论数存在新的变化。
- 热度、评论增长、已知关注作者和多个发现路径作为辅助因素。
- 为低分的新问题与反例保留探索配额，不能只选高赞帖。

初始每小时全局最多选 20 个新线程，可按预算调节；不要求每个 subreddit 都凑满。评分只影响采集优先级，不作为真实性判断。

### 9.4 评论树读取与采样

官方评论接口返回评论树，截断节点可能是 `more`，需要通过 `morechildren` 展开。`morechildren` 不采用普通 after 分页；按官方文档要求保持该接口请求串行。[S7]

常规线程目标：`top` 或 `confidence` 取一个排序方向，目标 20 条；`controversial` 目标 10 条；`new` 目标 10 条。按 comment ID 合并，常规最多 40 条候选评论，深度目标 3 层；为理解回复可额外补最多 20 条祖先上下文。

高优先级线程最多 100 条总评论，包含上下文，深度目标 5 层。每轮最多 3 次排序树请求，常规最多 2 次 morechildren，高优先级最多 5 次，均受全局预算限制。

以上数量是本地采样上限和目标，服务端 `limit` 不保证恰好返回指定数量的顶层评论。内容不足时保留实际数量，不调用其他接口凑数。去重、祖先补齐和请求次数必须计入预算。

全局默认 Reddit 请求预算先设为 20 次/分钟并遵守实际响应限流头；这只是保守客户端参数，不能视为已获免费额度或访问许可。[S4]

每次保存：

`sort_buckets`、`comments_seen`、`comments_saved`、`depth_reached`、`more_children_pending`、`request_count`、`coverage=sampled|partial|complete`、`next_recheck_at`。

只有真正展开完全部已知树且无缺口时才允许写 `complete`。通常显示“已采样若干条评论”，不能写“已获取完整评论区”。

### 9.5 评论结构

保留 Reddit 原始 `t1_`、`t3_` fullname 以及映射后的本地主外键：

```text
post P
  parent = null
  root = P
  comment A
    parent = P
    root = P
    reply A1
      parent = A
      root = P
```

同一评论从多个排序结果出现时只存一份内容，但记录全部排序来源。祖先尚未取得时保留明确占位关系和平台 ID，等待补全；不能把回复错误挂到帖子顶层。

字段至少包括：comment ID、post ID、parent ID、正文、可用作者名、创建时间、编辑时间或标记、score、permalink、深度、作者是否楼主、删除状态、抓取时间、排序来源、保留期限。不存在的字段用 null 或省略，禁止推测。

评论编辑更新版本，互动分数更新只写观察记录。上游隐藏分数或分数不稳定时标明未知/观察值，不据此判定准确支持人数。

### 9.6 评论筛选与对后续流程的贡献

自动识别候选价值：实测条件、复现步骤、反例、报错与限制、替代方案、用户需求、官方回复和外链。允许短评论有价值，例如附上最小复现仓库的回复；不要只按字数删除。

保留观点分歧及上文。争议排序可以提供不同视角，不能自动标成正确反例。高赞也不能自动标成社区共识。

默认 `evidence_role=community_observation`。同一帖子中的多个评论不增加“独立外部文档证据”计数。评论附带论文、官方文档、仓库时，可安排有限的外链补全任务，另建来源记录并保留 `linked_from` 关系。

读取外链时每个线程初始最多 5 个、仅一跳，经过地址安全检查和域名/类型规则，不递归爬整个站。

### 9.7 编辑、删除与保留期限

Reddit 规则要求清理已从平台删除的用户内容和被删除账户的识别信息。其 API Wiki 强烈建议在 48 小时内常规清理存储的用户数据；这项建议不能解释为可以永久保留内容的授权。[S4]

实施默认值：Reddit 原始响应与正文采用短期可删除缓存，最长 48 小时；持续需要的记录按获准规则重新获取/复核，重新取得有效内容后替换当前副本。没有额外授权时不做永久原文归档，旧版本同样受期限约束。清理任务独立于 AI 与热点跟踪运行。

平台明确删除的内容，必须删除正文、标题、相关原文摘录、分段缓存、全文索引、向量索引以及系统保存的可恢复副本；依赖这些内容的解读和研究引用应撤销引用、清理相应摘录并提示失效。用户独立创作的内容不能被无差别清空，应依来源依赖关系精确处理。

账号删除与评论删除分别判断。作者信息被删除但评论仍公开时，按规则清除作者标识，不擅自宣称评论正文也已删除。网络失败、403 或一次缺失响应不能直接当作确认删除，应隐藏不再可验证的内容并进入复核/到期清理。

备份默认排除受限正文；保留无正文的清理记录，恢复备份后先执行删除与到期校验，再允许索引和展示。禁止从老备份、旧快照或上游 seen 列表复活已删除内容。

## 10. 媒体与其他社区适配器要求

统一 RSS/Atom 解析器支持 RSS 2.0、Atom、命名空间、相对链接、HTML 实体、content:encoded、缺失日期和异常条目隔离。正确区分 feed 摘要与正文，不将导航、Cookie 提示或反爬页面当文章。

原始发现不强制满篇正文；后续为相关条目补全可取得的原文，404/付费墙/无授权情况显示原因。备用获取器只有在明确配置及获准时启用，且保留真正的中转渠道身份。

GitHub 的多查询、HN 的多榜单、Stack Overflow 的多排序都保留观察关系，禁止按查询次数累加来源数量。arXiv 多分类重复也采用相同原则。

HN 评论可以复用树存储与采样规范，通过已验证的 HN 官方 API 在预算内补充；不臆造 API 未提供的评论点赞分数。Reddit 的认证、删除规则和更多评论协议不得原封不动套用到其他平台。

## 11. 页面与现有情报流程接入

### 11.1 信源管理

主界面按四组显示，展开后显示具体媒体、社区、Follow Builders 的三条内容流。上游状态文件出现在高级诊断区，仍显示最近同步状态。

每条来源显示：期望启用/实际启用、获取方式、权限状态、最近检查、最近成功入库、上游更新时间、下次运行、本次新增与重复、正文完整度、错误原因、覆盖边界。

提供启停、立即同步、重试失败任务、补采区间、查看最近运行、测试端点。测试请求本身不应自动启用其他来源或修改凭据。

### 11.2 处理记录

区分采集、正文补全、评论采样、AI 整理四类运行，不再用同一个“生成失败”掩盖不同问题。HTTP 成功而解析失败、摘要成功而正文失败、源站没有发布、访问未获批准，分别显示。

### 11.3 资料页面

新增按 source group、平台、发布者、内容形态、全文/摘要、发布时间和采集时间筛选。支持阅读完整转录、上游日报及评论树。列表短摘要不能覆盖原始正文。

Reddit 阅读需显示采样范围、父帖、上下文、采样时间、上游地址及适用保留限制。过期或已删除内容展示状态，不再展示已清除的文本。

### 11.4 现有精选流水线

将“获取资料”和“生成精选”解耦。默认只自动采集，自动调用模型生成精选作为独立可配置能力，沿用既有模型权限与预算控制。

原文入库后可被现有 intelligence editor 使用。评论提供用户观察和研究线索；上游日报、AIHOT 摘要、上游 AI 综述明确标为二次整理。现有独立证据计数、引用逐字核验及范围检查继续保留。

不得让上游排名或多入口命中直接绕过质量门槛。使用新原文、转录或评论创建研究时，保留来源、版本、片段、上下文和表达限制。

### 11.5 旧入口与旧来源

保留旧深链、热点收藏、手动记录及资料带入研究。原 28 个内置信源逐项映射，重复来源使用别名映射或共享底层采集，不删除旧 ID。

本期清单之外的已有 T1 官方来源可以保留并沿用用户启停状态；不要为了形成四组清单而删除它们，也不要自动开启额外抓取。界面可放在“现有其他来源”兼容区。

## 12. 安全、隐私与内容处理

网络层对 feed 内的原文 URL、播客 URL、评论外链和重定向逐跳检查。仅允许 http/https，拦截内网、loopback、link-local、云元数据地址、私有 IPv4/IPv6 及 DNS 重绑定风险。对于本地配置的合法内部服务需要单独白名单，默认禁止外部内容指定内网目标。

限制响应大小、解压后大小、重定向次数、XML 深度和解析时间。关闭 XML 外部实体。HTML 阅读前清理脚本与危险链接，前端禁止未净化的富文本执行。

所有源文均是不可信数据。AI 提示词中明确隔离外部文本，禁止正文中的指令改变凭据、工具权限、自动发布、抓取范围或系统配置。

日志不含令牌、完整 Authorization 头或敏感 query。外部文章正文不进入错误日志。不能从 source 响应推导出新的任意域名授权。

对内容使用范围有约束的来源记录 `rights_status`，AI 处理、公开展示与导出分别受控。公开提供 feed 或开源脚本不自动授予转载其中全部第三方原文的许可。

## 13. 建议模块与接口

以下是实现职责示例，不要求在已有同等模块之外机械新增文件。

```text
server/domain/acquisition/
  registry.mjs
  runner.mjs
  scheduler.mjs
  checkpoints.mjs
  snapshots.mjs
  normalize.mjs
  identity.mjs
  policy.mjs
  retention.mjs
  connectors/
    aihot.mjs
    rss.mjs
    reddit.mjs
    github.mjs
    follow-builders.mjs
server/routes/acquisition.mjs
scripts/acquisition-worker.mjs
scripts/acquisition-doctor.mjs
scripts/acquisition-backfill.mjs
```

适配器统一返回可持久化的结果；所有网络访问经过公共传输层。

```ts
interface AcquisitionResult {
  items: NormalizedItem[];
  observations: SourceObservation[];
  upstreamState?: Record<string, unknown>;
  proposedCheckpoint: Record<string, unknown>;
  continuation?: Record<string, unknown>;
  outcome: 'success' | 'partial' | 'no_new' | 'no_change';
  coverage: Record<string, unknown>;
  warnings: string[];
}

interface Connector {
  validate(config: SourceConfig, context: Context): Promise<ValidationResult>;
  collect(config: SourceConfig, checkpoint: Checkpoint, context: Context): Promise<AcquisitionResult>;
}
```

`context` 至少包含安全 fetch、AbortSignal、预算、时钟、访问策略和结构化日志。接收结果后由统一 runner 控制事务、去重、任务重试和检查点提交。不要允许每个 connector 各自发明重试、SQL 和定时逻辑。

`proposedCheckpoint` 在入库前只是一项建议；connector 不能自行持久化已消费水位。对复杂正文与评论任务复用相同协议或已有任务接口。

## 14. 分阶段执行与阶段交付

### P0：审计与合同核验

完成实际调用链、旧 Skill、旧 provider、数据库结构与 scheduler 盘点。逐行导入附件，检查媒体地址和社区名字。读取 AIHOT OpenAPI 和 Follow Builders 当次结构。

交付 `intelligence-acquisition-audit.md`、`source-validation.json`，其中每个来源有 `checkedAt`、验证环境、HTTP/结构结果、权限状态、缺失项和原始行号。读不到源码的部分明确写出，不能凭上一张概念图当作真实架构。

### P1：持久化基础与最小迁移

复用 JobStore，完成来源配置、运行记录、检查点、快照、发现关系和必要索引。实现 worker、取消、租约回收、限流、退避与安全传输。

迁移编号根据当前仓库最大版本递增。新增结构向后兼容，先验证备份，再在隔离数据库迁移测试，不先改用户真实数据。

### P2：AIHOT 与 Follow Builders

AIHOT 三路全部实现。Follow Builders 四文件、同 commit 同步、空数组/上游错误判断、全量文本保存、历史补采全部实现。

此阶段不接入额外模型流程，不调用 X 或转录 API。用真实只读请求做少量烟测，并保存仅包含必要信息的测试报告。

### P3：T2 与社区基础采集

14 家媒体全部进入目录，逐源验证后开启可用者。实现 HN、GitHub、arXiv、Stack Overflow、Dev.to 的规定查询。Reddit 获权后启用帖子发现，未获权则保留阻塞状态与模拟合同测试。

所有失效或未获批准来源必须出现在问题清单，不能通过删除配置来让验收“全绿”。

### P4：Reddit 评论与生命周期

完成三种排序采样、morechildren、父子结构、上下文补齐、去重、编辑复核、限流、删除传播与短期保留。把评论作为资料和线索接入现有研究。

真实权限尚未具备时，这一阶段可完成离线开发与测试，但发布说明必须标为未完成真实接入验收。HN 评论可在相同阶段实现有限采样，不扩大为全站抓取。

### P5：前端和旧流程兼容

交付四组来源管理、采集处理记录、资料全文与评论阅读。打通旧精选/研究/收藏引用，验证没有并行新旧抓取。

更新备份基线判断：未修改的内置目录可以继续作为空工作区基线；用户修改的来源、运行记录与采集历史必须受覆盖保护。受限原文不能被备份重新恢复成可见内容。

### P6：验收与交付

完成单元、集成、故障注入、真实接口烟测和 UI 回归。提供本地运行命令、Windows 持续运行配置步骤、启动补采与停用说明。

连续运行验收应由实际部署环境记录，目标是经过完整 7 天观察窗口。Codex 当前会话无法完成的长期观察要交付验收脚本与尚未完成项，不能写成已经通过。

每个阶段保留清晰的变更清单与测试结果。按仓库约定提交代码；不自动 push，不修改不相关工作区改动。缺少权限仅阻塞对应来源，不阻塞其他阶段开发。

## 15. 必须通过的验收用例

| 编号 | 场景 | 合格结果 |
| --- | --- | --- |
| A01 | 同一批资料连续运行两次 | 不新增重复原文；可以更新观察时间与指标 |
| A02 | 同文来自 AIHOT、媒体 RSS 和社区链接 | 一份逻辑原文、多条发现关系；证据数不虚增 |
| A03 | 两家媒体报道同一事件 | 各自原文保留，仅建立事件关联 |
| A04 | 两条不同评论正文相同 | 按平台 ID 保留两条评论与各自父子关系 |
| A05 | 入库事务中断、进程重启 | 消费 cursor 未越过未提交内容，可幂等恢复 |
| A06 | 多 worker 同时领取同一任务 | 仅一个有效租约；旧代次不能提交 |
| A07 | 请求 429、5xx、超时 | 按预算退避；其他来源继续运行 |
| A08 | 请求 401/403 | 标为授权或访问问题；不切换匿名路径绕行 |
| A09 | 返回 200 登录页、验证码或损坏 XML | 判为失败/部分失败，不误记正常 |
| A10 | 304 但上次入库失败 | 从有效缓存继续应用；不因 ETag 跳过 |
| A11 | 超过页数、评论或字节预算 | 明示 partial 和 continuation，不静默漏数 |
| H01 | AIHOT 首次快照多页、分页中断 | 可恢复，快照未完成不切换正式水位 |
| H02 | 精选新增、修改、撤选 | 分别处理；撤选不删除本地收藏 |
| H03 | AIHOT 返回 snapshot_required | 重建快照，已有引用仍完整 |
| H04 | 日报当天未发布或历史有缺口 | 显示待上游/补缺日期，不伪造报告 |
| H05 | AIHOT 仅有摘要 | 内容完整度准确，正文任务单独跟踪 |
| F01 | Follow Builders 同步 | 四个文件全部获取并记录版本 |
| F02 | 同步期间 main 移动 | 全批仍读取同一固定 commit，不混版本 |
| F03 | 只更新 X，其他流时间较早 | 分流判断，不错误要求 generatedAt 相等 |
| F04 | blogs 空且无错误 | no_new，保留此前合法内容 |
| F05 | blogs 空且 errors 非空 | upstream_partial/failed，不伪装 no_new |
| F06 | state 有已见 ID，本地未导入 | 不跳过本地内容，按实际 feed 导入 |
| F07 | 上游清理 state 中旧 ID | 不误删本地资料、不重复入库 |
| F08 | 电脑离线三天，feed 已覆盖三轮 | 从可获取提交历史恢复中间批次，标明覆盖边界 |
| F09 | 历史被改写或某版本损坏 | 明确 gap/隔离；不宣称完整同步 |
| F10 | 多期播客共用频道 URL | 以 publisher + GUID 区分，不合并节目 |
| F11 | 超长 transcript | 完整存储，分段后仍指回同一文档版本 |
| F12 | 检查网络调用和配置 | 无 X API、转录 API、上游生成器调用，无对应必填付费密钥 |
| R01 | 三排序出现相同评论 | 一份评论、多排序来源，父子结构正确 |
| R02 | 回复先到、祖先缺失 | 保存占位并补齐，不错误挂根 |
| R03 | 出现 more 节点 | 可预算内串行展开，剩余节点明确记录 |
| R04 | 评论数少于目标或服务端 limit 行为不同 | 记录实际采样数量，不伪造完整度 |
| R05 | 低赞新帖包含相关问题 | 通过探索配额进入评论候选 |
| R06 | 评论编辑或分数变化 | 正文版本与指标更新分离 |
| R07 | 帖子/评论确认删除、作者删除 | 精确清理相应正文或身份及可恢复副本 |
| R08 | 清理后恢复旧备份 | 不复活被删除或到期内容 |
| R09 | 缺少 Reddit 批准或凭据 | 明示 blocked，其余来源继续 |
| R10 | 不允许外部模型处理 Reddit | 可获准范围内阅读，内容不发送模型 |
| U01 | 网页关闭，worker 仍运行 | 采集正常；电脑休眠则恢复后补采 |
| U02 | AI 模型故障或预算为零 | 原始资料仍能入库、阅读与检索 |
| U03 | 旧精选、收藏、资料进入研究 | 旧深链、来源 ID 和引用保持有效 |
| U04 | 用户停用来源后升级目录 | 不被自动重新启用 |
| S01 | 外链指向内网或重定向到元数据服务 | 请求被阻止，日志不暴露凭据 |
| S02 | 内容含脚本、恶意 XML 或模型指令 | 不执行，不越权，不污染系统设置 |
| S03 | 验收与真实环境分离 | mock/真实请求/长期观察分别报告 |

每条自动化测试可映射一个或多个用例编号。失败输出必须包含可定位的用例与错误原因。不得用减少来源数量或放宽成功标准消除测试失败。

## 16. 最终交付与验收口径

代码交付至少包含：

1. 来源目录与导入/更新逻辑，包含全部附件来源及 Follow Builders 四文件。
2. 可恢复的采集 worker、调度器、适配器、安全网络层和最小必要迁移。
3. 原始资料、正文补全、评论树、版本、发现关系及删除/保留策略。
4. 信源管理、运行记录、资料阅读和旧流程兼容。
5. 测试、来源验证结果、运行说明、授权清单和已知限制。

建议报告路径：

```text
docs/intelligence-acquisition-audit.md
docs/intelligence-acquisition-v3.md
docs/intelligence-acquisition-operations.md
output/acquisition/source-validation.json
output/acquisition/acceptance-report.json
```

验收报告应分别统计：配置来源数、已联网校验数、正常可用数、权限阻塞数、端点失效数、仅摘要数、有真实数据的采集流、尚未观察完成的长期运行项。

“不遗漏”定义为：本期约定的来源和文件全部进入配置、任务、状态及验收视野；上游可取得且属于采集范围的记录按预算分批处理，未处理部分有可续传记录。不能承诺拿到上游未公开、已删除、授权不允许或从未发布的内容。

“可靠”定义为：故障可见、进度可恢复、重复运行幂等、缺口可追踪、来源授权清晰。一次成功请求不能代替这些要求。

## 17. 参考资料与核查记录

以下为本次使用的一手资料或用户附件。外部服务合同会变化，Codex 实施当天必须重新检查。

- [S1] AIHOT Agent 接入说明与 OpenAPI。已核查接入说明；OpenAPI 原文由 Codex 在 P0 读取并固定测试样例：`https://aihot.news/agent`；`https://aihot.news/openapi-v1.json`。
- [S2] Follow Builders 实际 GitHub Actions 工作流：`https://github.com/zarazhangrui/follow-builders/blob/main/.github/workflows/generate-feed.yml`。本次读取的 blob SHA：`7a1fa065c1aa964c834cb94e4bdbb8351ff355ea`。
- [S3] Follow Builders 实际生成器：`https://github.com/zarazhangrui/follow-builders/blob/main/scripts/generate-feed.js`。本次读取第 1 至 90、430 至 670、1030 至文件尾相关段落，blob SHA：`09183cea04f7fb69d699c6c79ef8c98f7566a495`。
- [S4] Reddit Data API Wiki，OAuth、限流与删除规则：`https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki`。
- [S5] Reddit Data API Terms，获准用途与内容使用边界：`https://redditinc.com/policies/data-api-terms`。
- [S6] Follow Builders 默认来源配置：`https://github.com/zarazhangrui/follow-builders/blob/main/config/default-sources.json`。本次读取 blob SHA：`d35d444dba991001fbd17855f81c856ff5710bc5`。
- [S7] Reddit 原生 Data API 文档，重点核查 comments 与 morechildren：`https://www.reddit.com/dev/api/`。不要把 Devvit SDK 的接口可见性当作外部应用已获访问批准。
- [S8] AIHOT 公开使用规则变更说明：`https://aihot.news/changelog`，2026-08-10 公告。实施时同时检查当前正式规则。
- [U1] 用户附件《T2媒体.xlsx》，工作表 `table`，数据行 2 至 15，SHA-256：`470bdf62390e2c16f612af8d7e32eecc01edc7bb6936526cb820ce2467eca59e`。
- [U2] 用户附件《社区.xlsx》，工作表 `table (1)`，数据行 2 至 27，SHA-256：`97069c6ca262e3f6480a8336452221db8e055e75f60c7a0d66fde049e27f2095`。

文档中的当前项目路径和 V2 能力来自本对话所附历史开发记录，未冒充本轮实时源码审计结论。P0 的本地盘点结果为最终实施依据。