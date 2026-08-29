import { DRAFT_WORKFLOW, PROJECT_STATUS, PUBLICATION_STATUS, REVIEW_STATUS } from "./values.mjs";

const text = (value) => String(value || "").trim();

export function normalizeLegacyDraftWorkflow(value) {
  return value === "待诊断" ? DRAFT_WORKFLOW.WRITING : value;
}

export function nextCaptureStatus(current, action) {
  const rules = {
    accept: { from: ["pending", "needs_review"], to: "accepted" },
    archive: { from: ["pending", "accepted", "needs_review"], to: "archived" },
    discard: { from: ["pending", "accepted", "needs_review", "archived"], to: "discarded" },
    retry: { from: ["needs_review"], to: "pending" },
    restore: { from: ["archived", "discarded"], to: "pending" },
    flag: { from: ["pending"], to: "needs_review" },
  };
  const rule = rules[action];
  if (!rule || !rule.from.includes(current)) throw new Error(`当前收集状态“${current}”不能执行 ${action}`);
  return rule.to;
}

export function nextSeedStatus(current, action) {
  const rules = {
    write: { from: ["keeping"], to: "written" },
    drop: { from: ["keeping"], to: "dropped" },
    restore: { from: ["dropped"], to: "keeping" },
  };
  const rule = rules[action];
  if (!rule || !rule.from.includes(current)) throw new Error(`当前种子状态“${current}”不能执行 ${action}`);
  return rule.to;
}

export function nextDraftWorkflow(currentValue, action) {
  const current = normalizeLegacyDraftWorkflow(currentValue);
  const rules = {
    "finish-writing": { from: [DRAFT_WORKFLOW.WRITING], to: DRAFT_WORKFLOW.READY },
    "return-writing": { from: [DRAFT_WORKFLOW.READY, DRAFT_WORKFLOW.ABANDONED], to: DRAFT_WORKFLOW.WRITING },
    abandon: { from: [DRAFT_WORKFLOW.WRITING, DRAFT_WORKFLOW.READY], to: DRAFT_WORKFLOW.ABANDONED },
    publish: { from: [DRAFT_WORKFLOW.READY], to: DRAFT_WORKFLOW.PUBLISHED },
  };
  const rule = rules[action];
  if (!rule) throw new TypeError("稿件动作不合法");
  if (!rule.from.includes(current)) throw new Error(`当前是“${current}”，不能执行 ${action}`);
  return rule.to;
}

export function assertDraftReadyToFinish(draft, releasePackage) {
  if (!text(draft?.body_markdown ?? draft?.bodyMarkdown)) {
    throw new Error("主稿还是空的，不能进入待发布");
  }
  if (!text(releasePackage?.summary)) {
    throw new Error("发布包缺少摘要，不能进入待发布");
  }
}

export function deriveProjectStage({ project, drafts = [], publications = [], reviews = [], primaryDraftId = null } = {}) {
  if (!project) return { stage: "需处理", reason: "项目不存在", blockers: ["项目不存在"] };
  const activeDrafts = drafts.filter((item) => !item.deleted_at && item.workflow_status !== DRAFT_WORKFLOW.ABANDONED);
  if (project.status === PROJECT_STATUS.PARKED) {
    return { stage: "已搁置", reason: "项目已停止推进，内容仍保留", blockers: [] };
  }
  if (project.status === PROJECT_STATUS.GENERATING && !activeDrafts.length) {
    return { stage: "生成中", reason: "已确认生成，等待候选稿", blockers: [] };
  }
  if (!activeDrafts.length && drafts.length) {
    return { stage: "已搁置", reason: "全部稿件已弃用，内容仍保留", blockers: [] };
  }
  const primary = primaryDraftId ? activeDrafts.find((item) => item.id === primaryDraftId) : activeDrafts.length === 1 ? activeDrafts[0] : null;
  if (primaryDraftId && !primary) return { stage: "需处理", reason: "已确认的主稿不存在", blockers: ["已确认的主稿不存在"] };
  if (activeDrafts.length > 1 && !primary) return { stage: "需处理", reason: "存在多篇稿件，需要确认主稿", blockers: ["需确认主稿"] };
  if (!activeDrafts.length) {
    const gaps = [!text(project.audience) ? "缺少目标读者" : "", !text(project.viewpoint) ? "缺少核心观点" : ""].filter(Boolean);
    return { stage: "策划中", reason: gaps.join("；") || "尚未开始写作", blockers: gaps };
  }
  const published = publications.filter((item) => item.draft_id === primary.id);
  if (primary.publication_status === PUBLICATION_STATUS.PUBLISHED && !published.length) {
    return { stage: "需处理", reason: "稿件标为已发布，但没有发布记录", blockers: ["缺少发布记录"] };
  }
  if (published.length) {
    const review = reviews.find((item) => item.publication_id === published.at(-1).id);
    const reviewStatusComplete = review && (REVIEW_STATUS.includes(review.status) || review.status === "已沉淀");
    const complete = reviewStatusComplete && text(review.basis_markdown) && text(review.conclusion_markdown) && text(review.next_experiment_markdown);
    return complete
      ? { stage: "已完成", reason: "发布记录和复盘完整", blockers: [] }
      : { stage: "待复盘", reason: "已发布，尚未完成复盘", blockers: ["缺少完整复盘"] };
  }
  if (primary.workflow_status === DRAFT_WORKFLOW.READY) return { stage: "待发布", reason: "主稿已完成，可以发布", blockers: [] };
  return { stage: "写作中", reason: text(primary.body_markdown) ? "主稿正在编辑" : "主稿还是空的", blockers: [] };
}