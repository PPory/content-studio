const REVIEW_STATUSES = new Set(["样本不足", "普通", "表现突出"]);
const STORY_TYPES = new Set(["案例/故事", "个人经历"]);

const text = (value, max = 4000) => String(value || "").trim().slice(0, max);

function metric(value, name) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${name}必须是大于等于 0 的整数`);
  return number;
}

export function normalizeProjectReview(input = {}) {
  const status = text(input.status, 20);
  if (!REVIEW_STATUSES.has(status)) throw new Error("请选择样本不足、普通或表现突出");

  const basis = text(input.basis);
  const conclusion = text(input.conclusion);
  const nextExperiment = text(input.nextExperiment);
  if (!basis) throw new Error("请先写下这个判断的依据");
  if (!conclusion) throw new Error("请至少留下一条复盘判断");
  if (!nextExperiment) throw new Error("请写下一篇要改变的具体动作");

  const metrics = input.metrics || {};
  return {
    status,
    basis,
    conclusion,
    nextExperiment,
    captureFeedback: status === "表现突出" && input.captureFeedback === true,
    metrics: {
      views: metric(metrics.views, "阅读/播放"),
      likes: metric(metrics.likes, "点赞"),
      comments: metric(metrics.comments, "评论"),
      collects: metric(metrics.collects, "收藏"),
      shares: metric(metrics.shares, "分享"),
    },
  };
}

export function winningFeedbackPlan({ draft = null, topic = null, materials = [], basis = "" } = {}) {
  if (!draft || !topic) return { candidates: [], storyIds: [] };
  const evidence = text(basis) || `${draft.platform || "当前平台"}发布后表现突出。`;
  const angle = text(topic.viewpoint) || text(topic.title);
  const candidates = [
    {
      kind: "title",
      type: "标题样本",
      label: "有效标题",
      title: `有效标题｜${text(draft.headline, 180)}`,
      content: `${draft.platform || "当前平台"} 已发布标题：${text(draft.headline)}`,
      evidence,
    },
    {
      kind: "angle",
      type: "内容角度",
      label: "有效角度",
      title: `有效角度｜${text(topic.title, 180)}`,
      content: angle,
      evidence,
    },
    {
      kind: "feedback",
      type: "平台反馈",
      label: "平台反馈",
      title: `平台反馈｜${text(draft.headline, 180)}`,
      content: evidence,
      evidence,
    },
  ];
  return {
    candidates,
    storyIds: materials.filter((item) => STORY_TYPES.has(item.type)).map((item) => item.id),
  };
}

export const PROJECT_REVIEW_STATUSES = Object.freeze([...REVIEW_STATUSES]);
