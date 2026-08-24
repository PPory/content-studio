# Xenho 专家执行层

这里是工作台与 DeepSeek Harness 之间唯一的边界。内容项目、正文、素材关系和风格设置仍由 Xenho 工作台负责；Harness 只执行一次专家研究任务。

## 升级 Harness

1. 先在官方仓库确认同一发布标签下各个 `@deepseek-ai/dsh-*` 包的版本。
2. 在 `package.json` 中把七个 Harness 直接依赖同时升级，并继续使用精确版本，不加 `^` 或 `~`。
3. 更新 `harness-adapter.mjs` 的 `HARNESS_VERSION`。其他业务文件不得直接导入 Harness SDK。
4. 对照新版本检查 `cordis.yml` 的插件名、配置字段和 JSON-RPC 启动入口。
5. 运行 `npm run test:harness`。它会检查版本一致性，并真实启动子进程完成握手和关闭；未通过时不要继续升级。
6. 再运行 `npm run test:unit`、`npm run test:writing`、`npm run build`，确认专家报告和普通写作都没有退化。

`xenho-tools.mjs` 是受控工具面：只提供本地知识检索、搜索结果读取和结构化报告提交。不要直接启用任意命令执行或无边界 URL 抓取工具。
