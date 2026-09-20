# 情报采集 V3：真实采集验收报告

**结论：部分完成（PARTIAL），尚不能标记 Real Acquisition Acceptance passed。** 实际外部采集、入库、批次追溯和真实页面阅读已验证；Reddit 尚无批准，其他失败入口保留原始原因，未降低成功标准。

## A. 本次运行

- 批次 run_id：`01M2YTQEX2G7KWZE3A8124KCT1`；每个来源另有持久化 acquisition run，详见 JSON。
- UTC：2026-09-20T07:15:43.650Z → 2026-09-20T07:28:36.580Z
- 北京时间：2026-09-20 15:15:43.650 → 15:28:36.580；12 分 52.930 秒。
- trigger：`real_acceptance`；入口：56；status：`partial`。
- 发现 5,997 次；新增 1,755 条；更新 12 条；重复 4,230 次；失败/受阻入口 27 个。

统计口径：fetched 是成功解析并进入批次台账的发现次数，不是 HTTP 请求数，也不是独立事实数。同一资料可被多个入口发现，canonical 正文只保留一份，发现关系分别保存。failed 是本批次最终失败/受阻的入口数，不能与内容条数相加；Reddit 帖子与评论的 11 个阻塞来自同一组入口，不重复计入总失败数。

所有 14 家 T2 均执行了一次，其中 Import AI 本轮按用户明确范围一次性同步，没有改变原来的长期暂停选择。可选、未启用的新来源未加入。

## B. 按来源统计

| 来源 | fetched | inserted | updated | duplicate | failed | status |
|---|---:|---:|---:|---:|---:|---|
| AIHOT Selected | 3961 | 0 | 0 | 3961 | 0 | NO_NEW_ITEMS |
| AIHOT Hot | 10 | 10 | 0 | 0 | 0 | OK |
| AIHOT Daily | 8 | 0 | 0 | 8 | 0 | NO_NEW_ITEMS |
| Follow Builders X | 11 | 11 | 0 | 0 | 0 | OK |
| Follow Builders Podcast | 1 | 1 | 0 | 0 | 0 | OK |
| Follow Builders Blog | 0 | 0 | 0 | 0 | 0 | NO_NEW_ITEMS |
| Follow Builders State | 0 | 0 | 0 | 0 | 0 | OK |
| T2 Media | 180 | 180 | 0 | 0 | 4 | SOURCE_UNAVAILABLE |
| Hacker News | 219 | 200 | 12 | 7 | 1 | SOURCE_UNAVAILABLE |
| Reddit Posts | 0 | 0 | 0 | 0 | 11 | AUTH_BLOCKED |
| Reddit Comments | 0 | 0 | 0 | 0 | 11 | AUTH_BLOCKED |
| GitHub | 1451 | 1199 | 0 | 252 | 5 | SOURCE_UNAVAILABLE |
| arXiv | 0 | 0 | 0 | 0 | 0 | NO_NEW_ITEMS |
| Stack Overflow | 120 | 119 | 0 | 1 | 6 | RATE_LIMITED |
| Dev.to | 36 | 35 | 0 | 1 | 0 | OK |

AIHOT 精选与日报均在本轮重新进行真实请求：精选取得 3,961 条、日报取得 8 份，均命中已有资料；热点新入库 10 条。三路有独立的 stream 与 UI 类型。NO_NEW_ITEMS 表示没有新增/更新，不等于没有执行请求。

Follow Builders 从同一 commit SHA 消费四个文件；本次 X 11 条、Podcast 1 条、Blog 0 条。state-feed.json 已作为状态文件同步，不生成内容卡，因此内容统计为 0。Blog 的上游时间为 2026-09-20 14:37:56（北京时间），空内容显示 NO_NEW_ITEMS。当前非空 Blog 解析由明确标记的 fixture 覆盖，不能算作真实 Blog 新增。

### 全部 14 家 T2

| 来源 | fetched | inserted | updated | duplicate | failed | status | 失败原因 |
|---|---:|---:|---:|---:|---:|---|---|
| 36氪 | 0 | 0 | 0 | 0 | 1 | PARSE_FAILED | 订阅含不支持的 XML 实体声明 |
| Ars Technica | 20 | 20 | 0 | 0 | 0 | OK | — |
| IT之家 | 60 | 60 | 0 | 0 | 0 | OK | — |
| Jack Clark · Import AI | 10 | 10 | 0 | 0 | 0 | OK | — |
| Last Week in AI | 20 | 20 | 0 | 0 | 0 | OK | — |
| MIT Tech Review AI | 10 | 10 | 0 | 0 | 0 | OK | — |
| MarkTechPost | 10 | 10 | 0 | 0 | 0 | OK | — |
| TechCrunch AI | 20 | 20 | 0 | 0 | 0 | OK | — |
| The Decoder | 10 | 10 | 0 | 0 | 0 | OK | — |
| The Verge AI | 0 | 0 | 0 | 0 | 1 | SOURCE_UNAVAILABLE | 来源返回 HTTP 404 |
| VentureBeat AI | 0 | 0 | 0 | 0 | 1 | RATE_LIMITED | 来源返回 HTTP 429 |
| Wired AI | 10 | 10 | 0 | 0 | 0 | OK | — |
| 机器之心 | 0 | 0 | 0 | 0 | 1 | PARSE_FAILED | 订阅含不支持的 XML 实体声明 |
| 量子位 | 10 | 10 | 0 | 0 | 0 | OK | — |

### 其他未完成入口

| 入口 | 状态 | 实际错误 |
|---|---|---|
| GitHub · ai-agent | RATE_LIMITED | 来源限流等待中 |
| GitHub · generative-ai | AUTH_BLOCKED | 来源返回 HTTP 403 |
| GitHub · llm | AUTH_BLOCKED | 来源返回 HTTP 403 |
| GitHub · mcp | AUTH_BLOCKED | 来源返回 HTTP 403 |
| GitHub · rag | SOURCE_UNAVAILABLE | lease expired after final attempt |
| Hacker News · newest_gpt | SOURCE_UNAVAILABLE | 来源返回 HTTP 502 |
| Reddit · r/AI_Agents | AUTH_BLOCKED | Reddit requires an approved application and explicit access approval |
| Reddit · r/ArtificialInteligence | AUTH_BLOCKED | Reddit requires an approved application and explicit access approval |
| Reddit · r/ChatGPTCoding | AUTH_BLOCKED | Reddit requires an approved application and explicit access approval |
| Reddit · r/ClaudeAI | AUTH_BLOCKED | Reddit requires an approved application and explicit access approval |
| Reddit · r/LocalLLM | AUTH_BLOCKED | Reddit requires an approved application and explicit access approval |
| Reddit · r/LocalLLaMA | AUTH_BLOCKED | Reddit requires an approved application and explicit access approval |
| Reddit · r/MachineLearning | AUTH_BLOCKED | Reddit requires an approved application and explicit access approval |
| Reddit · r/OpenAI | AUTH_BLOCKED | Reddit requires an approved application and explicit access approval |
| Reddit · r/artificial | AUTH_BLOCKED | Reddit requires an approved application and explicit access approval |
| Reddit · r/learnmachinelearning | AUTH_BLOCKED | Reddit requires an approved application and explicit access approval |
| Reddit · r/mcp | AUTH_BLOCKED | Reddit requires an approved application and explicit access approval |
| Stack Overflow · chatgpt / newest | SOURCE_UNAVAILABLE | 来源返回 HTTP 404 |
| Stack Overflow · chatgpt / votes | SOURCE_UNAVAILABLE | 来源返回 HTTP 404 |
| Stack Overflow · llm / newest | SOURCE_UNAVAILABLE | 来源返回 HTTP 404 |
| Stack Overflow · llm / votes | SOURCE_UNAVAILABLE | 来源返回 HTTP 404 |
| Stack Overflow · openai / newest | SOURCE_UNAVAILABLE | 来源返回 HTTP 404 |
| Stack Overflow · openai / votes | RATE_LIMITED | 来源返回 HTTP 429 |

GitHub 的 HTTP 403 当前显示 AUTH_BLOCKED；仅凭状态码无法进一步断定是授权限制还是平台配额策略。当前未配置 GITHUB_TOKEN。rag 的租约在最后一次尝试后过期，不能算成功。arXiv 本轮请求成功但没有新增，未提供虚构论文样例。

## C. 本次真实样例

以下标题来自本批次台账；它们是上游内容标题，不代表已经核实其中的事实主张。X 标题是上游正文首段的现有截取。

### aihot:selected

- [Alexandr Wang 转发一份让 AI 智能体保护日历通勤时间的 Muse 提示词](https://x.com/alexandr_wang/status/2101141362607632873) — `01M2X6PTDCP4G8M1HJE6VD4A65`；AIHOT · 精选；summary_only；duplicate。
- [纽约时报版权诉讼披露：微软高管内部称训练 AI 是人类历史上最大规模劳动窃取](https://www.ithome.com/1/004/356.htm) — `01M2X6PTRE6TGFF5JK9RSS1VT5`；AIHOT · 精选；summary_only；duplicate。
- [Anthropic 与 Accenture 合作开展嵌入式独立评估](https://www.anthropic.com/news/accenture-embedded-evaluation) — `01M2YT3CTZAK6ZRR8BDPC1M0ES`；AIHOT · 精选；summary_only；duplicate。

### aihot:hot

- [TypeSafe AI 发布 System One 模型 Jev：返回带概率的类型化决策而非文本，以托管 API 早期访问开放](https://aihot.virxact.com/story/379c3594-c5bf-4cc3-8675-9b1aae61a411) — `01M2YTRAT4J2BN17MF2H9PES8T`；AIHOT · 热点；summary_only；inserted。
- [谷歌Gemini被曝在安全测试中自主入侵三家公司系统](https://aihot.virxact.com/story/3349e012-fd78-44db-a833-cae46d175505) — `01M2YTRAT5DJJ2EXZ5QSKW28G5`；AIHOT · 热点；summary_only；inserted。
- [美国法院受理针对 Anthropic、OpenAI、SpaceXAI、谷歌指控其协调放缓 AI 研发的反垄断集体诉讼](https://aihot.virxact.com/story/a6148dd8-72fa-4d6f-b8da-1b2850432024) — `01M2YTRAT6M7GHNG59K0DWSG3P`；AIHOT · 热点；summary_only；inserted。

### aihot:daily

- [AIHOT 日报 2026-09-20](https://aihot.news/daily/2026-09-20) — `01M2YT2KMRB85GHHPXSG8XCN6C`；AIHOT · 日报；full_text；duplicate。
- [AIHOT 日报 2026-09-19](https://aihot.news/daily/2026-09-19) — `01M2YT2KGGECCZ3AV2FV6GHWMC`；AIHOT · 日报；full_text；duplicate。
- [AIHOT 日报 2026-09-18](https://aihot.news/daily/2026-09-18) — `01M2YT2K98A7HR5YSYDBKFGGYA`；AIHOT · 日报；full_text；duplicate。

### follow_builders:feed-x.json

- [2026 is the year of linux desktop](https://x.com/thsottiaux/status/2101431497437950458) — `01M2YV2909Y67AJ1WF0MFQ07VK`；Follow Builders；full_text；inserted。
- [I have a simple markdown file and a /tastemaker skill that I use to add ratings for movies, TV shows, and books I've see](https://x.com/petergyang/status/2101503916743749878) — `01M2YV290BJM5E8CMNET1G4X3H`；Follow Builders；full_text；inserted。
- [My next podcast episode is almost guaranteed to save you some money.  It's with my friend @ebloch, product lead for Chat](https://x.com/petergyang/status/2101342055352201519) — `01M2YV290C8KYD8SWK7C5P8EM9`；Follow Builders；full_text；inserted。

### follow_builders:feed-podcasts.json

- [When AI Improves Itself ／ Richard Socher (Recursive)](https://www.youtube.com/@DataDrivenNYC/videos) — `01M2YV290KM8M0EGJ49VNZXZ5D`；Follow Builders；full_text；inserted。

### t2_media:feed

- [《网络安全人才实战能力报告-AI赋能篇》正式发布，当AI进入业务深水区安全如何跟上](https://www.qbitai.com/2026/09/492849.html) — `01M2YTR7E82AXB5GJ1EBQR7QK7`；量子位；summary_only；inserted。
- [“留给人类阻止AI的时间不多了”](https://www.qbitai.com/2026/09/492755.html) — `01M2YTR7E9RSMNVZC31QCESCF0`；量子位；summary_only；inserted。
- [马斯克批量收购破产公司ing…世界首富脑子是不一样](https://www.qbitai.com/2026/09/492661.html) — `01M2YTR7EAFF77C0N49AKAVR1X`；量子位；summary_only；inserted。

### community:hacker_news

- [Show HN: The Smallest LLM](https://news.ycombinator.com/item?id=49772424) — `01M2YV2H1XKMKCFX5W42TQHQ2F`；Hacker News · newest_llm；summary_only；inserted。
- [Show HN: The Smallest LLM](https://gist.github.com/skorotkiewicz/dedc3b5a857be7d0f2b378334721713c) — `01M2YV2H1YYGSXE3GR1BY0C26V`；Hacker News · newest_llm；summary_only；inserted。
- [ROCmFix and InferBench – AMD Local-LLM Setup and Vulkan vs. Hip Benchmarking](https://news.ycombinator.com/item?id=49770070) — `01M2YV2H1ZJW1M80ZW318Q9A53`；Hacker News · newest_llm；summary_only；inserted。

### community:github

- [napapijri5248/CineSage](https://github.com/napapijri5248/CineSage) — `01M2YV552RZ0PHF5Z7MDRY84D6`；GitHub · generative-ai；summary_only；duplicate。
- [wangsalin/ai-acting-system](https://github.com/wangsalin/ai-acting-system) — `01M2YV552T2D4Y79A8G9KZBVYW`；GitHub · generative-ai；summary_only；duplicate。
- [nicoleiszsy/seedance-2-5-free-tier-data](https://github.com/nicoleiszsy/seedance-2-5-free-tier-data) — `01M2YV552VT3E4QVSZ8ZP3VZWZ`；GitHub · generative-ai；summary_only；duplicate。

**Podcast 实测：** `When AI Improves Itself | Richard Socher (Recursive)`，The MAD Podcast with Matt Turck，2026-09-10 发布。数据库正文与真实页面正文均为 **76,077 字符**（字符数，不是中文分词意义的字数，也不是英语词数），浏览器已检查全文长度和结尾。上游提供的是频道 videos URL，系统保留原值，没有猜测单集链接。

**Reddit：0 个本轮帖子、0 条本轮评论。** 用户已明确暂缺批准。未使用历史库中的评论、模拟评论或匿名替代请求作为验收证据，故无法提供要求的 3 个新帖子和 5 条新评论。

### 内容质量与完整度

- Podcast 保存完整上游 transcript；X 保存上游已有正文和互动指标。
- 本轮 T2、HN、GitHub 等多数资料仅有订阅摘要、描述或链接，页面如实标记 summary_only，不能当成全文验收通过。
- AIHOT 日报为上游整份报告；报告内的摘要不等于被引用文章全文。热点保留上游摘要/结构化整理内容，并标记为二级资料。
- HN 帖子与其外链文章是两个不同对象，不可因标题相同就当成重复数据错误；同一外链在多个发现渠道之间则共享 canonical content。
- 当前 GitHub 数量较多，内容相关性、价值筛选和精选质量尚未验收，本轮没有扩大为 AI Pipeline 优化。

## D. UI 验收路径与启动

1. 启动工作台：运行 `workbench/scripts/launch.vbs`，或在 workbench 目录执行 `npm run dev`，访问 http://127.0.0.1:5180/#/intel-resources 。
2. 左侧「情报」→「资料」→「本次采集」；默认显示最近批次。顶部「立即同步」会通过同一批次服务、持久化队列、采集器和入库事务执行。
3. 「本轮内容流」选择 Follow Builders Podcast，展开该节目，直接阅读完整 transcript；长正文可聚焦并滚动。
4. AIHOT 精选/日报本轮全部重复：把「发现范围」切换为「全部发现（含重复）」再筛选相应内容流。热点在默认新增列表中可见。
5. 每张卡片展开「采集详情」，查看外部 ID、来源、时间、run ID、正文状态、去重结果；「发现渠道」显示多渠道发现关系。
6. 每个来源组展开「逐源结果与失败原因」；也可点「查看全部来源与失败状态」进入来源管理查看最后检查、最后成功、统计和耗时。
7. Reddit 评论入口已具备排序与父子关系展示，但本批次因授权阻塞没有真实评论可展示。其真实 UI/API 验收仍待授权后执行。

独立进程运行同一流程（会真实入库，仅在需要新一轮同步时执行）：

```powershell
cd workbench
node scripts/acquisition-acceptance.mjs --confirmed
```

该脚本创建校验过的 SQLite 恢复点，复用现有持久化任务；遇到长时间重试会保留任务并输出未完成状态。常驻采集可使用既有 `npm run acquisition`。本轮 Follow 只验收当前固定 SHA 的四文件，历史回放未在这次批次执行；常规采集器的历史回放能力保留。

真实页面证据：

- [批次总览](../output/playwright/real-acquisition-overview.png)
- [逐源失败](../output/playwright/real-acquisition-failures.png)
- [真实完整 transcript](../output/playwright/real-podcast-transcript.png)
- [小屏幕检查](../output/playwright/real-acquisition-mobile.png)
- [机器可读统计与样例](../output/acquisition/real-acceptance-report.json)

## 修改、迁移与验证

- 新增迁移 `0030-acquisition-acceptance.sql`：批次、运行归属、逐条发现/去重台账和健康状态；真实库已由 29 升到 30。迁移前在线备份保存在 `XENHO_HOME/Backups/Migration-Points/before-real-acquisition-*.sqlite`，旁有 SHA-256 校验记录。
- `server/acquisition/batches.mjs`、`health.mjs`、`runner.mjs`、`store.mjs` 与路由：统一批次入口、统计、分页阅读、详情、终态和失败原因。
- `transport.mjs`：同主机锁等待与强制刷新控制；`connectors/aihot.mjs`：三路归属及热点内容落库；`community.mjs`：GitHub 每页 30 条以避免本轮实际观察到的响应截断；`follow-builders.mjs`：当前固定版本覆盖标记。
- `server/jobs/job-store.mjs`、`local-job-runner.mjs`：支持只领取本批次任务；现有租约、重试仍生效。
- `scripts/acquisition-worker.mjs`、`server/vite-plugin-workbench.mjs`：复用任务运行与批次终态落盘；新增 `scripts/acquisition-acceptance.mjs`。
- 新增 `src/components/AcquisitionBatch.jsx`、`AcquisitionResource.jsx`；更新资料页、来源页和现有样式。
- 测试：新增批次/界面用例，更新 provider 和迁移断言，package.json 将新用例纳入 test:acquisition。

本轮通过：acquisition-batches、acquisition-providers、acquisition-community、acquisition-storage（19 项）、acquisition-regressions（9 项）、acquisition-batch-ui、既有 acquisition-ui、npm run check、npm run build、git diff --check。持久化测试使用独立临时 SQLite，并已清理。完整项目的全部测试套件本轮未重跑。

界面测试中的批次摘要 fixture 只证明界面逻辑；真实验收证据来自上述生产批次、真实 API 与浏览器。真实页面已核对 76,077 字符 transcript、失败原因，以及 390px 宽度无横向溢出。

## E. 未完成验收与所需条件

- Reddit 新帖、Top/Confidence、Controversial、New、回复、morechildren、parent/root/depth 全部真实验收仍未完成。需要获准应用的 REDDIT_ACCESS_TOKEN、REDDIT_USER_AGENT、REDDIT_ACCESS_APPROVED=true，仅配置在本机 workbench/.env，不发到聊天。
- GitHub 部分分页遇到限流/403，rag 最终租约过期；需要可用的访问配置/配额并重试剩余检查点。其他平台的 404、429、502 和媒体解析失败，需逐项修复或在服务恢复后重试，不能删除来源或把失败记为空。
- Blog 非空历史内容、本轮长期离线后的历史补采、所有 T2 全文补全未完成真实验收。现有模拟测试不替代这些验证。
- 本轮没有执行删除真实资料来验证删除流程；权限、保留期及删除回归在隔离测试中检查。
- 当前成功采集内容已可见，但全源完整性和 Reddit 硬性验收门槛未满足，因此整体保持 PARTIAL。未自动 push。
