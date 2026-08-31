// 体检：判张力、补孤儿。
//
// ⚠️ **按词条判，不按事实对判。** 上一版按「同词条 + 不同来源」两两配对再用字符
// 重合度过滤，两头都错：98 对里最高重合度只有 0.19，阈值 0.22 等于全拦；而方向也反了——
// 真矛盾（「A 提高记忆」对「A 没有效果」）**共享的词反而更少**，重合度量的是话题
// 相似度不是冲突。
//
// 正确的单位是**一个词条的全部事实一起看**：矛盾是语义关系，只有把话摆在一起才判得出。
// 成本也从 O(事实²) 降到 O(词条)。
//
// 孤儿同理：给模型看这个孤儿和几个候选邻居，让它挑关系类型，而不是靠相似度硬配。

import { ENTRY_RELATION_READINGS, ENTRY_RELATION_TYPES } from "./values.mjs";
import { completeJson } from "../lib/model-json.mjs";

const clean = (value, max = 2_000) => String(value ?? "").trim().slice(0, max);

export const TENSION_SYSTEM_PROMPT = [
  "你在体检一个个人知识库里的一个词条。给你这个词条的全部事实，判断它们之间有没有真正的张力。",
  "",
  "什么算张力：两条事实对同一件事给出**不相容**的说法（一条说有效、另一条说无效；一条说唯一因素、另一条给出别的因素）。",
  "什么**不算**：互相补充、换个说法重述、讲同一主题的不同侧面、详略不同。这些是正常的，不要报。",
  "",
  "对每一处真张力，判断是：",
  "  supersede —— 一条明确取代另一条（更新的资料推翻了旧说法）；",
  "  dispute   —— 两条都站得住，并存记录。",
  "",
  "宁可漏报也不要凑数。绝大多数词条应该返回空数组——那是正常的。",
  "只输出 JSON：",
  JSON.stringify({ tensions: [{ leftFactId: "id", rightFactId: "id", verdict: "supersede|dispute", why: "一句话说明哪里不相容" }] }, null, 0),
].join("\n");

export const ORPHAN_SYSTEM_PROMPT = [
  "你在给一个知识库里没有任何关系的词条找它该连到哪里。",
  "",
  "只能用下面这些关系类型。**方向按括号里的读法定，写反了比不写更糟**：",
  ...ENTRY_RELATION_TYPES.map((type) => `  A ${type} B —— ${ENTRY_RELATION_READINGS[type]}`),
  "这里的 A 永远是那个孤儿词条，B 是你从候选里挑的那个。",
  "",
  "⚠️ 只在关系**确实成立**时才连。连不上就返回空数组——一条编出来的关系比没有关系更糟，",
  "因为它会把两个无关的东西在写作时一起推给用户。",
  "最多 2 条。只输出 JSON：",
  JSON.stringify({ links: [{ to: "候选词条名", type: ENTRY_RELATION_TYPES.join("|"), why: "为什么成立" }] }, null, 0),
].join("\n");

/** 一个词条的全部 active 事实，带来源标题——判张力要知道话是谁说的。 */
export function entryFactsForLint(workspace, entryId) {
  return workspace.db.prepare(`
    SELECT f.id, f.statement, f.asserted_at AS assertedAt, COALESCE(t.title, '') AS sourceTitle
    FROM entry_facts f LEFT JOIN entity_text t ON t.entity_id = f.source_entity_id
    WHERE f.entry_id = ? AND f.status = 'active' ORDER BY f.asserted_at, f.created_at
  `).all(entryId);
}

/**
 * 值得体检的词条：**至少两条来自不同来源的 active 事实**。
 *
 * 单来源的词条不必判——一份资料内部自相矛盾是可能的，但那是原作者的事，
 * 而知识库要抓的是「不同资料对同一件事说法不同」。这一条把待检词条数从
 * 全部（86 个）缩到真正可能有冲突的那些。
 */
export function entriesNeedingTensionCheck(workspace, { limit = 50 } = {}) {
  return workspace.db.prepare(`
    SELECT e.id, e.name, e.definition
    FROM entries e JOIN entities en ON en.id = e.id AND en.deleted_at IS NULL
    WHERE (SELECT COUNT(DISTINCT f.source_entity_id) FROM entry_facts f WHERE f.entry_id = e.id AND f.status = 'active') > 1
    ORDER BY (SELECT COUNT(*) FROM entry_facts f WHERE f.entry_id = e.id AND f.status = 'active') DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(200, Number(limit) || 50)));
}

/**
 * 给孤儿词条找候选邻居。
 *
 * ⚠️ **不要用 FTS。** 试过，8 个孤儿一个候选都召不回来——SQLite 的 unicode61
 * 分词器不切中文，整段汉字算一个 token，拿「心理账户」去搜只能命中一字不差的地方，
 * 拿定义里的片段去搜则什么都匹配不到。提炼那边的召回也栽在同一个坑里。
 *
 * 换两个更硬的信号：
 *
 *  1. **同源共现**——两个词条的事实来自同一份资料。它们是被同一段材料一起提炼出来的，
 *     相关性几乎是给定的，而且完全不依赖分词。这是最强的一个。
 *  2. **名字互现**——一个词条的名字出现在另一个的定义里。
 *
 * 判断仍然交给模型；这里只负责把范围缩小到值得看的那十几个。
 */
export function orphanCandidates(workspace, orphan, { limit = 8 } = {}) {
  const found = new Map();
  const add = (row) => { if (row && row.id !== orphan.id && !found.has(row.id)) found.set(row.id, row); };

  // 1. 同源共现：和这个孤儿引用过同一份资料的词条。
  for (const row of workspace.db.prepare(`
    SELECT DISTINCT other.id, other.name, other.definition,
      (SELECT COUNT(*) FROM entry_facts x JOIN entry_facts y ON y.source_entity_id = x.source_entity_id
        WHERE x.entry_id = other.id AND y.entry_id = ?) AS shared
    FROM entries other
    JOIN entities oe ON oe.id = other.id AND oe.deleted_at IS NULL
    WHERE other.id <> ? AND (
      EXISTS (SELECT 1 FROM entry_facts a JOIN entry_facts b ON b.source_entity_id = a.source_entity_id
              WHERE a.entry_id = other.id AND b.entry_id = ?)
      OR other.definition_source_id = (SELECT definition_source_id FROM entries WHERE id = ?)
    )
    ORDER BY shared DESC LIMIT ?
  `).all(orphan.id, orphan.id, orphan.id, orphan.id, limit)) add(row);

  // 2. 名字互现：名字出现在对方定义里的（两个方向都算）。
  if (found.size < limit) {
    const orphanText = String(orphan.definition || "");
    for (const row of workspace.db.prepare(`SELECT e.id, e.name, e.definition FROM entries e
      JOIN entities en ON en.id = e.id AND en.deleted_at IS NULL WHERE e.id <> ?`).all(orphan.id)) {
      if (found.size >= limit) break;
      if (orphanText.includes(row.name) || String(row.definition || "").includes(orphan.name)) add(row);
    }
  }
  return [...found.values()].slice(0, limit);
}

/** 判一个词条里的张力。只读，返回校验过的结果，不写库。 */
export async function judgeTension(workspace, env, { entryId, model = "", signal } = {}) {
  const entry = workspace.domain.entryRow(entryId);
  const facts = entryFactsForLint(workspace, entryId);
  if (facts.length < 2) return { entryId, name: entry.name, tensions: [], skipped: "事实不足两条" };
  const known = new Map(facts.map((fact) => [fact.id, fact]));
  const { data, model: used } = await completeJson(env, {
    system: TENSION_SYSTEM_PROMPT,
    user: `词条：${entry.name}\n定义：${entry.definition}\n事实：\n${JSON.stringify(facts.map((f) => ({ id: f.id, statement: f.statement, source: f.sourceTitle })))}`,
    model, signal,
  });
  const tensions = [];
  for (const item of Array.isArray(data?.tensions) ? data.tensions : []) {
    const left = known.get(clean(item?.leftFactId, 64));
    const right = known.get(clean(item?.rightFactId, 64));
    // 模型指向不存在的事实、或者把一条和自己配对，都直接丢——这是它在编。
    if (!left || !right || left.id === right.id) continue;
    if (!["supersede", "dispute"].includes(item?.verdict)) continue;
    tensions.push({ leftFactId: left.id, rightFactId: right.id, left: left.statement, right: right.statement, verdict: item.verdict, why: clean(item?.why, 300) });
  }
  return { entryId, name: entry.name, model: used, tensions };
}

/** 给一个孤儿词条提关系。只读，不写库。 */
export async function judgeOrphan(workspace, env, { entryId, model = "", signal } = {}) {
  const entry = workspace.db.prepare("SELECT id, name, definition FROM entries WHERE id = ?").get(entryId);
  if (!entry) throw new Error("词条不存在");
  const candidates = orphanCandidates(workspace, entry);
  if (!candidates.length) return { entryId, name: entry.name, links: [], skipped: "库里没有可连的候选" };
  const byName = new Map(candidates.map((item) => [item.name, item]));
  const { data, model: used } = await completeJson(env, {
    system: ORPHAN_SYSTEM_PROMPT,
    user: `孤儿词条：${entry.name}\n定义：${entry.definition}\n\n候选邻居：\n${JSON.stringify(candidates.map((item) => ({ name: item.name, definition: item.definition })))}`,
    model, signal,
  });
  const links = [];
  for (const item of Array.isArray(data?.links) ? data.links : []) {
    const target = byName.get(clean(item?.to, 120));
    if (!target || !ENTRY_RELATION_TYPES.includes(item?.type)) continue;
    links.push({ toId: target.id, to: target.name, type: item.type, why: clean(item?.why, 300) });
  }
  return { entryId, name: entry.name, model: used, links: links.slice(0, 2) };
}
