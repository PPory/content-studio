// creator-workbench 的读写端点（/wb/*）。工作台的本地服务是唯一调用方，浏览器不直连。
//
// 鉴权用独立的 WORKBENCH_KEY，不复用 TELEGRAM_WEBHOOK_SECRET：工作台的 key 存在本机
// .env 里、被更多进程读到，泄露时要能单独轮换而不影响 Telegram webhook。
//
// **对外契约在换库时一个字都没改**：返回的仍是压平后的扁平字段，字段名、结构、
// 分页游标的语义全部照旧。工作台那边不需要知道底下从 Notion 换成了 D1——这正是当初
// 「不返回原始 page 对象」那个决定的回报，字段名映射这条规则始终只有这一份。

import {
  getRow, updateRow, insertRow, deleteRow as dbDeleteRow, listPage, upsertByTaskKey,
  LIST_ORDER, cursorClause, encodeCursor,
  materialsOfTopic, inboxOfTopic, draftsOfTopic as dbDraftsOfTopic, personalEvidence,
  tagsOf, setTags, addComment, listComments as dbListComments,
  all, first, now, newId, batch, stmt,
} from "./lib/db.js";
import { TOPIC_STATUS, DRAFT_STATUS, VERIFICATION } from "./lib/values.js";
import { pipelineCounts } from "./lib/status.js";
import { storeTypedMaterial, storeAutoMaterial, storeInboxEntry, resolveStoreCmd, archiveMaterialToVault } from "./lib/store.js";
import { autoTag } from "./lib/tagging.js";
import { chat, chatJson } from "./lib/llm.js";
import { EXPLAIN_PROMPT, PICK_MATERIALS_PROMPT, MATERIAL_DRAFT_PROMPT } from "./prompts.js";
import {
  assertGroundedGeneratedText,
  auditPersonalNarrative,
  isMaterialEligibleForDraft,
  stableTaskKey,
  topicStatusFromDrafts,
} from "./lib/integrity.js";
import { citeText } from "./lib/cite.js";
import { normalizeCreationRequest, keepRealPicks } from "./lib/creation.js";
import { MODEL_TASKS, availableModels, readModelMap, writeModelMap } from "./lib/models.js";
import {
  applyCollectionOrganize,
  collectionSummary,
  isReviewStatus,
  previewCollectionOrganize,
  previewKnowledgeCard,
  refreshCollectionSnapshot,
  storeCollection,
} from "./lib/collections.js";

/**
 * id 合法性。**两种格式都要认**：从 Notion 迁过来的行是 32–36 位 UUID，
 * 新建的行是 26 位 ULID。原来只校验 UUID，照搬过来的话新建的东西一律「id 不合法」。
 */
const ID_RE = /^[0-9A-Za-z-]{20,40}$/;
const isId = (v) => ID_RE.test(String(v || ""));

const iso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);
const csv = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

// 四个视图：表名、状态列、行 → 扁平对象的映射。
// `map` 只做纯字段搬运；标签和关联 id 由 enrich 批量补，避免每行一次查询。
const VIEWS = {
  collections: {
    table: "inbox",
    hasStatus: true,
    map: (r) => ({
      id: r.id,
      title: r.title,
      status: r.review_status,
      reviewStatus: r.review_status,
      type: r.kind,
      note: r.save_note,
      selection: r.selection,
      tags: [],
      link: r.link,
      source: r.source,
      snapshotStatus: r.snapshot_status,
      snapshotError: r.snapshot_error,
      snapshotAt: iso(r.snapshot_at),
      processingMode: r.processing_mode,
      materialIds: [],
      topicIds: [],
    }),
  },
  inbox: {
    table: "inbox",
    hasStatus: true,
    map: (r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      type: r.kind,
      value: r.value_judgment,
      note: r.verdict,
      tags: [],
      link: r.link,
      source: r.source,
    }),
  },
  materials: {
    table: "materials",
    hasStatus: false, // 素材库没有状态字段
    map: (r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      note: r.content,
      tags: [],
      link: r.source_url,
      verificationStatus: r.verification,
      verificationNote: r.verification_note,
      taskKey: r.task_key || "",
      inspirationIds: r.inbox_id ? [r.inbox_id] : [],
      topicIds: [],
      draftIds: r.draft_id ? [r.draft_id] : [],
      feedbackTypes: csv(r.feedback_types),
      performanceBasis: r.performance_basis,
    }),
  },
  topics: {
    table: "topics",
    hasStatus: true,
    map: (r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      note: r.viewpoint,
      audience: r.audience,
      // 契约仍是数组：工作台按数组渲染平台标签。库里存单值是因为成稿只写主平台。
      platforms: r.platform ? [r.platform] : [],
      draftIds: [],
      // 这条选题**是从哪儿来的**。工作台的热点转化链（未处理 → 已收藏 → 已形成选题
      // → 已成稿 → 已发布）靠这两条反查：拿热点 URL 在灵感/素材里找到那一条，
      // 再用它的 id 在这里命中选题。
      inspirationIds: [],
      materialIds: [],
      taskKey: r.task_key || "",
    }),
  },
  drafts: {
    table: "drafts",
    hasStatus: true,
    map: (r) => ({
      id: r.id,
      title: r.headline,
      status: r.status,
      platform: r.platform,
      note: r.summary,
      topicIds: r.topic_id ? [r.topic_id] : [],
      taskKey: r.task_key || "",
      publishedUrl: r.published_url,
      publishedAt: r.published_at,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      collects: r.collects,
      shares: r.shares,
      performanceSummary: r.performance_summary,
      feedbackStatus: r.feedback_status,
    }),
  },
};

/**
 * 批量补齐标签与关联 id。
 *
 * Notion 时代这些是白送的——relation 和 multi_select 就在 page 对象里。D1 里它们
 * 在关联表上，必须另查。**关键是按批查，不是按行查**：25 行的列表如果每行查一次
 * 标签就是 25 次往返，这里固定 1–3 次。
 */
async function enrich(env, viewKey, rows) {
  if (!rows.length) return rows.map((r) => VIEWS[viewKey].map(r));
  const items = rows.map((r) => VIEWS[viewKey].map(r));
  const ids = rows.map((r) => r.id);
  const holes = ids.map(() => "?").join(",");

  if (viewKey === "collections" || viewKey === "inbox" || viewKey === "materials") {
    const kind = viewKey === "materials" ? "material" : "inbox";
    const tagMap = await tagsOf(env, kind, ids);
    for (const item of items) item.tags = tagMap.get(item.id) || [];
  }

  if (viewKey === "collections") {
    const [materials, topics] = await Promise.all([
      all(env, `SELECT id, inbox_id FROM materials WHERE inbox_id IN (${holes})`, ...ids),
      all(env, `SELECT topic_id, inbox_id FROM topic_inbox WHERE inbox_id IN (${holes})`, ...ids),
    ]);
    const materialMap = new Map(ids.map((id) => [id, []]));
    const topicMap = new Map(ids.map((id) => [id, []]));
    for (const row of materials) materialMap.get(row.inbox_id)?.push(row.id);
    for (const row of topics) topicMap.get(row.inbox_id)?.push(row.topic_id);
    for (const item of items) {
      item.materialIds = materialMap.get(item.id) || [];
      item.topicIds = topicMap.get(item.id) || [];
      item.convertedToIdea = rows.find((r) => r.id === item.id)?.processing_mode === "triage";
    }
  }

  if (viewKey === "materials") {
    const links = await all(
      env,
      `SELECT material_id, topic_id FROM topic_materials WHERE material_id IN (${holes})`,
      ...ids
    );
    const byMaterial = new Map(ids.map((id) => [id, []]));
    for (const l of links) byMaterial.get(l.material_id)?.push(l.topic_id);
    for (const item of items) item.topicIds = byMaterial.get(item.id) || [];
  }

  if (viewKey === "topics") {
    const [drafts, insp, mats] = await Promise.all([
      all(env, `SELECT id, topic_id FROM drafts WHERE topic_id IN (${holes})`, ...ids),
      all(env, `SELECT topic_id, inbox_id FROM topic_inbox WHERE topic_id IN (${holes})`, ...ids),
      all(env, `SELECT topic_id, material_id FROM topic_materials WHERE topic_id IN (${holes})`, ...ids),
    ]);
    const group = (list, key, val) => {
      const m = new Map(ids.map((id) => [id, []]));
      for (const row of list) m.get(row[key])?.push(row[val]);
      return m;
    };
    const dMap = group(drafts, "topic_id", "id");
    const iMap = group(insp, "topic_id", "inbox_id");
    const mMap = group(mats, "topic_id", "material_id");
    for (const item of items) {
      item.draftIds = dMap.get(item.id) || [];
      item.inspirationIds = iMap.get(item.id) || [];
      item.materialIds = mMap.get(item.id) || [];
    }
  }

  return items;
}

// 行 → 列表项。editedAt 保持 ISO 串（前端一直按这个格式渲染）。
//
// 迁到 D1 之后这里曾经保留过一个恒为 null 的 `notionUrl`，怕删掉字段前端拿到 undefined。
// 现在工作台那侧「在 Notion 打开」的按钮连同这个字段一起撤了，所以这里也不再回它——
// **一个永远是 null 的字段，比没有这个字段更容易让人以为它有一天会有值。**
function decorate(items, rows) {
  return items.map((item, i) => ({ ...item, editedAt: iso(rows[i].updated_at) }));
}

export async function handleWorkbench(request, env, ctx, url) {
  if (!env.WORKBENCH_KEY) {
    return json({ ok: false, error: "Worker 未配置 WORKBENCH_KEY，执行 npx wrangler secret put WORKBENCH_KEY 后重试" }, 503);
  }
  const key = request.headers.get("X-Workbench-Key") || url.searchParams.get("key");
  if (key !== env.WORKBENCH_KEY) return json({ ok: false, error: "forbidden" }, 403);

  const path = url.pathname.slice("/wb/".length);
  try {
    // 连通性探针：不碰数据库，工作台用它判断「Worker 通不通」
    if (path === "ping") return json({ ok: true, pong: true });

    if (path === "status" && request.method === "GET") {
      const counts = await pipelineCounts(env);
      try {
        return json({ ok: true, counts, collections: await collectionSummary(env), capabilities: { collectionsV1: true }, ts: Date.now() });
      } catch (error) {
        if (/no such column|no such table/i.test(String(error?.message || ""))) {
          return json({ ok: true, counts, collections: null, capabilities: { collectionsV1: false }, migrationHint: "先执行 D1 collections_v1 迁移并部署 Worker", ts: Date.now() });
        }
        throw error;
      }
    }

    // 这几处必须 `return await`。直接 `return 异步函数()` 的话，Promise 被原样返回出去，
    // try/catch 早就走完了——rejection 逃出这个 catch，变成 Cloudflare 的 1101 裸异常页
    // （非 JSON，客户端只能看到「HTTP 500」，真实报错全丢）。
    const listMatch = path.match(/^list\/([a-z]+)$/);
    if (listMatch && request.method === "GET") return await listRows(env, url, listMatch[1]);

    const searchMatch = path.match(/^search\/([a-z]+)$/);
    if (searchMatch && request.method === "GET") return await searchRows(env, url, searchMatch[1]);

    const pageMatch = path.match(/^page\/([0-9A-Za-z-]{20,40})$/);
    if (pageMatch && request.method === "GET") return await pageDetail(env, pageMatch[1], url.searchParams.get("view"));

    if (path === "intake" && request.method === "POST") return await intake(env, ctx, await request.json());

    const snapshotMatch = path.match(/^collections\/([0-9A-Za-z-]{20,40})\/snapshot$/);
    if (snapshotMatch && request.method === "POST") return json(await refreshCollectionSnapshot(env, snapshotMatch[1]));

    if (path === "collections/organize/preview" && request.method === "POST") return json(await previewCollectionOrganize(env, await request.json()));
    if (path === "collections/organize/apply" && request.method === "POST") return json(await applyCollectionOrganize(env, await request.json()));
    if (path === "knowledge/preview" && request.method === "POST") return json(await previewKnowledgeCard(env, await request.json()));

    if (path === "create" && request.method === "POST") return await createContent(env, await request.json());

    if (path === "comment" && request.method === "POST") {
      const { pageId, text, view } = await request.json();
      if (!isId(pageId) || !String(text || "").trim()) return json({ ok: false, error: "pageId 和 text 都不能为空" }, 400);
      await addComment(env, VIEWS[view] ? VIEWS[view].table : "drafts", pageId, String(text));
      return json({ ok: true });
    }

    const commentsMatch = path.match(/^comments\/([0-9A-Za-z-]{20,40})$/);
    if (commentsMatch && request.method === "GET") {
      const view = url.searchParams.get("view");
      const entity = VIEWS[view] ? VIEWS[view].table : "drafts";
      return json({ ok: true, comments: await dbListComments(env, entity, commentsMatch[1]) });
    }

    if (path === "explain" && request.method === "POST") return await explain(env, await request.json());

    if (path === "pick/materials" && request.method === "POST") return await pickMaterials(env, await request.json());

    if (path === "draft/material" && request.method === "POST") return await draftFromMaterials(env, await request.json());

    if (path === "cite" && request.method === "POST") return await citeDraft(env, await request.json());

    // 每个环节用哪个模型。**真源在库里**（`lib/models.js`），工作台的设置面板整个从这儿渲染
    if (path === "models" && request.method === "GET") {
      const [values, available] = await Promise.all([readModelMap(env), availableModels(env)]);
      return json({ ok: true, tasks: MODEL_TASKS, values, fallback: env.LLM_MODEL || "", available });
    }
    if (path === "models" && request.method === "POST") {
      const body = await request.json();
      return json({ ok: true, values: await writeModelMap(env, body?.values || {}) });
    }

    if (path === "update" && request.method === "POST") return await updateFields(env, await request.json());

    if (path === "content" && request.method === "POST") return await replaceContent(env, await request.json());

    if (path === "publish" && request.method === "POST") return await publishDraft(env, await request.json());

    if (path === "delete" && request.method === "POST") return await deleteRowEndpoint(env, await request.json());

    if (path === "reconcile" && request.method === "POST") {
      const { topicId } = await request.json();
      return json({ ok: true, ...(await reconcileTopicDraftState(env, String(topicId || ""))) });
    }

    const draftsOfMatch = path.match(/^drafts-of\/([0-9A-Za-z-]{20,40})$/);
    if (draftsOfMatch && request.method === "GET") return await draftsOfTopicEndpoint(env, draftsOfMatch[1]);

    return json({ ok: false, error: `unknown endpoint: ${path}` }, 404);
  } catch (e) {
    console.error(`workbench ${path} failed:`, e.message);
    /**
     * ⚠️ **「表不存在」要直接给出那条命令。**
     *
     * `schema.sql` 加了新表、但线上库还没跑过迁移时，用户在工作台上看到的是
     * `D1_ERROR: no such table: settings` 加一句「回终端看 npm run dev 的日志」——
     * 那句通用兜底在这儿是**指错了方向**（问题不在本机日志里），而真正的下一步只有一条命令。
     * 按本项目的错误契约：报错要带下一步动作，而不是让人自己去猜是哪一步没做。
     */
    const missing = /no such table:\s*(\w+)/i.exec(e.message);
    // 留够 800 字：SQLite 的约束报错会指明是哪个 CHECK 挂了，那正是排查
    // 「状态值对不上」时唯一有用的信息。截到 300 字刚好把它切掉。
    return json({
      ok: false,
      error: missing ? `流水线的库里还没有 ${missing[1]} 这张表` : e.message.slice(0, 800),
      hint: missing
        ? "在 content-studio/worker 里跑一次：npx wrangler d1 execute content-pipeline --remote --file=schema.sql（建表语句都是 IF NOT EXISTS，重跑安全）"
        : undefined,
    }, 500);
  }
}

/** 灵感库的状态分组：工作台按「处理中/已收纳/需处理」筛，不是按单个状态值。 */
const INBOX_GROUPS = {
  处理中: ["待初筛", "待选题"],
  已收纳: ["已选题", "存档备用"],
  需处理: ["初筛失败/需人工"],
};
const COLLECTION_GROUPS = { 待整理: ["pending"], 已收藏: ["kept"], 已归档: ["archived"] };

function statusValues(viewKey, state) {
  if (!state) return [];
  if (viewKey === "inbox" && INBOX_GROUPS[state]) return INBOX_GROUPS[state];
  if (viewKey === "collections" && COLLECTION_GROUPS[state]) return COLLECTION_GROUPS[state];
  return [state];
}

async function listRows(env, url, viewKey) {
  const view = VIEWS[viewKey];
  if (!view) return json({ ok: false, error: `unknown list: ${viewKey}（可选 ${Object.keys(VIEWS).join("/")}）` }, 404);

  const state = url.searchParams.get("state");
  const values = view.hasStatus ? statusValues(viewKey, state) : [];
  const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize")) || 25, 1), 100);
  const cursor = url.searchParams.get("cursor") || "";

  if (viewKey === "collections") {
    const params = [];
    let clause = "WHERE capture_origin = 'collection'";
    if (values.length) { clause += " AND review_status = ?"; params.push(values[0]); }
    const cur = cursorClause(cursor);
    if (cur.sql) { clause += ` AND ${cur.sql}`; params.push(...cur.params); }
    const fetched = await all(env, `SELECT * FROM inbox ${clause} ${LIST_ORDER} LIMIT ?`, ...params, pageSize + 1);
    const hasMore = fetched.length > pageSize;
    const rows = hasMore ? fetched.slice(0, pageSize) : fetched;
    const nextCursor = hasMore ? encodeCursor(rows[rows.length - 1]) : null;
    return json({ ok: true, items: decorate(await enrich(env, viewKey, rows), rows), nextCursor });
  }

  if (viewKey === "inbox") {
    const params = [];
    let clause = "WHERE processing_mode = 'triage'";
    if (values.length) {
      clause += ` AND status IN (${values.map(() => "?").join(",")})`;
      params.push(...values);
    }
    const cur = cursorClause(cursor);
    if (cur.sql) { clause += ` AND ${cur.sql}`; params.push(...cur.params); }
    const fetched = await all(env, `SELECT * FROM inbox ${clause} ${LIST_ORDER} LIMIT ?`, ...params, pageSize + 1);
    const hasMore = fetched.length > pageSize;
    const rows = hasMore ? fetched.slice(0, pageSize) : fetched;
    const nextCursor = hasMore ? encodeCursor(rows[rows.length - 1]) : null;
    return json({ ok: true, items: decorate(await enrich(env, viewKey, rows), rows), nextCursor });
  }

  let rows, nextCursor;
  if (values.length > 1) {
    // 分组筛选（灵感库的「处理中」等）：listPage 只支持单值，多值走一条 IN 查询。
    // ⚠️ 排序和游标**必须复用 db.js 那一份**（`LIST_ORDER` / `cursorClause` / `encodeCursor`）。
    // 这三处曾经各写各的 `ORDER BY id DESC`，而 id 有 UUID / ULID 两种格式、字典序不是时间序，
    // 于是新建的行整体沉底。抄第二份的话，改对了一处、另外两处照旧，**而且不报错**。
    const holes = values.map(() => "?").join(",");
    const params = [...values];
    let clause = `WHERE status IN (${holes})`;
    const cur = cursorClause(cursor);
    if (cur.sql) { clause += ` AND ${cur.sql}`; params.push(...cur.params); }
    const fetched = await all(
      env,
      `SELECT * FROM ${view.table} ${clause} ${LIST_ORDER} LIMIT ?`,
      ...params, pageSize + 1
    );
    const hasMore = fetched.length > pageSize;
    rows = hasMore ? fetched.slice(0, pageSize) : fetched;
    nextCursor = hasMore ? encodeCursor(rows[rows.length - 1]) : null;
  } else {
    ({ results: rows, nextCursor } = await listPage(env, view.table, {
      status: values[0] || "", cursor, pageSize,
    }));
  }

  return json({ ok: true, items: decorate(await enrich(env, viewKey, rows), rows), nextCursor });
}

/**
 * 全库搜索。
 *
 * 原来是把整个库分页拉回 Worker 再在内存里 `includes`——库大了就是几十次
 * Notion 往返。现在交给 SQL：LIKE 在几千行上是毫秒级，而且只回符合条件的行。
 * 不用 FTS 的原因见 schema.sql 末尾（trigram 对两字中文词失效）。
 */
async function searchRows(env, url, viewKey) {
  const view = VIEWS[viewKey];
  if (!view) return json({ ok: false, error: `unknown search: ${viewKey}` }, 404);
  const q = String(url.searchParams.get("q") || "").trim();
  if (!q) return json({ ok: true, items: [] });

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);
  const values = view.hasStatus ? statusValues(viewKey, url.searchParams.get("state")) : [];
  // 每张表可搜的列不同，这里写死——让调用方指定列名等于把表结构暴露出去
  const COLUMNS = {
    collections: ["title", "body", "selection", "save_note", "source", "link"],
    inbox: ["title", "body", "verdict", "source", "card_markdown"],
    materials: ["title", "content", "verification_note", "performance_basis"],
    topics: ["title", "viewpoint", "audience", "notes", "draft_note"],
    drafts: ["headline", "summary", "body", "performance_summary"],
  }[viewKey];

  const like = `%${q}%`;
  const params = COLUMNS.map(() => like);
  let clause = `WHERE (${COLUMNS.map((c) => `${c} LIKE ?`).join(" OR ")})`;
  if (viewKey === "collections") clause += " AND capture_origin = 'collection'";
  if (viewKey === "inbox") clause += " AND processing_mode = 'triage'";
  if (values.length) {
    const statusColumn = viewKey === "collections" ? "review_status" : "status";
    clause += ` AND ${statusColumn} IN (${values.map(() => "?").join(",")})`;
    params.push(...values);
  }
  // 搜索结果也是最新的在前，和列表同一份规则——两边顺序不一样的话，
  // 搜一下再清掉搜索框，同一批东西会重新洗一次牌。
  const rows = await all(
    env,
    `SELECT * FROM ${view.table} ${clause} ${LIST_ORDER} LIMIT ?`,
    ...params, limit
  );

  const items = decorate(await enrich(env, viewKey, rows), rows);
  return json({ ok: true, items, nextCursor: null, total: items.length, fullLibrary: true });
}

async function pageDetail(env, id, viewKey) {
  const view = VIEWS[viewKey];
  const table = view ? view.table : null;
  // 正文就在行上。原来这里要多打一次 /blocks/{id}/children 并把块转回 Markdown，
  // 现在读行时已经带回来了——正文本来就是 Markdown，中间那趟转换是被 Notion 逼的。
  const row = table ? await getRow(env, table, id) : null;
  if (!row) return json({ ok: false, error: "not found" }, 404);

  const text = table === "drafts" ? row.body
    : viewKey === "collections" ? [row.selection, row.body].filter(Boolean).join("\n\n---\n\n")
    : table === "inbox" ? [row.body, row.card_markdown].filter(Boolean).join("\n\n---\n\n")
    : table === "topics" ? [row.notes, row.draft_note].filter(Boolean).join("\n\n---\n\n")
    : row.content || "";

  const detail = { ok: true, id, text, format: "markdown" };
  detail.meta = (await enrich(env, viewKey, [row]))[0];
  detail.meta.editedAt = iso(row.updated_at);

  if (viewKey === "materials") {
    const [inspirations, topics] = await Promise.all([
      row.inbox_id ? titlesOf(env, "inbox", [row.inbox_id]) : [],
      titlesOf(env, "topics", detail.meta.topicIds),
    ]);
    detail.meta.inspirations = inspirations;
    detail.meta.topics = topics;
  }

  if (viewKey === "drafts") {
    const audit = auditPersonalNarrative(text, await personalEvidence(env));
    if (audit.ungrounded.length) {
      detail.warning = {
        title: "有内容缺少真实素材支撑",
        detail: "发布前请改成真实经历、删除，或先补录对应的个人经历。",
        issues: audit.ungrounded,
        action: "edit_or_capture",
      };
    }
  }
  return json(detail);
}

// 一次取回一批 id 的标题，取代原来「逐个 getPage 再挖 title」
async function titlesOf(env, table, ids = []) {
  if (!ids.length) return [];
  const capped = ids.slice(0, 20);
  const holes = capped.map(() => "?").join(",");
  const col = table === "drafts" ? "headline" : "title";
  const rows = await all(env, `SELECT id, ${col} AS title FROM ${table} WHERE id IN (${holes})`, ...capped);
  return rows.map((r) => ({ id: r.id, title: r.title || "未命名" }));
}

/**
 * 删除一行。
 *
 * **语义变了，界面文案要跟着改。** Notion 时代这是 `archived:true`——进废纸篓、
 * 30 天内能在侧栏捞回来，所以工作台上写的是「移到废纸篓」。D1 没有这一层，
 * 删了就是删了，界面上必须说实话，别再承诺能恢复。
 *
 * 仍然要求传 view：id 是从工作台某个列表点出来的，view 对不上说明前端串台了，
 * 这时候宁可 400 也不要照着一个可能来路不明的 id 删东西。
 *
 * ⚠️ **必须回 `vaultPath`——而且必须在删之前把它读出来。**
 * 这一行删掉的同时 `vault_path` 那一列也就没了，而 vault 里那个归档文件还在。
 * 不回这个字段的话，那个文件当场变成孤儿：**连「它对应哪条」都反查不回来**
 * （只剩 frontmatter 里的 id 能做差集）。真正去动文件的是工作台那侧——
 * 这儿只有 GitHub API、没有读也没有删，更够不着你本机的 `.trash/`。
 * 这是 `/wb/*` 契约里唯一一个 vault 路径字段，别在列表端点上也顺手加：
 * 列表要的是「有什么」，只有删除这一刻需要知道「那份归档在哪」。
 */
async function deleteRowEndpoint(env, body) {
  const view = VIEWS[body?.view];
  if (!view) return json({ ok: false, error: `unknown view: ${body?.view}` }, 400);
  const pageId = String(body?.pageId || "");
  if (!isId(pageId)) return json({ ok: false, error: "pageId 不合法" }, 400);

  const row = await getRow(env, view.table, pageId);
  const vaultPath = row?.vault_path || "";
  const affectedTopicIds = body.view === "drafts" && row?.topic_id ? [row.topic_id] : [];
  const deleted = await dbDeleteRow(env, view.table, pageId);
  if (!deleted) return json({ ok: false, error: "not found" }, 404);
  if (body.view !== "drafts") return json({ ok: true, archived: pageId, vaultPath });

  const reconcileTopics = [];
  for (const topicId of affectedTopicIds) {
    reconcileTopics.push(await reconcileTopicDraftState(env, topicId));
  }
  return json({ ok: true, archived: pageId, vaultPath, affectedTopicIds, reconciled: true, reconcileTopics });
}

// 显式按仍存在的稿件修复父选题终态。既被删除流程调用，也可经
// POST /wb/reconcile {topicId} 单独补偿一次历史不一致。
export async function reconcileTopicDraftState(env, topicId) {
  if (!isId(topicId)) throw new Error("topicId 不合法");
  const topic = await getRow(env, "topics", topicId);
  if (!topic) throw new Error("选题不存在");
  const drafts = await dbDraftsOfTopic(env, topicId);
  const nextStatus = topicStatusFromDrafts(
    topic.platform ? [topic.platform] : [],
    drafts.map((d) => ({ platform: d.platform, status: d.status }))
  );
  await updateRow(env, "topics", topicId, { status: nextStatus });
  return { id: topicId, title: topic.title, status: nextStatus, draftIds: drafts.map((d) => d.id) };
}

/**
 * 某个选题成稿之后，稿子去哪了。
 *
 * 稿子的**唯一存放处是稿件库**，选题这边只留一个指路牌——同一份内容存两处，
 * 迟早会出现「选题里的版本和稿件库的版本不一样」这种没人说得清的状态。
 * 按 topic_id 反查，而不是按标题匹配：草稿标题是 LLM 起的，和选题名不一样。
 */
async function draftsOfTopicEndpoint(env, topicId) {
  const rows = await dbDraftsOfTopic(env, topicId);
  return json({ ok: true, topicId, items: decorate(await enrich(env, "drafts", rows), rows) });
}

// 统一入库：工作台各处的「存素材 / 进灵感库」按钮都打到这里。
// 存储规则复用 lib/store.js，与 Telegram 命令完全同一份。
async function intake(env, ctx, body) {
  const target = String(body?.target || "");
  if (!["collection", "inbox", "material"].includes(target)) {
    return json({ ok: false, error: "target 只能是 collection、inbox 或 material" }, 400);
  }
  const content = String(body?.content || "").trim();
  const source = String(body?.source || "").trim();

  if (target === "collection") {
    let saved;
    try {
      saved = await storeCollection(env, {
        content, title: body?.title, url: body?.url, selection: body?.selection,
        source: source || "工作台", saveNote: body?.saveNote, saveDuplicate: !!body?.saveDuplicate,
      });
    } catch (error) {
      return json({ ok: false, error: error.message }, 400);
    }
    if (!saved.duplicate && saved.snapshotStatus === "pending") {
      ctx.waitUntil(refreshCollectionSnapshot(env, saved.id).catch((e) => console.warn("collection snapshot failed:", e.message)));
    }
    return json({ ...saved, target });
  }

  if (!content) return json({ ok: false, error: "content 不能为空" }, 400);

  if (target === "inbox") {
    const r = await storeInboxEntry(env, content, { source: source || "工作台" });
    return json({ ok: true, target, pageId: r.id, title: r.title, type: r.type });
  }

  const cmd = resolveStoreCmd(body?.cmd);
  const r = cmd
    ? await storeTypedMaterial(env, cmd, content, { source })
    : await storeAutoMaterial(env, content, { source });
  if (!r.ok) return json({ ok: false, error: "内容为空，没存" }, 400);

  // 补标签 + 归档 vault 都不阻塞响应——和 Telegram 的「秒回后再补」是同一个取舍。
  // 串成一条链而不是两个并行的 waitUntil：标签必须先写进库，归档才能把它带进 frontmatter。
  ctx.waitUntil((async () => {
    if (r.needsAutoTag) await autoTag(env, r.id, r.dbType, r.body);
    await archiveMaterialToVault(env, r.id);
  })().catch((e) => console.warn("intake post-processing failed:", e.message)));

  return json({
    ok: true,
    target,
    pageId: r.id,
    dbType: r.dbType,
    title: r.title || r.body.slice(0, 50),
    tags: r.tags,
    topicTitles: r.topicTitles,
    autoTagPending: !!r.needsAutoTag,
  });
}

// 工作台统一创建入口：选题和手写稿都在这里落库。手写稿用 manual:* task_key，
// 和自动成稿的 draft-platform:* 永远不会撞唯一约束；父选题直接标为已成稿，避免 cron
// 把同一选题再次领走生成一篇重复稿。
async function createContent(env, input) {
  const body = normalizeCreationRequest(input);
  let materials = [];
  if (body.materialIds.length) {
    const holes = body.materialIds.map(() => "?").join(",");
    materials = await all(env, `SELECT id, title, content, type, verification FROM materials WHERE id IN (${holes})`, ...body.materialIds);
    if (materials.length !== body.materialIds.length) return json({ ok: false, error: "有素材已经不存在，请重新选择" }, 409);
  }

  const topicId = newId();
  const draftId = body.kind === "draft" ? newId() : "";
  const evidenceId = body.kind === "draft" && body.mode === "interview" && body.interviewEvidence ? newId() : "";
  const ts = now();
  const topicStatus = body.kind === "draft" ? TOPIC_STATUS.DRAFTED : TOPIC_STATUS.TODO;
  const ops = [stmt(
    env,
    `INSERT INTO topics (id, title, viewpoint, audience, platform, priority, status, task_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '中', ?, ?, ?, ?)`,
    topicId, body.title, body.viewpoint, body.audience, body.platform, topicStatus, `manual-topic:${topicId}`, ts, ts
  )];

  for (const material of materials) {
    ops.push(stmt(env, "INSERT OR IGNORE INTO topic_materials (topic_id, material_id) VALUES (?, ?)", topicId, material.id));
  }

  if (body.kind === "draft") {
    // 素材只作为稿件依据保持关联；正文完全以编辑器保存结果为准，空稿也不自动回填素材。
    const draftBody = body.body;
    const evidence = evidenceId ? [{ type: "个人经历", note: body.interviewEvidence }] : [];
    // 访谈稿还没落库，它自己那条经历要现给（`evidence`）；其余证据一律走 personalEvidence。
    if (body.mode === "interview") {
      assertGroundedGeneratedText(draftBody, await personalEvidence(env, [...materials.map((m) => ({ ...m, note: m.content })), ...evidence]));
    }

    ops.push(stmt(
      env,
      `INSERT INTO drafts (id, topic_id, headline, summary, body, platform, status, task_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      draftId, topicId, body.title, body.viewpoint, draftBody, body.platform,
      DRAFT_STATUS.TODO, `manual:${draftId}`, ts, ts
    ));

    if (evidenceId) {
      ops.push(stmt(
        env,
        `INSERT INTO materials
         (id, title, content, type, verification, verification_note, draft_id, task_key, created_at, updated_at)
         VALUES (?, ?, ?, '个人经历', '已核验', ?, ?, ?, ?, ?)`,
        evidenceId, `访谈记录｜${body.title}`.slice(0, 200), body.interviewEvidence,
        "用户在工作台访谈中逐轮提供，并在起稿前确认共识。", draftId, `manual-interview:${draftId}`, ts, ts
      ));
      ops.push(stmt(env, "INSERT INTO topic_materials (topic_id, material_id) VALUES (?, ?)", topicId, evidenceId));
    }
  }

  await batch(env, ops);
  return json({
    ok: true,
    topic: { id: topicId, title: body.title, status: topicStatus, platform: body.platform },
    draft: draftId ? { id: draftId, title: body.title, status: DRAFT_STATUS.TODO, platform: body.platform, topicId } : null,
    linkedMaterials: materials.length + (evidenceId ? 1 : 0),
  });
}

// 允许工作台改哪些字段。**白名单，不是黑名单**——放开任意字段写入意味着一个笔误
// 就能把素材类型改成非法值。（现在还多一层保险：非法值会被 CHECK 约束顶回来，
// 不像 Notion 那样静默存下去。）
// key 是前端传的名字，value 是库里的列名；tags 特殊，走关联表。
const EDITABLE = {
  collections: { reviewStatus: "review_status", title: "title", note: "save_note", tags: "__tags__" },
  inbox: { status: "status", title: "title", note: "verdict" },
  materials: {
    title: "title", note: "content", type: "type",
    tags: "__tags__", verificationStatus: "verification", verificationNote: "verification_note",
  },
  topics: {
    status: "status", title: "title", note: "viewpoint",
    audience: "audience", platforms: "__platform__", priority: "priority",
  },
  drafts: { status: "status", title: "headline", note: "summary" },
};

// 改字段。前端只传要改的键，没传的一律不动。
async function updateFields(env, body) {
  const view = EDITABLE[body?.view];
  if (!view) return json({ ok: false, error: `unknown view: ${body?.view}` }, 400);
  const pageId = String(body?.pageId || "");
  if (!isId(pageId)) return json({ ok: false, error: "pageId 不合法" }, 400);

  const fields = {};
  const applied = [];
  let tags = null;
  for (const [key, value] of Object.entries(body?.fields || {})) {
    if (body?.view === "collections" && key === "reviewStatus" && !isReviewStatus(value)) {
      return json({ ok: false, error: "reviewStatus 不合法" }, 400);
    }
    if (body?.view === "drafts" && key === "status" && value === DRAFT_STATUS.PUBLISHED) {
      return json({ ok: false, error: "请用稿件详情里的“记录发布”完成发布；链接、时间和数据会一起进入复盘闭环。" }, 400);
    }
    const col = view[key];
    if (!col) continue; // 白名单外的键静默忽略，不报错也不写
    if (col === "__tags__") {
      tags = Array.isArray(value) ? value : [String(value ?? "")];
      applied.push("tags");
    } else if (col === "__platform__") {
      // 契约上仍收数组，落库取第一个——成稿只写主平台
      fields.platform = (Array.isArray(value) ? value[0] : String(value ?? "")) || "";
      applied.push("platform");
    } else {
      fields[col] = Array.isArray(value) ? value.join(",") : String(value ?? "");
      applied.push(col);
    }
  }
  if (!applied.length) return json({ ok: false, error: "没有可改的字段" }, 400);

  if (Object.keys(fields).length) await updateRow(env, VIEWS[body.view].table, pageId, fields);
  if (tags) await setTags(env, body.view === "materials" ? "material" : "inbox", pageId, tags);
  return json({ ok: true, applied });
}

async function publishDraft(env, body) {
  const draftId = String(body?.draftId || "");
  if (!isId(draftId)) return json({ ok: false, error: "draftId 不合法" }, 400);
  const publishedUrl = String(body?.url || "").trim();
  if (!/^https?:\/\//i.test(publishedUrl)) return json({ ok: false, error: "请填写有效的发布链接" }, 400);
  const publishedAt = String(body?.publishedAt || "").trim();
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) return json({ ok: false, error: "发布时间不合法" }, 400);

  const draft = await getRow(env, "drafts", draftId);
  if (!draft) return json({ ok: false, error: "稿件不存在" }, 404);

  const performance = body?.performance || {};
  const feedbackStatus = ["样本不足", "普通", "表现突出"].includes(performance.status)
    ? performance.status
    : "未评估";
  const metrics = body?.metrics || {};
  const num = (v) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

  await updateRow(env, "drafts", draftId, {
    status: DRAFT_STATUS.PUBLISHED,
    published_url: publishedUrl,
    published_at: publishedAt,
    views: num(metrics.views),
    likes: num(metrics.likes),
    comments: num(metrics.comments),
    collects: num(metrics.collects),
    shares: num(metrics.shares),
    performance_summary: String(performance.summary || ""),
    feedback_status: feedbackStatus,
  });

  let feedbackCreated = 0;
  const topicIds = draft.topic_id ? [draft.topic_id] : [];
  if (feedbackStatus === "表现突出" && topicIds.length) {
    const topic = await getRow(env, "topics", topicIds[0]);
    if (topic) {
      feedbackCreated = await captureWinningFeedback(env, {
        draft, topic, publishedUrl, summary: String(performance.summary || ""),
      });
      await updateRow(env, "drafts", draftId, { feedback_status: "已沉淀" });
    }
  }

  const topics = [];
  for (const topicId of topicIds) topics.push(await reconcileTopicDraftState(env, topicId));
  return json({ ok: true, draftId, feedbackStatus: feedbackCreated ? "已沉淀" : feedbackStatus, feedbackCreated, topics });
}

// 一篇稿子表现突出时，把「什么标题有效、什么角度有效」沉淀回素材库，下次写作能直接用。
async function captureWinningFeedback(env, { draft, topic, publishedUrl, summary }) {
  const common = {
    source_url: publishedUrl,
    draft_id: draft.id,
    verification: VERIFICATION.NA,
    verification_note: "来自已发布内容的确定性复盘，不需要逐字核验。",
    performance_basis: summary,
  };
  const angle = topic.viewpoint || topic.title;
  const cards = [
    { kind: "title", type: "标题样本", title: `有效标题｜${draft.headline}`, note: `${draft.platform} 已发布标题：${draft.headline}`, feedback: "有效标题" },
    { kind: "angle", type: "内容角度", title: `有效角度｜${topic.title}`, note: angle, feedback: "有效角度" },
    { kind: "feedback", type: "平台反馈", title: `平台反馈｜${draft.headline}`, note: summary || `${draft.platform} 发布后表现突出。`, feedback: "平台反馈" },
  ];
  let created = 0;
  for (const card of cards) {
    const saved = await upsertByTaskKey(env, "materials", stableTaskKey("publish-feedback", draft.id, card.kind), {
      ...common,
      title: card.title.slice(0, 200),
      type: card.type,
      content: card.note,
      feedback_types: card.feedback,
    });
    if (saved.created) {
      created++;
      await linkMaterialToTopic(env, saved.id, topic.id);
    }
  }

  // 这个选题下用过的故事类素材，标记成「有效故事」——它们参与了一次成功的发布
  const related = await materialsOfTopic(env, topic.id);
  for (const m of related) {
    if (!["案例/故事", "个人经历"].includes(m.type)) continue;
    const merged = [...new Set([...csv(m.feedback_types), "有效故事"])].join(",");
    await updateRow(env, "materials", m.id, { feedback_types: merged, performance_basis: summary });
  }
  return created;
}

async function linkMaterialToTopic(env, materialId, topicId) {
  await all(env, "INSERT OR IGNORE INTO topic_materials (topic_id, material_id) VALUES (?, ?)", topicId, materialId);
}

/**
 * 整体替换正文。
 *
 * 原来这里有个「正文超过 40 块就拒绝」的限制——Notion 没有覆盖正文的接口，只能
 * 逐块删再追加，而删 N 块 + 追加 ceil(M/100) 次会顶爆单次调用的 subrequest 预算。
 * 现在正文是一列，一条 UPDATE 就是全部，**那个长度限制连同它的解释一起删掉了**。
 */
async function replaceContent(env, body) {
  const pageId = String(body?.pageId || "");
  if (!isId(pageId)) return json({ ok: false, error: "pageId 不合法" }, 400);
  const markdown = String(body?.markdown ?? "");
  const view = VIEWS[body?.view];
  if (!view) return json({ ok: false, error: `unknown view: ${body?.view}` }, 400);

  if (body?.view === "drafts") {
    assertGroundedGeneratedText(markdown, await personalEvidence(env));
  }

  const COLUMN = { inbox: "body", materials: "content", topics: "notes", drafts: "body" }[body.view];
  await updateRow(env, view.table, pageId, { [COLUMN]: markdown });
  return json({ ok: true, added: markdown.length });
}

// **白名单，不是黑名单**：认不出的模式退回「解释」，而不是把用户传的字符串拼进提示词。
//
// 加一个模式要同时改三处——这里、`prompt/explain.md`、下面的 maxTokens。
// **漏了这一处的后果最阴**：工作台那边点了新模式，这边静默退回「解释」，
// 不报错、HTTP 也是 200，只是给回来的东西不对，查起来很费劲。
const EXPLAIN_MODES = new Set(["解释", "展开", "反驳", "选题"]);

// 选题要列十几个标题外加一个推荐，比「展开」还长；给少了会在半句话上截断。
const MAX_TOKENS = { 展开: 1600, 选题: 2400 };

// 划词 AI：先在 Worker 内收齐并完成真实性校验，再返回纯文本。要不要留下由用户在工作台
// 点「存为笔记」决定。这里牺牲逐字流式，换取任何文字外显前都有同一条确定性硬闸。
async function explain(env, body) {
  const mode = EXPLAIN_MODES.has(body?.mode) ? body.mode : "解释";
  const selection = String(body?.selection || "").trim();
  if (!selection) return json({ ok: false, error: "selection 不能为空" }, 400);

  const context = String(body?.context || "").slice(0, 3000);
  const title = String(body?.title || "").slice(0, 120);
  const user = [
    `【模式】${mode}`,
    title ? `【文档】${title}` : "",
    `【选中】\n${selection.slice(0, 4000)}`,
    context ? `【上下文（选中处前后的原文，供参考）】\n${context}` : "",
  ].filter(Boolean).join("\n\n");

  const { content } = await chat(env, {
    system: EXPLAIN_PROMPT,
    user,
    maxTokens: MAX_TOKENS[mode] || 1000,
    task: "explain",
  });
  // 划词内容可能来自书、文章或他人的稿件，不能把其中的“我”冒认为用户本人。
  assertGroundedGeneratedText(content, []);

  return new Response(content, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}

// ---------------------------------------------------------------------------
// 按素材起稿（工作台创作弹层的「让 AI 生成初稿」）
//
// **原来这条走工作台本机的 claude CLI**，撤了。它既不读 vault 也不调 skill——素材全在提示词
// 里，CLI 只是被当成一个要十几秒冷启动的 API 客户端在用。搬来这边拿到三样：秒级、没装 CLI
// 也能用、吃得到各环节模型设置。但真正的理由是第四样：
//
// ⚠️ **真实性硬闸在这一侧。** 在 CLI 那条路上，「不许编造个人经历」只是提示词里的一句叮嘱；
// 到了这儿它是 `assertGroundedGeneratedText`——找不到依据就整篇拒绝，一个字都不落到编辑器里。
// 这正是项目红线三说的「真实性是代码层面的闸门，不是提示词里的叮嘱」。
//
// ⚠️ **素材必须按 id 从库里读，不能收工作台传过来的那份。** 闸门拿「个人经历」类素材当证据，
// 而证据要是客户端给的，编一条假的「个人经历」就能把闸门整个绕开——**那道闸就等于没有**。

const DRAFT_MAX_TOKENS = 16000;

/** 模型爱把整篇裹进 ```markdown 围栏里；落进编辑器的应该是正文本身。 */
function unfence(text) {
  const value = String(text || "").trim();
  const fenced = value.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/i);
  return (fenced ? fenced[1] : value).trim();
}

async function draftFromMaterials(env, body) {
  const ids = [...new Set((Array.isArray(body?.materialIds) ? body.materialIds : []).map((v) => String(v || "")).filter(isId))].slice(0, 30);
  if (!ids.length) return json({ ok: false, error: "至少选择一条素材" }, 400);
  const viewpoint = String(body?.viewpoint || "").trim();
  if (!viewpoint) return json({ ok: false, error: "先写清这篇的方向", hint: "AI 只按你给的方向和素材写，方向空着它只能自己猜" }, 400);

  const holes = ids.map(() => "?").join(",");
  const rows = await all(env, `SELECT * FROM materials WHERE id IN (${holes})`, ...ids);
  if (!rows.length) return json({ ok: false, error: "选中的素材在库里找不到了", hint: "回上一步重新搜一次" }, 404);

  /**
   * **待核验的金句和数据不进稿**，判据复用 `isMaterialEligibleForDraft`（流水线成稿用的是同一条）。
   * ⚠️ 但**必须把剔掉的告诉用户**：他明明挑了 5 条、稿子只用了 3 条，不说的话他会以为
   * 模型漏用了——而真正的原因是那两条还没核验。悄悄剔除比不剔除更糟。
   */
  const usable = rows.filter((r) => isMaterialEligibleForDraft({ type: r.type, verificationStatus: r.verification }));
  const skipped = rows
    .filter((r) => !usable.includes(r))
    .map((r) => ({ id: r.id, title: r.title, type: r.type, verificationStatus: r.verification }));
  if (!usable.length) {
    return json({
      ok: false,
      error: "选中的素材都还没核验，不能拿来起稿",
      hint: "金句/原话和数据/事实要先核对原文与出处、把核验状态改成「已核验」",
      skipped,
    }, 422);
  }

  const evidence = await personalEvidence(env, usable.map((r) => ({ type: r.type, note: r.content })));
  let remaining = 36_000;
  const brief = usable.map((r, index) => {
    const note = String(r.content || "").trim().slice(0, Math.max(0, Math.min(6000, remaining)));
    remaining -= note.length;
    return [
      `【素材 ${index + 1}】`,
      `标题：${r.title}`,
      `类型：${r.type}`,
      `核验：${r.verification}`,
      r.source_url ? `来源：${r.source_url}` : "",
      `正文：\n${note || "（无正文）"}`,
    ].filter(Boolean).join("\n");
  });

  const user = [
    [
      "【写作简报】",
      `暂定标题：${String(body?.draftTitle || "未定").slice(0, 200)}`,
      `目标平台：${String(body?.platform || "").slice(0, 20)}`,
      `目标读者：${String(body?.audience || "未指定").slice(0, 500)}`,
      `写作方向：${viewpoint.slice(0, 2000)}`,
    ].join("\n"),
    `【可用素材】\n${brief.join("\n\n")}`,
  ].join("\n\n");

  /**
   * ⚠️ **一边生成一边发心跳换行。**
   *
   * 闸门要求「先收齐再放行」，于是这个响应会挂住整个生成过程（几十秒到两三分钟）。
   * 中间一个字节都不发的话，这条连接会被 Cloudflare 当成卡死的请求掐掉——现象是
   * 「起稿失败」，而模型其实好好地写完了。心跳是纯换行，`JSON.parse` 会忽略前导空白，
   * 所以调用方照旧当一份 JSON 读，不需要另写解析。
   */
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode("\n"));
        } catch {
          /* 客户端已经走了 */
        }
      }, 10_000);
      const send = (payload) => controller.enqueue(encoder.encode(JSON.stringify(payload)));
      try {
        const { content } = await chat(env, {
          system: MATERIAL_DRAFT_PROMPT,
          user,
          maxTokens: DRAFT_MAX_TOKENS,
          task: "draft",
        });
        const draft = unfence(content);
        // 一个字都还没进编辑器之前先过闸：过不了就整篇不给，不是给了再提醒
        assertGroundedGeneratedText(draft, evidence);
        // 引用标注在这儿是白拿的：两边文本都在手上，纯字符串比对，不多花一次调用。
        // 用户改完正文再核对走 /wb/cite，两条路是同一个 `citeText`。
        send({
          ok: true,
          body: draft,
          used: usable.length,
          skipped,
          citations: citeText(draft, usable.map((r) => ({ id: r.id, text: r.content }))),
        });
      } catch (e) {
        const ungrounded = e?.code === "UNGROUNDED_PERSONAL_EXPERIENCE";
        send({
          ok: false,
          error: ungrounded ? "这一版里有编出来的亲身经历，已经拦下" : String(e?.message || "起稿失败").slice(0, 800),
          hint: ungrounded
            ? `${(e.claims || []).slice(0, 2).join("；")}——再生成一次多半就好；确实要写这段经历的话，先把它存成一条「个人经历」素材再来`
            : undefined,
          skipped,
        });
      } finally {
        clearInterval(beat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache, no-transform" },
  });
}

// ---------------------------------------------------------------------------
// 正文里哪一句来自哪条素材（工作台编辑器的引用标注）
//
// **对齐算法必须在这一侧**（`lib/cite.js`），不能挪去工作台：它和闸门共用同一套
// 归一化和二字组判据。分成两份实现的话，某天一边改了阈值或全角处理，就会出现
// 「闸门放行了、却一条引用都标不出来」这种没人看得懂的现象。规则跟着数据走。
//
// ⚠️ **素材原文按 id 从库里读，不收客户端传来的正文**——和起稿同一条。这儿虽然
// 不产生新内容，但标注是给用户「这句有出处」的信号；证据由客户端给的话，
// 那个信号就可以被伪造。

async function citeDraft(env, body) {
  const text = String(body?.body || "");
  const ids = [...new Set((Array.isArray(body?.materialIds) ? body.materialIds : []).map((v) => String(v || "")).filter(isId))].slice(0, 30);
  if (!text.trim() || !ids.length) return json({ ok: true, citations: [] });

  const holes = ids.map(() => "?").join(",");
  const rows = await all(env, `SELECT id, content FROM materials WHERE id IN (${holes})`, ...ids);
  return json({ ok: true, citations: citeText(text, rows.map((r) => ({ id: r.id, text: r.content }))) });
}

// ---------------------------------------------------------------------------
// 按意思挑素材（工作台创作弹层：关键词搜不到时的第二条路）
//
// **这一步必须在 Worker 这侧做**，不是在工作台那侧：候选清单是整库素材，而库就在这儿。
// 放到工作台去做的话，要么先把几百条素材拉过去（一次大往返 + 工作台开始持有数据规则），
// 要么在本机 spawn 一个 CLI（十几秒，而这只是一次搜索）。这里一次 LLM 调用就够，秒级。
//
// D1 查询用了 4 条（候选 1 + 命中行 1 + enrich 2），离每次调用 50 条的上限很远。

const PICK_LIMIT = 6;     // 再多就不是「挑」而是「又给了一屏要读的东西」
const PICK_SCAN = 300;    // 候选上限：一条摘要掐到 160 字，300 条约 1.5 万字，塞得进上下文

async function pickMaterials(env, body) {
  const want = String(body?.want || "").trim();
  if (!want) return json({ ok: false, error: "want 不能为空" }, 400);

  /**
   * **关键词已经搜出来的那些，直接从候选里拿掉。**
   *
   * 这一步补的是「关键词搜不到」那个缺口——它挑出来的东西要是用户上面已经看见了，
   * 那条推荐就是纯噪音，而且它占掉了 6 个名额里的一个。在候选阶段就排除，
   * 比拿回结果再让前端过滤好：过滤只是不显示，排除才能让模型腾出名额去挑别的。
   */
  const seen = new Set((Array.isArray(body?.exclude) ? body.exclude : []).map((v) => String(v || "")).filter(isId));

  // 只取模型判断需要的三列：整行拉回来（含正文全文）几百条会把提示词撑爆。
  // ⚠️ 排序同样走 `LIST_ORDER`（按 updated_at）：`PICK_SCAN` 截断时留下的应该是**最近的**那批，
  // 而按 id 排的话（UUID / ULID 两种格式混着，字典序不是时间序）截出来的是任意一批。
  // 素材还没到 300 条之前这条看不出任何差别——**等看得出来的时候，症状是「新存的素材推荐里从来不出现」**。
  const scanned = await all(
    env,
    `SELECT id, title, type, substr(content, 1, 160) AS brief FROM materials ${LIST_ORDER} LIMIT ?`,
    PICK_SCAN
  );
  const candidates = scanned.filter((c) => !seen.has(c.id));
  if (!candidates.length) return json({ ok: true, items: [], scanned: scanned.length });

  const user = [
    `【用户想找】${want.slice(0, 300)}`,
    body?.viewpoint ? `【这篇文章的方向】${String(body.viewpoint).slice(0, 800)}` : "",
    body?.platform ? `【目标平台】${String(body.platform).slice(0, 20)}` : "",
    `【候选清单】\n${candidates
      .map((c) => `id=${c.id} | ${c.type} | ${c.title}${c.brief ? ` | ${String(c.brief).replace(/\s+/g, " ")}` : ""}`)
      .join("\n")}`,
  ].filter(Boolean).join("\n\n");

  const { json: out } = await chatJson(env, { system: PICK_MATERIALS_PROMPT, user, maxTokens: 800, task: "pick" });
  const picks = keepRealPicks(out?.picks, candidates, PICK_LIMIT);
  // 一条都没挑出来是**正常结果**，不是错误：库里确实可能没有相关的东西。
  // 报成错误的话，界面会显示一句红的「失败」，而它工作得好好的。
  if (!picks.length) return json({ ok: true, items: [], scanned: scanned.length });

  const holes = picks.map(() => "?").join(",");
  const rows = await all(env, `SELECT * FROM materials WHERE id IN (${holes})`, ...picks.map((p) => p.id));
  const items = decorate(await enrich(env, "materials", rows), rows);
  const byId = new Map(items.map((item) => [item.id, item]));
  // **顺序按模型给的相关度**，不是 SQL 回来的 id 序——排在第一条的那个理由最强
  const ordered = picks.map((p) => (byId.has(p.id) ? { ...byId.get(p.id), why: p.why } : null)).filter(Boolean);
  return json({ ok: true, items: ordered, scanned: scanned.length });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
