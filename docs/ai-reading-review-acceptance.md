# AI 相关性、阅读与聚簇审阅验收（2026-09-20）

本轮状态：**部分通过**。已完成可运行的本地筛选、独立阅读查询、安全 Markdown、审阅状态与聚簇操作。真实中文模型导读、跨原文语义事件聚簇尚未验收：当前真实资料没有明确的外部 AI 处理授权，本轮模型调用为 0，未修改授权。没有扩来源、清库、合并 main 或重搭采集架构。

## 实际原因与边界

实际最近 Follow Builders run `01M2Z69CM2SBKM4F3560WSABZS` 为 completed/no_new；checkpoint 与 HEAD 均为 `34ee70a6c21919a8fd0157e685f1930500d23d2c`，coverage.unchanged=true，原实现 fetched=0。已有 11 条 X 正文与 1 份播客仍在库中。原始 blog 快照确为 0 条，不能编造博客样例。此次保留请求失败、权限受限、上游未变、全部重复和窗外诊断；NO_NEW_ITEMS 不代表没有历史内容。

默认资料页读取已保存原文、发现关系和独立审阅状态，不依赖最新 acquisition_run_items。本次采集仍是诊断视图。24h 只使用源站发布时间字段；generatedAt、commit 时间和本地创建时间不能代替发布时间。Follow 博客/播客深读使用固定上游首次出现时间，查询范围为最近 30 天（缺失时以明确标记的本地首次入库时间作为阅读查询回退），不计入24h资讯。

实际代码使用 `D:/文档/Xenho/Workspace/workspace.sqlite`，未另建业务库。新增迁移32仅保存派生处理、语义缓存和审阅状态，复用 intel_clusters。最近恢复点 `D:/文档/Xenho/Backups/Migration-Points/before-ai-reading-1789905044963.sqlite`，旁有 SHA-256；SQLite integrity_check 已通过。

## 真实重新处理

同一固定 SHA 的四份本地快照通过内容哈希校验后重放12条。连续两次重处理没有增加正文版本、没有让未读列表消失，6,023条原始正文逐条哈希不变。

最终该次快照：6,007份按原文身份投影的资料，4,748份可读，31份 not_ai，2,991份 needs_context，1,259份不可读；2,656份相关且可读的未审阅资料，2,656个独立阅读簇。后两个数不代表已通过语义编辑或高价值精选。相关性与可读性是交叉维度，不可相加。批次抓取量、重复量是发现次数；失败是入口数；深读可能与窗外量重叠。

验收中发现旧分组函数会删除标点，存在不同URL碰撞。阅读簇现使用完整稳定身份的哈希作为输入键，并只修正本轮未人工调整的自动独立簇。不同原文即使模型名相同也不按关键词合并。

机器可读报告保存在 `output/acquisition/ai-reading-acceptance.json`（本地验收产物）。

## 实际样例

| 结果 | 原始材料 | 理由 |
|---|---|---|
| 保留 | [Peter Yang 的 ChatGPT 财务提示词实践预告](https://x.com/petergyang/status/2101342055352201519) | 正文明确提到ChatGPT与具体提示词用途；仅预告，不冒充已取得完整节目 |
| 保留 | [Aaron Levie 的 Personal agents](https://x.com/levie/status/2101427997597446636) | 正文讨论Agent、MCP与工具执行；不要求字面出现AI |
| 排除 | [2026 is the year of linux desktop](https://x.com/thsottiaux/status/2101431497437950458) | 短帖无AI上下文，作者身份不作为放行依据 |
| 排除 | [Apple TV / Netflix 影视推荐](https://x.com/petergyang/status/2101497327861248090) | 纯影视推荐 |
| 待复核 | [/tastemaker skill 影视推荐流程](https://x.com/petergyang/status/2101503916743749878) | skill词和自动推荐暗示不足以确认AI实现，不机械归入无关 |
| 待复核 | [Muse / Instinct 拨打电话问题](https://x.com/thenanyu/status/2101383106372805103) | 当前短帖缺上下文 |

真实独立深读簇：**When AI Improves Itself | Richard Socher (Recursive)**，发布者为 The MAD Podcast with Matt Turck，原始链接保持上游提供的 [频道链接](https://www.youtube.com/@DataDrivenNYC/videos)，不猜测单集地址。

- 原始发布：2026-09-10T11:30:00.000Z。
- 上游首次出现：2026-09-20T06:37:55.989Z。
- feed生成：2026-09-20T06:37:56.467Z，单独保存，不作发布日期。
- 原始转录76,077字符，实际页面渲染125个原始说话人/时间戳段落；标题待译、中文导读未生成均如实显示。
- 实际截图：`output/playwright/ai-reading-real-podcast.png`、`output/playwright/ai-reading-real-mobile.png`。390px无横向溢出，浏览器错误0。

## 验证与尚未满足条件

已通过临时独立SQLite测试：相关/无关/待上下文、原文身份与发现关系、同模型不同事件不合并、授权隔离、内容/规则缓存、模型失败保留待复核、引文校验、保留忽略恢复、人工拆分合并不被重处理覆盖。新增同事件语义聚簇测试使用明确标记的 TEST FIXTURE 与模拟模型，不是真实模型效果证据。

直接回归通过：acquisition-providers、window、storage（19项）、regressions（9项）、batches、migration、intelligence-editor、intelligence-synthesis、acquisition-batch-ui、acquisition-review-ui、acquisition-review、npm run check、npm run build。没有声称全项目所有测试均执行。

浏览器测试覆盖Markdown、长文、真实播客，以及模拟评论父级缺失提示、0秒时间戳、导读逐条引文、空态、错误重试、小屏和确认操作。真实评论完整阅读尚未验收；不能把测试评论当作真实采集。

未满足：真实中文模型导读/中文译题、真实多原文事件语义聚簇及分歧总结、完整的自动上下文补齐。没有授权的资料不会为了完成这些项目而外发。现有正文补全流程保持授权约束，主题不确定材料可恢复到待复核。本地规则是初筛，不宣称已逐条完成语义质量判断。模型引文匹配校验只能证明引用来自输入，不等于对作者事实和模型解释进行了独立核实。
