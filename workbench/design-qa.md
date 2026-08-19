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
