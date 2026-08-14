# content-studio

个人 AI 内容创作流水线。**随手扔一条链接或想法进 Bot，几分钟后它变成素材卡；每天下午自动聚成选题推给你；点一下按钮，稿子就写好了。**

不是一个「AI 写作工具」——那种东西的问题是你每次都要从空白开始。这套东西解决的是**素材的积累与复用**：你平时看到的每条内容都被结构化存下来，写的时候由系统自己检索出相关的料喂给模型。写得越久，素材库越厚，产出越像你自己。

```
Telegram / 飞书  ──随手扔──▶  灵感库
                                │ 5 分钟内自动初筛，判断价值
                                ▼
                             素材库 ──┐  金句 / 数据 / 案例 / 框架 / 观点…
                                      │
              每天 14:00 自动聚类 ◀────┘
                    │
                    ▼
                 选题库 ──点一下平台按钮──▶ 成稿 ──▶ Obsidian vault
```

## 它替你做什么

- **零摩擦采集**：发给 Bot 就完事，不用选分类、不用起标题、不用打标签
- **自动初筛**：判断这条料值不值得深挖，值得的提炼成结构化素材卡（金句、数据、案例、框架…），不值得的直接归档
- **每日聚类**：把散落的素材跨条聚成有观点的选题，附上核心观点、目标读者、建议平台
- **一键成稿**：点卡片上的平台按钮，系统自动检索相关素材、按该平台的写作规范出稿
- **归档进知识库**：稿件和素材以 Markdown 落进你的 Obsidian vault，带双向链接，稿件能溯源到用了哪几条素材

## 它刻意不做什么

- **不替你发布。** 稿子只到「待修改」为止，发布前你必须自己过一遍
- **不编造你的经历。** 有一道硬闸：模型写出「我曾经…」这类第一人称叙事时，必须能在你录入的「个人经历」类素材里找到依据，否则直接拒绝落库。这不是提示词层面的约束，是代码层面的
- **逐字素材不自动采信。** 金句和数据标记为「待核验」，除非系统抓到原文并逐字比对成功

## 你需要准备什么

| | 必须 | 说明 |
|---|---|---|
| Node.js 20+ | ✅ | |
| Cloudflare 账号 | ✅ | 免费版够用。Workers + D1 + Workflows |
| LLM API key | ✅ | 任何 OpenAI 兼容服务：DeepSeek、智谱、月之暗面、自建代理… |
| Telegram bot | 二选一 | 国内需要梯子 |
| 飞书自建应用 | 二选一 | 国内直接可用，且能用卡片按钮拍板 |
| 自己的域名 | 用飞书则必须 | 飞书的事件推送到不了 `*.workers.dev`，见下 |
| Obsidian vault（GitHub 同步） | 可选 | 不配就只存数据库，流水线照常跑 |

## 安装

### 1. 后端（worker/）

```bash
cd worker
npm install

cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars
```

建库并建表：

```bash
npx wrangler d1 create content-pipeline
# 把返回的 database_id 填进 wrangler.jsonc
npx wrangler d1 execute content-pipeline --remote --file=schema.sql
```

把密钥交给 Cloudflare（`.dev.vars` 只管本地，线上要单独设）：

```bash
npx wrangler secret put LLM_API_KEY
npx wrangler secret put WORKBENCH_KEY          # 自己编一个，工作台要用同一个
npx wrangler secret put TELEGRAM_BOT_TOKEN     # 用 Telegram 才需要
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put LARK_APP_SECRET        # 用飞书才需要
npx wrangler secret put GITHUB_TOKEN           # 要归档进 vault 才需要
```

```bash
npx wrangler deploy
```

### 2. 接一个 Bot

**Telegram**：找 @BotFather 建 bot，然后把 webhook 指过来：

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<你的worker地址>&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

**飞书**（推荐，国内可用）：开放平台建**自建应用**，然后

1. **必须先给 Worker 绑自定义域名**——飞书的事件推送到不了 `*.workers.dev`（该域名在国内解析被污染，Cloudflare 免费版在大陆又没节点），后台填回调地址会一直报「请求3秒超时」。在 `wrangler.jsonc` 的 `routes` 里填一个你托管在同一 Cloudflare 账号下的域名，重新 deploy
2. 权限管理：开 `im:message` + `im:message:send_as_bot`
3. 事件与回调 → **事件配置**：订阅方式选「将事件发送至开发者服务器」，地址 `https://<你的域名>/lark`，添加事件 `im.message.receive_v1`
4. 事件与回调 → **回调配置**（卡片按钮走这条，和上面是两条独立链路）：地址 `https://<你的域名>/lark-card`
5. 版本管理与发布 → 发布（改了权限和事件必须重发才生效）
6. 给 bot 发条消息，`npx wrangler tail` 里读到自己的 `open_id`，填进 `wrangler.jsonc` 的 `LARK_OWNER_OPEN_ID` 再 deploy——**在那之前 bot 对任何人都响应命令**

### 3. 工作台（workbench/，可选）

一个本地的桌面界面，用来读稿子、批注、划词问 AI、看发布数据。**不装也能用**——Bot 那条路是完整的。

```bash
cd workbench
npm install
cp .env.example .env      # 填 Worker 地址、WORKBENCH_KEY、vault 路径
npm run dev
```

它只绑 `127.0.0.1`，**不要部署到公网**（前端无鉴权、`.env` 里有密钥）。

## 用起来

给 Bot 发任何链接或一段话，就进了灵感库。剩下的它自己做。

命令（发 `/help` 看完整说明）：

```
/金句 <内容> [—— 出处]     逐字保真，标记待核验
/概念 /案例 /数据 /框架 /经历   直接存对应类型
/素材 <随手粘>             让模型判类型、起标题、打标签
/推 <链接|想法> [#存]       快速出 X 推文候选
/整理                      立刻聚类出选题
/状态                      各库待处理数量
```

追加 `#词`：能匹配到选题名就挂关联，否则当标签。

## 费用

Cloudflare 免费版够跑（Workers 10 万次/天、D1 500MB、Workflows 免费额度）。真正花钱的是 LLM——按 DeepSeek 的价格，每天十几条灵感 + 一两篇成稿大约几毛钱。

## 结构

```
worker/      Cloudflare Worker：数据、任务、Bot 入口
workbench/   本地工作台（React + Vite，API 挂在 dev server 中间件里）
```

两个包各自独立构建和部署。**Worker 是所有数据规则的唯一真源**，工作台不定义任何数据规则——它拿到的是压平后的字段，不是数据库原始行。所以换数据库时工作台一行都不用改（这套东西从 Notion 迁到 D1 时验证过）。

细节见各自的 `CLAUDE.md`。

## 从 Notion 迁移

如果你之前也在用 Notion 存这套流水线，`worker/scripts/migrate-from-notion.mjs` 能把四个库导成 SQL：

```bash
# 在 .dev.vars 里填 NOTION_TOKEN 和四个 NOTION_*_DB_ID
node scripts/migrate-from-notion.mjs
npx wrangler d1 execute content-pipeline --remote --file=tmp/migrate.sql
```

它会沿用 Notion 的 page id 作主键，所以任何已经记下这些 id 的地方都不会失效。不认识的枚举值不会静默丢弃，会兜底并在最后统一报告——迁移最怕的是「跑完了看起来没事，其实有一批状态被悄悄改了」。

## License

MIT
