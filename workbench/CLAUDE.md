# workbench

content-studio 的本地创作工作台。React 界面连接同仓 Worker/D1、Obsidian vault、平台数据与 Pi Agent；本文件只保留改代码时必须知道的边界，产品介绍不在这里重复。

## 先看哪里

- 产品目标与流程：[`../docs/工作流.md`](../docs/工作流.md)（目标态，不是实现证明）。
- 现役架构与存储：[`docs/design.md`](docs/design.md)；视觉与交互：[`docs/design-system.md`](docs/design-system.md)。
- Agent 运行时：[`server/agent-runtime/README.md`](server/agent-runtime/README.md)；桌面启动链：[`docs/desktop-app.md`](docs/desktop-app.md)。
- 事实冲突时以当前代码、Worker 契约和测试为准，并同步修正文档。

## 运行

```powershell
npm install
npm run dev          # http://127.0.0.1:5180
npm run app:install  # 安装“Xenho OS”开始菜单入口
npm run app:stop
```

- Node.js 20+；React 19 + Vite 8。API 挂在 `server/vite-plugin-workbench.mjs`，不另起服务端进程。
- 只监听 `127.0.0.1`，不得部署公网或局域网；`npm run build` 只证明前端可编译。
- `.env` 含密钥，禁止进 Git、前端包或日志。变量清单的真源是 `server/lib/settings-schema.mjs`，新增变量时再同步 `.env.example`。

## 不可破坏的边界

1. **Worker/D1 是业务真源。** 状态、字段、关系、幂等、发布与长任务都在 `worker/`；工作台只消费 `/wb/*` 契约，不复制业务规则。冲突时以 `worker/CLAUDE.md` 为准。
2. **不新增第二套存储。** 业务记录留在 D1；vault 保存本地知识、阅读和笔记类文件；禁止 D1 与 vault 双向同步。
3. **助手对话只走 Pi Agent SDK。** 入口在 `server/agent-runtime/`，保留 `/api/assistant/*` 与 NDJSON 契约；不要恢复 Harness/Cordis 路径。升级时同时锁定两个 Pi 包的相同精确版本。
4. **权限由服务端执行。** `daily / creative / developer` 的工具白名单、路径越界、链接逃逸和写入范围必须由服务端校验，不能只靠提示词。
5. **AI 只提出候选。** 正文改写、业务状态、发布、删除、文件写入和命令执行必须展示明确影响，并由用户确认后通过应用/领域接口执行；不得静默改正文或业务状态。
6. **附件必须真实读取。** 图像读取保留 `originalPath` / `imageRef` 并传真实字节；读不到像素就明确说明，禁止按文件名或上下文猜图。
7. **各模块独立失败。** 上游不可用时显示真实状态和可执行提示，不能让整个页面白屏，也不能把缺数据伪装成成功。

## 目录与修改入口

- `src/`：页面、组件和前端 API；共用行为放 `src/lib/`，页面之间不要互相 import。
- `server/routes/`、`server/lib/`：本地 API、vault、配置与外部服务；所有路径必须经过现有安全函数。
- `server/agent-runtime/`：Pi 会话、权限模式和受控工具；项目 Skills 位于仓库根 `.agents/skills/`。
- `tests/`：浏览器、Pi、写作、扩展、退出和截图验证；`scripts/`：自检与桌面启动。
- 改 UI 前读 `docs/design-system.md`；改存储、端点或运行边界前读 `docs/design.md`，不要把机制说明重新堆回本文件。

## 验证与提交

- 通用：`npm run check`、`npm run test:unit`、`npm run build`。
- UI 或流程：再跑 `npm test`；写作/助手改动再跑 `npm run test:writing` 和 `npm run test:pi`。
- 桌面启动或退出：跑 `npm run test:app-exit`，并实际从开始菜单冷启动、确认页面、端口归属和关窗退出。
- 视觉改动：完整跑 `npm run shots` 并查看截图。该脚本会临时改测试数据，禁止截断、后台遗留或与 `npm test` 并行。
- 先检查并保留用户已有改动；不要 reset、stash 或混入无关文件。完成后执行 `git diff --check`，只提交本次范围，未经要求不 push。
