import os from "node:os";
import path from "node:path";

export const NAV = [
  {
    group: "创作",
    items: [
      {
        key: "writing-profile",
        label: "我的创作",
        desc: "长期读者、平台和默认写作偏好，保存在当前 SQLite 工作区。",
        kind: "writing-profile",
        applies: "保存后立即用于新的创作与专家任务。",
      },
    ],
  },
  {
    group: "本地",
    items: [
      {
        key: "workspace",
        label: "工作区",
        desc: "SQLite、资源、备份与导出的唯一根目录。",
        kind: "env",
        checks: ["workspace"],
        applies: "修改后本地服务会重启；原数据不会被自动移动。",
      },
      {
        key: "tools",
        label: "本机工具",
        desc: "可选的排版和站内采集工具路径。",
        kind: "env",
        checks: ["typeset", "mediacrawler"],
      },
    ],
  },
  {
    group: "AI",
    items: [
      {
        key: "agent",
        label: "模型",
        desc: "本机 Pi Agent 使用的模型地址、模型名和密钥。",
        kind: "env",
        checks: ["agent"],
        applies: "密钥只写入本机 .env，不进入前端、备份或导出。",
      },
      {
        key: "optional",
        label: "可选能力",
        desc: "翻译、网页抓取、热榜和搜索；都不影响本地创作主流程。",
        kind: "env",
        checks: ["deepl", "firecrawl", "sixty"],
      },
    ],
  },
  {
    group: "提示词",
    items: [
      {
        key: "prompts-local",
        label: "工作台",
        desc: "本地对话与写作提示词。",
        kind: "prompts-local",
        applies: "保存后立即生效。",
      },
    ],
  },
];

export const SETTINGS = [
  {
    key: "XENHO_HOME",
    group: "workspace",
    label: "Xenho 根目录",
    hint: "留空时使用系统“文档”目录下的 Xenho。",
    why: "这是现役单工作区的唯一位置；切换路径不会隐式复制或删除原工作区。",
    placeholder: "D:/文档/Xenho",
    check: "workspace",
    effective: (env) => (env.XENHO_HOME || "").trim() || path.join(os.homedir(), "Documents", "Xenho"),
  },
  {
    key: "TYPESET_DIR",
    group: "tools",
    label: "排版工具目录",
    hint: "留空时按项目约定寻找同级 wechat-typeset。",
    check: "typeset",
  },
  {
    key: "TYPESET_URL",
    group: "tools",
    label: "独立排版工具地址",
    hint: "只在另行部署排版工具时填写。",
    placeholder: "https://typeset.example.com",
  },
  {
    key: "MEDIACRAWLER_DIR",
    group: "tools",
    label: "MediaCrawler 目录",
    hint: "仅用于可选的站内公开内容探针。",
    check: "mediacrawler",
  },
  {
    key: "AGENT_LLM_BASE_URL",
    group: "agent",
    label: "模型接口地址",
    placeholder: "https://api.example.com/v1",
    required: true,
    check: "agent",
  },
  {
    key: "AGENT_LLM_MODEL",
    group: "agent",
    label: "模型 ID",
    placeholder: "model-id",
    required: true,
    check: "agent",
  },
  {
    key: "AGENT_LLM_API_KEY",
    group: "agent",
    label: "模型密钥",
    secret: true,
    required: true,
    check: "agent",
  },
  {
    /**
     * 提炼知识库用的模型。**和助手的模型分开一位**：助手那个是你随手换着用的，
     * 而提炼要跑上百份资料、产出会成为以后写作的依据——它的质量取舍是另一个决定，
     * 不该被顺手改掉。留空就跟随 `AGENT_LLM_MODEL`。
     *
     * 挑模型看**逐字校验丢弃率**（`scripts/wiki-ingest.mjs` 每轮会报）：
     * 实测同一份资料上 gpt-5.6-terra 0–21%、claude-sonnet-4-6 64%——
     * 后者内容并不差，是它倾向改写引文，而改写过的引文没法回原文核对。
     */
    key: "AGENT_INGEST_MODEL",
    group: "agent",
    label: "知识库提炼模型",
    placeholder: "留空则跟随上面的模型 ID",
  },
  {
    // 地址和密钥也能单独换：助手那条通道断配额时，提炼可以整条挪到别处继续跑，
    // 不必动助手的配置（那样会把正在用的会话也一起搬走）。
    key: "AGENT_INGEST_BASE_URL",
    group: "agent",
    label: "提炼接口地址",
    placeholder: "留空则跟随上面的接口地址",
  },
  {
    key: "AGENT_INGEST_API_KEY",
    group: "agent",
    label: "提炼密钥",
    secret: true,
    placeholder: "留空则跟随上面的密钥",
  },
  {
    key: "AGENT_LLM_PROTOCOL",
    group: "agent",
    label: "接口协议",
    hint: "默认 openai-completions；只有兼容接口要求不同时才修改。",
    placeholder: "openai-completions",
  },
  {
    key: "DEEPL_API_KEY",
    group: "optional",
    label: "DeepL 密钥",
    secret: true,
    check: "deepl",
  },
  {
    key: "FIRECRAWL_API_KEY",
    group: "optional",
    label: "Firecrawl 密钥",
    secret: true,
    check: "firecrawl",
  },
  {
    key: "FIRECRAWL_BASE_URL",
    group: "optional",
    label: "Firecrawl 地址",
    hint: "自托管实例可只填地址。",
    placeholder: "https://api.firecrawl.dev",
    check: "firecrawl",
  },
  {
    key: "SIXTY_SECONDS_API_BASE_URL",
    group: "optional",
    label: "60s 热榜地址",
    placeholder: "https://60s.example.com",
    check: "sixty",
  },
  {
    key: "BRAVE_SEARCH_API_KEY",
    group: "optional",
    label: "Brave Search 密钥",
    secret: true,
  },
];

export const FIELDS = Object.fromEntries(SETTINGS.map((field) => [field.key, field]));
export const WRITABLE = new Set(SETTINGS.map((field) => field.key));

export function mediacrawlerDir(env = {}) {
  return path.resolve((env.MEDIACRAWLER_DIR || "").trim() || path.join(process.cwd(), "..", "..", "MediaCrawler"));
}
