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
 *   prompts-worker  流水线的提示词（content-pipeline 的 prompt/*.md，改完要 deploy）
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
        desc: "工作台不直连 Notion，一律经 content-pipeline 的 Worker。没配时「创作」页的四个库都取不到东西。",
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
        checks: ["deepl", "firecrawl", "agent"],
      },
      {
        key: "paths",
        kind: "env",
        label: "本机路径",
        desc: "同级目录里那几个独立项目装在哪。留空就用默认值——每一项底下写着默认值算出来是哪个目录。",
        checks: ["typeset", "mediacrawler", "pipedir"],
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
        desc: "content-pipeline 的提示词，初筛 / 整理 / 成稿 / 划词 AI 全按它们跑。它们打包进 Worker，所以改完要部署一次才算数。",
        checks: ["pipedir"],
      },
    ],
  },
  {
    group: "其他",
    items: [
      {
        key: "links",
        kind: "env",
        label: "快捷入口",
        desc: "纯链接，填了总览页底下才出这几个按钮。不影响任何功能。",
      },
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
    hint: "content-pipeline 部署出来的地址，不带结尾斜杠。",
  },
  {
    key: "WORKBENCH_KEY",
    group: "pipeline",
    label: "Worker 访问密钥",
    secret: true,
    hint: "自己设一串长密码，这里和 Worker 那边要一致。",
    why: "同一串要在两边：填在这里，并在 content-pipeline 目录里跑一次 npx wrangler secret put WORKBENCH_KEY。它和 Telegram 那个 secret 是分开的，可以单独轮换。",
  },

  {
    key: "DEEPL_API_KEY",
    group: "optional",
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
    label: "wechat-typeset 目录",
    hint: "「排版」页嵌的就是它。",
    why: "工作台把它静态托管在 /tools/typeset/ 再 iframe 嵌进来，typeset 项目本身一行没改，仍然可以双击 index.html 独立使用。找不到目录时那一页显示的是 404 引导。",
    effective: (env) => typesetDir(env),
  },
  {
    key: "MEDIACRAWLER_DIR",
    group: "paths",
    label: "MediaCrawler 目录",
    hint: "中文站内探针用的，没装也不影响别的。",
    why: "只被 scripts/social-probe.mjs 用到。没装的话洞察报告会少「小红书 / 抖音站内」这条腿，其余照常。",
    effective: (env) => mediacrawlerDir(env),
  },
  {
    key: "PIPELINE_DIR",
    group: "paths",
    label: "content-pipeline 目录",
    hint: "上面「提示词 · 流水线」那一段直接读写它底下的 prompt/*.md。",
    why: "只用来找提示词文件——工作台连 Notion 仍然是走 Worker 的网络地址（上面那个 Worker 地址），和这个本地目录无关。找不到目录时那一段只给引导，不报错。",
    effective: (env) => pipelineDir(env),
  },

  { key: "NOTION_INBOX_URL", group: "links", label: "灵感库", placeholder: "https://www.notion.so/…", hint: "" },
  { key: "NOTION_MATERIALS_URL", group: "links", label: "素材库", placeholder: "https://www.notion.so/…", hint: "" },
  { key: "NOTION_TOPICS_URL", group: "links", label: "选题库", placeholder: "https://www.notion.so/…", hint: "" },
  { key: "NOTION_DRAFTS_URL", group: "links", label: "稿件库", placeholder: "https://www.notion.so/…", hint: "" },
  {
    key: "TYPESET_URL",
    group: "links",
    label: "排版工具外链",
    hint: "另外部署了一份排版工具时填它的地址。",
    why: "工作台里那个内嵌的排版页不受影响，这只是总览页底下多一个跳出去的按钮。",
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
export function mediacrawlerDir(env = {}) {
  return path.resolve((env.MEDIACRAWLER_DIR || "").trim() || path.join(process.cwd(), "..", "MediaCrawler"));
}

export function pipelineDir(env = {}) {
  return path.resolve((env.PIPELINE_DIR || "").trim() || path.join(process.cwd(), "..", "content-pipeline"));
}
