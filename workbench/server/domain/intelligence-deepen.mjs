// 深度解读按需生成（2026-09-23 决策）：用户第一次点开事件卡时才抓全文、写解读、做逐字引文校验。
// 生成一次后缓存在卡片上（data.depth='deep'）；校验不过就保留热点层并记下原因，不重复花钱。
import { createUlid } from '../storage/ids.mjs';
import { sourceFromRow } from './intelligence-quality.mjs';
import { sourcePermission } from '../acquisition/compatibility.mjs';
import { enqueueAcquisition } from '../acquisition/runner.mjs';
import { generateDailyBriefs } from './intelligence-editor.mjs';
import { intelligenceRun, updateRun } from './intelligence.mjs';
import { canonicalBriefId } from './intelligence-unified.mjs';
import { relevantWikiPages } from './wiki-pages.mjs';

const now = () => new Date().toISOString();
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const MAX_SOURCES = 6, MAX_COMMENTS = 5;
const key = id => `deepen:${id}`;
export function deepenState(w, id) {
  const row = w.db.prepare('SELECT value FROM intel_unified_state WHERE key=?').get(key(id));
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}
const saveState = (w, id, value) => w.db.prepare('INSERT INTO intel_unified_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key(id), JSON.stringify({ ...value, at: now() }));

/** 用户点「深入解读」时的状态：真实阶段（读 intel_runs.stage），以及历史上深读大约要多久（至少 3 次成功才给）。 */
export function deepenStatus(w, id) {
  const s = deepenState(w, id) || { status: 'none' };
  const run = s.runId && ['queued', 'running'].includes(s.status) ? w.db.prepare('SELECT stage FROM intel_runs WHERE id=?').get(s.runId) : null;
  return { ...s, stage: run?.stage || '', estimateSec: deepenEstimate(w) };
}
function deepenEstimate(w) {
  const rows = w.db.prepare("SELECT created_at,updated_at FROM intel_runs WHERE status='done' AND json_extract(config_json,'$.output')='deepen' ORDER BY created_at DESC LIMIT 10").all();
  const secs = rows.map(r => (Date.parse(r.updated_at) - Date.parse(r.created_at)) / 1000).filter(x => x > 0).sort((a, b) => a - b);
  return secs.length >= 3 ? Math.round(secs[Math.floor(secs.length / 2)]) : null;
}

// ── 与已有知识的连接 ──────────────────────────────────────────
const grams2 = text => { const t = String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); const set = new Set(); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; };
const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
/** 一篇 Wiki 里和这件事最相关的 2–3 段（按原顺序），合计不超过 1200 字。 */
function bestParagraphs(body, target) {
  const paras = String(body || '').split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length >= 20);
  // 和这件事几乎不沾边的段落不带（至少 3 个字对重合）。
  const scored = paras.map((p, i) => ({ p, i, score: overlap(grams2(p), target) })).filter(x => x.score >= 3).sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.i - b.i);
  let out = '', best = 0;
  for (const x of scored) { if (out.length + x.p.length > 1200) break; out += (out ? '\n\n' : '') + x.p; best = Math.max(best, x.score); }
  return { text: out || String(body || '').slice(0, 1200), score: best };
}
/**
 * 按事件内容检索相关的 Wiki（不再取最近更新的 30 篇）。排除同源页面：
 * Wiki 的来源里有本事件成员的，不参与连接——新闻和从它提炼的 Wiki 不能互相印证。
 */
export function eventWiki(w, data, { limit = 8 } = {}) {
  const members = (data.event?.members || []).map(m => m.sourceId);
  const text = [data.title, data.summary, ...(data.event?.members || []).map(m => m.title)].join('\n');
  const excluded = new Set(members.length ? w.db.prepare(`SELECT DISTINCT ps.page_id FROM wiki_page_sources ps JOIN intel_sources s ON s.capture_id=ps.source_entity_id WHERE s.id IN (${members.map(() => '?').join(',')})`).all(...members).map(r => r.page_id) : []);
  const target = grams2(text);
  return relevantWikiPages(w, text, { limit: limit + excluded.size }).filter(p => !excluded.has(p.id))
    .map(p => { const best = bestParagraphs(p.bodyMarkdown, target); return { id: p.id, title: p.title, revision: p.revision ?? null, summary: String(p.summary || '').slice(0, 300), body: best.text, score: best.score + overlap(grams2(`${p.title}\n${p.summary}`), target) }; })
    // 只靠一两个常见字重合的不算相关。
    .filter(p => p.score >= 6).sort((a, b) => b.score - a.score).slice(0, limit).map(({ score, ...p }) => p);
}

/** 独立的深读 profile：不参与定时调研，也不会被「更新情报」当成进行中的更新。 */
function deepenProfile(w) {
  const row = w.db.prepare("SELECT id FROM intel_profiles WHERE json_extract(config_json,'$.output')='deepen' LIMIT 1").get();
  if (row) return row.id;
  const id = createUlid(), stamp = now();
  w.db.prepare('INSERT INTO intel_profiles(id,config_json,next_due_at,created_at,updated_at) VALUES(?,?,NULL,?,?)').run(id, JSON.stringify({ id, name: '情报深读', query: '深度解读', frequency: 'manual', providers: ['collected'], limit: 1, output: 'deepen', enabled: false, paidApproved: false, autoSocial: false }), stamp, stamp);
  return id;
}

/** 点开详情时调用。已有解读、或正在生成时直接返回当前状态，不重复排队。 */
export function requestDeepen(w, id, { force = false } = {}) {
  const briefId = canonicalBriefId(w, id);
  const row = w.db.prepare('SELECT * FROM intel_briefs WHERE id=?').get(briefId);
  if (!row) throw bad('情报不存在', 404);
  const data = JSON.parse(row.data_json);
  if (data.depth === 'deep' && !data.deepStale && !force) return { status: 'done', briefId };
  const state = deepenState(w, briefId);
  if (state && ['queued', 'running'].includes(state.status)) return { ...state, briefId };
  if (state?.status === 'failed' && !force) return { ...state, briefId };
  const profileId = deepenProfile(w), runId = createUlid(), stamp = now();
  w.db.prepare("INSERT INTO intel_runs(id,profile_id,config_json,status,stage,created_at,updated_at) VALUES(?,?,?,'queued','等待生成深度解读',?,?)").run(runId, profileId, JSON.stringify({ name: '情报深读', query: data.title || '深度解读', output: 'deepen', providers: ['collected'], frequency: 'manual', limit: 1, briefId }), stamp, stamp);
  const { job } = w.jobs.enqueue({ kind: 'intelligence.deepen', idempotencyKey: `deepen:${briefId}:${runId}:0`, payload: { briefId, runId, sequence: 0 } });
  w.db.prepare('UPDATE intel_runs SET job_id=? WHERE id=?').run(job.id, runId);
  saveState(w, briefId, { status: 'queued', runId });
  return { status: 'queued', briefId, runId };
}

function members(w, data) {
  const ids = (data.event?.members?.length ? data.event.members.map(m => m.sourceId) : (data.evidence || []).map(e => e.sourceId));
  const rows = [...new Set(ids)].map(id => w.db.prepare('SELECT * FROM intel_sources WHERE id=? AND deleted_at IS NULL').get(id)).filter(Boolean);
  const all = rows.map(row => ({ row, source: sourceFromRow(row) })).filter(x => sourcePermission(x.source, 'ai') && x.source.body !== undefined);
  const main = all.filter(x => x.row.source_kind !== 'comment' && x.row.source_kind !== 'external_digest').slice(0, MAX_SOURCES);
  // AIhot 热点聚合本身不能当依据，但事件只有它时，用它的正文作为唯一材料（仍需过引文校验）。
  if (!main.length) main.push(...all.filter(x => x.row.source_kind === 'external_digest').slice(0, 1));
  const comments = all.filter(x => x.row.source_kind === 'comment').slice(0, MAX_COMMENTS);
  return { main, comments };
}
const reenqueue = (w, payload, stage) => {
  const sequence = (payload.sequence || 0) + 1;
  const { job } = w.jobs.enqueue({ kind: 'intelligence.deepen', idempotencyKey: `deepen:${payload.briefId}:${payload.runId}:${sequence}`, payload: { ...payload, sequence }, dueAt: new Date(Date.now() + 8000).toISOString() });
  w.db.prepare('UPDATE intel_runs SET job_id=? WHERE id=?').run(job.id, payload.runId);
  updateRun(w, payload.runId, 'queued', stage);
  return { deferred: true };
};

/** 任务处理：先补全文（每份一次，等任务跑完），再用固定分组写解读。 */
export async function executeDeepen(w, env, payload, deps = {}) {
  const { briefId, runId } = payload;
  const row = w.db.prepare('SELECT * FROM intel_briefs WHERE id=?').get(briefId);
  if (!row) { saveState(w, briefId, { status: 'failed', runId, error: '情报已不存在' }); return { failed: true }; }
  const data = JSON.parse(row.data_json);
  saveState(w, briefId, { status: 'running', runId });
  updateRun(w, runId, 'running', '正在补全原文');
  const { main, comments } = members(w, data);
  if (!main.length) { saveState(w, briefId, { status: 'failed', runId, error: '没有可用于解读的原文资料' }); updateRun(w, runId, 'partial', '深度解读未生成：没有可用资料'); return { failed: true }; }
  if ((payload.sequence || 0) < 12) {
    const tried = w.db.prepare("SELECT 1 FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id WHERE r.kind='fulltext' AND json_extract(j.payload_json,'$.sourceId')=? LIMIT 1");
    const waiting = w.db.prepare("SELECT 1 FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id WHERE r.kind='fulltext' AND json_extract(j.payload_json,'$.sourceId')=? AND j.status IN ('queued','retry','running') LIMIT 1");
    let pending = 0;
    for (const { row: s, source } of main) {
      const channel = s.channel_id && w.db.prepare('SELECT platform FROM intel_channels WHERE id=?').get(s.channel_id);
      if (!channel || !['summary_only', 'metadata'].includes(s.content_status) || channel.platform === 'reddit' || (channel.platform === 'hacker_news' && s.source_kind === 'post') || !/^https?:\/\//.test(source.url || '')) continue;
      if (waiting.get(s.id)) { pending++; continue; }
      if (tried.get(s.id)) continue;
      try { enqueueAcquisition(w, s.channel_id, { mode: 'fulltext', trigger: 'deepen', sourceId: s.id, fulltextUrl: source.url, slot: `body:${s.id}:${s.content_hash}` }); pending++; } catch {}
    }
    if (pending) return reenqueue(w, payload, `正在补全 ${pending} 篇原文`);
  }
  // 补完全文后重新读一遍资料（正文和阅读层级可能已变）。
  const fresh = members(w, data);
  const sources = [...fresh.main, ...fresh.comments].map(x => x.source);
  for (const s of sources) w.db.prepare('INSERT OR IGNORE INTO intel_run_sources(run_id,source_id) VALUES(?,?)').run(runId, s.id);
  updateRun(w, runId, 'running', '正在写深度解读');
  const group = { key: data.storyKey, focus: data.title, connection: data.summary || data.title, relationship: fresh.main.length > 1 ? 'same_event' : 'standalone', sourceIds: fresh.main.map(x => x.source.id) };
  try {
    const wiki = eventWiki(w, data);
    // 讨论来源（Reddit、HN）单独标出，「大家怎么说」只能从这些里提炼。
    const discussionIds = new Set((data.event?.members || []).filter(m => ['reddit', 'hacker_news'].includes(m.platform)).map(m => m.sourceId));
    // 更新旧解读：把上一版交给模型，写「这次新增的是…」。
    const previous = data.depth === 'deep' ? { summary: data.summary, keyFacts: (data.keyFacts || []).map(f => f.text), deepAt: data.deepAt || null } : null;
    const result = await generateDailyBriefs(w, env, intelligenceRun(w, runId), sources, wiki, { ...deps, unified: true, contextIds: new Set(sources.map(s => s.id)), fixedGroups: [group], deepen: true, existingId: briefId, discussionIds, previous });
    if (result.saved.length) {
      w.db.prepare('UPDATE intel_briefs SET read_version=version WHERE id=?').run(briefId);
      saveState(w, briefId, { status: 'done', runId });
      updateRun(w, runId, 'done', '深度解读已生成');
      return { saved: true };
    }
    const reason = result.rejectionReasons?.[0]?.error || '模型没有给出可用的解读';
    saveState(w, briefId, { status: 'failed', runId, error: reason });
    updateRun(w, runId, 'partial', `深度解读未生成：${reason}`);
    return { failed: true };
  } catch (error) {
    if (error.cancelled || error.leaseLost) throw error;
    saveState(w, briefId, { status: 'failed', runId, error: String(error.message || '深度解读生成失败').slice(0, 300) });
    updateRun(w, runId, 'partial', '深度解读生成失败');
    return { failed: true };
  }
}
