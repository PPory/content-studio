/**
 * 热点转化链：一条热点后来怎么样了。
 *
 *     未处理 → 已收藏 → 已形成选题 → 已成稿 → 已发布
 *
 * **状态一律由真实关联关系算出来，工作台自己不存一份映射。** 手工状态一定会失真：
 * 你在别处把选题删了、把稿子改成已发布，工作台那份记录不会跟着动，
 * 于是界面上显示的东西和真相对不上——而这种错没有任何地方会报出来。
 *
 * 一次算完，不逐条问：四个库的列表本来就为全局检索缓存着（`search.mjs` 的
 * `pipelineList`），这里复用同一份，**零额外网络调用**。
 *
 * ## 认亲靠 URL
 *
 * 热点唯一稳定的身份就是它的原文地址。入库时那个地址落进灵感库的「链接」
 * 或素材库的「出处」，所以反过来拿地址去这两个库里找，就知道它被收过没有。
 * 比对前两边都过一遍 `normalizeWebUrl`——同一篇文章的链接经常带着不同的
 * utm 参数和锚点，逐字比的话十条有九条对不上。
 *
 * ## 为什么从选题那一侧读关联
 *
 * 「这条素材/灵感属于哪个选题」这层关系写在**选题页**上（`来源灵感` / `关联素材`，
 * 由 Worker 的 `/wb/list/topics` 一起回来）。反过来读灵感、素材上的同步属性也行，
 * 但反过来从灵感、素材那一侧读，得先假设关联表是双向可查的，猜错就是静默的空数组。
 *
 * ⚠️ 这两个字段是 **content-pipeline 2026-08-13 之后**才有的。Worker 没更新时
 * 它们是 undefined，链条只能算到「已收藏」——那时 `degraded` 为 true，
 * 界面照实说「后面几档要更新 Worker 才能算」，**不是假装它们不存在**。
 */

import { pipelineList } from "./search.mjs";

// 和 web-notes 那份同一套规则，但这里**不能抛异常**：热点里什么样的地址都有，
// 一条不合法的不该让整批 trace 挂掉。
function normUrl(input) {
  try {
    const url = new URL(String(input || "").trim());
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (k.startsWith("utm_") || ["ref", "source", "spm", "from", "share_token", "scene", "chksm"].includes(k)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString().toLowerCase();
  } catch {
    return "";
  }
}

export const STAGES = ["未处理", "已收藏", "已形成选题", "已成稿", "已发布"];

export async function traceLinks(env, links) {
  const out = {};
  const wanted = new Map(); // 规范化地址 → 原始地址（回给前端时按原始的对号入座）
  for (const raw of links || []) {
    const n = normUrl(raw);
    if (n) wanted.set(n, raw);
    out[raw] = { stage: "未处理" };
  }
  if (!wanted.size) return { ok: true, items: out, degraded: false };
  if (!(env.WORKER_URL || "").trim()) {
    return { ok: true, items: out, degraded: true, why: "未配置 WORKER_URL，算不出转化链" };
  }

  const [inbox, materials, topics, drafts] = await Promise.all(
    ["inbox", "materials", "topics", "drafts"].map((v) => pipelineList(env, v))
  );

  // 1. 地址 → 灵感/素材条目
  const byUrl = new Map();
  for (const [view, list] of [["inbox", inbox], ["materials", materials]]) {
    for (const p of list) {
      const n = normUrl(p.link);
      if (!n || !wanted.has(n)) continue;
      // 同一篇被收过两次时留先看到的那条就够：这里回答的是「收过没有」
      if (!byUrl.has(n)) byUrl.set(n, { view, id: p.id, title: p.title, status: p.status || "" });
    }
  }

  // 2. 条目 id → 选题（从选题那一侧的 relation 反建索引）
  const topicOf = new Map();
  let hasRelations = false;
  for (const t of topics) {
    const froms = [...(t.inspirationIds || []), ...(t.materialIds || [])];
    if (froms.length) hasRelations = true;
    for (const id of froms) if (!topicOf.has(id)) topicOf.set(id, t);
  }

  // 3. 稿件 id → 稿件（拿状态）
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  for (const [n, raw] of wanted) {
    const item = byUrl.get(n);
    if (!item) continue;
    const topic = topicOf.get(item.id);
    const linked = topic ? (topic.draftIds || []).map((id) => draftById.get(id)).filter(Boolean) : [];
    const published = linked.filter((d) => d.status === "已发布");
    out[raw] = {
      stage: !topic ? "已收藏" : published.length ? "已发布" : linked.length ? "已成稿" : "已形成选题",
      item,
      topic: topic ? { id: topic.id, title: topic.title, status: topic.status || "" } : null,
      drafts: linked.map((d) => ({ id: d.id, title: d.title, status: d.status || "", platform: d.platform || "" })),
    };
  }

  /**
   * `degraded` 说的是「后面那几档现在算不出来」，不是「没有关联」。
   * 判据是**所有选题都没有这两个字段**——真的一条关联都没建时，
   * `hasRelations` 同样是 false，两种情况在数据上分不开，所以文案要兼顾：
   * 说「算不出」而不是「Worker 是旧的」。
   */
  const degraded = topics.length > 0 && !hasRelations;
  return {
    ok: true,
    items: out,
    degraded,
    why: degraded
      ? "选题上还没有「来源灵感 / 关联素材」的关联数据，「已形成选题」之后的几档暂时算不出来。若 content-pipeline 还没更新，去那边跑一次 npx wrangler deploy。"
      : "",
  };
}
