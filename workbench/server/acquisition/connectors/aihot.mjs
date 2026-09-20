// Network and persistence are injected. A yielded page and its checkpoint must commit together.
const ORIGIN = 'https://aihot.news';
const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_schema' }); };
const rights = channel => ({ aiAllowed: channel.rights?.aiAllowed === true, exportAllowed: channel.rights?.exportAllowed === true });
const snapshots = (...responses) => responses.filter(r => r?.snapshotId).map(r => r.snapshotId);
const list = (value, label) => Array.isArray(value) ? value : fail(`AIHOT ${label} is not an array`);
const metadata = row => ({ upstream: 'aihot', attribution: row.attribution || null, source: row.source || null, links: row.links || {}, discoveredAt: row.discoveredAt || null });
function item(row, channel) {
  if (!row?.id || typeof row.title !== 'string') fail('AIHOT item missing stable id/title');
  return { identity: `aihot:${row.id}`, platform: 'aihot', platformId: String(row.id), title: row.title, url: row.links?.original || row.links?.aihot || '', body: '', summary: row.summary || '', publishedAt: row.publishedAt || null, author: row.source?.name || '', sourceKind: 'article', readLevel: 'summary', contentStatus: 'summary_only', rights: rights(channel), metadata: metadata(row) };
}
function cache(response) {
  const headers = response.headers || {};
  return { etag: headers.etag || headers.ETag || null, minimumPollSeconds: Number((headers['cache-control'] || headers['Cache-Control'] || '').match(/s-maxage=(\d+)/)?.[1] || 60) };
}
function page(items, checkpoint, response, extra = {}) {
  return { items, checkpoint, partition: 'default', outcome: items.length ? 'success' : 'no_new', coverage: {}, snapshots: snapshots(response), ...extra };
}
export async function* collectAiHot({ channel, checkpoint = {}, request, signal, now = new Date(), mode = 'sync', budget = 20 }) {
  const get = (path, headers = {}) => request(`${ORIGIN}${path}`, { headers: { accept: 'application/json', ...headers }, signal });
  let state = { ...checkpoint }, remaining = Math.max(1, Math.floor(budget));
  if (channel.stream === 'selected') {
    let recovered = false;
    while (remaining-- > 0) {
      signal?.throwIfAborted();
      const changes = Boolean(state.cursor && !state.snapshotPage && state.phase !== 'snapshot');
      let response;
      try {
        response = await get(changes ? `/api/v1/selected/changes?cursor=${encodeURIComponent(state.cursor)}&limit=100` : `/api/v1/selected/snapshot?fields=default&limit=500${state.snapshotPage ? `&page=${encodeURIComponent(state.snapshotPage)}` : ''}`);
      } catch (error) {
        if (changes && error.status === 409 && !recovered) {
          // Reset only the sync cursor. Previously stored documents/references stay intact.
          state = { ...state, cursor: null, snapshotCursor: null, snapshotPage: null, phase: 'snapshot', recovery: 'snapshot_required' }; recovered = true; remaining++; continue;
        }
        throw error;
      }
      if (response.status === 304) { yield page([], state, response); return; }
      const data = response.json;
      if (!data || typeof data.cursor !== 'string' || typeof data.hasMore !== 'boolean') fail('AIHOT selected cursor/hasMore missing');
      let items, removals = [];
      if (changes) {
        const rows = list(data.changes, 'changes');
        if (rows.some(r => !['upsert', 'remove'].includes(r.op) || (r.op === 'remove' && !r.id))) fail('AIHOT invalid change operation');
        items = rows.filter(r => r.op === 'upsert').map(r => item(r.item, channel));
        removals = rows.filter(r => r.op === 'remove').map(r => `aihot:${r.id}`);
        if (data.hasMore && data.cursor === state.cursor) fail('AIHOT changes cursor did not advance');
        state = { ...state, cursor: data.cursor, ...cache(response) };
      } else {
        items = list(data.items, 'snapshot items').map(r => item(r, channel));
        const watermark = state.snapshotCursor || data.cursor;
        if (data.cursor !== watermark) fail('AIHOT snapshot watermark changed mid-pagination');
        if (data.hasMore && (!data.nextPage || data.nextPage === state.snapshotPage)) fail('AIHOT snapshot page did not advance');
        state = { ...state, snapshotCursor: watermark, snapshotPage: data.hasMore ? data.nextPage : null, phase: data.hasMore ? 'snapshot' : 'changes', cursor: data.hasMore ? null : watermark, ...cache(response) };
      }
      yield page(items, state, response, { removals, outcome: items.length || removals.length ? 'success' : 'no_new', coverage: { hasMore: data.hasMore || !changes, phase: changes ? 'changes' : 'snapshot', recovery: state.recovery || null } });
      if (!data.hasMore && changes) return;
      // Reconcile any concurrent snapshot changes using its FIRST-page watermark.
    }
    return;
  }
  if (channel.stream === 'hot') {
    const response = await get('/api/v1/hot-topics', state.etag ? { 'if-none-match': state.etag } : {});
    if (response.status === 304) { yield page([], state, response); return; }
    const rows = list(response.json?.items, 'hot topics');
    const observations = [], responses = [response];
    for (const row of rows) {
      if (!row.id || !row.title) fail('AIHOT hot topic id/title missing');
      let story = null;
      if (row.links?.story && remaining > 1) {
        const link = new URL(row.links.story);
        const publicId = link.pathname.split('/').filter(Boolean).at(-1);
        if (publicId) { remaining--; const result = await get(`/api/v1/stories/${encodeURIComponent(publicId)}`); responses.push(result); story = result.json?.story || null; }
      }
      observations.push({ identity: `aihot-hot:${row.id}`, platformId: String(row.id), observedAt: new Date(now).toISOString(), rank: row.rank, data: { ...row, story } });
    }
    yield page([], { ...state, ...cache(response), observedAt: new Date(now).toISOString() }, response, { observations, snapshots: snapshots(...responses), outcome: rows.length ? 'success' : 'no_new', coverage: { events: rows.length, stories: responses.length - 1 } });
    return;
  }
  if (channel.stream !== 'daily') fail('Unknown AIHOT stream');
  const index = await get('/api/v1/dailies?limit=180');
  const entries = list(index.json?.items, 'daily index');
  if (entries.some(e => !/^\d{4}-\d{2}-\d{2}$/.test(e.date))) fail('AIHOT invalid daily date');
  const days = Math.min(180, Math.max(1, Number(channel.options?.backfillDays || (mode === 'backfill' ? 30 : 7))));
  const cutoff = new Date(new Date(now).getTime() - days * 86400000).toISOString().slice(0, 10);
  const complete = new Set(state.completedDates || []);
  const versions = { ...(state.completedVersions || {}) };
  const coverageStart = mode === 'backfill' ? [state.coverageStart || cutoff, cutoff].sort()[0] : state.coverageStart || cutoff;
  const candidates = entries.filter(e => e.date >= coverageStart && (!complete.has(e.date) || (e.generatedAt && versions[e.date] !== e.generatedAt))).sort((a, b) => a.date.localeCompare(b.date));
  state = { ...state, coverageStart };
  let emitted = false;
  for (const entry of candidates) {
    if (remaining-- <= 0) break;
    signal?.throwIfAborted();
    let response;
    try { response = await get(`/api/v1/dailies/${entry.date}`); }
    catch (error) {
      if (error.status !== 404) throw error;
      yield page([], state, index, { outcome: 'partial', coverage: { awaitingUpstream: [entry.date] } }); emitted = true; continue;
    }
    const report = response.json?.report;
    if (!report || report.date !== entry.date || !Array.isArray(report.sections) || !Array.isArray(report.flashes)) fail('AIHOT daily report structure mismatch');
    const references = [...report.sections.flatMap(s => list(s.items, 'daily section')), ...report.flashes].map(r => ({ title: r.title, url: r.links?.original, attribution: r.attribution || null })).filter(r => r.url);
    const body = [report.lead?.title, report.lead?.leadParagraph, ...report.sections.flatMap(s => [s.label, ...s.items.map(i => `${i.title}\n${i.summary || ''}`)]), ...report.flashes.map(i => i.title)].filter(Boolean).join('\n\n');
    complete.add(entry.date); versions[entry.date] = entry.generatedAt || report.generatedAt || ''; state = { ...state, completedDates: [...complete].sort(), completedVersions: { ...versions } };
    const document = { identity: `aihot-daily:${entry.date}`, platform: 'aihot', platformId: entry.date, title: report.lead?.title || `AIHOT 日报 ${entry.date}`, url: report.links?.aihot || `${ORIGIN}/daily/${entry.date}`, body, summary: report.lead?.leadParagraph || '', publishedAt: report.generatedAt, author: 'AIHOT', sourceKind: 'external_digest', readLevel: 'original', contentStatus: 'full_text', rights: rights(channel), metadata: { report, references, attribution: report.attribution || null, secondarySource: true } };
    yield page([document], state, response, { snapshots: snapshots(index, response), coverage: { date: entry.date, hasMore: candidates.some(e => !complete.has(e.date)), calendarTimezone: 'Asia/Shanghai' } }); emitted = true;
  }
  if (!emitted) yield page([], state, index, { coverage: { awaitingUpstream: !entries.some(e => e.date === new Date(new Date(now).getTime() + 8 * 3600000).toISOString().slice(0, 10)), archiveBoundary: entries.at(-1)?.date || null } });
}
export default collectAiHot;
