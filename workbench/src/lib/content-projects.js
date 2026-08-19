/**
 * 内容项目在界面上的阶段顺序。
 *
 * 这不是数据库状态清单：Worker 会把 topic/draft/发布事实聚合成 stage，前端只按
 * 这个稳定契约排版。尤其不能把 drafts 的「待修改」擅自翻译成「待发布」。
 */
export const PROJECT_STAGES = ["策划中", "生成中", "写作中", "待复盘", "已完成", "需处理"];

export const PROJECT_STAGE_META = {
  策划中: { index: "01", label: "策划", hint: "把想法变成一个可写的任务" },
  生成中: { index: "02", label: "生成", hint: "流水线正在建立主稿" },
  写作中: { index: "03", label: "写作", hint: "完成、修改并核对主稿" },
  待复盘: { index: "04", label: "复盘", hint: "补齐数据，留下下一篇的判断" },
  已完成: { index: "05", label: "完成", hint: "已经发布并留下复盘结论" },
  需处理: { index: "!", label: "需处理", hint: "关系或状态有歧义，需要你决定" },
};

const ACTION_PRIORITY = new Map(["需处理", "写作中", "待复盘", "策划中"].map((stage, i) => [stage, i]));

export function projectsFrom(result) {
  return Array.isArray(result?.projects) ? result.projects : [];
}

export function groupProjects(projects = []) {
  const grouped = Object.fromEntries(PROJECT_STAGES.map((stage) => [stage, []]));
  for (const project of projects) {
    const stage = PROJECT_STAGES.includes(project?.stage) ? project.stage : "需处理";
    grouped[stage].push(project);
  }
  return grouped;
}

export function actionableProjects(projects = [], limit = 5) {
  return [...projects]
    // 生成中是流水线的工作，已完成也没有当下动作；两者都不应进「今日」。
    .filter((project) => ACTION_PRIORITY.has(project?.stage))
    .sort((a, b) => {
      const byStage = (ACTION_PRIORITY.get(a?.stage) ?? 99) - (ACTION_PRIORITY.get(b?.stage) ?? 99);
      if (byStage) return byStage;
      return String(b?.updatedAt || "").localeCompare(String(a?.updatedAt || ""));
    })
    .slice(0, limit);
}

/** 兼容期仍复用现有选题/稿件详情。第二阶段才由 ContentProject 接管编辑器。 */
export function projectOpenTarget(project = {}) {
  if (project.masterDraft?.id) return { view: "drafts", id: project.masterDraft.id };
  if (project.topic?.id) return { view: "topics", id: project.topic.id };
  const variant = Array.isArray(project.variants) ? project.variants.find((item) => item?.id) : null;
  return variant ? { view: "drafts", id: variant.id } : null;
}
