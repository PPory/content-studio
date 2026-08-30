# Xenho Agent 执行层

这里是本地工作台与 Pi Agent SDK 之间唯一的运行时边界。SQLite 工作区和本地域层保存正文、关系、状态、版本和审计；Pi 负责会话、推理、Runtime Skill 与受控工具调用。

## 边界

- `pi-runtime.mjs` 直接调用锁定版本的 Pi 包，不经过 CLI、TUI 或 RPC。
- `permission-modes.mjs` 固定 daily、creative、developer 三种服务端权限白名单。
- `agent-access.mjs` 只允许当前工作区和用户明确授权的本地挂载；每次访问都重新检查路径越界与链接逃逸。
- `pi-tools.mjs` 注册只读能力和待确认动作。正文、发布、删除、业务状态、文件写入和 PowerShell 不能由模型静默执行。
- `assistant-runner.mjs` 保存本地对话、附件、候选动作和 Pi session 标识；对话不依赖任何远程业务数据库。
- `.agents/skills/` 由产品运行时发现；开发期 UI Skill 不得放入这里。

## 验证

升级 Pi 时同时锁定 `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-ai` 的精确版本。运行 `npm run test:pi` 后再跑完整验证。任何写入、越界或附件测试都必须使用系统临时目录中的隔离工作区。
