import { fail, json, readJsonBody } from "../lib/http.mjs";
import { createUlid } from "../storage/ids.mjs";

const TRACKING_KEYS = new Set(["fbclid", "gclid", "dclid", "msclkid", "spm", "ref_src"]);

function normalizeWebUrl(input) {
  const raw = String(input || "").trim();
  if (!raw || raw.length > 4096) throw Object.assign(new Error("网页地址无效"), { status: 400 });
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error("网页地址无效"), { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error("只支持 http / https 网页"), { status: 400 });
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString().slice(0, 2048);
}

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guarded(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await ready(context.workspace) }); }
    catch (error) { fail(context.res, error.message || "扩展请求失败", { status: error.status || 400, hint: error.hint }); }
  };
}

function noteItems(workspace, url) {
  return workspace.db.prepare(`SELECT k.id, k.quote_text AS quote, k.body_markdown AS body, k.source_url AS sourceUrl,
      e.version, e.created_at AS createdAt
    FROM knowledge_items k JOIN entities e ON e.id=k.id AND e.deleted_at IS NULL
    WHERE k.knowledge_kind='web_annotation' AND k.source_url=? ORDER BY e.created_at, k.id`).all(url).map((row) => ({
      id: row.id,
      index: row.id,
      stamp: String(row.version),
      quote: row.quote,
      body: row.body,
      source: `[网页原文](${row.sourceUrl})`,
      createdAt: row.createdAt,
    }));
}

export const extensionRoutes = [
  {
    method: "GET",
    path: "/api/extension/status",
    handler: guarded(async ({ workspace, res, extensionToken }) => json(res, {
      ok: true,
      name: "Xenho 网页助手",
      version: 3,
      product: "content-studio",
      protocolVersion: 3,
      pairToken: extensionToken,
      ready: true,
      services: { workspace: true },
      capabilities: { collectionsV1: true, localWorkspace: true, stableAnnotations: true },
      workspaceId: workspace.manifest.workspaceId,
    })),
  },
  {
    method: "GET",
    path: "/api/extension/annotations",
    handler: guarded(async ({ workspace, res, url }) => {
      const normalizedUrl = normalizeWebUrl(url.searchParams.get("url"));
      json(res, { ok: true, normalizedUrl, title: String(url.searchParams.get("title") || "未命名网页").slice(0, 300), noteItems: noteItems(workspace, normalizedUrl) });
    }),
  },
  {
    method: "POST",
    path: "/api/extension/annotation",
    handler: guarded(async ({ workspace, req, res }) => {
      const input = await readJsonBody(req, 100_000);
      const normalizedUrl = normalizeWebUrl(input.url);
      const quote = String(input.selection || "").trim();
      const body = String(input.body || "").trim();
      if (!quote) throw new Error("请先在网页上选中一段文字");
      if (!body) throw new Error("批注内容不能为空");
      if (quote.length > 4_000 || body.length > 8_000) throw new Error("批注内容过长");
      const id = createUlid(); const stamp = new Date();
      workspace.repository.transaction(() => {
        workspace.repository.createEntity({ id, type: "knowledge_item", now: stamp });
        workspace.db.prepare("INSERT INTO knowledge_items(id, knowledge_kind, title, body_markdown, quote_text, source_url, locator) VALUES (?, 'web_annotation', ?, ?, ?, ?, '')")
          .run(id, String(input.title || "未命名网页").slice(0, 300), body, quote, normalizedUrl);
        workspace.repository.setEntityText(id, { title: String(input.title || "未命名网页"), body: `${quote}\n\n${body}`, now: stamp });
      });
      json(res, { ok: true, normalizedUrl, noteItems: noteItems(workspace, normalizedUrl) });
    }),
  },
  {
    method: "POST",
    path: "/api/extension/annotation/edit",
    handler: guarded(async ({ workspace, req, res }) => {
      const input = await readJsonBody(req, 100_000);
      const normalizedUrl = normalizeWebUrl(input.url);
      const id = String(input.id || input.index || "");
      const entity = workspace.repository.getEntity(id);
      const item = workspace.db.prepare("SELECT * FROM knowledge_items WHERE id=? AND knowledge_kind='web_annotation' AND source_url=?").get(id, normalizedUrl);
      if (!entity || !item) throw Object.assign(new Error("找不到这条网页批注"), { status: 404 });
      if (String(entity.version) !== String(input.expectedVersion ?? input.stamp ?? "")) throw Object.assign(new Error("批注已在别处更新，请刷新后再试"), { status: 409 });
      if (input.remove) workspace.domain.softDeleteEntity(id, { actor: "user", now: new Date() });
      else {
        const body = String(input.body || "").trim(); if (!body) throw new Error("批注内容不能为空");
        workspace.db.prepare("UPDATE knowledge_items SET body_markdown=? WHERE id=?").run(body, id);
        workspace.repository.setEntityText(id, { title: item.title, body: `${item.quote_text}\n\n${body}`, now: new Date() });
        workspace.db.prepare("UPDATE entities SET version=version+1 WHERE id=?").run(id);
      }
      json(res, { ok: true, normalizedUrl, noteItems: noteItems(workspace, normalizedUrl) });
    }),
  },
];
