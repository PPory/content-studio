/**
 * 待审阅知识候选的判断规则。**Wiki 页的入口横幅和审阅页共用这一份。**
 *
 * 抄两份的后果很具体：横幅说「4 份等你审阅」，进去发现其中 3 份点了就报错——
 * 而「哪些还能接受」正是这两个界面都要回答的同一个问题。
 */

/**
 * 一条候选会碰到的东西的名字。
 *
 * 编译 / 修订 → 会写入的页面；补充来源 → 找到的来源；体检 → 被诊断到的页面。
 * 四种候选形状不同，但在列表行里要回答的是同一个问题：**它要动哪些东西**。
 */
export function subjectsOf(item) {
  if (item?.type === "research") return (item.sources || []).map((source) => ({ name: source.title, isNew: true }));
  if (item?.type === "wiki-lint") {
    const seen = new Set();
    for (const finding of item.findings || []) for (const page of finding.pages || []) seen.add(page);
    return [...seen].map((name) => ({ name, isNew: false }));
  }
  return (item?.pages || []).map((page) => ({
    name: page.title,
    isNew: page.action === "create",
    pageId: page.pageId || "",
    expectedRevision: page.expectedRevision,
  }));
}

/**
 * 这条候选里，**哪几页已经不能写了**。
 *
 * 候选是「读某份资料时算出来的一批改动」，每一页都记着它当时看到的版本
 *（`expectedRevision`）。服务端在写入前会逐页核对（`wiki-pages.mjs` 的
 * `assertPageRevision`），对不上就整份 409。
 *
 * ⚠️ **这件事必须在点之前说出来。** 实测过的真实状态：四份候选全部至少有一页过期
 *（`写作` 候选记的是 v2、库里已经是 v4），也就是屏幕上每一颗「全部接受」点下去都会报错，
 * 而界面此前没有任何迹象。原因不神秘——`结构化提示词` 被三份候选同时盯着，
 * 接受任何一份都会把其余两份顶成过期。
 *
 * `revisions` 是 `pageId → 当前版本号` 的 Map，由调用方从 `api.wiki()` 取。
 * 拿不到版本号时**不判过期**：宁可让服务端拦，也不要凭猜测把能用的按钮变灰。
 */
export function stalePages(item, revisions) {
  if (!revisions || item?.type === "research") return [];
  return (item?.pages || []).filter((page) => {
    if (page.action !== "update" || !page.pageId) return false;
    const live = revisions.get(page.pageId);
    return live != null && live !== page.expectedRevision;
  });
}

/**
 * 哪些页面被**多份候选同时盯着**。
 *
 * 这不是错误，是这一屏的事实，但它决定了操作顺序：接受一份之后，
 * 盯着同一页的其余几份就会过期。提前标出来，用户至少知道自己刚才做了什么。
 * 返回 `页面名 → 有几份候选要改它`，只留 >1 的。
 */
export function collisionCounts(candidates = []) {
  const counts = new Map();
  for (const item of candidates) {
    for (const page of item?.pages || []) {
      if (page.action !== "update") continue;
      counts.set(page.title, (counts.get(page.title) || 0) + 1);
    }
  }
  for (const [name, count] of counts) if (count < 2) counts.delete(name);
  return counts;
}

/** 入口横幅要说的那一句：几份、会改多少东西、其中几份已经不能直接接受。 */
export function summarize(candidates = [], revisions) {
  let subjects = 0;
  let stale = 0;
  for (const item of candidates) {
    subjects += subjectsOf(item).length;
    if (stalePages(item, revisions).length) stale += 1;
  }
  return { count: candidates.length, subjects, stale };
}
