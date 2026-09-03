// 链和链之间的两个交汇：内容 → 知识、情报 → 知识。
//
// ⚠️ 这一步唯一的危险是**顺手把逐字闸也放松掉**。
// 允许「来源是我自己的实践」，改的是「什么算一份来源」——
// 而不是「引用要不要对得上」。结算记录是你自己写下并确认过的文本，
// 引它和引一本书一样可以逐字核对。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import { resolveIngestSource, validateProposal, quoteGrounded } from "../server/domain/wiki-ingest.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-practice-wiki-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-03T11:00:00.000Z");
let workspace;
let server;

const check = (name, value) => { assert(value, name); console.log(` ✓ ${name}`); };

const HYPOTHESIS = "把结论放在开头会让完读率变高，因为读者不用等。";
const OUTCOME = "完读率从 21% 掉到 14%，但收藏数翻了一倍。";
const LEARNING = "开头给结论会赶走还没同意的人；先给处境再给判断，留得住的人才是要说服的人。";

try {
  workspace = await openWorkspace({ xenhoHome, now });
  const api = createApi({}, { workspace: Promise.resolve(workspace) });
  server = http.createServer((req, res) => api(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const projectId = createUlid();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id: projectId, type: "project", now });
    workspace.db.prepare(`INSERT INTO projects(id,title,brief_markdown,viewpoint,audience,primary_platform,priority,status)
      VALUES (?,?,'','','','公众号','中','active')`).run(projectId, "结论前置试一次");
  });
  const experimentId = workspace.experiments.recordHypothesis({
    projectId, hypothesisMarkdown: HYPOTHESIS, actor: "user", confirmed: true, now,
  });

  // ── 没结算之前：不是知识，沉淀不了 ────────────────────────────────
  check("还没结算的假设解析不出来源", resolveIngestSource(workspace.db, experimentId) === null);
  const early = await fetch(`${base}/api/workspace/knowledge/ingest`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ experimentIds: [experimentId] }),
  });
  const earlyData = await early.json();
  check("接口也拒绝，并说清为什么", early.status >= 400 && /还没结算/.test(earlyData.error));
  check("并且给的是下一步而不是一句拒绝", /先在运营那一栏结算它/.test(earlyData.hint || ""));

  // ── 结算之后：它是一份可以被逐字核对的来源 ──────────────────────────
  workspace.experiments.settleExperiment(experimentId, {
    outcomeMarkdown: OUTCOME, learningMarkdown: LEARNING, verdict: "refuted",
    actor: "user", confirmed: true, now,
  });
  const source = resolveIngestSource(workspace.db, experimentId);
  check("结算之后才成为来源", Boolean(source) && source.id === experimentId);
  check("出处写明这是自己的实践，不伪装成外部读物",
    /^我自己的实践/.test(source.locator) && /结论前置试一次/.test(source.locator));

  /**
   * ⚠️ **三段都要留着。** 只给「学到了什么」的话，模型引不出当初赌的是什么，
   * 而一条判断脱离了它被验证的处境，就只是一句漂亮话。
   */
  check("正文带着假设、结果和判断三段",
    source.body.includes(HYPOTHESIS) && source.body.includes(OUTCOME) && source.body.includes(LEARNING));

  // ── 逐字闸一点没松 ────────────────────────────────────────────────
  check("原样引得动", quoteGrounded(source.body, LEARNING));
  check("顺手改通顺过的引不动",
    !quoteGrounded(source.body, "开头给结论会赶走那些还没同意你的人"));

  const good = validateProposal({
    entries: [{ name: "结论前置", kind: "concept", definition: "把判断放在开头的写法。", quote: LEARNING }],
  }, { sourceText: source.body });
  check("引文对得上的词条留下来", good.entries.length === 1 && good.entries[0].name === "结论前置");

  const fabricated = validateProposal({
    // ⚠️ 假引文要够长，否则先被「原文依据太短」拦下，就验不到逐字这一闸了
    entries: [{
      name: "读者偏好", kind: "concept", definition: "凭空一句。",
      quote: "读者其实更喜欢长一点的开头，先铺垫处境再给结论，完读率反而会上去。",
    }],
  }, { sourceText: source.body });
  check("引不出原文的整条被丢掉，和引一本书时一样",
    fabricated.entries.length === 0
    && fabricated.rejected.some((item) => /在资料里找不到/.test(item.why)));

  // ── 排队提炼：走的是原来那条路，不是新开一条 ────────────────────────
  const queued = await fetch(`${base}/api/workspace/knowledge/ingest`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ experimentIds: [experimentId] }),
  });
  const queuedData = await queued.json();
  check("结算过的能排进提炼队列", queued.status === 200 && queuedData.ok === true);
  check("排的是同一张候选表，审核那一关照旧",
    workspace.db.prepare("SELECT COUNT(*) AS n FROM source_ingests WHERE source_entity_id = ?").get(experimentId).n === 1);

  // ── 情报 → 知识：收藏也能提炼 ──────────────────────────────────────
  //
  // ⚠️ 收藏原来只能停在情报那一栏：读过、留着、然后没有下一步。
  const captureId = createUlid();
  const captureBody = "作者说，判断权一旦交出去就很难拿回来，因为你会先失去判断所需要的那些练习。";
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id: captureId, type: "capture", now });
    workspace.db.prepare(`INSERT INTO captures(id,capture_kind,title,body_markdown,source_url,status,reaction)
      VALUES (?,'article','一条读到的帖子',?,'https://example.com/a','pending','')`).run(captureId, captureBody);
  });

  const imported = await fetch(`${base}/api/workspace/knowledge/sources/import`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "capture", captureId }),
  });
  const importedData = await imported.json();
  check("收藏能直接提炼成来源", imported.status === 200 && importedData.ok === true && importedData.book?.id);
  check("并且排进了提炼队列", importedData.queuedForDistill >= 1);
  check("正文原样进了来源，没有被改写",
    workspace.db.prepare("SELECT body_markdown AS body FROM book_documents WHERE book_id = ?")
      .get(importedData.book.id).body === captureBody);
  check("链接跟着存下来",
    workspace.db.prepare("SELECT source_url AS url FROM books WHERE id = ?").get(importedData.book.id).url
      === "https://example.com/a");
  check("提炼过的收藏就算归好了，值班台不再重复报它",
    workspace.db.prepare("SELECT status FROM captures WHERE id = ?").get(captureId).status === "accepted");

  const thinId = createUlid();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id: thinId, type: "capture", now });
    workspace.db.prepare(`INSERT INTO captures(id,capture_kind,title,body_markdown,source_url,status,reaction)
      VALUES (?,'article','只存了个标题','','https://example.com/b','pending','')`).run(thinId);
  });
  const thin = await fetch(`${base}/api/workspace/knowledge/sources/import`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "capture", captureId: thinId }),
  });
  const thinData = await thin.json();
  check("正文太短时说清为什么，并给下一步",
    thin.status >= 400 && /正文太短/.test(thinData.error) && /粘贴链接/.test(thinData.hint || ""));
  check("失败的收藏保持原状，不被顺手标成已归",
    workspace.db.prepare("SELECT status FROM captures WHERE id = ?").get(thinId).status === "pending");

  console.log("\n两个交汇验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
