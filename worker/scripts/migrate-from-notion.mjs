// 一次性迁移：Notion 四库 → D1。
//
// 用法（在项目根目录）：
//   node scripts/migrate-from-notion.mjs            # 生成 tmp/migrate.sql，不写库
//   npx wrangler d1 execute content-pipeline --remote --file=tmp/migrate.sql
//
// 分两步而不是直接写库，是为了让中间产物能被检查：几百行数据一次灌进去，
// 灌错了比没灌更难收拾。生成的 SQL 用 INSERT OR REPLACE，重复执行安全。
//
// **沿用 Notion 的 page id 作为 D1 主键**。这样不需要维护一张 id 映射表，
// 工作台和任何已经记下这些 id 的地方都不会失效。新建的行才用 ULID。
//
// 不认识的枚举值不会静默丢弃，会兜底到默认值并在最后统一报告——迁移最怕的
// 就是「跑完了，看起来没事，其实有 30 行的状态被悄悄改了」。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 必须走 fileURLToPath：项目路径里有中文，直接取 `.pathname` 拿到的是
// percent-encode 过的串（desktop%E6%A1%8C%E9%9D%A2），fs 打不开。
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NOTION = "https://api.notion.com/v1";
const warnings = [];

// ---------- 配置 ----------

function readDevVars() {
  const raw = readFileSync(`${ROOT}/.dev.vars`, "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * 四个 Notion 库的 id 从 `.dev.vars` 读，不从 wrangler.jsonc。
 *
 * 迁移是**一次性**的：Worker 运行时根本不需要这些 id，把它们留在 wrangler.jsonc
 * 的 vars 里，只会让每个新 clone 的人以为自己也得填。
 */
function readDbIds() {
  const v = readDevVars();
  const ids = {
    inbox: v.NOTION_INBOX_DB_ID,
    materials: v.NOTION_MATERIALS_DB_ID,
    topics: v.NOTION_TOPICS_DB_ID,
    drafts: v.NOTION_DRAFTS_DB_ID,
  };
  const missing = Object.entries(ids).filter(([, id]) => !id).map(([k]) => k);
  if (missing.length) {
    throw new Error(`.dev.vars 里缺少这几个库的 id：${missing.join(", ")}（见 .dev.vars.example）`);
  }
  return ids;
}


// ---------- Notion 读取 ----------

const token = readDevVars().NOTION_TOKEN;
if (!token) throw new Error(".dev.vars 里没有 NOTION_TOKEN");

async function notion(path, options = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(NOTION + path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "content-type": "application/json",
      },
    });
    if (res.status === 429) {           // Notion 限流约 3 req/s
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Notion ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error(`Notion ${path} 连续限流 5 次`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function queryAll(dbId) {
  const rows = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notion(`/databases/${dbId}/query`, { method: "POST", body: JSON.stringify(body) });
    rows.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
    await sleep(350);
  } while (cursor);
  return rows;
}

// 正文块 → Markdown。原 lib/notion.js 的 getPageMarkdown，迁移期一次性需要，
// 内联在这里而不是留在 src/：迁完就再没有 Notion 块要读了。
async function pageMarkdown(pageId) {
  const parts = [];
  let cursor;
  let numbering = 0;
  do {
    const qs = cursor ? `?page_size=100&start_cursor=${cursor}` : "?page_size=100";
    const data = await notion(`/blocks/${pageId}/children${qs}`);
    for (const b of data.results) {
      if (b.type === "numbered_list_item") numbering += 1; else numbering = 0;
      const md = blockToMd(b, numbering);
      if (md !== null) parts.push(md);
    }
    cursor = data.has_more ? data.next_cursor : undefined;
    await sleep(350);
  } while (cursor);
  return parts.join("\n\n");
}

function blockToMd(b, numbering) {
  const t = b.type;
  const rich = b[t]?.rich_text;
  const text = rich ? richToMd(rich) : "";
  switch (t) {
    case "heading_1": return `# ${text}`;
    case "heading_2": return `## ${text}`;
    case "heading_3": return `### ${text}`;
    case "bulleted_list_item": return `- ${text}`;
    case "numbered_list_item": return `${numbering}. ${text}`;
    case "to_do": return `- [${b.to_do?.checked ? "x" : " "}] ${text}`;
    case "quote": return text.split("\n").map((l) => `> ${l}`).join("\n");
    case "callout": {
      const icon = b.callout?.icon?.emoji ? `${b.callout.icon.emoji} ` : "";
      return text.split("\n").map((l, i) => `> ${i === 0 ? icon : ""}${l}`).join("\n");
    }
    case "code": return `\`\`\`${b.code?.language === "plain text" ? "" : b.code?.language || ""}\n${text}\n\`\`\``;
    case "divider": return "---";
    case "toggle": return `- ${text}`;
    case "image": {
      const url = b.image?.external?.url || b.image?.file?.url || "";
      return url ? `![](${url})` : null;
    }
    default: return text ? text : null;
  }
}

function richToMd(rich) {
  return (rich || []).map((t) => {
    let s = t.plain_text || "";
    if (!s) return "";
    const a = t.annotations || {};
    if (a.code) s = `\`${s}\``;
    if (a.bold) s = `**${s}**`;
    if (a.italic) s = `*${s}*`;
    if (a.strikethrough) s = `~~${s}~~`;
    if (t.href) s = `[${s}](${t.href})`;
    return s;
  }).join("");
}

// ---------- 属性读取 ----------

const title = (p, k) => (p.properties[k]?.title || []).map((t) => t.plain_text).join("");
const rich = (p, k) => (p.properties[k]?.rich_text || []).map((t) => t.plain_text).join("");
const sel = (p, k) => p.properties[k]?.select?.name || "";
const stat = (p, k) => p.properties[k]?.status?.name || "";
const multi = (p, k) => (p.properties[k]?.multi_select || []).map((o) => o.name);
const urlOf = (p, k) => p.properties[k]?.url || "";
const dateOf = (p, k) => p.properties[k]?.date?.start || "";
const numOf = (p, k) => (typeof p.properties[k]?.number === "number" ? p.properties[k].number : null);
const rel = (p, k) => (p.properties[k]?.relation || []).map((r) => r.id);
const unix = (s) => Math.floor(new Date(s).getTime() / 1000);

/** 枚举兜底：不在白名单里的值记一条警告，不静默丢。 */
function enumOr(value, allowed, fallback, context) {
  if (allowed.includes(value)) return value;
  if (value) warnings.push(`${context}：「${value}」不在允许值内，已改为「${fallback}」`);
  return fallback;
}

// ---------- SQL 生成 ----------

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replaceAll("'", "''")}'`);
const n = (v) => (v === null || v === undefined ? "NULL" : String(v));

function insert(table, obj) {
  const cols = Object.keys(obj);
  return `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map((c) => obj[c]).join(",")});`;
}

const MATERIAL_TYPES = ["核心观点", "金句/原话", "数据/事实", "案例/故事", "框架/模型", "反直觉点", "个人经历", "延展问题", "标题样本", "内容角度", "平台反馈"];
const INBOX_STATUS = ["待初筛", "待选题", "已选题", "存档备用", "已弃用", "初筛失败/需人工"];
const TOPIC_STATUS = ["待写", "撰写中", "已成稿", "已发布", "搁置"];
const PLATFORMS = ["公众号", "X", "小红书", "视频号", "YouTube"];

async function main() {
  const dbs = readDbIds();
  const sql = [];
  const tagNames = new Set();
  const tagLinks = { material: [], inbox: [] };

  // ---- 灵感库 ----
  const inboxRows = await queryAll(dbs.inbox);
  console.log(`灵感库 ${inboxRows.length} 行，读正文中…`);
  for (const p of inboxRows) {
    const body = await pageMarkdown(p.id);
    sql.push(insert("inbox", {
      id: q(p.id),
      title: q(title(p, "一句话")),
      kind: q(enumOr(sel(p, "类型"), ["文章链接", "视频链接", "想法", "摘录"], "想法", `灵感 ${p.id} 类型`)),
      link: q(urlOf(p, "链接")),
      source: q(rich(p, "来源")),
      body: q(body),
      card_markdown: q(""),
      status: q(enumOr(stat(p, "状态"), INBOX_STATUS, "待初筛", `灵感 ${p.id} 状态`)),
      value_judgment: q(enumOr(sel(p, "价值判断"), ["值得深挖", "存档备用", "建议弃用"], "", `灵感 ${p.id} 价值判断`)),
      verdict: q(rich(p, "一句话判断")),
      created_at: n(unix(p.created_time)),
      updated_at: n(unix(p.last_edited_time)),
    }));
    for (const t of multi(p, "标签")) { tagNames.add(t); tagLinks.inbox.push([p.id, t]); }
  }

  // ---- 选题库（先于素材，素材要引用它）----
  const topicRows = await queryAll(dbs.topics);
  console.log(`选题库 ${topicRows.length} 行，读写作要点中…`);
  for (const p of topicRows) {
    const notes = await pageMarkdown(p.id);
    sql.push(insert("topics", {
      id: q(p.id),
      title: q(title(p, "选题")),
      viewpoint: q(rich(p, "核心观点")),
      audience: q(rich(p, "目标读者")),
      notes: q(notes),
      platform: q(enumOr(multi(p, "适配平台")[0] || "", PLATFORMS, "", `选题 ${p.id} 平台`)),
      priority: q(enumOr(sel(p, "优先级"), ["高", "中", "低"], "中", `选题 ${p.id} 优先级`)),
      status: q(enumOr(stat(p, "状态"), TOPIC_STATUS, "待写", `选题 ${p.id} 状态`)),
      draft_note: q(""),
      task_key: rich(p, "任务标识") ? q(rich(p, "任务标识")) : "NULL",
      created_at: n(unix(p.created_time)),
      updated_at: n(unix(p.last_edited_time)),
    }));
    for (const iid of rel(p, "来源灵感")) {
      sql.push(`INSERT OR IGNORE INTO topic_inbox (topic_id, inbox_id) VALUES (${q(p.id)}, ${q(iid)});`);
    }
  }

  // ---- 稿件库 ----
  const draftRows = await queryAll(dbs.drafts);
  console.log(`稿件库 ${draftRows.length} 行，读正文中…`);
  const topicIdSet = new Set(topicRows.map((t) => t.id));
  for (const p of draftRows) {
    const body = await pageMarkdown(p.id);
    const topicId = rel(p, "关联选题").find((id) => topicIdSet.has(id)) || null;
    sql.push(insert("drafts", {
      id: q(p.id),
      topic_id: topicId ? q(topicId) : "NULL",
      headline: q(title(p, "标题")),
      summary: q(rich(p, "一句话摘要")),
      body: q(body),
      platform: q(enumOr(sel(p, "平台"), PLATFORMS, "公众号", `稿件 ${p.id} 平台`)),
      status: q(enumOr(stat(p, "发布状态"), ["待修改", "已发布"], "待修改", `稿件 ${p.id} 状态`)),
      published_url: q(urlOf(p, "发布链接")),
      published_at: q(dateOf(p, "发布时间")),
      views: n(numOf(p, "阅读播放")),
      likes: n(numOf(p, "点赞")),
      comments: n(numOf(p, "评论")),
      collects: n(numOf(p, "收藏")),
      shares: n(numOf(p, "分享")),
      performance_summary: q(rich(p, "表现摘要")),
      feedback_status: q(enumOr(sel(p, "反馈状态"), ["未评估", "样本不足", "普通", "表现突出", "已沉淀"], "未评估", `稿件 ${p.id} 反馈状态`)),
      // task_key 是 NOT NULL UNIQUE：历史行没有的话用 id 兜底，保证唯一
      task_key: q(rich(p, "任务标识") || `migrated:${p.id}`),
      created_at: n(unix(p.created_time)),
      updated_at: n(unix(p.last_edited_time)),
    }));
  }

  // ---- 素材库（最后：要引用灵感、选题、稿件）----
  const materialRows = await queryAll(dbs.materials);
  console.log(`素材库 ${materialRows.length} 行…`);
  const inboxIdSet = new Set(inboxRows.map((r) => r.id));
  const draftIdSet = new Set(draftRows.map((r) => r.id));
  for (const p of materialRows) {
    const inboxId = rel(p, "来源灵感").find((id) => inboxIdSet.has(id)) || null;
    const draftId = rel(p, "来源稿件").find((id) => draftIdSet.has(id)) || null;
    sql.push(insert("materials", {
      id: q(p.id),
      title: q(title(p, "素材")),
      content: q(rich(p, "内容")),
      type: q(enumOr(sel(p, "素材类型"), MATERIAL_TYPES, "核心观点", `素材 ${p.id} 类型`)),
      source_url: q(urlOf(p, "出处")),
      inbox_id: inboxId ? q(inboxId) : "NULL",
      verification: q(enumOr(sel(p, "核验状态"), ["不适用", "待核验", "已核验"], "不适用", `素材 ${p.id} 核验状态`)),
      verification_note: q(rich(p, "核验说明")),
      draft_id: draftId ? q(draftId) : "NULL",
      feedback_types: q(multi(p, "反馈类型").join(",")),
      performance_basis: q(rich(p, "表现依据")),
      task_key: rich(p, "任务标识") ? q(rich(p, "任务标识")) : "NULL",
      created_at: n(unix(p.created_time)),
      updated_at: n(unix(p.last_edited_time)),
    }));
    for (const t of multi(p, "标签")) { tagNames.add(t); tagLinks.material.push([p.id, t]); }
    for (const tid of rel(p, "关联选题")) {
      if (topicIdSet.has(tid)) {
        sql.push(`INSERT OR IGNORE INTO topic_materials (topic_id, material_id) VALUES (${q(tid)}, ${q(p.id)});`);
      }
    }
  }

  // ---- 标签 ----
  for (const name of tagNames) sql.push(`INSERT OR IGNORE INTO tags (name) VALUES (${q(name)});`);
  for (const [mid, name] of tagLinks.material) {
    sql.push(`INSERT OR IGNORE INTO material_tags (material_id, tag_id) SELECT ${q(mid)}, id FROM tags WHERE name = ${q(name)};`);
  }
  for (const [iid, name] of tagLinks.inbox) {
    sql.push(`INSERT OR IGNORE INTO inbox_tags (inbox_id, tag_id) SELECT ${q(iid)}, id FROM tags WHERE name = ${q(name)};`);
  }

  mkdirSync(`${ROOT}/tmp`, { recursive: true });
  writeFileSync(`${ROOT}/tmp/migrate.sql`, sql.join("\n"), "utf8");

  console.log(`\n✅ 已生成 tmp/migrate.sql（${sql.length} 条语句）`);
  console.log(`   灵感 ${inboxRows.length} / 素材 ${materialRows.length} / 选题 ${topicRows.length} / 稿件 ${draftRows.length} / 标签 ${tagNames.size}`);
  if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} 条枚举值被兜底（**看完再决定要不要灌**）：`);
    for (const w of warnings.slice(0, 30)) console.log(`   - ${w}`);
    if (warnings.length > 30) console.log(`   …还有 ${warnings.length - 30} 条`);
  }
  console.log(`\n下一步：npx wrangler d1 execute content-pipeline --remote --file=tmp/migrate.sql`);
}

main().catch((e) => { console.error(e); process.exit(1); });
