// 打开一个旧选题 = 打开它对应的那篇内容（2026-09-24，选题和写作合并）。
//
// 旧选题（研究记录）和历史选题（`legacy:kind:id`）还没有对应内容时，第一次打开才补建；
// 已经有的直接进去。补建由服务端做、可重复调用，这里只负责把人送到对的地方。
import { api } from "./api.js";

/** 旧选题对应的那篇内容的 id：没有就补建（服务端可重复调用）。打开和「先放着」共用。 */
export async function researchProjectId(researchId) {
  let id = String(researchId || "");
  if (id.startsWith("legacy:")) {
    const [, kind, ...rest] = id.split(":");
    id = (await api.intelligenceLegacyTopic(kind, rest.join(":"))).research.id;
  }
  return (await api.researchContent(id)).projectId;
}

export async function openResearchContent(onGo, researchId) {
  const projectId = await researchProjectId(researchId);
  onGo("project", projectId);
  return projectId;
}
