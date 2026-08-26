export const EXPERT_KINDS = Object.freeze([
  Object.freeze({ id: "material-research", displayName: "素材查缺", expertId: "material-researcher", expertName: "素材顾问" }),
  Object.freeze({ id: "quality-review", displayName: "Xenho 品控九问", expertId: "quality-reviewer", expertName: "审稿顾问" }),
  Object.freeze({ id: "fact-check", displayName: "事实核查", expertId: "fact-checker", expertName: "事实核查" }),
]);

export const EXPERT_KIND_COMPAT = Object.freeze({
  "material-audit": "material-research",
});

const EXPERT_KIND_BY_ID = new Map(EXPERT_KINDS.map((item) => [item.id, item]));

export function normalizeExpertKind(value = "") {
  const id = String(value || "").trim();
  return EXPERT_KIND_COMPAT[id] || id;
}

export function expertKind(value) {
  return EXPERT_KIND_BY_ID.get(normalizeExpertKind(value)) || null;
}

export function expertKindDisplayName(value, fallback = "专家检查") {
  return expertKind(value)?.displayName || fallback;
}
