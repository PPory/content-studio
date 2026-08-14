# Brave Search + Firecrawl 后置核实协议

## 目录

1. 核实层的职责
2. 分级触发
3. 哪些内容必须核实
4. 哪些内容通常不需要核实
5. 两阶段工具架构
6. 查询设计
7. 来源选择与独立性
8. 内容供给审计
9. Verification Ledger
10. 失败、冲突和降级

## 1. 核实层的职责

三份社媒材料负责发现信号、问题、情绪、案例和早期张力。网络层只负责：

1. 核实会改变洞察结论的承重事实。
2. 打开社媒转述背后的法规、论文、公告、仓库或原始报道。
3. 主动寻找反例、口径冲突和竞争解释。
4. 验证“内容供给不足”是否真的成立。

不要让搜索结果替代材料分析。正确顺序是：

```text
先读材料并生成候选
→ 提取承重 claim
→ Brave Search 找来源
→ AI 选择 URL
→ Firecrawl 抽取正文
→ 逐 claim 判断
→ 根据结果重新评分、降级或删除
```

搜索工具只负责找到和抽取证据，不负责宣布结论已经成立。

## 2. 分级触发

### Tier 0｜不联网

适用于：

- 评论区出现了哪些问题
- 被追踪账号本周在谈什么
- 社媒用户表达的情绪或价值判断
- 对本周材料本身的观察
- 初步写作角度和个人相关性

### Tier 1｜一手来源核实

适用于：

- 产品发布日期和功能变更
- 官方政策、法规和适用范围
- 论文、仓库、模型卡、许可证和规格
- 当事方的完整原帖或公开声明

通常每条 claim 1–3 次搜索，抽取 1–2 个页面。

### Tier 2｜交叉验证与反证

适用于：

- 百分比、排名和比较数字
- 事故、争议、诉讼和法律影响
- “first / only / largest”
- 因果机制和会支撑标题的关键前提
- 可能被利益相关方夸大的官方自测

通常每条 claim 2–4 个查询、2–5 个页面，至少一个 `counter` 查询。

### Tier 3｜内容供给审计

只对 Write Queue 前 2–3 个候选执行。目标是判断真实缺口，而不是证明“材料里没看到”。

每周默认控制在：

- 8–15 条承重 claim
- 最多 15 次 Brave Search
- 最多 12 个 Firecrawl 独立 URL

超过上限时缩小到最会改变结论的主张，不要给每条帖子做事实核查。

## 3. 哪些内容必须核实

若以下内容进入 Top Card、文章主张或学习建议，优先核实：

- 法律、监管、政策、官方准则和生效日期
- 模型、产品、API、公司政策或开源项目发布
- 论文标题、作者、方法、样本、结论和发布日期
- 具体安全事件、事故、诉讼、争议或公共事件
- “某公司已经 / 从未 / 将要做 X”
- 数字、排名、百分比和时间线
- “首次、唯一、最大、最早”
- 社媒帖子引用的截图、采访、报告或邮件
- 会显著改变洞察方向的反方事实
- “低竞争、几乎没人写、中文供给稀缺”等内容市场判断

先问：

> 如果这条事实不成立，卡片标题、解释、行动或优先级会不会改变？

会改变，就是 load-bearing claim。

## 4. 哪些内容通常不需要核实

以下内容可以作为“本周材料中的观察”，但不得外推：

- 某评论区反复追问什么
- 被追踪账号的本周注意力
- 某条帖子的可见互动
- 社媒用户表达的情绪、价值判断或个人体验
- 同一争议中出现哪些论证类型
- 由 creator profile 得出的个人相关性
- 创作标题、比喻和文章结构

若要把这些升级成总体趋势、真实因果或稳定内容位，仍需额外证据或多周数据。

## 5. 两阶段工具架构

### 5.1 Brave Search：发现来源

使用：

```bash
node scripts/web_research.mjs search \
  --queue <verification-queue.json> \
  --output <work-dir>/web
```

默认 dry run；加 `--go` 才执行。脚本读取 `BRAVE_SEARCH_API_KEY`，使用 Brave Web Search，保存规范化结果到：

`web/search-results.json`

Brave 阶段只回答：

- 哪些页面可能包含一手事实？
- 有哪些独立来源或反方？
- 目标语言的现有内容在哪里？

不要把 result snippet 当作已核实证据。

### 5.2 AI 选择 URL

读取搜索结果，写 `web/fetch-plan.json`。选择时考虑：

- 一手性
- 是否与其他页面独立
- 是否真的覆盖最小 claim
- 是否提供方法、样本、适用范围或完整语境
- 是否是反方或竞争解释
- 是否只是同一新闻稿的重复传播

不要让脚本自动抓全部 Top-N；搜索排序不等于证据质量。

### 5.3 Firecrawl：抽取正文

使用：

```bash
node scripts/web_research.mjs fetch \
  --plan <web/fetch-plan.json> \
  --output <work-dir>/web
```

默认 dry run；加 `--go` 才执行。脚本读取 `FIRECRAWL_API_KEY`，把所选页面抽成 Markdown，保存到：

- `web/fetch-results.json`
- `web/pages/*.md`

对 PDF、长文和技术页面，必须读取正文中真正支持 claim 的部分；不要只看标题和摘要。

### 5.4 环境与代理

API key 默认从 `creator-workbench/.env` 或当前环境读取：

```text
BRAVE_SEARCH_API_KEY=...
FIRECRAWL_API_KEY=...
```

脚本会优先使用工作台现有的 `server/lib/fetch.mjs` 中 `proxyFetch`，以延续当前网络重试与代理环境；找不到时回退到 Node 原生 `fetch`。

可用 `BRAVE_SEARCH_API_BASE` 和 `FIRECRAWL_API_BASE` 覆盖 endpoint，用于代理或测试。不要在报告和日志里输出 API key。

## 6. 查询设计

### 6.1 搜索最小 claim

不要搜索整张卡片。把主张拆成可核实的最小单元：

- 弱：`Claude auto mode 安全吗`
- 强：`Anthropic Claude Code auto mode 89% 14% evaluation methodology`

### 6.2 每个重要解释至少两种查询

**支持查询**：找原始事实、方法和上下文。

**反方查询**：找独立评测、口径冲突、失败案例或相反研究。

示例：

```text
support:
Anthropic auto mode 89% 14% evaluation methodology

counter:
independent evaluation criticism auto mode 89% 14% different test set
```

### 6.3 时间和语言

- 发布、事故和政策使用明确日期窗口。
- 常青论文和机制不强行限制到最近一周。
- 内容供给审计分别搜索中文和英文，不把英文供给推及中文。
- 目标平台不在公开 Web 中完整可见时，记录覆盖限制。

### 6.4 查询 purpose

`verification-queue.json` 中每个查询必须标为：

- `support`
- `counter`
- `supply`

详见 `references/run-artifacts.md`。

## 7. 来源选择与独立性

优先级：

1. 官方法规文本、政府或监管机构页面
2. 原始论文、期刊、作者页面或数据集
3. 官方产品公告、文档、changelog、GitHub 仓库或模型卡
4. 当事方正式声明、公开记录或完整采访
5. 高质量专业媒体的原创报道
6. 聚合站、摘要和社媒转述

注意：

- 官方来源可证明“官方这样声称”，不自动证明厂商自测客观成立。
- 不用另一个社媒帖核实第一个社媒帖。
- 十家媒体引用同一新闻稿仍是一个依赖组。
- 搜索结果多不等于证据独立。
- 对研究与技术问题，优先原论文和官方文档。
- 对公共事件，尽量找到原始报道和当事方完整语境。

## 8. 内容供给审计

三份周材料是选题需求和信号来源，不是整个内容市场的索引。

### 先把问题问对

**不要问「这个选题有没有人写过」。** 答案几乎永远是「有」，于是这一步退化成一个
恒等于「别写」的函数，没有任何决策价值。

要问的是四件事，缺一件结论就不成立：

| | 问什么 | 怎么得到 |
|---|---|---|
| **角度** | 同一个话题被切成了哪几刀 | 逐条归类，你来判断 |
| **密度** | 哪一刀挤、哪一刀空 | 数条数 |
| **深度** | 挤的那一刀是写透了还是都在蹭 | 覆盖层级 |
| **反响** | 读者是存下来了，还是划过去了 | 比率，不能用绝对值 |
| **新鲜度** | 是历史遗留还是正在涌入 | 该角度最新一条的日期 |

**最值钱的一格不是「没人写」。** 没人写往往意味着没需求。真正好切入的是
**有人写了但读者没买账**——角度对、执行不对。所以反响这一列不能省。

**反响只能用比率**：不同时间发的内容进的流量池不是一个量级，绝对赞数跨条比毫无意义。
用 `收藏率 = 藏/赞`（高 = 工具性内容被存下来反复看，低 = 刷过就走）和
`评赞比 = 评/赞`（高 = 引发讨论），并且只和**同一批**内容的中位数比。

### 最小流程

1. 定义目标语言、公开 Web 或明确平台、30/90 天或常青窗口。
   **供给审计的窗口应该是常青的，不是本周的**——三个月前写透的文章今天照样占着那个位置。
2. 设计至少三个查询：
   - 主题 / 概念
   - 为什么 / 原理 / 解读 / 争议
   - 怎么做 / 案例 / 方法
3. 找出 3–5 个最接近的竞争内容。
4. 排除同源转载、发布稿复制和低信息短帖。
5. 标注每篇内容覆盖层级：
   - `news_rewrite`
   - `basic_explanation`
   - `mechanism`
   - `framework`
   - `practice`
   - `synthesis`
6. 按角度聚合成一张地图（角度 × 条数 × 深度 × 反响 × 最新一条），不要只给一个总判断。
7. 判断真实缺口：
   - 确实几乎没有供给
   - 有新闻转述，缺解释
   - 有解释，缺框架
   - 有观点，缺实操
   - 英文完整，中文缺少
   - **有人写但反响差**（角度对、执行不对，最好切入）
   - 已经被说透，不值得写
8. 记录 `coverage_limit`。

公开 Web 无法完整覆盖微信、小红书等站内内容时，只能写：

> “公开 Web 可见内容中……”

不能写：

> “整个中文互联网没有人讨论……”

### 中文站内探针（可选的第二条腿）

Brave 搜不到小红书站内，而小红书是他要发的平台之一——只靠公开 Web 做审计，
关于「中文侧有没有人写、写成什么样」的结论天然缺一块。工作台侧有一个探针补这一块：

```bash
# 在 MediaCrawler 目录抓（需要人扫码，用小号；不要自己代跑）
uv run main.py --platform xhs --type search --keywords "<词1>,<词2>" \
  --get_comment true --max_comments_count_singlenotes 30
# 在 creator-workbench 目录转
node scripts/social-probe.mjs --week <YYYY-Www>              # 小红书
node scripts/social-probe.mjs --platform dy --week <...>     # 抖音
node scripts/social-probe.mjs --type creator --week <...>    # 对标博主
```

产物落 `tmp/insight-work/<week>/web/<platform>-<type>-probe-<date>.md` 和 `.json`
（md 是分析视图，逐条只列前 8 条评论；**全量评论在 json 里**）。

用法约束：

- **要人扫码，所以不能当成自动步骤。** 判断需要它时，把命令给用户，不要试图自己跑完。
  没跑也照常出报告，只是 `coverage_limit` 要如实写「未覆盖小红书站内」。
- **关键词用读者会搜的话，不是论文措辞**，一个候选选题配 2–3 个说法。
  **不要用「AI」「人工智能」这种宽词**——返回的是一片工具推荐和变现广告，
  而数量从来不是瓶颈，筛选才是。
- 探针有**三段**，喂给报告的不是同一处：
  - **供给面（笔记）** → `supply_audit`。**填那张角度地图，不要只给一句总判断**：
    角度 × 条数 × 覆盖层级 × 收藏率中位 × 最新一条。表是空的，脚本不猜角度。
    反响列的四象限（`存/刷/冷存/冷`）已经算好了，落在 `刷`/`冷` 的就是
    「有人写了但读者没买账」——写进 `verdict` 时要点名是哪几条。
  - **需求面（评论）** → 分析框架里的「评论区暴露的未满足问题」和 Insight Card 的
    `读者问题` 字段。**按那张四类表分类**（求助 / 反驳 / 经验 / 共鸣），
    因为它们去的不是同一节：求助 → 内容机会；反驳 → 认知冲突与反共识；
    **经验 → 写作时的靶子，绝不能当成新东西讲**；共鸣 → 计数即可。
  - **对标面（creator 模式）** → 「人物与注意力迁移」。中文创作者这一侧原来是空的。
- **评论按回复数看，不按赞看。** 赞 = 有多少人有同感；回复数 = 有多少人有话要说。
  实测最值钱的一条（楼主追问「我不知道怎么办，求解答」）只有 ♥27，
  而点赞过千的多是「太真实了」这类零信息量的共鸣。**标了「楼主」和「❓」的优先看。**
- **`coverage_limit` 照抄 json 里那一条**，不要升级成「小红书站内没有」——
  探针只看到搜索第一页、排序还是平台给的，评论也只是每条的热度序头部。
- **抖音只回答「这个选题在短视频侧爆过没有」。** 它的 `title` 就是文案，
  视频里说了什么一个字都没有，所以那份产物没有正文、没有角度地图——
  别在抖音数据上做深度或角度判断。

## 9. Verification Ledger

每个 claim 记录：

```text
claim_id
candidate_id
claim
claim_type
load_bearing
status
fact_status
source_independence
supporting_sources
contradicting_sources
missing_information
report_wording
confidence_effect
supply_audit
```

`status`：

- `verified`
- `partially_verified`
- `contradicted`
- `unverified`
- `not_applicable`

报告中的 Fact status 与解释置信度必须吸收核实结果：

- 论文存在并核实，不代表论文描述的现实模式已成熟。
- 官方数字已找到，只能写 `Official claim only`，除非有独立复现。
- 事件事实已核实，不代表从 n=1 推导的结构性解释是 High。
- Supply Audit 没做完，Opportunity validation 只能是 `Material-only / Not assessed`。

完整字段示例见 `references/run-artifacts.md`。

## 10. 失败、冲突和降级

### 找不到原文

- 标为 Unverified。
- 降低 Evidence 和 Interpretation confidence。
- 不复述未经证实的细节。
- 把 Write 降为 Explore → Write。

### Firecrawl 抓取失败

- 保留 URL、错误和搜索结果，但不要声称读过正文。
- 寻找可访问的一手替代来源。
- 若只能依赖 snippet 或摘要，标为 Secondary only / Unverified。

### 一手来源之间冲突

- 列出冲突的指标、日期、范围和版本。
- 不选择更符合原假设的一方。
- 把冲突本身变成 Open Question 或 Cognitive Conflict。

### 来源已更新

记录抓取日期和当前版本。区分：

- 社媒讨论当时的状态
- 核实时的当前状态

### API key 缺失或预算不允许

- 可以用运行环境自带的 WebSearch / WebFetch，仍写同一 Verification Ledger。
- 若完全无法联网，保留 Unverified，并严格降级行动。
- 不因为工具不可用而把猜测写成事实。
