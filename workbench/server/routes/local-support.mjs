import { intelligenceOverview,enqueueIntelligence,cancelIntelligence } from "../domain/intelligence.mjs";
import { fail, json, readRawBody, readJsonBody } from "../lib/http.mjs";
import { guessPlatform, normalizeNumber, parseExport } from "../lib/posts.mjs";
import { createUlid } from "../storage/ids.mjs";

const clean = (value, max = 80_000) => String(value ?? "").trim().slice(0, max);
const iso = (value = new Date()) => new Date(value).toISOString();
const today = () => iso().slice(0, 10);

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guard(handler) {
  return async (context) => {
    try {
      await handler({ ...context, workspace: await ready(context.workspace) });
    } catch (error) {
      fail(context.res, error.message || "本地工作区操作失败", { status: error.status || 400, hint: error.hint });
    }
  };
}

function isoWeek(value = new Date()) {
  const date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - first) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function insightRows(workspace) {
  return workspace.db.prepare(`SELECT k.id,k.title,k.body_markdown AS body,k.locator,e.created_at AS createdAt,e.updated_at AS updatedAt
    FROM knowledge_items k JOIN entities e ON e.id=k.id AND e.deleted_at IS NULL
    WHERE k.knowledge_kind='knowledge_card' AND k.locator LIKE 'insight:%'
    ORDER BY e.updated_at DESC,k.id DESC`).all();
}

function insightDto(row) {
  const week = clean(row.locator).slice("insight:".length);
  const preview = clean(row.body, 260).replace(/[#*_>`~-]+/g, " ").replace(/\s+/g, " ");
  return {
    id: row.id,
    path: `workspace:insight:${row.id}`,
    title: row.title,
    week,
    period: "",
    preview,
    chars: String(row.body || "").length,
    cards: (String(row.body || "").match(/^##\s+/gm) || []).length,
    generatedAt: row.updatedAt || row.createdAt,
  };
}

function existingExternal(workspace, row) {
  const publishedAt = `${row.date}T00:00:00.000Z`;
  if (row.url) return workspace.db.prepare("SELECT id FROM external_publication_records WHERE platform=? AND published_url=?").get(row.platform, row.url);
  return workspace.db.prepare("SELECT id FROM external_publication_records WHERE platform=? AND published_at=? AND title=?").get(row.platform, publishedAt, row.title);
}

function upsertExternal(workspace, row, stamp) {
  const existing = existingExternal(workspace, row);
  const id = existing?.id || createUlid();
  const publishedAt = `${row.date}T00:00:00.000Z`;
  const metrics = ["views", "likes", "comments", "collects", "shares"].map((name) => normalizeNumber(row[name]));
  if (!existing) workspace.repository.createEntity({ id, type: "external_publication", now: stamp });
  workspace.db.prepare(`INSERT INTO external_publication_records(id,platform,title,published_url,published_at,views,likes,comments,collects,shares,source)
    VALUES (?,?,?,?,?,?,?,?,?,?,'import') ON CONFLICT(id) DO UPDATE SET platform=excluded.platform,title=excluded.title,published_url=excluded.published_url,
    published_at=excluded.published_at,views=excluded.views,likes=excluded.likes,comments=excluded.comments,collects=excluded.collects,shares=excluded.shares,source='import'`)
    .run(id, row.platform, row.title, row.url || "", publishedAt, ...metrics);
  workspace.repository.setEntityText(id, { title: row.title, body: row.url || "", now: stamp });
  if (existing) workspace.domain.touch(id, stamp);
  workspace.domain.audit(existing ? "external_publication.updated" : "external_publication.created", id, { source: "import", platform: row.platform }, stamp);
  return Boolean(existing);
}

function importPreview(workspace, parsed, { dry, platform }) {
  let added = 0;
  let updated = 0;
  for (const row of parsed.rows) existingExternal(workspace, row) ? updated += 1 : added += 1;
  if (!dry) {
    const stamp = new Date();
    workspace.repository.transaction(() => {
      for (const row of parsed.rows) upsertExternal(workspace, row, stamp);
    });
  }
  return {
    ok: true,
    dry,
    platform,
    added,
    updated,
    total: parsed.rows.length,
    mapping: parsed.mapping,
    unmapped: parsed.unmapped,
    warnings: parsed.warnings,
    skipped: parsed.skipped.slice(0, 5),
    skippedCount: parsed.skipped.length,
    preview: parsed.rows.slice(0, 6),
  };
}

export const localSupportRoutes = [
  { method: "GET", path: "/api/workspace/insights", handler: guard(async ({ workspace, res }) => json(res, { ok: true, exists: true, dir: "SQLite workspace", reports: insightRows(workspace).map(insightDto) })) },
  { method: "GET", path: "/api/workspace/insights/:id", handler: guard(async ({ workspace, res, params }) => { const row=insightRows(workspace).find((item)=>item.id===params.id); if(!row) throw Object.assign(new Error("洞察报告不存在"),{status:404}); json(res,{ok:true,id:row.id,title:row.title,content:row.body,stamp:String(workspace.repository.getEntity(row.id).version),notes:"",noteItems:[],meta:{id:row.id,editedAt:row.updatedAt}}); }) },
  { method: "GET", path: "/api/insights/ready", handler: guard(async ({ workspace, res }) => { const state=intelligenceOverview(workspace);json(res,{ok:true,ready:state.profiles.length>0,profiles:state.profiles,runs:state.runs}); }) },
  { method: "GET", path: "/api/insights/run", handler: guard(async ({ workspace, res }) => json(res,{ok:true,run:intelligenceOverview(workspace).runs[0]||null})) },
  { method: "POST", path: "/api/insights/run", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req,20000); if(!body.profileId) throw Object.assign(new Error("请先在关注与调研中选择关注方向"),{status:409}); json(res,{ok:true,run:enqueueIntelligence(workspace,body.profileId)}); }) },
  { method: "POST", path: "/api/insights/run/cancel", handler: guard(async ({ workspace, res }) => { const run=intelligenceOverview(workspace).runs[0];json(res,{ok:true,run:run?cancelIntelligence(workspace,run.id):null}); }) },
  { method: "POST", path: "/api/workspace/external-publications/import", handler: guard(async ({ workspace, req, res, url }) => { const filename=url.searchParams.get("filename")||""; const platform=clean(url.searchParams.get("platform")||guessPlatform(filename),80); if(!platform) throw new Error("请先选择这份数据所属的平台"); const bytes=await readRawBody(req,40_000_000); if(!bytes.length) throw new Error("文件是空的"); const parsed=parseExport(bytes,{filename,platform,today:today()}); if(!parsed.rows.length) throw Object.assign(new Error("这份文件里没有能用的行"),{hint:`读到的表头是：${parsed.headers.slice(0,8).join(" / ")||"（空）"}`}); json(res,importPreview(workspace,parsed,{dry:url.searchParams.get("dry")==="1",platform})); }) },
  { method: "POST", path: "/api/workspace/publications/reconcile", handler: guard(async ({ workspace, res }) => { const total=workspace.db.prepare("SELECT COUNT(*) AS count FROM publication_records p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL").get().count; json(res,{ok:true,localOnly:true,total,written:[],skipped:total,message:"发布记录已经保存在当前本地工作区，无需额外归档。"}); }) },
];
