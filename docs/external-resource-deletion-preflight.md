# 外部资源删除前对账与恢复报告

生成日期：2026-08-30
状态：**仅完成只读盘点和恢复点；未授权、未执行任何外部删除。**

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

### 3.2 飞书：已确认根节点，子树仍待盘点

- 旧 Worker 飞书应用 ID：`cli_a8fa1224b60b500c`
- 知识空间 ID：`7679130449024666605`
- 顶层节点：`首页`
- 节点 token：`NFzvwXpdOiNlnRk5zu8cF4qnnri`
- 文档 token：`YaHsdzefyoPGw0xFlMrcTRwXnMc`
- 节点类型：`origin` / `docx`
- 所有者与创建者：当前飞书用户。
- 父节点为空，且 `has_child=true`。

当前 CLI 只能读取单节点，不能枚举该空间的子节点。由于“首页”名称不能证明整个知识空间只属于本项目，**飞书空间、根节点及其子文档目前均不得删除**。当前用于盘点的 CLI 应用 ID 为 `cli_a9422a4e69625cd5`，与旧 Worker 应用不同，也不得删除或撤销。

### 3.3 Supabase：已锁定项目引用，远程归属未确认

- 项目引用：`ynplhqqmljbhwbghslmf`
- URL：`https://ynplhqqmljbhwbghslmf.supabase.co`
- 本地历史配置名：`content-studio`
- 迁移快照中 Supabase 资源数：0。

Supabase CLI 的只读 `projects list` 返回 `Unauthorized`，因此尚未远程确认项目名称、组织、Storage bucket 和是否被其他项目使用。**在恢复 Supabase 只读认证并完成项目、数据库和 Storage 清单前不得删除。**

### 3.4 Obsidian：目录已精确核验

可删除候选仅为：

- `D:\ObsidianVault\obsidian-vault\99 - 个人工作台`

明确排除：

- `D:\ObsidianVault\obsidian-vault` 整个 vault；
- vault 内其他目录；
- Obsidian 程序和配置；
- GitHub 仓库 `PPory/obsidian-vault`。

## 4. 当前删除就绪度

| 资源 | 对账 | 恢复点 | 精确归属 | 当前结论 |
| --- | --- | --- | --- | --- |
| Cloudflare Worker / D1 / Workflow / 路由 / Cron | 通过 | 通过 | 已远程确认 | 可在最终明确确认后删除 |
| Obsidian `99 - 个人工作台` | 通过 | 整目录归档并实测恢复 | 已核验绝对路径 | 可在最终明确确认后删除 |
| 飞书知识空间与同步文档 | 来源已快照 | 有来源快照 | 子树未枚举 | 暂不得删除 |
| Supabase 项目与 Storage | 来源为 0 | 有来源快照 | 远程认证失败 | 暂不得删除 |
| 上游 Token / 授权 | 不适用 | 不保存密钥值 | 是否共享未知 | 暂不得撤销 |

## 5. 最终确认边界

此前对 119 个 Git 历史文件的批准只适用于仓库内删除，**不构成任何外部资源删除授权**。

下一次确认必须逐项写明资源 ID 或绝对路径。未点名资源继续保留。删除执行后还必须分别验证：远端资源不存在、Webhook/路由已解除、真实 vault 其他目录未变、断网且无旧环境变量时本地工作台仍可运行。
