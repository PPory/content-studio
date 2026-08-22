# content-studio

个人 AI 内容创作流水线。产品说明看 [`README.md`](README.md)，
**整条链上"哪几步自动、哪几步必须你出现"看 [`docs/工作流.md`](docs/工作流.md)**——
加功能之前先回答它属于「收 / 拍板 / 写」哪一件。这里只写**改代码时不看到就会犯错**的约束。

```
worker/      Cloudflare Worker：D1、三个定时任务、两个 Bot 入口、/wb/* 端点
workbench/   本地工作台：React + Vite，API 挂在 dev server 中间件里
```

两个包各自独立构建部署，没有共享包，也**不要加**——monorepo 里的共享包是最容易腐烂的地方。取而代之的是一条必须守住的原则：

> **Worker 是所有数据规则的唯一真源。工作台不定义任何数据规则。**

工作台拿到的是 `/wb/*` 压平后的扁平字段，不是数据库原始行——它不知道有几张表、列叫什么、状态存的是中文还是枚举。**这条守住了，换数据库时工作台一行都不用改**——这套东西从 Notion 迁到 D1 时，`/wb/*` 的对外契约一个字没动。

> ⚠️ **归档到 vault 的那条路不在这个契约里。** Worker 把归档路径写进 D1 的 `vault_path` 列，
> 但 `/wb/*` **不回这个字段**；工作台界面上的 vault 路径是它自己扫 vault 得到的
>（`workbench/server/lib/search.mjs`）。要在工作台里用「这条素材归档到哪个文件了」，
> 得先在 Worker 的响应里把它压平出来——现在没有，别照着猜一个字段名去取。

## 改哪个包

- 数据结构、状态机、任务逻辑、Bot 命令、提示词 → `worker/`
- 界面、阅读体验、交互 → `workbench/`

拿不准时问：这条规则**变了之后，另一个包需不需要跟着改**？需要，就说明它该在 Worker 里。

## 贯穿两个包的三条红线

1. **同一条规则只能有一份实现。** 这个项目栽过：`MATERIAL_TYPES` 在两个文件里各有一份且不一致，症状是「延展问题」能被初筛写进库、却不在手工入库的白名单里——同一个库两套规矩，谁也没报错。现在存储规则只在 `worker/src/lib/store.js`，命令只在 `lib/commands.js`，枚举值只在 `lib/values.js`。
2. **别让内容替系统背锅。** 任务幂等一度是把「系统任务标识：xxx」写进正文再读回来查字符串——那行系统噪音用户看得见、导出的正文里也带着。现在是表上的 `UNIQUE` 列。凡是要往正文里塞系统标记的方案，先想想能不能变成一列。
3. **真实性是代码层面的闸门，不是提示词里的叮嘱。** 模型写出第一人称经历时，`assertGroundedGeneratedText` 会要求在「个人经历」类素材里找到依据，否则直接拒绝落库。**不要为了让某个功能跑通而绕过它。**

## 验证

```bash
cd worker  && node --test test/*.test.js && npx wrangler deploy --dry-run --outdir=tmp/dryrun
cd workbench && npm run check && npm test
```

线上验证用 `/run/<task>` 端点手动触发，`npx wrangler tail` 看日志，再用
`npx wrangler d1 execute content-pipeline --remote --command "SELECT …"` 确认。
**查库前先想清楚是 `--local` 还是 `--remote`**——两个库都存在且内容不同。

## 分发相关

- `worker/wrangler.jsonc` 和 `workbench/.env` 都在 .gitignore 里，仓库里只有 `.example` 版本。**不要把自己的值改进 example 文件**，那是给下一个 clone 的人看的。
- ⚠️ **工作台的 `.env` 变量清单真源是 `workbench/server/lib/settings-schema.mjs`，不是 `.env.example`。**
  加变量改那一处，设置面板和 `/api/config` 才会跟着有；只改 example 的话面板里根本不出现，而且不报错。
  改完顺手把 `.example` 也补上——那份是给「还没跑起来」的那一刻看的。
- 用 python 测线上端点时**必须带浏览器 UA**：`Python-urllib` 会被 Cloudflare 直接 403（`error code: 1010`），`Go-http-client` 这类反而放行。排查时别把这个当成自己代码的问题。
