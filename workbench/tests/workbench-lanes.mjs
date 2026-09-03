// 值班台：四条链各自算得出下一步，算不出来就说这条链没事。
//
// ⚠️ 这一层最容易出的问题不是算错，是**为了让屏幕不空而硬凑一件待办**。
// 那会让人不再相信这块屏幕——和长期议程阈值是同一条规矩。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import { observeLanes, LANE_KEYS } from "../server/domain/workbench-lanes.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-lanes-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-03T10:00:00.000Z");
let workspace;
let server;

const check = (name, value) => { assert(value, name); console.log(` ✓ ${name}`); };
const lane = (result, key) => result.lanes.find((item) => item.key === key);

function book(title, sections) {
  const id = createUlid();
  const stamp = now.toISOString();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id, type: "book", now });
    workspace.db.prepare("INSERT INTO books(id,title,author,reading_status) VALUES (?,?,'','在读')").run(id, title);
    for (let index = 0; index < sections; index += 1) {
      const docId = createUlid();
      workspace.repository.createEntity({ id: docId, type: "book_document", now });
      workspace.db.prepare(`INSERT INTO book_documents(id,book_id,title,body_markdown,document_order)
        VALUES (?,?,?,?,?)`).run(docId, id, `第 ${index + 1} 节`, "正文", index + 1);
    }
  });
  void stamp;
  return id;
}

function ingest(bookId, status) {
  const doc = workspace.db.prepare("SELECT id FROM book_documents WHERE book_id = ? LIMIT 1").get(bookId);
  workspace.db.prepare(`INSERT INTO source_ingests(source_entity_id,status,model,run_at)
    VALUES (?,?,'test',?)`).run(doc.id, status, now.toISOString());
  return doc.id;
}

try {
  workspace = await openWorkspace({ xenhoHome, now });
  const api = createApi({}, { workspace: Promise.resolve(workspace) });
  server = http.createServer((req, res) => api(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // ── 全空：四条链都说没事，不硬凑 ────────────────────────────────
  const empty = observeLanes(workspace);
  check("四条链都在，顺序固定", empty.lanes.map((item) => item.key).join() === LANE_KEYS.join());
  check("没有任何东西时不硬凑待办", empty.busy === 0 && empty.lanes.every((item) => item.quiet));
  check("没事的那条也带着这条链是干什么的", lane(empty, "knowledge").goal === "我能想起我知道什么");

  // ── 知识：先清等着点头的，再谈还没开始的 ──────────────────────────
  book("平凡的世界", 4);
  const nava = book("纳瓦尔宝典", 2);
  const notYet = observeLanes(workspace);
  check("没提炼的章节数是数出来的", lane(notYet, "knowledge").next.count === 6);
  check("并且说得出主要压在哪几本上",
    /平凡的世界》4 节/.test(lane(notYet, "knowledge").next.detail));

  ingest(nava, "proposed");
  const waiting = observeLanes(workspace);
  check("有候选等着点头时，它盖过「还没提炼」那个更大的数",
    waiting.lanes.find((item) => item.key === "knowledge").next.count === 1
    && /等着你点头/.test(lane(waiting, "knowledge").next.text));
  check("点进去落到审核那一屏，不是词条列表",
    lane(waiting, "knowledge").next.view === "entries" && lane(waiting, "knowledge").next.state === "review");

  workspace.db.prepare("UPDATE source_ingests SET status='applied'").run();
  check("点过头之后又回到「还没提炼」这条", lane(observeLanes(workspace), "knowledge").next.count === 5);

  // ── 内容：证据层薄要盖过「几篇在写」 ─────────────────────────────
  const projectId = createUlid();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id: projectId, type: "project", now });
    workspace.db.prepare(`INSERT INTO projects(id,title,brief_markdown,viewpoint,audience,primary_platform,priority,status)
      VALUES (?,?,'','','','公众号','中','active')`).run(projectId, "在写的一篇");
  });
  const thin = observeLanes(workspace);
  check("证据层薄的时候，它比「几篇在写」更该被说出来",
    /扫描还看不出反复/.test(thin.lanes.find((item) => item.key === "content").next.text));
  check("同时不隐瞒还有几篇在写", /1 个项目在写/.test(lane(thin, "content").next.detail));

  for (let index = 0; index < 3; index += 1) {
    workspace.audienceRaw.record({
      kind: "comment", body: `第 ${index} 段真实原话，够长以便通过校验。`,
      actor: "user", confirmed: true, now,
    });
  }
  const unread = observeLanes(workspace);
  check("有没读过的原话时，先说这件事", /还没读过/.test(lane(unread, "content").next.text)
    && lane(unread, "content").next.count === 3);

  workspace.db.prepare("UPDATE audience_raw_sources SET analyzed_at = ?").run(now.toISOString());
  check("读完之后才轮到「几个项目在写」", /个项目在写/.test(lane(observeLanes(workspace), "content").next.text));

  // ── 运营：发出去了但对不上稿子，是待办不是数据错误 ────────────────
  const orphanId = createUlid();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id: orphanId, type: "external_publication_record", now });
    workspace.db.prepare(`INSERT INTO external_publication_records(id,platform,title,published_url,published_at,views,likes,comments,collects,shares,source)
      VALUES (?,'小红书','对不上的一篇','',?,0,0,0,0,0,'import')`).run(orphanId, now.toISOString());
  });
  const ops = observeLanes(workspace);
  check("「发出去了但没有对应稿子」被当成一条待办",
    /工作台里没有对应的稿子/.test(lane(ops, "ops").next.text) && lane(ops, "ops").next.count === 1);
  check("点进去落到那一档筛选上", lane(ops, "ops").next.state === "unmatched");

  // ── 情报 ──────────────────────────────────────────────────────
  check("情报没事的时候如实说没事", lane(ops, "intel").quiet === true);
  const captureId = createUlid();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id: captureId, type: "capture", now });
    workspace.db.prepare(`INSERT INTO captures(id,capture_kind,title,body_markdown,source_url,status,reaction)
      VALUES (?,'article','一条没归的收藏','','','pending','')`).run(captureId);
  });
  const intel = observeLanes(workspace);
  check("待归收藏算得出来并列得出是哪几条",
    lane(intel, "intel").next.count === 1 && /一条没归的收藏/.test(lane(intel, "intel").next.detail));

  // ── 接口 ──────────────────────────────────────────────────────
  const response = await fetch(`${base}/api/workspace/lanes`);
  const data = await response.json();
  check("接口回四条链", response.status === 200 && data.ok === true && data.lanes.length === 4);
  check("并且说得出几条有事", data.busy === 4);

  const before = workspace.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get().n;
  await fetch(`${base}/api/workspace/lanes`);
  check("看一眼值班台不产生任何写入",
    workspace.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get().n === before);

  console.log("\n四条链值班台验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
