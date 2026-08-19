import { normMaterialType } from "./values.js";

const MAX_MATERIAL_DRAFTS = 6;

function cleanTitle(value) {
  return String(value || "").replace(/[\u200B-\u200F\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

export function cleanCollectionTags(value) {
  return (Array.isArray(value) ? value : [])
    .map(String)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * 一篇长收藏可以沉淀多张素材卡。`key` 在预览时生成，确认时原样带回，
 * 同一次预览重复确认仍命中相同 task_key，不会因为标题被用户改过就重复建卡。
 * 同时兼容旧版单个 `materialDraft`，避免工作台与 Worker 短暂版本错位时丢数据。
 */
export function normalizeMaterialDrafts(input = {}, row = {}) {
  const supplied = Array.isArray(input.materialDrafts)
    ? input.materialDrafts
    : input.materialDraft
      ? [input.materialDraft]
      : [];
  const candidates = supplied.length ? supplied : [{}];
  const seen = new Set();
  return candidates.slice(0, MAX_MATERIAL_DRAFTS).map((draft, index) => {
    const requestedKey = String(draft?.key || `material-${index + 1}`).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40);
    let key = requestedKey || `material-${index + 1}`;
    while (seen.has(key)) key = `${key}-${index + 1}`;
    seen.add(key);
    return {
      key,
      title: cleanTitle(draft?.title || input.title || row.title),
      type: normMaterialType(draft?.type),
      content: String(draft?.content || row.selection || row.body || "").trim().slice(0, 20_000),
      sourceUrl: String(draft?.sourceUrl || row.link || "").slice(0, 2048),
      tags: cleanCollectionTags(draft?.tags),
    };
  });
}
