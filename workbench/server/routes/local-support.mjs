import { fail, json, readRawBody } from "../lib/http.mjs";
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

function currentInsightRun(workspace) {
  return workspace.repository.getSetting("insight-run:last", null);
}

function saveInsightRun(workspace, run) {
  workspace.repository.setSetting("insight-run:last", run);
  return run;
}

function generateInsight(workspace, week) {
  const materials = workspace.db.prepare(`SELECT m.id,m.title,m.body_markdown AS body,m.verification_status AS verification,e.updated_at AS updatedAt
    FROM materials m JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL
    ORDER BY e.updated_at DESC,m.id DESC LIMIT 12`).all();
  if (!materials.length) throw Object.assign(new Error("当前本地工作区还没有可分析的素材"), { status: 409, hint: "先收集或创建至少一条素材，再生成洞察。" });
  const title = `${week} 本地内容洞察`;
  const body = [
    `# ${title}`,
    "",
    "这份报告只依据当前本地工作区已保存的素材生成。",
    "",
    ...materials.flatMap((item, index) => [
      `## ${index + 1}. ${item.title}`,
      "",
      clean(item.body, 800) || "这条素材暂时没有正文。",
      "",
      `核验状态：${item.verification || "未记录"}`,
      "",
    ]),
  ].join("\n");
  const stamp = new Date();
  const locator = `insight:${week}`;
  const existing = workspace.db.prepare(`SELECT k.id FROM knowledge_items k JOIN entities e ON e.id=k.id AND e.deleted_at IS NULL WHERE k.knowledge_kind='knowledge_card' AND k.locator=? ORDER BY e.updated_at DESC LIMIT 1`).get(locator);
  const id = existing?.id || createUlid();
  workspace.repository.transaction(() => {
    if (!existing) {
      workspace.repository.createEntity({ id, type: "knowledge_item", now: stamp });
      workspace.db.prepare("INSERT INTO knowledge_items(id,knowledge_kind,title,body_markdown,locator) VALUES (?,'knowledge_card',?,?,?)").run(id, title, body, locator);
    } else {
      workspace.db.prepare("UPDATE knowledge_items SET title=?,body_markdown=? WHERE id=?").run(title, body, id);
      workspace.domain.touch(id, stamp);
    }
    workspace.repository.setEntityText(id, { title, body, now: stamp });
    workspace.domain.audit(existing ? "insight.updated" : "insight.created", id, { week, materialIds: materials.map((item) => item.id) }, stamp);
  });
  return insightDto(insightRows(workspace).find((item) => item.id === id));
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
  { method: "GET", path: "/api/insights/ready", handler: guard(async ({ workspace, res, url }) => { const week=url.searchParams.get("week")||isoWeek(); const count=workspace.db.prepare("SELECT COUNT(*) AS count FROM materials m JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL").get().count; json(res,{ok:true,week,reportExists:insightRows(workspace).some((item)=>item.locator===`insight:${week}`),materialCount:count,materials:[{source:"workspace",bytes:count}],willFetch:false,missing:[],pending:[],localOnly:true}); }) },
  { method: "GET", path: "/api/insights/run", handler: guard(async ({ workspace, res }) => json(res,{ok:true,run:currentInsightRun(workspace)})) },
  { method: "POST", path: "/api/insights/run", handler: guard(async ({ workspace, req, res }) => { let body={}; try{const chunks=[];for await(const chunk of req)chunks.push(chunk);body=chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};}catch{} const week=clean(body.week,20)||isoWeek(); if(!/^\d{4}-W\d{2}$/.test(week)) throw new Error("洞察周次格式不正确"); const started=iso(); saveInsightRun(workspace,{id:`insight-${week}`,week,status:"running",stageLabel:"整理本地素材",percent:20,startedAt:started}); const report=generateInsight(workspace,week); const run=saveInsightRun(workspace,{id:`insight-${week}`,week,status:"done",stageLabel:"已生成本地洞察",percent:100,startedAt:started,finishedAt:iso(),reportId:report.id}); json(res,{ok:true,run,report}); }) },
  { method: "POST", path: "/api/insights/run/cancel", handler: guard(async ({ workspace, res }) => { const current=currentInsightRun(workspace); const run=current?.status==="running"?saveInsightRun(workspace,{...current,status:"cancelled",stageLabel:"已中止",finishedAt:iso()}):current; json(res,{ok:true,run}); }) },
  { method: "POST", path: "/api/workspace/external-publications/import", handler: guard(async ({ workspace, req, res, url }) => { const filename=url.searchParams.get("filename")||""; const platform=clean(url.searchParams.get("platform")||guessPlatform(filename),80); if(!platform) throw new Error("请先选择这份数据所属的平台"); const bytes=await readRawBody(req,40_000_000); if(!bytes.length) throw new Error("文件是空的"); const parsed=parseExport(bytes,{filename,platform,today:today()}); if(!parsed.rows.length) throw Object.assign(new Error("这份文件里没有能用的行"),{hint:`读到的表头是：${parsed.headers.slice(0,8).join(" / ")||"（空）"}`}); json(res,importPreview(workspace,parsed,{dry:url.searchParams.get("dry")==="1",platform})); }) },
  { method: "POST", path: "/api/workspace/publications/reconcile", handler: guard(async ({ workspace, res }) => { const total=workspace.db.prepare("SELECT COUNT(*) AS count FROM publication_records p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL").get().count; json(res,{ok:true,localOnly:true,total,written:[],skipped:total,message:"发布记录已经保存在当前本地工作区，无需额外归档。"}); }) },
];
