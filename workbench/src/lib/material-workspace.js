// 统一素材工作区适配器。
//
// 收件与灵感都是“来源”，素材才是加工后的可复用内容。页面只展示一条链，
// 详情读写仍交给原来的三个源适配器，避免复制编辑、批注、核验和删除规则。

import { api } from "./api.js";
import { SOURCES, materialEvidence } from "./sources.js";

export const MATERIAL_STAGES = ["待处理", "已收纳", "可用素材", "需核验", "已使用", "已归档"];
export const MATERIAL_VERIFICATIONS = ["待核验", "已核验", "不适用"];

const KIND_LABELS = {
  collection: "收藏来源",
  idea: "灵感来源",
  material: "可复用素材",
};

const CHILD_SOURCES = new Set(["collections", "inbox", "materials"]);

function countOf(value) {
  return Array.isArray(value) ? value.filter(Boolean).length : 0;
}

function relationTrace(entry) {
  const materials = countOf(entry.materialIds);
  const inspirations = countOf(entry.inspirationIds);
  const topics = countOf(entry.topicIds);
  const drafts = countOf(entry.draftIds);
  const parts = [];
  if (entry.kind === "material") parts.push(inspirations ? `来源 ${inspirations}` : "独立素材");
  else parts.push("来源");
  if (entry.kind !== "material") parts.push(materials ? `素材 ${materials}` : "尚未拆成素材");
  if (topics) parts.push(`项目 ${topics}`);
  if (drafts) parts.push(`稿件 ${drafts}`);
  return parts.join(" → ");
}

function childItem(item) {
  const raw = item?.raw || {};
  const sourceKey = raw.sourceKey;
  if (!CHILD_SOURCES.has(sourceKey)) throw new Error("素材来源类型不受支持");
  const record = raw.record || raw;
  return {
    key: raw.entityId || record.id,
    title: item.title,
    sub: item.sub,
    preview: item.preview,
    tags: item.tags,
    badge: item.badge,
    time: item.time,
    warning: item.warning,
    meta: item.meta,
    raw: record,
  };
}

export function mapMaterialWorkspaceItem(entry = {}) {
  const record = entry.record || {};
  const evidence = entry.kind === "material" ? materialEvidence(record) : null;
  const sourceKey = entry.sourceKey;
  const id = entry.id || record.id;
  const trace = relationTrace(entry);
  const kindLabel = KIND_LABELS[entry.kind] || "素材";
  const verification = entry.verificationStatus || record.verificationStatus || "";
  const meta = {
    所在环节: kindLabel,
    处理状态: entry.stage,
    类型: entry.type,
    来源: entry.source,
  };
  if (entry.kind === "material") meta.证据核验 = verification || "不适用";
  meta.内容去向 = trace;
  if (entry.link) meta.原始链接 = entry.link;

  return {
    key: `${sourceKey}:${id}`,
    title: entry.title || "（无标题）",
    sub: [kindLabel, entry.type].filter(Boolean).join(" · "),
    preview: entry.excerpt || record.note || record.selection || "",
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    kindLabel,
    badge: entry.stage || "",
    time: entry.updatedAt || record.editedAt || "",
    warning: evidence?.warning || null,
    trace,
    meta,
    raw: {
      ...record,
      sourceKey,
      entityId: id,
      kind: entry.kind,
      stage: entry.stage,
      record,
      link: entry.link || record.link || "",
      source: entry.source || record.source || "",
      verificationStatus: verification,
      verificationNote: entry.verificationNote || record.verificationNote || "",
      materialIds: entry.materialIds || record.materialIds || [],
      inspirationIds: entry.inspirationIds || record.inspirationIds || [],
      topicIds: entry.topicIds || record.topicIds || [],
      draftIds: entry.draftIds || record.draftIds || [],
    },
  };
}

async function dispatch(item, method, payload) {
  const sourceKey = item?.raw?.sourceKey;
  const source = SOURCES[sourceKey];
  if (!source || !CHILD_SOURCES.has(sourceKey) || typeof source[method] !== "function") {
    throw new Error("这一条素材不支持当前操作");
  }
  return source[method](childItem(item), payload);
}

function mapResult(result) {
  return {
    exists: true,
    items: (result.items || []).map(mapMaterialWorkspaceItem),
    nextCursor: result.nextCursor || null,
    total: Number(result.total || 0),
    counts: { ...(result.counts || {}), total: Number(result.total || 0) },
    facets: result.facets || { types: [], verifications: [] },
  };
}

export const MATERIAL_WORKSPACE = {
  key: "material-workspace",
  label: "素材工作区",
  panelLabel: "全部来源与素材",
  eyebrow: "source chain",
  eyebrowCn: "从输入到成稿",
  sub: "收进来的内容、提炼出的观点和已经进入项目的素材，都沿着同一条链查看和处理。",
  kind: "pipeline",
  board: false,
  isMaterialWorkspace: true,
  goView: "materials",
  recentType: "materials",
  stateTabs: MATERIAL_STAGES,
  facet: { key: "type", label: "类型", server: true },
  verificationFilters: MATERIAL_VERIFICATIONS,
  serverFilters: true,
  emptyHint: "还没有来源或素材",
  annotateLabel: "批注存进流水线，只在这个工作台里看得到",
  edit: {
    target: "素材工作区",
    save: "保存修改",
    hint: "整篇替换正文；库里没有版本历史，存下去就是覆盖",
  },

  async list(params = {}) {
    return mapResult(await api.materialWorkspace({ ...params, pageSize: 30 }));
  },

  async search(params = {}) {
    return mapResult(await api.materialWorkspace({ ...params, pageSize: 100 }));
  },

  async load(item) {
    const detail = await dispatch(item, "load");
    return {
      ...detail,
      meta: { ...item.meta, ...(detail.meta || {}) },
      warning: item.warning || detail.warning,
    };
  },

  annotate: (item, payload) => dispatch(item, "annotate", payload),
  save: (item, payload) => dispatch(item, "save", payload),
  remove: (item) => dispatch(item, "remove"),
  removeLabel: "永久删除",
  highlightPath: () => "",
  sourceOf(item) {
    const source = SOURCES[item?.raw?.sourceKey];
    return source?.sourceOf?.(childItem(item)) || item?.raw?.link || item?.title || "";
  },
  childItem,
};
