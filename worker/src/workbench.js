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
  all, first, run, now, newId, batch, stmt,
  sourceContextOf, contextLine,
} from "./lib/db.js";
import { TOPIC_STATUS, DRAFT_STATUS, DRAFT_WORKFLOW, SEED_STATUS, VERIFICATION } from "./lib/values.js";
import { pipelineCounts } from "./lib/status.js";
import { storeTypedMaterial, storeAutoMaterial, storeInboxEntry, resolveStoreCmd, archiveMaterialToVault } from "./lib/store.js";
import { autoTag } from "./lib/tagging.js";
import { chat, chatJson } from "./lib/llm.js";
import { EXPLAIN_PROMPT, PICK_MATERIALS_PROMPT, MATERIAL_DRAFT_PROMPT, TEXT_REVISION_PROMPT, WRITING_ASSIST_PROMPT, IDEAS_ANGLES_PROMPT, IDEAS_MATERIALS_PROMPT, IDEAS_CARD_PROMPT } from "./prompts.js";
import {
  assertGroundedGeneratedText,
  auditPersonalNarrative,
  isMaterialEligibleForDraft,
  stableTaskKey,
  topicStatusFromDrafts,
} from "./lib/integrity.js";
import { citeText } from "./lib/cite.js";
import { normalizeCreationRequest, keepRealPicks } from "./lib/creation.js";
import { keepRealAngles, keepGroundedAngles, rangeSeconds, normalizeCards } from "./lib/ideas.js";
import { normalizeWritingAssistRequest } from "./lib/writing-assist.js";
import { normalizeTextRevisionRequest } from "./lib/text-revision.js";
import { MODEL_TASKS, availableModels, readModelMap, writeModelMap } from "./lib/models.js";
import { normalizeReleaseInput, releaseSpec } from "./lib/release-package.js";
import { normalizeProjectReview, winningFeedbackPlan } from "./lib/project-review.js";
import {
  applyCollectionOrganize,
  collectionSummary,
  isReviewStatus,
  previewCollectionOrganize,
  previewKnowledgeCard,
  refreshCollectionSnapshot,
  storeCollection,
} from "./lib/collections.js";
import { collectionTitle } from "./lib/collection-title.js";
import { collectionMarkdown } from "./lib/collection-text.js";
import { hashCollectionText } from "./lib/collection-key.js";
import { draftReadyToFinish, getContentProject, listContentProjects, nextDraftWorkflow, PROJECT_ACTIONS, PROJECT_STAGES } from "./lib/content-project.js";
import { mapSeed, normalizeSeedInput, normalizeSeedPatch, seedCounts, seedReactionGroups, seedReactions } from "./lib/seeds.js";
import {
  MATERIAL_LIBRARY_CTE,
  MATERIAL_LIBRARY_STAGES,
  materialLibraryWhere,
  parseMaterialLibraryQuery,
} from "./lib/material-library.js";
import { claimAgentTask, finishAgentTask, getAgentTask, heartbeatAgentTask } from "./lib/agent-tasks.js";

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
      title: collectionTitle({ title: r.title, url: r.canonical_url || r.link, selection: r.selection, content: r.body, source: r.source }),
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
      materialIds: [],
      topicIds: [],
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
      status: r.workflow_status || (r.status === DRAFT_STATUS.PUBLISHED ? DRAFT_WORKFLOW.PUBLISHED : DRAFT_WORKFLOW.WRITING),
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

    if (path === "materials" && request.method === "GET") return await listMaterialLibrary(env, url);

    if (path === "projects" && request.method === "GET") return await listProjects(env, url);

    // 种子：这条链的新起点。设计见 ../docs/工作流.md
    if (path === "seeds" && request.method === "GET") return await listSeeds(env, url);
    if (path === "seeds" && request.method === "POST") return await createSeed(env, await request.json());

    const seedDeleteMatch = path.match(/^seeds\/([0-9A-Za-z-]{20,40})\/delete$/);
    if (seedDeleteMatch && request.method === "POST") return await deleteSeed(env, seedDeleteMatch[1]);

    const seedMatch = path.match(/^seeds\/([0-9A-Za-z-]{20,40})$/);
    if (seedMatch && request.method === "POST") return await patchSeed(env, seedMatch[1], await request.json());

    const projectVariantMatch = path.match(/^projects\/(.+)\/variants$/);
    if (projectVariantMatch && request.method === "POST") {
      return await createProjectVariant(env, projectVariantMatch[1], await request.json());
    }

    const projectVariantRemoveMatch = path.match(/^projects\/(.+)\/variants\/([0-9A-Za-z-]{20,40})\/remove$/);
    if (projectVariantRemoveMatch && request.method === "POST") {
      return await removeProjectVariant(env, projectVariantRemoveMatch[1], projectVariantRemoveMatch[2]);
    }

    const projectReleaseMatch = path.match(/^projects\/(.+)\/releases\/([0-9A-Za-z-]{20,40})$/);
    if (projectReleaseMatch && request.method === "POST") {
      return await updateProjectRelease(env, projectReleaseMatch[1], projectReleaseMatch[2], await request.json());
    }

    const projectReviewMatch = path.match(/^projects\/(.+)\/review$/);
    if (projectReviewMatch && request.method === "POST") {
      return await submitProjectReview(env, projectReviewMatch[1], await request.json());
    }

    const projectDeleteMatch = path.match(/^projects\/(.+)\/delete$/);
    if (projectDeleteMatch && request.method === "POST") return await deleteProject(env, projectDeleteMatch[1]);

    const projectMaterialsMatch = path.match(/^projects\/(.+)\/materials$/);
    if (projectMaterialsMatch && request.method === "POST") {
      return await updateProjectMaterials(env, projectMaterialsMatch[1], await request.json());
    }

    const projectTransitionMatch = path.match(/^projects\/(.+)\/transition$/);
    if (projectTransitionMatch && request.method === "POST") {
      return await transitionProject(env, projectTransitionMatch[1], await request.json());
    }

    const projectMatch = path.match(/^projects\/(.+)$/);
    if (projectMatch && request.method === "GET") return await projectDetail(env, projectMatch[1]);

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

    if (path === "writing-assist" && request.method === "POST") return await writingAssist(env, await request.json());

    if (path === "text-revision" && request.method === "POST") return await textRevision(env, await request.json());

    if (path === "pick/materials" && request.method === "POST") return await pickMaterials(env, await request.json());

    // 「找题」两条。**都只读，一行都不往库里写**——见 lib/ideas.js 开头
    if (path === "ideas/angles" && request.method === "POST") return await ideaAngles(env, await request.json());
    if (path === "ideas/materials" && request.method === "POST") return await ideaMaterials(env, await request.json());
    if (path === "ideas/cards" && request.method === "POST") return await ideaCards(env, await request.json());

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

    // Harness 长任务只在这里保存执行状态。任务正文仍由工作台按需提供，任何正文写入仍需用户确认。
    if (path === "agent-tasks/claim" && request.method === "POST") {
      return json({ ok: true, ...(await claimAgentTask(env, await request.json())) });
    }
    const agentHeartbeatMatch = path.match(/^agent-tasks\/([^/]+)\/heartbeat$/);
    if (agentHeartbeatMatch && request.method === "POST") {
      return json({ ok: true, task: await heartbeatAgentTask(env, agentHeartbeatMatch[1], await request.json()) });
    }
    const agentFinishMatch = path.match(/^agent-tasks\/([^/]+)\/finish$/);
    if (agentFinishMatch && request.method === "POST") {
      return json({ ok: true, task: await finishAgentTask(env, agentFinishMatch[1], await request.json()) });
    }
    const agentTaskMatch = path.match(/^agent-tasks\/([^/]+)$/);
    if (agentTaskMatch && request.method === "GET") {
      const task = await getAgentTask(env, agentTaskMatch[1]);
      return task ? json({ ok: true, task }) : json({ ok: false, error: "任务不存在" }, 404);
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

  if (viewKey === "drafts") {
    const params = [];
    let clause = "";
    if (values.length) {
      clause = `WHERE workflow_status IN (${values.map(() => "?").join(",")})`;
      params.push(...values);
    }
    const cur = cursorClause(cursor);
    if (cur.sql) { clause += `${clause ? " AND" : "WHERE"} ${cur.sql}`; params.push(...cur.params); }
    const fetched = await all(env, `SELECT * FROM drafts ${clause} ${LIST_ORDER} LIMIT ?`, ...params, pageSize + 1);
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

const unique = (values = []) => [...new Set(values.filter(Boolean))];

function addRelation(map, owner, value) {
  if (!owner || !value) return;
  if (!map.has(owner)) map.set(owner, []);
  map.get(owner).push(value);
}

async function materialLibraryRelations(env, sourceIds, materialIds) {
  const sourceMaterial = new Map();
  const sourceTopic = new Map();
  const sourceDraft = new Map();
  const materialTopic = new Map();
  const materialDraft = new Map();

  if (sourceIds.length) {
    const selected = sourceIds.map(() => "(?)").join(",");
    const rows = await all(env, `WITH selected(id) AS (VALUES ${selected})
      SELECT m.inbox_id AS owner_id, 'material' AS relation, m.id AS target_id
        FROM materials m WHERE m.inbox_id IN (SELECT id FROM selected)
      UNION ALL
      SELECT ti.inbox_id AS owner_id, 'topic' AS relation, ti.topic_id AS target_id
        FROM topic_inbox ti WHERE ti.inbox_id IN (SELECT id FROM selected)
      UNION ALL
      SELECT m.inbox_id AS owner_id, 'topic' AS relation, tm.topic_id AS target_id
        FROM materials m JOIN topic_materials tm ON tm.material_id = m.id
       WHERE m.inbox_id IN (SELECT id FROM selected)
      UNION ALL
      SELECT ti.inbox_id AS owner_id, 'draft' AS relation, d.id AS target_id
        FROM topic_inbox ti JOIN drafts d ON d.topic_id = ti.topic_id
       WHERE ti.inbox_id IN (SELECT id FROM selected)
      UNION ALL
      SELECT m.inbox_id AS owner_id, 'draft' AS relation, d.id AS target_id
        FROM materials m
        JOIN topic_materials tm ON tm.material_id = m.id
        JOIN drafts d ON d.topic_id = tm.topic_id
       WHERE m.inbox_id IN (SELECT id FROM selected)`,
      ...sourceIds
    );
    for (const row of rows) {
      if (row.relation === "material") addRelation(sourceMaterial, row.owner_id, row.target_id);
      if (row.relation === "topic") addRelation(sourceTopic, row.owner_id, row.target_id);
      if (row.relation === "draft") addRelation(sourceDraft, row.owner_id, row.target_id);
    }
  }

  if (materialIds.length) {
    const selected = materialIds.map(() => "(?)").join(",");
    const rows = await all(env, `WITH selected(id) AS (VALUES ${selected})
      SELECT tm.material_id AS owner_id, 'topic' AS relation, tm.topic_id AS target_id
        FROM topic_materials tm WHERE tm.material_id IN (SELECT id FROM selected)
      UNION ALL
      SELECT tm.material_id AS owner_id, 'draft' AS relation, d.id AS target_id
        FROM topic_materials tm JOIN drafts d ON d.topic_id = tm.topic_id
       WHERE tm.material_id IN (SELECT id FROM selected)`,
      ...materialIds
    );
    for (const row of rows) {
      if (row.relation === "topic") addRelation(materialTopic, row.owner_id, row.target_id);
      if (row.relation === "draft") addRelation(materialDraft, row.owner_id, row.target_id);
    }
  }

  return { sourceMaterial, sourceTopic, sourceDraft, materialTopic, materialDraft };
}

async function hydrateMaterialLibrary(env, metas) {
  if (!metas.length) return [];
  const sourceIds = metas.filter((row) => row.kind !== "material").map((row) => row.id);
  const materialIds = metas.filter((row) => row.kind === "material").map((row) => row.id);
  const [sourceRows, materialRows, sourceTags, materialTags, relations] = await Promise.all([
    sourceIds.length ? all(env, `SELECT * FROM inbox WHERE id IN (${sourceIds.map(() => "?").join(",")})`, ...sourceIds) : [],
    materialIds.length ? all(env, `SELECT * FROM materials WHERE id IN (${materialIds.map(() => "?").join(",")})`, ...materialIds) : [],
    tagsOf(env, "inbox", sourceIds),
    tagsOf(env, "material", materialIds),
    materialLibraryRelations(env, sourceIds, materialIds),
  ]);
  const sources = new Map(sourceRows.map((row) => [row.id, row]));
  const materials = new Map(materialRows.map((row) => [row.id, row]));

  return metas.map((meta) => {
    const row = meta.kind === "material" ? materials.get(meta.id) : sources.get(meta.id);
    if (!row) return null;
    const sourceKey = meta.source_key;
    const record = VIEWS[sourceKey].map(row);
    const tags = meta.kind === "material"
      ? (materialTags.get(meta.id) || [])
      : (sourceTags.get(meta.id) || []);
    const materialIdsForItem = meta.kind === "material" ? [] : unique(relations.sourceMaterial.get(meta.id));
    const inspirationIds = meta.kind === "material" && row.inbox_id ? [row.inbox_id] : [];
    const topicIds = meta.kind === "material"
      ? unique(relations.materialTopic.get(meta.id))
      : unique(relations.sourceTopic.get(meta.id));
    const draftIds = meta.kind === "material"
      ? unique([row.draft_id, ...(relations.materialDraft.get(meta.id) || [])])
      : unique(relations.sourceDraft.get(meta.id));

    Object.assign(record, {
      tags,
      materialIds: materialIdsForItem,
      inspirationIds,
      topicIds,
      draftIds,
      editedAt: iso(meta.updated_at),
    });
    if (sourceKey === "collections") record.convertedToIdea = row.processing_mode === "triage";
    return {
      id: meta.id,
      sourceKey,
      kind: meta.kind,
      stage: meta.stage,
      title: meta.title,
      type: meta.type,
      excerpt: meta.excerpt,
      tags,
      status: meta.status,
      verificationStatus: meta.verification_status,
      verificationNote: row.verification_note || "",
      link: meta.link,
      source: meta.source,
      materialIds: materialIdsForItem,
      inspirationIds,
      topicIds,
      draftIds,
      updatedAt: iso(meta.updated_at),
      record,
    };
  }).filter(Boolean);
}

/**
 * 收件箱、灵感和素材的统一只读列表。分页先在 D1 的 UNION 结果上全局排序，
 * 再对当页 id 批量补关系；不会出现“每张卡查一次”的 N+1。
 */
async function listMaterialLibrary(env, url) {
  let filters;
  try {
    filters = parseMaterialLibraryQuery(url);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const pageWhere = materialLibraryWhere(filters, { cursor: true });
  const countWhere = materialLibraryWhere(filters, { stage: false });
  const typeWhere = materialLibraryWhere(filters, { type: false });
  const verificationWhere = materialLibraryWhere(filters, { verification: false });
  const totalWhere = materialLibraryWhere(filters);
  const verificationTail = verificationWhere.sql ? "AND verification_status != ''" : "WHERE verification_status != ''";

  const [fetched, stageRows, typeRows, verificationRows, totalRow] = await Promise.all([
    all(env, `${MATERIAL_LIBRARY_CTE}
      SELECT * FROM material_library ${pageWhere.sql}
      ORDER BY updated_at DESC, id DESC LIMIT ?`, ...pageWhere.params, filters.pageSize + 1),
    all(env, `${MATERIAL_LIBRARY_CTE}
      SELECT stage, COUNT(*) AS count FROM material_library ${countWhere.sql} GROUP BY stage`, ...countWhere.params),
    all(env, `${MATERIAL_LIBRARY_CTE}
      SELECT type, COUNT(*) AS count FROM material_library ${typeWhere.sql} GROUP BY type ORDER BY count DESC, type ASC`, ...typeWhere.params),
    all(env, `${MATERIAL_LIBRARY_CTE}
      SELECT verification_status AS verification, COUNT(*) AS count
        FROM material_library ${verificationWhere.sql} ${verificationTail}
       GROUP BY verification_status ORDER BY count DESC, verification_status ASC`, ...verificationWhere.params),
    first(env, `${MATERIAL_LIBRARY_CTE}
      SELECT COUNT(*) AS count FROM material_library ${totalWhere.sql}`, ...totalWhere.params),
  ]);

  const hasMore = fetched.length > filters.pageSize;
  const rows = hasMore ? fetched.slice(0, filters.pageSize) : fetched;
  const counts = Object.fromEntries(MATERIAL_LIBRARY_STAGES.map((stage) => [stage, 0]));
  for (const row of stageRows) if (row.stage in counts) counts[row.stage] = Number(row.count) || 0;
  return json({
    ok: true,
    items: await hydrateMaterialLibrary(env, rows),
    counts,
    total: Number(totalRow?.count) || 0,
    facets: {
      stages: MATERIAL_LIBRARY_STAGES.map((value) => ({ value, count: counts[value] })),
      types: typeRows.map((row) => ({ value: row.type, count: Number(row.count) || 0 })),
      verifications: verificationRows.map((row) => ({ value: row.verification, count: Number(row.count) || 0 })),
    },
    nextCursor: hasMore ? encodeCursor(rows[rows.length - 1]) : null,
  });
}

// 内容项目只读聚合。这两个端点不改 topics / drafts 的任何状态，
// 阶段和阻塞原因由 Worker 统一返回，前端不再拿稿件状态二次猜流程。
async function listProjects(env, url) {
  const stage = String(url.searchParams.get("stage") || "").trim();
  if (stage && !PROJECT_STAGES.includes(stage)) {
    return json({ ok: false, error: `stage 不合法（可选 ${PROJECT_STAGES.join("/")}）` }, 400);
  }
  const result = await listContentProjects(env, {
    stage,
    cursor: url.searchParams.get("cursor") || "",
    pageSize: url.searchParams.get("pageSize") || 100,
  });
  return json({ ok: true, ...result });
}

async function projectDetail(env, rawId) {
  let id;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return json({ ok: false, error: "project id 不合法" }, 400);
  }
  const valid = isId(id) || (id.startsWith("draft:") && isId(id.slice(6)));
  if (!valid) return json({ ok: false, error: "project id 不合法" }, 400);
  const project = await getContentProject(env, id);
  return project ? json({ ok: true, project }) : json({ ok: false, error: "not found" }, 404);
}

/* ==========================================================================
   种子（`lib/seeds.js` 是纯逻辑那一半）

   **种子 = 你看到的东西 + 你对它的一句话。** 它解决的是「看到一个观点想写，
   但不知道自己能加什么」——而「能加什么」的答案几乎总是你自己的经历和判断。
   整份设计见 `../docs/工作流.md`。
   ========================================================================== */

/**
 * ⚠️ **`reactions` 清单跟着响应一起回，工作台绝不抄第二份。**
 * `sources.js` 那几处 `states` 抄了一份，CLAUDE.md 里记着「对不上就是 400」。
 * **零条种子时也要返回清单**——否则界面画不出选择器，而那正是第一次用的时候。
 */
async function listSeeds(env, url) {
  const status = String(url.searchParams.get("status") || "").trim();
  // ⚠️ 排序按 updated_at 不按 id：库里 id 有 UUID 和 ULID 两种格式，
  // 按 ASCII 比会把新建的整体压到迁移行后面（lib/db.js 的 LIST_ORDER 那条踩过）。
  const rows = await all(env, "SELECT * FROM seeds ORDER BY updated_at DESC, id DESC");
  const shown = status ? rows.filter((r) => r.status === status) : rows;
  return json({
    ok: true,
    seeds: shown.map(mapSeed),
    // 计数**按全部行算，不按筛选后的算**——不然点进「写了」那一档，
    // 「攒着 12」会变成 0，看着像东西全没了。
    counts: seedCounts(rows),
    // ⚠️ 两份都回：`reactionGroups` 是界面画的那一份，`reactions` 拍平的这份
    // 留给校验和旧标签页。**扁平那份是从分组算出来的**，不存在对不上的可能。
    reactionGroups: seedReactionGroups(),
    reactions: seedReactions(),
  });
}

async function createSeed(env, body) {
  let input;
  try {
    input = normalizeSeedInput(body);
  } catch (error) {
    return json({ ok: false, error: error.message, hint: error.hint }, error.status || 400);
  }

  // ⚠️ **没有 task_key 幂等，是有意的**：对同一条热点反应两次是合法的
  //（那是两个不同角度），不该被去重挡住。防误双击是前端的事。
  const id = newId();
  const ts = now();
  await run(
    env,
    `INSERT INTO seeds (id, reaction, take, source_kind, source_id, source_title, source_url,
                        source_excerpt, source_fetched_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.reaction, input.take, input.sourceKind, input.sourceId,
    input.sourceTitle, input.sourceUrl, input.sourceExcerpt, input.sourceFetchedAt,
    SEED_STATUS.KEEPING, ts, ts
  );
  const row = await first(env, "SELECT * FROM seeds WHERE id = ?", id);
  return json({ ok: true, seed: mapSeed(row) });
}

async function patchSeed(env, id, body) {
  let patch;
  try {
    patch = normalizeSeedPatch(body);
  } catch (error) {
    return json({ ok: false, error: error.message, hint: error.hint }, error.status || 400);
  }
  const existing = await first(env, "SELECT id FROM seeds WHERE id = ?", id);
  if (!existing) return json({ ok: false, error: "这颗种子不在库里了" }, 404);

  const sets = [];
  const params = [];
  if (patch.take !== undefined) { sets.push("take = ?"); params.push(patch.take); }
  if (patch.status !== undefined) { sets.push("status = ?"); params.push(patch.status); }
  if (patch.draftId !== undefined) { sets.push("draft_id = ?"); params.push(patch.draftId || null); }
  if (patch.sourceExcerpt !== undefined) { sets.push("source_excerpt = ?"); params.push(patch.sourceExcerpt); }
  if (patch.sourceFetchedAt !== undefined) { sets.push("source_fetched_at = ?"); params.push(patch.sourceFetchedAt); }
  sets.push("updated_at = ?");
  params.push(now(), id);

  await run(env, `UPDATE seeds SET ${sets.join(", ")} WHERE id = ?`, ...params);
  const row = await first(env, "SELECT * FROM seeds WHERE id = ?", id);
  return json({ ok: true, seed: mapSeed(row) });
}

/**
 * ⚠️ **真删除，没有废纸篓。** 和 `/wb/delete` 同一条：这个库没有 archived 那一层，
 * 界面文案必须照实说清不可恢复。种子很轻（就一句话），所以不为它单独建回收站——
 * 真舍不得就标「不写了」，那一档留着。
 */
async function deleteSeed(env, id) {
  const row = await first(env, "SELECT id FROM seeds WHERE id = ?", id);
  if (!row) return json({ ok: false, error: "这颗种子不在库里了" }, 404);
  await run(env, "DELETE FROM seeds WHERE id = ?", id);
  return json({ ok: true, id });
}

// 项目阶段只允许通过命令推进。前端不直接写状态值，非法跨级会在这里被拒绝。
/**
 * 给项目挂上 / 摘掉素材。
 *
 * ⚠️ **只有点过「用这条」的才进来，AI 挑出来的候选不自动挂。**
 * `topic_materials` 的语义是**「这篇真的用了它」**，右栏的「已用 N 处」、
 * 归档时的证据链、复盘时的「有效故事」标记全建立在这个意思上。
 * 自动挂等于把「我用了」偷偷换成「系统猜它相关」——**那三处从此都在说假话**。
 *
 * ⚠️ **必须有 `remove`。** 挂错一条却没有退路，比不给这个功能更糟：
 * 你会为了删掉一条素材去动整个项目。
 */
/**
 * 删掉一个内容项目。**真删，没有废纸篓。**
 *
 * ⚠️ **删的是选题那一行，而 `drafts.topic_id` 是 `ON DELETE CASCADE`——
 * 它底下所有稿子跟着一起没**。所以这不是「删一个壳」，是删掉这一篇的全部内容。
 * 界面上必须点两下、并且把这句话说出来。
 *
 * ⚠️ **归档路径要在删之前一次性读出来，而且要读稿子的、不是选题的。**
 * 选题没有 `vault_path`，有归档的是它底下那些稿；删完再去查就什么都查不到了，
 * 而 vault 里那几个文件还在——**连「对应哪条」都反查不回来**。
 * 真出过：删了两篇稿，Obsidian 里 6 个文件对着库里 4 行。
 * 动文件那一步只有工作台做得到（Worker 够不着你本机的 `.trash/`），
 * 所以这儿只负责**把路径回给它**。
 */
async function deleteProject(env, rawId) {
  let id;
  try { id = decodeURIComponent(rawId); } catch { return json({ ok: false, error: "project id 不合法" }, 400); }

  // 孤立稿件的项目就是那一篇稿本身，直接走删稿那条
  if (id.startsWith("draft:")) {
    const draftId = id.slice(6);
    if (!isId(draftId)) return json({ ok: false, error: "project id 不合法" }, 400);
    const row = await getRow(env, "drafts", draftId);
    if (!row) return json({ ok: false, error: "内容项目不存在" }, 404);
    await dbDeleteRow(env, "drafts", draftId);
    return json({ ok: true, deleted: 1, vaultPaths: [row.vault_path].filter(Boolean) });
  }

  if (!isId(id)) return json({ ok: false, error: "project id 不合法" }, 400);
  const topic = await first(env, "SELECT id FROM topics WHERE id = ?", id);
  if (!topic) return json({ ok: false, error: "内容项目不存在" }, 404);

  const drafts = await all(env, "SELECT id, vault_path FROM drafts WHERE topic_id = ?", id);
  await dbDeleteRow(env, "topics", id);
  return json({
    ok: true,
    // 连级删掉了几篇稿：界面要照实说「这一下删掉了 N 篇」，不能只说「已删除」
    deleted: drafts.length,
    vaultPaths: drafts.map((d) => d.vault_path).filter(Boolean),
  });
}

async function updateProjectMaterials(env, rawId, body) {
  let id;
  try { id = decodeURIComponent(rawId); } catch { return json({ ok: false, error: "project id 不合法" }, 400); }
  // 独立稿件没有选题，也就没有 topic_materials 这张关联表可挂——照实说，别静默什么都不做
  if (id.startsWith("draft:")) {
    return json({ ok: false, error: "这是一篇独立稿件，还没有选题，挂不了素材", hint: "先在项目里建选题，或者从素材开始起稿" }, 409);
  }
  if (!isId(id)) return json({ ok: false, error: "project id 不合法" }, 400);

  const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x || "")).filter(isId))].slice(0, 30);
  const add = ids(body?.add);
  const remove = ids(body?.remove);
  if (!add.length && !remove.length) return json({ ok: false, error: "没有要挂上或摘掉的素材" }, 400);

  const topic = await first(env, "SELECT id FROM topics WHERE id = ?", id);
  if (!topic) return json({ ok: false, error: "内容项目不存在" }, 404);

  // 挂之前先确认素材真的还在：挂一条已经被删掉的行，界面上会多出一张点不开的卡
  if (add.length) {
    const holes = add.map(() => "?").join(",");
    const found = await all(env, `SELECT id FROM materials WHERE id IN (${holes})`, ...add);
    if (found.length !== add.length) return json({ ok: false, error: "有素材已经不存在，请重新挑一次" }, 409);
  }

  const ops = [];
  for (const materialId of add) {
    ops.push(stmt(env, "INSERT OR IGNORE INTO topic_materials (topic_id, material_id) VALUES (?, ?)", id, materialId));
  }
  for (const materialId of remove) {
    ops.push(stmt(env, "DELETE FROM topic_materials WHERE topic_id = ? AND material_id = ?", id, materialId));
  }
  // 挂素材是对这个项目动了手，时间戳跟着走——否则列表页的排序会说它「很久没动了」
  ops.push(stmt(env, "UPDATE topics SET updated_at = ? WHERE id = ?", now(), id));
  await batch(env, ops);

  return json({ ok: true, project: await getContentProject(env, id) });
}

async function transitionProject(env, rawId, body) {
  let id;
  try { id = decodeURIComponent(rawId); } catch { return json({ ok: false, error: "project id 不合法" }, 400); }
  const orphanDraftId = id.startsWith("draft:") ? id.slice(6) : "";
  if (!isId(id) && !isId(orphanDraftId)) return json({ ok: false, error: "project id 不合法" }, 400);
  const action = String(body?.action || "");
  if (!PROJECT_ACTIONS.includes(action)) return json({ ok: false, error: "action 不合法" }, 400);

  const project = await getContentProject(env, id);
  if (!project) return json({ ok: false, error: "内容项目不存在" }, 404);
  const draft = project.masterDraft;
  const ts = now();

  if (action === "set-primary") {
    if (!project.topic) return json({ ok: false, error: "独立稿件不需要选择母版" }, 409);
    const draftId = String(body?.draftId || "");
    const candidates = [project.masterDraft, ...(project.variants || [])].filter(Boolean);
    if (!isId(draftId) || !candidates.some((item) => item.id === draftId)) {
      return json({ ok: false, error: "所选稿件不属于这个项目" }, 400);
    }
    await updateRow(env, "topics", id, { primary_draft_id: draftId, status: TOPIC_STATUS.DRAFTED });
  } else if (action === "start-writing") {
    if (!project.topic) return json({ ok: false, error: "独立稿件已经是主稿" }, 409);
    if (draft) return json({ ok: false, error: "项目已经有主稿" }, 409);
    const draftId = newId();
    await batch(env, [
      stmt(env, `INSERT INTO drafts
        (id, topic_id, headline, summary, body, platform, status, workflow_status, task_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
        draftId, id, project.title, project.brief?.viewpoint || "", project.brief?.platform || "公众号",
        DRAFT_STATUS.TODO, DRAFT_WORKFLOW.WRITING, `manual:${draftId}`, ts, ts),
      stmt(env, "UPDATE topics SET primary_draft_id = ?, status = ?, updated_at = ? WHERE id = ?",
        draftId, TOPIC_STATUS.DRAFTED, ts, id),
    ]);
  } else {
    if (!draft) return json({ ok: false, error: "项目还没有主稿" }, 409);
    /**
     * ⚠️ **空稿不能进「待发布」，而且这道闸门必须在这儿。**
     * 工作台的「建立空白主稿」建的是 `body=''` 的空壳，空壳照样能被推到下一档——
     * 真出过：库里 6 篇稿子有 3 篇正文长度是 0，其中一篇已经走过去了，
     * **于是界面在要求你审阅一篇不存在的文章**。
     * 前端把按钮置灰挡的是误点，挡不住直接打这个接口。
     */
    if (action === "finish-writing" && !draftReadyToFinish(draft)) {
      return json({ ok: false, error: "正文还是空的", hint: "先写点东西，再往发布走" }, 409);
    }
    const current = draft.status;
    let next;
    try { next = nextDraftWorkflow(current, action); }
    catch (error) { return json({ ok: false, error: error.message }, 409); }
    const ops = [stmt(env, "UPDATE drafts SET workflow_status = ?, updated_at = ? WHERE id = ?", next, ts, draft.id)];
    if (project.topic) {
      const topicStatus = action === "abandon" ? TOPIC_STATUS.PARKED : TOPIC_STATUS.DRAFTED;
      ops.push(stmt(env, "UPDATE topics SET status = ?, updated_at = ? WHERE id = ?", topicStatus, ts, id));
    }
    await batch(env, ops);
  }

  return json({ ok: true, project: await getContentProject(env, id) });
}

async function createProjectVariant(env, rawId, body) {
  let id;
  try { id = decodeURIComponent(rawId); } catch { return json({ ok: false, error: "project id 不合法" }, 400); }
  if (!isId(id)) return json({ ok: false, error: "只有以选题为根的内容项目才能建立平台版本" }, 400);

  let spec;
  try { spec = releaseSpec(body?.platform); }
  catch (error) { return json({ ok: false, error: error.message }, 400); }

  const project = await getContentProject(env, id);
  if (!project) return json({ ok: false, error: "内容项目不存在" }, 404);
  if (project.stage !== "待发布" || !project.masterDraft) {
    return json({ ok: false, error: "主稿通过诊断后才能建立平台版本" }, 409);
  }
  if (spec.platform === project.masterDraft.platform) {
    return json({ ok: false, error: `${spec.platform} 已经是主稿平台` }, 409);
  }

  const samePlatform = project.variants.find((item) => item.platform === spec.platform);
  if (samePlatform) {
    if (samePlatform.parentDraftId === project.masterDraft.id) {
      return json({ ok: true, created: false, variantId: samePlatform.id, project });
    }
    return json({ ok: false, error: `项目里已经有一份 ${spec.platform} 稿件，请先确认它的来源` }, 409);
  }

  const draftId = newId();
  const ts = now();
  const taskKey = `project-variant:${id}:${project.masterDraft.id}:${spec.platform}`;
  await batch(env, [stmt(env, `INSERT OR IGNORE INTO drafts
    (id, topic_id, headline, summary, body, platform, status, workflow_status, parent_draft_id, task_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    draftId, id, project.masterDraft.title, project.masterDraft.release?.summary || project.masterDraft.summary || "",
    project.masterDraft.body || "", spec.platform, DRAFT_STATUS.TODO, DRAFT_WORKFLOW.READY,
    project.masterDraft.id, taskKey, ts, ts)],
  );
  const saved = await first(env, "SELECT id FROM drafts WHERE task_key = ?", taskKey);
  return json({ ok: true, created: saved?.id === draftId, variantId: saved?.id || draftId, project: await getContentProject(env, id) });
}

async function removeProjectVariant(env, rawId, draftId) {
  let id;
  try { id = decodeURIComponent(rawId); } catch { return json({ ok: false, error: "project id 不合法" }, 400); }
  if (!isId(id) || !isId(draftId)) return json({ ok: false, error: "项目或版本 id 不合法" }, 400);
  const project = await getContentProject(env, id);
  if (!project) return json({ ok: false, error: "内容项目不存在" }, 404);
  const variant = (project.variants || []).find((item) => item.id === draftId);
  if (!variant) return json({ ok: false, error: "只能移除这个项目里的平台版本，母版不会被删除" }, 400);
  if (variant.publicationStatus === DRAFT_STATUS.PUBLISHED) return json({ ok: false, error: "已发布版本不能移除" }, 409);
  if (variant.parentDraftId !== project.masterDraft?.id) return json({ ok: false, error: "这个稿件的母版关系不明确，不能直接移除" }, 409);
  await dbDeleteRow(env, "drafts", draftId);
  return json({ ok: true, removedId: draftId, project: await getContentProject(env, id) });
}

async function updateProjectRelease(env, rawId, draftId, body) {
  let id;
  try { id = decodeURIComponent(rawId); } catch { return json({ ok: false, error: "project id 不合法" }, 400); }
  if (!isId(id) || !isId(draftId)) return json({ ok: false, error: "项目或版本 id 不合法" }, 400);
  const project = await getContentProject(env, id);
  if (!project) return json({ ok: false, error: "内容项目不存在" }, 404);
  if (project.stage !== "待发布") return json({ ok: false, error: "只有待发布项目可以编辑发布版本" }, 409);

  const candidates = [project.masterDraft, ...(project.variants || [])].filter(Boolean);
  const current = candidates.find((item) => item.id === draftId);
  if (!current) return json({ ok: false, error: "所选版本不属于这个内容项目" }, 400);
  if (current.publicationStatus === DRAFT_STATUS.PUBLISHED) return json({ ok: false, error: "已发布版本不能再改写" }, 409);

  /**
   * ⚠️ **「待发布」那一档的正文**可以就地改**，母版也一样。**
   *
   * 原来这儿挡着母版的标题和正文，要人先点「退回写作」。撤掉的理由：
   * **那道锁一键就能绕过**——「退回写作」按钮就在同一屏上，点一下就能改，
   * 所以它挡不住任何东西，只是在「发现一个错字」和「改掉它」之间多插一步。
   *
   * **真正的闸门是下面那行**：正文一变就重跑 `assertGroundedGeneratedText`。
   * 那条拦的是「凭空写出来的第一人称经历」，它和你在哪一档改没有关系。
   */
  let fields;
  try { fields = normalizeReleaseInput(body, current); }
  catch (error) { return json({ ok: false, error: error.message }, 400); }
  if (fields.body !== current.body) assertGroundedGeneratedText(fields.body, await personalEvidence(env));
  await updateRow(env, "drafts", draftId, fields);
  return json({ ok: true, draftId, project: await getContentProject(env, id) });
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
    const statusColumn = viewKey === "collections" ? "review_status" : viewKey === "drafts" ? "workflow_status" : "status";
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
    : viewKey === "collections" ? collectionMarkdown(row.selection || row.body)
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
  if (body.view === "collections" && row?.capture_origin !== "collection") {
    return json({ ok: false, error: "not found" }, 404);
  }
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
  const hasPrimary = drafts.some((draft) => draft.id === topic.primary_draft_id);
  const primaryDraftId = hasPrimary ? topic.primary_draft_id : drafts.length === 1 ? drafts[0].id : null;
  await updateRow(env, "topics", topicId, { status: nextStatus, primary_draft_id: primaryDraftId });
  return { id: topicId, title: topic.title, status: nextStatus, primaryDraftId, draftIds: drafts.map((d) => d.id) };
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
    `INSERT INTO topics (id, title, viewpoint, audience, platform, priority, status, primary_draft_id, task_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '中', ?, ?, ?, ?, ?)`,
    topicId, body.title, body.viewpoint, body.audience, body.platform, topicStatus, draftId || null, `manual-topic:${topicId}`, ts, ts
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
  const project = await getContentProject(env, topicId);
  return json({
    ok: true,
    project,
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
  drafts: { status: "workflow_status", title: "headline", note: "summary" },
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
    workflow_status: DRAFT_WORKFLOW.PUBLISHED,
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

  const topicIds = draft.topic_id ? [draft.topic_id] : [];
  const topics = [];
  for (const topicId of topicIds) topics.push(await reconcileTopicDraftState(env, topicId));
  return json({ ok: true, draftId, feedbackStatus, feedbackCreated: 0, topics });
}

async function submitProjectReview(env, projectId, body) {
  const project = await getContentProject(env, projectId);
  if (!project) return json({ ok: false, error: "内容项目不存在" }, 404);
  if (!["待复盘", "已完成"].includes(project.stage)) {
    return json({ ok: false, error: `当前项目是“${project.stage}”，只有已发布项目才能复盘` }, 409);
  }

  let input;
  try {
    input = normalizeProjectReview(body);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const alreadyCaptured = project.review?.status === "已沉淀";
  if (alreadyCaptured && input.status !== "表现突出") {
    return json({ ok: false, error: "这次复盘的有效经验已经进入素材库，不能直接改成其他判断" }, 409);
  }
  const shouldCapture = alreadyCaptured || input.captureFeedback;

  const draftId = String(body?.draftId || project.review?.draftId || "");
  const publishedIds = new Set((project.publication?.records || []).filter((item) => item.complete).map((item) => item.draftId));
  if (!publishedIds.has(draftId)) return json({ ok: false, error: "选中的不是这个项目已发布的版本" }, 409);

  const draft = await getRow(env, "drafts", draftId);
  if (!draft) return json({ ok: false, error: "已发布稿件不存在" }, 404);
  if (shouldCapture && !draft.topic_id) {
    return json({ ok: false, error: "这篇稿件没有所属选题，无法沉淀标题和角度素材" }, 409);
  }
  const captureContext = shouldCapture ? {
    topic: await getRow(env, "topics", draft.topic_id),
    materials: await materialsOfTopic(env, draft.topic_id),
  } : null;
  if (captureContext && !captureContext.topic) return json({ ok: false, error: "稿件所属选题不存在" }, 409);
  const updated = await updateRow(env, "drafts", draftId, {
    views: input.metrics.views,
    likes: input.metrics.likes,
    comments: input.metrics.comments,
    collects: input.metrics.collects,
    shares: input.metrics.shares,
    performance_summary: input.basis,
    feedback_status: input.status,
    review_conclusion: input.conclusion,
    next_experiment: input.nextExperiment,
    reviewed_at: new Date().toISOString(),
  });

  let feedbackCreated = 0;
  if (shouldCapture) {
    const plan = winningFeedbackPlan({ draft: updated, ...captureContext, basis: input.basis });
    feedbackCreated = await captureWinningFeedback(env, { draft: updated, topic: captureContext.topic, publishedUrl: updated.published_url, plan });
    await updateRow(env, "drafts", draftId, { feedback_status: "已沉淀" });
  }

  return json({ ok: true, feedbackCreated, project: await getContentProject(env, projectId) });
}

// 只有用户在复盘页看过依据并明确确认，才把有效经验沉淀回素材库。
async function captureWinningFeedback(env, { draft, topic, publishedUrl, plan }) {
  const common = {
    source_url: publishedUrl,
    draft_id: draft.id,
    verification: VERIFICATION.NA,
    verification_note: "来自已发布内容的确定性复盘，不需要逐字核验。",
    performance_basis: plan.candidates[0]?.evidence || "",
  };
  let created = 0;
  for (const card of plan.candidates) {
    const saved = await upsertByTaskKey(env, "materials", stableTaskKey("publish-feedback", draft.id, card.kind), {
      ...common,
      title: card.title.slice(0, 200),
      type: card.type,
      content: card.content,
      feedback_types: card.label,
    });
    if (saved.created) created++;
    await linkMaterialToTopic(env, saved.id, topic.id);
  }

  // 这个选题下用过的故事类素材，标记成「有效故事」——它们参与了一次成功的发布
  const related = await materialsOfTopic(env, topic.id);
  for (const m of related) {
    if (!plan.storyIds.includes(m.id)) continue;
    const merged = [...new Set([...csv(m.feedback_types), "有效故事"])].join(",");
    await updateRow(env, "materials", m.id, { feedback_types: merged, performance_basis: common.performance_basis });
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

  if (body.view === "collections") {
    const row = await getRow(env, "inbox", pageId);
    if (!row || row.capture_origin !== "collection") return json({ ok: false, error: "收藏不存在" }, 404);
    const fields = { body: markdown, selection: markdown };
    if (!row.canonical_url) fields.content_hash = await hashCollectionText(markdown);
    await updateRow(env, "inbox", pageId, fields);
  } else {
    const COLUMN = { inbox: "body", materials: "content", topics: "notes", drafts: "body" }[body.view];
    await updateRow(env, view.table, pageId, { [COLUMN]: markdown });
  }
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
// 写作推动（创作编辑器里的“推动一下”）
//
// 默认 nudge 只给一问；paragraph / finish 只有用户明确选择“帮我写”才会到这里。
// 三种结果都先回到候选卡片，由用户决定是否插入，Worker 不直接改稿件。

const NUDGE_KINDS = new Set(["问题", "新角度", "下一步"]);
const WRITING_TOKENS = {
  nudge: 500,
  paragraph: 1800,
  finish: 9000,
  "material-audit": 2600,
  "quality-review": 3200,
  "fact-check": 3200,
};
const REVIEW_KINDS = {
  "material-audit": "素材查缺",
  "quality-review": "审稿报告",
  "fact-check": "事实核查",
};

async function writingAssist(env, raw) {
  let input;
  try {
    input = normalizeWritingAssistRequest(raw);
  } catch (e) {
    return json({ ok: false, error: e.message }, e.status || 400);
  }

  const user = [
    `【模式】${input.mode}`,
    input.title ? `【标题或主题】${input.title}` : "",
    input.platform ? `【目标平台】${input.platform}` : "",
    input.style ? `【默认写作风格】\n${input.style}` : "",
    input.expert ? `【本轮调用专家】\n${input.expert}` : "",
    input.materials ? `【这篇已采用的素材】\n${input.materials}` : "",
    input.overview ? `【全文开头（仅用于理解主题）】\n${input.overview}` : "",
    `【光标前文】\n${input.before || "（光标在文首）"}`,
    "【当前光标】← 本次提问或续写必须以这里为中心",
    `【光标后文】\n${input.after || "（光标在文末）"}`,
  ].filter(Boolean).join("\n\n");

  // “完成全文”可能持续一两分钟，但任何字在外显前都必须先收齐并过真实性闸门。
  // 期间发空白心跳，调用方仍能把最终响应当 JSON 读取。
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const beat = setInterval(() => {
        try { controller.enqueue(encoder.encode("\n")); } catch { /* 客户端已离开 */ }
      }, 10_000);
      const send = (payload) => controller.enqueue(encoder.encode(JSON.stringify(payload)));
      try {
        if (input.mode === "nudge") {
          const { json: out } = await chatJson(env, {
            system: WRITING_ASSIST_PROMPT,
            user,
            maxTokens: WRITING_TOKENS.nudge,
            task: "writing",
          });
          const text = String(out?.text || "").trim().slice(0, 180);
          if (!text) throw new Error("AI 没有给出有效推动");
          assertGroundedGeneratedText(text, []);
          send({ ok: true, mode: input.mode, kind: NUDGE_KINDS.has(out?.kind) ? out.kind : "问题", text });
        } else {
          const { content } = await chat(env, {
            system: WRITING_ASSIST_PROMPT,
            user,
            maxTokens: WRITING_TOKENS[input.mode],
            task: "writing",
          });
          const text = unfence(content);
          if (!text) throw new Error("AI 没有生成可用正文");
          if (REVIEW_KINDS[input.mode]) {
            // 检查报告只指出问题，不写回正文；事实核查中的“待核”也不能被真实性闸门
            // 当成新生成的叙事拦掉。
            send({ ok: true, mode: input.mode, kind: REVIEW_KINDS[input.mode], text });
          } else {
            // 当前编辑器正文是用户这次亲手提供的额外证据：允许延续已写的真实经历，
            // 但新编的细节和原文对不上，仍会被同一道确定性闸门拒绝。
            const evidence = await personalEvidence(env, input.content ? [{ type: "个人经历", note: input.content }] : []);
            assertGroundedGeneratedText(text, evidence);
            send({ ok: true, mode: input.mode, kind: input.mode === "finish" ? "完成全文" : "续写一段", text });
          }
        }
      } catch (e) {
        const ungrounded = e?.code === "UNGROUNDED_PERSONAL_EXPERIENCE";
        send({
          ok: false,
          error: ungrounded ? "这次续写里出现了上文没有的亲身经历，已经拦下" : String(e?.message || "写作推动失败").slice(0, 800),
          hint: ungrounded ? "再生成一次，或先把真实细节写进正文再让 AI 接着写" : undefined,
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
// 局部修订。候选在浏览器里进入对比态，只有用户点击“采纳”才会替换正文。

async function textRevision(env, raw) {
  let input;
  try {
    input = normalizeTextRevisionRequest(raw);
  } catch (e) {
    return json({ ok: false, error: e.message }, e.status || 400);
  }

  const user = [
    `【模式】${input.label}`,
    input.instruction ? `【具体要求】${input.instruction}` : "",
    input.title ? `【标题或主题】${input.title}` : "",
    input.platform ? `【目标平台】${input.platform}` : "",
    input.before ? `【选区前文】\n${input.before}` : "",
    `【需要修订的原文】\n${input.selected}`,
    input.after ? `【选区后文】\n${input.after}` : "",
  ].filter(Boolean).join("\n\n");

  try {
    const { content } = await chat(env, {
      system: TEXT_REVISION_PROMPT,
      user,
      maxTokens: input.mode === "expand" ? 5000 : 3200,
      task: "writing",
    });
    const text = unfence(content);
    if (!text) throw new Error("AI 没有生成可用的修订文本");
    // 当前全文和被选原文都是用户给出的证据；修订可以换表达，不能凭空长出个人经历。
    const evidenceText = [input.before, input.selected, input.after].filter(Boolean).join("\n\n");
    const evidence = evidenceText ? [{ type: "个人经历", note: evidenceText }] : [];
    assertGroundedGeneratedText(text, evidence);
    return json({ ok: true, mode: input.mode, kind: input.label, text });
  } catch (e) {
    const ungrounded = e?.code === "UNGROUNDED_PERSONAL_EXPERIENCE";
    return json({
      ok: false,
      error: ungrounded ? "这次修订加入了原文没有的亲身经历，已经拦下" : String(e?.message || "局部修订失败").slice(0, 800),
      hint: ungrounded ? "换一种写法，或先把真实细节补进原文再扩写" : undefined,
    }, ungrounded ? 422 : 500);
  }
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
  /**
   * ⚠️ **带上来源上下文**（`inbox.card_markdown`）。初筛把一篇文章拆成原子素材，
   * 好处是可复用可核验，代价是**每条素材都不带它成立的前提**——而写作恰恰需要前提。
   * 和任务3 走的是同一个 `sourceContextOf`，一份实现。
   */
  const context = await sourceContextOf(env, usable);
  let remaining = 36_000;
  const brief = usable.map((r, index) => {
    const note = String(r.content || "").trim().slice(0, Math.max(0, Math.min(6000, remaining)));
    remaining -= note.length;
    const ctx = contextLine(context.get(r.id));
    return [
      `【素材 ${index + 1}】`,
      `标题：${r.title}`,
      `类型：${r.type}`,
      `核验：${r.verification}`,
      r.source_url ? `来源：${r.source_url}` : "",
      `正文：\n${note || "（无正文）"}`,
      // ⚠️ 明确标成「背景」——它不是可引用的素材，见提示词里那条
      ctx ? `背景（仅供理解，不可直接引用）：\n${ctx}` : "",
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
// 一段时间的素材上限。**比 PICK_SCAN 小**：那条是全库找相关（要广），
// 这条是一段时间内聚类（几周的量本来就有限），而且它要模型**读懂每一条之间的关系**，
// 塞太多只会让连接变浅。
const IDEA_SCAN = 120;
const PICK_SCAN = 300;    // 候选上限：一条摘要掐到 160 字，300 条约 1.5 万字，塞得进上下文

/**
 * 一批角度 → 一批**完整的选题卡**。三条来源（洞察 / 素材 / 争点）共用这一个出口。
 *
 * ⚠️ **卡片必须在「出候选的那一刻」就写好，而不是点开再算。**
 * 一句标题回答不了「该不该写、怎么下笔」，而那正是这一屏存在的理由。
 *
 * ⚠️ **出卡只能在这儿。** 卡上最值钱的一项是「手上有哪些素材能用」，
 * 它要求**同时看得到角度和素材库**——洞察那条 skill 跑在本机 vault 上，
 * 够不着 D1，所以「跑批时就写好卡」那条路天然给不出这一项。
 *
 * ⚠️ **一次调用出一批**，不是一条一次：8 条候选跑 8 次 LLM 既慢又贵，
 * 而且模型看不到彼此、会给出几张几乎一样的卡。
 */
async function ideaCards(env, body) {
  const angles = (Array.isArray(body?.items) ? body.items : [])
    .map((x) => String((typeof x === "string" ? x : x?.angle) || "").trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!angles.length) return json({ ok: false, error: "没有给要出卡的角度" }, 400);

  // 素材清单：只取模型判断需要的四列，整行拉回来会把提示词撑爆（`pickMaterials` 的经验）
  const materials = await all(
    env,
    `SELECT id, title, type, substr(content, 1, 120) AS brief FROM materials ${LIST_ORDER} LIMIT ?`,
    PICK_SCAN
  );

  const user = [
    `【要出卡的角度】\n${angles.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
    materials.length
      ? `【素材库清单】\n${materials.map((c) => `id=${c.id} | ${c.type} | ${c.title}${c.brief ? ` | ${String(c.brief).replace(/\s+/g, " ")}` : ""}`).join("\n")}`
      // 库里一条素材都没有时也要出卡：其余几项照样有用，`material_ids` 给空数组就是了
      : "【素材库清单】（空的，material_ids 一律给空数组）",
  ].join("\n\n");

  const { json: out } = await chatJson(env, { system: IDEAS_CARD_PROMPT, user, maxTokens: 2600, task: "pick" });
  return json({ ok: true, cards: normalizeCards(out, angles, materials) });
}

/**
 * 从一件事里拆出**争点**：谁和谁在为什么吵。
 *
 * ⚠️ **这和反应清单不是一件事。** 反应清单问「你什么反应」——那个问题在你还没找到
 * 抓手的时候是答不上来的。争点问「这件事的分歧在哪」，是**在你还没有反应的时候，
 * 帮你找到可以有反应的地方**。所以它排在反应之前，不是替代它。
 *
 * ⚠️ **只吃标题和摘要，不去抓原文。** 抓原文要 Readability（Node 才有），
 * 而且热点条目本来就带摘要。要真读原文，那是工作台侧「读原文」那条路的事。
 */
async function ideaAngles(env, body) {
  const title = String(body?.title || "").trim();
  if (!title) return json({ ok: false, error: "没有给要拆的那件事" }, 400);
  const user = [
    `【这件事】${title.slice(0, 300)}`,
    body?.summary ? `【摘要】${String(body.summary).slice(0, 2000)}` : "",
    body?.url ? `【链接】${String(body.url).slice(0, 500)}` : "",
  ].filter(Boolean).join("\n\n");

  const { json: out } = await chatJson(env, { system: IDEAS_ANGLES_PROMPT, user, maxTokens: 700, task: "pick" });
  // 拆不出真分歧是**正常结果**，不是错误——硬凑的争点比没有更糟
  const found = keepRealAngles(out?.angles, 4);
  if (!found.length) return json({ ok: true, cards: [] });
  // ⚠️ **拆完当场出卡**：候选出来的那一刻就该是完整的一张，而不是让人点开再等一次
  const cards = await ideaCards(env, { items: found.map((a) => a.angle) });
  return cards;
}

/**
 * 把一段时间的素材聚成几个角度。
 *
 * ⚠️ **不写 topics 表。** `tasks/synthesize.js` 那条定时任务干的是同一类活但**写库**，
 * 这一条不是它：写库会触发已有流转（选题进「撰写中」五分钟内就自动成稿），
 * 而且 topics 已经是作废的一层。这儿只回候选给人看。
 *
 * ⚠️ **只传 id / type / title / brief，不传正文全文**（`pickMaterials` 的经验：
 * 几百条整行拉回来会把提示词撑爆）。
 */
async function ideaMaterials(env, body) {
  let span;
  try {
    span = rangeSeconds(body?.from, body?.to);
  } catch (error) {
    return json({ ok: false, error: error.message, hint: error.hint }, error.status || 400);
  }

  const rows = await all(
    env,
    `SELECT id, title, type, substr(content, 1, 160) AS brief FROM materials
      WHERE updated_at BETWEEN ? AND ? ORDER BY updated_at DESC LIMIT ?`,
    span.start, span.end, IDEA_SCAN
  );
  // 这段时间一条素材都没有是**正常结果**，界面照实说，不报错
  if (rows.length < 2) return json({ ok: true, items: [], scanned: rows.length });

  const user = [
    `【时间范围】${body.from} 到 ${body.to}`,
    `【这段时间的素材】\n${rows
      .map((c) => `id=${c.id} | ${c.type} | ${c.title}${c.brief ? ` | ${String(c.brief).replace(/\s+/g, " ")}` : ""}`)
      .join("\n")}`,
  ].join("\n\n");

  const { json: out } = await chatJson(env, { system: IDEAS_MATERIALS_PROMPT, user, maxTokens: 1200, task: "pick" });
  const found = keepGroundedAngles(out?.angles, rows, 6);
  // 这段时间凑不出角度是**正常结果**（一个角度至少要连上两条素材），照实回空
  if (!found.length) return json({ ok: true, cards: [], scanned: rows.length });
  /**
   * ⚠️ **聚完当场出卡**，和争点那条同一条：候选出来的那一刻就该是完整的一张。
   * 这一步会**再打一次 LLM**——值得，因为聚类那一步给的是「哪几条能连起来」，
   * 而卡片要回答的是「给谁看、卡在哪、怎么写」，两件事。
   */
  const cards = await ideaCards(env, { items: found.map((a) => a.angle) });
  return cards;
}

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
