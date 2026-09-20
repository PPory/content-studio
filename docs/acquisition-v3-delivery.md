# 情报采集 V3 交付与运行边界

更新日期：2026-09-20。本说明基于当前代码与验收产物；原执行包是设计输入，不代表所有来源已部署、获准或可用。测试结果分层记录，未通过的真实接入验收列在文末。

## 实施范围与文件组

| 范围 | 主要文件 | 实际变化 |
|---|---|---|
| P0 盘点 | `docs/intelligence-acquisition-audit.md`、`docs/acquisition-source-validation.md`、`output/acquisition/source-validation.json` | 真实旧调用链、数据库、Skill 与公开端点核查；失败及原始行均保留 |
| 配置输入 | `docs/acquisition-v3-input/`、`workbench/config/acquisition-v3/` | 保留计划、拟实施来源清单、原始逐行清单；运行状态另存 SQLite |
| 数据与调度 | `workbench/server/storage/migrations/0029-acquisition-v3.sql`、`server/acquisition/{catalog,store,runner,migration-backup}.mjs`、现有 jobs 模块 | 来源身份、版本、发现关系、快照、检查点、租约、限流、续采与任务状态 |
| 网络与解析 | `server/acquisition/{transport,parsing}.mjs` | 公共地址校验、固定已验证 IP、重定向重验、响应预算、条件缓存和持久退避 |
| 四组采集 | `server/acquisition/connectors/{aihot,follow-builders,community,reddit}.mjs` | AIHOT 三路、Follow 四文件、14媒体、六社区平台与 Reddit 评论 |
| 兼容与权限 | `server/acquisition/compatibility.mjs`、现有情报域、Pi 工具、热点路由与备份 | 下游读取本地资料；保留证据闸；外部 AI、导出与全文补全单独授权；删除/过期清理 |
| 本地入口 | `server/routes/acquisition.mjs`、`scripts/acquisition-worker.mjs` | 本地 API 与不依赖页面的采集进程 |
| 界面 | `src/pages/{AcquisitionPanel,IntelligenceChannels,IntelligenceResources}.jsx`、`intelligence-v2.css` | 分组、状态、入口修复、补采/取消、权限确认、长文/评论/发现渠道；保留旧信源编辑 |
| 验收 | `tests/acquisition-{migration,providers,community,storage,regressions,ui,headless}.mjs` | 模拟协议、真实隔离数据与浏览器、单源真实独立进程分别验证 |

全部14家媒体、六个平台、11个不同Reddit社区与全部原始社区行的处理说明保留。LocalLLaMA 与 LocalLLM 不合并。失败入口不会从目录删除，也不会因修改入口而丢失原始清单和旧资料。

## 迁移与恢复点

迁移版本为 **29**，扩展现有 `intel_channels/intel_sources` 并添加采集运行、快照、检查点、版本、段落、发现关系、观察、锁与删除标记相关表。原记录 ID、正文与引用保留，旧迁移校验规则不放宽。

P0 只读确认本机真实数据库为 `D:\文档\Xenho\Workspace\workspace.sqlite`，当时版本28。实际文件名由 `workspace-paths.mjs` 决定；没有为了匹配旧文档中的 workbench.db 改名。

首次以新代码打开已有版本小于29的工作区时，先创建：

```text
XENHO_HOME/Backups/Migration-Points/before-acquisition-v29-<时间>-<随机值>.sqlite
XENHO_HOME/Backups/Migration-Points/before-acquisition-v29-<时间>-<随机值>.sqlite.json
```

恢复点通过 SQLite integrity、外键、版本和逐表数量检查，旁车记录 SHA-256。任何恢复点校验失败都会阻止迁移。这是数据库恢复点，不是附件资产完整备份；需要整体恢复时还应保留原资产目录和正式备份。不要在应用或 worker 运行时直接覆盖数据库。

开发及故障测试均使用系统临时目录中的独立 `XENHO_HOME`；真实外部烟测也未写用户业务数据库。本次开发尚未启动新版正式工作区；隔离迁移专项已验证恢复点、旧来源 ID、禁用选择和正式文件指纹不变。正式库最后核查仍为版本28。

## 启动方式

在 `workbench` 目录执行。仅查看状态也会打开工作区，已有旧库会先建立恢复点再升级。

```powershell
node scripts/acquisition-worker.mjs status
node scripts/acquisition-worker.mjs validate t2.the_decoder
node scripts/acquisition-worker.mjs once
```

`validate/sync/backfill KEY` **只入队**；`once` 执行当前到期任务后退出；`run` 常驻检查任务及下次运行时间。stable key 可从 `status` 返回的 key 查看。

```powershell
node scripts/acquisition-worker.mjs sync follow_builders.bundle
node scripts/acquisition-worker.mjs backfill follow_builders.bundle
node scripts/acquisition-worker.mjs run
```

首次启动 `run/once` 会按 SQLite 中的目标启用状态处理来源，不是单源演示命令。只想测试某个来源时先在信源管理暂停其余来源。worker 只执行采集任务，不需要打开界面、配置模型或运行 Follow Builders 生成器；关闭机器期间无法联网，恢复运行后按检查点补采。没有在本次开发中替用户注册 Windows 开机任务。

界面仍使用原 `npm run dev` 或桌面启动器。`.env` 的 `ACQUISITION_AUTOSTART=false` 默认不随界面启动采集；设为 `true` 才启用随工作台运行的采集调度。独立 worker 不依赖这个开关。只监听回环地址，不部署公网。

独立进程的单源真实验收：

```powershell
node tests/acquisition-headless.mjs
```

该脚本从临时空目录启动 worker，不读取项目 `.env`，只继承代理与基本路径变量。仅启用已在公开烟测通过的 The Decoder，关闭全文补全与外部 AI/导出，验证真实RSS入库、退出与临时目录清理。2026-09-20 已实际通过：The Decoder 10条发现入库，子进程退出码0，只有指定来源任务，没有界面或模型任务，临时目录已清理。结果写 `output/acquisition/headless-smoke.json`；**不是所有来源或历史完整性验收**。

## 当前真实接入结果

证据：`output/acquisition/live-smoke.json`，类型为 `live_public_http_and_isolated_sqlite`，记录时间2026-09-20；更早逐端点探测见 source-validation.json。两者与模拟测试分开。

| 来源 | 本次真实结果 | 不能据此声称 |
|---|---|---|
| AIHOT 精选 | 取首个快照页500条，解析及入库，检查点保存，hasMore=true | 全快照或长期增量已同步完成 |
| AIHOT 热点 | 10个事件观察、1个真实 story，作为观察保存 | 热点报告就是独立原始证据 |
| AIHOT 日报 | 1份整份报告入库，仍有后续历史 | 最近7天已全补齐 |
| Follow Builders | 固定 `e062f01a3dd8a32505169a5b9765707f5895a6e1` 四文件，28 tweets、1转录、blogs合法空、state完整保存 | 多日历史已全回放或非空博客实时批次已验收 |
| T2媒体 | 10家本次解析及入库；The Verge 404，VentureBeat 429，机器之心/36氪返回不支持的XML实体声明 | 14家均可用或已取得文章全文 |
| HN / Stack Overflow / Dev.to | 各取一个代表入口真实入库：40/30/12条 | 每个平台所有查询入口持续可用 |
| GitHub / arXiv | GitHub llm查询真实返回2809项，触发拆分时间窗（本页0条、hasMore）；arXiv cs.AI合法空feed | GitHub搜索已完整入库，或取得论文全文 |
| Reddit | 获准访问缺失，在联网前明确 blocked | 评论真实接入通过 |

当前RSS结果主要是发现与摘要。正文补全需要来源的明确授权和可访问的原文，不会将HTTP200、订阅摘要、登录页或付费墙页面冒充全文。

## 配置与权限

密钥只放本机 `.env`，不要进入Git、日志、截图、快照导出或本说明。

| 配置 | 用途与边界 |
|---|---|
| `ACQUISITION_AUTOSTART` | true/false，是否随本地工作台启动采集 |
| `GITHUB_TOKEN` | 可选只读token，改善公开API配额；无需仓库写权限 |
| `REDDIT_ACCESS_APPROVED` | 只有实际获得平台访问批准时才设true |
| `REDDIT_ACCESS_TOKEN` | 已获准应用的OAuth访问令牌；失效后需更新 |
| `REDDIT_USER_AGENT` | 获准应用可识别的User-Agent |
| `REDDIT_AI_APPROVED` | 仅在平台用途与第三方模型处理条件实际获准时设true；与访问许可分开 |

Reddit 不通过匿名JSON/RSS或页面抓取绕过批准；通用UI按钮不能替代批准，导出保持关闭。其他来源的外部AI、导出和公开原文补全默认分别控制，由界面明确说明效果后确认。公开可读并不自动授予再分发或外部模型处理权。AIHOT外部商业用途须按其当前使用规则另获许可。

修改失效入口后回到待验证状态；用户应提供正确的公开RSS/查询地址或所需许可，而不是删除来源让指标变好。The Verge全站RSS目前仅作为已探测候选，不会悄悄替换AI专栏并称其验证通过。

## 验收与尚未完成

已经分层建立：connector模拟合同测试、隔离SQLite故障/恢复/安全测试、真实本地API与浏览器验收、真实少量HTTP入库烟测。UI验收覆盖权限确认、14媒体保留、Reddit无凭据阻塞、未来任务取消、完整转录、发现关系、评论上下文、删除后隐藏、小屏与错误状态；同步/补采按钮的外部返回模拟明确标记，不冒充上游运行。

迁移专项、19项存储故障/权限测试、9项新增回归、provider/community协议测试及真实本地API/浏览器测试已通过。独立worker真实单源已通过（10条发现）。完整验证汇总见 `output/acquisition/verification-summary.json`。

过期内容在读取时做只读隐藏，包括分段、发现信息、派生引文及历史版本；查看页面不会执行删除。物理清理由独立采集任务按保留策略执行。原始HTTP快照存在SQLite中，通过事务标记已应用并按到期时间清理，没有另建与数据库双向同步的文件存储。

仍未完成的真实验收包括：

- Reddit获准应用的真实帖子/多排序评论/续采/删除复查；当前缺权限和凭据。
- 失败媒体入口的修复和重新验证、所有社区查询的稳定可用性。
- Follow Builders跨多日提交联合历史回放、真实非空博客批次、上游历史缺口处理的长期运行。
- AIHOT全快照到完整增量追平、多日日报补缺及真实上游409恢复。
- 全部媒体全文补全质量与实际内容使用权限。
- **连续7天观察、机器睡眠/唤醒/离线恢复与长期错误恢复**。短时测试、模拟时钟及 `observe` 显示运行天数都不等于通过；需逐日记录实际覆盖、错误、续采及权限状态。

本次不 fork Follow Builders、不运行其生成器、不调用付费 X 或播客转录API、不自动push。收尾应创建独立提交，保留任务外改动。

## 最终验证记录

2026-09-20 最终结果：`npm run test:unit`、`test:pi`、`test:extension`、`test:app-exit`、`test:mcp`、`test:intelligence:v2`、`test:acquisition`、`npm test`、`npm run check`、`npm run build` 均通过。迁移、19项存储和9项回归另行通过；检查点及权限测试的HTTP为模拟，不能据此宣称外部平台接入成功。

实施文件差异格式检查通过。原执行包 IMPLEMENTATION_PLAN.md 第3–5行原有Markdown换行空格原样保留，未为消除格式提示改写用户输入；CODEX_START、计划、manifest和原始inventory与ZIP逐字节一致。

最终只读核对正式库仍为v28、190条来源、28条旧渠道；没有替用户启动生产采集或迁移。完整机器可读汇总：`output/acquisition/verification-summary.json`。
