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

export const MUTATING_ACTIONS = Object.freeze([
  "capture.create",
  "seed.create",
  "capture.transition",
  "seed.transition",
  "project.create",
  "series.create",
  "series.update",
  "series.chapter.create",
  "series.chapter.update",
  "series.chapter.link",
  "series.chapters.reorder",
  "material.create",
  "material.verify",
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
