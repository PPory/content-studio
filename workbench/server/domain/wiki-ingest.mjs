// 提炼（Ingest）：把一份来源读成词条、事实、关系和矛盾。
//
// ⚠️ **这一步和「又存一条笔记」的区别，全在三个动作上：**
//
//   归并 —— 新事实落到**已有**词条上，而不是每份资料都新建一批同义词条；
//   矛盾 —— 新说法和旧论断冲突时**并排记下来**，而不是让后写的覆盖先写的；
//   连接 —— 词条之间建立有语义的边。
//
// 参照的那套飞书实现只做到了第三个，所以它长出来的是一本带链接的目录，
// 不是一个会演化的综合体。这里三个都必须做，缺一个这套东西就退化成收藏夹。
//
// ⚠️ **模型说的每一条都要有逐字原文垫底，服务端机械校验。**
// 「请标注来源」是一句提示词，模型可以照做也可以敷衍，而且敷衍了没人看得出来。
// 要求它附上一段原文、再用 `sourceContainsVerbatim` 去源文档里核对，
// 才是硬的：对不上的直接丢，并计入 `rejected_ungrounded`。

import { ENTRY_KINDS, ENTRY_RELATION_TYPES } from "./values.mjs";
import { completeJson } from "../lib/model-json.mjs";

const clean = (value, max = 2_000) => String(value ?? "").trim().slice(0, max);
/** 一条事实的原文依据至少要这么长，太短的片段在任何文档里都能「找到」。 */
const MIN_QUOTE_CHARS = 12;
/** 拼接引用里单独一段的下限。**比整串的下限低但不能取消**——否则「的」也算一段。 */
const MIN_SPAN_CHARS = 8;

/**
 * 引用里的省略号。模型引两处相关原文时会写成 `前一段……后一段`，这是**正当的引用方式**，
 * 不该因为整串在原文里连不起来就被判成编造。
 */
const ELLIPSIS = /\s*(?:\.{3,}|。{3,}|…+|·{3,})\s*/;

export function quoteSpans(quote) {
  return String(quote ?? "").split(ELLIPSIS).map((span) => span.trim()).filter(Boolean);
}

/**
 * 引用比对用的归一化。**空白全部去掉，不是压成一个空格。**
 *
 * ⚠️ 这是和 `integrity.mjs#sourceContainsVerbatim` 有意分开的一份实现，别去改那一份：
 * 那里是素材的逐字核验，面向用户、要严；而这里比的是中文正文里的引用。
 *
 * 中文段落之间是换行，压成空格之后原文变成「场景-情绪反应。 所以我说」——
 * 中间多了一个**任何模型都不会照抄的空格**，于是完全正确的引用被判成编造。
 * 实测这一条就吃掉了大半的误杀。去掉全部空白之后，两边都不含空白，比的是纯文字。
 */
function comparable(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, "");
}

function containsSpan(sourceText, span) {
  const source = comparable(sourceText);
  const needle = comparable(span);
  return Boolean(source && needle && source.includes(needle));
}

/**
 * 引用是否真的出自这份资料。
 *
 * ⚠️ **按段校验，每段都要对上。** 只做整串匹配的话，一个用 `……` 连接两处真实原文的
 * 正当引用会被全部丢掉（实测某个模型因此被丢掉 82%，而它的内容其实更好）。
 *
 * 但**不marked 的省略仍然要拦**：模型也会不加任何标记地从「回顾/回忆。」直接跳到
 * 「（2）记录下」，把中间几句吞掉——那样拼出来的句子在原文里从来没有存在过，
 * 而读的人会以为它是原话。按段切之后这种情况自然过不了，因为跨越了跳跃的那一段
 * 本身就对不上。
 */
export function quoteGrounded(sourceText, quote) {
  const spans = quoteSpans(quote);
  if (!spans.length) return false;
  if (spans.join("").length < MIN_QUOTE_CHARS) return false;
  return spans.every((span) => span.length >= MIN_SPAN_CHARS && containsSpan(sourceText, span));
}

export const INGEST_SYSTEM_PROMPT = [
  "你在维护一个个人知识库。你的工作是把一份资料读成结构化的词条，而不是写摘要。",
  "",
  "硬性规则：",
  "1. 只使用给定资料里的信息。资料里没有的，不要写，也不要用常识补全。",
  "2. 每一条定义和事实都必须附一段【逐字摘自资料原文】的 quote。服务端会回原文核对，对不上的会被丢弃。quote 至少 12 个字，要能支撑那条陈述。",
  "3. 已有词条优先。如果一个概念已经在「已有词条」里，不要新建同义词条，把新事实挂到它上面。",
  "4. 如果资料里的说法和某条已有事实冲突，写进 contradictions，不要直接覆盖。判断 supersede（资料更新、明确取代旧说法）还是 dispute（两说并存、各有依据）。",
  "5. 关系必须具体。只能用给定的类型，不许输出「相关」这种没有信息的关系。",
  "6. 宁缺毋滥。一份资料提炼出 3 到 8 个词条通常就够了；目录、致谢、纯代码清单这类没有可沉淀观点的资料，返回空数组。",
  "",
  "只输出 JSON，不要解释。结构：",
  JSON.stringify({
    entries: [{ name: "词条名", kind: `${ENTRY_KINDS.join("|")}`, definition: "一句话定义", quote: "逐字原文" }],
    facts: [{ entry: "词条名", statement: "一条事实", quote: "逐字原文" }],
    relations: [{ from: "词条名", to: "词条名", type: `${ENTRY_RELATION_TYPES.join("|")}`, why: "关系说明" }],
    contradictions: [{ entry: "词条名", existingFactId: "已有事实的 id", statement: "资料里的新说法", quote: "逐字原文", verdict: "supersede|dispute", why: "理由" }],
  }, null, 0),
].join("\n");

/**
 * 挑出可能和这份资料相关的已有词条，连同它们的事实一起喂给模型。
 *
 * ⚠️ **不要把整库词条都塞进去。** 那样既贵又会让模型在几百个名字里挑，
 * 归并和矛盾的准确率都会掉。用 FTS 先按这份资料的正文把范围缩到十几个——
 * 又是数据库缩小搜索空间、模型只做判断，和矛盾检测同一个思路。
 */
export function relevantEntries(workspace, text, { limit = 20 } = {}) {
  /**
   * ⚠️ **反着查：拿词条名去正文里找，不是拿正文切词去查 FTS。**
   *
   * 前一版是后者，实测**漏掉了已经存在的「储存强度」**——中文按标点切出来的是整句
   * 而不是词，那样的「词」在 FTS 里什么都匹配不到。漏召回的后果不是少几条：
   * 模型没被告知这个词条已存在，就会把它当新的再提一遍，**归并整个失效**，
   * 知识库长出一堆同义重复，然后它们之间还会互相「矛盾」。
   *
   * 词条名短、条数有界，直接在正文里做包含判断既准确又便宜，而且完全绕开了
   * 中文分词这件事——名字出现在正文里，就是最强的相关信号。
   */
  const haystack = comparable(text);
  const all = workspace.db.prepare(`SELECT e.id, e.name, e.entry_kind AS kind, e.definition
    FROM entries e JOIN entities en ON en.id = e.id AND en.deleted_at IS NULL`).all();
  const hits = all
    .filter((entry) => entry.name.length >= 2 && haystack.includes(comparable(entry.name)))
    // 名字长的匹配更具体（「储存强度」比「框架」值钱），条数超了先留具体的那些
    .sort((left, right) => right.name.length - left.name.length)
    .slice(0, limit);
  return hits.map((entry) => ({
    ...entry,
    facts: workspace.db.prepare("SELECT id, statement FROM entry_facts WHERE entry_id = ? AND status <> 'superseded' ORDER BY created_at").all(entry.id),
  }));
}

export function buildIngestUser({ sourceTitle, sourceText, existing = [] }) {
  return [
    existing.length
      ? `已有词条（优先归并到这些，不要重建同义词条）：\n${JSON.stringify(existing.map((entry) => ({ name: entry.name, kind: entry.kind, definition: entry.definition, facts: entry.facts.map((fact) => ({ id: fact.id, statement: fact.statement })) })))}`
      : "已有词条：（空，这是第一批）",
    "",
    `资料标题：${sourceTitle}`,
    "资料正文：",
    sourceText,
  ].join("\n");
}

const inList = (value, list) => list.includes(String(value || ""));

/**
 * 逐字校验并归一化模型的提案。
 *
 * 返回 `{ entries, facts, relations, contradictions, rejected }`——
 * `rejected` 是被丢掉的条目和原因，**要报给用户看**：它是判断这个模型能不能用的依据。
 */
export function validateProposal(proposal, { sourceText, existing = [] }) {
  const rejected = [];
  const known = new Map(existing.map((entry) => [entry.name, entry]));
  const grounded = (quote, label) => {
    const text = clean(quote, 2_000);
    if (text.replace(ELLIPSIS, "").length < MIN_QUOTE_CHARS) {
      rejected.push({ what: label, why: `原文依据太短（${text.length} 字）` });
      return false;
    }
    if (!quoteGrounded(sourceText, text)) {
      // 报出**第一段对不上的**，而不是整串——「这句在原文里找不到」对着 200 字的
      // 拼接引用等于没说，而定位到具体那一段，一眼就能看出模型是漏引还是编造。
      const bad = quoteSpans(text).find((span) => span.length < MIN_SPAN_CHARS || !containsSpan(sourceText, span));
      rejected.push({ what: label, why: "原文依据在资料里找不到", quote: clean(bad, 60) });
      return false;
    }
    return true;
  };

  const entries = [];
  for (const item of Array.isArray(proposal?.entries) ? proposal.entries : []) {
    const name = clean(item?.name, 120);
    const definition = clean(item?.definition, 500);
    if (!name || !definition) { rejected.push({ what: `词条 ${name || "(无名)"}`, why: "缺名字或定义" }); continue; }
    if (known.has(name)) { rejected.push({ what: `词条 ${name}`, why: "已存在，应作为归并处理" }); continue; }
    if (!inList(item?.kind, ENTRY_KINDS)) { rejected.push({ what: `词条 ${name}`, why: `类型不合法：${clean(item?.kind, 40)}` }); continue; }
    if (!grounded(item?.quote, `词条 ${name} 的定义`)) continue;
    entries.push({ name, kind: item.kind, definition, quote: clean(item.quote, 1_000) });
  }

  const proposedNames = new Set([...known.keys(), ...entries.map((entry) => entry.name)]);
  const facts = [];
  for (const item of Array.isArray(proposal?.facts) ? proposal.facts : []) {
    const entry = clean(item?.entry, 120);
    const statement = clean(item?.statement, 2_000);
    if (!entry || !statement) { rejected.push({ what: "事实", why: "缺词条名或内容" }); continue; }
    if (!proposedNames.has(entry)) { rejected.push({ what: `事实（${entry}）`, why: "挂在一个既不存在也没被提议的词条上" }); continue; }
    if (!grounded(item?.quote, `「${entry}」的一条事实`)) continue;
    facts.push({ entry, statement, quote: clean(item.quote, 1_000) });
  }

  const relations = [];
  for (const item of Array.isArray(proposal?.relations) ? proposal.relations : []) {
    const from = clean(item?.from, 120);
    const to = clean(item?.to, 120);
    if (!proposedNames.has(from) || !proposedNames.has(to)) { rejected.push({ what: `关系 ${from}→${to}`, why: "两端必须都是已有或本次提议的词条" }); continue; }
    if (from === to) { rejected.push({ what: `关系 ${from}`, why: "词条不能链接到自己" }); continue; }
    if (!inList(item?.type, ENTRY_RELATION_TYPES)) { rejected.push({ what: `关系 ${from}→${to}`, why: `关系类型不合法：${clean(item?.type, 40)}` }); continue; }
    relations.push({ from, to, type: item.type, why: clean(item?.why, 300) });
  }

  const knownFactIds = new Set(existing.flatMap((entry) => entry.facts.map((fact) => fact.id)));
  const contradictions = [];
  for (const item of Array.isArray(proposal?.contradictions) ? proposal.contradictions : []) {
    const entry = clean(item?.entry, 120);
    const existingFactId = clean(item?.existingFactId, 64);
    const statement = clean(item?.statement, 2_000);
    if (!knownFactIds.has(existingFactId)) { rejected.push({ what: `矛盾（${entry}）`, why: "指向一条不存在的已有事实" }); continue; }
    if (!statement) { rejected.push({ what: `矛盾（${entry}）`, why: "缺新说法" }); continue; }
    if (!inList(item?.verdict, ["supersede", "dispute"])) { rejected.push({ what: `矛盾（${entry}）`, why: "判定只能是 supersede 或 dispute" }); continue; }
    if (!grounded(item?.quote, `「${entry}」的矛盾依据`)) continue;
    contradictions.push({ entry, existingFactId, statement, quote: clean(item.quote, 1_000), verdict: item.verdict, why: clean(item?.why, 300) });
  }

  return { entries, facts, relations, contradictions, rejected };
}

/** 读一份来源，产出一份**已经过逐字校验**的提案。不写库。 */
export async function proposeFromSource(workspace, env, { sourceId, model = "", signal } = {}) {
  const source = workspace.db.prepare(`SELECT d.id, d.title, d.body_markdown AS body FROM book_documents d
    JOIN entities e ON e.id = d.id AND e.deleted_at IS NULL WHERE d.id = ?`).get(sourceId);
  if (!source) throw new Error("来源文档不存在");
  const sourceText = clean(source.body, 60_000);
  if (sourceText.length < 200) return { sourceId, empty: true, reason: "正文太短，没有可沉淀的内容", model: "" };

  const existing = relevantEntries(workspace, sourceText);
  const { model: usedModel, data, usage } = await completeJson(env, {
    system: INGEST_SYSTEM_PROMPT,
    user: buildIngestUser({ sourceTitle: source.title, sourceText, existing }),
    model,
    signal,
  });
  return { sourceId, title: source.title, model: usedModel, usage, existing, ...validateProposal(data, { sourceText, existing }) };
}
