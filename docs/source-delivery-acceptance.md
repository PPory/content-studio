# 信源与正文交付验收（2026-09-21）

本轮完成已有信源的正文交付、受限真实样本及阅读入口修复；**信源整体仍为部分通过**。没有扩来源、清库、合并 main 或重建采集架构。日期与状态是本轮观测，不保证上游持续可用。

## 实际运行

非 Reddit 批次 `01M2ZD9MH2H8HZ60K6XQT6FG8Z` 执行 44 个既有入口，最终状态 partial。详细逐来源记录、窗口、错误、恢复点和样本见 [机器报告](../output/acquisition/source-delivery-acceptance.json)，补充 HTTP 观测见 [响应记录](../output/acquisition/source-delivery-http.json)。每个执行阶段先创建 SQLite 恢复点及 SHA-256；未导出数据库或密钥到 Git。

| 来源 | 真实结果 | 边界 / 未满足项 |
| --- | --- | --- |
| Follow Builders X | 同 SHA 重放已有快照，11 条短正文仍可阅读 | 本轮新增 0 不等于没有资料 |
| Follow Builders 播客 | 1 份 76,077 字符转录，真实时间戳和说话人已渲染 | 原始发布日期 9 月 10 日，单列本期深读；原始链接仅为频道视频页，未猜测单集地址 |
| Follow Builders 博客 | 历史真实非空快照解析得到 3,471 字符全文 | 当前快照博客为空；历史验收未冒充当日新增或写入当前新资讯 |
| AIHOT | 热点取得 10 条，7 更新、3 重复；已有日报 8 份正文 | 精选与日报本轮无新增；热点原 JSON 保留，阅读版转为报告条目；未证明所有精选原文均已补齐 |
| The Verge | 修正既有订阅地址，HTTP 200 Atom 10 条，4 入窗新增、6 窗外 | 仅修复原来源，不新增来源 |
| T2 其他媒体 | 完成既有入口检查及部分真实正文补全 | VentureBeat 429；机器之心返回 data-service HTML；36kr feed 返回 HTML，均未修复上游供给 |
| GitHub / Dev.to / HN | 发现入口可用；真实 README、Dev.to RAG 长文可阅读 | HN 讨论与外链原文分开，未声称所有讨论和外链均有全文 |
| Stack Overflow | 保留失败与 HTTP 信息 | 本轮多入口 429，补充探测存在 404；未宣称恢复 |
| arXiv | 空响应 / 未变保留为无新增 | 本轮未取得可验收的新论文 |
| Reddit | 单次授权实取 5 帖、1 帖下 19 评论 | 未达到或伪造 20 评论；未验收多层回复和 top/controversial/new 分区 |

ImportAI 的原暂停状态保留。抓取量、窗口内/外量、重复量是运行口径；无关、不可读、待审阅和聚簇量是持久化资料处理口径，不应相加当作新增内容。正文补全单列 enriched，不增加过去 24 小时新资讯。

## 正文和来源

RSS 明确提供的全文与摘要分别保留；304 可重放已保存正文，缺缓存明确报错。网页阅读版去掉导航、广告和 Cookie 等杂质，保留原始版本。修复 Ars 正文分成两个区块导致前半段丢失的问题，真实正文由 1,650 补齐为 3,066 字符。GitHub README 实取 3,056 字符。正文补全失败保留任务原因，阅读页提供确认获取及刷新结果入口，不产生 AI 授权。

原始发布者与发现渠道分开显示；缺作者、时间或评论层级不猜测。Reddit 19 评论均有真实 parent/root ID，但供应商未提供 depth；页面按已有父关系显示上下文。Reddit 截图仅留本机忽略目录，未提交评论正文或截图。

播客 `01M2YV290KM8M0EGJ49VNZXZ5D` 保留发布时间 `2026-09-10T11:30:00Z`，上游首次出现为 `2026-09-20T06:37:55.989Z`。feed 刷新时间没有覆盖原始日期。历史博客验收固定 SHA `47cebd39a77d48b5274a428bd637e20c43cc10ee`，文章为 Claude Cowork and chat are now one Claude，原始日期 Sep 16, 2026；详见 [历史快照证据](../output/acquisition/follow-blog-historical.json)。

## 筛选与真实聚簇

全来源共用规则；来源、作者雇主和局部 AI 关键词不能自动放行。仅在已有授权范围发送选定材料；本轮共 7 份公开非 Reddit 材料，8 次分类导读（Ars 补齐正文后内容哈希改变）、2 次事件分组。相同正文与规则版本命中缓存。导读与原文分开，每条判断附连续原文引文；这证明可追溯，并不等同于独立核实报道事实。

| 真实材料 | 最终处理 |
| --- | --- |
| Peter Yang / ChatGPT 财务使用实践 | 保留 ai_relevant |
| Dev.to Hybrid RAG / Neo4j + 向量检索长文 | 保留 ai_relevant |
| Personal agents 的产品机制短文 | 规则保留，不要求字面出现 AI |
| 2026 is the year of linux desktop | 排除 not_ai，无 AI 上下文 |
| Apple TV 影视推荐、取消 Netflix | 规则排除 not_ai |
| tastemaker 影视/图书评分 skill | needs_context，缺少直接 AI 依据 |
| 龙芯 / 鲲鹏安全认证报道 | needs_context；模型因局部 AI 芯片段落判相关，主体校验拦截并保留模型理由 |

真实事件簇 `01M2ZAF50MJ6VECNCH61CAJWB6`：Decoder 与 Ars 两篇关于“研究人员利用 Claude 攻入 OpenAI 系统”的报道，保留两个原文、各自日期、发现路径和逐来源事件依据。不是因同名模型合并。两篇均发布于 9 月 18 日，所以在“已归并事件（含历史）”展示，不冒充过去 24 小时新闻。单篇导读仍按原文归属，不伪装为独立综合事实结论。保留、忽略、拆分、合并沿用人工锁定机制；后续自动处理不会覆盖人工调整。

模型失败保持待处理；多批处理按未处理材料推进，新增 9 条隔离样本验证不会反复只处理首批 8 条。公开网页正文可按资料逐篇获取；**未实现所有缺上下文内容的自动上下文追踪，也未为全部资料生成中文译题或导读**。

本轮结束验证：7 份模型材料权限字段未改变、正文哈希匹配；Reddit 一次性授权已结束，恢复原 blocked 状态；没有修改持久环境付费开关，Reddit 未送模型。

## 阅读验收与统计

默认阅读范围为过去 24 小时内 AI 相关、可读、未审阅聚簇；本期深读独立。历史、主题不确定、缺正文、已过滤等置于次级范围。本次采集继续作为运行诊断，不决定已有未读资料是否存在。

最终记录时：近期 89 簇、深读 1 簇、历史在内未审阅 2,619 簇、待上下文 3,112 项、已过滤 41 项、不可读 1,286 项、同事件簇 1 个。这些是当时数据库投影，范围可能交叠、会随时间变化，且多数仅经过规则处理，**不是人工认可数量或模型质量通过率**。

真实浏览器检查桌面、390px 手机、无横向溢出、19 评论、全文确认按钮、两原文事件簇和播客转录；控制台无错误。截图：

- [真实事件簇](../output/playwright/source-delivery-event.png)
- [长文阅读](../output/playwright/source-delivery-reading.png)
- [手机阅读](../output/playwright/source-delivery-mobile.png)
- [播客转录](../output/playwright/source-delivery-podcast.png)
- [AIHOT 阅读版](../output/playwright/source-delivery-aihot.png)
- [真实正文补全操作](../output/playwright/source-delivery-fulltext-action.png)

隔离测试通过：source-delivery、acquisition-review、feed-delivery、reddit-closure、community、brightdata、providers、storage（19 项）、regressions（9 项）、batches、window、review-ui、batch-ui；npm run check、npm run build、git diff --check 通过。测试样本与真实报告分开，持久化测试使用系统临时目录；构建仍有已有大包提示。未声称跑完与本改动无关的全部产品测试。

结论：已有材料到筛选、正文、来源、审阅的链路已补齐并完成受限真实验证；上述上游失败入口、当前非空博客及评论分区仍未满足完整验收。后续可继续针对这些具体缺口处理，无需清库或另起采集架构。
