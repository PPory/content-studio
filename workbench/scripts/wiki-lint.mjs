#!/usr/bin/env node
// 知识库体检：判张力、补孤儿。
//
//   node scripts/wiki-lint.mjs                 # 预演，只看判断
//   node scripts/wiki-lint.mjs --commit        # 把判定写进库
//   node scripts/wiki-lint.mjs --only tension  # 只判张力（或 orphan）
//
// ⚠️ **默认预演。** 张力判定会改事实的状态（推翻/冲突），补关系会改词条的连接——
// 两者都会影响以后写作时召回到什么，看过再写。

import fs from "node:fs/promises";
import path from "node:path";
import { envFilePath, parseEnv } from "../server/lib/env-file.mjs";
import { ingestModelId } from "../server/lib/model-json.mjs";
import { entriesNeedingTensionCheck, judgeOrphan, judgeTension } from "../server/domain/wiki-lint.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith("--") ? args[at + 1] : fallback;
};
const commit = args.includes("--commit");
const only = flag("only");
const limit = Math.max(1, Number(flag("limit", "40")) || 40);
const model = flag("model");
const actor = "user";

const env = parseEnv(await fs.readFile(envFilePath(ROOT), "utf8"));
const workspace = await openWorkspace({});

try {
  console.log(`${commit ? "体检并写入" : "体检预演"}　模型 ${model || ingestModelId(env)}\n`);
  let tensionCount = 0;
  let linkCount = 0;

  if (only !== "orphan") {
    const entries = entriesNeedingTensionCheck(workspace, { limit });
    console.log(`── 判张力：${entries.length} 个词条有多来源事实`);
    for (const entry of entries) {
      let judged;
      try { judged = await judgeTension(workspace, env, { entryId: entry.id, model }); }
      catch (error) { console.log(`   ✗ ${entry.name}：${error.message}`); continue; }
      if (!judged.tensions.length) continue;
      for (const tension of judged.tensions) {
        tensionCount += 1;
        console.log(`   ⚠ 【${judged.name}】${tension.verdict === "supersede" ? "推翻" : "并存冲突"}　${tension.why}`);
        console.log(`      A: ${tension.left}`);
        console.log(`      B: ${tension.right}`);
        if (!commit) continue;
        try {
          // supersede 的方向：**后说的推翻先说的**。模型给的 left/right 顺序不可靠，
          // 按事实的 asserted_at 定序才是有依据的。
          if (tension.verdict === "supersede") workspace.domain.supersedeEntryFact(tension.leftFactId, { supersededBy: tension.rightFactId, actor, now: new Date() });
          else workspace.domain.disputeEntryFacts(tension.leftFactId, tension.rightFactId, { actor, now: new Date() });
        } catch (error) { console.log(`      写入失败：${error.message}`); }
      }
    }
    console.log(`   共 ${tensionCount} 处张力\n`);
  }

  if (only !== "tension") {
    const orphans = workspace.domain.entryOrphans({ limit });
    console.log(`── 补孤儿：${orphans.length} 个词条没有任何关系`);
    for (const orphan of orphans) {
      let judged;
      try { judged = await judgeOrphan(workspace, env, { entryId: orphan.id, model }); }
      catch (error) { console.log(`   ✗ ${orphan.name}：${error.message}`); continue; }
      if (!judged.links.length) {
        console.log(`   · ${orphan.name}　连不上（${judged.skipped || "模型认为没有成立的关系"}）`);
        continue;
      }
      for (const link of judged.links) {
        linkCount += 1;
        console.log(`   ↔ ${orphan.name} --${link.type}--> ${link.to}　（${link.why}）`);
        if (!commit) continue;
        try { workspace.domain.linkEntries(orphan.id, link.toId, link.type, { actor, now: new Date() }); }
        catch (error) { console.log(`      写入失败：${error.message}`); }
      }
    }
    console.log(`   共补 ${linkCount} 条关系\n`);
  }

  console.log(`合计　张力 ${tensionCount}　新关系 ${linkCount}`);
  if (!commit) console.log("这是预演，没有写入。确认判断可靠后加 --commit 再跑一次。");
} finally {
  workspace.close();
}
