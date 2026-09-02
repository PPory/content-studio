# AI-Native 内容创作重构

接着读：[`内容桥接-产品模型.md`](内容桥接-产品模型.md)（内容机会的数据模型与真实性边界）、[`内容桥接-阶段决议.md`](内容桥接-阶段决议.md)（上一阶段的范围判断）。

本文**替代**此前按 Stage 依次加功能的推进方式。数据模型和工程底座大部分保留，要重构的是：用户怎样和自己的知识、现实里的问题、AI 与反馈发生关系。

分支不变，仍是 `experiment/content-bridge`。

## 一、为什么重构

数据模型这一层是合理的：

```text
Living Wiki × Audience Problem × Agenda
        ↓
Content Opportunity → Project → Publication → Experiment
```

但界面把这个数据模型**直接实现成了操作流程**：选 Wiki → 选 Problem → 选 Agenda → 看 AI 预览 → 确认。这是在操作数据库，不是在创作。

真实的创作行为更接近：

```text
我的全部知识积累  +  现实里大家正在困惑的东西
                ↓
            交给 AI 去找值得连接的部分
                ↓
        我判断：这条值得讲
                ↓
        AI 和我继续构造
```

## 二、职责划分

这是整个重构最重要的一条原则。

**AI 负责寻找和提出**：阅读上下文、检索、聚类、去重、比较、找连接、找冲突、找认知差、找支持材料、找反例、找证据缺口、提出构造路线、提出大众入口、提出实验假设、分析发布结果、提出学习结论。

**人负责判断和确认**：这个判断是不是我的？这条连接值得继续吗？这个经历真实吗？这条我想不想讲？要不要保存、要不要采纳、要不要发布？AI 的解释我认不认同？

推广成产品级交互原则：

> **Infer before Ask** —— 在显示任何输入框之前先问：这个值能不能从现有上下文提出一个合理候选？能，就先给候选再让用户确认或编辑；不能，才给空白输入。

Positioning（涌现定位）已经验证过这条原则的完整形态，包括它的下半句：

> **数据不够时说「还看不出来」，并且说清还差多少。** 不画看起来很满的仪表盘，也不给没有数字的鼓励。

## 三、现役实现映射（KEEP / DEMOTE / REPLACE / ADD）

判定基于对现役代码和真实工作区的一次实测（2026-09-02）。

### ContentBridge

| 部分 | 判定 | 说明 |
| --- | --- | --- |
| `#/bridge` 概览（已保存机会 + 问题侧栏） | REPLACE | 首屏改成 AI Discovery |
| 双栏 Wiki × Problem 选择器 + 结果分段 | DEMOTE | 搬到 `#/bridge/manual`，改名「手动探索」；深链继续可用 |
| 「从议程拎问题」 | KEEP，换位置 | 能力正确，但不该是首页常驻的劳动按钮 |
| 「从洞察报告提取」 | KEEP（休眠） | 代码正确，缺数据源 |
| 「自己记一个问题」表单 | DEMOTE | 降为原始声音录入的 fallback |
| 单文件 891 行 | REPLACE | 拆成 Discovery 首页 + Manual 探索两页 |

### Audience Problems

| 部分 | 判定 | 说明 |
| --- | --- | --- |
| `audience_problems` / `audience_problem_sources` | KEEP | `origin` 与 `source_kind` 正交这条设计是对的 |
| 逐字 quote 硬闸 | KEEP，不许弱化 | |
| 「必须先建 Problem 才能发现连接」 | REPLACE | Candidate 可以携带尚未入库的 inline problem |
| 原始声音的不可变证据层 | ADD | `audience_raw_sources` |

### Agenda

| 部分 | 判定 | 说明 |
| --- | --- | --- |
| `content_agendas` 表 + 手动创建 | KEEP 为 fallback | 「自己写」这条路永远保留 |
| Agenda 作为 Discovery 的输入 | KEEP | 它已经不是硬前置（`agenda_id` 可空） |
| Agenda Candidate（AI 观察长期模式） | ADD，推迟 | 触发条件是「已有足够多、足够异质的真实行为数据可以观察出重复模式」，不是一个固定日期 |

### Experiment

| 部分 | 判定 | 说明 |
| --- | --- | --- |
| 「假设必须先于发布」硬闸 | KEEP，不许弱化 | 学习闭环唯一的不变式 |
| 发布前的空白假设输入框 | REPLACE | AI 先提 Hypothesis Candidate |
| 结算三个空白框 | REPLACE | AI Settlement Preview |
| 从反馈读用户问题（逐字 quote） | KEEP | 已经是正确形态 |
| 手动填写 | KEEP 为 fallback | 「自己写」 |
| Observation / Inference / Learning 三分 | ADD | |

### Positioning

**KEEP，一个字不改。** 零输入字段、全部从已有链路算、数据不够时说清还差几条。它是本次重构要推广的样板，不是要改的对象。

### Assistant

| 部分 | 判定 | 说明 |
| --- | --- | --- |
| Pi runtime / 权限模式 / 受控工具 | KEEP | |
| 三个候选出口（新内容 / 收进知识库 / Wiki 页面） | KEEP | 已存在，都走候选 + 待确认动作 |
| User turn 与 Assistant turn 的真实性区分 | ADD | 目前完全没有 |
| 对话 → Discovery 的「最近研究方向」 | ADD，推迟 | 对话可以决定「看哪里」，不能决定「什么是真的」 |

### Living Wiki

**KEEP，全部。** 页面、来源引用、来源快照、变更集、逐字 grounding、候选后确认——Discovery 只读它，不碰它。轻量索引（id/title/summary/pageType/updatedAt）直接复用现有查询。

### Project Workspace

| 部分 | 判定 | 说明 |
| --- | --- | --- |
| 正文是绝对视觉主体 | KEEP | |
| 创作意图面板（问题 / 核心判断 / 议程 + AI 动作） | KEEP | 「继承意图」和「Assistant 理解 Opportunity」已经做到了 |
| 创建项目后不自动生成全文 | KEEP | |
| 「帮我搭一个结构」→ Outline Candidate | ADD | |
| 多来源构造 | ADD | `construction_json` 已允许，不用改表 |

### Radar / Insights

| 部分 | 判定 | 说明 |
| --- | --- | --- |
| 热点三栏（不分析、不代写） | KEEP | 这份克制是对的 |
| 本地「洞察」生成 | REPLACE，低优先级 | 当前只是把最近素材拼成一段 markdown |
| 热点 → Audience Problem | ADD，之后 | 中间必须过原始声音，热榜条目本身不等于有人在困惑 |

### Command Palette

| 部分 | 判定 | 说明 |
| --- | --- | --- |
| 检索 + 继续上次工作 | KEEP | |
| 「记一个用户问题」行 | REPLACE | 入口已存在，但落点是一张要填 statement + summary 的表单 |
| 粘贴原文 → 一个输入框 | ADD | 改造落点，不新建入口 |

### 不在本轮动的

Ideas / Seeds / Materials / Captures / Metrics 全部 KEEP，不动。

## 四、真实性硬闸（不因交互变智能而弱化）

1. 个人经历、Wiki 引用、逐字 quote、freshness、候选确认、幂等、审计、原始来源完整性，全部保留。
2. `origin=hypothesis` 的问题，任何文案都不得写「大家都在问」「普遍存在」，只能写「你认为这可能是一个受众问题」或「尚待真实反馈验证」。
3. **真实性不能只靠 `origin='observed'` 一个字段判断。** 证据等级必须从证据行本身推导，至少分三档：

   | 等级 | 判据 |
   | --- | --- |
   | 真实原话 | 证据指向不可变原始声音，且逐字可定位 |
   | 人工记录 | 手工录入，没有可回溯的原始证据 |
   | 议程假设 | `origin=hypothesis`，没有任何证据行 |

   界面不得把「人工记录」显示成「N 条真实反馈」。
4. 工作区没有个人经历来源时，**提前阻断**经历型：模型不得返回经历型主导动作，界面不展示经历型路线，用户主动切换时明确提示「先补一段真实经历」，不生成空壳候选。不能等保存时才报错。
5. Preview ≠ Persist。预览一律不写库；「发展这条」也不写；只有用户点「保存为内容机会」才在一个事务里正式创建。
6. AI 模型失败不是单点故障：Discovery 失败不影响已有内容机会、问题和 Wiki，用户仍可重试、手动探索、继续已有内容。

## 五、原始声音（Raw Audience Evidence）

现实里的问题不会先被整理成漂亮的 Audience Problem。因此需要一个极低摩擦的入口：

```text
Ctrl / Cmd + K → 记录用户声音 → 粘贴群聊 / 评论 / 私信 / 访谈原话 → 保存
```

不要求用户先填问题名称、摘要、pattern、why it matters。来源名称、链接、时间可选。AI 后续自己读。

存储层职责限定为**「现实世界原始用户声音的不可变证据层」**，不是新的素材库，也不是新的一级管理页面：

- 保存后正文不可编辑；录错就新增一条，不覆盖旧证据；
- Audience Problem 必须能回到这里的逐字原文；
- AI 从中提取问题时继续做逐字校验；
- 原始声音本身不是 Audience Problem，AI 只从中提出候选。

## 六、AI Discovery

内容首页的主动作是**「帮我看看最近有什么值得讲」**，而不是两栏选择器。

输入（服务端构造上下文，浏览器不拼知识正文）：

```text
知识侧：Living Wiki 轻量索引（id / title / summary / page_type / updated_at）
现实侧：新导入与尚未分析的原始声音 + 已结构化的 Audience Problems
横向：Agenda（可选）
```

输出：3～5 条 Connection Candidate，每条回答——谁在困惑什么、这是观察还是假设、有什么证据、我的哪些知识能解释它、为什么值得连接、大众卡在哪、可能留下什么判断、缺什么。

不用分数，只用 `strong / medium / weak`（界面写成「很自然 / 值得继续 / 比较牵强」）。

**允许并且必须允许 AI 说「最近没有值得做的」**，然后给出下一步：导入真实用户声音 / 从议程推导待验证问题 / 手动探索。不为了让页面看起来智能而硬生成。

### 上下文预算

实测：100 个 Wiki 页的 `title | page_type | summary` 索引合计约 5000 字符。当前规模下一次调用喂全量索引即可，**不需要 N×M 两两比较，也不需要向量检索或候选池**。

原始声音不同：一段群聊可能就是几万字。第一版只喂新导入的和尚未分析的，历史原文不每次重发；原始声音在被分析后记录分析状态，后续 Discovery 复用已结构化的结果。

现有中文检索是 `LIKE` 匹配，不是可靠的中文语义召回，**不得当作召回层**。

### 缓存

高成本动作不能每次打开页面就跑。缓存扫描结果并显示上次扫描时间，输入没有实质变化时复用，用户可主动重新扫描。

缓存指纹必须覆盖 Wiki、Audience Problems、Agenda **和原始声音**（条数 + 最新时间）——刚粘完一段群聊却还看到旧扫描结果，是这套缓存最容易犯的错。

## 七、阶段计划

### 第一批（本轮）

只验证一个体感：

> 我不再自己从两个库各挑一个东西，而是系统主动读我的知识和真实用户声音，给我几个值得判断的连接。

```text
Commit A  feat(audience): add immutable raw audience evidence
Commit B  refactor(content): make AI discovery the primary entry
```

两个独立 commit，同一批交付。顺序是 A 在前：Discovery 从第一天就应该针对最终的证据模型设计，而不是先针对 `audience_problems` 做一版再回来扩上下文。

第一批**不做**：Agenda Candidate、Experiment AI、对话 → 知识/内容。

### 验收标准

不以「代码写完、测试通过」为完成。要做到：

1. 粘一段真实群聊或评论；
2. 回到内容首页；
3. 系统能读出其中真正的问题；
4. 它自己从 Wiki 里找到相关知识；
5. 给出的不是十个选题，而是 3～5 个有理由、有来源的连接；
6. 至少有一条产生「这个我原来没有主动想到，但确实值得讲」的感觉；
7. 全程不需要先维护 Audience Problem 数据库。

现有手动探索仍然工作。

### 后续

```text
P2  多来源内容构造：AI 在整个工作区找可用要素，给 2～3 条构造路线，自然语言继续推
P3  AI Experiment：假设候选 → 发布 → 结算候选 → 用户确认 Learning
P4  对话 → 知识 / 内容：Assistant 成为知识形成和内容发现的入口之一
```

Agenda Candidate 在 P2 之后，按数据量触发，不按日期。

## 八、终点判据

这个项目的目标不是「AI 帮你自动生产更多内容」，而是「AI 帮你看到更多关系，让你做更好的判断」。

如果实现越来越像**内容管理后台 + AI 按钮**，或者退化成一键生成选题、一键出稿、一键发布，就停下来重新判断：

> 这一部分到底是在让 AI 帮用户思考，还是又让用户替系统整理数据？
