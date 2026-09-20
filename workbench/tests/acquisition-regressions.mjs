import { visibleDerived } from '../server/acquisition/compatibility.mjs';
// Regression cases use real temporary SQLite. HTTP and connector responses are mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { getChannel, commitPage, cleanupAcquisition, acquisitionSourceDetails } from '../server/acquisition/store.mjs';
import { scheduleAcquisition, enqueueAcquisition, executeAcquisition, ACQUISITION_KINDS } from '../server/acquisition/runner.mjs';
import { acquisitionTransport } from '../server/acquisition/transport.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xenho-acquisition-regressions-'));
const previousHome = process.env.XENHO_HOME; process.env.XENHO_HOME = root;
const failures = []; let cases = 0;
async function test(name, run) {
 const w = await openWorkspace({ xenhoHome: path.join(root, String(++cases)) });
 try { await run(w); assert.deepEqual(w.db.pragma('foreign_key_check'), []); console.log('PASS', name); }
 catch (error) { failures.push(name); console.error('FAIL', name, error.message); }
 finally { w.close(); }
}
function activeChannel(w, key = 'community.reddit.localllama') {
 const c = getChannel(w, key);
 w.db.prepare("UPDATE intel_channels SET desired_enabled=1,user_disabled=0,validation_status='verified',access_status=?,next_due_at=NULL WHERE id=?").run(c.platform === 'reddit' ? 'approved' : 'public_feed', c.id);
 return getChannel(w, c.id);
}
const item = overrides => ({ identity: 'reddit:t1_parent', title: 'Original comment', url: 'https://www.reddit.com/comments/root/comment/parent/', body: 'Original verified text. '.repeat(1000), author: 'original-author', sourceKind: 'comment', platform: 'reddit', readLevel: 'original', contentStatus: 'full_text', rights: { aiAllowed: true, exportAllowed: false }, metadata: { score: 10 }, ...overrides });
const page = items => ({ items, checkpoint: { completedAt: new Date().toISOString() }, outcome: 'success', coverage: { hasMore: false } });
const source = (w, id) => w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(id);
const redditEnv = { REDDIT_ACCESS_APPROVED: 'true', REDDIT_ACCESS_TOKEN: 'mock-token', REDDIT_USER_AGENT: 'regression-test' };

try {
 await test('context placeholder cannot refresh or overwrite an existing verified comment', w => {
  const c = activeChannel(w), original = item(); const id = commitPage(w, c, page([original])).ids[0];
  const expires = new Date(Date.now() + 3600000).toISOString();
  w.db.prepare('UPDATE intel_sources SET expires_at=? WHERE id=?').run(expires, id);
  const before = source(w, id);
  commitPage(w, c, page([item({ title: 'Context unavailable', body: '', author: '', readLevel: 'metadata', contentStatus: 'context_missing', rights: { aiAllowed: false, exportAllowed: false }, metadata: { contextOnly: true } })]));
  const after = source(w, id);
  for (const key of ['data_json', 'expires_at', 'rights_json', 'current_version_id', 'content_hash']) assert.equal(after[key], before[key], key);
  assert.equal(w.db.prepare("SELECT count(*) n FROM source_discoveries WHERE source_id=? AND discovery_key='context'").get(id).n, 1);
 });
 await test('legitimate refetch after retention purge restores current version text and segment offsets', w => {
  const c = activeChannel(w), original = item(); const id = commitPage(w, c, page([original])).ids[0];
  const before = source(w, id);
  cleanupAcquisition(w, { now: new Date(Date.parse(before.expires_at) + 1000) });
  assert.equal(w.db.prepare('SELECT data_json FROM acquisition_source_versions WHERE id=?').get(before.current_version_id).data_json, '{}');
  assert.equal(w.db.prepare('SELECT count(*) n FROM acquisition_segments WHERE version_id=?').get(before.current_version_id).n, 0);
  const refetched = commitPage(w, c, page([original])); assert.equal(refetched.ids[0], id); assert.equal(refetched.updated, 1);
  const current = source(w, id); assert.equal(current.deleted_at, null);
  const version = w.db.prepare('SELECT data_json FROM acquisition_source_versions WHERE id=?').get(current.current_version_id);
  assert.equal(JSON.parse(version.data_json).body, original.body);
  const segments = w.db.prepare('SELECT * FROM acquisition_segments WHERE version_id=? ORDER BY ordinal').all(current.current_version_id);
  assert.ok(segments.length > 1); assert.equal(segments.map(s => original.body.slice(s.start_offset, s.end_offset)).join(''), original.body);
 });
 await test('a future Reddit review does not block due new-post synchronization', w => {
  w.db.exec('UPDATE intel_channels SET desired_enabled=0'); const c = activeChannel(w);
  const now = new Date(), review = enqueueAcquisition(w, c.id, { mode: 'revalidate', slot: 'future-review', threadId: 'root', dueAt: new Date(now.getTime() + 6 * 3600000).toISOString() });
  const scheduled = scheduleAcquisition(w, { now, env: redditEnv });
  assert.ok(scheduled.some(r => r.channel_id === c.id && r.kind === 'sync'));
  assert.equal(w.jobs.get(review.job_id).status, 'queued');
 });
 await test('Reddit first-thread reservations are global, atomic, idempotent and exempt revalidation', async w => {
  const a = activeChannel(w), b = activeChannel(w, 'community.reddit.machinelearning');
  const runA = enqueueAcquisition(w, a.id, { slot: 'reserve-a' }), runB = enqueueAcquisition(w, b.id, { slot: 'reserve-b' });
  const first = w.jobs.claim({ leaseOwner: 'worker-a', allowedKinds: ACQUISITION_KINDS });
  const second = w.jobs.claim({ leaseOwner: 'worker-b', allowedKinds: ACQUISITION_KINDS });
  assert.deepEqual(new Set([first.id, second.id]), new Set([runA.job_id, runB.job_id]));
  let fetched = 0;
  const deps = { request: async () => { fetched++; return { status: 200, json: {} }; }, async *collect({ channel, request }) {
   const prefix = channel.id === a.id ? 'A' : 'B', total = channel.id === a.id ? 10 : 11;
   for (let i = 0; i < total; i++) await request(`https://oauth.reddit.com/comments/${prefix}${i}?sort=top`);
   // Another sort for an already reserved thread must not consume another slot.
   await request(`https://oauth.reddit.com/comments/${prefix}0?sort=new`);
   yield page([]);
  } };
  const settled = await Promise.allSettled([first, second].map(job => executeAcquisition(w, redditEnv, job.payload, job, {}, deps)));
  assert.equal(settled.filter(r => r.status === 'rejected').length, 1);
  const blocked = settled.find(r => r.status === 'rejected').reason; assert.equal(blocked.retryAfterSeconds, 3600);
  assert.equal(w.db.prepare("SELECT count(*) n FROM acquisition_observations WHERE observation_key LIKE 'reddit-reserve:%'").get().n, 20);
  // Twenty distinct threads reached HTTP; the successful channel also refreshed one sort.
  assert.equal(fetched, 21);
  const c = activeChannel(w, 'community.reddit.artificial');
  const review = enqueueAcquisition(w, c.id, { mode: 'revalidate', slot: 'review-exempt', threadId: 'reviewed' });
  const reviewJob = w.jobs.claim({ leaseOwner: 'review-worker', allowedKinds: ['acquisition.revalidate'] }); assert.equal(reviewJob.id, review.job_id);
  await executeAcquisition(w, redditEnv, reviewJob.payload, reviewJob, {}, { request: async () => ({ status: 200, json: {} }), async *collect({ request }) { await request('https://oauth.reddit.com/comments/reviewed?sort=top'); yield page([]); } });
  assert.equal(w.db.prepare("SELECT count(*) n FROM acquisition_observations WHERE observation_key LIKE 'reddit-reserve:%'").get().n, 20);
 });
 await test('worker startup permits Follow catch-up outside daily publication window', w => {
  w.db.exec('UPDATE intel_channels SET desired_enabled=0'); const c = activeChannel(w, 'follow_builders.bundle');
  const now = new Date('2026-09-20T01:00:00Z'); // 09:00 Asia/Shanghai, before 15:00.
  w.db.prepare('UPDATE intel_channels SET last_attempt_at=?,next_due_at=? WHERE id=?').run('2026-09-16T08:00:00Z', '2026-09-17T08:00:00Z', c.id);
  assert.equal(scheduleAcquisition(w, { now, startup: false }).length, 0);
  const scheduled = scheduleAcquisition(w, { now, startup: true }); assert.equal(scheduled.filter(r => r.channel_id === c.id).length, 1);
  assert.equal(scheduleAcquisition(w, { now, startup: true }).length, 0, 'second startup pass must not duplicate active work');
 });
 await test('daily schedule begins at 08:10 while startup can recover missed history', w => {
  w.db.exec('UPDATE intel_channels SET desired_enabled=0');
  const c=activeChannel(w,'aihot.dailies');
  w.db.prepare('UPDATE intel_channels SET last_attempt_at=? WHERE id=?').run('2026-09-19T00:10:00Z',c.id);
  assert.equal(scheduleAcquisition(w,{now:new Date('2026-09-20T00:09:00Z')}).length,0);
  assert.equal(scheduleAcquisition(w,{now:new Date('2026-09-20T00:10:00Z')}).length,1);
  assert.equal(getChannel(w,c.id).next_due_at,'2026-09-20T01:10:00.000Z');
 });
 await test('fulltext denial fails only its task without disabling the working feed', async w => {
  const c=activeChannel(w,'t2.the_decoder');
  w.db.prepare('UPDATE intel_channels SET enabled=1,health=? WHERE id=?').run('ok',c.id);
  c.options.fulltextAllowed=true;
  w.db.prepare('UPDATE intel_channels SET options_json=? WHERE id=?').run(JSON.stringify(c.options),c.id);
  const id=commitPage(w,c,page([{identity:'article:summary',title:'Summary',body:'summary',url:'https://example.org/a',platform:'rss',sourceKind:'article',contentStatus:'summary_only'}])).ids[0];
  enqueueAcquisition(w,c.id,{mode:'fulltext',sourceId:id,slot:'body-denied'});
  const job=w.jobs.claim({leaseOwner:'body-worker',allowedKinds:ACQUISITION_KINDS});
  await assert.rejects(executeAcquisition(w,{},job.payload,job,{}, {request:async()=>{throw Object.assign(new Error('access denied'),{status:403});}}),/access denied/);
  const after=getChannel(w,c.id);assert.equal(after.enabled,true);assert.equal(after.health,'ok');assert.equal(after.access_status,'public_feed');
  assert.equal(source(w,id).content_status,'summary_only');
 });
 await test('expired detail segments and derived quotes are hidden without database writes', w => {
  const c=activeChannel(w),id=commitPage(w,c,page([item()])).ids[0];
  w.db.prepare('UPDATE intel_sources SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z',id);
  const before=w.db.prepare('SELECT total_changes() n').get().n;
  const details=acquisitionSourceDetails(w,id);assert.equal(details.source.body,'');assert.deepEqual(details.segments,[]);assert.deepEqual(details.discoveries,[]);
  const hidden=visibleDerived(w,{title:'private derived title',body:'private quote',whyItMatters:'private meaning',researchTasks:[{question:'private task'}],evidence:[{sourceId:id,quote:'private quote'}]});
  assert.deepEqual(hidden.evidence,[]);assert.ok(!JSON.stringify(hidden).includes('private'));
  assert.equal(w.db.prepare('SELECT total_changes() n').get().n,before,'read projection cannot delete or mutate source data');
  assert.ok(JSON.parse(source(w,id).data_json).body.length>0,'stored source remains for independent retention worker');
 });
 await test('same-body fresh HTTP 200 renews snapshot retention and validation headers', async w => {
  const c = activeChannel(w, 't2.the_decoder'); let calls = 0;
  const request = acquisitionTransport(w, c, { resolve: async () => [{ address: '93.184.216.34' }], fetchImpl: async (_target, options) => {
   calls++; if (calls === 2) assert.equal(options.headers['if-none-match'], undefined, 'expired snapshot must not send validators');
   return { response: new Response('same payload', { status: 200, headers: { etag: calls === 1 ? 'old' : 'fresh' } }), close: async () => {} };
  } });
  const first = await request('https://example.org/feed');
  w.db.prepare('UPDATE acquisition_snapshots SET observed_at=?,expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z', '2000-01-02T00:00:00Z', first.snapshotId);
  const fresh = await request('https://example.org/feed',{headers:{'if-none-match':'checkpoint-old'}}); const snapshot = w.db.prepare('SELECT * FROM acquisition_snapshots WHERE id=?').get(fresh.snapshotId);
  assert.ok(Date.parse(snapshot.expires_at) > Date.now()); assert.ok(Date.parse(snapshot.observed_at) > Date.parse('2000-01-02T00:00:00Z'));
  assert.equal(JSON.parse(snapshot.headers_json).etag, 'fresh'); assert.equal(snapshot.payload_text, 'same payload');
  cleanupAcquisition(w); assert.ok(w.db.prepare('SELECT id FROM acquisition_snapshots WHERE id=?').get(fresh.snapshotId));
 });
} finally {
 if (previousHome === undefined) delete process.env.XENHO_HOME; else process.env.XENHO_HOME = previousHome;
 await fs.rm(root, { recursive: true, force: true });
}
if (failures.length) { console.error(`${failures.length}/${cases} acquisition regressions failed`); process.exitCode = 1; }
else console.log(`${cases} acquisition regressions passed (temporary SQLite; mocked HTTP)`);
