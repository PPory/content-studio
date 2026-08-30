# content-studio

Xenho OS 是只在本机运行的个人 AI 内容工作台。它把采集、素材、种子、内容项目、写作、发布记录、复盘、书架和 AI 对话放进一个可备份的工作区。

## 现在的边界

- 一个现役工作区：系统“文档”目录下的 `Xenho`，也可用 `XENHO_HOME` 指向另一个明确目录。
- 一个业务真源：`Workspace/workbench.db`（SQLite）。状态、正文、关系、版本、审计和任务都在这里。
- 图片、图书原件和附件保存在同一工作区的资产目录，并由 SQLite 记录关系。
- Markdown 只用于导入、导出和携带，不是第二套运行时数据源。
- 只监听 `127.0.0.1`，不部署公网，不依赖飞书、Supabase、D1、Cloudflare Worker 或 Obsidian。
- AI 只给候选；修改正式正文、发布、删除、写文件和执行命令都需要用户确认。

## 工作流

1. 反应：收下一条想法、链接或选区，留下自己的判断，形成种子或素材。
2. 挑一个写：从种子或空白项目开始，按需引用素材，手写或让 AI 生成候选。
3. 看效果：记录发布事实和指标，复盘哪些判断值得继续。

详细目标见 [`docs/工作流.md`](docs/工作流.md)，迁移边界见 [`docs/local-first-migration-handoff.md`](docs/local-first-migration-handoff.md)。

## 运行

需要 Node.js 20+。

```powershell
cd workbench
npm install
Copy-Item .env.example .env
npm run dev
```

打开 `http://127.0.0.1:5180`。也可执行 `npm run app:install` 安装“Xenho OS”开始菜单入口。

模型最少需要在 `workbench/.env` 中配置：

```dotenv
AGENT_LLM_BASE_URL=
AGENT_LLM_MODEL=
AGENT_LLM_API_KEY=
AGENT_LLM_PROTOCOL=openai-completions
```

变量清单的唯一来源是 `workbench/server/lib/settings-schema.mjs`。`.env` 含密钥，不进入 Git、前端包、备份或导出文件。

## 数据与恢复

工作区内包含 SQLite、资产、图书、备份和导出。设置中的“备份与恢复”支持完整备份、便携备份、恢复预检和恢复前快照。

任何持久化测试必须把 `XENHO_HOME` 指向系统临时目录；禁止用真实个人工作区、真实知识库目录或历史 `.xenho` 跑测试。

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

浏览器流程和截图测试会自行创建并清理系统临时工作区。

## 目录

```text
workbench/   React + Vite、本地 API、SQLite、Pi Agent SDK
docs/        产品流程与迁移边界
```

历史云端实现只作为迁移来源和 Git 历史，不再是现役运行架构。任何外部资源的迁移、读取和删除必须明确区分；删除前必须先交付迁移对账、恢复点和精确资源清单，并等待最终明确确认。

## License

MIT
