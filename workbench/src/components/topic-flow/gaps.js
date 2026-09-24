// 补齐一项的进度：改清单里那一行（没有就先加上）；「不写了」另记在 plan.skipped。
// 选题流程的「补齐」和工作区（资料真的挂进来之后）共用这一处，别在两边各写一份。
import { api } from "../../lib/api.js";
import { appendItems, parseChecklist, setItemDone } from "../../lib/content-checklist.js";

export async function markGap(projectId, label, { skip = false } = {}) {
  const { notebook } = await api.projectNotebook(projectId);
  let q = appendItems(notebook.questions, [label]);
  const item = parseChecklist(q).items.find((i) => i.text === label);
  if (item) q = setItemDone(q, item.index, true);
  const plan = skip ? { ...(notebook.plan || {}), skipped: [...new Set([...(notebook.plan?.skipped || []), label])] } : undefined;
  await api.saveProjectNotebook(projectId, { expectedVersion: notebook.version, questions: q, ...(plan ? { plan } : {}) });
}

/**
 * 这一步要补的全部：选定角度的缺口 + 清单里别的待补项（研究时记下的疑问、以前的待补）。
 * 后者当作「可以去找」的一项，和角度缺口一样能让 AI 找 / 自己放 / 不写了，也计入「补齐 x/y」。
 */
export function gapList(view) {
  const gaps = view?.plan?.chosenAngle?.gaps || [];
  const labels = new Set(gaps.map((g) => g.label));
  const others = (view?.checklist || []).filter((c) => !labels.has(c.text)).map((c) => ({ label: c.text, why: "", kind: "find", where: [], other: true }));
  return [...gaps, ...others];
}

/**
 * 一项的状态：不写了 / 已补上 / 还缺。已补上只看清单里这一项有没有勾——
 * 资料真的挂进来、或者那条经历真的记下了才会勾上（经历缺口逐条算，不因为别处记过一条经历就全算补上）。
 */
export function gapState(view, g) {
  if ((view?.plan?.skipped || []).includes(g.label)) return "skip";
  return (view?.checklist || []).some((c) => c.text === g.label && c.done) ? "done" : "open";
}
