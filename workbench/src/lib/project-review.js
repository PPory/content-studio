const value = (number) => (number === null || number === undefined ? "" : String(number));

export function projectReviewForm(project = {}) {
  const review = project?.review || {};
  return {
    draftId: review.draftId || project?.publication?.latest?.draftId || "",
    status: ["样本不足", "普通", "表现突出", "已沉淀"].includes(review.status) ? (review.status === "已沉淀" ? "表现突出" : review.status) : "样本不足",
    basis: review.basis || "",
    conclusion: review.conclusion || "",
    nextExperiment: review.nextExperiment || "",
    captureFeedback: review.status === "已沉淀",
    metrics: {
      views: value(review.metrics?.views),
      likes: value(review.metrics?.likes),
      comments: value(review.metrics?.comments),
      collects: value(review.metrics?.collects),
      shares: value(review.metrics?.shares),
    },
  };
}

export function projectReviewPayload(form = {}) {
  return {
    draftId: form.draftId || "",
    status: form.status || "",
    basis: form.basis || "",
    conclusion: form.conclusion || "",
    nextExperiment: form.nextExperiment || "",
    captureFeedback: form.captureFeedback === true,
    metrics: { ...(form.metrics || {}) },
  };
}

export function reviewGoal(project = {}) {
  const draftId = project?.review?.draftId || project?.publication?.latest?.draftId;
  const drafts = [project?.masterDraft, ...(project?.variants || [])].filter(Boolean);
  const draft = drafts.find((item) => item.id === draftId) || drafts[0];
  return draft?.release?.interactionGoal || project?.brief?.viewpoint || "这篇发布时没有写明互动目标，复盘时先回到当时想验证的问题。";
}
