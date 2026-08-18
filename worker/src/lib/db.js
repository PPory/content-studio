// D1 数据访问层。取代原来的 lib/notion.js。
//
// **这里不是一个通用 ORM。** 调用方只有 7 个、查询集合是固定的，写具体函数比写查询
// 构造器清晰得多——看函数名就知道它读哪张表、按什么条件。需要新查询就加一个新函数，
// 不要为了「更通用」把 where 条件做成参数拼装。
//
// 和 notion.js 的关键差别，改代码前先建立预期：
//
//  * **没有属性读写辅助。** 原来那二十来个 plainTitle / selectName / toStatus 全部消失，
//    SELECT 回来的行就是普通对象，`row.title` 直接用。
//  * **幂等靠约束不靠正文。** task_key 是 UNIQUE 列，`upsertByTaskKey` 命中即复用；
//    没有对应业务行的副作用（写通知之类）用 task_log 表。原来那套「把系统任务标识
//    写进页面正文、下次读回来查字符串」连同它对内容的污染一起没了。
//  * **多对多是关联表。** 不再有 relation 的 No limit 陷阱，也不再需要「写一边等另一边同步」。

import { EVIDENCE_MATERIAL_TYPES } from "./integrity.js";

// ---------------------------------------------------------------------------
// 基础设施
// ---------------------------------------------------------------------------

export function now() {
  return Math.floor(Date.now() / 1000);
}

const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32，去掉了 ILOU

/**
 * ULID：48 位毫秒时间戳 + 80 位随机。
 * 用它而不是 UUID 是因为**字典序即时间序**——列表按 id 排就是按创建时间排，
 * 不需要额外索引。从 Notion 迁过来的行沿用原 UUID，两种格式在 TEXT 主键里共存。
 */
export function newId() {
  let ts = Date.now();
  const time = new Array(10);
  for (let i = 9; i >= 0; i--) {
    time[i] = ULID_CHARS[ts % 32];
    ts = Math.floor(ts / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const rand = Array.from(bytes, (b) => ULID_CHARS[b % 32]).join("");
  return time.join("") + rand;
}

const db = (env) => env.DB;

async function all(env, sql, ...params) {
  const { results } = await db(env).prepare(sql).bind(...params).all();
  return results || [];
}

async function first(env, sql, ...params) {
  return (await db(env).prepare(sql).bind(...params).first()) || null;
}

async function run(env, sql, ...params) {
  return db(env).prepare(sql).bind(...params).run();
}

/**
 * 一次往返执行多条语句。**批量写一定要走这里**——D1 免费版每次 Worker 调用限 50 条
 * 查询，循环 INSERT 六张素材卡就是六条，batch 只算一次往返。
 */
async function batch(env, statements) {
  if (!statements.length) return [];
  return db(env).batch(statements);
}

const stmt = (env, sql, ...params) => db(env).prepare(sql).bind(...params);

// ---------------------------------------------------------------------------
// 标签
// ---------------------------------------------------------------------------

/**
 * 覆盖式写标签。先 upsert 到 tags 再重建关联——名字相同就复用同一个 tag_id，
 * 这正是拆表要的效果：`prompt/tags.md` 那套词表统一在这里落地，不会再出现
 * 「AI」「人工智能」各自成行还互相不认识的碎片。
 */
export async function setTags(env, kind, entityId, names = []) {
  const table = kind === "material" ? "material_tags" : "inbox_tags";
  const column = kind === "material" ? "material_id" : "inbox_id";
  const clean = [...new Set(names.map((n) => String(n || "").trim()).filter(Boolean))];

  const ops = [stmt(env, `DELETE FROM ${table} WHERE ${column} = ?`, entityId)];
  if (clean.length) {
    // 每个标签一条 upsert，但关联只用**一条** INSERT…SELECT 全部挂上。
    // 写成每标签两条的话，初筛一轮 6 张卡 × 3 个标签就是 40 多条语句，
    // 直接顶到 D1 免费版「每次 Worker 调用 50 条查询」的上限。
    for (const name of clean) ops.push(stmt(env, "INSERT OR IGNORE INTO tags (name) VALUES (?)", name));
    const holes = clean.map(() => "?").join(",");
    ops.push(stmt(
      env,
      `INSERT OR IGNORE INTO ${table} (${column}, tag_id)
       SELECT ?, id FROM tags WHERE name IN (${holes})`,
      entityId, ...clean
    ));
  }
  await batch(env, ops);
  return clean;
}

// 一次取回多个实体的标签，避免 N+1。返回 Map<entityId, string[]>
export async function tagsOf(env, kind, ids = []) {
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const table = kind === "material" ? "material_tags" : "inbox_tags";
  const column = kind === "material" ? "material_id" : "inbox_id";
  const holes = ids.map(() => "?").join(",");
  const rows = await all(
    env,
    `SELECT t.${column} AS eid, tags.name AS name
       FROM ${table} t JOIN tags ON tags.id = t.tag_id
      WHERE t.${column} IN (${holes})`,
    ...ids
  );
  for (const r of rows) map.get(r.eid)?.push(r.name);
  return map;
}

// ---------------------------------------------------------------------------
// 幂等
// ---------------------------------------------------------------------------

/**
 * 按 task_key upsert 一行业务数据。
 *
 * 语义和原来的 upsertPageByTaskKey 一致，但实现完全不同：那边要先查一次「有没有这个
 * 任务标识」再决定建还是改（两次网络往返，且两次之间有并发窗口）；这里 task_key 是
 * UNIQUE 列，冲突由数据库自己顶住。
 *
 * `preserve` 里的列在命中已有行时不覆盖——保护你手改过的字段不被重跑盖回去。
 * @returns {{id:string, created:boolean}}
 */
export async function upsertByTaskKey(env, table, taskKey, fields, { preserve = [] } = {}) {
  const existing = await first(env, `SELECT id FROM ${table} WHERE task_key = ?`, taskKey);
  const ts = now();
  if (existing) {
    const updatable = Object.keys(fields).filter((k) => !preserve.includes(k));
    if (updatable.length) {
      const sets = updatable.map((k) => `${k} = ?`).join(", ");
      await run(
        env,
        `UPDATE ${table} SET ${sets}, updated_at = ? WHERE id = ?`,
        ...updatable.map((k) => fields[k]), ts, existing.id
      );
    }
    return { id: existing.id, created: false };
  }
  const id = newId();
  const cols = Object.keys(fields);
  const sql = `INSERT INTO ${table} (id, task_key, ${cols.join(", ")}, created_at, updated_at)
               VALUES (?, ?, ${cols.map(() => "?").join(", ")}, ?, ?)`;
  await run(env, sql, id, taskKey, ...cols.map((k) => fields[k]), ts, ts);
  return { id, created: true };
}

/**
 * 没有对应业务行的副作用做过没有（写回执、发通知这类）。
 * 返回 true 表示这次是第一次做，调用方应当执行；false 表示已经做过，跳过。
 */
export async function claimTask(env, taskKey, kind, entityId = null) {
  const res = await run(
    env,
    "INSERT OR IGNORE INTO task_log (task_key, kind, entity_id, done_at) VALUES (?, ?, ?, ?)",
    taskKey, kind, entityId, now()
  );
  return (res.meta?.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// 通用行操作
// ---------------------------------------------------------------------------

const TABLES = new Set(["inbox", "materials", "topics", "drafts"]);

function assertTable(table) {
  // 表名不能参数化，只能白名单——调用方传进来的字符串直接进 SQL 是注入面
  if (!TABLES.has(table)) throw new Error(`unknown table: ${table}`);
  return table;
}

export async function getRow(env, table, id) {
  return first(env, `SELECT * FROM ${assertTable(table)} WHERE id = ?`, id);
}

export async function updateRow(env, table, id, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return null;
  const sets = cols.map((k) => `${k} = ?`).join(", ");
  await run(
    env,
    `UPDATE ${assertTable(table)} SET ${sets}, updated_at = ? WHERE id = ?`,
    ...cols.map((k) => fields[k]), now(), id
  );
  return getRow(env, table, id);
}

export async function insertRow(env, table, fields, { id = newId() } = {}) {
  const ts = now();
  const cols = Object.keys(fields);
  await run(
    env,
    `INSERT INTO ${assertTable(table)} (id, ${cols.join(", ")}, created_at, updated_at)
     VALUES (?, ${cols.map(() => "?").join(", ")}, ?, ?)`,
    id, ...cols.map((k) => fields[k]), ts, ts
  );
  return id;
}

/**
 * 删除一行。
 *
 * **这是真删除，不是归档。** Notion 时代 `archived:true` 会进废纸篓、30 天内可恢复，
 * 那个兜底没了——D1 删了就是删了。所以调用方（工作台的 /wb/delete）必须在界面上
 * 说实话，不能再写「移到废纸篓」。关联表靠 ON DELETE CASCADE 自己清干净。
 */
export async function deleteRow(env, table, id) {
  const res = await run(env, `DELETE FROM ${assertTable(table)} WHERE id = ?`, id);
  return (res.meta?.changes ?? 0) > 0;
}

/** 按状态取一批行。三个任务的入口都是这个形状：领活儿 = 按状态取最老的 N 条。 */
export async function listByStatus(env, table, status, limit = 20) {
  return all(
    env,
    `SELECT * FROM ${assertTable(table)} WHERE status = ? ORDER BY created_at ASC LIMIT ?`,
    status, limit
  );
}

/**
 * 工作台所有列表的排序：**最近动过的在最前**。
 *
 * ⚠️ **判据是 `updated_at`，绝不能是 `id`。** 这一条踩过：原来三处都写 `ORDER BY id DESC`，
 * 注释里还写着「ULID 字典序即时间序」——那句话对**纯 ULID** 成立，但这个库的 id
 * **有两种格式**（迁移过来的是小写 UUID `3b91…`，新建的是 ULID `01M0…`）。
 * 按 ASCII 比 `01M…` 永远小于 `3…`，于是**所有新建的行被整体压到所有迁移行后面**：
 * 8-16 写的那篇排在 7-05 那篇的后面。**不报错、不白屏，只是顺序不对**，
 * 而顺序不对这件事，看的人只会以为「东西没进来」。
 *
 * ⚠️ **为什么是 `updated_at` 而不是 `created_at`：卡片上显示的就是它**
 *（`decorate` 里的 `editedAt`，`/wb/*` 压根不回 `createdAt`）。按创建时间排的话，
 * 七月建、八月改过的那条会显示着「08-14」却躺在显示「07-08」的那条下面——
 * **屏幕上的日期上下乱跳，看着就是排序坏了**。要改回按创建时间排，
 * 就必须同时让卡片改显示创建时间，两件事得一起做，别只改一半。
 *
 * 加 `id` 做次级排序不是装饰：时间戳是秒，一轮初筛能在同一秒写进 6 张素材卡，
 * 并列时顺序不稳定的话，**翻页会漏行也会重复**（游标指向的那行下一次查询排到了别处）。
 */
export const LIST_ORDER = "ORDER BY updated_at DESC, id DESC";

/**
 * 游标 = 上一页最后一行的 `(updated_at, id)`，和 `LIST_ORDER` 必须是同一对列。
 *
 * **不用 SQLite 的行值比较 `(a,b) < (?,?)`**，摊开成等价的 OR 式子：D1 底下的 SQLite
 * 版本不由我们定，而这条查询错了的表现是「翻页少几行」，同样是不报错的那一类。
 *
 * ⚠️ **认不出的游标当成没有游标**（回第一页），不抛错。旧格式是裸 id，
 * 部署那一刻正开着页面的人点「加载更多」会拿它来问——那时候宁可让他看到重复几条，
 * 也不要甩一个 500。刷新一次就好了。
 *
 * ⚠️ **按 `updated_at` 排的代价写在这儿**：翻页期间某一行被改了，它会跳到第一页，
 * 于是这一页可能少一行。这是「最近动过的在最前」这个选择自带的，不是 bug——
 * 而且只影响正在翻的那一刻，刷新就对了。要根治得换成不会变的列（如 `created_at`）。
 */
export const encodeCursor = (row) => (row ? `${row.updated_at}.${row.id}` : null);

export function cursorClause(cursor) {
  const m = /^(\d+)\.(.+)$/.exec(String(cursor || ""));
  if (!m) return { sql: "", params: [] };
  const at = Number(m[1]);
  return { sql: "(updated_at < ? OR (updated_at = ? AND id < ?))", params: [at, at, m[2]] };
}

/** 工作台列表用的分页。排序和游标规则见上面两条，**别在调用方另写一份**。 */
export async function listPage(env, table, { status = "", cursor = "", pageSize = 25 } = {}) {
  assertTable(table);
  const size = Math.min(Math.max(pageSize, 1), 100);
  const where = [];
  const params = [];
  if (status) { where.push("status = ?"); params.push(status); }
  const cur = cursorClause(cursor);
  if (cur.sql) { where.push(cur.sql); params.push(...cur.params); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await all(
    env,
    `SELECT * FROM ${table} ${clause} ${LIST_ORDER} LIMIT ?`,
    ...params, size + 1
  );
  const hasMore = rows.length > size;
  const page = hasMore ? rows.slice(0, size) : rows;
  return { results: page, nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null };
}

/** 一批行改同一个状态。原来是逐条 PATCH，20 条灵感就是 20 次网络往返。 */
export async function updateStatusMany(env, table, ids, status) {
  if (!ids.length) return 0;
  const holes = ids.map(() => "?").join(",");
  const res = await run(
    env,
    `UPDATE ${assertTable(table)} SET status = ?, updated_at = ? WHERE id IN (${holes})`,
    status, now(), ...ids
  );
  return res.meta?.changes ?? 0;
}

export async function countByStatus(env, table, status) {
  const row = await first(
    env,
    `SELECT COUNT(*) AS n FROM ${assertTable(table)} WHERE status = ?`,
    status
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// 关联
// ---------------------------------------------------------------------------

export async function linkTopicMaterials(env, topicId, materialIds = []) {
  const ops = materialIds.map((mid) => stmt(
    env,
    "INSERT OR IGNORE INTO topic_materials (topic_id, material_id) VALUES (?, ?)",
    topicId, mid
  ));
  await batch(env, ops);
}

export async function linkTopicInbox(env, topicId, inboxIds = []) {
  const ops = inboxIds.map((iid) => stmt(
    env,
    "INSERT OR IGNORE INTO topic_inbox (topic_id, inbox_id) VALUES (?, ?)",
    topicId, iid
  ));
  await batch(env, ops);
}

/** 选题的关联素材（成稿的主料）。一次 JOIN 取回，不再是「查关联再逐个取素材」。 */
export async function materialsOfTopic(env, topicId) {
  return all(
    env,
    `SELECT m.* FROM materials m
       JOIN topic_materials tm ON tm.material_id = m.id
      WHERE tm.topic_id = ?
      ORDER BY m.created_at ASC`,
    topicId
  );
}

/**
 * 一篇稿子的真实性证据集——**闸门用的证据只能从这里取**（`lib/integrity.js` 的
 * `assertGrounded*` / `auditPersonalNarrative` 全部配它用）。
 *
 * ⚠️ 这里有过一个只在阅读时才暴露的 bug：成稿时拿「选题关联素材 + 按标签检索来的补充
 * 素材」当证据，工作台打开稿件重新审计却只拿「选题关联素材」。补充素材恰恰是
 * `searchSupplementary` 里**明确排除了选题关联素材**的那一批，于是一篇合法引用了补充
 * 素材的稿子，写的时候放行、打开就报「有内容缺少真实素材支撑」、保存还会被拒——
 * 同一条规则、两份证据集，两边代码单看都对。
 *
 * 现在的口径是**整库的个人经历素材**，理由是这条规则问的是「这件事到底发生过没有」，
 * 而答案在素材库里，跟它挂在哪个选题下无关。放宽候选并不等于放水：
 * `isPersonalClaimGrounded` 要求二字组重合 ≥ 4 且覆盖该句一半以上，一条无关经历够不着
 * 这个门槛。**不要为了省一次查询把范围缩回选题**，那正是上面那个 bug。
 *
 * `extra` 给本次运行现有、但库里还没有的证据用（Telegram `/推` 的原文、访谈稿），
 * 它们是同一条规则的额外输入，不是另一套规则。
 */
export async function personalEvidence(env, extra = []) {
  const holes = EVIDENCE_MATERIAL_TYPES.map(() => "?").join(",");
  const rows = await all(
    env,
    `SELECT id, title, type, content FROM materials WHERE type IN (${holes}) ORDER BY created_at ASC`,
    ...EVIDENCE_MATERIAL_TYPES
  );
  return [
    ...rows.map((r) => ({ id: r.id, title: r.title, type: r.type, note: r.content })),
    ...extra,
  ];
}

export async function inboxOfTopic(env, topicId) {
  return all(
    env,
    `SELECT i.* FROM inbox i
       JOIN topic_inbox ti ON ti.inbox_id = i.id
      WHERE ti.topic_id = ?`,
    topicId
  );
}

export async function draftsOfTopic(env, topicId) {
  return all(env, "SELECT * FROM drafts WHERE topic_id = ? ORDER BY created_at ASC", topicId);
}

export async function materialsOfInbox(env, inboxIds = []) {
  if (!inboxIds.length) return [];
  const holes = inboxIds.map(() => "?").join(",");
  return all(env, `SELECT * FROM materials WHERE inbox_id IN (${holes})`, ...inboxIds);
}

// ---------------------------------------------------------------------------
// 检索
// ---------------------------------------------------------------------------

/**
 * 成稿的补充料检索。
 *
 * 打分规则**和原来的 fetchSupplementary 逐字一致**：标签与核心素材重合 ×2，
 * 素材自身的标签出现在选题标题/观点里 ×1。变的只是执行位置——原来要把同标签的
 * 100 条候选整批拉回 Worker 再在内存里打分，现在一条 SQL 连排序带截断一次做完。
 *
 * 没有换成全文检索是有意的，理由见 schema.sql 末尾：trigram 对两字中文词失效，
 * 而「用标签词表去匹配选题文本」这个原设计恰好绕开了中文分词。`instr(?, t.name)`
 * 就是原来 `kwText.includes(t)` 的 SQL 版本。
 *
 * 排除项有两类：已经是主料的（coreIds），和不该进稿的（待核验的逐字素材——
 * 与 isMaterialEligibleForDraft 同一套规则，那边是给 JS 侧用的）。
 */
export async function searchSupplementary(env, { coreIds = [], tags = [], text = "", limit = 12 }) {
  if (!tags.length) return [];

  const holes = tags.map(() => "?").join(",");
  const params = [...tags, String(text || "")];
  const excludeClause = coreIds.length
    ? `AND m.id NOT IN (${coreIds.map(() => "?").join(",")})`
    : "";
  if (coreIds.length) params.push(...coreIds);
  params.push(limit);

  // 打分列不能直接在 WHERE 里引用，套一层子查询再过滤
  return all(
    env,
    `SELECT * FROM (
       SELECT m.*,
              (SELECT COUNT(*) * 2 FROM material_tags mt
                 JOIN tags ON tags.id = mt.tag_id
                WHERE mt.material_id = m.id AND tags.name IN (${holes}))
            + (SELECT COUNT(*) FROM material_tags mt
                 JOIN tags ON tags.id = mt.tag_id
                WHERE mt.material_id = m.id AND instr(?, tags.name) > 0) AS score
         FROM materials m
        WHERE m.verification != '待核验'
          ${excludeClause}
     )
      WHERE score > 0
      ORDER BY score DESC, created_at DESC
      LIMIT ?`,
    ...params
  );
}

/** 按标题模糊找选题（Telegram /成稿 的关键词匹配、#token 消歧都用它）。 */
export async function findTopicByTitle(env, keyword) {
  return first(
    env,
    "SELECT * FROM topics WHERE title LIKE ? ORDER BY created_at DESC LIMIT 1",
    `%${keyword}%`
  );
}

// ---------------------------------------------------------------------------
// 评论
// ---------------------------------------------------------------------------

export async function addComment(env, entity, entityId, text) {
  const id = newId();
  await run(
    env,
    "INSERT INTO comments (id, entity, entity_id, text, created_at) VALUES (?, ?, ?, ?, ?)",
    id, entity, entityId, text, now()
  );
  return id;
}

export async function listComments(env, entity, entityId) {
  const rows = await all(
    env,
    "SELECT id, text, created_at FROM comments WHERE entity = ? AND entity_id = ? ORDER BY created_at ASC",
    entity, entityId
  );
  return rows.map((r) => ({ id: r.id, text: r.text, createdAt: r.created_at }));
}

export { all, first, run, batch, stmt };
