---
name: personal-intelligence-radar
description: 把每周的 Reddit / X / AI 日报 Markdown 材料转成一份有据可溯的个人情报周报——找出新信号、知识缺口、内容机会、待追踪问题、认知冲突和跨领域连接，并给出 Learn / Write / Watch / Explore / Ignore 的行动分类。使用 Brave Search 发现来源、Firecrawl 抽取正文，对承重事实、反证和内容供给做后置核实。触发词：「跑一次社媒洞察」「做份情报周报」「跑一次情报雷达」「最近大家在聊什么」「personal intelligence radar」「social insights」。读取 `99 - 个人工作台/02 - 洞察/_material/` 下的 `YYYY-Www-{reddit,x,aihot}.md`；可以编排已有 fetch-material.mjs，但不读 raw JSON。这是按需生成的研究报告，不是实时看板。
---

# Personal Intelligence Radar

把已经筛选并渲染为 Markdown 的社媒与行业材料，转化为供创作者阅读的周度个人情报报告。不要只做话题摘要；必须发现变化、解释结构、暴露知识缺口、评估内容供需，并给出可验证的学习与写作行动。

## 输入边界

只把以下内容当作本 Skill 的分析输入：

- `99 - 个人工作台/02 - 洞察/_material/<week>-reddit.md`
- `99 - 个人工作台/02 - 洞察/_material/<week>-x.md`
- `99 - 个人工作台/02 - 洞察/_material/<week>-aihot.md`
- 为核实关键事实而主动取得的网页或原始来源
- 可选的创作者兴趣、知识背景或内容定位说明

不要读取 `creator-workbench/tmp/*-raw-*.json`，除非用户在当前任务中明确改变输入契约。不要把抓取、筛选、外部核实和分析混为一层。

## 先加载这些参考文件

0. **始终先读 `<VAULT_ROOT>/99 - 个人工作台/02 - 洞察/_config/creator-profile.md`**——他在写什么、拿哪四个问题切材料、哪些平台是真的、三个源各补什么层，都在那里。**没读它就等于在给一个陌生人写报告。**
   （这个文件在 vault 里而不在 Skill 里，因为它是他的画像、会随他变，不属于分析方法。）
1. 始终读取 `references/input-contract.md`，确认三类材料的形状、上游筛选偏差和抓取器边界。
2. 始终读取 `references/analysis-framework.md`，执行完整雷达框架，不得遗漏核心分析类型。
3. 在候选洞察排序前读取 `references/quality-and-scoring.md`。
4. 在创建中间工件前读取 `references/run-artifacts.md`。
5. 在核实外部事实前读取 `references/verification-protocol.md`。
6. 在写最终报告前读取 `references/report-format.md`。

Skill 版本记录在根目录 `VERSION`。

## 工作流

### 1. 确定分析周期和路径

从用户请求、文件名或当前日期确定 ISO 周，例如 `2026-W33`。优先使用用户明确指定的周。记录 vault 根目录和最终报告路径；默认输出为：

`99 - 个人工作台/02 - 洞察/<week>-社媒洞察.md`

**沿用这个文件名**（不叫「洞察报告」）：工作台的洞察页按文件列，同一周两个名字会并排出现两份；而且他在 Obsidian 里的双链和批注都挂在这个名字上。重跑同一周就是覆盖正文——**批注不受影响**，那些在同名的 `.notes.md` 伴生文件里。

不要因为当前日期不同而擅自替换用户指定的历史周。

### 2. 检查材料；必要时编排抓取器

先检查三份预期 Markdown 是否存在且非空。

若材料齐全，直接进入预处理。

若材料缺失，抓取器就在本 Skill 目录里，**在 `creator-workbench` 根目录下跑**：

```bash
cd <creator-workbench>
node skills/personal-intelligence-radar/fetch-material.mjs
node skills/personal-intelligence-radar/fetch-material.mjs --go
node skills/personal-intelligence-radar/fetch-material.mjs --go --only aihot
```

第一条是 dry run，只打印计划和预估 credits；第二条抓三个源，通常约 270 credits；日报源免费。

其他开关：`--only <reddit|x|aihot>` · `--days N` · `--posts N`（Reddit 每个 sub）· `--xposts N`（X 每个账号）· `--top N`（详写上限）· `--from <raw.json>` 离线重放 · `--snapshot <id>` 取回已触发但没下载完的采集。

**它没有 `--help`**——不加 `--go` 就是 dry run，那份预算表就是它的说明书。

规则：

1. **默认先 dry run**。抓取要花钱，预算表看过再决定。
2. 仅在用户明确要求生成本期报告时启动付费抓取。日报源免费，缺它可以直接补。
3. 网络中途断了别重抓——先看日志里的 `snapshot <id>`，用 `--snapshot` 取回，钱已经花过了。
4. 只想改筛选或排版、不需要新数据时，用 `--from creator-workbench/tmp/<源>-raw-*.json` 离线重放。
5. 抓取失败时报告具体脚本错误，**不要用较差的报告掩盖采集故障**。
6. 三个源独立失败：X 挂了不影响另外两个，照常出报告并在覆盖说明里写清缺了哪一个。

抓取器属于外部确定性依赖。本 Skill 只负责编排，不负责实现抓取逻辑，也不要把它的筛选规则复制进提示词——那些阈值是数真实数据定出来的，用 prompt 表达既不稳定也没法验证。

### 3. 无损预处理材料

运行：

```bash
cd <creator-workbench>
python -X utf8 skills/personal-intelligence-radar/scripts/prepare_materials.py \
  --vault "$VAULT_ROOT" \
  --week "<YYYY-Www>" \
  --output "tmp/insight-work/<YYYY-Www>"
```

**`--output` 必须显式给，不要用默认值。** 脚本默认写到 `<vault>/99 - 个人工作台/02 - 洞察/_work/<week>/`，会让 Obsidian 索引派生 chunk；chunk 归 `tmp/`。

`VAULT_ROOT` 在 `creator-workbench/.env` 里。Windows 上必须用 `python -X utf8`；不要使用应用商店空壳 `python3`。

读取输出的 `manifest.json`、`manifest.md` 和 `chunks/*.md`。预处理只允许检查、索引和无损分块，不允许过滤、重写或总结原文。

若运行环境不能执行脚本，则按文件和二级标题逐段读取，同时自行记录文件大小、覆盖范围、分区、日期范围和截断情况。

### 4. 建立覆盖与证据边界

在解释内容前先形成 Coverage Note，至少记录：

- 三个文件是否齐全
- 每个来源的字符数、估算 token、日期范围、主要分区和 URL 数
- 材料是否包含正文截断、只留标题的索引项、评论 Top-N 或账号 Top-N
- 哪些来源是全量，哪些经过上游筛选
- 是否存在明显缺页、抓取失败、重复事件或发布时间偏斜

把材料称为“已筛选的观察窗口”，不要称为社媒总体或用户总体。

### 5. 执行多轮分析，不要边读边写结论

#### 5.1 逐块提取证据单元

从每个 chunk 提取候选证据，写入：

`tmp/insight-work/<week>/evidence-ledger.jsonl`

每个证据单元至少包含：

- 来源文件、分区、日期、作者或社区、标题、原链接
- 帖子或评论表达的核心主张
- 可见互动指标及其平台语境
- 事实、观点、问题、案例、争议或推荐类型
- 可能支持的信号、知识缺口、内容缺口或认知冲突
- `event_cluster` / `dependency_group`
- 是否需要外部核实
- 截断、二手转述、仅标题和上游筛选限制

不要把同一帖的正文和评论、同一新闻的多次转发、同一作者的连续转述当成独立证据。

#### 5.2 聚类与去重

把证据聚合为事件、问题、概念和张力。先识别“同一事件的重复传播”，再识别“不同来源独立出现的共同模式”。

区别：

- **热度**：当前材料里出现或互动较多
- **变化**：讨论焦点、措辞、参与人群或问题结构发生迁移
- **洞察**：对变化给出有证据的解释，并说明其学习或创作意义

#### 5.3 生成完整候选集

必须逐项检查以下雷达，即使最终结论是“本周证据不足”：

1. 值得关注的新信号
2. 值得学习的知识缺口
3. 值得写的内容机会
4. 值得持续追踪的问题
5. 值得形成观点的认知冲突
6. 认知意外与盲区
7. 跨领域连接
8. 人物与注意力迁移
9. 噪音、饱和话题和可忽略项
10. 高价值原始材料与 Source Gems
11. Watch / Explore / Learn / Write / Ignore 行动分类

内容机会必须检查六种核心类型：

- 高讨论、低解释
- 高争议、低框架
- 高价值、低关注
- 高复杂、缺少低门槛解释
- 碎片很多、缺少整合
- 新现象、旧框架解释不了

同时检查解释、视角、实操、反方和整合缺口，以及评论区暴露的未满足问题。

#### 5.4 先综合，再选卡片

在候选排序前做一次跨候选 synthesis：

- 哪些事件卡其实是同一个更高层结构的不同表现？
- 哪两条彼此引用，却可以合并成一条更强的 Meta Insight？
- 合并后是否损失关键反例或行动差异？

优先保留上层结构，把具体事件降为 Evidence。避免“一事一卡”和同一判断在多个章节重复出现。

#### 5.5 建立 Candidate Registry

写入：

`tmp/insight-work/<week>/candidate-registry.json`

按 `references/run-artifacts.md` 记录每个候选的唯一状态。之后的一页结论、Top Cards、Learn Queue、Write Queue、Watchlist 和行动计数全部从 Registry 渲染，禁止在不同章节重新判断。

### 6. 后置网络核实：Brave Search → Firecrawl

先完成候选生成，再联网。网络只负责核实承重事实、寻找反证和审计内容供给，不替代对三份材料的分析。

#### 6.1 建立 Verification Queue

从 Top 候选中提取 8–15 条最小承重 claim，写入：

`tmp/insight-work/<week>/verification-queue.json`

优先：数字、日期、法规范围、论文结论、产品发布、事件细节、first/only/largest、因果机制的关键前提，以及 Write Queue 前 2–3 项的内容供给。

每个重要解释至少有一个 `counter` 查询。内容供给审计使用 `supply` 查询。

#### 6.2 用 Brave Search 发现来源

```bash
cd <creator-workbench>
node skills/personal-intelligence-radar/scripts/web_research.mjs search \
  --queue "tmp/insight-work/<week>/verification-queue.json" \
  --output "tmp/insight-work/<week>/web"
```

先看 dry run。用户已经明确要求生成本期报告、环境存在 `BRAVE_SEARCH_API_KEY`，且计划不超过 15 次 Brave 查询时，可以加 `--go` 执行；超过上限先缩小到真正承重的 claim，不要无边界扩张。

Brave Search 只负责召回 URL。不要直接把搜索摘要当证据。

#### 6.3 选择来源并用 Firecrawl 抽取正文

AI 读取 `web/search-results.json`，按一手性、独立性、反证价值和相关性写：

`tmp/insight-work/<week>/web/fetch-plan.json`

然后运行：

```bash
node skills/personal-intelligence-radar/scripts/web_research.mjs fetch \
  --plan "tmp/insight-work/<week>/web/fetch-plan.json" \
  --output "tmp/insight-work/<week>/web"
```

同样先 dry run。用户已要求生成报告、存在 `FIRECRAWL_API_KEY`，且计划不超过 12 个独立 URL 时，可以加 `--go`。Firecrawl 失败时保留具体 URL 和错误，不要把搜索摘要伪装成已读全文。

脚本会优先使用工作台已有的 `server/lib/fetch.mjs` 代理封装；找不到时才回退到 Node 原生 `fetch`。

#### 6.4 写 Verification Ledger

读取 `web/pages/*.md`，逐 claim 写入：

`tmp/insight-work/<week>/verification-ledger.jsonl`

记录 `verified / partially_verified / contradicted / unverified`、来源独立性、缺失信息、报告允许使用的措辞，以及它如何影响解释置信度和行动。

若 Brave/Firecrawl key 缺失或 API 不可用：

- 可以使用运行环境已有的 WebSearch / WebFetch，仍按同一 ledger 格式记录 provider；
- 若没有替代工具，则明确保留 Unverified，不要补全；
- 承重事实未核实时，把 `Write` 降为 `Learn → Write` 或 `Explore → Write`。

#### 6.5 内容供给审计

只有完成目标语言、公开 Web、时间窗口和最接近竞争内容的定向搜索后，才能写：

- “低竞争”
- “供给稀缺”
- “没人讲清楚”
- “内容空白”

若只检查了三份周材料，只能写“本周材料中未见”。微信、小红书等平台内供给未被公开 Web 完整覆盖时，必须在 `coverage_limit` 中说明。

### 7. 评分、校准和晋级

按 `references/quality-and-scoring.md` 给候选评分。每条候选必须分别记录：

- `Fact status`
- `Pattern maturity`
- `Interpretation confidence`
- `Opportunity validation`

不要再用一个 Confidence 同时表达事实真实性、模式成熟度、解释可信度和内容机会。

强制晋级规则：

- `Priority score < 75` 不得进入 Top Cards。
- 分数四舍五入到 5 的倍数，并保留 N/I/E/D/L/C/Penalty 分解。
- `Single event` 不得获得 `High` 的解释置信度。
- 无历史基线时不得使用“稳定、持续、正在成为、注意力迁移”等确定性模式标题。
- `Write` 作为第一行动时，内容供给必须 `Supply-audited / Validated`，承重事实无阻断性未核实项，`queue_status=ready`。
- 还需补知识或事实时使用 `Learn → Write`；还需找证据时使用 `Explore → Write`。

默认保留 3–5 张 Top Cards，目标 4 张。宁缺毋滥；弱信号放入 Emerging Signals、Explore 或 Watch。

### 8. 写报告并验证

严格按 `references/report-format.md` 写一份人读的 Markdown 报告。报告正文面对本人时使用“你”，不要反复写“他”。

先写 Registry 和 Verification Ledger，再计算哈希，最后生成报告 YAML frontmatter。主报告只保留决策所需信息；完整搜索结果、页面正文、分数理由和核实细节留在 `tmp/insight-work/<week>/`。

写完后运行：

```bash
python -X utf8 skills/personal-intelligence-radar/scripts/lint_report.py \
  "<VAULT_ROOT>/99 - 个人工作台/02 - 洞察/<week>-社媒洞察.md" \
  --manifest "tmp/insight-work/<week>/manifest.json" \
  --registry "tmp/insight-work/<week>/candidate-registry.json" \
  --ledger "tmp/insight-work/<week>/verification-ledger.jsonl"
```

修复所有 error；逐条处理 warning。确认报告可独立阅读后再交付。

## 不可妥协的分析规则

- 不把“大家在聊什么”当作最终洞察。
- 不把互动量直接等同于重要度、真实性或总体代表性。
- 不跨平台直接相加点赞、评论或转发量。
- 不根据 Reddit/X 中未出现某话题断言该话题不重要；它们经过上游 Top-N 筛选。
- 不用单条高赞观点代表整个群体。
- 不把评论中的挑战当作已经证实的事实。
- 不把多个媒体或账号转发同一新闻当作多条独立证据。
- 不把自己的解释写成材料中的事实。清楚标记 Observation、Interpretation 和 Hypothesis。
- 不制造精确百分比，除非分母和计数可从材料中完整复现。
- 不虚构原文、引语、链接、作者轨迹或跨周变化。
- 只有单周材料时，不宣称某人物“观点发生变化”。
- 搜索到很多页面不等于获得很多独立证据。
- 搜索工具只负责找到证据，不负责宣布判断已经被验证。
- 搜索可以核实事件，不能把一个事件制造成模式。
- 不遗漏重要但证据不足的方向；放入 Explore 或 Watch。
- 不为了凑数量保留平庸洞察。

## 这个工作台特有的几条

从上一版 skill（`social-insights`）实际用下来攒的，框架里没有但每次都成立：

- **不要翻译了事。** 材料一半是英文，把原帖译成中文摆出来不是洞察，是搬运。引用原文是为了支撑判断，不是为了充篇幅。
- **报告写完就停，不要自己去调 intake 存素材。** 摘哪一段是他读的时候的决定——工作台的洞察页能划词批注、一键存素材，那一步归他。
- **交付时说清报告落在哪**：`99 - 个人工作台/02 - 洞察/<week>-社媒洞察.md`，在工作台「洞察」页能读。
- **一周跑一次就够。** 跑太勤会拿到大量重复事件，反而稀释信号；“在变什么”本来就需要跨周。
- **有上一周的材料就拿来对比。** `99 - 个人工作台/02 - 洞察/_material/` 里按周排列，读得到上一周就读；单周快照答不了“什么变了”。

## 完成标准

只有同时满足以下条件才算完成：

1. 三类材料的覆盖和上游选择偏差已说明。
2. 所有核心雷达均已检查，对无证据部分明确说明。
3. Evidence Ledger、Candidate Registry 和 Verification Ledger 已保存到 `tmp/insight-work/<week>/`。
4. Top Cards 均通过 75 分晋级线，且有可追溯证据、独立性判断和四轴校准。
5. 承重事实已核实或明确标为未核实；重要解释已做反向搜索。
6. Write Queue 前列选题已做内容供给审计，或明确标为 Needs research。
7. Learn Queue、Write Queue 和 Watchlist 能直接指导下一步，且状态来自同一 Registry。
8. 每个重要判断区分事实、模式、解释和假设。
9. 报告通过 `lint_report.py`，没有占位符、伪造精度、行动计数冲突或版本哈希错误。

## 资源

- `VERSION`：当前 Skill 版本。
- `fetch-material.mjs`：现有确定性抓取器；保留原实现和个人配置。
- `scripts/prepare_materials.py`：验证三份 Markdown、生成覆盖清单并无损分块。
- `scripts/web_research.mjs`：Brave Search 发现来源、Firecrawl 抽取所选页面；默认 dry run。
- `scripts/lint_report.py`：检查报告结构、晋级门槛、Registry/Ledger 一致性和长度预算。
- `references/input-contract.md`：输入形状、抓取器边界和上游筛选偏差。
- `references/analysis-framework.md`：完整的个人情报分析框架。
- `references/quality-and-scoring.md`：证据独立性、评分、四轴校准和晋级规则。
- `references/run-artifacts.md`：Evidence Ledger、Candidate Registry、Verification Queue 和 Ledger 契约。
- `references/verification-protocol.md`：Brave + Firecrawl 后置核实、反证和内容供给审计。
- `references/report-format.md`：最终报告结构、Insight Card 和 Queue 模板。
