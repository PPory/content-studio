# 最终报告格式（Schema 2）

## 目录

1. 默认文件、层级和篇幅
2. YAML frontmatter
3. 强制结构
4. Insight Card 模板
5. Queue 模板
6. 写作风格
7. 交付前检查

## 1. 默认文件、层级和篇幅

默认保存为：

```text
洞察/<YYYY-Www>-社媒洞察.md
```

目标：第一次阅读 10–15 分钟即可做出本周注意力、学习和写作决策。

默认预算：

- 主报告建议不超过 18,000 字符；超过 24,300 字符视为结构失败。
- 一页结论：350–650 汉字。
- Top Insight Cards：3–5 张，默认 4 张。
- 单张 Top Card：建议不超过 2,200 字符。
- Learn Queue：3–6 项。
- Write Queue：2–5 项。
- Watchlist：3–7 项。

完整搜索结果、页面正文、证据 Ledger 和详细评分留在 `tmp/insight-work/<week>/`，不要全部塞进主报告。

### 三层阅读结构

1. **决策层**：一页结论——只写本周该写什么、写前先学什么、继续观察什么、可以忽略什么。
2. **判断层**：Top Cards——解释为什么。
3. **执行层**：各 Queue 与 Source Gems——给出下一步。

同一洞察不要在五个章节完整重写。后续表格使用 `IC-xx` 或候选 ID 引用。

### 分区标题和字段名一律中英双语，中文在前

这是一份中文报告，而 `Fact status` / `Opportunity validation` / `Emerging Signals`
这套词汇只在这个系统内部存在——纯英文的话，读的人每碰到一个都要先在脑子里翻译一遍。
写成 `**事实状态 Fact status：**` 和 `## 本周重点 Top Insight Cards`：
中文管阅读，英文管和 Registry / Ledger 里的字段对上号。

lint 两边都认（`_field_pattern` 允许英文字段名前后带中文注解，二级标题按「包含」匹配），
所以**改显示措辞不会把 lint 弄红**，但**英文那一截不能动**——它是和工件对齐的锚点。

### 这周没东西的分区不要画空壳，但必须点名

「必须逐项检查」是对**分析**的要求，不是对**阅读**的要求。一个只写着「本周材料不足」
的分区，对读的人只是多翻一屏。

- **必有**（少一个报告就不成立）：一页结论 · 数据覆盖与证据边界 · Top Insight Cards ·
  Write Queue · 核实记录与局限
- **可缺**：本周新信号 · Learn Queue · 值得持续追踪的问题 · 认知冲突与反共识 ·
  跨领域连接 · 人物与注意力迁移 · Source Gems · Noise / Ignore
- **缺了就必须在 `## 本周未产出的雷达项` 里逐个点名并说明原因**（材料不足 / 本周无候选 /
  证据不独立…）。少了这一节，读的人分不出**「查过了没有」和「压根没查」**——
  而那正是这套框架最不该丢的东西。lint 会检查缺席项是否在这一节里被点到名。

## 2. YAML frontmatter

报告必须以以下 frontmatter 开始：

```yaml
---
week: 2026-W33
report_schema: 2
skill_version: 2.0.0
generated_at: 2026-08-12T20:00:00Z
material_manifest_sha256: <sha256>
candidate_registry_sha256: <sha256>
verification_ledger_sha256: <sha256-or-none>
---
```

要求：

- 先完成 `candidate-registry.json` 和 `verification-ledger.jsonl`，再计算哈希。
- `generated_at` 使用绝对时间。
- 没有联网核实时，仍生成空或只含 `not_applicable` 的 Ledger，并记录其哈希；不要写虚构 hash。

## 3. 强制结构

```markdown
# <YYYY-Www> 个人情报周报

> 覆盖周期：[start date] — [end date]
> 材料：[reddit file] · [x file] · [aihot file]
> 生成日期：[absolute date]

## 一页结论

[一个连贯的决策摘要：本周最硬的结构变化；最值得学的一件事；最值得写的一件事；最大不确定性。]

**本周行动分配：** Write [N] · Learn [N] · Explore [N] · Watch [N] · Ignore [N]

## 数据覆盖与证据边界

[文件完整性、规模、日期范围、Top-N / 详写 / 截断规则、网络核实范围和不可外推之处。]

## 本周重点 Top Insight Cards

### IC-01｜[结论式标题]
[按第 4 节模板]

## 本周新信号 Emerging Signals

[未进入 Top Cards，但值得 Watch / Explore 的弱信号。]

## 该学什么 Learn Queue

[按第 5 节模板]

## 该写什么 Write Queue

[按第 5 节模板]

## 值得持续追踪的问题 Watchlist

[按第 5 节模板]

## 认知冲突与反共识

[双方最强论据、隐藏前提、待验证证据。]

## 跨领域连接

[来源领域、映射和类比边界。]

## 人物与注意力迁移

[有历史基线时写迁移；单周只写本周注意力分布和待验证假设。]

## 原始材料精选 Source Gems

[3–8 条真正值得打开原文的材料。]

## 噪音与可忽略 Noise / Ignore

[可放心不投入注意力的内容簇与重新打开条件。]

## 本周未产出的雷达项

[**只在真的缺席分区时才写。** 逐个点名并说明原因：材料不足 / 本周无候选 / 证据不独立…
少了这一节，读的人分不出「查过了没有」和「压根没查」。]

## 核实记录与局限

[承重 claim 的状态、关键来源、冲突、内容供给审计覆盖限制和仍未解决的问题。]

**下次运行先补（跨周挂账）**

| ID | 动作 | 为什么 |
|---|---|---|
| PA-0x | [下次运行要先做的动作] | [这次为什么没做完] |

[结掉的用删除线保留一行并写明结果，不要删——删了看不出这条挂了几周。]
```

**挂账这一节的真源是 registry 的 `pending_actions`，报告只是渲染它**（契约见
`references/run-artifacts.md` §3.1）。两边都要有：只写 registry，用户读不到；
只写正文，下次跑的人可能跳过那段——**上一轮就是这么丢的**。
lint 会检查每条 `status: "open"` 的挂账是否在报告里被点名。

## 4. Insight Card 模板

卡片开头的元数据必须和 Candidate Registry 一致，**排成三行引用块**：

```markdown
### IC-01｜[结论式标题]

> **行动 Action：** Learn → Write　**优先级 Priority score：** 85　**评分构成 Score basis：** N5/I5/E3/D5/L4/C5/P5
> **事实状态 Fact status：** Official claim only　**模式成熟度 Pattern maturity：** Cross-source
> **解释置信度 Interpretation confidence：** Medium-high　**机会验证 Opportunity validation：** Supply-audited
```

**为什么是三行引用块，不是七行 bullet。** 这七个字段是给审计用的（为什么它排第一、
判断有多硬），不是给阅读用的。排成七个 bullet 时它们和正文的 bullet 一样重，
而且整整齐齐挡在标题和第一句话之间——每读一张卡都要先跨过一段不是给你看的东西。
引用块把它们收成一个视觉单元，一眼能跳过；三行按语义分组：
**做什么、多重要 / 证据有多硬 / 判断有多稳**。

字段之间用**全角空格**分隔（lint 靠 `\s+\*\*` 断句）。**不要再压成一行**——
一行七个字段就又变回一串谜语了。

字段值：

- Fact status：`Primary verified / Official claim only / Independently corroborated / Secondary only / Unverified / Contradicted / Not applicable`
- Pattern maturity：`Single event / Recurrent / Cross-source / Cross-week / Conceptual / Material observation`
- Interpretation confidence：`High / Medium-high / Medium / Low`
- Opportunity validation：`Not assessed / Material-only / Supply-audited / Validated / Not applicable`

继续使用：

```markdown
**信号 Signal / Observation**

[材料中直接观察到什么。使用“在本周已筛选材料中”等限定语。]

**证据 Evidence**

- [原始来源](URL) — [日期、内容完整性、它具体支持什么、依赖组]
- [第二来源](URL) — [是否独立]
- **反证与局限 Counterevidence / limitation：** [反例、上游筛选、截断、单事件或无基线限制]

**为什么重要 Why it matters**

[为什么值得分配注意力。对本人写“与你……相关”，不要写“他……”。]

**底层模式与解释 Underlying pattern / Interpretation**

[解释机制；明确是分析而非材料原话，并给出竞争解释。]

**认知冲突 Cognitive conflict**

[两个合理判断之间的张力；不足时写“本周材料不足”。]

**知识缺口 Knowledge gap**

[要补的具体概念、原始材料或方法；给出边界。]

**与你的相关性 Personal relevance**

[与当前工作、知识、平台和四个问题的关系。使用第二人称。]

**内容机会 Content opportunity**

- **主类型：** [六种核心类型之一]
- **缺口：** 解释 / 视角 / 实操 / 反方 / 整合
- **Supply Audit：** [查询范围、最接近的现有内容、真实缺口、coverage limit；未做时只写“本周材料中未见”]
- **个人适配：** [来自 creator profile 的具体判断]

**可能的切入角度 Possible angles**

1. `[标题 / 文章承诺 A]` — [读者获得什么]
2. `[切口明显不同的 B]`
3. `[可选 C]`

**跨领域连接 Cross-domain connection**

[来源领域、概念、映射和类比边界。]

**待解问题 Open question**

[具体问题、可观察触发器和复查时间。]

**核实情况 Verification**

[逐 claim 的简要结果：事实状态、关键来源、仍缺什么，以及允许使用的报告措辞。]

**什么会推翻这个判断 What would change my mind**

[什么新证据会削弱、推翻或限定判断。]
```

### 标题强度必须匹配模式成熟度

- Single event：`一个健身房事件暴露了多方对齐缺口`。
- Cross-source / Cross-week：才可使用 `正在转向 / 稳定出现 / 持续上升`。
- 无历史基线：不得写 `稳定内容位 / 注意力正在迁移`。

### 卡片压缩规则

- Evidence 只列最承重的 2–4 条，完整列表留 Ledger。
- Cross-domain 没有真实解释增量时写“本周材料不足”，不要硬凑。
- 队列中只引用卡片 ID，不复述整段 Why it matters。
- 两张相关事件卡能合并成 Meta Insight 时，优先合并。

## 5. Queue 模板

所有表格增加 `来源 ID`，确保状态可回到 Candidate Registry。

### 本周新信号

```markdown
| 来源 ID | 信号 | 变化或异常 | 证据范围 | 当前判断 | Action / Confidence |
|---|---|---|---|---|---|
| C-07 | [signal] | [from A to B / weak signal] | [sources] | [why it may matter] | Watch · Medium |
```

### Learn Queue

```markdown
| 优先级 | 来源 ID | 学习节点 | 为什么现在学 | 学习边界 | 一手起点 | 预期产出 |
|---:|---|---|---|---|---|---|
| 1 | IC-01 | [specific concept] | [它解锁哪个判断] | [学什么；不扩张到什么] | [paper/docs] | [核查清单/论证骨架] |
```

### Write Queue

```markdown
| 优先级 | 来源 ID | 选题 / 文章承诺 | 机会类型 | 核心主张 | Supply Audit | 准备度 | 最佳载体 / 时效 | 下一步 |
|---:|---|---|---|---|---|---|---|---|
| 1 | IC-02 | [title/promise] | [type + gap] | [thesis] | [verdict + limit] | Ready / Needs research / Weak signal | [公众号 / 7 天] | [draft / verify] |
```

准备度与 Action 必须一致：

- `Ready` → 可以 `Write`。
- `Needs research` → 必须 `Learn → Write` 或 `Explore → Write`。
- `Weak signal` → 不得把 Write 作为第一行动。

### Watchlist / Open Questions

```markdown
| 来源 ID | 问题 | 当前证据 | 竞争解释 | 观察触发器 | 下次复查 |
|---|---|---|---|---|---|
| C-09 | [specific question] | [known] | [A vs B] | [observable event/data] | [week/date] |
```

### 认知冲突

```markdown
| 来源 ID | 张力 | A 方最强论据 | B 方最强论据 | 隐藏前提 | 需要什么证据 |
|---|---|---|---|---|---|
| IC-01 | [conflict] | [steelman] | [steelman] | [assumption] | [test] |
```

### 跨领域连接

```markdown
| 来源 ID | 当前问题 | 来源领域 / 概念 | 可迁移结构 | 类比边界 | 可形成的验证 |
|---|---|---|---|---|---|
| IC-01 | [problem] | [domain] | [mapping] | [where analogy fails] | [test] |
```

### 人物与注意力迁移

```markdown
| 人物 / 群体 | 本周注意力 | 支撑材料 | 与历史相比 | 下一步观察 |
|---|---|---|---|---|
| [name] | [topics] | [links] | Confirmed shift / Hypothesis / No baseline | [comparison] |
```

### Source Gems

```markdown
| 来源 ID | 原始材料 | 类型 | 核心观点 | 更新什么认知 | 可用在哪里 | 为什么读原文 |
|---|---|---|---|---|---|---|
| IC-03 | [linked title] | Paper | [point] | [update] | Learn + Write | [what summary misses] |
```

### Noise / Ignore

```markdown
| 来源 ID | 内容簇 | 为什么暂时忽略 | 风险 | 重新关注条件 |
|---|---|---|---|---|
| C-12 | [cluster] | [reason] | [what may be missed] | [trigger] |
```

## 6. 写作风格

- 使用结论先行的中文，首次出现时解释必要英文术语。
- 面向本人统一使用“你”，不要把 creator profile 以第三人称暴露在报告中。
- 每段回答一个问题，避免多个判断挤进超长 bullet。
- 清楚区分事实、模式、解释和假设。
- 使用绝对日期。
- 链接原帖和一手来源；引用短而准确。
- 避免“值得关注、引发思考、持续观察”这类没有宾语和触发条件的套话。
- 不把所有信号包装成宏大趋势。
- 不用一个 Verified 覆盖“事实成立但解释仍早期”的情况。
- 不因搜索到很多网页就提高独立证据数量。
- 一页结论不是 Top Cards 的机械摘抄，而是决策压缩。

## 7. 交付前检查

- frontmatter 版本与三个 sidecar hash 可复现。
- 一页结论行动计数与 Candidate Registry 一致。
- Top Cards 只有 3–5 张，且每张分数至少 75。
- 分数是 5 的倍数，并显示 N/I/E/D/L/C/Penalty。
- 每张卡有 Fact status、Pattern maturity、Interpretation confidence、Opportunity validation。
- Single event 没有 High 解释置信度，也没写成稳定趋势。
- 无历史基线时没有“迁移、稳定、持续”等确定结论。
- Primary Action=Write 的候选完成 Supply Audit、queue_status=ready、无未核实承重事实。
- Needs research 的 Write Queue 行对应 Learn → Write / Explore → Write。
- 每个 Learn 候选有边界和一手起点。
- 每个 Watch 问题有触发器和复查时间。
- Source Gems 只保留真正值得读原文的材料。
- 跨领域连接写了类比边界。
- 报告正文使用第二人称。
- 主报告不超过长度预算，重复内容已经压缩。
- 没有 TODO、TBD、伪造百分比、伪造引语或无法追溯的结论。
