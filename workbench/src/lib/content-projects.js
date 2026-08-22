/**
 * 内容项目在界面上的阶段顺序。
 *
 * 这不是数据库状态清单：Worker 会把 topic/draft/发布事实聚合成 stage，前端只按
 * 这个稳定契约排版。尤其不能把 drafts 的「待修改」擅自翻译成「待发布」。
 */
export const PROJECT_STAGES = ["策划中", "生成中", "写作中", "待发布", "待复盘", "已完成", "已搁置", "需处理"];

export const PROJECT_STAGE_META = {
  策划中: { index: "01", label: "策划", hint: "把想法变成一个可写的任务" },
  生成中: { index: "02", label: "生成", hint: "流水线正在建立主稿" },
  写作中: { index: "03", label: "写作", hint: "完成、修改并核对主稿" },
  待发布: { index: "04", label: "发布", hint: "排版、发布并记录链接" },
  待复盘: { index: "05", label: "复盘", hint: "补齐数据，留下下一篇的判断" },
  已完成: { index: "06", label: "完成", hint: "已经发布并留下复盘结论" },
  已搁置: { index: "—", label: "搁置", hint: "暂不推进，但保留全部内容" },
  需处理: { index: "!", label: "需处理", hint: "关系或状态有歧义，需要你决定" },
};

const ACTION_PRIORITY = new Map(["需处理", "待发布", "写作中", "待复盘", "策划中"].map((stage, i) => [stage, i]));

/**
 * 项目详情页上那三档。**判据只写这一处。**
 *
 * ⚠️ **详情页不再画七段流程线。** 那条线画的是 Worker 的状态机，不是你的动线：
 * 七段里有三段你根本不出现（生成中＝等 cron、待复盘＝等平台数据、已完成＝终点），
 * 而「诊断」那一段在 Worker 里**没有任何实现**，已经整档撤掉。
 * 更糟的是它会骗人——一篇 0 字的空稿子照样能走到第 4 格并显示"三段已完成"，
 * **进度条画的是流程走了多远，不是内容写了多少**，而这两件事在那一页上长得一模一样。
 *
 * 列表页和看板仍然用细分档（那儿你要一眼看出东西卡在哪一步），
 * 只有详情页收成三档——那一页只需要回答「现在轮到谁、要做什么」。
 */
const PHASES = {
  策划中: "在写", 生成中: "在写", 写作中: "在写",
  待发布: "写完了",
  待复盘: "发出去了", 已完成: "发出去了",
};

export function projectPhase(stage) {
  // 已搁置 / 需处理 不在这条线上，照实说自己的名字，别硬塞进三档里
  return PHASES[stage] || stage || "";
}

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

export function projectOpenTarget(project = {}) {
  return project?.id ? { view: "project", id: project.id } : null;
}
