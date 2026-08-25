# Xenho Agent 执行层

这里是工作台与 Pi Agent SDK 之间唯一的运行时边界。React 工作台、Worker/D1、vault、素材关系、正文和业务状态仍是业务真源；Pi 负责会话、推理、Skill 和服务端受控工具调用。

## 运行时边界

- `pi-runtime.mjs` 直接调用 `@earendil-works/pi-coding-agent`，不经过 CLI、TUI 或 RPC。
- `permission-modes.mjs` 固定 daily、creative、developer 三种服务端工具白名单，并校验 vault、个人工作台和项目路径。
- `pi-tools.mjs` 使用 Pi `defineTool` 注册业务工具。正文、发布、删除、业务状态、文件写入和 PowerShell 只能生成待确认动作，不能由模型静默执行。
- `assistant-runner.mjs` 保留现有 `/api/assistant/*`、NDJSON、conversation.json、附件、动作卡和消息历史，并另外保存 Pi session 标识与文件。
- 八个项目 Skill 位于仓库根目录 `.agents/skills/`，由 Pi 原生发现。

## 验证

升级 Pi 时必须同时锁定 `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-ai` 的精确版本。先运行 `npm run test:pi`，再运行完整项目验证。临时写入和越界测试只能使用系统临时 vault。
