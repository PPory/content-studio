// 写作现场的召回。
//
// ⚠️ **这个端点曾经每次调用都 500，而且没人发现。**
// 路由里少了 `ENTRY_RELATION_LABELS` 的 import——ESM 引一个不存在的名字不报编译错，
// 只在那一行真的跑到时抛 ReferenceError。前端 `.catch(() => setData(null))`，
// 于是「没命中」和「请求挂了」在屏幕上长得一模一样：整块不画。
// 结果是那 90 多条词条在整个工作台里等于不存在，而构建、类型和当时的全部测试都是绿的。
//
// 所以这里第一条断言是**最笨的那条**：接口到底回没回 ok。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { createUlid } from "../server/storage/ids.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-recall-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-04T09:00:00.000Z");
let workspace;
let server;

const check = (name, value) => { assert(value, name); console.log(` ✓ ${name}`); };

function entry(name, definition, body) {
  const id = createUlid();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id, type: "entry", now });
    workspace.db.prepare("INSERT INTO entries(id,name,entry_kind,definition) VALUES (?,?,'concept',?)")
      .run(id, name, definition);
    workspace.repository.setEntityText(id, { title: name, body: body || definition, now });
  });
  return id;
}

try {
  workspace = await openWorkspace({ xenhoHome, now });
  const api = createApi({}, { workspace: Promise.resolve(workspace) });
  server = http.createServer((req, res) => api(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const recall = async (text) => {
    const response = await fetch(`${base}/api/workspace/knowledge/recall`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return { status: response.status, data: await response.json() };
  };

  const pyramid = entry("金字塔原理", "先给结论再给支撑的表达结构。", "金字塔原理 结论先行 归类分组");
  const structured = entry("结构化思维", "把想法按层级组织起来的方法。", "结构化思维 分层 归纳");
  entry("完全无关的词条", "讲的是养猫怎么剪指甲这件事。", "养猫 剪指甲 猫抓板");

  workspace.db.prepare(`INSERT INTO entity_relations(from_id,to_id,relation_type,created_at)
    VALUES (?,?,'related_to',?)`).run(pyramid, structured, now.toISOString());

  // ── 最笨也最重要的一条 ────────────────────────────────────────────
  const draft = "我在写一篇讲表达的稿子。金字塔原理这套东西说到底是让人先说结论，"
    + "但真正难的地方从来不是记住这条规则，而是你得先想清楚自己到底要下什么判断。";
  const hit = await recall(draft);
  check("端点根本没在报错", hit.status === 200 && hit.data.ok === true);
  check("正文里提到的词条被召回", hit.data.entries.some((item) => item.name === "金字塔原理"));

  /**
   * ⚠️ **这一栏的价值全在这条上。**
   * 只回显「你正文里提过的词」是个回声，没人需要；有用的是**你没提到、
   * 但连着你提到的那个**——正文里没有「结构化思维」四个字，它靠关系被带出来。
   */
  const brought = hit.data.entries.find((item) => item.name === "结构化思维");
  check("没提到但连着的那个也被带出来", Boolean(brought));
  check("并且说得清它凭什么在这儿", /金字塔原理/.test(brought.via || ""));
  check("不相干的不硬凑", !hit.data.entries.some((item) => item.name === "完全无关的词条"));

  // ── 附带回去的标签也要真的存在，不能是 undefined ─────────────────
  check("关系标签跟着回去了", hit.data.relationLabels && typeof hit.data.relationLabels === "object"
    && Object.keys(hit.data.relationLabels).length > 0);
  check("类型标签跟着回去了", hit.data.kindLabels && Object.keys(hit.data.kindLabels).length > 0);

  // ── 太短就不查：写到一半的句子召回不出东西，问了也是白问 ────────────
  const tiny = await recall("金字塔");
  check("太短的正文不查，但也不报错", tiny.status === 200 && tiny.data.ok === true && tiny.data.entries.length === 0);

  // ── 只读 ─────────────────────────────────────────────────────────
  const before = workspace.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get().n;
  await recall(draft);
  check("召回一次不写任何东西",
    workspace.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get().n === before);

  console.log("\n写作现场召回验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
