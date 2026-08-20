// 素材中心的统一读模型。底层仍保留 inbox / materials 两张业务表，
// 但列表的阶段、排序和筛选都由 Worker 确定，前端不再拉三份数据后自己猜。

import { cursorClause } from "./db.js";

export const MATERIAL_LIBRARY_STAGES = Object.freeze([
  "待处理",
  "已收纳",
  "可用素材",
  "需核验",
  "已使用",
  "已归档",
]);

const VERIFICATIONS = new Set(["", "不适用", "待核验", "已核验"]);

/** 纯逻辑版阶段判定，供列表映射和单测共用。 */
export function materialLibraryStage(item = {}) {
  if (item.kind === "collection") {
    if (item.reviewStatus === "pending") return "待处理";
    if (item.reviewStatus === "archived") return "已归档";
    return "已收纳";
  }
  if (item.kind === "idea") {
    if (["待初筛", "初筛失败/需人工"].includes(item.status)) return "待处理";
    if (item.status === "已弃用") return "已归档";
    return "已收纳";
  }
  if (item.verificationStatus === "待核验") return "需核验";
  if ((item.topicIds?.length || 0) > 0 || (item.draftIds?.length || 0) > 0) return "已使用";
  return "可用素材";
}

/**
 * SQL 中的阶段映射与 materialLibraryStage 逐项对应。
 * 转成灵感的收藏仍只出现一次：capture_origin=collection 时以收藏身份为准。
 */
export const MATERIAL_LIBRARY_CTE = `WITH material_library AS (
  SELECT i.id,
         'collections' AS source_key,
         'collection' AS kind,
         CASE i.review_status
           WHEN 'pending' THEN '待处理'
           WHEN 'archived' THEN '已归档'
           ELSE '已收纳'
         END AS stage,
         i.title AS title,
         i.kind AS type,
         COALESCE(NULLIF(i.save_note, ''), NULLIF(i.selection, ''), NULLIF(i.body, ''), i.card_markdown, '') AS excerpt,
         i.review_status AS status,
         '' AS verification_status,
         COALESCE(NULLIF(i.link, ''), i.canonical_url, '') AS link,
         i.source AS source,
         i.updated_at AS updated_at
    FROM inbox i
   WHERE i.capture_origin = 'collection'

  UNION ALL

  SELECT i.id,
         'inbox' AS source_key,
         'idea' AS kind,
         CASE
           WHEN i.status IN ('待初筛', '初筛失败/需人工') THEN '待处理'
           WHEN i.status = '已弃用' THEN '已归档'
           ELSE '已收纳'
         END AS stage,
         i.title AS title,
         i.kind AS type,
         COALESCE(NULLIF(i.verdict, ''), NULLIF(i.card_markdown, ''), i.body, '') AS excerpt,
         i.status AS status,
         '' AS verification_status,
         i.link AS link,
         i.source AS source,
         i.updated_at AS updated_at
    FROM inbox i
   WHERE i.capture_origin = 'idea'

  UNION ALL

  SELECT m.id,
         'materials' AS source_key,
         'material' AS kind,
         CASE
           WHEN m.verification = '待核验' THEN '需核验'
           WHEN m.draft_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM topic_materials tm WHERE tm.material_id = m.id)
             THEN '已使用'
           ELSE '可用素材'
         END AS stage,
         m.title AS title,
         m.type AS type,
         m.content AS excerpt,
         '' AS status,
         m.verification AS verification_status,
         m.source_url AS link,
         '' AS source,
         m.updated_at AS updated_at
    FROM materials m
)`;

export function parseMaterialLibraryQuery(url) {
  const stage = String(url.searchParams.get("stage") || "").trim();
  const type = String(url.searchParams.get("type") || "").trim().slice(0, 80);
  const verification = String(url.searchParams.get("verification") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 200);
  const cursor = String(url.searchParams.get("cursor") || "").trim();
  const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize")) || 30, 1), 100);

  if (stage && !MATERIAL_LIBRARY_STAGES.includes(stage)) throw new Error(`stage 不合法：${stage}`);
  if (!VERIFICATIONS.has(verification)) throw new Error(`verification 不合法：${verification}`);
  return { stage, type, verification, q, cursor, pageSize };
}

/** 只拼接固定列名，所有用户输入都走 bind 参数。 */
export function materialLibraryWhere(filters = {}, { stage = true, type = true, verification = true, cursor = false } = {}) {
  const clauses = [];
  const params = [];
  if (stage && filters.stage) { clauses.push("stage = ?"); params.push(filters.stage); }
  if (type && filters.type) { clauses.push("type = ?"); params.push(filters.type); }
  if (verification && filters.verification) { clauses.push("verification_status = ?"); params.push(filters.verification); }
  if (filters.q) {
    const like = `%${filters.q}%`;
    clauses.push("(title LIKE ? OR excerpt LIKE ? OR link LIKE ? OR source LIKE ?)");
    params.push(like, like, like, like);
  }
  if (cursor && filters.cursor) {
    const cur = cursorClause(filters.cursor);
    if (cur.sql) { clauses.push(cur.sql); params.push(...cur.params); }
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}
