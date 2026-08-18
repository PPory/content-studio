# 输入契约、上游偏差与抓取器边界

## 目录

1. 输入文件
2. 三类材料的已知形状
3. 上游筛选造成的证据边界
4. 抓取器编排契约
5. 可选的个性化上下文
6. 分析时必须保留的限定语

## 1. 输入文件

默认每个 ISO 周读取三份 Markdown：

```text
洞察/_material/<YYYY-Www>-reddit.md
洞察/_material/<YYYY-Www>-x.md
洞察/_material/<YYYY-Www>-aihot.md
```

总量通常约 200 KB、约 5 万 token。每份文件包含 YAML frontmatter 与供人阅读的 Markdown。字段通常齐全，但以散文和列表嵌入，不是规范化记录。

只分析渲染后的 Markdown。除非用户明确改变输入契约，否则不要读取：

```text
<workbench>/tmp/{reddit,x,aihot}-raw-*.json
```

预处理脚本可以把 Markdown 无损分块或建立索引，但不得回到 raw JSON 补充被筛掉的信息。Brave Search / Firecrawl 得到的网页只用于核实承重事实、寻找反证和审计内容供给，不得被当成第四个社媒样本源重新计算热度或平台分布。

## 2. 三类材料的已知形状

### Reddit

常见分区：

- `热议`
- `长文`
- `有讨论但没抓到内容`

典型条目：

```markdown
### 1. [标题]

- 来源：[subreddit] · [author] · ↑[score] · 💬[comments] · [timestamp]
- 链接：[URL](URL)

[正文，可能被截断]

**评论（按赞数）**

- （↑N）[comment]
```

注意：正文可能截断到约 1200 字；评论通常只保留按赞数排序的前若干条；“没抓到内容”分区可能只有标题和元数据。

### X / Twitter

通常按账号分组，每个账号下列出若干高互动帖子。具体 heading 层级可能变化，因此按实际 Markdown 层级读取，不要假设固定的 `###` 或 `####`。

注意：按账号 Top-N 展示意味着它适合观察“被选账号本周的高互动表达”，不适合估计该账号完整发言分布，更不适合估计整个平台分布。

### AI 日报 / AIHot

常见五个分区：

- `模型发布`
- `产品发布`
- `行业动态`
- `论文研究`
- `技巧与观点`

通常是合并后的条目流，每条含日期。相较 Reddit 和 X，这一来源可能接近上游全量，但仍要检查 frontmatter 或抓取日志。

## 3. 上游筛选造成的证据边界

当前已知的一组上游默认策略是：

- Reddit：例如抓取 69 条，45 条详写，24 条只保留标题进入索引；每帖只给高赞评论前 8。
- X：每个账号只展示互动最高的 6 条。
- AI 日报：例如全量约 100 条，不做同等级 Top-N 筛选。

这些数字是当前实现和某周实例，不要假设永远固定。优先从本周 frontmatter、抓取日志、脚本参数或 manifest 核实真实值。

由此产生的强制解释规则：

1. **材料不是原始池子。** 它已经带有上游编辑立场。
2. **平台之间的条数不可直接比较。** Reddit/X 经过 Top-N，AIHot 可能近似全量。
3. **缺席不是反证。** 某话题未进入 Reddit/X 材料，可能只是被筛掉。
4. **互动指标只在原平台语境下解释。** 不要把 Reddit score、X likes 和其他平台指标相加。
5. **评论不是总体意见。** Top 8 高赞评论更接近“可见且被投票支持的反应”。
6. **仅标题条目只能作为线索。** 不足以支持深层解释。
7. **截断正文会丢失限定条件。** 涉及高影响结论时打开原链接或标注局限。
8. **账号名单本身也是选择。** People Radar 只能描述被追踪名单，不代表行业全部高手。

把结论表述为：

- “在本周已筛选材料中……”
- “在被追踪的 X 账号里……”
- “Reddit 详写样本显示……”
- “这是一个值得追踪的弱信号，而非总体趋势判断。”

避免表述为：

- “全网都在……”
- “大多数用户认为……”
- “X 比 Reddit 更关注……”
- “没有人讨论……”

除非有额外、可复现的全量数据支撑。

## 4. 抓取器编排契约

抓取器是外部确定性组件，通常名为 `fetch-material.mjs`。本 Skill 不实现它，也不应复制其筛选逻辑到 prompt。

材料缺失时：

1. 在 Skill 目录、vault、`<workbench>`（content-studio 仓库下的 workbench/）或当前项目中查找脚本。
2. 运行 `node <script> --help` 或读取其 README/源码入口，确认真实参数。
3. 优先执行 dry run 和预算预估。
4. 网络失败时优先使用脚本支持的 `--from` 离线重放。
5. 中断或部分成功时优先使用 `--snapshot` 恢复。
6. 保留原始错误输出和失败来源，避免把抓取 bug 误判成“本周无信号”。
7. 不硬编码用户没有提供的账号白名单、字段名、预算或接口密钥。

只有在用户明确要求生成该周报告、且现有工作流已授权付费抓取时，才可自动触发真实抓取。否则只报告缺失材料与建议命令，不擅自花费。

## 5. 可选的个性化上下文

若存在创作者画像、主题范围、知识图谱或过去选题记录，可在分析时读取，例如：

```text
洞察/_config/creator-profile.md
洞察/_config/interests.md
洞察/_config/published-topics.md
```

这些文件不是必需输入。没有画像时：

- 仍可评估话题需求、解释缺口和材料丰富度。
- 不要伪造“你擅长”“你已经写过”或“与你定位高度匹配”。
- 把“个人适配度”标为 `Unknown / 需要创作者判断`。

## 6. 分析时必须保留的限定语

在内部 Evidence Ledger 中为每条证据保留：

- `source_file`
- `section`
- `date`
- `author_or_community`
- `title`
- `url`
- `visible_metrics`
- `content_status`: full / truncated / title-only / secondary
- `selection_context`: all / top-n / detailed-sample / unknown
- `verification_needed`

任何重要洞察都要能回溯到至少一个原始材料链接。无法定位链接时只能进入 Explore/Watch，不能成为 Top Insight。外部网页的检索与抽取记录放在 `tmp/insight-work/<week>/web/`，核实结论放在 `verification-ledger.jsonl`；不要把搜索摘要当作已读原文。
