import { all, first, getRow, insertRow, updateRow, upsertByTaskKey, setTags, now } from "./db.js";
import { INBOX_STATUS, normMaterialType, VERIFICATION } from "./values.js";
import { fetchArticle } from "./reader.js";
import { chatJson } from "./llm.js";
import { modelFor } from "./models.js";
import { COLLECTION_ORGANIZE_PROMPT, KNOWLEDGE_CARD_PROMPT } from "../prompts.js";
import { canonicalizeUrl, hashCollectionText } from "./collection-key.js";

const VIDEO_HOSTS = /(?:youtube\.com|youtu\.be|bilibili\.com|vimeo\.com|douyin\.com)/i;
const ACTIONS = new Set(["keep", "archive", "idea", "material"]);
const REVIEW = new Set(["pending", "kept", "archived"]);
function cleanTitle(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
}

function collectionTitle({ title, url, selection, content }) {
  if (cleanTitle(title)) return cleanTitle(title);
  if (selection) return cleanTitle(selection.slice(0, 60));
  const firstLine = String(content || "").split(/\r?\n/).find((line) => line.trim());
  if (firstLine) return cleanTitle(firstLine.slice(0, 60));
  try { return new URL(url).hostname; } catch { return "未命名收藏"; }
}

export async function storeCollection(env, input = {}) {
  const content = String(input.content || "").trim().slice(0, 20_000);
  const selection = String(input.selection || "").trim().slice(0, 8_000);
  const detectedUrl = content.match(/https?:\/\/[^\s]+/i)?.[0] || "";
  const rawUrl = String(input.url || detectedUrl).trim().slice(0, 2048);
  const canonicalUrl = canonicalizeUrl(rawUrl);
  if (rawUrl && !canonicalUrl) throw new Error("url 不合法");
  if (!content && !selection && !canonicalUrl) throw new Error("content、selection、url 至少填写一项");

  const contentHash = canonicalUrl ? "" : await hashCollectionText(selection || content);
  let duplicate = null;
  if (canonicalUrl) duplicate = await first(env, "SELECT id, title FROM inbox WHERE capture_origin = 'collection' AND canonical_url = ? ORDER BY created_at DESC LIMIT 1", canonicalUrl);
  else if (contentHash) duplicate = await first(env, "SELECT id, title FROM inbox WHERE capture_origin = 'collection' AND content_hash = ? ORDER BY created_at DESC LIMIT 1", contentHash);
  if (duplicate && !input.saveDuplicate) return { ok: true, duplicate: true, existing: duplicate };

  const title = collectionTitle({ title: input.title, url: canonicalUrl, selection, content });
  const kind = canonicalUrl ? (VIDEO_HOSTS.test(canonicalUrl) ? "视频链接" : "文章链接") : selection || content.length > 120 ? "摘录" : "想法";
  const id = await insertRow(env, "inbox", {
    title,
    kind,
    link: rawUrl || canonicalUrl,
    source: String(input.source || "工作台").trim().slice(0, 120),
    body: content,
    status: INBOX_STATUS.PENDING,
    capture_origin: "collection",
    processing_mode: "hold",
    review_status: "pending",
    save_note: String(input.saveNote || "").trim().slice(0, 1000),
    selection,
    canonical_url: canonicalUrl,
    content_hash: contentHash,
    snapshot_status: canonicalUrl ? "pending" : "not_needed",
  });
  return { ok: true, duplicate: false, id, title, type: kind, snapshotStatus: canonicalUrl ? "pending" : "not_needed" };
}

export async function refreshCollectionSnapshot(env, id) {
  const row = await getRow(env, "inbox", id);
  if (!row || row.capture_origin !== "collection" || !row.link) throw new Error("收藏不存在或不是链接");
  await updateRow(env, "inbox", id, { snapshot_status: "pending", snapshot_error: "" });
  const result = await fetchArticle(row.link, env);
  if (!result.ok) {
    await updateRow(env, "inbox", id, { snapshot_status: "failed", snapshot_error: String(result.reason || "抓取失败").slice(0, 500) });
    return { ok: false, id, snapshotStatus: "failed", error: result.reason || "抓取失败" };
  }
  const fields = { body: String(result.body || "").slice(0, 20_000), snapshot_status: "ready", snapshot_error: "", snapshot_at: now() };
  if (!row.title || row.title === row.link || row.title === row.canonical_url || row.title === "未命名收藏") fields.title = cleanTitle(result.title) || row.title;
  await updateRow(env, "inbox", id, fields);
  return { ok: true, id, snapshotStatus: "ready", title: fields.title || row.title };
}

export async function collectionSummary(env) {
  const row = await first(env, `SELECT COUNT(*) AS total,
    SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN review_status = 'kept' THEN 1 ELSE 0 END) AS kept,
    SUM(CASE WHEN review_status = 'archived' THEN 1 ELSE 0 END) AS archived,
    MIN(CASE WHEN review_status = 'pending' THEN created_at END) AS oldest_pending
    FROM inbox WHERE capture_origin = 'collection'`);
  return {
    total: Number(row?.total || 0), pending: Number(row?.pending || 0), kept: Number(row?.kept || 0), archived: Number(row?.archived || 0),
    oldestPendingAt: row?.oldest_pending ? new Date(row.oldest_pending * 1000).toISOString() : null,
  };
}

function compactCollection(row) {
  return {
    id: row.id, title: row.title, type: row.kind, source: row.source, url: row.link,
    saveNote: row.save_note, selection: row.selection, content: String(row.body || "").slice(0, 4000),
  };
}

export async function previewCollectionOrganize(env, input = {}) {
  const ids = [...new Set((Array.isArray(input.ids) ? input.ids : []).map(String))].slice(0, 20);
  if (!ids.length) throw new Error("至少选择一条收藏");
  const holes = ids.map(() => "?").join(",");
  const rows = await all(env, `SELECT * FROM inbox WHERE capture_origin = 'collection' AND id IN (${holes})`, ...ids);
  if (!rows.length) throw new Error("选中的收藏已不存在");
  const { json } = await chatJson(env, {
    system: COLLECTION_ORGANIZE_PROMPT,
    user: JSON.stringify(rows.map(compactCollection)),
    maxTokens: 6000,
    task: "synthesize",
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set();
  const suggestions = (Array.isArray(json?.suggestions) ? json.suggestions : []).flatMap((raw) => {
    const id = String(raw?.id || "");
    if (!byId.has(id) || seen.has(id)) return [];
    seen.add(id);
    const action = ACTIONS.has(raw?.action) ? raw.action : "keep";
    const materialDraft = action === "material" ? {
      title: cleanTitle(raw?.materialDraft?.title || raw?.title || byId.get(id).title),
      type: normMaterialType(raw?.materialDraft?.type),
      content: String(raw?.materialDraft?.content || byId.get(id).selection || byId.get(id).body || "").trim().slice(0, 20_000),
      sourceUrl: String(raw?.materialDraft?.sourceUrl || byId.get(id).link || "").slice(0, 2048),
      tags: (Array.isArray(raw?.materialDraft?.tags) ? raw.materialDraft.tags : []).map(String).map((x) => x.trim()).filter(Boolean).slice(0, 6),
    } : null;
    return [{ id, action, reason: String(raw?.reason || "").slice(0, 500), title: cleanTitle(raw?.title || byId.get(id).title), tags: (Array.isArray(raw?.tags) ? raw.tags : []).map(String).slice(0, 6), materialDraft, updatedAt: new Date(byId.get(id).updated_at * 1000).toISOString() }];
  });
  for (const row of rows) if (!seen.has(row.id)) suggestions.push({ id: row.id, action: "keep", reason: "AI 未给出可靠建议，先保留。", title: row.title, tags: [], materialDraft: null, updatedAt: new Date(row.updated_at * 1000).toISOString() });
  return { ok: true, suggestions };
}

export async function applyCollectionOrganize(env, input = {}) {
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, 20);
  if (!items.length) throw new Error("没有要确认的整理动作");
  const results = [];
  for (const item of items) {
    const id = String(item?.id || "");
    try {
      const row = await getRow(env, "inbox", id);
      if (!row || row.capture_origin !== "collection") { results.push({ id, ok: false, status: 404, error: "收藏不存在" }); continue; }
      const expected = Math.floor(Date.parse(String(item.updatedAt || "")) / 1000);
      if (!Number.isFinite(expected) || expected !== row.updated_at) { results.push({ id, ok: false, status: 409, error: "内容已变化，请重新预览" }); continue; }
      const action = ACTIONS.has(item.action) ? item.action : null;
      if (!action) { results.push({ id, ok: false, status: 400, error: "整理动作不合法" }); continue; }
      const title = cleanTitle(item.title || row.title);
      if (action === "keep") await updateRow(env, "inbox", id, { title, review_status: "kept" });
      if (action === "archive") await updateRow(env, "inbox", id, { title, review_status: "archived" });
      if (action === "idea") await updateRow(env, "inbox", id, { title, review_status: "kept", processing_mode: "triage", status: INBOX_STATUS.PENDING });
      let materialId = "";
      if (action === "material") {
        const draft = item.materialDraft || {};
        const saved = await upsertByTaskKey(env, "materials", `collection-organize:${id}:material`, {
          title: cleanTitle(draft.title || title), content: String(draft.content || row.selection || row.body || "").trim().slice(0, 20_000),
          type: normMaterialType(draft.type), source_url: String(draft.sourceUrl || row.link || "").slice(0, 2048), inbox_id: id,
          verification: VERIFICATION.NA, verification_note: "",
        }, { preserve: ["title", "content", "type", "verification", "verification_note"] });
        materialId = saved.id;
        if (saved.created) await setTags(env, "material", saved.id, Array.isArray(draft.tags) ? draft.tags.slice(0, 6) : []);
        await updateRow(env, "inbox", id, { title, review_status: "kept" });
      }
      results.push({ id, ok: true, action, materialId: materialId || undefined });
    } catch (error) {
      results.push({ id, ok: false, status: 500, error: String(error?.message || error).slice(0, 500) });
    }
  }
  return { ok: results.some((r) => r.ok), results };
}

export async function previewKnowledgeCard(env, input = {}) {
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 12_000) }));
  if (!messages.some((m) => m.role === "user") || !messages.some((m) => m.role === "assistant")) throw new Error("至少完成一轮提问和回答");
  const source = {
    kind: String(input.source?.kind || "conversation").slice(0, 40), ref: String(input.source?.ref || "").slice(0, 500),
    url: String(input.source?.url || "").slice(0, 2048), title: String(input.source?.title || "").slice(0, 300),
    selection: String(input.source?.selection || "").slice(0, 8000), text: String(input.source?.text || "").slice(0, 16_000),
  };
  const hasEvidence = !!(source.selection.trim() || source.text.trim());
  const { json } = await chatJson(env, { system: KNOWLEDGE_CARD_PROMPT, user: JSON.stringify({ source, messages }), maxTokens: 5000, task: "knowledge" });
  return { ok: true, card: {
    title: cleanTitle(json?.title || source.title || "未命名知识卡"), conclusion: String(json?.conclusion || "").trim(), explanation: String(json?.explanation || "").trim(),
    evidence: hasEvidence ? String(json?.evidence || "").trim() : "", boundaries: String(json?.boundaries || "").trim(), questions: String(json?.questions || "").trim(),
    personalUnderstanding: String(json?.personalUnderstanding || "").trim(), tags: (Array.isArray(json?.tags) ? json.tags : []).map(String).map((x) => x.trim()).filter(Boolean).slice(0, 12),
    sourceKind: source.kind, sourceRef: source.ref, sourceUrl: source.url, sourceTitle: source.title, evidenceStatus: hasEvidence ? "有原文支撑" : "待验证",
    engine: await modelFor(env, "knowledge"),
  }};
}

export function isReviewStatus(value) { return REVIEW.has(value); }
