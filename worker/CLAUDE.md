# worker

个人 AI 内容创作流水线：Telegram 随手扔灵感 → 自动初筛成素材卡 → 每日聚类成选题 → 人工拍板后成稿。数据与状态存 Cloudflare D1，整套跑在 Cloudflare Workers 上。使用者只做两件事：给 Bot 发消息、把选题状态改成「撰写中」。

## 目标

- 灵感零摩擦采集：发给 Telegram Bot 即进入灵感库（状态=待初筛）
- 三个自动任务：任务1 即时初筛（每 5 分钟轮询）、任务2 每日整理（北京 14:00 / UTC 06:00）、任务3 按需成稿（轮询「撰写中」选题）
- 全流程幂等：只处理特定状态的行，处理完即改状态，重跑不重复
- 每周一次整库备份进 vault（北京周一 04:00 / UTC 周日 20:00），见下面「备份」一节

## 技术栈

- 语言 / 框架：JavaScript (ES Modules)，Cloudflare Workers（nodejs_compat）+ Cloudflare Workflows（Bot 长命令异步执行）
- 存储：Cloudflare D1（SQLite），结构见 `schema.sql`，binding 是 `DB`，**D1 库名仍叫 `content-pipeline`**（合仓时没改，wrangler 命令里照着写）；长文另归档进 Obsidian vault（GitHub 仓库 `<你的 GitHub 用户名>/obsidian-vault`）
- 关键依赖：`wrangler`（开发部署）。**没有 ORM**，`lib/db.js` 里是手写 SQL
- 外部服务：OpenAI 兼容 LLM 代理（模型 `claude-opus-4-6-thinking`）、Jina Reader（`r.jina.ai` 抓文章正文）、Telegram Bot API、飞书开放平台

## 启动

```bash
npm install
# 首次：建库并建表（database_id 已写进 wrangler.jsonc）
npx wrangler d1 execute content-pipeline --local  --file=schema.sql
npx wrangler d1 execute content-pipeline --remote --file=schema.sql
npx wrangler dev --test-scheduled
# 触发定时任务（本地）：
#   curl "http://localhost:8787/__scheduled?cron=*%2F5+*+*+*+*"   # 任务1+任务3
#   curl "http://localhost:8787/__scheduled?cron=0+6+*+*+*"        # 任务2
```

本地密钥放 `.dev.vars`（从 `.env` 同步，勿提交）。

## 部署

```bash
npx wrangler deploy
# 密钥（各执行一次）：
#   npx wrangler secret put LLM_API_KEY / TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / WORKBENCH_KEY / GITHUB_TOKEN
# Telegram webhook 指向 Worker 地址，带 secret_token（见 docs/deploy.md 如有）
```

不走 git push 部署，只用 `wrangler deploy`。

## 目录约定

- `src/`：源码（`index.js` 入口；`workbench.js` creator-workbench 的 `/wb/*` 端点；`tasks/` 三个任务 + `backfill.js`(vault 补写) + `backup.js`(每周整库备份)；`lib/` db(D1 访问层)/values(枚举真源)/vault(归档)/LLM/Reader/xpost/store/status 封装；`prompts.js` 从 `prompt/*.md` 加载并组装提示词）
- `prompt/`：提示词外置文件，直接编辑、`wrangler deploy` 后生效——`triage.md`(初筛)、`synthesize.md`(整理)、`draft.md`(成稿骨架)、`tweet.md`(/推 快速推文)、`voice.md`(作者声音)、`frameworks.md`(结构框架)；`prompt/platform/*.md` 是每个平台的专属创作指南（`gongzhonghao/x/xiaohongshu/shipinhao/youtube`）。占位符：`draft.md` 用 `{{voice}}`+`{{frameworks}}`+`{{platform_guide}}`，`tweet.md` 用 `{{voice}}`+`{{platform_guide}}`；`{{platform_guide}}` 按当前成稿平台注入对应文件（`tweet.md` 固定注入 `x.md`），由 `prompts.js` 的 `draftPrompt/tweetPrompt` 在调用时组装。
- `tmp/`：一次性实验文件
- 密钥只存 `.env`、`.dev.vars`、wrangler secrets，不进代码不进 Git

## 数据流转约定（改代码前必读）

- **列名英文、值中文**：SQL 里中文列名要处处加引号，得不偿失；而状态值要显示给人看。所有枚举值的真源是 `schema.sql` 的 CHECK 约束，JS 侧的镜像在 `lib/values.js`——**只有这一份**，改之前先改 schema 并写迁移语句。关键映射：LLM 输出素材类型用 `·`（金句·原话）→ 库里是 `/`（金句/原话），由 `normMaterialType` 归一；价值判断 高/中/低 → 值得深挖/存档备用/建议弃用。
- 灵感库状态机：待初筛 →(任务1，按价值分流)→ 待选题(高·待聚类) | 存档备用(中·留存不聚类) | 已弃用(低) | 初筛失败/需人工。其中「待选题」→(任务2)→「已选题」。任务1 只对「待选题」产素材卡；任务2 只读「待选题」。状态由 triage.js 的 `STATUS_BY_VALUE` 从 value 推导（也信任 LLM 给的合法 status）。
- 选题库状态机：待写 →(人工)→ 撰写中 →(任务3)→ 已成稿。
- 稿件库 `drafts`：任务3 产出的初稿存这里。旧 `status` 只保留发布事实（待修改/已发布）；现役创作阶段看 `workflow_status`（写作中/待诊断/待发布/已发布/已弃用）。`topic_id` **可以为空**——`/推` 是绕过全流程的轻路径，产出的候选本来就没有选题。`topics.primary_draft_id` 是母版真源，`drafts.parent_draft_id` 记录变体父稿；阶段只能通过 `/wb/projects/:id/transition` 推进。发布复盘（链接、时间、五个数据指标、反馈状态）也在 drafts 上，由工作台的「记录发布」一次写入。发布包（封面、关键词、互动目标）同样存在 drafts 上，平台规格只在 `lib/release-package.js` 定义。部署这套代码前必须按顺序应用 `migrations/0002_content_projects_v2.sql` 和 `migrations/0003_release_packages_v1.sql`。
- 提示词全部外置在 `prompt/*.md`（wrangler Text 模块，部署时打包进 Worker）。改提示词直接编辑对应 `.md` 再 `wrangler deploy`，不用动代码；`voice.md` 改一处，`draft.md`/`tweet.md` 都跟着变。三段主 prompt 仍与 Notion《外部自动化技术方案》第七节保持一致。
- **每个环节用哪个模型是可配的，真源在 D1 的 `settings` 表**（`lib/models.js` 的 `MODEL_TASKS` 是环节清单）。判断力重的活（初筛 / 整理 / 成稿）值得用强模型，只做归类排序的（挑素材 / 打标签 / 提标题）用便宜快的就够——全局一个 `LLM_MODEL` 时这件事没法表达。
  - **没配过的环节一律退回 `env.LLM_MODEL`**，所以「什么都没设」和加这套之前逐字等价。
  - ⚠️ **`chat/chatJson/chatStream` 要传 `task`**。不传就用默认模型、不报错——这是有意的（新加调用点忘了标环节不该让流水线停摆），代价是**打错一个字就是「设置里改了没反应」**。`test/creation.test.js` 扫全部源码兜住了这条。
  - **不缓存**：每次 LLM 调用现读一次 D1。相对一次几秒到几分钟的生成可以忽略，而缓存换来的是「改完不生效、过一会儿又生效了」这种最难解释的现象。
  - `GET/POST /wb/models` 给工作台的设置面板用；`availableModels` 顺带从代理 `GET /models` 取真实清单——**模型名打错不会在设置里报错**，会等到下一次跑那个环节时才失败。
  - ⚠️ 加了这张表要跑一次 `npx wrangler d1 execute content-pipeline --remote --file=schema.sql`（`CREATE TABLE IF NOT EXISTS`，重跑安全）。没跑之前 `readModelMap` 读不到表、静默退回默认模型，不会挂。
- **D1 免费版每次 Worker 调用限 50 条查询**（和对外 fetch 的 50 subrequest 是两笔账）。批量写一定要走 `batch()`，一次往返；`setTags` 之所以用 `INSERT…SELECT` 一条挂完所有标签，就是因为写成「每标签两条」时，初筛一轮 6 张卡 × 3 标签直接顶到上限。

## 实现要点（踩坑记录，改代码前必读）

- **webhook 的 `waitUntil` 只有 30 秒存活期（Cloudflare 硬限制，实测被掐）**：含 LLM 长生成的 Telegram 命令（/推 /成稿 /整理）不能在 webhook 的 waitUntil 里跑完。统一模式：webhook 秒回受理 → `env.JOBS.createBatch()` 搭配确定性实例 ID 入队 `JobWorkflow`（`src/jobs.js`）→ 跑完 Telegram 回执。主步骤不自动重试；业务行另以「任务标识」upsert，失败后补写也不重复。
- **单条 cron，不是两条**：免费账户单账户 cron 上限 5 个，已被其他 Worker 占 4 个，本项目只注册 `*/5 * * * *`。每日整理不靠独立 cron，而在 `scheduled` 里判断 `event.scheduledTime` 是否 UTC 06:00（北京 14:00）来触发。见 `src/index.js`。
- **LLM 必须流式调用**：LLM 代理经 Cloudflare，非流式请求超 ~100 秒会被 `524` 掐断（成稿单平台要 1-3 分钟）。`src/lib/llm.js` 用 `stream:true` + SSE 累积，持续有字节到达就不会超时。
- **成稿只写一个平台**：`draftTopic` 用 `primaryPlatform` 取「适配平台」的第一个有效值，**只生成这一篇**，勾了多个也会先把字段回写成单值。一次一个平台是有意的——一次让 LLM 输出多平台既容易超时、JSON 也更易坏，而多平台稿真正要的是逐篇打磨、不是批量产出。其他平台需要时从已完成的主稿另行适配（当前无自动改写路径，`adapt.md`/`adaptPrompt` 已移除）。
- **成稿平台按「适配平台」勾选**：只对选题当前勾选的平台成稿；想省 token 就在改「撰写中」前只勾要写的。Telegram `/成稿 <关键词> <平台列表>` 可临时覆盖字段指定平台。creator-workbench 侧把这件事做成了一道闸门：改成「撰写中」前先弹平台选择，**先写平台再改状态**（反过来的话 `runDraft` 可能在平台还没写进去时就把选题领走了，按旧的勾选成稿）。
- **「撰写中」是个会花钱的状态，任何调用方都要当它是个开关而不是个标签**。`runDraft` 每 5 分钟轮询一次，领到就按勾选的平台逐个跑 LLM——三个平台就是三篇稿、十几分钟。工作台那边曾因为一个漏传的配置项把闸门跳过了，真的空跑了一轮。
- **成稿素材=核心+检索补充**：主料是选题「关联素材」；补充料由 `fetchSupplementary` 按核心素材的标签检索素材库同标签的其他素材（读「内容」字段、去重、按相关度取前 12），拼进 prompt 时注明主/辅。补充候选只参与检索，不能自动回写「关联选题」，避免把相似素材误当成真实引用。
- **JSON 解析要容错**：thinking 模型输出常包 ```` ```json ```` 围栏、string 内有裸换行、内容里英文引号未转义。`parseLooseJson` 逐字符修复，别直接 `JSON.parse`。
- **关联表只存真实引用**：`topic_materials` 写的是「这条素材真的被这个选题用了」，标签检索来的补充候选**不回写**——把「检索到过」和「真的用了」混为一谈，这张表就没意义了。（Notion 时代这里还要在 UI 里把 relation 设成 No limit，否则连建多个草稿会互相挤掉；换成关联表之后这个概念不存在了。）
- ⚠️ **模型写进 JSON 的正文要过 `normalizeStoredText`**（`lib/integrity.js`）。模型有时把换行双重转义成 `\\n`，`parseLooseJson` 忠实地解成「反斜杠 + n」两个字符，库里存的就是 `Step 1 …\n Step 2 …`——**四个下游全都不报错**（素材卡片、vault 的 md、成稿提示词、Bot 回执），只是各自显示一串 `\n`。全流程里只有 `tasks/triage.js` 的 `m.note` 是模型生成的素材正文（另外三个写素材的入口存的都是用户自己的文字），所以只在那儿归一化。**加这条之前入库的老数据还带着字面 `\n`，要修得单跑一次 UPDATE。**
- **正文就是一列 TEXT，直接存 Markdown**：`inbox.body` / `materials.content` / `topics.notes` / `drafts.body`。没有块转换、没有分页、没有长度限制——`mdToBlocks`、`getPageMarkdown` 和「正文超过 40 块就拒绝保存」那条限制都是被 Notion 的数据模型逼出来的，一起没了。
- **中文 JSON 别用 curl**：Windows Git Bash 下 `curl -d '{中文}'` 会乱码，用 `python -X utf8` + urllib 发请求。
- ⚠️ **列表排序：判据是 `updated_at`，绝不能是 `id`**（`lib/db.js` 的 `LIST_ORDER` / `cursorClause` / `encodeCursor`，**只有这一份**）。踩过：三处列表查询都写 `ORDER BY id DESC`，理由是「ULID 字典序即时间序」——那句话对**纯 ULID** 成立，但这个库的 id 有两种格式，迁移过来的是小写 UUID（`3b91…`）、新建的是 ULID（`01M0…`），按 ASCII 比 `01M…` 永远小于 `3…`。后果是**所有新建的行被整体压到所有迁移行后面**：8-16 写的稿排在 7-05 那篇后面。**不报错、不白屏，只是顺序不对**，而顺序不对这件事，看的人只会以为「东西没进来」。
  - ⚠️ **为什么是 `updated_at` 不是 `created_at`：卡片上显示的就是它**（`decorate` 给的 `editedAt`；`/wb/*` 压根不回 `createdAt`）。按创建时间排的话，七月建、八月改过的那条会显示着「08-14」却躺在显示「07-08」的那条下面——**屏幕上的日期上下乱跳，看着就是排序坏了**。**要换判据就得同时换卡片显示的字段，两件事一起做**，`test/listing.test.js` 拦着「只改一半」。
  - **次级排序键 `id` 不是装饰。** 时间戳是秒，一轮初筛能在同一秒写进 6–8 张素材卡（线上实测同一秒并列 8 行）。并列时顺序不稳定 → **翻页会漏行也会重复**。
  - **游标是 `updated_at.id` 两段**，和 `LIST_ORDER` 必须同一对列；条件摊开成 `(updated_at < ? OR (updated_at = ? AND id < ?))`，不用行值比较 `(a,b) < (?,?)`——D1 底下的 SQLite 版本不由我们定，而这条错了的表现同样是「翻页少几行」。**认不出的游标退回第一页，不抛错。**
  - **按 `updated_at` 排自带一个代价，别当 bug 修**：翻页期间某一行被改了会跳到第一页，于是这一页少一行。只影响正在翻的那一刻，刷新就对了。根治要换成不会变的列，而那就回到上面那条的取舍了。
  - **现有索引帮不上这个排序**（`idx_*_status` 是 `(status, created_at)`）。几十行的量无所谓，**上千行再考虑加 `(status, updated_at)`**——加索引是 schema 变更，先问机主。
- **D1 的两个坑**：① `UNION ALL` 分支多了会报 `too many terms in compound SELECT`，多表计数用标量子查询而不是 UNION；② **FTS5 的 trigram 分词对少于 3 个字符的查询一律 0 命中**，中文最常用的恰好是两字词（复利、写作），所以全文检索用 LIKE 不用 FTS，理由写在 `schema.sql` 末尾。
- **本机 `wrangler dev`（本地模式）出站 fetch 全挂**：workerd 检测到 HTTPS_PROXY 后声称走代理，但实际所有外呼（Notion/Telegram/LLM）都报 `internal error; reference = …`，连线上正常的旧命令也复现。本地只能验证构建与纯逻辑；端到端验证用 `wrangler dev --remote`（需 `wrangler login`）或直接 `wrangler deploy` 后真机测。
- **X 帖子正文抓取走 FxTwitter**：x.com 有登录墙，Jina/直抓均不可靠。`src/lib/xpost.js` 用 FxEmbed（原 FxTwitter）公开 API `api.fxtwitter.com/2/status/<id>`（免费无鉴权，1000 req/min/IP），失败降级 `api.vxtwitter.com`，全挂则提示用户把帖子文字粘过来。
- **`prompt/platform/x.md` 基于 X 开源算法（xai-org/x-algorithm，Grok 推荐引擎）写成**：中文单语、单推为默认形态、正文不带外链（链接放自评）、结尾引导回复。改这份指南前先看算法有没有大更新（该仓库约每四周同步一次）。

## vault 归档（`lib/vault.js` + `tasks/backfill.js`）

长文和长期资产除了留在 D1，还会写一份 Markdown 进 Obsidian vault
（GitHub 仓库 `<你的 GitHub 用户名>/obsidian-vault`，私有）。分工判据只有一条：

> **机器要频繁读的，必须在 D1；人要读、要搜、要反链的，写一份到 vault。**

反例说明为什么不能反过来：成稿时 `searchSupplementary` 要在全部素材上打分排序——
在 D1 是一条 SQL，在 vault 就是几十次 GitHub API，直接爆掉 subrequest 预算。
**读路径一旦走 GitHub 就完了**，所以 `vault.js` 里只有写、没有读。

- **落点**：稿件 → `99 - 个人工作台/03 - 稿件/`；素材 → `05 - 素材库/<类型目录>/`；
  灵感 → `06 - 灵感/<年-月>/`。文件名一律 `YYYY-MM-DD-标题.md`（稿件多一段平台）。
- **目录名统一两字，和库里的类型值刻意不同名**（映射表是 `MATERIAL_DIRS`）：
  观点/金句/数据/案例/框架/反常/经历/问题/复盘。类型值要喂给 LLM，语义清楚比整齐重要；
  目录名是给人扫一眼的，长短不齐文件树就乱。两者各自服务各自的读者，改一边不用动另一边。
  三类发布复盘产出合并进 `09 - 复盘`。
- **素材是一条一个文件**（atomic note），因为稿件的 frontmatter 要用 `[[素材]]` 精确
  反链到具体某一条。合并成大文件的话反链只能指到文件级别，「这篇稿子用了哪三条素材」
  这个溯源信息就没了。文件多不是问题——`05 - 素材库/_索引.md` 用 Dataview 汇总，
  日常从那一页进，文件树那层折起来不用看。
- **只创建新文件，绝不修改已有文件。这是硬约束。** vault 另一头是本机 Obsidian Git
  插件（每 1 分钟 commit、每 10 分钟 pull、pullBeforePush），只要两边不碰同一个文件，
  Git 自己就能合并干净。实现上**不传 sha**，让 GitHub 在文件已存在时回 422，
  收到就换个文件名重试——服务端的原子拒绝比「先查再写」可靠（后者中间有竞态）。
- **归档失败不让主流程失败**（`tryArchive` 只记日志）。D1 才是运行时真源；成稿跑了
  一两分钟 LLM，不能因为 GitHub 抽风就回滚。失败留 `vault_path` 为空。
- **`vault_path IS NULL` 就是待办清单**。`tasks/backfill.js` 每轮 cron 补 6 条，
  **不区分「历史存量」和「上次写失败」**——它们在库里长得一模一样。补写顺序跟着
  引用方向走：灵感 → 素材 → 稿件，被引用的先落地。
- **反链靠 frontmatter 的 wikilink**：素材 `inbox: "[[灵感]]"`，稿件
  `materials: - "[[素材]]"`，于是「稿件 ← 素材 ← 灵感」在关系图里能走通。
  **只写真实引用**，标签检索来的补充候选不写——和 `topic_materials` 只存真实关系
  同一条原则。**wikilink 在 YAML 里必须带引号**，裸的 `[[x]]` 会被当成嵌套流式序列，
  整份 frontmatter 就废了（`yamlValue` 负责这件事，有测试覆盖）。
- 文件名要去掉 `[ ] # ^ |`：它们是 Obsidian 的 wikilink/标签/块引用语法字符，
  留在文件名里会让反链解析错位。全角冒号保留——中文标题里太常见，且各文件系统都合法。
- `GITHUB_TOKEN` 或 `VAULT_REPO` 缺任一就整个跳过归档，流水线照常跑。

## 备份（`tasks/backup.js` + `scripts/restore-backup.mjs`）

每周日 UTC 20:00（北京周一 04:00）把 D1 整库 dump 成 gzip 的 JSON，写进
`99 - 个人工作台/_备份/d1-YYYY-MM-DD.json.gz`。

**为什么需要它**：D1 自带的只有 Time Travel——30 天、整库、只在 Cloudflare 那一侧。
它挡得住「昨天误删了一批」，挡不住「三个月后才发现某次迁移写坏了」，也挡不住账号出事。
而 `deleteRow` 是真删除，这个库没有废纸篓。落到 vault 是因为那条链路已经在跑、
**终点在你自己的硬盘上**（GitHub → 本机 Obsidian Git 插件），一份数据同时活在
D1 / GitHub / 你的电脑三处。

- ⚠️ **加表必须同时加进 `BACKUP_TABLES`，而且要插到依赖它的那张表前面。**
  那个数组的顺序就是恢复时的插入顺序（父表在前）。往末尾一追了事的后果是恢复时
  报 `FOREIGN KEY constraint failed`——**而那是你最不想遇到报错的时刻**。
  `test/backup.test.js` 拿 schema 的外键关系兜住了这条。
- ⚠️ **恢复的目标必须是刚建好表的空库**，生成的是裸 `INSERT`。不用 `OR REPLACE`
  是因为它在有外键的表上是先删后插，会顺着 `ON DELETE CASCADE` 把子表带走——
  恢复动作反而删数据；不用 `OR IGNORE` 是因为它把冲突安静跳过，你以为恢复完了。
  裸 INSERT 撞上就停，**宁可不动，也不要动一半**。
- **转义那一步在本机脚本里，不在 Worker 里。** 写错的表现是「备份天天在生成，
  需要的那天发现恢复不了」。放本机它是个能跑 `node --test` 的纯函数，而且真出问题
  你看得到报错——Worker 那边只会往 vault 里安静地多写一个坏文件。
  SQLite 只转义单引号（写两个），**反斜杠不是转义字符**，照 MySQL 的习惯加反而写坏。
- **备份失败会主动发飞书消息，这是唯一一件这样的定时任务，别改成静默。**
  别的任务失败下一轮 cron 自己重来、界面上也看得出来；备份失败的样子就是「什么都
  没发生」，你要到真需要恢复那天才知道。成功不发消息——vault 里每周多出来的那个
  文件本身就是证据。
- `_` 开头的目录和洞察的 `_material/` 同一个约定＝机器产物。工作台的全局检索只收
  `.md` 且只扫白名单目录，所以这些文件在界面上完全不存在。
- gzip 不是为了省钱，是两件事：GitHub Contents API 对超 1 MB 的文件不保证；
  这个仓库会同步到你本机 Obsidian，未压缩的全库 dump 一年几百 MB 躺在笔记库里。

```bash
# 手动补跑一次（当场回写进了哪个文件、多少行）
curl "https://pipeline.example.com/run/backup?key=<TELEGRAM_WEBHOOK_SECRET>"

# 恢复：从 vault 拿到那个 .json.gz，先建空库再灌
npx wrangler d1 execute content-pipeline --remote --file=schema.sql
node scripts/restore-backup.mjs <备份文件.json.gz> > tmp/restore.sql
npx wrangler d1 execute content-pipeline --remote --file=tmp/restore.sql
```

## 两个 Bot 入口（Telegram / 飞书）

命令的**唯一实现在 `lib/commands.js`**，两个入口都调它。入口只做三件事：验来源、
取纯文本、确认是机主。**红线和 store.js 那条一样——不要在任何一个入口里另抄一份
命令逻辑**，抄了之后改一处、另一处还按旧规则跑，而且不报错。

- **回执要认渠道**。`/推 /成稿 /整理` 都是秒回受理、丢进 JobWorkflow 跑几分钟，
  跑完时早没有请求上下文了。所以 job 参数里存的是 `{channel, chatId}`（`lib/notify.js`
  的 target）而不是裸 chatId，加渠道只改 notify 一处。
- **飞书事件会重复推送**，官方文档明说「即使成功接收，仍会收到重复消息」，失败还按
  15秒/5分钟/1小时/6小时 重试 4 次。所以 `lark-webhook.js` 进门先用 `event_id`
  走 `claimTask` 认领，认领不到直接退出——**这道闸门在任何副作用之前**，
  否则一条消息存两遍、一个命令跑两次。
- **回调必须 3 秒内响应**（TCP 建连 2 秒 + 整体 3 秒），所以一律先回 200 再
  `ctx.waitUntil`。URL 验证的 challenge 是例外，必须同步返回。
- **飞书的错误不走 HTTP 状态码**：业务失败照样 200，真实结果在 body 的 `code` 里。
  只看 `res.ok` 的话，权限没开、参数写错会被当成成功静默吞掉（`larkFetch` 负责这件事）。
- **凭证 2 小时过期**。`tenant_access_token` 缓存在模块级变量里、提前 5 分钟换新；
  不落库是有意的——那样每次调用多一次读，而 isolate 通常能活到下次刷新。
- **事件可能加密**：配了 Encrypt Key 时 body 是 `{"encrypt":"..."}`，
  AES-256-CBC，key = `sha256(encrypt_key)`，**IV 是密文的前 16 字节**。
  `readEvent` 两种模式都认，因为 Encrypt Key 是选填的。
- **消息内容是字符串套字符串**：`event.message.content` 本身是 JSON 字符串，
  解开才是 `{"text":"..."}`；发消息时 `content` 也要 stringify。群里 @机器人 会在文本里
  留 `@_user_1` 占位符，`messageText` 负责剥掉，否则会被当成命令参数。

### 飞书那边的配置

应用「灵感收件箱」（`cli_xxxxxxxxxxxxxxxx`），事件订阅方式选**将事件发送至开发者服务器**
（Worker 是 serverless，维持不了长连接），回调地址 `https://pipeline.example.com/lark`，
订阅 `im.message.receive_v1`，权限 `im:message` + `im:message:send_as_bot`。
**改了权限或事件必须重新发布版本才生效。**

- **回调地址不能用 `*.workers.dev`**：飞书的事件推送到不了，后台一直报「请求3秒超时」。
  该域名在国内解析被污染，而 Cloudflare 免费版在大陆没有节点。绑自定义域名
  （`pipeline.example.com`）走另一条解析路径才通。
- **`wrangler.jsonc` 里一配 `routes`，`workers.dev` 地址就被默认关掉**，部署时只在警告里
  提一句、不报错。Telegram webhook 和 creator-workbench 用的都是那个地址，所以必须
  显式写 `"workers_dev": true`，否则加个自定义域名会顺手把已有两条链路弄挂。
- 机主锁是 `LARK_OWNER_OPEN_ID`（对应 Telegram 的 `OWNER_CHAT_ID`）。为空时对任何人
  响应命令——首次部署要先发条消息、从 `wrangler tail` 里读出 open_id 才有值可填。
- 用 python 测这些端点时**必须带浏览器 UA**：`Python-urllib` 会被 Cloudflare 直接
  403（`error code: 1010`），而 `Go-http-client` 这类服务端 UA 是放行的。
  排查时别把这个当成自己代码的问题。

## Bot 命令（仅机主可用，两个入口通用）

- **存素材类**（直接写 `素材库`，跳过灵感库与初筛，`src/telegram.js`）：
  - `/金句 <内容> [—— 出处]`→金句/原话、`/概念 <内容>`→核心观点、`/案例 <内容>`→案例/故事、`/数据 <内容> [—— 出处]`→数据/事实、`/框架 <内容>`→框架/模型；`/素材 <随手粘>`由 LLM（`CLASSIFY_PROMPT`）判类型+起标题+打标签。
  - 命令名→`素材类型` 映射见 `STORE_TYPES`；金句/数据为逐字保真类，正文原样存、`——` 后为出处（URL 进「出处」字段，非 URL 并回「内容」）。
  - 追加 `#token`：先按名字匹配选题库，匹配到→挂「关联选题」，没匹配到→当标签（`resolveTokens`）。`#` 仅在行首或空格后才当 token，避免误抓 URL 片段。
  - 标签：手动 `#标签` 优先；没给则秒回入库后异步用 `TAG_PROMPT` 补（`autoTag`，不阻塞、失败静默）。标签统一从 `prompt/tags.md` 词表优先选（`TAG_VOCAB`，也注入 `triage.md` 的 `{{tags}}`），避免碎片化。
- `/推 <X帖链接|文章链接|想法> [角度] [#存]`（英文名 `tweet`）：X 快速出稿轻路径，绕过「选题→撰写中→成稿」全流程。三种输入自动分流——x.com 帖子链接→引用模式（FxTwitter 抓原帖，出引用转发文案+同主题原创推）；其他 URL→文章模式（`fetchArticle` 抓正文，出单推+短 thread+链接自评文案）；纯文字→想法模式（按标签词表捞素材库相关素材垫料，出多角度单推）。默认只回 Telegram 不落库；带 `#存` 才存（来源→素材库、候选合并一行→稿件库·待修改）。提示词在 `prompt/tweet.md`，固定注入 `x.md` 平台指南。
- `/整理`：立即跑任务2整理（与每天 14:00 共用 `runSynthesize`），回执新建选题数。
- `/状态`：回各库待处理数量（待初筛 / 待整理 / 待写 / 撰写中 / 待修改）。
- `/成稿 <选题关键词> <平台列表>`：按关键词匹配选题、对指定平台成稿（走 `runDraftForTopic`，覆盖「适配平台」）。平台列表是最后一段、逗号/顿号分隔，如 `/成稿 写作复利 公众号,X`。
- 命令鉴权用 `OWNER_CHAT_ID`（未配则退回 `ALLOWED_CHAT_ID`）；非命令的采集消息仍用 `ALLOWED_CHAT_ID` 鉴权。

## creator-workbench 端点（`/wb/*`，见 `src/workbench.js`）

同工作区的 `creator-workbench` 项目通过这些端点读写流水线，浏览器不直连、它的本地服务才是调用方。

- 鉴权用**独立的 `WORKBENCH_KEY`**（`npx wrangler secret put WORKBENCH_KEY`），不复用 `TELEGRAM_WEBHOOK_SECRET`：工作台的 key 存在本机 `.env` 里、被更多进程读到，泄露时要能单独轮换。请求带 `X-Workbench-Key` 头（或 `?key=`）。
- `GET /wb/ping` 连通性探针，**不碰数据库**——工作台判断「Worker 通不通」不该顺带查库。
- `GET /wb/status` 各库计数（复用 `lib/status.js` 的 `pipelineCounts`）。
- `GET /wb/list/{inbox|materials|topics|drafts}?state=&cursor=&pageSize=` 分页列表。**一律「最近动过的在最前」**（按 `updated_at`，也就是卡片上显示的那个日期），见下面「列表排序」那条。`cursor` 对调用方是**不透明串**（现在是 `updated_at.id`，别去解析它）。选题那一档除了 `draftIds`（关联草稿）还回 **`inspirationIds`（来源灵感）和 `materialIds`（关联素材）**——工作台的热点转化链（未处理 → 已收藏 → 已形成选题 → 已成稿 → 已发布）靠它反查：拿热点 URL 在灵感/素材里找到那一条，再用它的 id 命中选题。这两条现在从 `topic_inbox` / `topic_materials` 关联表读，`enrich()` 按批查（一页 25 行固定 3 次查询），**不要退回成每行查一次**。
- `GET /wb/projects?stage=&cursor=&pageSize=` 和 `GET /wb/projects/:id` 是内容项目聚合。它们不新建表，以 `topics` 为项目根、`draft:<id>` 表示孤立稿件，并批量带回真实关联的素材、来源、母版、平台版本和发布包。新数据通过 `workflow_status` 证明“待诊断”和“待发布”；历史稿没有该事实时仍不得猜。母版以 `primary_draft_id` 为真源，平台版本必须通过 `parent_draft_id` 指向母版。列表的查询数是固定的，不得改回逐项查询。
- `POST /wb/projects/:id/variants` 从已确认母版幂等创建平台版本；`POST /wb/projects/:id/variants/:draftId/remove` 只能移除未发布的派生版；`POST /wb/projects/:id/releases/:draftId` 保存当前版本的标题、正文和发布包。母版在待发布阶段的标题和正文不可通过发布包接口改写；正文确实改变时才重跑真实性硬闸。
- `GET /wb/page/{id}` 单页正文，**返回 Markdown**（`getPageMarkdown`）。正文本来就是 `mdToBlocks` 从 Markdown 转过去的，读回来就该转回去——老的 `getPageText` 把每个块打平成一行，标题/列表/引用/代码围栏全丢，工作台的阅读区只能显示一大坨段落。`getPageText` 保留给 `triage.js` 用（那边只要纯文本）。**不递归子块**：嵌套列表和 toggle 要多打 N 次 `/blocks/{id}/children`，而单次调用 subrequest ≤50；表格同理（行是子块）暂不还原。
- `POST /wb/delete` `{view, pageId}` **是真删除**。Notion 时代这是 `archived:true`——进废纸篓、30 天可恢复，所以工作台上写的是「移到废纸篓」；D1 没有这一层，**删了就没了，界面文案必须跟着改，别再承诺能恢复**。关联表靠 `ON DELETE CASCADE` 一起清掉。仍要求传 `view`：pageId 是从工作台某个列表点出来的，view 对不上说明前端串台了，这时宁可 400 也不要照着一个来路不明的 id 删东西。
  - ⚠️ **响应必须带 `vaultPath`，而且要在删之前把它读出来。** 这一行删掉的同时 `vault_path` 那一列也没了，可 vault 里那个归档文件还在——不回这个字段，它当场变成孤儿，**连「对应哪条」都反查不回来**（只剩 frontmatter 里的 id 能做差集）。真出过：删了两篇稿，Obsidian 里 6 个文件对着库里 4 行。
  - ⚠️ **Worker 自己不删那个文件，也删不了。** `lib/vault.js` 只有写、没有读也没有删（硬约束），而且它跑在 Cloudflare 上，够不着你本机的 `.trash/`——Obsidian 的废纸篓是本机客户端的概念。**动文件的是工作台那侧**（`workbench/server/routes/pipe.mjs` 的 `/api/pipe/delete`，移进 `.trash/`，可恢复）。这条链上「本机」这一环只有工作台有。
- `GET /wb/drafts-of/{topicId}` 某个选题成稿之后稿子在稿件库的哪几行。按「关联选题」relation 反查，**不要按标题匹配**——草稿标题是 LLM 起的 headline，和选题名不一样。
- `POST /wb/intake` 统一入库 `{target:"material"|"inbox", cmd?, content, source?}`。返回里的 `pageId` 字段名保留了（前端在用），值是 D1 的行 id。
- **id 有两种格式**：从 Notion 迁过来的行是 32–36 位 UUID，新建的行是 26 位 ULID。校验 id 的正则必须两种都认，只认 UUID 的话新建的东西一律「id 不合法」。
- `POST /wb/comment` `{pageId, text, view}`、`GET /wb/comments/{id}?view=` 读写批注，存在自己的 `comments` 表。（原来这是 Notion 页面评论，要在集成里单独开「插入评论」「读取评论」能力，没开就 403——那个依赖没了。）
- `POST /wb/explain` 划词 AI `{mode:"解释"|"展开"|"反驳"|"选题", selection, context?, title?}`，返回纯文本（不是 JSON）。上游仍用 SSE 避免代理超时，但必须在 Worker 内收齐并通过真实性硬闸后再对外返回；不能让未校验的第一人称叙事先流到界面。提示词在 `prompt/explain.md`。
- `POST /wb/draft/material` `{materialIds, draftTitle, platform, viewpoint, audience}` **按素材起稿**（工作台创作弹层的「让 AI 生成初稿」）。提示词在 `prompt/material-draft.md`。
  - **原来这条走工作台本机的 claude CLI，撤了。** 它既不读 vault 也不调 skill——CLI 只是被当成一个要冷启动十几秒的 API 客户端。搬过来拿到：秒级、没装 CLI 也能用、吃得到各环节模型设置。
  - ⚠️ **真正的理由是真实性硬闸在这一侧。** CLI 那条路上「不许编造个人经历」只是提示词里的一句叮嘱；这儿是 `assertGroundedGeneratedText`——**过不了就整篇拒绝**，一个字都不进编辑器。
  - ⚠️ **素材按 id 从库里读，绝不收客户端传来的正文。** 闸门拿「个人经历」类素材当证据，证据要是客户端给的，编一条假的就能把闸门整个绕开——**那道闸就等于没有**。
  - **待核验的金句/数据剔掉**（复用 `isMaterialEligibleForDraft`，和任务3 同一条），但**必须把剔掉的回给前端**（`skipped`）：挑了 5 条只用了 3 条，不说的话用户以为模型漏用了。全都不合格时 422，别硬写一篇没依据的。
  - 响应里还带一份 `citations`（见下面的 `/wb/cite`）：两边文本都在手上，顺手算完，不多花调用。
  - ⚠️ **生成期间每 10 秒发一个换行心跳。** 闸门要求先收齐再放行，这个响应会挂几十秒到两三分钟，一个字节不发的话连接会被 Cloudflare 当成卡死的请求掐掉——现象是「起稿失败」，而模型其实好好写完了。心跳是纯换行，`JSON.parse` 忽略前导空白，调用方照旧当 JSON 读。
- `POST /wb/pick/materials` `{want, viewpoint?, platform?, exclude?}` **按意思挑素材**：工作台创作弹层里关键词搜不到时的第二条路。取整库素材前 300 条（只查 id/类型/标题/正文前 160 字）当候选，一次 `chatJson`，回最多 6 条**扁平素材项 + 一句 `why`**，提示词在 `prompt/pick-materials.md`。
  - **放在这儿而不是工作台那侧**：候选清单是整库素材，库就在这儿，LLM 代理也在这儿——一次调用秒级。工作台那边试过 spawn 本机 CLI，十几秒不说，还等于让它持有「素材怎么挑」这条数据规则。**规则跟着数据走。**
  - ⚠️ **模型给的 id 必须过 `keepRealPicks`**（`lib/creation.js`）。放行一个编造的 id，工作台上就是一张点了打不开的卡——「没找到」是诚实的答案，一张打不开的卡是假的答案。这道闸**界面上完全看不出有没有生效**，所以它放在 lib 里（`workbench.js` import 了 `prompt/*.md`，node 测不了）并有单测。
  - **`exclude` 是关键词已经搜出来的那些 id，在候选阶段就拿掉。** 这一步补的是「关键词搜不到」那个缺口，挑出来的东西用户在上面已经看见了就是纯噪音，而且占掉 6 个名额里的一个。**在候选阶段排除，不是拿回结果再让前端过滤**——过滤只是不显示，排除才能让模型腾出名额去挑别的。`scanned` 回的仍是整库扫描量，不是排除后的数。
  - **一条都没挑出来是正常结果**，回 `ok:true, items:[]`，不是错误。
  - D1 用了 4 条查询（候选 1 + 命中行 1 + enrich 2），离每次调用 50 条上限很远。
- `POST /wb/cite` `{body, materialIds}` **正文里哪一句来自哪条素材**。回
  `citations: [{id, start, end, score, quote, text}]`，`start/end` 是正文里的字符下标。
  纯字符串比对，没有 LLM 调用，一条查询。`/wb/draft/material` 生成完顺手也算一遍
  （两边文本都在手上，白拿），这个端点是给用户**改完正文后重新核对**用的。
  - ⚠️ **对齐算法必须留在这一侧**（`lib/cite.js`），和闸门共用 `integrity.js` 的
    `compactWithMap`/`bigramList`。挪一份到工作台去，两边的归一化迟早会漂，
    而漂了不报错——只是标注开始和闸门说的不是一回事。
  - ⚠️ **只会漏标，不会错标，这是选文本对齐而不是让模型自己标脚注的全部理由。**
    漏标的后果是用户自己去核一遍；错标的后果是用户看到有出处**于是不核了**，
    比没有标注更糟。`MIN_SCORE` 往下调之前先想清楚多标出来的那些谁来保证。
  - **滑窗而不是整条素材算重合**：素材越长二字组覆盖面越大，一条两千字的复盘能让
    任何句子都「有一半的词在里面」——那正是错标的来源。所以比的是素材里和这句话
    最像的那一小段，顺带也就知道该把哪段原话浮给用户看。
  - ⚠️ **素材原文按 id 从库里读，不收客户端传来的正文**，和起稿同一条。这儿虽然不产生
    新内容，但标注是给用户「这句有出处」的信号；证据由客户端给的话，那个信号就能被伪造。
- **不返回数据库原始行**：四张表结构各不相同，交给前端解析等于把「字段名映射」这条规则抄去第二个项目。`workbench.js` 的 `VIEWS` 统一压成扁平字段，改表结构时只改这一处。**换库时对外契约一个字没改**，靠的就是这一层。
- **路由分支里必须写 `return await handler(...)`，不能 `return handler(...)`**：直接 return 一个 Promise 的话，try 块早就走完了，rejection 逃出 catch，变成 Cloudflare 的 **1101 裸异常页**——非 JSON、没有任何报错细节，客户端只看得到「HTTP 500」。踩过一次，现象是所有带 `?state=` 的列表请求都 1101，查了半天才发现真正的 Notion 报错根本没被打出来。
- **错误信息留够 800 字**：SQLite 的 CHECK 约束报错会指明是哪个约束挂了，那是排查「状态值对不上」时唯一有用的信息，截短了等于把答案藏起来。
- **查某张表的合法状态值**：直接看 `schema.sql` 的 CHECK 约束，它就是真源（Notion 时代要靠故意传非法值、从报错里读 `Available options` 才能问出来）。
- 路由必须排在 `index.js` 里那条 `POST` 兜底之前，否则 `POST /wb/intake` 会被当成 Telegram webhook 直接 403。

## 存素材逻辑的单一实现（`src/lib/store.js`）

类型映射、`—— 出处` 拆分、`#token` 消歧、自动补标签这些规则**只在 `lib/store.js` 里有一份**。`telegram.js`（命令回执）和 `workbench.js`（HTTP 入库）都只做输入解析和回执格式，不碰存储规则。

**别在调用方另抄一份**：抄了之后改一处、另一处还在按旧规则写库，而且不报错——数据已经脏了才会发现。同理 `lib/status.js` 是 `/状态` 与 `/wb/status` 的共同实现。

`storeTypedMaterial` 返回 `needsAutoTag` 而不是自己补标签，是为了让调用方决定何时补：Telegram 在回执之后补（保住秒回），工作台用 `ctx.waitUntil` 补（不阻塞 HTTP 响应）。

## LLM 代理这条链路（`LLM_BASE_URL` 背后是什么）

`https://your-llm-proxy.example.com/v1` 不是第三方服务，是自建的：

```
Worker → your-llm-proxy.example.com（Cloudflare 代理）→ Cloudflare Tunnel
       → GCP 实例 codex-cpa (<实例 IP>) → docker: cli-proxy-api → 127.0.0.1:8317
```

- 隧道 ID `<隧道 ID>`，DNS 是一条 CNAME 指向 `<隧道ID>.cfargotunnel.com`（**必须开橙色云代理**，关掉的话 `cfargotunnel.com` 在公网不解析）
- 实例上的 8317 等端口没有对公网开放（GCP 防火墙），唯一入口就是隧道
- 模型名 `claude-opus-4-6-thinking` 由 cli-proxy-api 提供，换模型前先 `GET /v1/models` 看它当前供什么

**这条隧道是「远程托管」的：ingress 配置存在 Cloudflare，不在实例上的 `/etc/cloudflared/config.yml`。**
改域名时改本地文件 + 重启服务**完全不生效**，而且 `cloudflared tunnel ingress rule` 只读本地文件、会回一个「Matched rule #0」的假成功，极具误导性。判断依据是启动日志里的 `Updated to new configuration ... version=N`——出现这行就说明配置来自 Cloudflare。正确改法走 API：

```bash
# 读当前配置（wrangler 的 OAuth token 就够）
GET  https://api.cloudflare.com/client/v4/accounts/<账号ID>/cfd_tunnel/<隧道ID>/configurations
# 整份写回（PUT 会替换整个 config，要先 GET 再改 hostname，别手写）
PUT  .../configurations   body: {"config": {...}}
```

改完 cloudflared 会自动拉取（日志里 version 递增），**不需要重启**。

历史：原域名 `old-proxy.example.com` 是 DigitalPlat 的免费域名，2026-08 被撤销（父域 dpdns.org 正常但没了 NS 委派），导致全线 `LLM 530: error code: 1016`。换域名只需改 Cloudflare 的 DNS + 隧道远程配置 + 本文件的 `LLM_BASE_URL`。

## 运维

- **手动补跑/调试**：`GET /run/{triage|synthesize|draft|backfill|backup}?key=<TELEGRAM_WEBHOOK_SECRET>` 立即跑一次对应任务。前四个是入队 Workflow、回实例 id；**`backup` 是同步跑完、当场回结果**（写进了哪个文件、多少行），因为手动触发备份时你要的就是这个。
- **锁定发信人**：`ALLOWED_CHAT_ID` var 为空时处理任何人的消息；填入自己的 Telegram chat_id 后只处理自己的（发条消息后 `wrangler tail` 里能看到 chat_id）。
- **日志**：`npx wrangler tail` 或 Cloudflare 控制台 Observability。

## 验证

改完必跑：

```bash
node --test test/*.test.js                      # 纯逻辑（真实性校验、任务键）
npx wrangler deploy --dry-run --outdir=tmp/dryrun # 构建
npx wrangler d1 execute content-pipeline --local --command "<SQL>"  # 查本地库
```

线上验证用 `/run/<task>` 端点手动触发，`npx wrangler tail` 看日志，再用
`npx wrangler d1 execute content-pipeline --remote --command "SELECT …"` 确认行和状态。
**查线上库前先想清楚是 `--local` 还是 `--remote`**——两个库都存在且内容不同，看错了会得出完全错误的结论。
