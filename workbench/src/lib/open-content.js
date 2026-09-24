// 打开一个旧选题 = 打开它对应的那篇内容（2026-09-24，选题和写作合并）。
//
// 旧选题（研究记录）和历史选题（`legacy:kind:id`）还没有对应内容时，第一次打开才补建；
// 已经有的直接进去。补建由服务端做、可重复调用，这里只负责把人送到对的地方。
import { api } from "./api.js";

export async function openResearchContent(onGo, researchId) {
  let id = String(researchId || "");
  if (id.startsWith("legacy:")) {
    const [, kind, ...rest] = id.split(":");
    id = (await api.intelligenceLegacyTopic(kind, rest.join(":"))).research.id;
  }
  const { projectId } = await api.researchContent(id);
  onGo("project", projectId);
  return projectId;
}
