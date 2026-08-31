#!/usr/bin/env node
// 提炼：把知识库里的来源读成词条候选。
//
//   node scripts/wiki-ingest.mjs --book "智识思维课" --limit 3            # 预演，只看提案
//   node scripts/wiki-ingest.mjs --book "智识思维课" --limit 3 --commit   # 写入词条
//   node scripts/wiki-ingest.mjs --book "智识思维课" --model claude-sonnet-4-6
//
// ⚠️ **默认预演。** 提炼的产出会成为你之后写作时的依据，一条编造的事实混进去，
// 后面每一篇引用它的文章都带着这个错。先看，再写。

import fs from "node:fs/promises";
import path from "node:path";
import { envFilePath, parseEnv } from "../server/lib/env-file.mjs";
import { ingestModelId } from "../server/lib/model-json.mjs";
import { proposeFromSource } from "../server/domain/wiki-ingest.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith("--") ? args[at + 1] : fallback;
};
const commit = args.includes("--commit");
const bookName = flag("book");
const limit = Math.max(1, Number(flag("limit", "3")) || 3);
const model = flag("model");
const actor = "user";

const env = parseEnv(await fs.readFile(envFilePath(ROOT), "utf8"));
const workspace = await openWorkspace({});

/**
 * 还没提炼过的来源。**已经读过的不再读**——见 0008 那张表的注释。
 *
 * ⚠️ **但 `failed` 要重试。** 失败的绝大多数是上游模型服务抽风（实测一整批里
 * 有七份挂在 `auth_unavailable` 和一个 502 网关页上），那是暂时的；
 * 把它们和「读过了」一视同仁地排除掉，等于一次网络波动就永久吞掉几份资料，
 * 而且没有任何地方会提醒你。
 */
function pendingSources(bookTitle, take) {
  const params = [];
  let where = "";
  if (bookTitle) { where = "AND b.title = ?"; params.push(bookTitle); }
  return workspace.db.prepare(`
    SELECT d.id, d.title, b.title AS book, LENGTH(d.body_markdown) AS chars
    FROM book_documents d
    JOIN entities e ON e.id = d.id AND e.deleted_at IS NULL
    JOIN books b ON b.id = d.book_id
    JOIN entities be ON be.id = b.id AND be.deleted_at IS NULL
    WHERE NOT EXISTS (SELECT 1 FROM source_ingests s WHERE s.source_entity_id = d.id AND s.status <> 'failed') ${where}
    ORDER BY b.title, d.document_order LIMIT ?
  `).all(...params, take);
}

function recordIngest(source, proposal, status, error = "") {
  workspace.db.prepare(`
    INSERT INTO source_ingests(source_entity_id, status, model, entries_proposed, facts_proposed,
      relations_proposed, contradictions_found, rejected_ungrounded, error, run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_entity_id) DO UPDATE SET status = excluded.status, model = excluded.model,
      entries_proposed = excluded.entries_proposed, facts_proposed = excluded.facts_proposed,
      relations_proposed = excluded.relations_proposed, contradictions_found = excluded.contradictions_found,
      rejected_ungrounded = excluded.rejected_ungrounded, error = excluded.error, run_at = excluded.run_at
  `).run(source.id, status, proposal?.model || "", proposal?.entries?.length || 0, proposal?.facts?.length || 0,
    proposal?.relations?.length || 0, proposal?.contradictions?.length || 0, proposal?.rejected?.length || 0,
    String(error || "").slice(0, 2_000), new Date().toISOString());
}

/** 把校验过的提案写成正式词条。名字对不上的一律跳过，不猜。 */
function applyProposal(source, proposal) {
  const now = new Date();
  const byName = new Map();
  for (const entry of proposal.existing) byName.set(entry.name, entry.id);
  return workspace.repository.transaction(() => {
    for (const item of proposal.entries) {
      // ⚠️ **重名当成归并，不当成错误。**
      // 召回再准也会漏（模型看不到的词条它当然会重提），而这种时候正确的动作
      // 恰恰就是错误消息里写的那句：追加事实到已有词条上。为此把整批中断，
      // 等于让一次可预期的重名毁掉前面十几份资料的成果。
      const existing = workspace.domain.findEntryByName(item.name);
      if (existing) { byName.set(item.name, existing.id); continue; }
      const id = workspace.domain.createEntry({
        name: item.name, kind: item.kind, definition: item.definition, definitionSourceId: source.id, actor, now,
      });
      byName.set(item.name, id);
    }
    for (const fact of proposal.facts) {
      const entryId = byName.get(fact.entry);
      if (!entryId) continue;
      workspace.domain.addEntryFact({ entryId, statement: fact.statement, sourceEntityId: source.id, sourceLocator: source.title, actor, now });
    }
    for (const relation of proposal.relations) {
      const from = byName.get(relation.from);
      const to = byName.get(relation.to);
      if (!from || !to || from === to) continue;
      workspace.domain.linkEntries(from, to, relation.type, { actor, now });
    }
    for (const conflict of proposal.contradictions) {
      const entryId = byName.get(conflict.entry);
      if (!entryId) continue;
      const factId = workspace.domain.addEntryFact({ entryId, statement: conflict.statement, sourceEntityId: source.id, sourceLocator: source.title, actor, now });
      if (conflict.verdict === "supersede") workspace.domain.supersedeEntryFact(conflict.existingFactId, { supersededBy: factId, actor, now });
      else workspace.domain.disputeEntryFacts(conflict.existingFactId, factId, { actor, now });
    }
    return true;
  });
}

try {
  const sources = pendingSources(bookName, limit);
  if (!sources.length) {
    console.log(bookName ? `《${bookName}》里没有待提炼的章节了。` : "没有待提炼的来源了。");
    process.exit(0);
  }
  console.log(`${commit ? "提炼" : "预演"}　模型 ${model || ingestModelId(env)}　${sources.length} 份来源\n`);

  let totals = { entries: 0, facts: 0, relations: 0, contradictions: 0, rejected: 0 };
  for (const source of sources) {
    process.stdout.write(`── ${source.book} · ${source.title}（${source.chars} 字）\n`);
    let proposal;
    try {
      proposal = await proposeFromSource(workspace, env, { sourceId: source.id, model });
    } catch (error) {
      console.log(`   失败：${error.message}\n`);
      if (commit) recordIngest(source, null, "failed", error.message);
      continue;
    }
    if (proposal.empty) {
      console.log(`   跳过：${proposal.reason}\n`);
      if (commit) recordIngest(source, proposal, "empty");
      continue;
    }
    for (const entry of proposal.entries) console.log(`   ＋词条  [${entry.kind}] ${entry.name}　${entry.definition}`);
    for (const fact of proposal.facts) console.log(`   ·事实  ${fact.entry} ← ${fact.statement}`);
    for (const relation of proposal.relations) console.log(`   ↔关系  ${relation.from} --${relation.type}--> ${relation.to}　（${relation.why}）`);
    for (const conflict of proposal.contradictions) console.log(`   ⚠矛盾  ${conflict.entry}　${conflict.verdict}　${conflict.statement}`);
    for (const drop of proposal.rejected) console.log(`   ✗丢弃  ${drop.what}：${drop.why}${drop.quote ? `　「${drop.quote}」` : ""}`);
    totals = {
      entries: totals.entries + proposal.entries.length,
      facts: totals.facts + proposal.facts.length,
      relations: totals.relations + proposal.relations.length,
      contradictions: totals.contradictions + proposal.contradictions.length,
      rejected: totals.rejected + proposal.rejected.length,
    };
    if (commit) {
      // 一份资料写失败不该带走整批——前面那些已经花过钱了。
      try {
        applyProposal(source, proposal);
        recordIngest(source, proposal, "applied");
      } catch (error) {
        console.log(`   写入失败：${error.message}`);
        recordIngest(source, proposal, "failed", error.message);
      }
    }
    console.log("");
  }

  console.log(`合计　词条 ${totals.entries}　事实 ${totals.facts}　关系 ${totals.relations}　矛盾 ${totals.contradictions}　丢弃 ${totals.rejected}`);
  // 丢弃率是判断「这个模型能不能用」的硬指标，比读几条产出凭感觉判断可靠。
  const produced = totals.entries + totals.facts + totals.contradictions;
  if (produced + totals.rejected > 0) console.log(`逐字校验丢弃率　${Math.round((totals.rejected / (produced + totals.rejected)) * 100)}%`);
  if (!commit) console.log("\n这是预演，没有写入。确认质量后加 --commit 再跑一次。");
} finally {
  workspace.close();
}
