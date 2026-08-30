# content-studio

个人、本地优先、单工作区的 AI 内容创作工作台。

产品流程见 [`docs/工作流.md`](docs/工作流.md)，迁移边界见 [`docs/local-first-migration-handoff.md`](docs/local-first-migration-handoff.md)。

## 现役结构

```text
workbench/   React + Vite、本地 API、SQLite、Pi Agent SDK
docs/        产品、架构与迁移说明
```

`worker/`、`supabase/` 只可能作为待移除的历史迁移来源存在，不得继续扩展、部署或当作运行依赖。进入 `workbench/` 前先读 `workbench/CLAUDE.md`。

## 不可破坏的边界

1. `XENHO_HOME/Workspace/workbench.db` 是唯一业务真源。状态、关系、正文、版本、审计、发布记录和任务都由本地域层维护。
2. Markdown 只做导入导出，不建立文件与 SQLite 的双向同步。
3. 所有路径必须限制在明确授权的根目录内，并重新校验真实路径、链接逃逸和越界。
4. AI 只提出候选。修改正式正文、业务状态、发布、删除、文件写入和命令执行必须说明影响并等待用户确认。
5. 真实性是代码硬闸。个人经历和事实依据必须经过服务端校验，不能用提示词或前端弱校验替代。
6. 系统信息使用结构化字段保存，正文不承担任务 ID、幂等键、关系或流程状态。
7. 本地 API 只监听回环地址，不得部署公网或局域网。
8. 密钥只保存在本机 `.env`，不得进入 Git、前端包、日志、示例真实值、备份或导出。

## 修改边界

- `workbench/src/`：界面、阅读与交互。
- `workbench/server/routes/`：本地 API 契约。
- `workbench/server/storage/`、`domain/`：SQLite、资产、业务规则和迁移。
- `workbench/server/agent-runtime/`：Pi 会话、权限和受控工具。
- `.agents/skills/`：产品运行时 Skill；开发期设计 Skill 只能放 `.claude/skills/`。

同一条业务规则只实现一次。跨层改动先修改本地域和 API，再更新前端消费端和测试。

## UI 工作

遵循：理解需求 → 检查现有实现 → 设计判断 → 复用 → 实现 → 验证。

资源优先级：现有组件 → Emil UI 判断 → coss 基础组件 → ReUI 复杂模式 → 组合 → 自定义。使用 coss 或 ReUI 前必须查真实 API，不凭记忆猜组件名或 props。

不要默认添加动画。动画只用于反馈、解释状态变化、空间关系或连续性；高频操作优先即时。检查 keyboard-only、focus、loading、empty、error、disabled、小屏幕和 reduced motion。

## 验证

```powershell
cd workbench
npm run check
npm run test:unit
npm run test:pi
npm run test:extension
npm run test:app-exit
npm test
npm run build
```

任何会写持久化数据的测试只能使用系统临时目录中的独立 `XENHO_HOME`，串行运行并在结束时清理。UI、桌面、启动和截图任务必须验证实际运行效果，不能只看构建。

保留用户已有改动，不 reset、stash、覆盖或清理任务外内容。代码修改完成后创建独立 commit；未经要求不 push。

## 外部资源

读取、迁移、冻结和删除必须明确区分。删除任何历史飞书、Supabase、D1、Worker 或知识库专用目录前，必须先交付迁移对账报告、完整恢复点和精确资源清单，再等待最终明确确认。不得删除整个知识库或可能被其他项目共用的云资源。
