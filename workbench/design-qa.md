# Design QA — AI 局部修订

## Visual sources

- `C:\Users\Lenovo\AppData\Local\Temp\codex-clipboard-0a30644e-a442-4710-8d61-10064ec7b33d.png` — 97 × 217，参考五种局部处理入口。
- `C:\Users\Lenovo\AppData\Local\Temp\codex-clipboard-edf3d853-b455-42c4-bd34-911de3440725.png` — 682 × 475，参考“原文删除线、候选底纹、采纳/弃用、自定义指令”的对比关系。

这些图片用于约束交互层级和信息关系，不作为对第三方产品视觉的逐像素复制目标；颜色、字体、圆角和间距继续使用内容工作台已有设计系统。

## Implementation captures

- `tmp/text-revision-review.png` — 1440 × 900，正式稿件编辑器中的修订对比状态。
- `tmp/text-revision-history.png` — 1440 × 900，采纳后的持久修订历史。

## Comparison

| Check | Result | Notes |
| --- | --- | --- |
| 五种入口 | Pass | 润色、纠错、缩写、扩写、改写完整可见；图标、文字和原生 hover 说明同时保留。 |
| 原文与候选关系 | Pass | 原文留在原位置并显示删除线；候选紧邻选区下方，以现有青绿色轻底纹区分。 |
| 决策层级 | Pass | 弃用为次要操作，采纳为黑色主操作；重新生成与调整指令不抢主决策层级。 |
| 候选可编辑性 | Pass | 彩色候选区域直接使用多行输入框，长内容限制高度并内部滚动。 |
| 持久历史 | Pass | 历史面板并列显示模式、指令、状态、原文、最终候选和 AI 续写原稿。 |
| 现有产品一致性 | Pass | 沿用工作台字体、按钮、边框、阴影和青绿色 AI 状态色；未引入第二套视觉语言。 |
| 可读性与遮挡 | Pass | 1440 × 900 下候选卡片不遮挡顶部工具栏、底部保存区和右侧批注区。 |

## Functional visual verification

- Playwright 真实浏览器流程覆盖：选区工具条、自定义指令、生成等待、重新生成、候选编辑、采纳、弃用、历史重开。
- 浏览器控制台 0 错误。
- Final result: **PASSED**


# Design QA — 独立 AI 助手体验修正（2026-08-25）

## Visual sources

- `C:\Users\Lenovo\AppData\Local\Temp\codex-clipboard-57c4482f-559d-4b01-b5dc-b7538e317e65.png` — 1920 × 1080，原工作台状态：历史栏默认展开、权限在顶栏、专家与 Skill 常驻输入框底部。
- `C:\Users\Lenovo\AppData\Local\Temp\codex-clipboard-824b9e75-4e22-4367-bae8-27ce1aa1acfd.png` — 1600 × 900，参考 Codex 将权限控制放进输入区的关系。
- `tmp/assistant-standalone-final-1920.png` — 1920 × 1080，最终独立助手状态。
- `C:\Users\Lenovo\.codex\visualizations\2026\08\25\01a037f7-9e0c-70a2-b279-eaa5f8d3294e\assistant-before-after.png` — 3840 × 1080，原界面与最终界面的等尺寸并排对照。

源图和实现图均按 1920 × 1080、DPR 1 对照；没有用缩放差异掩盖间距、溢出或裁切问题。

## State and comparison

- 原状态：已有对话、历史栏展开、权限在顶栏、专家与 Skill 为输入框底部按钮。
- 最终状态：已有对话、历史栏默认收起、权限位于输入框底部、专家与 Skill 仅由输入 `@` / `/` 唤起、模型已自动带出。
- 全屏比较：主导航、对话宽度、消息流和输入框贴底关系保持原工作台设计系统，没有新增页面或第二套视觉语言。
- 聚焦比较：输入框底部从“专家 / Skill / 附件 / 模型”收敛为“附件 / 权限 / 模型”；顶栏权限已移除；无重叠、截断或横向溢出。

## Findings

| Check | Result | Notes |
| --- | --- | --- |
| 历史栏默认状态 | Pass | 独立助手首次打开不渲染历史栏；“沉淀对话”和“新对话”仍可用。 |
| 权限位置 | Pass | 日常 / 创作 / 开发三种权限进入输入框底部，和 Codex 参考关系一致。 |
| 专家与 Skill | Pass | 常驻按钮已移除；键入 `@` 和 `/` 的菜单仍完整可用。 |
| 模型体验 | Pass | 已配置或缓存模型立即显示，并记住上次使用模型；不可用的旧选择会回退到当前目录。 |
| 视觉完整性 | Pass | 1920 × 1080 下无遮挡、裁切、坏间距、错误圆角或控件溢出。 |
| 交互与可访问性 | Pass | 权限选择、模型菜单、附件、发送、停止、新对话及命令菜单均保留可访问名称和真实行为。 |

## Comparison history

1. 第一轮：1440 × 900 浏览器回归确认历史默认收起、权限位置和专家 / Skill 按钮移除；发现需要与参考图统一视口。
2. 第二轮：补充 1920 × 1080 截图，与原工作台源图等尺寸并排复核；布局和目标状态全部通过，无需再改视觉样式。

## Functional visual verification

- `npm run test:writing`：真实浏览器闭环通过，控制台 0 错误。
- `npm test`：476 / 476 主工作台冒烟检查通过。
- `npm run test:unit`：406 / 406 通过，覆盖原始文章 / 书名问法和模型即时回退。
- `npm run build`、`npm run check`、`npm run test:pi` 均通过。

Final result: **PASSED**
