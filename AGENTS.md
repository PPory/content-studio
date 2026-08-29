# content-studio

个人 AI 内容创作流水线。

产品说明看 [`README.md`](README.md)；目标流程看 [`docs/工作流.md`](docs/工作流.md)。

`docs/工作流.md` 会明确标注目标流程与当前实现之间的距离。加功能前先判断它属于：

* 反应
* 挑一个写
* 看效果

中的哪一步，再以当前代码和测试确认实际现状。

---

# 项目结构

```text
worker/      Cloudflare Worker：D1、定时任务、Bot、/wb/* 业务端点

workbench/   本地工作台：React + Vite、本地 API、Pi Agent SDK
```

两个包独立维护。

不要新增共享业务包。

* Worker 部署到 Cloudflare。
* workbench 只在本地运行。
* `npm run build` 对 workbench 仅用于编译验证。

进入具体包工作前，读取该包现有的局部说明：

* 修改 `worker/` → 阅读 `worker/CLAUDE.md`
* 修改 `workbench/` → 阅读 `workbench/CLAUDE.md`

在以后存在对应的子目录 `AGENTS.md` 后，优先使用子目录 `AGENTS.md` 作为跨 Agent 的局部规则。

---

# 跨包边界

## 1. Worker / D1 是业务真源

状态、字段、关系、幂等、真实性校验、发布和长任务都在 `worker/`。

workbench 可以映射契约值用于展示，但不得另建业务规则。

不要在前端复制后端业务状态机。

---

## 2. 跨包只认 `/wb/*` 契约

workbench 消费 Worker 提供的压平字段。

缺字段时：

1. 先确认现有 Worker 契约。
2. 如果确实缺失，扩展 Worker 响应。
3. 再更新 workbench 消费端。

不得让 workbench：

* 读取 D1 内部结构
* 推测数据库字段
* 依赖未公开的 Worker 内部实现

---

## 3. D1 与 vault 不做双向同步

业务运行态留在 D1。

vault 保存：

* 本地知识
* 人类可读归档

只有端点明确返回：

* `vaultPath`
* `vaultPaths`

时，客户端才能据此处理归档路径。

不要自行根据数据库状态推导 vault 路径。

---

## 4. Pi Agent 只提出候选

Pi Agent 可以：

* 分析
* 建议
* 生成候选
* 提出修改方案

但以下操作不得由 Agent 静默执行：

* 修改正式正文
* 改业务状态
* 发布内容
* 删除内容
* 写入文件
* 执行有副作用的命令

执行前必须说明影响，并由用户确认后通过应用或领域接口执行。

---

## 5. 真实性是代码硬闸

模型生成的个人经历必须经过服务端真实性校验，例如：

`assertGroundedGeneratedText`

不得：

* 为了通过测试绕过真实性校验
* 在前端复制一套弱化版本
* 通过 Prompt 要求代替代码校验
* 为了跑通流程删除硬闸

---

## 6. 系统信息不进入正文

以下信息必须使用结构化字段或系统约束保存：

* 幂等键
* 任务 ID
* 内部关系
* 流程状态
* 技术元数据

不要让正文承担系统状态存储职责。

---

# 改哪个包

以下改动属于 `worker/`：

* schema
* D1
* 状态机
* 后台任务
* Bot
* 流水线提示词
* 业务校验
* 发布逻辑
* `/wb/*` 契约

以下改动属于 `workbench/`：

* UI
* 阅读体验
* 本地 Pi Agent 运行时
* 本地权限
* 本地提示词
* vault
* 桌面集成

跨包改动：

1. 先修改 Worker 契约。
2. 更新 Worker 测试。
3. 再修改 workbench 消费端。
4. 更新 workbench 测试。

同一条业务规则只实现一次。

---

# UI 与前端工作流

本节主要适用于 `workbench/`。

对于以下任务：

* UI 设计
* 页面重设计
* React 组件实现
* 交互设计
* 动画
* 前端体验优化
* UI Review

不要直接开始生成 JSX 和 CSS。

遵循：

**理解需求 → 检查现有实现 → 设计判断 → 复用 → 实现 → 验证**

---

## UI 资源优先级

选择 UI 实现时遵循：

1. 现有项目组件
2. Emil UI 设计判断
3. coss 基础组件
4. ReUI 复杂组件与模式
5. 组合已有组件
6. 自定义实现

核心原则：

**Reuse → Adapt → Create**

不要因为自己写一个组件更快，就重新实现已有能力。

## 设计 Skill 装在哪

`emil-ui`、`coss`、`reui` 三个开发期设计 Skill 住在 **`.claude/skills/`**。

- **不要放进 `.agents/skills/`。** 那个目录会被 Workbench runtime 扫描并作为产品
  Runtime Skill 暴露给用户的 `/` 菜单——开发工具混进产品里。
- **也不要因此把它们删掉。** 删了下一次 UI 工作就没有判断依据，只能凭模型记忆瞎猜
  组件名和 props，而本文件多处明令禁止这么做。
- `.claude/skills/` 两边都满足：Claude Code 读得到，产品运行时读不到。
  ReUI MCP 配置同理留在仓库根 `.mcp.json`。

（2026-08-27 有一次清理按「不是产品 Skill」把它们连同 `.mcp.json` 移进了
`.tidy-trash/`。判断成立，落点错了——现在按上面这条放置，不要再整体移除。）

---

# Emil UI — 设计判断层

对于有意义的 UI、交互或动画任务，使用项目中的 Emil UI Skill。

其职责是回答：

* 这个交互应该怎么表现？
* 是否真的需要动画？
* 用户操作是否得到即时反馈？
* 高频操作是否足够直接？
* 键盘操作是否被动画拖慢？
* 状态变化是否容易理解？
* overlay 的空间关系是否合理？
* 动效时间和 easing 是否合适？
* 是否存在无意义的视觉装饰？
* 是否满足 accessibility 和 reduced motion？

Emil UI 是：

**design judgement layer**

而不是视觉模板。

不要因为使用 Emil UI Skill 就模仿 Emil Kowalski 网站的：

* 字体
* 配色
* 页面结构
* 品牌视觉
* 排版形式

学习的是设计判断，不是网站外观。

---

## UI 决策优先级

发生冲突时按以下顺序判断：

1. 用户意图和任务完成
2. 清晰与可预测
3. 即时反馈与感知速度
4. Accessibility 与输入方式正确性
5. 交互连续性和空间关系
6. 性能
7. 与当前产品的一致性
8. 视觉精致度
9. Delight

不要为了更“漂亮”牺牲更高优先级目标。

---

# coss — 基础组件层

coss 用于标准 UI primitives。

例如：

* Button
* Input
* Field
* Checkbox
* Radio
* Select
* Combobox
* Menu
* Popover
* Tooltip
* Dialog
* Drawer
* Tabs
* Accordion
* Toast
* Command
* Toolbar
* Toggle
* Slider

使用 coss 前：

1. 先确认项目是否已有适合的组件。
2. 如果已有，优先复用。
3. 如果没有，再查看 coss。

使用 coss 时必须查阅已安装的 coss Skill。

不要根据模型记忆猜测：

* component name
* props
* API
* composition pattern

不要自己重新实现 coss / Base UI 已经提供的：

* focus management
* keyboard navigation
* Escape behavior
* ARIA semantics
* disabled state
* screen-reader behavior

---

# ReUI — 复杂 UI 与产品模式层

ReUI 主要用于更复杂的界面组合，而不是取代所有基础组件。

适合优先搜索 ReUI 的任务包括：

* Data Grid
* advanced filters
* Kanban
* Gantt
* Calendar
* File Upload
* Stepper
* Wizard
* Dashboard
* App Shell
* Settings
* CRM
* Analytics
* Onboarding
* complex forms
* complex empty states
* reusable product blocks

复杂 UI 不要先自己设计一个 generic AI dashboard。

先搜索 ReUI 是否已有成熟方案。

---

## 使用 ReUI 的流程

如果 ReUI MCP 可用，把 MCP 当作当前 ReUI 信息的真源。

工作流程：

1. 根据用户真实意图搜索 ReUI registry。
2. 比较相关结果。
3. 阅读真实组件 API。
4. 查看相关示例。
5. 优先采用或适配成熟实现。
6. 替换示例数据为项目真实数据。
7. 适配当前项目 tokens 与架构。
8. 验证 props 和组件 API。
9. 再完成实现。

不得凭模型记忆虚构 ReUI：

* component
* props
* import
* API

---

# coss 与 ReUI 的边界

简单 primitive：

```text
需要一个确认删除 Dialog
→ 优先现有组件
→ 没有则 coss
```

复杂 pattern：

```text
订单管理页面
包含 Data Grid + Filters + Bulk Actions
→ 优先搜索 ReUI
```

如果一个 ReUI block 本身已经提供完整、合理的 primitive 组合：

不要仅为了“全部换成 coss”而机械重构。

一致性重要，但：

**可维护且完整的实现 > library purity**

---

# Primitive Foundation

现有项目技术基础优先。

不要为了使用 coss 或 ReUI：

* 大规模迁移已有组件
* 替换稳定 primitive framework
* 同时引入多套重复基础设施

如果是全新的 primitive，并且项目尚未形成明确基础：

优先考虑 Base UI。

如果 ReUI 同时提供 Base UI 和 Radix UI 实现：

* 项目已有明确基础 → 跟随项目
* 项目没有明确基础 → 优先 Base UI

不要为了理论上的统一破坏现有稳定实现。

---

# Motion

不要默认加入动画。

添加动画前必须能够说明其目的。

合理目的包括：

* 反馈
* 解释状态变化
* 建立空间关系
* 保持视觉连续性
* 改善感知响应速度

高频操作优先：

**immediacy**

而不是：

**visual flourish**

重复的键盘导航不得因为装饰动画产生延迟。

不要仅为了让 AI 生成的界面显得：

* premium
* modern
* alive
* polished

就自动加入：

* glow
* 大面积 gradient
* blur
* floating motion
* exaggerated hover scale
* entrance stagger
* spring bounce

动画没有清楚目的时，默认不加。

---

# UI 状态

实现产品 UI 时，不只检查静态 happy path。

根据组件类型考虑：

* default
* hover
* focus
* pressed
* selected
* disabled
* loading
* empty
* success
* warning
* error

同时检查：

* 长文本
* 空数据
* 快速连续操作
* keyboard-only
* 小屏幕
* reduced motion

---

# UI 完成标准

UI 能渲染不代表任务完成。

完成前检查：

* 是否优先复用了项目现有组件
* primitive 是否检查过 coss
* 复杂 UI 是否在适用时搜索过 ReUI
* 是否使用真实 API，而不是猜测
* keyboard interaction 是否正确
* focus behavior 是否正确
* loading 状态是否合理
* empty 状态是否合理
* error 状态是否合理
* disabled 状态是否合理
* responsive behavior 是否合理
* 动画是否真的有目的
* 是否存在可以删除的无意义动画
* reduced motion 是否得到尊重
* 是否符合项目已有视觉体系
* TypeScript 是否通过
* lint 是否通过
* 相关测试是否通过

最终 Review 的对象是：

**用户界面**

而不只是：

**能编译的代码**

---

# 验证

```powershell
cd worker
npm test
npx wrangler deploy --dry-run --outdir=tmp/dryrun

cd ../workbench
npm run check
npm run test:unit
npm run build
```

修改 UI 或流程后再跑相关 `npm test`。

Agent、写作、桌面或视觉改动按照 `workbench/CLAUDE.md` 的要求追加专项验收。

只有任务明确涉及线上状态且获得授权时，才可以：

* 调用 `/run/<task>`
* 运行 `wrangler tail`
* 查询远程 D1

执行前必须明确区分：

* `--local`
* `--remote`

---

# 配置与分发

`worker/wrangler.jsonc` 和 `workbench/.env` 包含本机配置，不进入 Git。

仓库只提交不包含真实值的 `.example` 文件。

workbench 环境变量清单的真源是：

`workbench/server/lib/settings-schema.mjs`

新增环境变量时同步：

`.env.example`

禁止把：

* API key
* token
* secret
* credential

写入：

* 示例配置
* 前端 bundle
* 日志
* 文档中的真实值
