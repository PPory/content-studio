// 种子：这条链的新起点。**纯逻辑，不碰 env。**
//
// **种子 = 你看到的东西 + 你对它的一句话。** 整份设计见 `../../../docs/工作流.md`。
//
// ⚠️ **为什么在 `lib/` 而不是 `workbench.js` 里**：后者 import 了 `prompt/*.md`
//（wrangler 的 Text 模块），node 加载不了它——**放那儿就等于这段校验没有测试**。
// `keepRealPicks` 和 `contextLine` 都是因为同一个原因挪出来的。

import { SEED_REACTIONS, SEED_REACTION_GROUPS, SEED_SOURCE_KINDS, SEED_STATUS } from "./values.js";

const text = (v) => String(v ?? "").trim();

/** 界面要在**一条种子都没有**的时候就画出选择器，所以这份清单跟着列表响应一起回。 */
export const seedReactions = () => [...SEED_REACTIONS];

/**
 * 分组版。**界面画的是这一份**，扁平那份只用来校验。
 *
 * ⚠️ **两份都回，但工作台一个字都不许写死。** 分组的组名和条目全在 `values.js`，
 * 前端抄一份的话，Worker 改了措辞界面还是老的——**而且不报错**。
 */
export const seedReactionGroups = () => SEED_REACTION_GROUPS.map((g) => ({ label: g.label, items: [...g.items] }));

export const seedStatuses = () => Object.values(SEED_STATUS);

/**
 * 校验并归一化一条新种子。**不合法就抛**，调用方翻成 4xx。
 *
 * ⚠️ **`take` 是唯一的必填项。** 没有那句话就不成其为种子——那只是又一条收藏，
 * 而收藏这条路已经有了（`/收藏`、灵感库）。种子存在的全部理由就是它带着你的判断。
 *
 * ⚠️ **`reaction` 认不出时清空，不报错。** 那七条是提示语不是枚举：
 * 用户可能有话说但不属于任何一种，**硬塞一个分类比留空更糟**；
 * 而前端传来一个过期的措辞（改过文案、旧标签页）也不该让他那句话丢掉。
 * **清单是快车道，不是闸门。**
 */
export function normalizeSeedInput(body = {}) {
  const take = text(body.take);
  if (!take) {
    const err = new Error("还没写你的看法");
    err.hint = "种子 = 看到的东西 + 你的一句话。只有链接的话，用「收藏」就够了";
    err.status = 400;
    throw err;
  }

  const kind = text(body.sourceKind) || "none";
  if (!SEED_SOURCE_KINDS.includes(kind)) {
    const err = new Error(`触发物类型不合法：${kind}`);
    err.status = 400;
    throw err;
  }

  const reaction = text(body.reaction);
  return {
    take: take.slice(0, 2000),
    // 认不出就当没选，见上面那段
    reaction: SEED_REACTIONS.includes(reaction) ? reaction : "",
    sourceKind: kind,
    sourceId: text(body.sourceId).slice(0, 64),
    // ⚠️ 标题和链接**冗余存**：热点不在库里，只存 id 的话几天后这颗种子说不清自己从哪来
    sourceTitle: text(body.sourceTitle).slice(0, 300),
    sourceUrl: text(body.sourceUrl).slice(0, 2000),
  };
}

/**
 * 改一条种子时，只接受这两样。
 * ⚠️ **白名单，不是黑名单**——和 `/wb/update` 的 `EDITABLE` 同一条：
 * 放开任意字段意味着一个笔误就能把 source_kind 写成非法值。
 */
export function normalizeSeedPatch(body = {}) {
  const patch = {};
  if (body.take !== undefined) {
    const take = text(body.take);
    if (!take) {
      const err = new Error("看法不能改成空的");
      err.hint = "要放弃这颗种子就标成「不写了」，或者删掉";
      err.status = 400;
      throw err;
    }
    patch.take = take.slice(0, 2000);
  }
  if (body.status !== undefined) {
    const status = text(body.status);
    if (!seedStatuses().includes(status)) {
      const err = new Error(`状态不合法：${status}`);
      err.status = 400;
      throw err;
    }
    patch.status = status;
  }
  if (body.draftId !== undefined) patch.draftId = text(body.draftId).slice(0, 64);
  /**
   * 抓回来的来源正文。**工作台抓（Readability 要 Node），存回这儿。**
   *
   * ⚠️ **允许存空串，而且那不等于「没抓过」。** 公众号 / 知乎 / 小红书 / 抖音 / B站
   * 都要浏览器，抓不到是常态；这时也要把 `sourceFetchedAt` 记上，
   * 否则每次打开项目页都会再徒劳地抓一遍。所以这两个字段**一起收**。
   */
  if (body.sourceExcerpt !== undefined) patch.sourceExcerpt = String(body.sourceExcerpt ?? "").slice(0, 6000);
  if (body.sourceFetchedAt !== undefined) patch.sourceFetchedAt = Math.max(0, Number(body.sourceFetchedAt) || 0);
  if (!Object.keys(patch).length) {
    const err = new Error("没有可改的字段");
    err.status = 400;
    throw err;
  }
  return patch;
}

/**
 * 库里的行 → 对外的扁平字段。
 * **工作台拿到的永远是这个形状**，不是数据库原始行——换库时它一行都不用改。
 */
export function mapSeed(row = {}) {
  return {
    id: row.id,
    take: row.take || "",
    reaction: row.reaction || "",
    source: {
      kind: row.source_kind || "none",
      id: row.source_id || "",
      title: row.source_title || "",
      url: row.source_url || "",
    },
    /**
     * `excerpt` 空 + `fetchedAt` 有值 = **抓过，确实抓不到**（要浏览器的那几个站）。
     * 两者都空 = 还没抓过。界面要分得出这两种：前者该说清为什么，后者该去抓。
     */
    sourceExcerpt: row.source_excerpt || "",
    sourceFetchedAt: row.source_fetched_at ? new Date(row.source_fetched_at * 1000).toISOString() : null,
    status: row.status || SEED_STATUS.KEEPING,
    draftId: row.draft_id || null,
    createdAt: row.created_at ? new Date(row.created_at * 1000).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at * 1000).toISOString() : null,
  };
}

/**
 * 各状态多少条。**「攒着」那个数是这一页存在的理由**——它回答"今天有几个能写"。
 * 三个状态都要出现在结果里，**哪怕是 0**：少一档的话界面上那一格会凭空消失，
 * 看着像功能坏了而不是"这一档是空的"。
 */
export function seedCounts(rows = []) {
  const counts = Object.fromEntries(seedStatuses().map((s) => [s, 0]));
  for (const row of rows) {
    const status = row?.status || SEED_STATUS.KEEPING;
    if (status in counts) counts[status] += 1;
  }
  return counts;
}
