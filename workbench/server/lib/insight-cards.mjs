// 洞察候选 → 完整的选题卡。
//
// ⚠️ **卡片在「出候选的那一刻」就写好，不是点开再算。**
// 一句标题回答不了「该不该写、写的话怎么下笔」，而那正是「找题」这一屏存在的理由。
//
// ⚠️ **出卡只能在 Worker**（`POST /wb/ideas/cards`）：卡上最值钱的一项是
// 「手上有哪些素材能用」，它要求**同时看得到角度和素材库**——
// 而洞察那条 skill 跑在本机 vault + 外部材料上，**够不着 D1 的素材库**。
// 所以「让跑批时就写好卡」那条路天然给不出这一项，只能在这儿补。

import path from "node:path";
import fs from "node:fs/promises";
import { WORKBENCH_ROOT } from "./insight-run.mjs";
import { latestCandidates } from "./insight-candidates.mjs";
import { callWorker } from "./worker.mjs";

const cardFile = (week) => path.join(WORKBENCH_ROOT, "tmp", "insight-work", week, "idea-cards.json");

/**
 * 缓存的判据是 registry 的 `generated_at`，**不是文件存在与否**。
 *
 * 跑批一周才动一次，而出卡要打一次 LLM——每次打开「找题」都重算既慢又费。
 * 但只看「文件在不在」的话，重跑过那一周之后你看到的还是上一批的卡，
 * **而且不报错**：卡是完整的、只是过期的。
 */
async function readCache(week, generatedAt) {
  try {
    const cached = JSON.parse(await fs.readFile(cardFile(week), "utf8"));
    return cached?.generatedAt === generatedAt && Array.isArray(cached.items) ? cached : null;
  } catch {
    return null;
  }
}

async function writeCache(week, payload) {
  // 写不进去不能让主流程失败：卡已经算出来了，界面照样能用，只是下次要再算一遍
  try {
    await fs.writeFile(cardFile(week), JSON.stringify(payload, null, 2), "utf8");
  } catch (e) {
    console.warn("洞察卡片没缓存下来（这次仍然可用）:", e.message);
  }
}

/**
 * 最近一周的洞察候选，每条都是一张完整的卡。
 *
 * ⚠️ **出卡失败时退回「只有标题和就绪度」，不是整段报错。**
 * Worker 没部署、代理挂了、模型抽风——这几种情况下 registry 里那批候选
 * **本身仍然是有用的**（标题就是角度，就绪度是真的）。整段报错等于
 * 因为一个可选的增强而把一整个来源关掉。
 */
export async function insightCards(env, { refresh = false } = {}) {
  const reg = await latestCandidates();
  if (!reg.items.length) return { week: reg.week, items: [], cards: false };

  if (!refresh) {
    const cached = await readCache(reg.week, reg.generatedAt);
    if (cached) return { week: reg.week, items: cached.items, cards: true, cached: true };
  }

  const { status, data } = await callWorker(env, "ideas/cards", {
    method: "POST",
    body: { items: reg.items.map((c) => c.title) },
  });
  const cards = status === 200 && data?.ok && Array.isArray(data.cards) ? data.cards : null;
  if (!cards?.length) {
    return { week: reg.week, items: reg.items, cards: false, why: data?.error || data?.hint || "" };
  }

  /**
   * 把卡片和 registry 的判断合回一条。
   * ⚠️ **按角度对齐，不按下标**——Worker 那侧已经保证一一对应，但这儿再对一次
   * 是因为**错位不报错**：你会照着一张不属于这条候选的卡去写。
   */
  const byAngle = new Map(cards.map((c) => [c.angle, c]));
  const items = reg.items.map((c, i) => ({ ...c, card: byAngle.get(c.title) || cards[i] || null }));
  await writeCache(reg.week, { generatedAt: reg.generatedAt, items });
  return { week: reg.week, items, cards: true };
}
