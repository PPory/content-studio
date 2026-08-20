/**
 * 「跳过去，并且把这一条打开」。
 *
 * 检索结果只把你送到那个库的列表页，是把事情做了一半：你搜的是**那一条**，
 * 不是「那一条所在的那一档」。但真要做成深链接，得往 hash 里塞条目 id，
 * 而这个项目的 hash 是 `#/库/状态` 两段、**状态值本身带斜杠**
 * （灵感库那个「初筛失败/需人工」）——加一段就要重新处理分隔符规则。
 *
 * 所以走一个**一次性的交接变量**而不是改路由格式：呼叫方在 `go()` 之前放下
 * 「等会儿到了那一页，把这个 key 打开」，目标页面列表加载完之后取一次、用掉。
 *
 * 三条约束：
 *  - **一次性**（`take` 取完即清）。留着的话，那一页因为回写状态、刷新列表
 *    重新加载时会又把它打开一遍——关掉它会立刻被弹回来（书架的 `resumedRef`
 *    踩过同一个坑）。
 *  - **按页面分桶**：放的时候写清是给谁的，别让书架去消费一条给选题的记录。
 *  - **不进 localStorage**：它的寿命是「这一次跳转」，存起来只会让下次开工作台
 *    莫名其妙弹出一篇文档。
 */

const pending = new Map();

const MATERIAL_VIEWS = new Set(["collections", "inbox", "materials"]);

// 旧的三库搜索结果统一落到素材工作区。复合 key 同时保留原对象类型和真实 id，
// 避免 inbox 与 materials 恰好出现同 id 时打开错对象。
export function normalizeMaterialOpen(view, key) {
  if (!MATERIAL_VIEWS.has(view) || !key) return null;
  const value = String(key);
  return {
    view: "materials",
    targetView: "material-workspace",
    key: value.includes(":") ? value : `${view}:${value}`,
  };
}

export function normalizeMaterialRoute(view, state = "") {
  if (view !== "collections" && view !== "inbox") return null;
  const value = String(state || "");
  if (view === "collections") {
    const stage = ["pending", "待整理"].includes(value)
      ? "待处理"
      : ["archived", "已归档"].includes(value)
        ? "已归档"
        : value ? "已收纳" : "";
    return { view: "materials", state: stage };
  }
  const stage = ["待初筛", "初筛失败/需人工", "处理中", "需处理"].includes(value)
    ? "待处理"
    : ["已弃用", "已归档"].includes(value)
      ? "已归档"
      : value ? "已收纳" : "";
  return { view: "materials", state: stage };
}

export function setOpenTarget(view, key) {
  if (!view || !key) return;
  pending.set(view, key);
}

export function takeOpenTarget(view) {
  const key = pending.get(view);
  if (key) pending.delete(view);
  return key || "";
}
