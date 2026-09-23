// 深度解读按需生成（2026-09-23 决策）：用户第一次点开事件卡时才抓全文、写解读、做逐字引文校验。
// 生成一次后缓存在卡片上（data.depth='deep'）；校验不过就保留热点层并记下原因，不重复花钱。
import { createUlid } from '../storage/ids.mjs';
import { sourceFromRow } from './intelligence-quality.mjs';
import { sourcePermission } from '../acquisition/compatibility.mjs';
import { enqueueAcquisition } from '../acquisition/runner.mjs';
import { generateDailyBriefs } from './intelligence-editor.mjs';
import { intelligenceRun, updateRun } from './intelligence.mjs';
import { canonicalBriefId } from './intelligence-unified.mjs';

const now = () => new Date().toISOString();
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const MAX_SOURCES = 6, MAX_COMMENTS = 5;
const key = id => `deepen:${id}`;
export function deepenState(w, id) {
  const row = w.db.prepare('SELECT value FROM intel_unified_state WHERE key=?').get(key(id));
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}
const saveState = (w, id, value) => w.db.prepare('INSERT INTO intel_unified_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key(id), JSON.stringify({ ...value, at: now() }));

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
    const wiki = w.db.prepare("SELECT p.id,p.title,substr(p.body_markdown,1,1200) body FROM wiki_pages p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL ORDER BY e.updated_at DESC LIMIT 30").all();
    const result = await generateDailyBriefs(w, env, intelligenceRun(w, runId), sources, wiki, { ...deps, unified: true, contextIds: new Set(sources.map(s => s.id)), fixedGroups: [group], deepen: true, existingId: briefId });
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
