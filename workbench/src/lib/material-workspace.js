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

/**
 * 类别那一列的色调。**和 `KIND_LABELS` 挨着放**，界面层不再判第二次——
 * 这个项目的事故清一色是「同一件事写在两个地方」。
 *
 * ⚠️ **这是状态色板的第二个消费者，不是新开一套颜色。**
 * 一屏上两套互不相干的配色，人得先学会哪套是哪套；而这一列本来就是分类维度，
 * 复用同一组色至少保证「同一个颜色在这一屏里只有一个意思」。
 * 分配上跟着链路走：素材是拆好的（`review`＝我做完了等下一步，和上面那条色带同色），
 * 两类来源各占一档冷灰和暖黄，一眼分得出「外面收的」和「自己写的」。
 *
 * **文字仍然是主编码**（每颗上面写着「收藏来源」三个字），颜色只是让一列扫得更快。
 */
const KIND_TONES = {
  collection: "todo",
  idea: "doing",
  material: "review",
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
  const inspirationIds = Array.isArray(entry.inspirationIds) ? entry.inspirationIds.filter(Boolean) : [];
  const kindLabel = KIND_LABELS[entry.kind] || "素材";
  const kindTone = KIND_TONES[entry.kind] || "backlog";
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

  /**
   * 回原文的落点。⚠️ **判据在适配器里，界面层不认识「灵感 / 素材」这些概念。**
   *
   * 初筛把一篇文章拆成原子素材（一条只讲一件事），好处是可复用、可逐字核验，
   * 代价是**每条素材都不带它成立的前提**。原文一直在库里（`inbox`），
   * 只是界面上没有一条路走回去——这就是那条路。
   *
   * ⚠️ **手动入库的素材没有来源**（`/金句` 那类直接写素材库）。这时给空串，
   * 调用方据此**不画那个入口**，而不是画一个点了没反应的。
   */
  const sourceOpen = entry.kind === "material" && inspirationIds[0] ? `inbox:${inspirationIds[0]}` : "";

  return {
    key: `${sourceKey}:${id}`,
    sourceOpen,
    title: entry.title || "（无标题）",
    sub: [kindLabel, entry.type].filter(Boolean).join(" · "),
    preview: entry.excerpt || record.note || record.selection || "",
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    kindLabel,
    kindTone,
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
    counts: materialWorkspaceCounts(result.counts, result.total),
    facets: result.facets || { types: [], verifications: [] },
  };
}

export function materialWorkspaceCounts(counts = {}, filteredTotal = 0) {
  const total = MATERIAL_STAGES.reduce((sum, stage) => sum + Number(counts?.[stage] || 0), 0);
  return { ...(counts || {}), total: total || Number(filteredTotal || 0) };
}

// 页面路由沿用通用 Studio 的 `state`，Worker 的统一素材读模型只认 `stage`。
// 这个转换必须放在适配器边界，否则界面会显示“已选中”，列表却仍然查全部数据。
export function materialWorkspaceQuery(params = {}) {
  const { state = "", ...query } = params;
  return { ...query, stage: query.stage || state };
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
    return mapResult(await api.materialWorkspace(materialWorkspaceQuery({ ...params, pageSize: 30 })));
  },

  async search(params = {}) {
    return mapResult(await api.materialWorkspace(materialWorkspaceQuery({ ...params, pageSize: 100 })));
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
  removeLabel: "移入回收站",
  highlightPath: () => "",
  sourceOf(item) {
    const source = SOURCES[item?.raw?.sourceKey];
    return source?.sourceOf?.(childItem(item)) || item?.raw?.link || item?.title || "";
  },
  childItem,
};
