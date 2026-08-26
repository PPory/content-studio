# content-studio

个人 AI 内容创作流水线。产品说明看 [`README.md`](README.md)；目标流程看 [`docs/工作流.md`](docs/工作流.md)。后者会明确标注与当前实现的距离：加功能前先判断它属于「反应 / 挑一个写 / 看效果」哪一步，再以当前代码和测试确认现状。

本文件只管跨包边界。进入子目录后继续遵守 [`worker/CLAUDE.md`](worker/CLAUDE.md) 或 [`workbench/CLAUDE.md`](workbench/CLAUDE.md)。

```text
worker/      Cloudflare Worker：D1、定时任务、Bot、/wb/* 业务端点
workbench/   本地工作台：React + Vite、本地 API、Pi Agent SDK
```

两个包独立维护，不新增共享业务包。Worker 部署到 Cloudflare；workbench 只在本地运行，`npm run build` 仅用于编译验证。

## 跨包边界

1. **Worker/D1 是业务真源。** 状态、字段、关系、幂等、真实性校验、发布和长任务都在 `worker/`；workbench 可以映射契约值用于展示，但不得另建业务规则。
2. **跨包只认 `/wb/*` 契约。** 工作台消费压平后的字段；缺字段时先扩展 Worker 响应，不读取或猜测数据库内部结构。
3. **D1 与 vault 不做双向同步。** 业务运行态留在 D1；vault 保存本地知识和可读归档。只有端点明确返回 `vaultPath` / `vaultPaths` 时才能据此处理归档路径。
4. **Pi Agent 只提出候选。** 正文、业务状态、发布、删除、文件写入和命令执行必须说明影响，由用户确认后通过应用或领域接口执行，不能静默修改。
5. **真实性是代码硬闸。** 模型生成的个人经历必须经过 `assertGroundedGeneratedText` 等服务端校验；不得为了跑通功能绕过。
6. **系统信息不进正文。** 幂等键、任务标识和关系放结构化字段或约束，不让内容替系统保存状态。

## 改哪个包

- schema、状态机、任务、Bot、流水线提示词、业务校验 → `worker/`
- 界面、阅读体验、本地 Pi 运行时与权限、本地提示词、vault 和桌面集成 → `workbench/`
- 跨包改动先改 Worker 契约，再更新 workbench 消费端和两边测试；同一条规则只实现一次。

## 验证

```powershell
cd worker
npm test
npx wrangler deploy --dry-run --outdir=tmp/dryrun

cd ../workbench
npm run check
npm run test:unit
npm run build
```

- 改 UI 或流程再跑 `npm test`；Agent、写作、桌面或视觉改动按 `workbench/CLAUDE.md` 加跑专项验收。
- 只有任务明确涉及线上状态且获得授权时，才触发 `/run/<task>`、运行 `wrangler tail` 或查询远程 D1；执行前明确区分 `--local` 与 `--remote`。

## 配置与分发

- `worker/wrangler.jsonc` 和 `workbench/.env` 含本机配置且不进 Git；仓库只提交不含真实值的 `.example`。
- workbench 环境变量清单的真源是 `workbench/server/lib/settings-schema.mjs`；新增变量时同步 `.env.example`，禁止把密钥写进示例、前端包或日志。
