// 洞察跑批产出的候选：**「找题」那一屏的第一段**。
//
// 每周的跑批会写一份 `candidate-registry.json`（skill 的 run-artifacts 契约，
// 它是「所有候选的唯一状态源」）。在这个文件出现之前，那份东西**躺在 `tmp/` 里
// 进不了任何地方**——每周跑一次、花着 credits、产出十来条带优先级和证据就绪度的
// 候选，然后没有任何界面读它。
//
// ⚠️ **扫周目录 + 读 registry 这段逻辑只写这一份。**
// `routes/insights.mjs` 的就绪面板要读同一批文件里的 `pending_actions`，
// 各写一份的话，以后改了工件布局会漏掉其中一处，而漏掉的那处**不报错**：
// 读不到就当成「这一周没有」，界面显示的是空态引导，看着像「你还没跑过」。

import path from "node:path";
import fs from "node:fs/promises";
import { WORKBENCH_ROOT } from "./insight-run.mjs";

const workRoot = () => path.join(WORKBENCH_ROOT, "tmp", "insight-work");

/** 按周排好序的目录名（新的在后）。目录不存在是正常的：第一次跑之前本来就没有。 */
export async function insightWeeks() {
  try {
    return (await fs.readdir(workRoot(), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** 读某一周的 registry。缺文件或坏文件都回 null——**不该因此拦着别的周**。 */
export async function readRegistry(week) {
  try {
    return JSON.parse(await fs.readFile(path.join(workRoot(), week, "candidate-registry.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * ⚠️ **registry 里没有一句写给人看的「为什么」。**
 *
 * `score_basis` 是一组分项打分（`{novelty:5, importance:5, …}`），`top_card` 是个布尔。
 * 直接 `String()` 它们，屏幕上就是 `[object Object]`——**而这在截图里才看得出来，
 * 冒烟测试数条数是数得过的**（真踩过这一次）。
 *
 * 所以这一行由**证据就绪度**拼出来：它回答的正是「我现在能不能写这条」——
 * 一手信息核实过没有、有几组独立证据。那才是判断依据，分项打分不是。
 */
const FACT = { "Primary verified": "一手信息已核实", "Secondary only": "只有二手信息", Unverified: "还没核实" };

function readiness(c) {
  const bits = [];
  const fact = FACT[String(c?.fact_status || "")];
  if (fact) bits.push(fact);
  const groups = Number(c?.independent_evidence_groups) || 0;
  if (groups) bits.push(`${groups} 组独立证据`);
  // 这一条是硬提醒：撑着结论的那句话本身没核实过，写之前得先去核
  if (c?.load_bearing_unverified === true) bits.push("⚠️ 关键论据未核实");
  return bits.join(" · ");
}

/**
 * 最近一周的候选，压平成「找题」那一屏要的形状。
 *
 * ⚠️ **不按 `queue_status` 过滤。** `needs_research` 的那些也可能正是你想写的——
 * 状态照实标出来让你自己判断，比替你藏掉几条强。**偷偷过滤的界面看不出自己在过滤。**
 *
 * ⚠️ **排序按 `priority_score` 倒序，`ready` 的优先。** 这是**呈现**顺序，
 * 不是新造一个状态：分数和状态都是 skill 给的，这儿一个字都不改写。
 */
export async function latestCandidates() {
  const weeks = await insightWeeks();
  for (const week of [...weeks].reverse()) {
    const reg = await readRegistry(week);
    const list = Array.isArray(reg?.candidates) ? reg.candidates : [];
    if (!list.length) continue;
    const items = list
      .map((c) => ({
        id: String(c.candidate_id || ""),
        title: String(c.title || "").trim(),
        // `top_card` 在真实数据里是个布尔（「这条上不上头卡」），不是一段文字——
        // 别拿它当摘要显示，那会渲染出一个 "true"
        status: String(c.queue_status || ""),
        action: String(c.primary_action || ""),
        score: Number(c.priority_score) || 0,
        // ⚠️ **绝不 `String()` 一个可能是对象的字段**，见上面 `readiness` 那段
        why: readiness(c),
      }))
      .filter((c) => c.title)
      .sort((a, b) => (b.status === "ready") - (a.status === "ready") || b.score - a.score);
    return { week, generatedAt: reg?.generated_at || "", items };
  }
  return { week: "", generatedAt: "", items: [] };
}
