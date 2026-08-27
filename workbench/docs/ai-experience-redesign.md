# AI 协作体验

> 当前实现说明。Stage 1–9 已完成；历史审计与迁移细节保留在 Git 历史中。
>
> 最后核对：2026-08-27。

## 一、产品边界

AI 是协作层，不是业务真源。

- Worker / D1 继续决定业务状态、发布、真实性校验和服务端硬闸。
- Assistant 可以回答、提出候选、生成报告、提出有副作用的动作，但不能静默修改正文或业务状态。
- 正文修改必须先形成 Candidate，再由用户采纳或弃用。
- 有副作用的 Action 必须明确确认；拒绝是正式状态。
- `@` 代表 Expert，`/` 代表 Skill。菜单只在用户输入对应字符后出现。
- 访谈是普通 Runtime Skill，不存在访谈页面、Tab、专属按钮、专属会话或专属结果类型。
- Project / Reading 不显示模型、权限、风格或 Pi Agent SDK 运行时信息；完整全局 AI 页面保留模型和权限设置。

## 二、能力模型

### 2.1 scope：语义上下文

`scope` 只说明 AI 当前站在哪个语义空间：

| scope | 上下文 | 会话 |
| --- | --- | --- |
| `global` | 不绑定某篇正文的全局工作 | 全局会话 |
| `project` | 当前内容项目、稿件、项目素材与报告 | 项目会话 |
| `reading` | 当前阅读对象 | 阅读会话 |

可编辑 vault 文档仍是 `reading`，不会因此获得项目阶段、项目素材或项目报告。

### 2.2 target：结果落点

`target` 描述对象类型、是否可编辑、当前选区和合法动作。

当前可产生 Candidate 的对象类型是：

- `draft`
- `vault-document`

只有 `target.editable === true` 时才允许写作 Candidate；有有效选区时才允许选区修订。只读 Reading 即使存在选区，也不会出现无法落地的修改动作。

### 2.3 surface：呈现方式

Assistant Core 的 `surface` 只有三种：

| surface | 用途 | 不影响的事项 |
| --- | --- | --- |
| `page` | 完整 AI 工作区 | 不增加能力 |
| `overlay` | Quick Assistant | 不减少能力 |
| `rail` | Project / Reading 侧栏 | 不根据宽度改变能力 |

编辑器内联菜单、Candidate 专注审阅和 Report 对照审阅是正文交互层，不是新的 Assistant Core surface。

核心不变式：

> Assistant 能做什么，由统一的 `scope + target policy` 决定；`surface` 不得增加或削弱能力。

实现真源是 `src/lib/assistant-policy.js`。调用方必须传语义 target，不得用 callback 是否存在或零散布尔值推测能力。

## 三、入口与召唤路由

顶栏 AI 按钮和 `Ctrl/⌘+I` 共用 `assistant-summoner.js`：

- 项目页：打开或聚焦现有 Project Assistant。
- 阅读页或阅读覆盖层：打开或聚焦 Reading Assistant。
- 其他页面：打开 Quick Assistant。

快捷键在输入框内同样生效。

Quick Assistant 使用 `scope="global"`、`surface="overlay"`。它与 `#/assistant` 共用同一个 global conversation；关闭后保留 conversation 和未发送草稿。进入完整 AI 工作区时继续同一个 `conversationId`。

Quick Assistant 默认只携带页面或明确对象的引用：

- 可以携带页面类型、对象 ID、对象标题。
- 没有明确对象时显示当前位置，并说明“未附带页面内容”。
- 不自动发送正文、DOM、页面数字或其他页面数据。
- 正文只有在用户显式附带，或发送后由 AI 通过受控工具读取时进入上下文。
- 当前引用可以由用户移除。

Quick Assistant 是 non-modal：Esc 或点击外部可关闭，不给背景加 inert，也不做强制 focus trap。打开后立即聚焦 Composer；reduced-motion 下取消位移和缩放。
## 四、共享 Assistant Core

共享行为只实现一次：

- `AssistantPane`：conversation lifecycle、submit、stream、stop、retry、history、attachments、command menu 和公共错误状态。
- `AssistantComposer`：输入、附件、发送，以及仅在 global page 出现的模型与权限设置。
- `AssistantThread` / `AssistantMessage`：消息、loading、retry、message actions 和 AiResult 摘要。
- `AssistantHistory`：完整全局工作区历史。
- `ProjectAssistantHistory`：项目右栏的轻量最近会话。
- `CandidateCard`：正文候选审阅。
- `ActionCard`：有副作用动作的确认与拒绝。

页面容器只负责摆放位置、外部尺寸、当前 scope/target 和页面专属编排：

- `pages/Assistant.jsx`：完整全局页面。
- `QuickAssistant.jsx`：全局浮层。
- `ProjectAssistantRail.jsx`：项目上下文、报告和侧栏收起。
- `SideRail.jsx`：阅读区页签与 Reading Assistant。

Project Rail 直接接收统一 target，不再用 `selection / onInsert / onRevision` 兼容 props 重新拼能力。
## 五、各协作界面

### 5.1 完整全局 AI 页面

`scope="global"`、`surface="page"`。这是模型和权限的正式设置入口：

- Composer 仍以输入为第一视觉重点。
- 模型和权限在紧凑 footer 中持续显示当前值，点击后展开。
- 支持完整历史、重命名、置顶、归档、恢复和永久删除。
- 不绑定正文，因此不出现正文 Candidate 动作。

### 5.2 Quick Assistant

`scope="global"`、`surface="overlay"`，宽度约 520px，不挤压当前页面。继承完整全局页面的模型和权限，不在浮层重复配置。

### 5.3 Project Assistant

`scope="project"`、`surface="rail"`。桌面宽度下是协作右栏，1180px 附近转为不挤压正文的浮层形态。

右栏只保留：

1. “协作”、最近会话、新对话、收起。
2. 当前稿件与已使用素材的上下文入口。
3. 对话和 AiResult 摘要。
4. 输入、附件、发送。

空态建议靠近 Composer，点击只填入输入框，不自动发送。Project Composer 不显示模型、权限、风格、`@` 或 `/Skill` 常驻控件。

上下文面板按需显示当前稿件、素材和报告入口：

- 已核验是默认状态，不逐行重复。
- 只突出待核验。
- 最多直接呈现 10 条，内容滚动但不遮挡 Composer。
- 鼠标打开时不抢焦点；键盘打开时进入可用的焦点顺序。

项目会话历史是轻量 popover：保留当前会话、最近会话与新对话；新建不会删除旧会话。

### 5.4 Reading Assistant

`scope="reading"`、`surface="rail"`。空态使用阅读文档语境，不显示项目素材、报告、模型、权限、风格或运行时信息。

Reading rail 当前使用固定只读 target；可编辑 vault 文档的写作能力位于与 Project 共用的编辑器内联层。

### 5.5 编辑器内联 AI

Project Draft 与可编辑 Reading 文档复用同一套选区和光标交互：

- 选区：改写、精简、扩写等操作贴近真实选区矩形。
- 光标：`Alt+Enter` 按需打开“想一想 / 续写 / 按要求写”。
- “想一想”只返回建议；续写与按要求写进入 Candidate。
- 方向键选择、Enter 执行、Esc 关闭并恢复光标或选区。
- 中文输入法 composition 期间不触发。
- 菜单根据真实矩形自动上下翻转，并限制在编辑器可视区域内。
- 滚动、resize、选区变化时重新定位。
- 只读 Reading 不出现写作动作。
## 六、统一 AiResult

统一结果类型只有四种：

| kind | 含义 |
| --- | --- |
| `answer` | 解释、建议、访谈追问等对话结果 |
| `candidate` | 可审阅的正文候选 |
| `report` | 结构化检查结果 |
| `action` | 需要确认的副作用动作 |

### 6.1 Candidate

Candidate 状态为：

`generating → ready / edited → adopted / discarded`

并允许进入：

- `stale`：正文版本已变化。
- `failed`：生成失败或服务端 Grounding gate 拒绝。

共同规则：

- 原文在采纳前不修改。
- 候选可编辑、采纳、弃用、重跑，并显示第 N 版和变更摘要。
- `Ctrl/⌘+Enter` 采纳，`Ctrl/⌘+Backspace` 弃用。
- 采纳后走编辑器已有的合法撤销路径。
- 句子、选区、段落在正文原位置内联审阅。
- 大章节或全文进入专注审阅，折叠协作右栏；结束后恢复原会话和滚动位置。
- whole-document candidate 必须明确说明会替换全文并由用户确认；没有审阅能力时不得直接替换。

### 6.2 Grounding

Grounding 包含：

- `used`
- `skipped + reason`
- `unverified`
- `gate`
- `gateDetail`

Grounding 存在时必须可见；`skipped` 和 `unverified` 默认展开。每条 skipped 都提供下一步，例如“去核验”或“仍然使用”。

`gate: "rejected"` 时 Candidate 必须进入 `failed`，不得进入 `ready`。前端只展示服务端结论，不重新判断真实性。

### 6.3 Action

Action 状态为：

- `proposed`
- `applied`
- `rejected`
- `superseded`

确认和拒绝同样明确；拒绝不是“用户没有点击确认”。

### 6.4 Report

报告用户可见严重度是：

- 高风险
- 建议修改
- 可选优化

正面结果进入“值得保留”，不得把 `pass` 映射成“可选优化”。“需要处理”先显示；“值得保留”排在后面并默认折叠。

报告审阅时折叠协作右栏，只显示正文与报告对照。finding 与正文位置双向定位并高亮当前项。动作随 finding 类型变化；实际生成修改稿的动作叫“生成候选”，不会直接改正文。

AI 报告只作为参考。用户界面不出现“blocking”或“阻塞发布”；服务端真实性硬闸和确定性业务硬闸不受影响。
## 七、能力矩阵

| 场景 | scope | surface | target | 能力 |
| --- | --- | --- | --- | --- |
| 完整 AI 工作区 | global | page | none | answer、action、历史、模型与权限设置 |
| Quick Assistant | global | overlay | none | 与 global 同一会话；轻量呈现 |
| 项目协作右栏 | project | rail | editable draft | answer、candidate、report、action、项目上下文与历史 |
| 阅读协作右栏 | reading | rail | read-only vault-document | answer、阅读上下文 |
| Project 编辑器 | project | editor inline | editable draft | 选区改写、光标续写、按要求写 |
| Reading 编辑模式 | reading | editor inline | editable vault-document | 与 Project 相同的内联写作能力 |
| Reading 只读模式 | reading | editor inline | read-only vault-document | 不显示写作动作 |

同一个 scope 在不同 surface 上能力不变；同一个 target 的可编辑性变化会改变 Candidate 能力。
## 八、交互与无障碍

- `Ctrl/⌘+I`：统一召唤器；输入框内也生效。
- `Alt+Enter`：打开编辑器光标级 AI。
- `@`：在 Composer 输入后打开 Expert 菜单。
- `/`：在 Composer 输入后打开 Skill 菜单。
- `Ctrl/⌘+Enter`：采纳 Candidate。
- `Ctrl/⌘+Backspace`：弃用 Candidate。
- Esc：关闭当前浮层或内联菜单并恢复原焦点；不会丢 conversation、draft、光标或选区。
- 命令菜单和内联菜单支持方向键与 Enter。
- composition 期间不触发快捷动作。
- Quick Assistant 不做 focus trap；需要强制决策的确认弹层继续使用项目统一 dialog 契约。
- 动效只解释空间关系，约 160–200ms ease-out；reduced-motion 下取消位移和缩放，不使用 spring、bounce、stagger 或 glow。
## 九、正文审阅与协作右栏的关系

正文始终是项目工作区第一视觉主体。

- 普通对话、Context 和轻量历史留在右栏。
- 句子、选区和段落 Candidate 在正文原位置审阅。
- 大章节与全文 Candidate 进入正文专注审阅，并临时折叠右栏。
- Report 进入正文 + 报告双栏审阅，并临时折叠右栏。
- 退出 Candidate 或 Report 审阅后恢复原会话、对话滚动位置和正文位置。
- Report 首屏先呈现“需要处理”；“值得保留”随后且默认折叠。
- finding 与正文双向定位，当前项在两侧保持一致高亮。

右栏不是 mini ChatGPT，也不是状态 Dashboard。阶段、字数、素材数、报告数不重复堆放；只显示 AI 当前理解任务所需的上下文。
## 十、UI 基础设施边界

当前实现继续复用项目已有 React 组件和设计 token。

- 未引入 Tailwind、Base UI 或 shadcn。
- 未安装 coss 或 ReUI runtime 组件。
- coss、Emil UI、ReUI 仅在迁移期作为设计研究参考，不属于产品 Runtime Skills。
- 产品 Runtime Skills 继续位于仓库根 `.agents/skills/`，由 Workbench runtime 统一发现。

## 十一、实现真源

| 领域 | 真源 |
| --- | --- |
| scope / target 能力 | `src/lib/assistant-policy.js` |
| Expert kind 与名称 | `src/lib/expert-kinds.js` |
| Report 严重度 | `src/lib/report-severity.js` |
| AiResult / Candidate 状态 | `src/lib/ai/result-model.js` |
| Grounding 归一化 | `src/lib/ai/grounding.js` |
| 统一召唤路由 | `src/lib/assistant-summoner.js` |
| Assistant 生命周期 | `src/components/assistant/AssistantPane.jsx` |
| Candidate 审阅 | `src/components/assistant/CandidateCard.jsx` |
| 编辑器内联 AI | `src/components/MarkdownEditor.jsx`、`src/components/TextRevision.jsx` |
| Project Context / History / Report | `ProjectContextPanel.jsx`、`ProjectAssistantHistory.jsx`、`ProjectReportReview.jsx` |

Worker / D1 契约、Pi Agent SDK 协议、Skill discovery 和真实性硬闸不属于本次前端架构的替代范围。
## 十二、Stage 1–9 完成记录

| Stage | 结果 | Commit |
| --- | --- | --- |
| 1 | 死按钮、标签真源、保存落点、报告严重度 | `81979c0` |
| 2 | 共享 Assistant Core | `c6d3790` |
| 3 | `scope + target policy` | `0a15c16` |
| 4 | 统一召唤器与 Quick Assistant | `e52d66a` |
| 5 | AiResult、Candidate、Grounding、Action reject | `a004ba3` |
| 6 | Project AI 协作区与产品收口 | `d5c9efe`、`12da6a3` |
| 7 | Project / Reading 共用内联 AI 与定位收口 | `d6dc670`、`29f7347` |
| 8 | 删除被替代的旧入口与重复实现 | `9fc3d95` |
| 9 | 清理过渡代码、开发期 Skill 和失效文档，建立发布基线 | 本次提交 |

Stage 1–9 均已完成。后续改动按当前产品架构维护，不再恢复迁移期入口或兼容 API。
## 十三、发布验收基线

发布前必须通过：

```powershell
npm run check
npm run test:unit
npm run test:writing
npm run test:pi
npm test
npm run build
npm run shots
git diff --check
```

产品级回归至少覆盖：

- 顶栏与 `Ctrl/⌘+I` 在 project / reading / ordinary page 的正确路由。
- Quick Assistant 的 conversation、context、draft、Esc、外部点击和继续到完整工作区。
- `@` Expert、`/` Skill、访谈 Skill 的通用调用。
- Project Context、轻量 History、新对话和长对话底部。
- Candidate 采纳、弃用、重跑、stale、failed、键盘操作与焦点恢复。
- Grounding 的 used / skipped / unverified / rejected gate。
- Action 确认与拒绝。
- Report 的严重度、正面结果分组、双向定位和审阅退出恢复。
- Project / Reading 的 `Alt+Enter`、选区菜单、光标菜单、composition 和只读权限。
- Project / Reading 不暴露模型、权限或运行时信息；完整 global page 仍保留模型与权限。
- 1180、1366×768、1440×900，以及 reduced-motion。

截图脚本会写入临时 fixture，必须完整跑到恢复步骤；中途失败时先恢复数据再继续。
## 十四、已关闭的产品决定

- **访谈**：作为普通 Skill 进入同一项目会话；结果只使用 answer 或 candidate。
- **整篇正文**：正文为空时可产生 whole-document candidate；正文非空时不提供整篇起稿快捷动作。用户明确要求重写整篇时不得降级为续写，必须进入全文专注审阅。
- **scope**：由语义上下文决定，不由是否可编辑决定。
- **Quick context**：默认只传 page/object reference，不自动传正文、DOM 或页面数据。
- **项目右栏**：采用轻量协作栏，不做三 Tab、mini ChatGPT 或状态 Dashboard。
- **低频设置**：模型和权限只在完整 global page；Expert 与 Skill 只由输入字符触发。
## 十五、明确否决的结构

以下结构与当前产品不兼容：

- 访谈专属页面、Tab、按钮、会话、结果类型或前端分支。
- `if (skill === "interview")` 一类专属渲染。
- 根据 callback 是否存在、编辑模式或页面位置推测 Assistant 能力。
- 让 surface 增加或削弱能力。
- Global Assistant Dock、旧 WritingAssist、ExpertTaskPanel 外壳。
- CreationDialog 的 interview / material 起稿流程。
- Project / Reading 常驻模型、权限、风格、`@`、`/Skill` 控件。
- 把完整 Candidate 或 Report 压进 336px 右栏。
- Report 同时展示正文、完整报告和完整对话右栏。
- 未经确认修改正文或业务状态。
- 为使用设计参考而引入第二套 UI 基础设施。
