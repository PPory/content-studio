// 把长文和长期资产归档进 Obsidian vault（GitHub 仓库）。
//
// 分工的判据只有一条，遇到「这个放哪」时直接套用：
//
//   **机器要频繁读的，必须在 D1；人要读、要搜、要反链的，写一份到 vault。**
//
// 反例说明为什么不能反过来：成稿时 `searchSupplementary` 要在全部素材上打分排序——
// 在 D1 是一条 SQL，在 vault 就是几十次 GitHub API，直接爆掉单次调用的 subrequest
// 预算。**读路径一旦走 GitHub 就完了**，所以这里只有写，没有读。
//
// ---
//
// **只创建新文件，绝不修改已有文件。这是硬约束，不是建议。**
//
// vault 的另一头是你本机的 Obsidian Git 插件：每 1 分钟自动 commit、每 10 分钟 pull、
// 且 pullBeforePush。只要两边不碰同一个文件，Git 自己就能合并干净；一旦 Worker 开始
// 改写已有文件，就会和你正在编辑的内容撞车，而且是在你看不见的地方撞。
//
// 实现上靠 GitHub 自己顶住：Contents API 在文件已存在而请求不带 sha 时返回 422，
// 我们不传 sha，收到 422 就换个文件名重试——所以「不覆盖」不是靠我们先查一次再写
// （那中间有竞态），是靠服务端的原子拒绝。

const GH = "https://api.github.com";
const WB_ROOT = "99 - 个人工作台";

/**
 * 素材类型 → 子目录。
 *
 * **目录名统一两字，和库里的类型值刻意不同名。** 类型值要喂给 LLM（提示词里列的就是
 * 「金句·原话」「反直觉点」这些），语义清楚比整齐重要；而目录名是给人扫一眼用的，
 * 长短不齐会让文件树很乱。两者由这张表连接，各自服务各自的读者。
 *
 * 三类发布复盘产出合并进「09 - 复盘」：它们是同一件事的三个侧面。
 */
const MATERIAL_DIRS = {
  核心观点: "01 - 观点",
  "金句/原话": "02 - 金句",
  "数据/事实": "03 - 数据",
  "案例/故事": "04 - 案例",
  "框架/模型": "05 - 框架",
  反直觉点: "06 - 反常",
  个人经历: "07 - 经历",
  延展问题: "08 - 问题",
  标题样本: "09 - 复盘",
  内容角度: "09 - 复盘",
  平台反馈: "09 - 复盘",
};

export function isVaultEnabled(env) {
  return Boolean(env.GITHUB_TOKEN && env.VAULT_REPO);
}

// 下面三个纯函数 export 出来是为了能用 node --test 直接覆盖——它们不碰网络，
// 却是最容易出错的地方：一个没转义的引号会让整份 frontmatter 解析失败，
// 而 Obsidian 不会报错，只是安静地不显示属性。
/**
 * 文件名清洗。
 *
 * 除了文件系统的非法字符，还要去掉 `[` `]` `#` `^` `|`——它们在 Obsidian 里是
 * wikilink、标签和块引用的语法字符，出现在文件名里会让 `[[链接]]` 解析错位。
 */
export function safeName(text, max = 40) {
  return String(text || "")
    .replace(/[/\\:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, "") || "未命名";
}

function ymd(unix) {
  return new Date((unix || Math.floor(Date.now() / 1000)) * 1000).toISOString().slice(0, 10);
}

// YAML 标量：能不加引号就不加，需要时用双引号并转义。
// wikilink 必须带引号——裸的 [[x]] 在 YAML 里会被当成嵌套流式序列。
export function yamlValue(v) {
  if (v === null || v === undefined || v === "") return '""';
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (/^[\w一-龥][\w一-龥 ·/-]*$/.test(s) && !s.includes(": ")) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

export function frontmatter(fields) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlValue(item)}`);
    } else {
      lines.push(`${k}: ${yamlValue(v)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * 拼「标题 + 正文」，**已经有标题就不再加一个**。
 *
 * 三种归档都会撞上这件事，而且撞的方式不一样：成稿的 body 是 LLM 写的，开头本来就带
 * 一个 `# 标题`；`/金句` 存的素材则是 title 和 content 完全相同。两种都会让文件里
 * 出现重复标题——加上 Obsidian 顶部显示的文件名，就是同一句话连着出现三次。
 *
 * 不干脆完全不加标题，是因为稿件要被复制出去发布，正文里需要有标题。
 */
export function titledBody(title, body) {
  const text = String(body || "").trim();
  if (!text) return `# ${title}\n`;
  // 正文自带 H1，或正文就是标题本身
  if (/^#\s/.test(text) || text === String(title).trim()) return `${text}\n`;
  return `# ${title}\n\n${text}\n`;
}

// UTF-8 → base64。btoa 只吃 Latin-1，中文必须先编码成字节再逐字节转。
// 也收 Uint8Array：备份写的是 gzip 后的二进制，不是文本。
function toBase64(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  const CHUNK = 0x8000; // 一次 spread 太多字节会爆栈
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// 路径里每一段都要编码（中文目录名），但 / 本身要留着
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

async function putFile(env, path, content, message) {
  const res = await fetch(`${GH}/repos/${env.VAULT_REPO}/contents/${encodePath(path)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "content-pipeline",
      "content-type": "application/json",
    },
    body: JSON.stringify({ message, content: toBase64(content) }),
  });
  if (res.status === 422 || res.status === 409) return { conflict: true };
  if (!res.ok) {
    throw new Error(`GitHub PUT ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return { conflict: false };
}

/**
 * 写一个新文件，重名就加序号重试。
 *
 * 不先查存在性再写：查和写之间有竞态，而且多花一次 subrequest。直接写，让 GitHub
 * 用 422 告诉我们「这个名字被占了」——服务端的原子拒绝比客户端的先查后写更可靠。
 */
async function createFile(env, dir, base, content, message, { ext = "md" } = {}) {
  for (let i = 0; i < 5; i++) {
    const name = i === 0 ? `${base}.${ext}` : `${base}-${i + 1}.${ext}`;
    const path = `${dir}/${name}`;
    const { conflict } = await putFile(env, path, content, message);
    if (!conflict) return path;
  }
  throw new Error(`vault: ${base} 连续 5 个文件名都被占用`);
}

/** 稿件 → `03 - 稿件/YYYY-MM-DD-平台-标题.md`。vault 是稿件的真源。 */
export async function archiveDraft(env, draft, { topicTitle = "", materialTitles = [] } = {}) {
  const date = ymd(draft.created_at);
  const fm = frontmatter({
    id: draft.id,
    topic_id: draft.topic_id,
    topic: topicTitle,
    platform: draft.platform,
    status: draft.status,
    summary: draft.summary,
    // 只写**真实引用**的素材。标签检索来的补充候选不进这里——和 topic_materials
    // 只存真实关系是同一条原则，混进来反链就失去意义了。
    materials: materialTitles.map((t) => `[[${t}]]`),
    created: date,
  });
  const body = `${fm}\n\n${titledBody(draft.headline, draft.body)}`;
  return createFile(
    env,
    `${WB_ROOT}/03 - 稿件`,
    `${date}-${safeName(draft.platform, 8)}-${safeName(draft.headline)}`,
    body,
    `pipeline: 成稿 ${draft.platform}｜${draft.headline.slice(0, 40)}`
  );
}

/** 素材 → `05 - 素材库/<类型目录>/YYYY-MM-DD-标题.md`。 */
export async function archiveMaterial(env, material, { tags = [], inboxTitle = "" } = {}) {
  const date = ymd(material.created_at);
  const dir = MATERIAL_DIRS[material.type] || "01 - 观点";
  const fm = frontmatter({
    id: material.id,
    type: material.type,
    tags,
    source: material.source_url,
    verification: material.verification,
    // 指回原始灵感，让「稿件 ← 素材 ← 灵感」这条链在关系图里能走通
    inbox: inboxTitle ? `[[${inboxTitle}]]` : "",
    created: date,
  });
  const body = `${fm}\n\n${titledBody(material.title, material.content)}`;
  return createFile(
    env,
    `${WB_ROOT}/05 - 素材库/${dir}`,
    `${date}-${safeName(material.title)}`,
    body,
    `pipeline: 素材｜${material.title.slice(0, 40)}`
  );
}

/** 灵感原文 → `06 - 灵感/YYYY-MM/YYYY-MM-DD-标题.md`。按月分，它是流水没有类型。 */
export async function archiveInbox(env, row, { tags = [] } = {}) {
  const date = ymd(row.created_at);
  const fm = frontmatter({
    id: row.id,
    kind: row.kind,
    tags,
    link: row.link,
    source: row.source,
    value: row.value_judgment,
    verdict: row.verdict,
    created: date,
  });
  const parts = [fm, "\n\n", titledBody(row.title, row.body)];
  if (row.card_markdown) parts.push(`\n---\n\n## 初筛素材卡\n\n${row.card_markdown}\n`);
  return createFile(
    env,
    `${WB_ROOT}/06 - 灵感/${date.slice(0, 7)}`,
    `${date}-${safeName(row.title)}`,
    parts.join(""),
    `pipeline: 灵感｜${row.title.slice(0, 40)}`
  );
}

/**
 * D1 整库备份 → `99 - 个人工作台/_备份/d1-YYYY-MM-DD.json.gz`。
 *
 * **和上面三个归档不是一件事，别按它们的思路读。** 那三个写的是「人要读的一份 Markdown」；
 * 这个写的是**机器要读回去的一份数据**，正文里一个字都不给人看。放同一个文件里是因为
 * GitHub 的写入链路（不带 sha、422 换名、base64 分块）只该有一份。
 *
 * 三个选择的理由：
 *
 *  * **下划线开头的目录**：和洞察的 `_material/` 同一个约定——`_` 打头＝机器产物。
 *    工作台的全局检索只收 `.md` 且只扫白名单目录，所以这些文件在界面上完全不存在。
 *  * **gzip**：不压的话几千行正文轻松过 1 MB，而 GitHub Contents API 对超过 1 MB 的
 *    文件就不保证了；更实际的是这个仓库会同步到你本机的 Obsidian，每周一份未压缩的
 *    全库 dump 一年就是几百 MB 躺在笔记库里。压完通常十分之一。
 *  * **一次一个新文件，不覆盖**：正合 vault「只创建不修改」的硬约束，而且备份本来
 *    要的就是**多个时间点**——覆盖成一个文件只剩一个还原点，那才是白备份。
 */
export async function archiveBackup(env, base, gzipped) {
  return createFile(env, `${WB_ROOT}/_备份`, base, gzipped, `backup: D1 ${base}`, { ext: "json.gz" });
}

/**
 * 归档失败不该让主流程失败。
 *
 * 成稿跑了一两分钟 LLM、素材已经落库，这时候 GitHub 挂了或 token 过期，不能让
 * 整个任务回滚——D1 才是运行时真源，vault 是归档。失败记日志、留 vault_path 为空，
 * 下次可以补写。
 */
export async function tryArchive(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`vault archive failed (${label}):`, e.message.slice(0, 300));
    return null;
  }
}
