// 补写 vault：把 `vault_path IS NULL` 的行归档过去。
//
// **不区分「历史数据」和「上次写失败」**——它们在库里长得一模一样，也该被同样对待。
// 一个机制同时解决两件事：从 Notion 迁过来的存量一次性补齐，以及 GitHub 抽风那次
// 漏掉的行下一轮自己补上。这就是为什么归档失败时 `tryArchive` 只记日志、
// 把 vault_path 留空——留空本身就是待办清单。
//
// 每轮只处理少量：一条归档 = 1 次 GitHub 请求，而单次 Worker 调用的对外 subrequest
// 上限是 50。跑完一批要几轮 cron，但这件事不急。

import {
  all, updateRow, tagsOf, materialsOfTopic, getRow,
} from "../lib/db.js";
import { INBOX_STATUS } from "../lib/values.js";
import {
  isVaultEnabled, archiveDraft, archiveMaterial, archiveInbox, tryArchive,
  // 借同一个清洗函数拼反链目标名，避免两份命名规则漂移
  safeName,
} from "../lib/vault.js";

const BATCH = 6;

/** 还有多少行没归档。cron 用它决定要不要入队，避免空跑一个 Workflow。 */
export async function pendingVaultCount(env) {
  if (!isVaultEnabled(env)) return 0;
  const row = await all(env, `
    SELECT (SELECT COUNT(*) FROM materials WHERE vault_path IS NULL)
         + (SELECT COUNT(*) FROM drafts WHERE vault_path IS NULL)
         + (SELECT COUNT(*) FROM inbox WHERE vault_path IS NULL AND status != ?) AS n`,
    INBOX_STATUS.DROPPED);
  return row[0]?.n ?? 0;
}

export async function runVaultBackfill(env) {
  if (!isVaultEnabled(env)) return { done: 0, skipped: "vault_disabled" };

  let done = 0;
  // 顺序跟着引用方向走：素材的 frontmatter 反链到灵感，稿件反链到素材。
  // 被引用的先落地，补写过程中就不会出现一段时间的空链接。
  // （最终结果不受影响——Obsidian 的 wikilink 是弱引用，目标后出现也会自动连上。）
  done += await backfillInbox(env, BATCH - done);
  if (done < BATCH) done += await backfillMaterials(env, BATCH - done);
  if (done < BATCH) done += await backfillDrafts(env, BATCH - done);

  const left = await pendingVaultCount(env);
  console.log(`backfill: archived ${done}, ${left} left`);
  return { done, left };
}

async function backfillMaterials(env, limit) {
  if (limit <= 0) return 0;
  const rows = await all(
    env,
    "SELECT * FROM materials WHERE vault_path IS NULL ORDER BY created_at ASC LIMIT ?",
    limit
  );
  if (!rows.length) return 0;

  const tagMap = await tagsOf(env, "material", rows.map((r) => r.id));
  // 反链要的是灵感标题，按批查回来——每行查一次的话，6 行就是 6 次多余往返
  const inboxIds = [...new Set(rows.map((r) => r.inbox_id).filter(Boolean))];
  const titles = new Map();
  if (inboxIds.length) {
    const holes = inboxIds.map(() => "?").join(",");
    for (const r of await all(env, `SELECT id, title FROM inbox WHERE id IN (${holes})`, ...inboxIds)) {
      titles.set(r.id, r.title);
    }
  }

  let n = 0;
  for (const row of rows) {
    const path = await tryArchive("material", () => archiveMaterial(env, row, {
      tags: tagMap.get(row.id) || [],
      inboxTitle: row.inbox_id ? vaultBase(titles.get(row.inbox_id), row.created_at) : "",
    }));
    if (!path) continue;
    await updateRow(env, "materials", row.id, { vault_path: path });
    n++;
  }
  return n;
}

async function backfillDrafts(env, limit) {
  if (limit <= 0) return 0;
  const rows = await all(
    env,
    "SELECT * FROM drafts WHERE vault_path IS NULL ORDER BY created_at ASC LIMIT ?",
    limit
  );
  let n = 0;
  for (const row of rows) {
    const topic = row.topic_id ? await getRow(env, "topics", row.topic_id) : null;
    const materials = row.topic_id ? await materialsOfTopic(env, row.topic_id) : [];
    const path = await tryArchive("draft", () => archiveDraft(env, row, {
      topicTitle: topic?.title || "",
      materialTitles: materials.map((m) => vaultBase(m.title, m.created_at)),
    }));
    if (!path) continue;
    await updateRow(env, "drafts", row.id, { vault_path: path });
    n++;
  }
  return n;
}

async function backfillInbox(env, limit) {
  if (limit <= 0) return 0;
  // 已弃用的不写——那是明确判过没价值的，进 vault 纯噪音
  const rows = await all(
    env,
    "SELECT * FROM inbox WHERE vault_path IS NULL AND status != ? ORDER BY created_at ASC LIMIT ?",
    INBOX_STATUS.DROPPED, limit
  );
  if (!rows.length) return 0;
  const tagMap = await tagsOf(env, "inbox", rows.map((r) => r.id));
  let n = 0;
  for (const row of rows) {
    const path = await tryArchive("inbox", () =>
      archiveInbox(env, row, { tags: tagMap.get(row.id) || [] }));
    if (!path) continue;
    await updateRow(env, "inbox", row.id, { vault_path: path });
    n++;
  }
  return n;
}

/**
 * 反链目标的文件名（不含扩展名）。
 *
 * **必须和 vault.js 里 createFile 的命名规则一致**，否则写出来的 `[[...]]` 会指向
 * 一个不存在的文件——Obsidian 不报错，只是显示成灰色空链接，翻到才发现。
 * 这也是为什么两处都用 `safeName` 而不是各自截字符串。
 */
function vaultBase(title, createdAt) {
  if (!title) return "";
  const date = new Date((createdAt || 0) * 1000).toISOString().slice(0, 10);
  return `${date}-${safeName(title)}`;
}
