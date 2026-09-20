# 情报采集 V3 来源实测（P0）

2026-09-20，在当前 Windows / Node 22.21 / 配置代理的开发环境进行公开端点只读探测。未启用配置、未写业务数据库、未 fork 或运行上游生成器、未调用付费 X / 转录接口。结果不是部署验收；HTTP 200 与结构解析成功也不证明取得全文、允许再分发或历史完整。

完整逐端点结果、时间、响应哈希、输入行覆盖见 `output/acquisition/source-validation.json`。可重复运行 `node workbench/scripts/acquisition-source-probe.mjs`；`supplement` 参数追加官网候选与字段细节。所有请求串行；每次重定向重新通过现有公共 URL / DNS 校验，25 秒与 12 MB 上限。

## 14 家 T2 媒体

| 原始行 | 来源 | 本次结果 |
|---|---|---|
| 2 | TechCrunch AI | 原安全函数拒绝；修复后真实 200、20 条 |
| 3 | The Verge AI | 404 |
| 4 | The Decoder | HTTP 200，RSS/Atom 解析 10 条（未取全文） |
| 5 | Ars Technica | HTTP 200，RSS/Atom 解析 20 条（未取全文） |
| 6 | MarkTechPost | HTTP 200，RSS/Atom 解析 10 条（未取全文） |
| 7 | MIT Tech Review AI | 原安全函数拒绝；修复后真实 200、10 条 |
| 8 | VentureBeat AI | 429 |
| 9 | Wired AI | HTTP 200，RSS/Atom 解析 10 条（未取全文） |
| 10 | Last Week in AI | HTTP 200，RSS/Atom 解析 20 条（未取全文） |
| 11 | IT之家 | HTTP 200，RSS/Atom 解析 60 条（未取全文） |
| 12 | 机器之心 | 订阅含不支持的 XML 实体声明 |
| 13 | 量子位 | HTTP 200，RSS/Atom 解析 10 条（未取全文） |
| 14 | 36氪 | 订阅含不支持的 XML 实体声明 |
| 15 | Import AI（Jack Clark） | 原安全函数拒绝；修复后真实 200、10 条 |

The Verge 原 AI 专栏 RSS 返回 404；官网 `rel=alternate` 指向 `https://www.theverge.com/rss/index.xml`，实测 200、10 条。它是全站 RSS，仅记录候选，不直接替换 AI 专栏配置。机器之心、36氪及两条 36氪候选均返回非 RSS 页面；未找到官网 RSS alternate。VentureBeat RSS 与官网均 429，未规避限流。

TechCrunch、MIT、Import AI 被现有 URL 安全函数拒绝。实际 DNS 分别为 192.0.66.220、192.0.66.184、192.0.78.232/128：确认已有判断将 192.0 整段过宽拒绝。主实现已收窄到 192.0.0/24，之后三家真实重测全部 200/可解析；首次失败与复测记录都保留，没有绕过安全校验。

## 社区六平台与原始清单

26 条社区原始数据行（Excel 行 2–27）逐行保留 `disposition / logicalTargets`，未删除重复项或关闭候选。11 个 Reddit 社区保持独立，其中 LocalLLaMA 与 LocalLLM 未合并。

- HN：frontpage、best、AI、LLM、Claude 五种查询解析成功；GPT 查询返回 502。第三方 hnrss 传输身份保留。
- Reddit：11 社区全部 blocked；缺获批应用与 OAuth 凭据，并需确认保留/外部 AI 处理权限。没有尝试匿名 JSON 或 RSS 规避。评论采集真实验证尚未进行。
- GitHub：5 个 topic 搜索公开 API 均返回 200，实际结构 total_count / incomplete_results / items。只读每查询 1 条，不证明搜索窗口完整、热度增长或认证额度。
- arXiv：3 个分类 RSS 实际 200，可解析，当前均零条；这是空结果，不是已取得论文正文。
- Stack Overflow：langchain、ollama 两标签的 newest/votes 共4入口解析成功；openai/newest+votes、llm/newest 返回404；llm/votes、chatgpt 两排序返回429。保留全部失败入口。
- Dev.to：ai/chatgpt/llm 三标签 RSS 解析成功；全站仍为关闭候选。

## AIHOT 三流实际契约

精选 snapshot 实测分页响应含 `schemaVersion/asOf/fields/cursor/count/hasMore/nextPage/items`；用实际返回 cursor 请求 changes，200、changes 空数组。条目有 summary/links，不能标记全文。热点为 items 数组，包含 rank/id/source/links/sourceCount/signalCount/participantCount/sourceNames/latestAt。实际 id 是条目 ID；`links.story` 带 UUID，但未返回名为 publicId 的字段，本次不猜测 stories API 参数。日报 index 与 latest 均200，latest 正文在 report（date/generatedAt/windowStart/windowEnd/links/attribution/lead/sections/flashes），应整体保存结构与引用。

未验证：长分页/断点、cursor 失效、精选撤选、历史日报缺口、stories API。

## Follow Builders 四文件

固定提交 `e062f01a3dd8a32505169a5b9765707f5895a6e1`；四文件与参考目录均真实 HTTP200，不混用 main。

| 文件 | 实际结构及内容数量 |
|---|---|
| feed-x.json | generatedAt/lookbackHours/x/stats；13作者组、28 tweets；每条 id/text/createdAt/url/likes/retweets/replies/isQuote/quotedTweetId |
| feed-blogs.json | generatedAt/lookbackHours/blogs/stats；blogs=[]，未返回 errors；当前空批次不意味着历史没博客 |
| feed-podcasts.json | podcasts 1期，source/name/title/guid/url/publishedAt/transcript；完整返回 transcript 长39751字符，未截断，也未另行转录 |
| state-feed.json | seenTweets187、seenVideos6、seenArticles8；无 generatedAt；不作为本地导入成功集 |

三内容流 generatedAt 分别为 2026-09-19T06:37:30.918Z、06:38:06.005Z、06:38:05.641Z；不要求相同。参考目录为26个 X 账号、6个播客、2个博客，只做来源参考。正文未写进本审计产物，仅存响应哈希、字段结构与长度。

未验证：历史提交联合回放、旧批次非空博客结构、事务后 checkpoint、独立失败与重试、上游已删除版本缺口；这些须由后续真实适配器验收，不能拿本报告代替。

只读固定提交 `scripts/generate-feed.js` 的对象构造确认 blog 字段为 source/name/title/url/publishedAt/author/description/content。父提交 `0dbf5a4feafbd386cc239960d673e3195909d7b0` 博客也为空；源码结构依据与真实非空博客验收明确分开。

## 已实现连接器的契约验证

`workbench/tests/acquisition-community.mjs` 为明确标记的模拟测试：验证 RSS 摘要/身份、arXiv版本、条件缓存、RSS历史缺口、GitHub1000上限拆窗/续页/限流传播，以及 Reddit授权前零请求、3排序、断点、删除事件、有限祖先补齐、缺失上下文占位、40/100预算、低赞新帖至少20%探索、传入线程预算、空批次后可再采。它不证明 Reddit 真实获批、评论删除清理完成或后续调度实际运行。

Reddit仅请求 oauth.reddit.com，重定向禁止；机密不进入断点。评论原文以 original/full_text 标识，rights默认禁止导出、AI须单独许可。线程完成返回6/24/48小时复查观察，主调度需要消费观察建立任务；占位上下文不能覆盖已有正文。Github热度仅记录真实观察点，没有从单次stars伪造增长。
