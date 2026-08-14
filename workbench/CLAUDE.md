# creator-workbench

个人创作者工作台：把 content-pipeline（Notion 流水线）、Obsidian 知识库、平台数据聚到一个本地界面里，可读、可批注、可与 AI 交流，所有交互产物落回 Notion 或 vault，工作台自身不存数据。

**三份文档各管一段，改之前先找对地方：**

| 文档 | 管什么 |
| --- | --- |
| 本文件 | **改代码时不看到就会犯错**的约束、命令、红线 |
| [`docs/design.md`](docs/design.md) | 总体架构、存储契约、Worker 端点。**改架构先改它** |
| [`docs/design-system.md`](docs/design-system.md) | 设计理念、视觉语言、交互规则、**否决过的方案**。**改样式和交互先读它** |

另有三份按需读的：[`docs/desktop-app.md`](docs/desktop-app.md)（开始菜单那一套）、[`docs/social-probe.md`](docs/social-probe.md)（中文站内探针）、[`docs/60s-api.md`](docs/60s-api.md)（自建 60s 实例）。

## 目标

- 一个入口看全流水线：灵感库 → 素材库 → 选题库 → 稿件库的状态与内容
- 阅读工作区：书架 / 素材卡 / 报告可读、可批注、可划词问 AI、可与 agent 深聊
- 万物皆可一键入库：热点、书摘、洞察观点、对话结论都能变成素材卡
- 反馈闭环：平台数据（抖音 Excel、手动录入）与已发布内容对照

## 技术栈

- Node.js 20+（本机 22）、Vite 8 + React 19，无 UI 库、无路由库、无服务端框架
- **API 挂在 Vite dev server 的中间件里**（`server/vite-plugin-workbench.mjs`），不另起进程、不配代理。代价是 API 只在 dev 模式存在——这是有意的，工作台永远跑 dev，`npm run build` 只用来验证前端能编译
- 外部依赖：content-pipeline Worker 的 `/wb/*` 端点、Obsidian vault（`.env` 的 `VAULT_ROOT`）
- 服务端解析类依赖：`fflate`（epub 解 zip）、`unpdf`（pdf 抽文字）、`@mozilla/readability` + `linkedom`（网页正文提取）。**都只在服务端跑**，一个都不进前端包

## 启动

```bash
npm install
npm run dev          # http://127.0.0.1:5180，自动开浏览器
npm run app:install  # 装成开始菜单里的应用（一次就够），之后点图标启动
npm run app:stop     # 停掉后台的 dev server
```

## 当桌面应用用（开始菜单 / 任务栏）

`npm run app:install` 在开始菜单放一个「Xenho OS」。链路是 `.lnk → wscript → launch.vbs → powershell -Hidden → launch.ps1`。**改这套之前先读 [`docs/desktop-app.md`](docs/desktop-app.md)**，那里每条都是踩出来的。三条最容易安静弄坏的：

- **`launch.vbs` 必须纯 ASCII，三个 `.ps1` 必须 UTF-8 带 BOM。** 用 Write 工具改完记得转一次编码，否则界面提示全是问号。
- ⚠️ **主流程整个包在 `try` 里，而脚本是隐藏跑的、没有控制台**——任何未捕获异常都纯静默：点了图标什么都不发生，日志里也没有。排查的唯一办法是前台跑一遍 `powershell -File scripts/launch.ps1`。
- **端口从 `vite.config.mjs` 正则读出来**，不在 launcher 里抄第二份——`strictPort` 下抄错就是起不来。

## 验证

```bash
npm run check          # 不开浏览器：vault 路径、越界防护、Worker 连通性
npm test               # 冒烟测试：自己起 Vite + 开浏览器，走完读/批注/AI/热点/数据/对话全流程
node tests/unit.mjs    # 纯函数与文件层：文件名清洗、写盘越界、原子写与快照、导出恢复往返、写请求来源
npm run build          # 只验前端能编译
node tests/shots.mjs   # 截图到 tmp/shot-*.png（末尾加 dark 出暗色版）
```

改完必跑 `npm run check` + `npm test`。**改了样式还要跑 `tests/shots.mjs` 并真的打开图看**——冒烟测试能保证「渲染出来了」，保证不了「好不好看」。品牌名压在标签上、中文标题占满五行、没有目录时空列在正文左边挖出 200px 空洞，这三个测试全绿，看图一眼就知道错了。**冒烟测试里的断言尽量写成「二选一」**（连上就出数据、没连上就出引导），别写死某一种外部状态——写死的话外部一变测试就红，红着的测试等于没有测试。

## 部署

无。本地优先，`vite.config.mjs` 里写死 `host: 127.0.0.1`，**永不部署公网**（.env 里有密钥，前端无鉴权）。

## 目录约定

- `docs/`：见开头那张表
- `src/`：前端（`pages/` 页面、`components/` 组件、`lib/` api 与视图定义）
  - **页面只留组合和状态边界，展示件放 `pages/<页面>/`**（`pages/shelf/`、`pages/studio/`）。跨页面共用的放 `components/`——**页面不许 import 另一个页面**（`Cover` 原来是 `Overview` 从 `Shelf.jsx` 里引的，依赖方向反了：改书架得先想总览会不会跟着坏）。
  - **两个页面都要的「行为」抽成 `lib/use-*.js` 的 hook**，不是各写一份：`use-ai-runs.js`（划词 AI）、`use-doc-chat.js`（agent 对话）、`use-dialog.js`（弹层键盘规矩）。理由见下一条。
  - ⚠️ **这个项目的事故清一色是「同一件事写在两个地方」，没有一条是「文件太长」**（`askPlatformsOn` 漏进解构、`go.open` 两个生产者、`fixEmphasis` 两处、状态字符串两处、`--r-md` 引了没定义的变量）。所以拆分的判据是**去重**，不是行数。
  - **搬代码时注释必须跟着走**：这些文件里的注释大半记的是踩过的坑，丢一条比多两百行贵。
- `server/`：本地服务（`routes/` 路由、`lib/` 工具）
- **`.env` 的变量清单在 `server/lib/settings-schema.mjs`**，不在 `.env.example` 里（那份只给「还没跑起来」的那一刻看）。加一个环境变量改那一处，设置面板和 `/api/config` 会跟着有。见下面「设置面板」一节
- `config/attention.json`：**AI 情报**的关注领域与关键词（不存在时用 `server/lib/attention.mjs` 的默认值）。平台热榜不受它影响。⚠️ **界面上目前改不了**：`attention.mjs` 里有 `saveAttention`，但没有任何 route 暴露它，只能直接编辑文件。设置面板管的是 `.env`（环境配置），这个是**内容配置**，要加入口该加在热点页
- `skills/`：配套 skill（`social-insights` 生成洞察报告、`douyin-data` 取抖音数据），已 junction 到 `C:/Users/Lenovo/.claude/skills/`

## vault 里的目录布局（`server/lib/vault-dirs.mjs`）

工作台读写的那几个目录**整块收在 `99 - 个人工作台/` 底下**，不平铺在 vault 根：

| 目录 | 装什么 |
| --- | --- |
| `01 - 书架` | 一本书一个子目录 |
| `02 - 洞察` | 每周的洞察报告（`_material/` 是原始材料） |
| `03 - 归档` | `发布作品/` 单向导出的成稿 |
| `04 - 网页批注` | 按 host 分的网页批注 |
| `09 - 热点` | 热点快照 json |

- **名字只写在 `vault-dirs.mjs` 一处。** 原来散在六个文件里各写各的，而漏改一处的表现极具误导性：目录不存在时 `listBooks` / `listInsights` 返回 `null`，界面显示的是「还没建，去导一本」的**空态引导**——也就是说，漏掉的那一处看起来像「你还没用过这个功能」，不像出错。
- **序号的分配是有含义的**：01–04 是**你的字**（读的书、写的报告、发出去的稿、随手的批注），09 是**机器抓的数据**（热点快照是 json，不是给人读的）。中间留着空号，以后加一类不用重排已有的。
- **只有顶层这几个目录带序号。** 书架里的 `<书名>/` 不带——`listBooks` 直接拿目录名当书名，编号就等于写进书名里；`归档/发布作品` 是独子，没什么可排的；洞察报告本身是 `2026-W33-…` 打头，已经按周排好了，硬加序号反而**看不出是哪一周**。
- ⚠️ **别按段数切路径。** `书架` 现在是两段（`99 - 个人工作台/01 - 书架`），`split("/")[1]` 那种写法会指到「01 - 书架」上。切书名一律用 `bookOfPath`。踩过一次的地方是 `kindOfDoc`：它切不出书名就返回空串，而空串按「可改」处理——**藏书的只读保护会静默失效**。
- **显示路径要掐掉 `99 - 个人工作台/`**（`ReaderOverlay` 的 `docPath`、检索结果的 `source`）。这一段在每一篇文档上都一模一样，和「信源芯片上不写『已刷新』」是同一条规则：**每个都说的话等于没说**，而它占的是一行里最值钱的开头 8 个字。**只动显示串**——`go.open`、`path` 这些要拿去开文件的必须留完整路径。
- **skill 那边是抄的第二份**（`skills/personal-intelligence-radar/lib/material.mjs` 的 `INSIGHT_DIR`、`scripts/prepare_materials.py` 的同名常量）。skill 独立跑、不 import 工作台的代码，所以**改布局要改三处**。对不上的后果分两种：py 那边是直接报「找不到材料」（好结局），`material.mjs` 那边是**安静地把材料写去旧路径**，而洞察页会显示「还没有洞察报告」。
- **搬家要连 localStorage 一起搬**（`src/lib/migrate.js`）。阅读进度、书签、「最近打开」里存的是**完整 vault 路径**，它们不会跟着目录走。不迁移的表现不是报错，是总览那格「接着读」空掉、书签一个不剩——加起来像「工作台把我读到哪忘了」，而没有任何地方会说出原因。
  - **迁移里的新旧路径写死字面量，故意不引 `vault-dirs` 的常量。** 迁移描述的是「从 A 变成了 B」这一次历史事件；引常量的话，以后布局再动一次，这段代码会跟着变成「从 A 变成 C」，而那时用户的数据早就是 B 了——**它会把对的数据改坏**。以后再搬家就在 `MIGRATIONS` 里**再加一条**，不要改已有的那条。
  - 在 `render` 之前跑：挂载之后再改 localStorage 的话，第一帧读到的是旧数据，屏幕上会先闪一次「还没有阅读记录」。

## 接入工作区里的其他项目

- **wechat-typeset** 由本地服务静态托管在 `/tools/typeset/`（`server/routes/tools.mjs`），并作为侧栏「排版」页 **iframe 嵌进工作台**（`pages/Typeset.jsx`），不用再另开浏览器标签。**typeset 项目本身一行没改**，仍可双击 index.html 独立使用。路径默认找同级目录，可用 `.env` 的 `TYPESET_DIR` 覆盖；它同样过越界防护。
  - 正文靠**剪贴板**过去，不用 postMessage：灌进去更顺手，但那要改 typeset 去监听消息——为省一次 Ctrl+V 在另一个项目里留个耦合点，不划算。**接已有工具的正确姿势是嵌它，不是吞它。**
- **xenho-cover** 不在工作台里重写，而是通过 agent 通道跑那个 skill：阅读区「配封面」按钮把标题+正文+平台喂给 `claude -p`，提示词流式回到右栏。**接已有工具的正确姿势是调用它，不是复制它的逻辑。**
- **MediaCrawler**（同级目录 clone，`.env` 的 `MEDIACRAWLER_DIR` 可覆盖）只做**中文站内探针**，见下节。
- `scripts/`、`tests/`：自检、单测与冒烟测试。`scripts/` 里还有桌面应用那一套（`launch.vbs` / `launch.ps1` / `install-shortcut.ps1` / `stop.ps1` / `make-icon.mjs` + 生成的 `xenho-os.ico`、`xenho-os-64.png`）
- `data/`：平台数据文件（`posts.csv` 内容级、`metrics.csv` 账号级、抖音导出），不进 git
- `tmp/`：临时文件与测试截图，用完即删

## 中文站内探针

`scripts/social-probe.mjs` 把 MediaCrawler 抓下来的 jsonl 转成探针报告，补上洞察报告「小红书/抖音站内」这条腿。**要跑它或改它先读 [`docs/social-probe.md`](docs/social-probe.md)。**

这里只留一条改代码时会踩的：探针输出落 `tmp/insight-work/<week>/web/`，**不落洞察的 `_material/`**——放错地方 skill 会把它当第四份周材料读进去，而它的采样方式（按关键词搜历史热帖）根本不是「本周」。

## 核心红线（改代码前必读）

- **工作台无状态**：批注、笔记、对话记录一律落 vault Markdown 或 Notion，本项目不引入数据库、不用 localStorage 存内容
- **行归 Notion、文归 vault**：结构化流转数据在 Notion（不迁移），亲手写的文字在 Obsidian（不搬家）
- **永不做 Notion ↔ Obsidian 双向同步**：只允许 Notion → vault 单向归档导出
- **vault 路径必须过 `safeJoin`**：直接 `path.join(root, rel)` 开文件等于任意文件读取漏洞，`npm run check` 会验这条
- **密钥只在服务端**：`.env` 的变量经 `loadEnv(mode, cwd, "")` 读进 Vite 插件，绝不进 `define` / `import.meta.env`，前端一律经 `/api/*` 取数
- **不重造 Obsidian**：深度写作、长文编辑不在本工作台做
- 不做：知识星图、wiki 层、多用户、公网部署

## 视觉体系

全部在 `src/styles.css` 一个文件里，没有 CSS 框架、没有 CSS-in-JS。**黑白两色** + 点阵母题 + 等宽做技术标签。

**理念、每条规则的来由、否决过的方案在 [`docs/design-system.md`](docs/design-system.md)——改样式和交互前先读它。** 这里只列改代码时不看到就会犯错的：

- **token 分三层**（原始 → 语义 → 组件），**组件里只准用语义层**；**暗色只改语义层的赋值**，不写第二套组件规则（例外只有 `--on-accent`）。
- **不引入第二个颜色。** 三处有意的例外：标记色、正文暖色强调（`--band` / `--emph` / `--emph-line`）、数据图的平台色。
- **黑块 = 「你在这儿」（位置），标记黄 = 「这个我圈中了」（我做过什么）。** 守不住这条，界面上就分不出「当前」和「已选」。**暖色是给内容的，不是给界面骨架的**（元信息行上过暖色，撤了）。
- ⚠️ **`--font-mono` 的栈里夹了一层 `Noto Sans SC`，别把它删掉。** 等宽包里没有中文字形，套了等宽的中文会掉进系统默认字体——这是「字体看着都不一样」的总根源。但这只是兜底，**内容是中文的地方仍然该用正文字体**（标签、字段名、计数、表头、`.micro`）。冒烟测试断言这个变量里有它。
- ⚠️ **`--emph`（`#de7802`）在白底上只有 3.1:1**，这是**有意选的观感，不是疏忽**——以后觉得长文读着费劲，先动这个值。
- **图标统一从 `src/components/icons.jsx` 出去**（5000+ 图标的 barrel，别处不直接 import），线宽 `stroke={1.7}`。
- **不用原生 `<select>`，用 `ui.jsx` 的 `<Select>`**；它的 `renderIcon` **必传且要逐项不同**，状态图标靠形状区分不靠颜色。
- **共用页头件在 `src/components/ui.jsx`**（`PageHeader` / `SectionHead` / `MetaItem` / `fieldIcon`）——两个调用方，谁也不该 import 另一个页面的私有常量。
- **卡片内部要行行对齐**（标题恒占两行、副标题没内容也渲染、标签 `margin-top: auto`），冒烟测试量三张卡同一行的像素差 ≤1px。**卡片外壳不是按钮**：button 套 button 是非法结构。

## 划词工具条 · 高亮 · 书签 · 翻译

工具条的形态（图标 + 自绘 tooltip、分三组）和取舍见 详见 [`docs/design-system.md`](docs/design-system.md)。这里是落盘规则：

**高亮落 vault，书签存 localStorage。** 高亮是「你对内容说了什么」，是知识，得能在 Obsidian 里搜到；书签只是「等会儿再回这儿」，是导航状态，写进 vault 只会让每次点一下都产生一次文件改动。

- 高亮存成 `<同名>.highlights.md`，一条一行（`- [黄] 原文`）。**锚点是原文文本，不是字符偏移量**——偏移量在书重新导入之后会整体错位，而那句话还在。
- 写入是**整份重写**不是追加：删除必须能落地，而追加式写法删不掉东西。
- 渲染时在**渲染后的 DOM 上走文本节点**包 `<mark>`，不在 HTML 字符串上做替换——一句话在 HTML 里可能被 `<em>`、脚注 `<sup>` 切成好几段。
- **再划同一句就是取消**，不另做一个「删除高亮」的入口。
- ⚠️ **伴生文件不是章节**，判据只写一处（`vault.mjs` 的 `isChapterFile`）。要排掉三类：`book.md`、`notes.md`、`<章名>.highlights.md`。**必须逐个列全**——上一版漏了正牌的 `notes.md`，后果是写下第一条批注之后它被认成「唯一的一章」，**点开书看到的是自己的批注，正文像凭空消失了**。
- **进度只有在它指的那份文件还在这本书里时才作数**——宁可不显示，也不给一个点了打不开的入口。
- **Notion 源没有高亮**（`highlightPath` 返回空）：工具条据此**不画那个按钮**，而不是画一个点了报错的。

**翻译走 DeepL**（`server/routes/translate.mjs`），key 在 `.env` 的 `DEEPL_API_KEY`，前端一行密钥都没有。免费版和 Pro 是两个域名，key 以 `:fx` 结尾的是免费版——拿 Pro 地址打免费 key 会 403 而且报错里看不出原因。没配 key 时**给引导不是报错**。

## 阅读设置

取的每一项都满足一个标准：**调完屏幕上立刻看得出差别**。取哪些、为什么不抄 readest 那一整套、字体两组怎么分，见 详见 [`docs/design-system.md`](docs/design-system.md)。

⚠️ **落地是一组 CSS 变量挂在 `.reader-overlay` 上，不进正文组件的 props**——进了的话改一次字号就重渲染一次正文，选区会被抹掉。

## 「对话」走的是本机 CLI，「理解」走的是 API

这两条链路不一样，**等待文案必须说清楚是哪一条**，否则用户会以为「都是 API 为什么这么慢」：

- **理解**（划词的解释/展开/反驳）→ Worker 的 `/wb/explain` → LLM 代理。秒级，不该显示任何「慢一点正常」。
- **对话** → 本地 spawn headless CLI。**这条才能读你整个 vault**，代价是第一次要把 CLI 拉起来，十几秒是正常的。
- **翻译** → DeepL，走服务端转发。

`Waiting` 的 `slow` 文案和 `slowAt` 秒数都是按调用方传的，不是写死在组件里——写死的话「理解」也会跟着说一句不属于它的话。

### 对话引擎二选一：Claude Code / Codex

引擎表在 `server/routes/agent.mjs` 的 `ENGINES`，前端的选择存在 `src/lib/chat-agent.js`（localStorage）。加第三个引擎只要加一项：`bin` / `args(sessionId)` / `prompt(parts)` / `onEvent(ev, out)`，`out` 把各家的事件流翻译成同一套动作（记会话号 / 吐字 / 记失败）。

- **引擎名从请求体来，但必须过白名单再 spawn。** 认不出就退回 claude，绝不拿用户传的字符串当可执行文件名。
- **Codex 不吐增量。** claude 的 stream-json 有 `content_block_delta`，一个字一个字走；codex 的 `--json` 只在整条消息完成时给一个 `item.completed`。所以 codex 的等待提示要**早点**出（`slowAt: 4`）并且讲清是「先想完再一次性给」，否则空屏十几秒看着就是死了。
- **`codex exec resume` 不认 `--sandbox`**（它只继承 `-c` / `--model` / `--json` 那几个）。两条路各写一套 flag 的话，续聊那一路会直接 `unexpected argument` 起不来——所以只读统一用 `-c sandbox_mode=read-only`。值不加引号是故意的：codex 先按 TOML 解析，解析不了就当原字符串用，正好绕开 `shell: true` 下的引号转义。
- **不给 codex 传 prompt 参数**：它在 stdin 是管道时就从 stdin 读，正好符合「用户输入绝不进 argv」。codex 也没有 `--append-system-prompt`，角色设定只能拼进 stdin 的提示里。
- 只读的落地方式两家不同：claude 靠 `--allowedTools` 白名单，codex 靠沙箱。**结果一样：agent 不能写你的知识库。**
- **换引擎必须清掉 session id**——那是上一家自己的 session 文件，拿去 resume 另一家只会失败。上下文因此断掉，所以在对话里留一条 `msg-sys` 说明，别让人以为它突然失忆了。
- 每条回复记下 `agent` 字段，署名按它显示。换过引擎之后，回头能看出上下两段不是同一个模型答的。

## 编辑器：所见即源码，但源码长得像文档

`components/MarkdownEditor.jsx`，CodeMirror 6（只装用到的六个包）。

**为什么不做真 WYSIWYG**：它每次保存都要把整份文档按自己的方言重写一遍，而**真正会坏的是 `[[双链]]`、脚注、`> [!note]` 这类 Obsidian 专有语法**——vault 里现在有 40 个文件在用双链。所以编辑器的值**永远是那串 Markdown 本身**，存回去的就是你看到的字节。着色和工具栏的取舍见 详见 [`docs/design-system.md`](docs/design-system.md)。

- ⚠️ **`value` 不进建编辑器那个 effect 的依赖**：进了的话每敲一个字就重建一次编辑器，光标、撤销历史、滚动位置全丢。外部换值走另一个 effect，**先比一次再 dispatch**。
- ⚠️ **`.md-editor__body[hidden]` 这条 CSS 不能省。** `hidden` 靠的是浏览器默认样式表，而 `.md-editor__body` 上的 `display:flex` 是作者样式，一定压过它——现象是点「预览」之后编辑器**没有消失**，同一份内容一屏出现两遍。冒烟测试钉住了。
- **预览复用 `renderMarkdown` + `.prose`**，所以「预览」和真的读起来必然一致。
- ⚠️ **测试里读写编辑器不能用 `inputValue` / `fill`**。读用 `.cm-content` 的 `innerText`，写用 `click` + `Control+End` + `keyboard.type`。`innerText` 只拿得到**渲染出来的行**（虚拟滚动），长文要校验内容得去读落盘的文件。

## 内嵌工具（排版）

排版工具静态托管在 `/tools/typeset/`，作为 iframe 嵌进「排版」页。**typeset 项目一行不改是这个接法的前提**（改了它就不再能双击 index.html 独立使用），所以下面两条的修法都只能在工作台这边。为什么不套容器见 详见 [`docs/design-system.md`](docs/design-system.md)。

- **iframe 要等 `load` 再淡入。** 它把编辑器静态写在 HTML 里、起始页默认 `hidden`，浏览器会先画一帧编辑器再被换掉——那是 **iframe 里的 FOUC**，不是工作台的布局问题。兜一个 1.2 秒超时：`load` 万一不来也不能把界面一直藏着。
- ⚠️ **它的草稿和工作台共用同一份 localStorage**（同源，键是 `wechat-typeset`）。两个后果：「重置」不能只是重挂 iframe（重挂之后它照样把草稿读回来，现象是「点了没反应」），要真清空得删这个键；而**绝不能 `localStorage.clear()`**——那会把阅读进度、阅读设置、书签一起抹掉。删草稿不可逆，所以要点两下。

## 中文的强调标记（`**` 会原样露出来）

CommonMark 的 flanking rules 和中文标点天生打架：闭合的 `**` 不允许「前面是标点、后面是字母」，而中文稿里到处是 `**第一种是劳动力杠杆，**也就是…` 这种——于是**整段不加粗，两个星号原样显示在正文里**。解法是把标点从强调**里面**挪到外面（`**杠杆**，也就是`），排版上本来也更对。

- **两处都要做，别只做一处**：`server/lib/books.mjs` 的 `fixEmphasis`（让落进 vault 的文件本身就正确，Obsidian 也要读它）和 `src/components/Reader.jsx` 的 `fixEmphasis`（兜住所有源，Notion 里 LLM 写的中文稿同样会踩，那些内容不归导入器管）。
- ⚠️ **尾部标点要在「去掉头之后的那截」里找。** 头尾各在整段上匹配一次的话，`**——**` 这种全是标点的会让两次匹配抓到同一段字符，拼回去凭空多一份变成 `————`。
- 这个 bug **不报错、测试也不红，只有肉眼看得见**——所以 `tests/unit.mjs` 里钉了六条断言。

## 批注能改、能删（`server/lib/notes.mjs`）

写错一个字就只能去 Obsidian 翻文件改，这在自己的工作台里说不过去——「读 → 批注 → 摘素材」这条链里，批注曾经是唯一一个只能追加不能回头的环节。三条硬约束：

- **改写只动那一段**：记下每条在原文里的起止位置，只 splice 那一截。你在 Obsidian 里往同一个文件加的别的东西原样留着。
- **认不出格式就整份只读**：切不出 `## ` 块（用户自己重排过）时，界面照实说「这份 notes.md 不是工作台写的格式」，而不是自作主张重排一遍别人的文件。
- **改之前先对时间戳**（`expect`）：对不上就 409 让人刷新。宁可多点一下，也不能拿旧的下标去删掉别的段落。
- Notion 源**不给这两个口子**（Notion API 本身不支持改评论），所以 `onEditNote` 是可选 prop，只有 vault 源传。

`annotateLabel` 必须**如实说明批注写去哪了**（「追加到 notes.md」/「写成 Notion 评论」）。用户点保存前就该知道东西落在哪，这是这个项目「不让用户猜」的底线。

## 滚动条

阅读区天生三个滚动区（左栏 / 正文 / 右栏），去不掉；要消灭的是**滚了也没反应**的那条。做法见 详见 [`docs/design-system.md`](docs/design-system.md)。

- **覆盖层开着时锁住 body 滚动**，恢复时写回原来的 `overflow` 而不是清空（别的地方也可能锁过）。
- ⚠️ **不要为了少一条滚动条去套 `max-height`**：那只会把一栏切成两半，鼠标在哪滚的是哪。引用块展开、看板列、左栏目录都踩过。**列不自己滚**，跟着内容长。

## 书架是三层，不是两层

**书架不走 `Studio.jsx`，它有自己的 `pages/Shelf.jsx`**（展示件在 `pages/shelf/`：`ContinueCard` / `BookCard` / `BookDetail` / `ShelfActions`）**。** 一条素材就是一份文档，而一本书是几十份文档，中间必须有个地方让你挑章节。动线：**书架封面墙 → 书详情 → 阅读区**（单篇书跳过中间那层）。版面取舍见 详见 [`docs/design-system.md`](docs/design-system.md)。

- **一本书 = `<书架>/<书名>/` 一个目录**：`book.md` 是入口，同目录其余 `.md` 是章节（按文件名 `numeric` 排序），`cover.*` 是封面，`images/` 是插图，`notes.md` 是批注。**章节是平铺的独立文件**——这套东西的另一个读者是 Obsidian，一章一个文件在那边才是能双链、能搜的粒度。
- **批注始终写整本书的 `notes.md`，不按章分文件**：读一本书时的想法常常是跨章的。

**「资料」还是「藏书」决定正文能不能改**（`bookKind`，写在 `book.md` 的 `类型` 字段）

- **分界不是文件格式，是「这是谁写的字」**：`资料` 是自己攒的（能改），`藏书` 是别人写的（只读，否则从书里摘的每一句引用都不再可信）。按格式判定会两头出错。
- **但格式是个好默认值**：没写 `类型` 时按 `来源` 的后缀推断（epub/pdf → 藏书，其余 → 资料）。所有已有的书都能直接推断，不用迁移也不用挨个问。
- **值落在 vault 的 frontmatter，不在 localStorage**，写的时候**只动那一行**（`setFrontmatterField`）。
- ⚠️ **藏书只读的规则要落在服务端**（`POST /api/vault/doc` 开头的 `kindOfDoc`），前端不画按钮只是给人看的那一层。403 的 hint 要给下一步。

**资料的正文能就地改**（`POST /api/vault/doc`）。四条硬约束，每条对应一个不报错、只会安静出错的地方：

- 编辑器上的字**全由源来说**（`source.edit` 的 `target`/`save`/`hint`），开关是 `doc.editable`。
- **编辑器带出的是原文，不是 `content`**（后者被 `stripLeadingTitle` 掐掉了标题行，拿它存回去文件里的 `# 章名` 就没了）。所以 `SHELF.load` 另给一份 `markdown`。
- **frontmatter 原样接回去**（`writeDocBody`），**不能拿 `parseFrontmatter` 的 `meta` 重新序列化**——那份是简化过的，写回去等于把用户手写的元信息按我们的口味重排一遍。
- **带 `stamp` 做乐观锁**（文件 mtime）。这些 md 的主编辑器其实是 Obsidian，对不上就 409 + 给下一步，不硬覆盖。
- **不给改标题**（`editTitle: false`）：文件名同时是阅读进度、高亮伴生文件和 Obsidian 双链的锚点。
- 存完**重新 `load` 一遍**，不在前端拼一份「应该长这样」的 doc。

**其余**

- **书的 frontmatter（作者/状态/标签）工作台不给改，也没有写入端点**——那些字段在 Obsidian 里直接就能编辑，而工作台这边的入口挨着「打开这本书」，一次误触改的是 vault 里的文件。**同一件事有两个入口时，留那个不会误触的。**（撤掉过一版卡片上的就地改作者：`BookAuthor` + `POST /api/vault/books/meta`。冒烟测试断言那一格的 tagName 是 `SPAN`，钉住别顺手加回来。）唯一的例外是**类型**（`books/kind`）：它决定正文能不能改，是工作台自己的开关，Obsidian 那边没有对应概念。
- **下架一本书 = 整个目录移进 vault 的 `.trash/`**，不是删掉（里面有你自己写的批注；Obsidian 自己的删除也是移进这儿）。带时间戳防同名撞车。
- **正文里的图片存相对路径**（`![](images/00001.jpeg)`），由 `Reader` 的 `baseDir` 在渲染时改写成 `/api/vault/image?path=…`。写死 API 地址的话 Obsidian 里就是一堆坏图。
  - ⚠️ **`SAFE_URI` 必须放行裸相对路径**（末尾那个零宽负向前瞻）。epub 正文里的图就是写成 `images/x.jpg` 的，而 DOMPurify 会把不在白名单里的 `src` **整个删掉**——页面上留下一个只有 alt 的破图框，看着像图丢了。踩过一次，6 本书 213 处引用全废。
  - **和文字混排的图按行高显示**（`markGlyphImages` + `.prose img.glyph`）：epub 里生僻字常被切成小图嵌进句子，按原尺寸铺出来会**把句子劈成上下两半**。
- **进度存 localStorage，不进 vault**：进度是这台机器这个浏览器的状态，不是知识。这不违反「工作台无状态」——那条红线管的是**内容**。
- **正文开头和标题重复的那一两行要去掉**（`stripLeadingTitle`）：同一句话会连着出现三次。比较时把空白全抹掉再比。

## 从 readest 吸收了什么、没吸收什么

**不采用它的阅读引擎**（foliate-js）：这里的书**先转成 Markdown 落进 vault**，才能被 Obsidian 双链、被全文搜、被划词摘成素材卡。上了 foliate 就等于正文不再是 vault 里的文件，「读 → 批注 → 摘素材」这条链断在第一环。吸收了阅读设置、书内全文搜、整本进度三条。完整论证、明确不做的清单、以及「要两头都要该怎么办」见 详见 [`docs/design-system.md`](docs/design-system.md)。

## 导入电子书

`server/lib/books.mjs`，**解析全在服务端**（epub 是 zip、pdf 要跑 pdfjs，放前端等于把两个解析器打进包里）。请求体是**原始字节**，不走 multipart——只有一个文件。

**结构还原是「读起来抓不抓得住重点」的关键**，两条：

- **`xhtmlToMd` 逐块走一遍，不是一串正则接力。** 上一版 `.replace()` 链顺序错了（`</h1>` 先被换成段落分隔，heading 规则就永远匹配不到），全书 61 个真标题悄悄退化成普通段落——**测试全绿、也不报错**。正则接力处理嵌套结构本来就靠不住。
- **排版语义写在 class 里，不在标签上。** 出版社的 epub 大量用 `<p class="subhead">`、`<span class="quotation-s2">`，只认标签就只能看到一片 `<p>`。所以块的语义 = 标签 + 自己的 class + 内部 span 的 class 一起判。**映射表是数一遍真实用法定出来的**——`titlequot` 实测是小标题不是引用，所以判 title 必须排在判 quot 前面。

| 原书 | → | Markdown |
| --- | --- | --- |
| `h1/h2/h3` | | `#` / `##` / `###` |
| class 带 `head`/`title`/`chapter` | | `####` |
| `span.quotation-*` | | `>` 引用 |
| `span.bold`、`b`、`strong` | | `**强调**` |
| class 带 `author`/`byline` | | `*署名*` |
| 居中的 `∨`（装饰符） | | `---`，再由 `tidy()` 判断留不留 |

⚠️ **`<!DOCTYPE …>` 和注释必须在走块之前就拆掉**（`xhtmlToMd` 开头那两条 replace）。分词正则只认 `<字母…>`，`<!DOCTYPE` 的 `!` 不是字母、`[^<]+` 分支在 `<` 处也匹配不上，于是**正则引擎往前跳一个字符**，从 `!` 开始把剩下的当正文收走——每章开头多出一行 `!DOCTYPE html PUBLIC …>`。《平凡的世界》169 章全中，不报错、只有肉眼看得见。注释要**单独**拆（它里面可以有 `>`）。兜底分支 `<[^>]*>` 命中时三个捕获组都是 `undefined`，**必须 `continue`**，否则 `rawTag.toLowerCase()` 直接抛。

`tidy()` 收尾解决「原书一种手段、Markdown 另一种手段」时留哪个：两段引用之间的分隔线删掉、连着的引用并成一块、**但隔过装饰符的两条要留着分开**（那是原书在说「这是两条独立的金句」）。

- **pdf 只能从形状认标题，判据要严**（`markHeadings`）：误判一句短句成标题，读者会以为那里开了新一节，**比没有标题更坏**。只认显式章节标记和「短 + 不以标点收尾 + 不以数字开头」；`1. xxx` **不算**（它本来就是合法的有序列表语法）。
- **epub 的章节顺序只信 spine**，不信文件名排序。章名优先取 `toc.ncx` 的 navMap——xhtml 的 `<title>` 常常就是「未知」。**只有目录里真登记过的才算「有名字」**（`titled`），否则那些只有一行献词的碎片会躲过合并，书架上出现三十个一行字的「章节」。
- **pdf 要把被切断的行拼回段落**（`joinLines`），判据是**上一行末尾**有没有句号问号引号——用「下一行是否缩进」在中文 pdf 里几乎不可用。**拼完必须用空行连接**：工作台开了 `marked` 的 `breaks: true`，单换行会渲染成 `<br>`，几百行挤成一堵没有段距的墙。
- pdf 找不到标题时按长度兜底（超过 6 万字才硬拆）；扫描件**明确报错**，不写一本空书上架。
- **书名去掉归档用的日期后缀**（`-20260811`）。**正文第一行已经是同名标题时别再写一遍 `# 章名`**（`sameAsTitle`）。
- **纯装饰的行翻译成分隔线**（`decorativeToRule`），不是删掉——它携带「这里换口气」的信息，`tidy()` 还要靠它判断两条引用要不要分开。
- 格式白名单在两处：`books.mjs` 的 `SUPPORTED` 和 `sources.js` 的 `SUPPORTED_BOOKS`，**必须一致**（前端放宽了服务端会拒，收窄了用户压根选不到那个文件）。

## 侧栏

品牌名是 **Xenho OS**（副标 `CREATOR WORKBENCH`）。形态取舍见 详见 [`docs/design-system.md`](docs/design-system.md)。

- **导航标签一律两个字**（`NAV_LABELS`），冒烟测试钉了 `n.length === 2`。**收起态只改变量和「藏什么」，不写第二套侧栏**（`.app[data-rail="collapsed"]`）——两种形态是同一批 DOM，写两套的话加一个导航项要改两处。
- ⚠️ **`BrandMark` 的两条 path 和 `index.html` 的 favicon 是同一份，改一处必须改两处**（favicon 那边写死黑底白字，浏览器标签页没有主题 token）。
- ⚠️ **改动侧栏后留意按文字点的测试选择器**：`.nav-item:has-text("创作")` 在收起态下点不中（文字 `display:none`）。冒烟测试里那段收起验证**必须在末尾展开回去**，否则后面几段全超时。
- **设置入口（`.conn__gear`）和连接状态住在同一行**：那一行报的就是「Worker 配没配、通不通」，齿轮是去改它的地方。**`.conn` 本身不做成按钮**——收起态下它只剩一颗 7px 的点，一个点看不出可点。收起态**状态点绝对定位到齿轮右上角当角标**（和 `.nav-item__dot` 同一条规则），仍然是同一批 DOM。**收起态下齿轮不能藏**：工作台没配好时它是唯一那条能走的路，而收起是个会一直保持的状态。

## 总览

**计数分两组，因为 0 的含义正好相反**（`views.js` 的 `TODO_CARDS` / `AUTO_CARDS`）：Worker 自己会消化的队列（0 是正常态）和等你动手的（不点它永远不会动）。右上角「N 件事等你」**只数 `TODO_CARDS`**。版面取舍见 详见 [`docs/design-system.md`](docs/design-system.md)。

- 标题**两个类名共用一组样式**（`.todo-card__label` / `.auto-card__label`）让三张卡第一行落在同一条线上，但**不复用同一个类名**——混用会让「数一下有几张待办卡」这种断言悄悄多数出一张，冒烟测试真红过一次。
- **点一条稿子跳的是「它那一档过滤好的列表」，不是直接开正文**：hash 只有「库 + 状态」两段，而状态值本身带斜杠。**「最近改过的」要按标题合并**（一个选题会成好几篇稿）。
- **书能带落点进书架**：`#/shelf/resume` 是最近那本，`#/shelf/<dir>` 是指定的某一本。**只认一次**（`resumedRef`）——书列表会因为回写进度重新加载，每次都重开阅读区的话，关掉它会立刻又被弹回来。开完用 `replaceState` 把地址换回 `#/shelf`。

## 浏览层与精读层是两件事

五个可读源（灵感库/素材库/选题库/稿件库/洞察）走 `pages/Studio.jsx`（展示件在 `pages/studio/`：`ListHead` / `FilterBar` / `DocList` / `DocCard` / `SourceSetup`），它有**两层**：**卡片墙 / 看板**（浏览，回答「有什么」「卡在哪一步」）和**阅读覆盖层**（精读，整屏：正文 + 批注台 + 动作）。为什么不是常驻三栏、左右两栏各放什么，详见 [`docs/design-system.md`](docs/design-system.md)。

流水线四段是**页内 tab**，不占四个侧栏项：它们是一条链的四段，摊成 tab 才看得出东西是从左往右走的。

**加新的可读源只写 `sources.js` 里的适配器，不要动 `Studio.jsx`。** 适配器要实现 `list / load / annotate / annotateLabel / sourceOf`，卡片墙还要 `preview` 和（流水线库的）`pendingKey`。

- 浏览这一侧**四件事缺一不可**：搜索（`/` 聚焦）、状态筛选（适配器的 `states`）、加载更多（接 Worker 的游标）、**卡片摘要**（没有摘要的卡片和一行标题的列表没区别）。
- 空态引导要**各说各的话**（踩过一次：洞察页显示着书架的「一本书一个子目录」）。
- ⚠️ **适配器不能只列文件名。** 洞察源最初套通用的 `vaultTree`，卡上除了标题什么都没有。摘要、覆盖周期、字数只有读文件才有，所以另开了 `GET /api/vault/insights` 在服务端读。
- ⚠️ **列目录时必须排掉伴生文件**，判据复用 `isChapterFile`。不排的话写下第一条批注之后洞察页会**凭空多出一张卡**，点开是自己的批注。
- **字数口径只写一处**（`lib/reading.js` 的 `readStats`）。它放 `lib/` 不放 `ui.jsx`，因为 `sources.js` 要用——lib 引 components 是把层反过来了。

**状态与筛选**

- **状态取值的单一真源是 `sources.js` 里适配器的 `states`**，`views.js` 只留导航标签。抄两份的话，改了 Notion 的状态选项只更新一处，另一处点了就 400。
- **状态筛选走服务端，分面筛选走客户端**：素材库在 Notion 侧根本没有状态字段（Worker 的 `statusProp` 是 `null`），只能在已加载的条目里筛。分面选项从真实数据里现算（`facetOptions` / `facetPick`），不写死一张表。
- **有权威名单的分面要列全（`facet.all`），没有的才从数据现算。** 名单之外真实出现过的值也要带上。
- **`renderIcon` 必传，而且要逐项不同**（`ui.jsx` 的 `valueIcon`）。冒烟测试量的是 svg 里 `path` 的 `d` 有几种。
- **进一个库时的默认状态写在适配器的 `defaultState` 里**，而且**要写进 URL**（`#/topics/待写`）——偷偷过滤的话筛选条上没有任何一项是选中的，用户看不出自己正被过滤。
- ⚠️ **`PLATFORMS` 的声明必须排在 `DRAFTS` 前面**：DRAFTS 的 facet 在模块加载时就读它，而 `const` 不提升。放文件末尾是 `Cannot access 'PLATFORMS' before initialization`——**整个模块加载失败、界面全白，而 `npm run build` 照样过**（打包器只看语法，不跑代码）。
- **素材的证据状态不能靠猜**：Worker 把 Notion 的「核验状态 / 核验说明 / 来源灵感 / 关联选题」映射为 `verificationStatus / verificationNote / inspirationIds / topicIds`。金句和数据缺字段时按「待核验」处理。

**阅读覆盖层**

- **划词 AI 那一套走 `lib/use-ai-runs.js` 这一个 hook**（书架 / 内容工作台 / 热点原文三处共用），状态迁移规则在 `ai-runs.js`（纯函数）。**别再各写一份**：里面有两个抄错了不会报错、只会安静少个行为的点——攒结果不覆盖、中止不当失败报。
- **agent 对话同理，走 `lib/use-doc-chat.js`**（书架 / 内容工作台两处共用）。合并之前两边各一份 66 行、逐行只差两行（文档标题和路径从哪儿取）。`useDocChat({ docTitle, docPath })` 回 `{ chat, chatAgent, sendChat, switchAgent, newChat, stopChat }`。
  - **换文档调的就是 `newChat()`**，不另起一个 `resetChat`——「掐掉在跑的 + 清会话号 + 清消息」是一件事，各写一份就是刚合掉的那种重复又长回来。
  - **收值不收取值函数**：调用方十有八九写内联箭头，那样每次渲染 `sendChat` 都换身份，比不合并还糟。
- ⚠️ **正文块必须是 `memo` 的，html 必须 `useMemo`；右栏的 Markdown 同样要走 memo 的 `<Md>`。** `dangerouslySetInnerHTML` 一重跑，DOM 节点全换新的、**浏览器选区当场消失**——现象是「弹出菜单了，但不知道选中了哪几句」。冒烟测试断言的是**选区还在不在**，不是颜色。
- ⚠️ **划词工具条在 `.reader` 内部，`handleMouseUp` 必须挡掉来自工具条自己的 mouseup**，判断要认 `.sel-bar`（右栏那条改成复用 `.sel-bar` 之后，判断里还留着旧类名，于是每次点按钮都先被当成「点在别处」）。**「点了没反应」几乎总是这个原因。**
- **外链一律新窗口打开**（`App.jsx` 里那个委托 click 监听）。做成委托而不是给 marked 配 renderer：正文、右栏 AI 输出、热点原文各有各的渲染路径，**判据只写一处**。做法是点击时把 `target`/`rel` 补上再放行，**不是 `preventDefault` + `window.open`**——已经有一条走通的路时不要再修第二条。三种不能碰：`#` 开头的（hash 路由）、同源的、非 http(s) 的；带修饰键和中键的点击也放过。
- **批注的 Markdown 块之间必须空行**：`> 引用` 后面紧跟正文会被 lazy continuation 吸进引用块，Obsidian 里同样错。
- 划词 AI **默认不落盘**，点「存为笔记」才写进 vault。
- **左栏不要铺 `item.key`**：Notion 条目的 key 是个 UUID。`docPath()` 只显示对人有意义的来路。
- ⚠️ **等的是内容，不是容器**：`waitForSelector(".reader-overlay")` 会在正文还在取的时候就返回，要等 `.reader-overlay .rail-tabs` 这种「真的有东西了」的选择器。
- AI 链路全程流式，中间任何一环用 `res.json()` 攒完再发就白做了（`server/routes/ai.mjs` 用 `Readable.fromWeb` 逐块 pipe）。

## 看板与「撰写中」这道闸门

- ⚠️ **看板类名是 `kanban-*` 不是 `board-*`**——`.board` 已经被热点页的榜单占了。撞名的话热点页会莫名其妙跟着变。
- **默认一律卡片墙，看板是个开关。** 列宽、渐隐、为什么列不自己滚见 详见 [`docs/design-system.md`](docs/design-system.md)。
- **看板要吃满屏**：`.main:has(.kanban)` 解掉正文栏的 1320 上限。用 `:has()` 而不是给 App 加状态——**宽度是内容决定的，不是路由决定的**。
- **异常落点空着就藏起来**（适配器的 `quietStates`），但**不能从 `states` 里删掉**——删了的话成稿失败的选题会从看板和筛选条上一起消失。
- **拖进「撰写中」不直接写，先弹平台选择**（`components/PlatformGate.jsx`）。选题一进「撰写中」，Worker 五分钟内就会领走，**按勾了的每个平台各跑一遍 LLM**——勾五个就是五篇稿、五份 token。闸门里**先写平台、再改状态**（反过来的话 Worker 可能在平台还没写进去时就领走了）。
- 其余状态改完给一条带**撤销**的 toast。

### ⚠️ 适配器新增配置项必须同时加进 `notionSource()` 的参数解构

踩过一次，代价是真金白银：`askPlatformsOn` 只写进了 `TOPICS` 的配置、漏了工厂函数的解构，于是 `source.askPlatformsOn` 恒为 `undefined`，**闸门整个失效**——Worker 五分钟内领走选题、按三个平台各跑了一遍 LLM。**这类漏字段不会报错，只会安静地少一个功能。**

所以断言必须钉在两个地方：`tests/unit.mjs` 直接断言 `TOPICS.askPlatformsOn === "撰写中"`；`tests/smoke.mjs` 在弹窗期间**数写请求的次数**，`writes === 0` 才算过。只断言「弹窗出来了」是抓不住的——弹窗和写入可以同时发生。

## 删除

**删除 = 归档进 Notion 废纸篓**（`archived: true`），30 天内能捞回来——Notion 的 API 根本没有硬删除，而这恰好是我们想要的。界面上照实说「移到 Notion 废纸篓」，**不要写「永久删除」**。两个入口都要点两下，交互细节见 详见 [`docs/design-system.md`](docs/design-system.md)。

- 删完就地把那张卡从列表里去掉，不整页重载（重载会丢滚动位置）。
- ⚠️ **删稿件必须连父选题一起校正**：Worker 的删除响应返回 `affectedTopicIds + reconciled`，或 `reconcileTopics`。旧 Worker 没返回契约时要明确提示「父选题尚未校正」，不能留下一个看起来成功的幽灵关系。

## 成稿去哪了

**稿子的唯一存放处是稿件库**，选题那边只留一个指路牌（`DraftLinks`，走 `GET /wb/drafts-of/{topicId}` 按「关联选题」反查）。同一份内容存两处，迟早会出现「选题里的版本和稿件库的不一样」这种没人说得清的状态。

反查用 relation，**不要按标题匹配**——草稿标题是 LLM 起的 headline，和选题名不一样。

稿件库按 `平台` 分面：一个选题会成好几篇稿，混在一起看不出「公众号那篇改完没有」。

## 编辑 Notion 内容

- Worker 侧 `POST /wb/update`（改属性）用**白名单**，不是黑名单——放开任意字段意味着一个笔误就能把关联关系写成非法值，而 Notion 只会静默存下去。加可编辑字段要改 `workbench.js` 的 `EDITABLE`。
- **`GET /wb/page/{id}` 回的是 Markdown，不是打平的纯文本**（`getPageMarkdown`）。正文本来就是 `mdToBlocks` 从 Markdown 转过去的，读回来当然要转回 Markdown——一来一回是对称的。老的 `getPageText` 把每个块都打平成一行，标题、列表、引用、代码围栏全没了，阅读区只能显示一大坨段落。（`getPageText` 保留给初筛用，那边只要纯文本。）不递归子块：嵌套列表和 toggle 要多打 N 次 `/blocks/{id}/children`，而单次调用 subrequest ≤50。
- `POST /wb/content` 是**整篇替换**：先删光块再按 Markdown 追加。块级编辑要维护块 id 映射和并发，复杂度高一个量级，而这里的场景就是「把稿子当一份 Markdown 改一遍」。代价是同时在 Notion 里改同一页会被覆盖——单人用，接受。
- 正文块数卡在 40：免费版单次调用 subrequest ≤50，删 N 块 + 追加会超。宁可报错也不能删一半。
- **测试里不写 Notion**：改选题状态会触发流水线自动成稿。UI 测只验「编辑器带出正文 → 取消」，写入路径在服务端单独验。

## 已知的数据脏点

Notion 有些字段里存的是**字面的 `\n` 两个字符**而不是真换行（LLM 生成 JSON 时转义了两遍）。`sources.js` 的 `unescapeNewlines` 在渲染前逐行还原，**代码围栏内不动**。

注意它必须**逐行**处理：页面正文是多个块用真换行拼起来的，整段判断「有真换行就跳过」的话修复永远不生效（第一版就是这么写错的）。

## 输入层与反馈层

**近期热点是三个视角，各刷各的**：平台热榜（`/api/hot/boards`，自建 60s 的六个大众榜，**故意不过滤**——拿关注词筛它等于把它筛没了，实测 50 条剩不到 1 条）、AI 情报（`/api/hot/ai`，**只有这一侧过滤**，界面上一键可看全部）、模型榜（`/api/hot/models`）。分成三个端点而不是一个大对象：刷新节奏差一个数量级。版面取舍见 详见 [`docs/design-system.md`](docs/design-system.md)。

- **模型榜是有意的例外：它不是公开 API，是解析 AI HOT 自己那个页面。** 代价写清楚：**它会随对方改版失效**。所以三条：解析不出来就整块不显示、版面上如实标注来源和失效风险、永远留一个「去官网看」的出口。TTL 6 小时。
- 抓取实现：`server/lib/sixty.mjs`（平台热榜）、`server/lib/aihot.mjs`（AI 情报与模型榜）。
- **60s API 相关的改动，先读 `docs/60s-api.md`。** 三条硬要求：Base URL 走 `SIXTY_SECONDS_API_BASE_URL`、**不能只看 HTTP 200**（业务失败写在 body 的 `code` 里）、不猜路由名和字段名。
- 关注配置在 `config/attention.json`（界面上没有编辑入口）。语法来自 TrendRadar：`词` / `+词` / `!词` / `/正则/` / `pattern => 显示名`。**它只作用于 AI 情报。**
  - **过滤在读的时候做，不在抓的时候做**：快照里存的永远是全量，关注词一改立刻生效。
  - **匹配的是标题 + 摘要，不只是标题。**
  - ⚠️ **短英文缩写必须写成 `/\bXXX\b/` 正则**：普通词是大小写不敏感的子串匹配，`RAG` 会命中 "The **trag**edy"，`AI` 会命中 "cert**ai**n"。
- 热点仍是 best-effort：每个源独立抓、独立失败；全挂就退回最近一次成功的快照并标 `stale`。**挂了不修。**

**在工作台里读原文**（`GET /api/hot/read` + `components/ArticleOverlay.jsx`）

- 提取用 **Readability** + **linkedom**，**不自己写「找最长的 div」**。转 Markdown 复用 `books.mjs` 的 `xhtmlToMd`。
- ⚠️ **`xhtmlToMd` 的第二个参数是必传的**（网页这边要传一个「相对路径转绝对 URL」的函数）。不传就是 `resolveImage is not a function`，整篇文章跟着挂掉。
- **不复用 `ReaderOverlay`**：热点是输入层，右栏按「这一栏在这儿有没有落点」逐个挑（只给「衍生」）。**画一个点了没落点的页签，比不画更糟。**
- **Firecrawl 是可选兜底**（`viaFirecrawl`），默认不开。**顺序不能反**：先直取 + Readability，失败了才走它。没配的时候提示里要说「配一个就能读」。**`success: true` 只代表它跑完了页面，不代表拿到的是正文。**
- ⚠️ **「抓到了」和「抓对了」是两回事，判据要写在一处**（`junkReason`）。踩过一次，用户看到一屏由界面文案拼成的「正文」——比直接报错糟得多。三层教训：
  - **Readability 面对空壳不会失败**，它会尽职地把壳里的字提取出来交差（实测见过整张验证页 139 字、页面 UI 文案 200 字）。
  - **靠特征词认这些垃圾是追不完的。** 已知要浏览器的域名（公众号/知乎/小红书/抖音/B站）在 `readArticle` 开头就**按域名断掉**；`looksBlocked` 只留给未知站点兜底。
  - **两条路必须共用同一套门槛**（250 字）。抓不到时要**说清是哪一类抓不到**（`whyNot`），原网页入口一直留着。**判据要偏向「宁可误报抓不到」**——误报的代价是点一下去原网页，漏报的代价是用户以为工作台坏了。
- 不做缓存：一条热点点开一次多半就不再点了。

**其他**

- **agent 对话只给只读工具**（Read/Glob/Grep），跑在 vault 目录里。让它直接写 vault 很香，但那意味着一句话就能改知识库；结论要留下走「存为笔记」。
- ⚠️ **spawn CLI 时用户输入只走 stdin，绝不进命令行参数。** Windows 上 `claude` 可能是 .cmd 包装、必须 `shell: true`，拼进命令行的话提问里写个引号或 `&&` 就能执行任意命令。`server/routes/agent.mjs` 的 args 全是常量。
- **归档单向、只增不改**：已导出的文件绝不覆盖——你可能在 Obsidian 里给归档稿加过批注。

## 数据页：地基是「一条内容一行」

`data/posts.csv` 是内容级事实层（一条已发布内容一行），`data/metrics.csv` 是账号级周录。**两份不是一回事，不要合并**：发布量、渠道分布从 posts 聚合；metrics 只管**粉丝数**。聚合逻辑全在 `src/lib/posts.js`（纯函数，被 `tests/unit.mjs` 钉住）——**算错了不会报错、不会白屏，只会让人按错的数字做决定**。图表和空态的取舍见 详见 [`docs/design-system.md`](docs/design-system.md)。

- **表格解析自己写**（`server/lib/sheet.mjs`），不引 SheetJS。三个坑各有对策：**共享字符串表**、**空单元格在 XML 里根本不写**（所以按 `r="B2"` 算列号，按出现顺序推的话空一格后面全左移）、**表头不一定在第一行**（取前 6 行里非空格最多的那行）。
- ⚠️ **中文平台的导出常常是 GBK。** 先试 UTF-8，解出来有 U+FFFD 才退 GBK——**顺序不能反**：拿 GBK 解 UTF-8 不报错，只会得到安静的乱码。
- **导入必须分两步**（`?dry=1` 预览 → 确认写盘），界面上必须摊开「我把哪一列当成了什么」——**这是这个流程存在的全部理由**。`FIELD_PATTERNS` 里 `collects` 排在 `views` 前面就是为了不被抢走；「阅读原文次数」不能喂给 views（那是「点了文末链接」，喂进去阅读量会凭空翻倍）。
- **写盘是整份重写不是追加**：导入是「合并」不是「续写」。去重键是链接，没有链接才退回 `平台+日期+标题`。
- **`doc` 列永远保留旧值**：那是人手动指认过「这条对应哪篇稿子」的结果，导出文件里根本没有这个信息。
- ⚠️ **平台后台导出里也有缩写数字**（「1.2万」「18,592」「--」）。`Number("1.2万")` 是 NaN 会静默变成空值。**百分比不当成量**：比率混进求和里得到的合计毫无意义，而它长得像个正常数字。
- **自动发现优先于手动拖拽**（`server/lib/inbox.mjs`）：扫系统下载目录（`.env` 的 `DOWNLOADS_DIR` 可覆盖）和 `data/inbox/`，**不递归子目录**，只认 30 天内改过的 .xlsx/.csv。**认不出平台的不猜**，给个下拉让人选——猜错了整批数据会挂到别的平台名下，而那是安静的错。
- **接口认 id 不认路径**（id 是绝对路径的哈希），导入前再验一次它确实落在允许的目录里。路径当参数等于开了个任意文件读取的口子。
- **`.pill-tabs` 是 inline-flex**，紧跟其后的 `.stat-strip`（inline-grid）会挤到同一行去，要显式让它自己占一行。
- **月度复盘的三条硬边界**：样本不够就说不够、**绝不编数**、结论必须能指回具体哪几篇。跨平台的四象限要按**本平台中位数**归一化。

## 已知坑

- **Node 22 的原生 fetch 不认 `HTTPS_PROXY`**（内置支持是 Node 24 的 `NODE_USE_ENV_PROXY` 才有）。这台机器设了 `HTTPS_PROXY=http://127.0.0.1:10808`，现象极具误导性：curl 同一个地址 200，Node 里却是一句没有细节的 `fetch failed`。所以**所有出站请求必须走 `server/lib/fetch.mjs` 的 `proxyFetch`**（undici + ProxyAgent），不要直接用全局 `fetch`。
- **中文查询参数不要用 Git Bash 的 curl 测**：`curl -G --data-urlencode "state=待修改"` 在 Windows 下会按 GBK 编码发出去（`%b4%fd%d0%de%b8%c4`），Notion 直接回 400。浏览器发的是正确的 UTF-8，所以这是测试工具的问题不是代码问题。要测就用 node 写脚本、`encodeURIComponent` 自己编码。
- **Notion 的 API 改不了 status 类型的选项**（只有 select 能改）。「搬置 → 搁置」这类改名只能在 Notion 界面里点——那边是原地重命名，已有的行会跟着走。改名那一刻代码两侧要一起跟上：`sources.js` 的 `states` / `quietStates` 和 `draft.js` 的 `PARKED` 都是同一个字符串，对不上就是 400。反查真实选项的办法是故意传一个不存在的状态，Notion 的报错里会列全 `Available options`。
- **`src/lib/views.js` 里的状态字符串必须和 Notion 库完全一致**，一个字都不能差。真实选项用「故意传一个不存在的状态、从报错里读 Available options」反查，别照文档抄。
- **平台名单（`PLATFORMS`）必须和 content-pipeline 的 `draft.js` 逐字一致**。对不上的话 Worker 会把它 filter 掉然后静默不写那个平台——界面上看不出任何异常，只是稿子永远不来。
- **hash 路由必须先切段、再 `decodeURIComponent`**，顺序反了就是个真 bug：状态值本身带斜杠（灵感库有「初筛失败/需人工」），整串先解码的话 `%2F` 被还原成真斜杠，`split("/")` 把状态劈成两半，只剩「初筛失败」送去 Notion——不是合法选项，库里直接回 400。**任何进 URL 的用户数据都要假设它含分隔符。**
- **`npm run build` 过了不等于没有未定义的标识符**。JSX 里引用一个没 import 的组件（比如漏了一个图标），打包器只当它是运行时全局，照样编译通过——直到真在浏览器里渲染那一段才 `ReferenceError`，而那一整块 UI 就白屏了。**只有 `npm test` 抓得到**，所以改完必跑，别用「build 绿了」代替它。
- **`tests/shots.mjs` 里 `page.goto` 到只有 hash 不同的地址不会重新加载**。上一张图点出来的状态（切成卡片视图、打开了阅读区）会原样留到下一张图，截出来的东西根本不是你以为的那一页。每张图前先 `goto("about:blank")`。踩过一次，而且当时那张图恰好掩盖了闸门失效的真相。
- **截图脚本会点真实数据**。任何「点了就写」的控件，脚本里都要确认它在当前实现下是**不写**的；拿不准就别在脚本里碰。

## 外来内容的安全边界

工作台这一页里有 vault 的读写口、Notion 的写入口和本机 CLI 通道。**在这一页里执行任意脚本，等于拿到这三样能力**——所以「外来内容」和「工作台自己的代码」之间必须有一条能说清楚的线。

- **Markdown → HTML 只有 `src/lib/markdown.js` 一个出口。** 正文（`Reader`）、右栏 AI 输出（`SideRail` 的 `Md`）、热点原文全走 `renderMarkdown`。**任何地方都不准再 `marked.parse` 之后直接塞进 `dangerouslySetInnerHTML`**——那些内容全是外部的：抓回来的网页、epub 转出来的 XHTML、Notion 里 LLM 写的稿、模型流式吐回来的字。判据只写一处，理由和 `App.jsx` 那个外链委托监听一样：渲染路径以后还会再多，各写各的迟早漏一处，而漏掉的那处不报错、看不出来。
  - **引了 DOMPurify，这是「十几行就别引包」那条规矩的有意例外。** HTML 消毒的难点全在 mXSS、命名空间混淆、innerHTML 二次解析这些没法靠读一遍代码想明白的地方——自己写的版本会「看起来对」，而它错的时候没有任何现象。取舍标准不是行数，是**错了能不能被发现**。
  - 白名单留全了排版要用的标签和属性（标题/列表/引用/表格/图片/链接/代码块/details）；砍掉的是能执行或能嵌进另一个页面的那些：script、style、iframe、object、embed、form 及一整套表单控件、link/meta/base。**svg 和 math 整个关掉**——看着无害，实际是 mXSS 的主战场，而外来正文里几乎不会有。
  - 链接协议白名单挡住 `javascript:` / `vbscript:` / `data:text/html`；`data:image/*` 放行，epub 的内嵌小图就是这么写的，而图片 data URI 执行不了脚本。
  - 消毒里给外链补 `rel="noopener noreferrer"`，和 `App.jsx` 点击时那一道**不冲突也不重复**：这边管「HTML 本身就是对的」，那边管「界面上手写的 `<a>` 也一样」。
  - **相对图片路径的改写要在消毒之后做**。反过来等于在已经消毒过的串上再拼一次字符串。
  - 这条只能在**真浏览器**里验（`tests/smoke.mjs`）：消毒靠的是浏览器自己的 HTML 解析器，node 里造个假 DOM 测出来的「过了」不代表 Chrome 里也过。断言测的是「危险内容真挂进 DOM 之后有没有执行」，不是「HTML 串里有没有那几个字」。
- **「地址是本机」不等于「请求来自工作台」**（`server/api.mjs` 的 `requestAllowed`）。任何网页都能往 `http://127.0.0.1:5180/api/...` 发跨站 POST，浏览器只是不让它读响应——而对「删一本书」来说，读不到响应一点都不重要，写进去就已经完成了。两道检查只管**会改东西**的请求：
  - `Origin` 对不上就拒。**Origin 缺失时放行是有意的**：node 脚本、curl、`npm run check` 都不带这个头，而它们本来就不是浏览器，不存在「用户在别的网站上被顺手代表了」这回事。
  - `Host` 必须是回环地址，挡的是 DNS rebinding——把一个域名解析到 127.0.0.1，那个域名下的页面就变成了「同源」，第一道会被绕过。
  - 端口也算同源的一部分：本机上另一个开发服务被 XSS 之后照样能打这个口。

## 弹层的键盘规矩只有一份（`src/lib/use-dialog.js`）

**这不是无障碍加分项，是一个用键盘就能误触的危险动作**：打开阅读覆盖层之后按 Tab，焦点会一路走进背后那一页的卡片，那儿每张卡右下角都有个垃圾桶。屏幕上什么都看不出来，而回车就是一次删除。

`useDialog(open, onClose, { autoFocus })` 一次给五条，缺一条这个 hook 就没意义：焦点进弹层（优先 `[data-autofocus]`）· Tab/Shift+Tab 只在内部循环 · 背景 `inert` · Esc 关闭 · 关闭后焦点回到**打开它的那个按钮**。

- ⚠️ **`inert` 要沿着「从弹层到 body」的整条路往上刨兄弟**，不能只看 `document.body.children`：这个项目的弹层没有一个是 body 的直接子节点。只看 body 那一层的话过滤完一个都不剩——**代码在跑，效果是零，而且看不出来**。
- **Esc 谁管要想清楚，别两处都管。** 阅读覆盖层的 Esc 留在页面那边（那儿有一条这里没有的规则：**正在输入框里打字时 Esc 不退出**）。传 `undefined` 表示「这一层不管 Esc」。平台闸门跑起来之后 Esc 失效——那一步已经在往 Notion 写了。
- **焦点归位前要判断那个元素还在不在**：弹层里的动作可能把它删掉了。
- **`Ctrl+K` 和 `n` 的规则不一样，不能写在同一个判断里**：带修饰键的在输入框里也要生效，裸键 `n` 在输入框里绝不能触发。
- ⚠️ **测焦点陷阱必须真按 Tab**（`page.keyboard.press`）。在 `evaluate` 里循环读 `activeElement` 什么都测不出来。
- 自绘 `Select` 的键盘事件**全在捕获阶段拦**：不拦的话收菜单那一下会顺手把整个阅读区关掉。**「键盘走到哪一项」和「当前值」是两回事**，回车才算选中。

## 文字得看得见

`--text-3` 和暗色的 `--ink-400` 都是**量出来的对比度**，不是挑的；「操作说明」类文字下限 13px，元信息和时间戳可以更小。冒烟测试量的是**屏幕上真实元素**的 computed 值，不是 CSS 变量（变量可能被组件层覆盖）。具体数值见 详见 [`docs/design-system.md`](docs/design-system.md)。

## 全局检索与「继续上次工作」（Ctrl + K）

东西散在四处（Notion 四库 / vault / posts.csv / 热点），而人不该记得它当初存在哪儿。`src/components/CommandPalette.jsx` + `server/lib/search.mjs`。空态就是「继续上次工作」，理由见 详见 [`docs/design-system.md`](docs/design-system.md)。

- **vault 侧建索引、Notion 侧只缓存**（90 秒）。vault 按 mtime 增量重读，所以刚在 Obsidian 里写的东西立刻搜得到。
- **索引存正文，不建倒排**：几十 MB 文本、几百个文件，`indexOf` 扫一遍是毫秒级。**先量再优化。**
- **只扫 `VAULT_DIRS` 那四个目录**，不扫整个 vault。加目录就在那儿加一行。
- **结果要打开「那一条」，不是「那一条所在的那一页」。** 落地是 `src/lib/open-target.js` 一张**一次性的交接条**（`setOpenTarget` → 目标页列表加载完 `takeOpenTarget` 消费掉），不是往 hash 里塞条目 id（hash 是两段，而状态值本身带斜杠）。三条约束：**一次性**（不清的话那一页重新加载时会又打开一遍）、**按页面分桶**、**不进 localStorage**。
- ⚠️ **`go.open` 有两个来源**（`search.mjs` 给的和 `recent.js` 存的），**加一个漏一个就会出同一个 bug**：面板里两组行长得一模一样、点下去行为却不一样。冒烟测试要**分别**盖住这两组。
- ⚠️ **冒烟测试等的必须是 `.cmdk__row` 真的出现**，不是「列表里没有『搜索中…』」（空态压根没这三个字），也不是「出现过『N 条结果』」（那一栏会因为一次重渲染退回等待态）。两版都假绿过。

## 热点转化链（`server/lib/trace.mjs`）

一条热点后来怎么样了：`未处理 → 已收藏 → 已形成选题 → 已成稿 → 已发布`。

- **状态一律由真实关联关系算出来，工作台自己不存一份映射。** 手工状态一定会失真：你在 Notion 里把选题删了、把稿子改成已发布，工作台那份记录不会跟着动，而这种错**没有任何地方会报出来**。所以入库成功之后也是**重算**，不是本地把一个字段改成「已收藏」。
- **认亲靠 URL**。热点唯一稳定的身份就是原文地址，入库时它落进灵感库的「链接」或素材库的「出处」。比对前两边都过一遍规范化（去锚点、去 utm/ref/spm 一类追踪参数、参数排序、转小写）——同一篇文章的链接经常带着不同的尾巴，逐字比十条有九条对不上。规范化在这里**不能抛异常**（热点里什么地址都有，一条不合法的不该让整批挂掉），所以没复用 `web-notes.mjs` 那个会 `bad()` 的版本。
- **「这条素材/灵感属于哪个选题」要从选题那一侧读**（Worker `/wb/list/topics` 的 `inspirationIds` / `materialIds`）。那两条 relation 本来就写在选题页上，读它一次调用都不多花；反过来读灵感、素材上的**同步属性**，那个属性叫什么取决于 Notion 里双向关系怎么配的，猜错就是静默的空数组。而灵感库那边压根没人写过关联（`storeInboxEntry` 不碰它）。
- **一次算完，不逐条问**：四个库的列表本来就为全局检索缓存着（`search.mjs` 的 `notionList`），这里复用同一份，**零额外网络调用**。
- `inspirationIds` / `materialIds` 是 **content-pipeline 2026-08-13 加的字段**（已部署）。Worker 要是回退到旧版本，链条只能算到「已收藏」，那时 `degraded` 为 true，界面上**照实说并给下一步**（去 content-pipeline 跑 `npx wrangler deploy`）——悄悄少几个芯片看起来就是「这些热点都没被用过」，那是句假话。
- **芯片只在「已经动过」时才画**：一屏几十条里绝大多数是「未处理」，给每条都挂一个灰标签等于铺一层没有信息量的噪音，真正走出去的那几条反而淹在里面。用**文字**不用颜色——这套界面里颜色已经有主人了（黑块=你在这儿、标记黄=我圈中的）。

## 设置面板：配置和提示词都能在界面里改

入口是侧栏最底下「流水线已连接」那一行右边的**齿轮**，弹出一张**居中的面板**（`components/SettingsOverlay.jsx`，左栏分类 + 右栏一段 + 固定动作条）。它回答三件事：现在配了什么 / 每条链路通不通 / 改哪儿。

**为什么不是抽屉、也不是铺满整屏**：抽屉那一版把六段全铺在 660px 里，一屏望过去全是灰字说明、字段藏在里面；铺满整屏那一版右边留出大半屏空白，底部两个按钮隔着一千多像素分居两头。需要整屏的是阅读区（正文要吃满宽度），这一屏不需要。

### 结构：`NAV` 是左栏的唯一真源

- **导航、字段表、提示词元信息，前端一个字都不写**，整个从 `GET /api/settings` / `GET /api/prompts` 渲染（真源是 `server/lib/settings-schema.mjs` 的 `NAV` / `SETTINGS`、`server/lib/prompts.mjs` 的 `PROMPT_FIELDS`）。抄第二份的话，新加的东西会在面板上**安静地不出现**。
- `NAV` 的 `kind` 决定右边画什么：`env` / `prompts-local` / `prompts-worker`。`kind: "env"` 的 `key` 必须能在 `SETTINGS` 里找到同名 `group`——**对不上的表现是那一段完全空白，不报错**（`tests/unit.mjs` 双向都钉了）。
- ⚠️ **左栏有两项都叫「流水线」**（一个在「连接」下、一个在「提示词」下）。文案是对的——组名已经把意思分开了。但**测试选择器要按 `data-key` 点，不能按文字点**，那也是收起态「创作」那条坑的同一种。
- **左栏每项挂一枚状态记号** = 那一段自检里**最坏**的一条（`SEVERITY`，`off` 不算坏）。这是加左导航的全部理由：不逐段翻就知道哪一段出了事。没有自检的段**不画**（不画一个恒为绿的假勾）。
- ⚠️ **切段不能丢改动。** `draft` / `pDraft` 挂在覆盖层顶层，左栏切的只是「右边画哪一段」。丢了的话「改 A → 去 B 改一下 → A 白改了」，不报错也看不出来。底部计数是**跨段总数**。
- **说明文字分两位**：`hint` 是一行，`why` 是长的那些（踩过的坑），收进 `<details>` 默认收起。信息一条不删，但默认一屏只剩字段——这正是上一版「一大坨」的修法。

### `.env` 那一半

- ⚠️ **密钥的值永远不出服务端**（`secret: true` 只回 `configured` 布尔），**连掩码都不回**——`sk-****abcd` 本身就泄露长度和尾部，而「看着像那一串」在这儿没用（key 对不对是自检回答的）。界面上也不做「显示明文」的眼睛：这台机器会录屏会共享桌面。
- ⚠️ **提交时密钥留空 = 不改，不是清空。** 面板读不回密钥，所以「没动它」和「想清空」在请求体里长得一模一样。按清空处理的话，改一下 `VAULT_ROOT` 就会把 `DEEPL_API_KEY` 洗掉——**不报错、不白屏**，只是翻译从此不工作。清空走请求体里显式的 `clear` 数组。
- **写入过白名单**（`WRITABLE`），和 Worker 侧 `/wb/update` 的 `EDITABLE` 同一条。
- **保存点两下**（改 `.env` 是红线），第二下的按钮上写清东西去哪（「写入 creator-workbench/.env」），不写「确定吗」，配一个「取消」。
- **改 `.env` 走 `server/lib/env-file.mjs`**：**单行改写**，注释、空行、顺序逐字保留（`.env` 里过半是注释，而那些注释是资产）；同一个 key 出现多次时每一处都改；值含空格 / `#` / 引号必须加引号；写完用 `parseEnv` 自检（`atomicWrite` 的 `verify`，跑在替换**之前**）；写前 `snapshotFile(root, "env", …)`。
- ⚠️ **写 `.env` 会让 Vite 重启整个 dev server**（它把 env 文件和 vite.config 一起当配置依赖看）。所以保存之后**不能立刻打接口**——会收到「本地服务没响应」，而那句话会被读成「刚才保存失败了」。面板拿 `/api/config` 当心跳等它回来（`waitForServer`，等不到也不报错）。好处是 `serveTypeset(env)` 那种挂中间件时就把路径闭包捕获了的地方跟着一起对了，所以**界面上不要给 `TYPESET_DIR` 挂「改完要重启」的标**，那是假话。

### 提示词分两段，因为它们生效的方式不同

| 哪一段 | 存在哪 | 改完 |
| --- | --- | --- |
| **工作台**（对话的角色设定、配封面的指令） | `config/prompts.json`，默认值在 `server/lib/prompts.mjs` | 立刻生效 |
| **流水线**（`prompt/*.md` 十几个：初筛 / 整理 / 成稿 / 划词 AI / 人设 / 平台指南） | `<content-pipeline>/prompt/**.md`，目录由 `.env` 的 `PIPELINE_DIR` 指 | **必须 `npx wrangler deploy`** |

**在左栏里就分成两项，不混成一段。** 混在一起的必然结果是用户改完 Worker 的提示词、看到「已保存」、然后以为生效了——而 Worker 照旧按老提示词跑，不报错也看不出来。两段的**保存按钮也长得不一样**：工作台那段跟着底部动作条一起存；流水线那段**就地一个自己的按钮**，因为它写的是另一个项目的文件。

- ⚠️ **对话的安全约束不给改，也不给藏**（`prompts.mjs` 的 `CHAT_GUARD`）。对话通道 spawn 的是能读你整个 vault 的 agent，而喂给它的网页标题、选中段落、附近正文全是外来的——里面完全可以有一句「忽略以上所有指令」。所以它是常量、由 `chatSystem()` **恒定拼在角色设定后面**，`agent.mjs` 直接调它不自己拼（分头拼的话，以后加第二个 spawn 入口那一处会漏，而漏了不报错）。界面上**只读展示**并写明为什么——藏起来的话，用户会以为自己改的那段就是全部。`tests/unit.mjs` 钉了「role 清空 / 换成注入语，两个引擎的路上都还有 guard」。
- **配封面那句的真源在服务端**，`Studio.jsx` 点的时候才去 `/api/prompts` 拿。在前端留一份默认文案就是第二真源，用户改完设置发现「配封面」还是老样子，而且不报错。`{platform}` 是唯一占位符；标题和正文由代码拼在后面，不进模板（删掉占位符也不会把上下文带没）。

### ⚠️ 工作台会写另一个项目的文件（`server/lib/pipeline-prompts.mjs`）

这是这个项目里唯一一处这样的能力面，四条防护一条都不能省：

1. **认清单 id，不认路径。** 客户端提交的是我们自己列出来那份清单里的 id（相对路径的哈希）。路径当参数等于开了个任意文件写入的口子——和数据页 inbox「接口认 id 不认路径」同一条。
2. **落盘前再验一遍它确实在 `prompt/` 底下**（相对路径检查）。两道，因为第一道依赖「清单是我们生成的」这个会被改坏的前提。
3. **只认 `.md`。**
4. **写前留快照**（`data/.snapshots/pipeline-prompt/`）、写走 `atomicWrite`、带 `stamp` 做乐观锁（这些文件在 content-pipeline 那边也会被直接编辑，对不上就 409）。

⚠️ **`.env` 和这些快照都绝不进 `backup.mjs` 的 `DATA_FILES`、绝不进导出 zip**：那个 zip 是「工作台的数据」而且是要带走的，不该夹带密钥或另一个项目的源文件——界面文案和包里的恢复说明已经白纸黑字承诺过了。

**「还没部署」的横幅是这一段最要紧的一件事**：改过就一直挂着，写清改了哪几个、给出 `npx wrangler deploy` 和复制按钮，点「我已经部署了」才消（记 localStorage）。拿不到 Worker 真实的部署时间，**宁可多问一次，也不能默认「大概生效了」**——忘了部署的表现是「改了没反应」。

### 能力自检（`server/lib/settings-check.mjs`，`POST /api/settings/verify`）

存在的理由是有一整类问题**现在没有任何地方会说**：`claude` / `codex` 不在 PATH 上时「对话」永远起不来；DeepL 免费版 key 打 Pro 域名回 403 而报错里看不出原因；vault 子目录不存在时界面显示的是「还没建，去导一本」的空态引导，看起来像「你还没用过这个功能」。

- **可选能力没配 = `off`，不是 `bad`。** 把「你没开这个功能」画成红的，等于每次打开面板都在骂人。
- **Worker 要区分 401（密钥不对）和连不上（地址错/网络）**——这两种在界面上本来长得一模一样，而下一步完全不同。
- **CLI 探针照着 `agent.mjs` 的 `ENGINES` 探**（那也是它导出的理由），不另写一份判断：自己写一份就会出现「自检说装了、点对话起不来」。
- **逐条 try**，一条抛异常不能把整块变成一句「失败」；**自检失败不挡保存**。
- ⚠️ **测试和截图等的是自检出结论**（`.set-check--ok/bad/warn/off`），不是 `.set-check` 这个壳——壳里全是转圈时断言照样全绿，那是假绿。
- `hint` / `why` / `desc` / `label` **都是纯文本**，直接塞进 `<div>`，不过 `renderMarkdown`。写了 `**加粗**` 屏幕上就是两个星号（踩过，截图才看得出来）。

### 测试这一屏的三条

- ⚠️ **一个字都不能真存**：写 `.env` 会让测试自己起的那个 dev server 重启，写提示词改的是 content-pipeline 的真文件。冒烟测试数的是**写请求次数**（`writes === 0`），不是「确认态出来了」——确认和写入可以同时发生（`askPlatformsOn` 的教训）。
- **左栏点击按 `data-key`**，不按文字。
- 截图脚本同理：**只开不存**。

## 数据回得去

「工作台无状态」说的是**不自己发明一份数据**，不是「数据丢了无所谓」。posts.csv、attention.json、vault 里的批注，丢了没有任何地方能再生成一遍。四类东西各有各的退路，**这条界线要写在界面上**——一份「看着像全备份、其实漏了一半」的备份比没有备份更危险：

| 对象 | 退路 |
| --- | --- |
| 代码 | git |
| vault 正文 | 你自己的文件级备份 / Obsidian 同步。**工作台不碰** |
| 工作台数据（posts / metrics / attention） | 自动快照 + 一键导出 |
| 浏览器本地数据（进度 / 书签 / 阅读设置 / 排版草稿） | 跟着导出包走 |

- ⚠️ **所有整份重写都走 `server/lib/safe-write.mjs` 的 `atomicWrite`。** `fs.writeFile` 会**先把文件截成 0 字节**再写，中断那一刻磁盘上留下的是半份文件，而原来那份已经没了——不报错，只是下次打开发现少了一截。三步缺一不可：临时文件**和目标同目录**（跨盘符 rename 在 Windows 上退化成复制+删除）、**fsync 之后再 rename**、失败时收掉临时文件。`verify` 在替换**之前**跑。
- **改工作台数据之前先留快照**（`data/.snapshots/<key>/<带毫秒的时间戳>.<后缀>`）。**毫秒不能省**：恢复流程本身就是「先给当前存一份、再覆盖」，两步在同一秒内完成，秒级文件名会让第二份直接盖掉第一份。
- **清理规则是「keepDays 天内的全留，外加最近 minKeep 份永远保留」。** 后半条不是保险丝是主逻辑：只按天数清的话，两个月不打开工作台、回来导一次数据，**恰好在最需要回退的时候一份不剩**。天数由 `.env` 的 `SNAPSHOT_KEEP_DAYS` 配，它是唯一一个搬进 `process.env` 的变量，**密钥一律不搬**。
- **快照失败不能挡住正常写入**：磁盘满这种小毛病不该让工作台从此不能保存。`snapshotFile` 出错只打一行警告、返回空串。
- **数据文件的清单只有一份**（`server/lib/backup.mjs` 的 `DATA_FILES`），快照、导出、恢复三处都从它取——各写一份的话，新加的数据文件会安静地不进备份。
- **导出走 POST**：localStorage 服务端读不到，只能由前端交上来一起打包。**进备份的键是挑过的**（`BACKED_UP_LOCAL_KEYS`）；写回时**只覆盖备份里有的键，绝不 `localStorage.clear()`**。
- **恢复必须两步：预览 → 确认**，预览要写清**每份数据从几条变成几条**——「即将恢复 3 份数据」把「42→43」和「42→7」说成了同一句话。顺序是「先给当前留快照 → 校验 → 替换 → 复查 → 不对就回滚」，**快照要在任何写入之前全部做完**。校验值（sha256）对不上时**在动手之前就拒绝**。
- **恢复说明跟着 zip 走**（包里的 `恢复说明.txt`）：需要它的那一刻，你手上往往只剩这个 zip。
- ⚠️ **测「恢复前留了快照」要断言内容，不要数条数**（恢复末尾会跑一次清理，条数会被压回上限）。测「坏掉的备份被挡住」不要随便翻一个字节（大概率落在说明文本里，测试会假绿），要直接改内容、留旧 manifest。

## 错误处理契约

所有 API 返回 `{ ok:true, ... }` 或 `{ ok:false, error, hint? }`。**`hint` 是给用户的下一步动作**（「在 .env 里填 WORKER_URL」），界面直接显示——只报告问题不引导行动，是这个项目明确要避免的反馈方式。每个数据区块独立失败，任何上游挂掉都不能白屏。

## 浏览器扩展

- 源码在 `extension/`，是可直接“加载已解压”的 Manifest V3 扩展，不另建一套前端构建链。
- 网页内容脚本只负责选区与浮动工具条；所有 AI、vault 和素材请求都经扩展后台转发，结果只在 Chrome 原生 Side Panel 展示。不要把知识库或 AI 输出注入网页 DOM。
- 扩展只连 `127.0.0.1:5180/api/extension/*`。工作台启动时生成临时配对令牌，令牌只留在 service worker 内存；禁止把 `WORKBENCH_KEY` 或其他长期密钥放进扩展。
- 任意网页没有 Notion pageId。亲手写的网页批注按规范化 URL 落到 vault 的 `网页批注/<host>/<hash>-<标题>.md`，路径只能由服务端派生，客户端不得提交 vault path。
- 快问模式只有 `解释 / 展开 / 反驳 / 选题`；自定义问题走对话。AI 结果默认不落盘，必须由用户明确点“存为批注 / 存为素材”。
- 工具条不提供高亮和翻译。当前入口为批注、提问、对话、选题、存素材；输入框、可编辑区域和工作台自身页面不出现入口。

## 与 content-pipeline 的关系

工作台不直连 Notion，一律经 Worker 的 `/wb/*`（字段映射和踩坑经验都在那边，不抄第二份）。改动涉及 Worker 时遵守 content-pipeline 自己的 CLAUDE.md（subrequest 预算、状态机、字段名）。
