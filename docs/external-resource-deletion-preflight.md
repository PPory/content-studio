# 外部资源删除前对账与恢复报告

生成日期：2026-08-30
状态：**Cloudflare 资源、Obsidian 专用目录及废弃 Telegram webhook 已删除；飞书与 Supabase 已完成新一轮精确盘点和数据恢复点，等待删除前最后确认；共享 GitHub vault 仓库和无法证明专用的上游 Token 保留。**

## 1. 迁移对账结论

正式迁移于 `2026-08-29T18:32:51.965Z` 完成，结果为通过：

- 导入 2,548 项，去重 39 项。
- 跳过 0、冲突 0、失败 0、缺失资源 0。
- D1、旧本地工作台、Xenho 历史、Obsidian、Supabase、飞书六类来源均已进入只读快照。
- 项目、稿件、正文、版本、关系、图书、知识条目、会话和资源逐类数量一致。
- 完整 ID、正文哈希、关系哈希和资源清单位于恢复点的 `migration-reconciliation.json`。

阶段 6 本地化提交为 `eb75e13`。`worker/`、`supabase/` 的 119 个已跟踪历史文件已从现役仓库删除，但仍可由 Git 历史恢复；本机未跟踪缓存和真实环境文件未删除。

## 2. 已交付恢复点

### 2.1 全来源迁移恢复点

- 路径：`D:\文档\Xenho\Backups\Migration-Source-2026-08-29T18-32-51-965Z`
- 模式：`read-only-snapshot`
- 快照文件：786 个
- 快照清单 SHA-256：`3a1b2c26f83fff0d8f4e8a1cb9b4fe644a3749652f314aa6735accdd4791b344`
- 对账 JSON SHA-256：`7ae747515d653cf9ac9e8847234756b0ffd6444e3e6d5809732e2f377127bd84`
- D1 原始数据：`source-snapshot/sources/d1.json`
- 飞书原始盘点：`source-snapshot/sources/feishu.json`
- Supabase 原始盘点：`source-snapshot/sources/supabase.json`
- Obsidian 原始盘点：`source-snapshot/sources/obsidian.json`

### 2.2 Obsidian 工作台整目录恢复点

- 精确来源：`D:\ObsidianVault\obsidian-vault\99 - 个人工作台`
- 已确认：真实目录、不是链接或联接点。
- 文件：1,804 个；总字节：58,325,294。
- 恢复点：`D:\文档\Xenho\Backups\External-Deletion-Preflight-2026-08-30T13-06-35-380`
- ZIP：`obsidian-workbench.zip`，46,571,873 字节。
- ZIP SHA-256：`f66df29df5a94e7532d5d44e9a37c5e92698d1c057f9ffc33f77ec0527a7a301`
- 逐文件清单 SHA-256：`6e9424417f8b3c63d89f8379540a0284924b92df12cd1786f3a5cc823d57d54e`
- 已在系统临时目录实际解压，1,804 个文件逐项 SHA-256 一致；临时目录已清理。

## 3. 精确资源清单

### 3.1 Cloudflare：已只读远程确认

账号：`7ff51d3a4efac0d1889cbb984ead5c33`

项目专用候选资源：

- Worker：`content-pipeline`
- 当前版本：`855a254a-ef67-4945-bc3f-a99e15f81ef7`
- 默认端点：`https://content-pipeline.zongxinl258.workers.dev`
- 自定义域名：`pipeline.214007.xyz`
- D1：`content-pipeline`
- D1 ID：`10dfd4ad-7a6c-4418-98e4-563305698908`
- Workflow：`content-jobs`，脚本 `content-pipeline`，类 `JobWorkflow`
- Cron：`*/5 * * * *`
- 处理器：`fetch`、`scheduled`
- 飞书回调路径：`/lark`、`/lark-card`
- Telegram：所有其他 POST 请求进入 Telegram webhook；手动任务路径为 `/run/{triage|synthesize|draft|backfill|backup}`。
- 旧工作台接口前缀：`/wb/`

线上版本已确认 `MIGRATION_READ_ONLY="1"`，旧写入已冻结。

Worker 内仅确认下列密钥名称，不读取值：

- `GITHUB_TOKEN`
- `JINA_API_KEY`
- `LARK_APP_SECRET`
- `LLM_API_KEY`
- `NOTION_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `WORKBENCH_KEY`

删除 Worker 会移除其绑定密钥；**不会自动撤销这些上游 Token**。只有能证明某个 Token 为本项目专用时，才另行撤销。

明确排除以下同账号 D1，不得删除：

- `bid-fill-license-staging`：`f0c0132b-1c83-431a-9b9c-ad5890ad13a2`
- `cloudmail`：`50ec9f44-03e6-4408-8f0c-8ff712decce7`
- `bid-fill-license`：`b4d98c7d-038b-430b-acb1-64026c38f805`

### 3.2 飞书：已完成空间全量盘点和恢复点

- 旧 Worker 飞书应用 ID：`cli_a8fa1224b60b500c`
- 知识空间 ID：`7679130449024666605`
- 空间名称：`工作台知识库`
- 顶层节点：`首页`
- 节点 token：`NFzvwXpdOiNlnRk5zu8cF4qnnri`
- 文档 token：`YaHsdzefyoPGw0xFlMrcTRwXnMc`
- 节点类型：`origin` / `docx`
- 所有者与创建者：当前飞书用户。
- 父节点为空，且 `has_child=true`。
- 全空间共 24 个节点、24 份文档和 1 个媒体文件。
- `首页` 下有 4 个直接子节点：`99 回收站`及 3 篇工作台稿件；`99 回收站`下有 19 个子节点且无更深层级。
- 另一个空间 `AI知识库`（`7598008299233004757`）是独立资源，明确排除。

飞书删除恢复点：

- 路径：`D:\文档\Xenho\Backups\External-Deletion-Lark-2026-08-30T13-47-15-002`
- ZIP：`lark-workbench-space.zip`，2,209,486 字节。
- ZIP SHA-256：`c610a3dd87f01786f8240a30d027c15c4a74e044ff303830cfcfdecb576a8493`
- 逐文件清单 SHA-256：`43d6895ea81329f1d6fa5979073b80b9debe60d9f7faa666bb63f4ce373b6d6d`
- 已在系统临时目录解压，50 个文件逐项 SHA-256 一致；临时目录已清理。
- 完整节点 token、父子关系、文档 Markdown/JSON 和媒体文件均在恢复点内。

当前用于盘点的 CLI 应用 ID 为 `cli_a9422a4e69625cd5`，与旧 Worker 应用不同，不得删除或撤销。旧 Worker 飞书应用 `cli_a8fa1224b60b500c` 的密钥已随 Worker 删除，当前凭据不能读取或修改该旧应用的后台回调登记；不得猜测接口或误改当前 CLI 应用。

### 3.3 Supabase：已完成业务数据与 Storage 盘点和恢复点

- 项目引用：`ynplhqqmljbhwbghslmf`
- URL：`https://ynplhqqmljbhwbghslmf.supabase.co`
- 本地历史配置名：`content-studio`
- 迁移快照把它标记为旧影子数据，原恢复点只保存了表数量，没有保存逐行内容。
- 远端共有 23 张已知业务表；18 张非空，共 328 行。
- 非空计数：`workspaces 1`、`media_assets 1`、`external_document_assets 1`、`inbox 10`、`topics 10`、`drafts 11`、`materials 31`、`tags 49`、`material_tags 103`、`inbox_tags 26`、`topic_materials 21`、`topic_inbox 6`、`task_log 3`、`settings 9`、`external_documents 8`、`seeds 5`、`content_documents 17`、`feishu_tree_nodes 16`。
- 空表：`workspace_members`、`comments`、`agent_tasks`、`published_posts`、`sync_conflicts`。
- Storage bucket：私有 `workbench-media`；1 个对象，2,134,718 字节。

Supabase 删除恢复点：

- 路径：`D:\文档\Xenho\Backups\External-Deletion-Supabase-2026-08-30T14-00-48-138`
- 内容：23 张表的完整 JSON、`workbench-media` 全部对象、计数和逐文件清单。
- ZIP：`supabase-content-studio.zip`，2,246,610 字节。
- ZIP SHA-256：`03811c25790ad34ec544eaa18b152370f8c36ab106ddf633770adb6b2189bcfe`
- 逐文件清单 SHA-256：`55328b01188240fa06cdc66cdd8145d7647aa1349dee9317a1f27df299e522b8`
- 媒体对象 SHA-256：`970c2cf9455672a2c89dd7195b82aef75254be5f484dbf5301b1cbfabb4add10`
- 已在系统临时目录解压，27 个文件逐项 SHA-256 一致；临时目录已清理。

Supabase CLI 的管理接口仍返回 `Unauthorized`，因此当前会话不能确认组织级归属、远端函数等项目级资源，也不能执行项目删除。数据恢复点已就绪，但仍需项目管理员认证和最后确认后才能删除项目 `ynplhqqmljbhwbghslmf`。

### 3.4 Obsidian：目录已精确核验

可删除候选仅为：

- `D:\ObsidianVault\obsidian-vault\99 - 个人工作台`

明确排除：

- `D:\ObsidianVault\obsidian-vault` 整个 vault；
- vault 内其他目录；
- Obsidian 程序和配置；
- GitHub 仓库 `PPory/obsidian-vault`。

### 3.5 GitHub vault 仓库：确认是共享仓库，保留

- 仓库：私有 `PPory/obsidian-vault`，默认分支 `main`。
- 最近推送时间：2026-08-28。
- 仓库同时包含 `.obsidian`、`00 - 辛禾的知识库`、`01 - LLM Notes`、`02 - 模板库`、`03 - File`、`04 - Clippings`、`05 - 圈外-L1`、`06 - 一行108`、`07 - 提示词库`、`09 - Youtube`、`10 - B站`、`assets` 等非工作台内容。
- 旧工作台子树 `99 - 个人工作台` 有 1,854 个 Git tree 条目、1,805 个 blob、58,249,869 字节。

该仓库明显被其他知识库内容共用，**不得删除整个仓库，也不得撤销当前 GitHub CLI 凭据**。本轮未改动仓库及其子树。

### 3.6 回调和上游 Token

- Telegram Bot：`n8n_ob_bot`（ID `8202031142`）。
- 已删除 webhook：`https://content-pipeline.zongxinl258.workers.dev/`。
- 删除前后积压消息均为 0；删除后 `getWebhookInfo.url` 为空。
- Bot 本身和 Bot Token 保留：名称表明可能仍由 n8n 或其他项目使用，无法证明为本项目专用。
- 旧飞书应用后台回调：旧应用 ID 已锁定，但缺少该旧应用的管理凭据；当前 CLI 应用是另一应用，未作改动。
- `LLM_API_KEY`、`NOTION_TOKEN`、`JINA_API_KEY` 可能被其他项目共用，无法证明专用，未撤销。
- Supabase secret key 在项目删除前仍用于恢复和校验，未撤销。
- Worker 内的 `WORKBENCH_KEY`、`TELEGRAM_WEBHOOK_SECRET`、`LARK_APP_SECRET` 等绑定值已随 Worker 删除，但这不等同于撤销外部服务账号或共享 Token。

## 4. 当前删除就绪度

| 资源 | 对账 | 恢复点 | 精确归属 | 当前结论 |
| --- | --- | --- | --- | --- |
| Cloudflare Worker / D1 / Workflow / 路由 / Cron | 通过 | 通过 | 已远程确认 | 已按最终确认删除并验证不存在 |
| Obsidian `99 - 个人工作台` | 通过 | 整目录归档并实测恢复 | 已核验绝对路径 | 已按最终确认删除，vault 其他项目未变 |
| 飞书 `工作台知识库` | 全量枚举 24 个节点 | 完整导出并实测恢复 | 已证明为工作台专用 | 等待新版清单交付后的最后确认 |
| Supabase `ynplhqqmljbhwbghslmf` | 23 表 328 行、1 个对象 | 完整数据导出并实测恢复 | 管理接口未认证 | 等待管理员认证及最后确认 |
| Telegram webhook | 通过 | 无积压消息 | 仅指向已删除 Worker | 已删除并验证登记为空 |
| GitHub `PPory/obsidian-vault` | 通过 | Git 仓库仍在 | 明确被其他内容共用 | 保留，不删除 |
| 上游 Token / 授权 | 不适用 | 不在报告保存密钥值 | 是否共享未知 | 保留，不撤销 |

## 5. 最终确认边界

此前对 119 个 Git 历史文件的批准只适用于仓库内删除。用户随后单独明确确认并完成了 Cloudflare 资源和 Obsidian 专用目录删除；2026-08-30 又授权撤销可证明无用的后台回调，因此仅删除了精确匹配旧 Worker 的 Telegram webhook。

本报告新增了此前未交付的飞书全量节点清单和 Supabase 完整数据恢复点。按既定安全边界，删除飞书空间前仍需最后明确确认空间 ID `7679130449024666605`；删除 Supabase 前还需完成项目管理员认证，并最后明确确认项目引用 `ynplhqqmljbhwbghslmf`。GitHub 共享仓库和不能证明专用的 Token 不进入确认候选。

## 6. 实际删除与验证记录

最后更新时间：`2026-08-30T14:08:00+08:00`

### 6.1 Cloudflare

已删除：

- Workflow `content-jobs` 及其实例；
- Worker `content-pipeline`，随之解除 Worker 路由、Cron、绑定与 Worker 内密钥；
- D1 `content-pipeline`（`10dfd4ad-7a6c-4418-98e4-563305698908`）。

删除后验证：

- 查询 Worker 部署返回 `This Worker does not exist on your account`（Cloudflare 代码 `10007`）；
- 当前账号没有已部署 Workflow；
- D1 列表不再包含目标 ID；
- `content-pipeline.zongxinl258.workers.dev` 返回 404；
- `pipeline.214007.xyz` 不再建立旧 Worker 服务连接；
- `bid-fill-license-staging`、`cloudmail`、`bid-fill-license` 三个 D1 仍存在且 ID 未变。

未执行：飞书后台操作、GitHub Token 撤销、LLM/Jina/Notion Token 撤销、Cloudflare 账号内其他资源删除。

### 6.2 Obsidian

已删除唯一目标：`D:\ObsidianVault\obsidian-vault\99 - 个人工作台`。

删除后验证：

- 目标目录不存在，vault 根目录仍存在；
- 删除前后的 17 个兄弟项目清单完全一致；
- 恢复 ZIP SHA-256 仍为 `f66df29df5a94e7532d5d44e9a37c5e92698d1c057f9ffc33f77ec0527a7a301`；
- 未删除整个 vault、其他目录、Obsidian 程序或 GitHub vault 仓库。

### 6.3 本地工作台

从当前提交导出独立副本到系统临时目录，移除旧 Worker、Supabase、飞书和 vault 环境变量，并将外网代理指向不可用地址后完成：

- `npm run check`；
- 真实 Chromium 页面渲染；
- SQLite 自动保存；
- 刷新后持久化读取；
- 本地设置页检查；
- 页面无运行异常。

测试只使用系统临时 `XENHO_HOME`，结束后临时副本与数据均已清理。

### 6.4 Telegram

已撤销 `n8n_ob_bot` 指向已删除 Worker 的 webhook，未设置 `drop_pending_updates`，未删除 Bot，未吊销 Token。删除前目标 URL 精确匹配，删除后 URL 为空，前后积压消息均为 0。

### 6.5 本轮明确保留

- 飞书 `工作台知识库`：恢复点已就绪，等待本报告交付后的最后确认。
- Supabase `ynplhqqmljbhwbghslmf`：恢复点已就绪，但缺少管理认证，不能执行项目删除。
- GitHub `PPory/obsidian-vault`：共享仓库。
- Telegram Bot、当前飞书 CLI 应用、GitHub CLI 凭据及其他无法证明专用的上游 Token。
