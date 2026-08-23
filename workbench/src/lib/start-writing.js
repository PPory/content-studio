// 开始写一篇：建项目 → 记账 → 给出该去哪。
//
// ⚠️ **写作只有一个地方：`#/project/:id`。** 这个文件存在的全部理由是
// 三条起点（空白 / 素材 / 访谈）加上种子那条，**入口的出口只能有一份**。
// 各写一遍的话，迟早出现「从素材起稿会标记种子、从访谈起稿不会」这种
// 谁也说不清、也不报错的差别——这个项目所有事故都是这么来的。

import { api } from "./api.js";
import { creationApi, deriveDraftTitle } from "./creation-api.js";

/**
 * @returns {Promise<string>} 项目 id，调用方拿它 `onGo("project", id)`
 *
 * ⚠️ **平台是必填的**（Worker 的 `normalizeCreationRequest` 会拒），而且
 * **主稿的平台建完就改不了**（`EDITABLE.drafts` 里没有 `platform`，只能加平台变体）。
 * 所以每条入口都必须在点下去之前把平台问清楚——默认一个「大概是公众号吧」
 * 的代价是你事后只能重开一篇。
 */
export async function startWriting({
  platform,
  title = "",
  body = "",
  mode = "blank",
  materialIds = [],
  viewpoint = "",
  audience = "",
  interviewEvidence = "",
  seed = null,
}) {
  const result = await creationApi.create({
    kind: "draft",
    mode,
    platform,
    // 标题此刻只是个临时值——到项目页第一件事就能改它，所以**不为它多问一步**。
    // `deriveDraftTitle` 自己兜到「未命名稿」，空标题会被 Worker 直接拒。
    title: deriveDraftTitle(title, body),
    body,
    materialIds,
    viewpoint,
    audience,
    interviewEvidence,
  });

  /**
   * ⚠️ **入库成功才记账，而且 `draftId` 不是可选的。**
   * 项目页靠 `seeds.draft_id` 反查「这篇是从哪句话来的」——不回填的话，
   * 那一页上「来源」整块不会出现，而屏幕上没有任何地方说得清为什么。
   *
   * 记账失败不能让写作失败：稿子已经建好了，这时报错的话用户会以为白写了、
   * 再点一次，于是有两个项目。所以吞掉，只留一行警告。
   */
  if (seed?.id && result.draft?.id) {
    await api.updateSeed(seed.id, { status: "写了", draftId: result.draft.id })
      .catch((err) => console.warn("种子状态没记上（稿件已建好）:", err.message));
  }

  const projectId = result.project?.id || result.draft?.topicId || "";
  /**
   * ⚠️ **拿不到 id 就抛，绝不静默返回空串。**
   * 调用方拿它去 `onGo("project", id)`——空串的话什么都不会发生，
   * 而屏幕上没有任何东西变，用户看到的就是「点了没反应」，然后再点一次，
   * 于是有两个项目。**最坏的失败方式是让人以为它没在工作。**
   */
  if (!projectId) throw new Error("稿子建好了，但没拿到项目地址。去「内容」那一页能找到它");
  return projectId;
}
