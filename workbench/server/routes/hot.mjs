import { fail, json, readJsonBody } from "../lib/http.mjs";
import { fetchAiHot, fetchModels } from "../lib/aihot.mjs";
import { fetchBoards, sixtyConfigured } from "../lib/sixty.mjs";
import { DEFAULT_ATTENTION, compileDomain, matchDomain } from "../lib/attention.mjs";
import { readArticle } from "../lib/article.mjs";

const TTL = { boards: 10 * 60_000, ai: 30 * 60_000, models: 6 * 60 * 60_000 };
const FAIL_TTL = 60_000;
const cache = { boards: null, ai: null, models: null };

const today = () => new Date().toLocaleDateString("sv-SE");
const dayOf = (value) => (value ? new Date(value).toLocaleDateString("sv-SE") : "");

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function snapshot(workspace, key) {
  return workspace.repository.getSetting(`hot-snapshot:${key}`, null);
}

function saveSnapshot(workspace, key, payload) {
  workspace.repository.setSetting(`hot-snapshot:${key}`, payload);
}

async function buildBoards(env) {
  const boards = await fetchBoards(env);
  return {
    date: today(),
    fetchedAt: new Date().toISOString(),
    boards,
    stats: {
      total: boards.reduce((count, board) => count + board.count, 0),
      live: boards.filter((board) => board.ok).length,
      dead: boards.filter((board) => !board.ok).length,
    },
  };
}

async function buildAi() {
  const response = await fetchAiHot();
  return {
    date: today(),
    fetchedAt: new Date().toISOString(),
    ok: response.ok,
    error: response.error || "",
    items: [...response.items].sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))),
  };
}

function topReasons(boards) {
  const reasons = [...new Set(boards.filter((board) => !board.ok).map((board) => board.reason || board.error).filter(Boolean))];
  return reasons.slice(0, 2).join("、") + (reasons.length > 2 ? " 等" : "");
}

function applyAttention(items, attention) {
  const compiled = attention.domains.map(compileDomain);
  return items.flatMap((item) => {
    const text = `${item.title}\n${item.summary}`;
    const hits = compiled.flatMap((domain) => {
      const word = matchDomain(text, domain);
      return word ? [{ domain: domain.name, word }] : [];
    });
    return hits.length ? [{ ...item, hits }] : [];
  });
}

function groupByDay(items) {
  const groups = new Map();
  for (const item of items) {
    const day = dayOf(item.at) || "更早";
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item);
  }
  return [...groups.entries()].map(([day, list]) => ({ day, items: list }));
}

async function serve(res, { key, workspace, build, fallbackMsg, decorate }) {
  const hit = cache[key];
  const fresh = hit && Date.now() - hit.at < (hit.failed ? FAIL_TTL : TTL[key]);
  let payload = fresh ? hit.payload : await build();
  const failed = fresh ? hit.failed : key === "boards" ? !payload.boards.some((board) => board.ok) : !payload.ok;
  const checkedAt = fresh ? hit.at : Date.now();
  if (!fresh) cache[key] = { at: checkedAt, payload, failed };
  if (!failed) saveSnapshot(workspace, key, payload);
  if (failed) {
    const fallback = snapshot(workspace, key);
    const hint = typeof fallbackMsg === "function" ? fallbackMsg(payload) : fallbackMsg;
    if (fallback) {
      return json(res, {
        ok: true,
        ...decorate(fallback),
        stale: true,
        staleHint: hint,
        checkedAt: new Date(checkedAt).toISOString(),
      });
    }
    return json(res, { ok: true, ...decorate(payload), stale: false, staleHint: hint, cached: fresh });
  }
  json(res, { ok: true, ...decorate(payload), stale: false, cached: fresh });
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || ["ref", "source", "spm", "from", "share_token", "scene", "chksm"].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString().toLowerCase();
  } catch {
    return "";
  }
}

function traceLinks(workspace, links) {
  const items = Object.fromEntries(links.map((link) => [link, { stage: "未处理" }]));
  const captures = workspace.db.prepare(`SELECT c.id,c.title,c.source_url AS url FROM captures c JOIN entities e ON e.id=c.id AND e.deleted_at IS NULL WHERE c.source_url<>''`).all();
  const materials = workspace.db.prepare(`SELECT m.id,m.title,m.source_url AS url FROM materials m JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL WHERE m.source_url<>''`).all();
  const byUrl = new Map([...captures.map((row) => ({ ...row, type: "capture" })), ...materials.map((row) => ({ ...row, type: "material" }))].map((row) => [normalizeUrl(row.url), row]));
  for (const link of links) {
    const source = byUrl.get(normalizeUrl(link));
    if (!source) continue;
    const relation = source.type === "capture"
      ? workspace.db.prepare("SELECT project_id AS id FROM project_sources WHERE source_entity_id=? LIMIT 1").get(source.id)
      : workspace.db.prepare("SELECT project_id AS id FROM project_materials WHERE material_id=? LIMIT 1").get(source.id);
    if (!relation) {
      items[link] = { stage: "已收藏", item: { id: source.id, title: source.title, view: source.type } };
      continue;
    }
    const project = workspace.db.prepare("SELECT id,title,status FROM projects WHERE id=?").get(relation.id);
    const drafts = workspace.db.prepare("SELECT id,title,workflow_status AS status,platform FROM drafts WHERE project_id=?").all(relation.id);
    const published = workspace.db.prepare("SELECT COUNT(*) AS count FROM publication_records p JOIN drafts d ON d.id=p.draft_id WHERE d.project_id=?").get(relation.id).count;
    items[link] = {
      stage: published ? "已发布" : drafts.length ? "已成稿" : "已形成选题",
      item: { id: source.id, title: source.title, view: source.type },
      topic: project,
      drafts,
    };
  }
  return { ok: true, items, degraded: false };
}

export const hotRoutes = [
  {
    method: "POST",
    path: "/api/hot/trace",
    async handler({ workspace: source, req, res }) {
      try {
        const body = await readJsonBody(req);
        const links = Array.isArray(body.links) ? body.links.slice(0, 200) : [];
        json(res, traceLinks(await ready(source), links));
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
  {
    method: "GET",
    path: "/api/hot/boards",
    async handler({ env, workspace: source, res, url }) {
      try {
        if (url.searchParams.get("refresh") === "1") cache.boards = null;
        const workspace = await ready(source);
        await serve(res, {
          key: "boards",
          workspace,
          build: () => buildBoards(env),
          fallbackMsg: (payload) => sixtyConfigured(env)
            ? `刚才一个榜都没读到（${topReasons(payload.boards)}）。过一会儿可再刷新。`
            : "尚未配置 60s 热榜地址；这不影响本地创作。",
          decorate: (payload) => ({ ...payload, configured: sixtyConfigured(env) }),
        });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
  {
    method: "GET",
    path: "/api/hot/ai",
    async handler({ workspace: source, res, url }) {
      try {
        if (url.searchParams.get("refresh") === "1") cache.ai = null;
        const workspace = await ready(source);
        const attention = workspace.repository.getSetting("hot-attention", DEFAULT_ATTENTION);
        const showAll = url.searchParams.get("all") === "1";
        await serve(res, {
          key: "ai",
          workspace,
          build: buildAi,
          fallbackMsg: (payload) => `AI HOT 这次没抓到${payload.error ? `（${payload.error}）` : ""}，过一会儿可再刷新。`,
          decorate: (payload) => {
            const matched = applyAttention(payload.items, attention);
            const shown = showAll ? payload.items.map((item) => ({ ...item, hits: [] })) : matched;
            return {
              date: payload.date,
              fetchedAt: payload.fetchedAt,
              error: payload.error,
              groups: groupByDay(shown),
              attention,
              filtered: !showAll,
              stats: { total: payload.items.length, matched: matched.length, shown: shown.length },
            };
          },
        });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
  {
    method: "GET",
    path: "/api/hot/models",
    async handler({ workspace: source, res, url }) {
      try {
        if (url.searchParams.get("refresh") === "1") cache.models = null;
        await serve(res, {
          key: "models",
          workspace: await ready(source),
          build: async () => ({ ...(await fetchModels({ limit: 20 })), date: today(), fetchedAt: new Date().toISOString() }),
          fallbackMsg: "模型榜这次没解析出来，可稍后重试。",
          decorate: (payload) => payload,
        });
      } catch (error) {
        fail(res, error.message, { status: error.status || 500, hint: error.hint });
      }
    },
  },
  {
    method: "GET",
    path: "/api/hot/read",
    async handler({ env, res, url }) {
      try {
        const target = url.searchParams.get("url") || "";
        if (!target) return fail(res, "缺少 url 参数", { status: 400 });
        json(res, { ok: true, article: await readArticle(target, env) });
      } catch (error) {
        fail(res, error.message, { status: error.status || 502, hint: error.hint });
      }
    },
  },
];
