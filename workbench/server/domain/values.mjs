export const MATERIAL_TYPES = Object.freeze([
  "核心观点", "金句/原话", "数据/事实", "案例/故事", "框架/模型",
  "反直觉点", "个人经历", "延展问题", "标题样本", "内容角度", "平台反馈",
]);

export const MATERIAL_TYPE_SET = new Set(MATERIAL_TYPES);
export const VERBATIM_MATERIAL_TYPES = new Set(["金句/原话", "数据/事实"]);
export const VERIFICATION = Object.freeze({ NA: "不适用", PENDING: "待核验", VERIFIED: "已核验" });
export const PLATFORMS = Object.freeze(["公众号", "X", "小红书", "视频号", "YouTube"]);
export const PRIORITIES = Object.freeze(["高", "中", "低"]);

export const CAPTURE_STATUS = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  ARCHIVED: "archived",
  DISCARDED: "discarded",
  NEEDS_REVIEW: "needs_review",
});

export const SEED_STATUS = Object.freeze({ KEEPING: "keeping", WRITTEN: "written", DROPPED: "dropped" });
export const SEED_REACTION_GROUPS = Object.freeze([
  Object.freeze({ label: "对着一个观点", items: Object.freeze(["同意，而且我有个例子", "不同意，因为…", "这个说法有个前提没说出来", "说得对，但只在某种情况下成立", "我以前也这么以为，后来发现…"]) }),
  Object.freeze({ label: "对着一件事 / 一个发布", items: Object.freeze(["我试了，说说体感", "这件事真正的影响是…", "和之前 / 别家比，变的是…"]) }),
  Object.freeze({ label: "都能用", items: Object.freeze(["这让我想起另一件事", "这解释了我一直没想明白的"]) }),
]);
export const SEED_REACTIONS = Object.freeze(SEED_REACTION_GROUPS.flatMap((group) => group.items));
export const PROJECT_STATUS = Object.freeze({ ACTIVE: "active", GENERATING: "generating", PARKED: "parked" });
export const DRAFT_WORKFLOW = Object.freeze({ WRITING: "写作中", READY: "待发布", PUBLISHED: "已发布", ABANDONED: "已弃用" });
export const PUBLICATION_STATUS = Object.freeze({ UNPUBLISHED: "未发布", PUBLISHED: "已发布" });
export const REVIEW_STATUS = Object.freeze(["样本不足", "普通", "表现突出"]);
export const PROJECT_STAGES = Object.freeze(["策划中", "生成中", "写作中", "待发布", "待复盘", "已完成", "已搁置", "需处理"]);

export const ENTRY_KINDS = Object.freeze(["concept", "product", "method", "person", "work", "stance"]);
export const ENTRY_KIND_SET = new Set(ENTRY_KINDS);
export const ENTRY_KIND_LABELS = Object.freeze({
  concept: "概念", product: "产品", method: "方法论", person: "人物", work: "作品", stance: "我的主张",
});
export const ENTRY_FACT_STATUS = Object.freeze({ ACTIVE: "active", SUPERSEDED: "superseded", DISPUTED: "disputed" });

/**
 * 词条之间的关系类型。**没有「相关」这一项，这是故意的。**
 *
 * 「A 和 B 相关」不携带任何信息——两个词条既然都在你的库里，多半都沾点边。
 * 有用的是「A 基于 B」「A 和 B 对比后更强」「A 被 B 采用」这种能反过来读的关系：
 * 写作时你要的是「这个说法建立在什么之上」，不是「这个说法旁边还有什么」。
 *
 * ⚠️ 取值必须匹配 `entity_relations.relation_type` 的 CHECK（小写、数字、下划线、连字符）。
 */
export const ENTRY_RELATION_TYPES = Object.freeze([
  "based_on", "contrasts_with", "same_kind_as", "adopted_by", "part_of", "example_of", "contradicts",
]);
export const ENTRY_RELATION_SET = new Set(ENTRY_RELATION_TYPES);
/**
 * 每种关系**怎么读**。给模型看的是这一份，不是类型名。
 *
 * ⚠️ 只给类型名的话方向会反。实测跑出过 `行为经济学 example_of 损失厌恶`——
 * 而模型自己写的理由是「损失厌恶……是行为经济学研究的现象之一」，
 * 它知道事实，只是不知道这个字段该从哪头往哪头读。方向错的关系比没有关系更糟：
 * 写作时它会把从属关系整个颠倒过来推给你。
 */
export const ENTRY_RELATION_READINGS = Object.freeze({
  based_on: "A 建立在 B 之上（B 是更基础的那个）",
  contrasts_with: "A 与 B 形成对照（双向对等）",
  same_kind_as: "A 和 B 是同一类东西（双向对等）",
  adopted_by: "A 被 B 采用（B 是使用方）",
  part_of: "A 是 B 的组成部分（B 是整体）",
  example_of: "A 是 B 的一个例子（B 是更一般的那个）",
  contradicts: "A 与 B 互相冲突（双向对等）",
});

export const ENTRY_RELATION_LABELS = Object.freeze({
  based_on: "基于", contrasts_with: "对比", same_kind_as: "同属", adopted_by: "被采用",
  part_of: "属于", example_of: "是……的例子", contradicts: "与之冲突",
});

export const MUTATING_ACTIONS = Object.freeze([
  "capture.create",
  "seed.create",
  "capture.transition",
  "seed.transition",
  "project.create",
  "series.create",
  "series.update",
  "series.article.add",
  "series.section.add",
  "series.entry.update",
  "series.entry.remove",
  "series.entries.reorder",
  "series.project.set",
  "material.create",
  "material.verify",
  "entry.create",
  "entry.fact.add",
  "entry.fact.supersede",
  "entry.fact.dispute",
  "entry.link",
  "entry.merge",
  "draft.create",
  "draft.update",
  "draft.transition",
  "project.transition",
  "project.materials.update",
  "project.primary.set",
  "release.update",
  "publication.create",
  "review.submit",
  "publication.review.submit",
  "review.settle",
  "metrics.record",
  "entity.delete",
  "entity.restore",
  "asset.import",
  "file.write",
  "command.execute",
]);
