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
