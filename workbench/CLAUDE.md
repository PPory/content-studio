# workbench

Xenho OS 的现役本地应用。React 界面、本地 API、SQLite、资产库和 Pi Agent SDK 在同一个 Vite 进程中运行。

## 先看哪里

- 产品流程：[`../docs/工作流.md`](../docs/工作流.md)
- 架构与存储：[`docs/design.md`](docs/design.md)
- AI 协作：[`docs/ai-experience-redesign.md`](docs/ai-experience-redesign.md)
- 视觉与交互：[`docs/design-system.md`](docs/design-system.md)
- Agent 运行时：[`server/agent-runtime/README.md`](server/agent-runtime/README.md)
- 桌面启动：[`docs/desktop-app.md`](docs/desktop-app.md)

## 运行边界

- Node.js 20+，React 19 + Vite 8；本地 API 挂在 `server/vite-plugin-workbench.mjs`。
- 只监听 `127.0.0.1`，不得部署公网或局域网；`npm run build` 只证明可以编译。
- `XENHO_HOME/Workspace/workbench.db` 是唯一业务真源；资产、备份和导出也在同一总根下。
- Markdown 只做导入导出，不做第二运行时或双向同步。
- `.env` 不进 Git。变量真源是 `server/lib/settings-schema.mjs`，新增变量时同步 `.env.example`。

## 代码边界

- `src/`：页面、组件和前端 API；页面之间不要互相 import。
- `server/routes/`：本地 HTTP 契约；业务规则不要复制到前端。
- `server/storage/`、`server/domain/`：SQLite、资产、版本、审计和业务不变量。
- `server/agent-runtime/`：Pi 会话、权限模式和受控工具。
- `.agents/skills/` 只放产品 Runtime Skills；开发期 UI Skill 放 `.claude/skills/`。

AI 只生成候选。正文、状态、发布、删除、文件写入和命令必须经用户确认后由应用或领域接口执行。附件必须读取真实字节；读不到就明确说明。所有路径写入必须经过根目录限制和真实路径检查。

## 验证与提交

```powershell
npm run check
npm run test:unit
npm run test:pi
npm run test:extension
npm run test:app-exit
npm test
npm run build
```

持久化测试必须使用系统临时目录中的隔离 `XENHO_HOME`。UI 或流程必须跑真实浏览器；视觉改动再跑 `npm run shots` 并查看截图。保留用户已有改动，执行 `git diff --check`，独立提交，不自行 push。
