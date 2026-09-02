/**
 * 长期议程候选：从反复出现的判断里，看有没有一条还没被命名的长期议程。
 *
 * ⚠️ **这是整套里最容易产出「听起来很对但什么都没说」的一步。**
 * 让模型总结几条内容机会，它一定能写出一句漂亮的长期判断——
 * 而那句话多半只是把现有那几条重新组织了一遍，不是发现。
 *
 * 两道闸挡这件事：
 *  1. 数据不够就**根本不跑模型**（`observeAgendaSignals` 说了算）；
 *  2. 每条候选必须指得回**具体哪几条**已有记录，指不回的整条丢掉。
 */

import { completeJson } from "../lib/model-json.mjs";
import { describeAgendaSignals } from "./content-agenda.mjs";

const clean = (value, max = 4_000) => String(value ?? "").trim().slice(0, max);

/** 一条议程至少要踩在几条已有记录上。少于这个数说明它是从一两条里硬提的。 */
const MIN_BASIS = 3;

function completionFor(env) {
  return typeof env?.CONTENT_AGENDA_COMPLETE_JSON === "function"
    ? env.CONTENT_AGENDA_COMPLETE_JSON
    : typeof env?.CONTENT_BRIDGE_COMPLETE_JSON === "function"
      ? env.CONTENT_BRIDGE_COMPLETE_JSON
      : completeJson;
}

/**
 * 收一条候选。
 *
 * ⚠️ **依据必须指得回真实记录。** 一条说不出「凭哪几条看出来的」的议程，
 * 和用户自己在空白框里写一句话没有区别——而那正是这一步要替代的东西。
 */
function normalizeCandidate(item, { known, existingTitles }) {
  const title = clean(item?.title, 120);
  const desiredJudgment = clean(item?.desired_judgment || item?.desiredJudgment, 2_000);
  const reason = clean(item?.reason, 2_000);
  if (!title || !desiredJudgment || !reason) return null;
  // 换个说法把已有议程再提一遍，不算发现。
  if (existingTitles.has(title)) return null;

  const basis = (Array.isArray(item?.basis) ? item.basis : [])
    .map((entry) => known.get(clean(typeof entry === "string" ? entry : entry?.id, 120)))
    .filter(Boolean);
  const unique = [...new Map(basis.map((entry) => [entry.id, entry])).values()];
  if (unique.length < MIN_BASIS) return null;

  return {
    title,
    desiredJudgment,
    reason,
    basis: unique,
    /** 这条议程覆盖到几个不同的用户问题。一个问题撑不起一条长期议程。 */
    problemSpread: new Set(unique.map((entry) => entry.problemId).filter(Boolean)).size,
    audience: clean(item?.audience, 1_000),
    problemSpace: clean(item?.problem_space || item?.problemSpace, 2_000),
  };
}

export async function proposeAgendaCandidates(env, workspace, signals, { limit = 2 } = {}) {
  if (!signals.ready) {
    throw Object.assign(new Error("现在还看不出一条长期议程"), {
      status: 409,
      hint: `${signals.missing.join("；")}。长期议程要从反复出现的判断里看出来，几条内容机会看不出「反复」。`,
    });
  }
  const size = Math.max(1, Math.min(3, Number(limit) || 2));

  const completion = await completionFor(env)(env, {
    system: [
      "你从一个创作者已经做过的事里，看有没有一条他自己还没命名的长期议程。",
      `最多给 ${size} 条。看不出来就返回空数组——这是合格结果。`,
      "",
      "⚠️ 长期议程的意思是：他反复在解决某一类问题，并且反复希望受众形成同一个判断。",
      "⚠️ 只出现过一两次的东西不是议程，是一篇内容。把几条不相干的判断硬凑成一句大话，也不是议程。",
      "⚠️ 每条候选必须在 basis 里列出**至少 3 条**上面给过的 id，说明你是从哪几条看出来的。",
      "⚠️ 不要重复或换个说法重提已经定过的议程。",
      "",
      "desired_judgment 写「希望受众最终形成的那个稳定判断」，要具体到可以被反对。",
      "reason 说明为什么这几条指向同一条议程，而不是复述它们。",
      "只输出 JSON。",
      JSON.stringify({
        agendas: [{ title: "", desired_judgment: "", audience: "", problem_space: "", reason: "", basis: [""] }],
        nothing_found_reason: "",
      }),
    ].join("\n"),
    user: describeAgendaSignals(signals),
    maxTokens: 4_000,
  });

  const data = completion.data;
  if (!data || typeof data !== "object" || !Array.isArray(data.agendas)) throw new Error("模型没有返回 agendas 数组");
  const known = new Map([
    ...signals.claims.map((item) => [item.id, { id: item.id, kind: "opportunity", label: clean(item.claim, 200), problemId: item.problemId }]),
    ...signals.problems.map((item) => [item.id, { id: item.id, kind: "problem", label: clean(item.statement, 200), problemId: item.id }]),
    ...signals.published.map((item) => [item.id, { id: item.id, kind: "publication", label: clean(item.title, 200), problemId: null }]),
    ...signals.learnings.map((item) => [item.id, { id: item.id, kind: "learning", label: clean(item.learning, 200), problemId: null }]),
  ]);
  const existingTitles = new Set(signals.existing.map((item) => item.title));

  const dropped = [];
  const agendas = data.agendas.slice(0, 5).map((item) => {
    const candidate = normalizeCandidate(item, { known, existingTitles });
    if (!candidate) dropped.push({ title: clean(item?.title, 120) || "（无标题）", reason: "依据指不回至少 3 条真实记录，或与已有议程重复" });
    return candidate;
  }).filter(Boolean).slice(0, size);

  return {
    agendas,
    dropped,
    nothingFoundReason: agendas.length ? "" : clean(data.nothing_found_reason || data.nothingFoundReason, 1_000)
      || "这些内容还没有指向同一条长期判断。",
    counts: signals.counts,
    model: completion.model || "",
  };
}
