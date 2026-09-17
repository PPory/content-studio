# 工作台只读 MCP（本地私有使用）

## 当前交付范围

独立 stdio MCP Server，不监听任何网络端口、不挂载到 Vite、不调用模型，也不加载工作台 .env。用于 ChatGPT 的私有接入；不是公开插件。仅支持当前本地 SQLite，退役云服务不在范围内。

现役路径由 `resolveWorkspacePaths` 解析：`XENHO_HOME/Workspace/workspace.sqlite`。部分旧文档中的 workbench.db 不是当前代码的文件名。

链路：生产 SQLite → 手动、限时刷新 → 独立目录内的脱敏快照 → 只读 MCP → 官方 Secure MCP Tunnel → 你自己的 ChatGPT 工作区。

**当前并未替你创建隧道、关联账号或完成 ChatGPT / GPT-6 Pro 实际调用。** 模型是否支持该工具、账号是否具有开发者模式和隧道权限，必须在目标账号验证。不要把本地协议测试当成 ChatGPT 连接成功。

## 工具与数据

- `workbench_catalog`：数据集、采集时间、快照记录数、截断和字段缺失情况。
- `workbench_search`：关键词查找和分页浏览，只返回记录标识和短标题。
- `workbench_fetch`：按数据集和 ID 分段读正文及业务字段。每段最多 8000 字符，按 nextOffset 继续；拼接后是该条记录的 JSON。

固定白名单覆盖 30 个数据集：采集、种子、素材、项目、稿件、构思、合集、书籍、章节、阅读批注、知识卡、旧词条、Wiki、研究、创作方向、读者问题、内容机会、实验、发布记录、外部发布记录、作品指标、账号指标、复盘、普通对话、普通消息、可引用个人资料、情报精选、情报卡片、情报周报、情报来源。

这不是任意数据库浏览器。新增表和字段不会自动开放；关系表、历史版本、二进制附件、设置、提示词、密钥、执行日志、任务负载、系统和工具消息不开放。个人资料只包含 usage=reference，private/ask 仍排除；个人资料专用对话排除。软删除主记录及已明确检查的父记录不会进入下一次快照。删除或改为私密后，旧快照仍可能在下一次刷新前保留原文：**需要立即撤回时先停止隧道与 MCP，再移除独立 snapshot.json，不能仅修改生产记录。** 不删除业务库。

对话只提取 user/assistant 的纯文本消息，最多最后 100 条。JSON 业务对象逐项提取正文类字段，排除其他元数据；构思中的复杂候选、发现对象不导出。字段或记录限额会造成覆盖不全，catalog 的数字不是生产总数。

## 权限与隐私

- 采集连接同时使用 SQLite readonly、fileMustExist、query_only，锁等待为 0；仅允许已有 WAL 数据库，不初始化、不迁移、不改 journal_mode、不执行 checkpoint。
- 服务进程只接收快照目录，不接收生产库路径。没有 SQL、路径、命令、URL 请求或写业务数据的工具。
- 快照目录必须在生产总根以外。根、祖先、数据库及侧文件检查符号链接/目录联接和文件硬链接，拒绝越界。路径来自本机启动参数，GPT 无法改变。
- 本地文件目录必须由当前用户控制，禁止不可信用户修改。路径检查不是对拥有同一操作系统账号的恶意进程的隔离沙箱，也不能消除恶意并发替换目录的所有竞争风险。需要强 OS 隔离时，用独立账号运行 reader，仅给它快照读取与审计目录写入权限，不授予生产库权限。
- 常见 API key、Bearer/JWT、私钥、密码赋值、邮件、手机号、身份证格式会过滤；URL 的用户信息、查询串和片段会移除，Windows 本地路径会遮蔽。
- **自由正文的自动过滤不是完整 DLP，无法承诺识别任意秘密、非标准密钥、所有个人信息或上下文中的敏感事实。** 允许全文查询意味着经过上述处理的正文会传给 OpenAI。对“任何敏感内容都绝不外传”的要求，必须使用经人工审核的内容白名单或只开放结构化字段，不能依赖正则保证。
- stdio 使用本地进程/管道权限；远程身份鉴别依赖官方私有隧道。仅关联自己的 ChatGPT 工作区，运行凭据只授予 Tunnels Read + Use，创建管理时才需要 Manage。不得把 stdio 桥接成匿名公网接口。

## 性能与新鲜度

- 每次提问只读快照，对生产数据库零查询；不共享工作台进程。
- 手动刷新最短间隔 5 分钟、互斥运行；采集独立进程内存上限 128 MiB，尽可能降低调度优先级。
- 采集超过 5 秒会终止子进程；SQLite 锁冲突立即失败；单连接缓存 1 MiB。
- 每类最多 3000 行，总计最多 20000 行，单字段最多 100000 字符，快照总计最多 32 MiB。超总量/超时不覆盖旧快照。
- 行数按固定主键顺序截取；超限不是全库总量，也不保证包含最新记录。需要更大覆盖时，应另行设计增量镜像，不能简单取消上限。
- 返回采集时间、快照 SHA-256、live=false。快照超过 24 小时停止返回业务数据。
- 工具最多每分钟 60 次、协议消息最多每分钟 180 次，单请求帧不超过 16 KiB，search 每页最多 20 条。
- 采集仍会使用少量 CPU/磁盘并短暂持有 WAL 读事务；这不是“生产性能绝对零影响”的证明。生产规模过大时保留失败结果，不提高限额硬跑。

## 审计

独立目录的 audit.jsonl 记录进程会话、请求编号、工具、参数摘要、快照摘要、结果状态、返回字节数和耗时。不写查询原文、结果正文、凭据或原始异常。参数 SHA-256 便于关联，不能作为匿名化保证。

业务结果返回前必须成功写入并 fsync 审计。日志不可写或达到 10 MiB 时停止供数；没有自动删除历史日志的机制。停止服务后由本机用户归档，再启动。日志是本机追加式文件，不是防本机管理员篡改的 WORM 审计。隧道侧访问身份由 OpenAI 账号与权限记录，本地日志只标识 reader 会话。

单独的 server.lock / refresh.lock 防止误启动多个进程。异常断电可能留下锁：确认没有相应进程后再删除对应锁文件。不要在进程运行中移除锁。

## 本机已准备的实例

2026-09-17 已在当前 checkout 的 .xenho/readonly-mcp 建立首份真实脱敏快照，并用标准 MCP 客户端验证搜索与读取。该目录被 Git 忽略，Windows ACL 仅授予当前用户与 SYSTEM。共 30 个数据集、1798 条快照记录，无数据集触发行数上限；这不代表字段从未截断或覆盖了所有系统表。

本次执行环境中 Node 在 AppData 的 rename 返回 EXDEV，因此实际实例改用上述独立目录，未降低原子写入要求。以下通用示例中的 data-root 应替换为实际实例路径；也可在正常本机环境选择独立私有 AppData 目录。

## 本机运行

在 workbench 目录执行，路径替换成自己的实际值。data-root 是预先建立的独立私有目录，不要使用生产根或其子目录。

```powershell
$readerRoot = Join-Path $env:LOCALAPPDATA 'XenhoReadonlyMcp'
New-Item -ItemType Directory -Path $readerRoot -Force | Out-Null
npm run mcp:refresh -- --home 'D:/文档/Xenho' --data-root $readerRoot
npm run mcp:serve -- --data-root $readerRoot
```

serve 通过标准输入输出通信，启动后等待 MCP 客户端是正常行为。隧道应直接启动 node 脚本，避免 npm 状态输出污染 stdio：

```text
node "工作台绝对路径/workbench/scripts/readonly-mcp.mjs" serve --data-root "独立快照目录绝对路径"
```

刷新是本机管理操作，不是 MCP 工具，不由 GPT 触发。建议有新资料后手动刷新；服务下次请求读取更新后的快照，不需要重启。此版本不安装后台计划任务。

## 连接 ChatGPT

依据 [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 和 [连接与测试文档](https://developers.openai.com/plugins/deploy/connect-chatgpt)：

1. 在 [Platform Tunnel 设置](https://platform.openai.com/settings/organization/tunnels) 创建私有 tunnel，并关联自己的 ChatGPT 工作区及所属 Platform organization。
2. 从官方设置页下载 tunnel-client，先运行 `tunnel-client help quickstart`。
3. 在本机秘密配置中提供运行凭据 CONTROL_PLANE_API_KEY，不写到 Git、快照或聊天。运行权限只需 Tunnels Read + Use。
4. 建立本地 stdio profile（具体命令参数以安装版本 help 为准）：

```text
tunnel-client init --sample sample_mcp_stdio_local --profile xenho-readonly --tunnel-id <你的 tunnel_id> --mcp-command '<上面的 node 命令>'
tunnel-client doctor --profile xenho-readonly --explain
tunnel-client run --profile xenho-readonly
```

5. ChatGPT 设置中启用开发者模式，在 MCP/插件连接中选择 Tunnel，选定该隧道。此功能是否可用取决于账号与工作区策略。
6. 检查仅有三个只读工具；在目标 GPT-6 Pro 会话尝试“列出工作台可查询范围和采集时间”，再搜索并读取一条已知测试记录。
7. 尝试“修改/删除一条记录”，应说明无写入工具；检查本地审计。完成此步骤前，不宣称目标模型已接通。

密钥轮换/撤销在 Platform 管理；紧急停用先停止 tunnel-client 和 reader。不要将工作台 Vite 端口暴露给隧道或公网。

## 验证

`npm run test:mcp` 在系统临时目录创建独立 XENHO_HOME，用官方 SDK 客户端启动真实 stdio 服务，验证正常查询、非法参数、不可用写工具、常见密钥过滤、私密/删除过滤、越界、审计失败关闭、限频、快照过期和 SQLite 文件未变。不会读取生产内容。

## Codex 本机连接

Codex 可以直接用 stdio 连接，无需隧道密钥；在设置的 MCP 分页查看 content-studio。注册命令为 codex mcp add content-studio -- node <脚本绝对路径> serve --data-root <快照目录> --audit-root <Codex独立审计目录>。

可选 --audit-root 必须是已存在、经过路径校验的私有目录。仅 serve 接受它。它保存 audit.jsonl 与 server.lock；读取仍使用原 data-root 的同一快照，刷新无需复制。ChatGPT 与 Codex 分开审计、锁和限频，各自每分钟最多 60 次工具调用；单个审计目录仍只允许一个服务进程。一个连接的日志写满不影响另一个连接，两个目录均需由本机用户管理。默认不传参数时行为不变。
