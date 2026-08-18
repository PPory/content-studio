// 工作台环境配置的**唯一清单**。`/api/settings`、`/api/settings/verify` 和
// `/api/config` 三处都从这里派生。
//
// 为什么要有这份清单：这些变量原来只存在于 `.env.example` 的注释里，而代码里是
// 8 个文件各读各的（`vault.mjs` / `worker.mjs` / `translate.mjs` / `article.mjs` /
// `inbox.mjs` / `tools.mjs` / `safe-write.mjs` / `search.mjs`）。界面上凡是碰到没配好的，
// 给的引导都是一句**死胡同**（「去 .env 里填 VAULT_ROOT」），而那句话本身就该是个入口。
//
// **前端不写第二份字段表、也不写第二份导航**：设置面板的左栏和右栏整个从
// `GET /api/settings` 的响应渲染出来，加一个变量、挪一段位置都只改这里一处。
// 抄两份的话，新加的变量会在面板上安静地不出现。
//
// ⚠️ **`secret: true` 的字段值永远不出服务端。** 见 `routes/settings.mjs` 的注释。

import os from "node:os";
import path from "node:path";
import { snapshotKeepDaysOf } from "./safe-write.mjs";
// `typesetDir` 住在 routes/tools.mjs 里（它是那个中间件自己的默认路径规则）。
// 从 lib 引 routes 是把层反过来了，但它是个纯函数，而**在这里抄第二份**的后果更糟：
// 面板上写的默认目录和中间件真正去找的目录会各走各的。
import { typesetDir } from "../routes/tools.mjs";

/**
 * 左栏导航：**分组和顺序的唯一真源**。
 *
 * 为什么要有左栏：上一版六段全铺在一个抽屉里，一屏望过去全是说明文字，字段藏在里面。
 * 左栏一分，右边一次只画一段，而且**每项旁边能挂一枚状态记号**——不用逐段翻就知道
 * 哪一段出了事，这才是左导航在这儿真正的价值。
 *
 * `kind` 决定右边画什么：
 *   env             这一段是 `.env` 字段（`SETTINGS` 里 `group` 等于这个 key 的那些）
 *   prompts-local   工作台自己的提示词（`config/prompts.json`，改完立刻生效）
 *   prompts-worker  流水线的提示词（worker/prompt 底下的 *.md，改完要 deploy）
 *
 * ⚠️ **提示词的两段在左栏里就分开，不混成一段。** 「改完立刻生效」和「改完要部署才
 * 生效」是两种完全不同的东西；混在一起的必然结果是用户改完 Worker 的提示词、
 * 看到「已保存」、然后以为它生效了——而 Worker 那边照旧按老提示词跑。
 *
 * `checks` 是这一段要显示哪几条自检（id 见 `lib/settings-check.mjs`）。
 * **自检结果紧贴着它检的那个配置项**，不另开一个「诊断」段：单开一段的话，
 * 「流水线连不上」和「Worker 地址」隔着半屏，看到结论还得自己找回去改哪儿。
 */
export const NAV = [
  {
    group: "连接",
    items: [
      {
        key: "vault",
        kind: "env",
        label: "知识库",
        desc: "书架、洞察报告、批注和全局检索都从这里读。不配这一项，工作台大半是空的。",
        checks: ["vault"],
      },
      {
        key: "pipeline",
        kind: "env",
        label: "流水线",
        // 库从 Notion 迁到 D1 之后这句话得改：工作台仍然不直连数据库，
        // 但它经过的是 worker/ 那个 Worker，而不再是「Notion 的代理」
        desc: "灵感 / 素材 / 选题 / 稿件四个库都在 Worker 的 D1 里，工作台一律经 /wb/* 取。没配时「创作」页是空的。",
        checks: ["worker"],
      },
    ],
  },
  {
    group: "能力",
    items: [
      {
        key: "optional",
        kind: "env",
        label: "可选能力",
        desc: "都不配也能用，配了各多一件事。空着不是出错。",
        // 「AI 对话」也挂在这儿：它同样是「有就多一件事」，只是开关不在 .env 里而是
        // 「本机装没装那个 CLI」。归到别处的话，它就成了一条没有归属的孤立提示
        checks: ["deepl", "firecrawl", "sixty", "agent"],
      },
      {
        key: "paths",
        kind: "env",
        label: "本机路径",
        desc: "同仓的 worker/ 和外面那几个独立项目装在哪。留空就用默认值——每一项底下写着默认值算出来是哪个目录。",
        checks: ["typeset", "mediacrawler", "workerdir"],
      },
    ],
  },
  {
    group: "模型",
    items: [
      {
        key: "models",
        kind: "models",
        // ⚠️ **这一段的数据全在 Worker 的 D1 里，不在 `.env`。** 所以它不走 `SETTINGS`
        // 那张字段表，也不跟着底部那条动作条保存——和「流水线提示词」是同一类：
        // 面板管的东西不都住在同一个地方，那就分开说清楚，别让人以为点了「保存」就全存了。
        label: "各环节模型",
        desc: "初筛 / 整理 / 成稿这些重活值得用强模型，挑素材、打标签用便宜快的就够。改完立刻生效，不用部署。",
        checks: ["worker"],
      },
    ],
  },
  {
    group: "提示词",
    items: [
      {
        key: "prompts-local",
        kind: "prompts-local",
        label: "工作台",
        desc: "工作台自己发出去的那几段指令。改完立刻生效，不用重启也不用部署。",
      },
      {
        key: "prompts-worker",
        kind: "prompts-worker",
        label: "流水线",
        desc: "worker/prompt 底下那些提示词，初筛 / 整理 / 成稿 / 划词 AI 全按它们跑。它们打包进 Worker，所以改完要部署一次才算数。",
        checks: ["workerdir"],
      },
    ],
  },
  {
    group: "其他",
    items: [
      // 「快捷入口」那一节在库迁到 D1 之后**整个撤掉了**：它原来只放四个 Notion 库的
      // 外链，而那四个库现在不是真源了——点开看到的是一份不再更新的旧数据，
      // 比没有链接更糟。剩下的 TYPESET_URL 并进「可选能力」（它也是「配了多一件事」）。
      {
        key: "data",
        kind: "env",
        label: "数据保留",
        desc: "工作台每次改 posts / metrics / 关注配置之前都会自动留一份快照。",
      },
    ],
  },
];

/** 摊平的导航项，按左栏顺序。 */
export const NAV_ITEMS = NAV.flatMap((g) => g.items);

/**
 * 一个字段：
 *   key          .env 里的变量名
 *   group        落在哪一段（要能在 NAV 里找到同名的 `kind: "env"` 项）
 *   label        界面上的名字
 *   secret       true = **值永不出服务端**，界面上只显示「已配置 / 未配置」
 *   hint         **一行**：配了能多做什么 / 空着会怎样
 *   why          长的那些（踩过的坑、为什么是这样）。界面上收进「为什么」折叠，默认收起
 *   placeholder  举个例子，不是重复 label
 *   effective    留空时实际生效的值。**只给「留空有默认」的字段**
 *   check        绑一条自检（id 见 `lib/settings-check.mjs`）。绑了之后：通了就是**标题旁边一枚绿点**
 *                （结论进 title），出问题才在字段底下占一行。**只有一对一的才绑**——`worker` 检的是「地址 + 密钥」两个字段、
 *                `firecrawl` 检的是「云端 key 或自托管地址」二选一，绑到其中一个就等于把另一个
 *                填错时的红叉指到无辜的框上。`agent`（对话引擎）压根没有字段，只能单独成行。
 *
 * ⚠️ **hint / why / desc / label 都是纯文本**，界面上直接塞进 <div>，不过 renderMarkdown。
 * 写了 `**加粗**` 的话，屏幕上出现的就是两个星号（踩过一次，截图才看得出来）。
 *
 * hint 和 why 分开是这一版的重点：上一版每个字段底下挂两三行灰字，一屏全是说明，
 * 字段反而藏在里面。信息一条不删，只是默认不铺开。
 */
export const SETTINGS = [
  {
    key: "VAULT_ROOT",
    group: "vault",
    check: "vault",
    label: "Obsidian vault 路径",
    required: true,
    placeholder: "D:/ObsidianVault/obsidian-vault",
    hint: "vault 根目录的绝对路径。",
    why: "工作台读写的目录整块收在它底下的「99 - 个人工作台/」里，01–04 是你的字（书、报告、成稿、批注），09 是机器抓的数据。收进一个一级目录之后，Obsidian 的文件树上一眼分得出「哪些是我写的、哪些是工具产的」。",
  },

  {
    key: "WORKER_URL",
    group: "pipeline",
    label: "Worker 地址",
    placeholder: "https://your-worker.workers.dev",
    hint: "worker/ 部署出来的地址，不带结尾斜杠。",
  },
  {
    key: "WORKBENCH_KEY",
    group: "pipeline",
    label: "Worker 访问密钥",
    secret: true,
    hint: "自己设一串长密码，这里和 Worker 那边要一致。",
    why: "同一串要在两边：填在这里，并在 worker/ 目录里跑一次 npx wrangler secret put WORKBENCH_KEY。它和 Telegram 那个 secret 是分开的，可以单独轮换。",
  },

  {
    key: "DEEPL_API_KEY",
    group: "optional",
    check: "deepl",
    label: "DeepL 密钥",
    secret: true,
    hint: "配了才有划词翻译。",
    why: "免费版和 Pro 是两个域名，key 以 :fx 结尾的是免费版——工作台自己会挑，你不用管。这一条值得知道是因为：拿 Pro 的地址打免费 key 会回 403，而报错里完全看不出是这个原因。",
  },
  {
    key: "FIRECRAWL_API_KEY",
    group: "optional",
    label: "Firecrawl 密钥",
    secret: true,
    hint: "热点原文抓不到时的兜底。云端 key 去 firecrawl.dev 拿。",
    why: "顺序是先直取正文 + Readability，抓不到才走它。公众号、知乎、小红书这类要真浏览器才渲染得出正文的页面，配了就能在工作台里读完；不配的话给的是「去原网页看」的出口。",
  },
  {
    key: "FIRECRAWL_BASE_URL",
    group: "optional",
    label: "Firecrawl 自托管地址",
    placeholder: "http://127.0.0.1:3002",
    hint: "自己 docker 起了一份时填它；留空走官方云端。",
    why: "自托管默认不设鉴权，所以填了这一项可以不填上面那个密钥——两个有一个就算配过了。",
  },
  {
    // ⚠️ **这一条以前根本不在这张表里**，而热点页那六个榜就靠它。后果是：代码里的默认值
    // 是个占位域名，六个榜每次都失败、界面退回快照，而设置面板上**连这个变量都不存在**——
    // 用户翻遍面板也找不到该填什么，只看见一份日期越来越旧、其余一切正常的热榜。
    // 加变量只改这一处，面板和 /api/config 才会跟着有（`.env.example` 是给还没跑起来的那一刻看的）。
    key: "SIXTY_SECONDS_API_BASE_URL",
    group: "optional",
    check: "sixty",
    label: "热榜数据源（60s API）",
    placeholder: "https://60s.<你的账号>.workers.dev",
    hint: "「热点 → 平台热榜」那六个榜从这里取，不填就只剩旧快照。",
    why: "60s API（github.com/vikiboss/60s）要自己部署一份实例，填它的根地址、不带结尾斜杠。留空时代码会去打一个占位域名、六个榜整整齐齐失败——而界面显示的是上一次成功的快照，不看时间戳的话跟正常的一模一样。接入约定见 docs/60s-api.md：Base URL 只从这里读、不能只看 HTTP 200（业务失败写在 body 的 code 里）。",
  },
  {
    // 原来住在「快捷入口」那一节。那一节在库迁到 D1 之后整个撤了（见 NAV 里的注释），
    // 而这一条本身仍然成立——它和这一段其他几项是同一件事：配了多一个入口，不配也照用
    key: "TYPESET_URL",
    group: "optional",
    label: "排版工具外链",
    hint: "另外部署了一份排版工具时填它的地址。",
    why: "工作台里那个内嵌的排版页不受影响，这只是总览页底下多一个跳出去的按钮。",
  },

  {
    key: "DOWNLOADS_DIR",
    group: "paths",
    label: "下载目录",
    hint: "数据页「自动发现」扫的目录。",
    why: "另一个扫的地方恒定是项目里的 data/inbox/。不是所有人的下载目录都在 ~/Downloads，而认不到的话，从平台后台导出的表格就只能手动拖进来。",
    effective: (env) => (env.DOWNLOADS_DIR || "").trim() || path.join(os.homedir(), "Downloads"),
  },
  {
    key: "TYPESET_DIR",
    group: "paths",
    check: "typeset",
    label: "wechat-typeset 目录",
    hint: "「排版」页嵌的就是它。",
    why: "工作台把它静态托管在 /tools/typeset/ 再 iframe 嵌进来，typeset 项目本身一行没改，仍然可以双击 index.html 独立使用。找不到目录时那一页显示的是 404 引导。",
    effective: (env) => typesetDir(env),
  },
  {
    key: "MEDIACRAWLER_DIR",
    group: "paths",
    check: "mediacrawler",
    label: "MediaCrawler 目录",
    hint: "中文站内探针用的，没装也不影响别的。",
    why: "只被 scripts/social-probe.mjs 用到。没装的话洞察报告会少「小红书 / 抖音站内」这条腿，其余照常。",
    effective: (env) => mediacrawlerDir(env),
  },
  {
    key: "WORKER_DIR",
    group: "paths",
    check: "workerdir",
    label: "worker 目录",
    hint: "上面「提示词 · 流水线」那一段直接读写它底下的 prompt/*.md。",
    why: "只用来找提示词文件——工作台取数据走的是上面那个 Worker 网络地址，和这个本地目录无关（所以就算目录不在，四个库照样能用）。合仓之后它就是 workbench 的同级 worker/，默认值基本不用改。",
    effective: (env) => workerDir(env),
  },

  {
    key: "SNAPSHOT_KEEP_DAYS",
    group: "data",
    label: "快照保留天数",
    // 不给 placeholder：`effective` 那一行已经写着「留空时用：30」了，
    // 再放一个灰色的 30 在框里就是同一件事说两遍
    hint: "默认 30。无论怎么设，最近 5 份永远保留。",
    why: "「最近 5 份永远保留」不是保险丝是主逻辑：只按天数清的话，两个月不打开工作台、回来改一次数据，恰好在最需要回退的时候一份都不剩。",
    effective: () => String(snapshotKeepDaysOf(process.env.SNAPSHOT_KEEP_DAYS)),
  },
];

export const FIELDS = Object.fromEntries(SETTINGS.map((f) => [f.key, f]));

/** 白名单：只有清单里的变量能被写回 `.env`。见 `routes/settings.mjs`。 */
export const WRITABLE = new Set(SETTINGS.map((f) => f.key));

/**
 * 同级目录里那几个独立项目的默认位置。**都放在这里**，因为设置面板要显示
 * 「留空时实际用的是哪个目录」——两处各算一遍的话，面板上写的路径和代码真正去找的
 * 路径可能对不上，而那种错没有任何地方会报出来。
 */
/**
 * ⚠️ **合仓之后这两个的层数不一样，别抄错。**
 *
 * workbench 现在住在 `content-studio/` 里面：
 *   worker/       是**同级**（`../worker`）——它和 workbench 一起在这个仓里
 *   MediaCrawler  是 content-studio 的同级（`../../MediaCrawler`）——外面的独立项目
 *
 * 合仓之前两个都是 `..`。那一版在合仓当天就静默失效了：目录找不到，
 * 自检说「没装」，而其实只是路径少数了一层。
 */
export function mediacrawlerDir(env = {}) {
  return path.resolve((env.MEDIACRAWLER_DIR || "").trim() || path.join(process.cwd(), "..", "..", "MediaCrawler"));
}

export function workerDir(env = {}) {
  return path.resolve((env.WORKER_DIR || "").trim() || path.join(process.cwd(), "..", "worker"));
}
