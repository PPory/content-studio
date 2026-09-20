// Real isolated SQLite/backup tests; network responses are explicit mock transports.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { unzipSync } from 'fflate';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { ensureAcquisitionCatalog, acquisitionCatalog } from '../server/acquisition/catalog.mjs';
import { getChannel, commitPage, checkpointFor, cleanupAcquisition, redactSource } from '../server/acquisition/store.mjs';
import { enqueueAcquisition, cancelAcquisition, executeAcquisition, ACQUISITION_KINDS } from '../server/acquisition/runner.mjs';
import { acquisitionTransport, validateTarget, publicAddress } from '../server/acquisition/transport.mjs';
import { sourceFromRow } from '../server/domain/intelligence-quality.mjs';
import { collectCommunity, normalizeCommunityFeed } from '../server/acquisition/connectors/community.mjs';
import { createWorkspaceBundle } from '../server/backup/workspace-backup.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xenho-acquisition-storage-'));
const previousHome = process.env.XENHO_HOME; process.env.XENHO_HOME = root;
const failures = []; let index = 0;
async function test(name, fn) {
 const directory = path.join(root, String(++index)); const w = await openWorkspace({ xenhoHome: directory });
 try { await fn(w, directory); assert.deepEqual(w.db.pragma('foreign_key_check'), []); console.log('PASS', name); }
 catch (error) { failures.push({ name, error }); console.error('FAIL', name, error.message); }
 finally { w.close(); }
}
function channel(w, key = 't2.the_decoder', options = {}) {
 const c = getChannel(w, key); c.options = { ...c.options, aiAllowed: true, exportAllowed: true, ...options };
 w.db.prepare('UPDATE intel_channels SET options_json=?,user_disabled=0 WHERE id=?').run(JSON.stringify(c.options), c.id);
 return { ...c, user_disabled: 0 };
}
const article = (patch = {}) => ({ identity: 'provider:article1', title: 'Original report', url: 'https://example.org/report', body: 'Original source text with bounded evidence.', summary: '', sourceKind: 'article', platform: 'web', readLevel: 'original', contentStatus: 'full_text', rights: { aiAllowed: true, exportAllowed: true }, metadata: {}, ...patch });
const page = (items, checkpoint = {}) => ({ items, checkpoint, partition: 'default', outcome: 'success', coverage: {} });
const row = (w, id) => w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(id);
const count = (w, table) => w.db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
const mockDns = async () => [{ address: '93.184.216.34', family: 4 }];
function mockResponse(body, status = 200, headers = {}) { return { response: new Response(status === 304 ? null : body, { status, headers }), close: async () => {} }; }

try {
 await test('catalog preserves all 14 media, six platforms, Reddit identity and disabled choices', w => {
  const catalog = acquisitionCatalog(); assert.equal(catalog.filter(c => c.group === 't2_media').length, 14);
  assert.equal(new Set(catalog.filter(c => c.group === 'community').map(c => c.platform)).size, 6);
  assert.ok(catalog.some(c => c.key === 'community.reddit.localllama')); assert.ok(catalog.some(c => c.key === 'community.reddit.localllm'));
  const c = channel(w); w.db.prepare('UPDATE intel_channels SET user_disabled=1,enabled=0 WHERE id=?').run(c.id); ensureAcquisitionCatalog(w);
  assert.equal(getChannel(w, c.id).user_disabled, 1); assert.equal(getChannel(w, c.id).enabled, false);
 });
 await test('A01/A02 repeated and cross-provider same canonical URL keep one source and multiple discoveries', w => {
  const first = channel(w), second = channel(w, 'aihot.selected');
  const a = commitPage(w, first, page([article()])); const id = a.ids[0];
  const repeat = commitPage(w, first, page([article()])); assert.equal(repeat.duplicates, 1);
  const another = commitPage(w, second, page([article({ identity: 'aihot:42', url: 'https://example.org/report?utm_source=aihot' })]));
  assert.equal(another.ids[0], id); assert.equal(count(w, 'acquisition_source_versions'), 1); assert.equal(count(w, 'source_discoveries'), 2);
  const differentUrl = commitPage(w, first, page([article({ identity: 'other:42', url: 'https://other.example.org/report' })]));
  assert.notEqual(differentUrl.ids[0], id, 'content equality alone must not erase different original URLs');
 });
 await test('A02 comment IDs remain separate despite equal body and preserve missing parent tree', w => {
  const c = channel(w, 'community.reddit.localllama'); c.access_status = 'approved';
  const comment = id => article({ identity: `reddit:t1_${id}`, sourceKind: 'comment', platform: 'reddit', url: `https://www.reddit.com/comments/root/comment/${id}/`, body: 'same short response', parentIdentity: 'reddit:t1_parent', rootIdentity: 'reddit:t3_root' });
  const saved = commitPage(w, c, page([comment('a'), comment('b')])); assert.notEqual(saved.ids[0], saved.ids[1]);
  assert.equal(row(w, saved.ids[0]).parent_item_id, row(w, saved.ids[1]).parent_item_id);
  assert.equal(row(w, row(w, saved.ids[0]).parent_item_id).content_status, 'context_missing');
 });
 await test('A02 HN keeps discussion identity and shares canonical article with media discovery', w => {
  const media=channel(w), hn=channel(w,'community.hacker_news.frontpage');
  const original=commitPage(w,media,page([article()])).ids[0];
  const raw='<rss><channel><item><title>Original report</title><link>https://example.org/report</link><guid>https://news.ycombinator.com/item?id=4321</guid><comments>https://news.ycombinator.com/item?id=4321</comments><description>Discussion summary</description></item></channel></rss>';
  const normalized=normalizeCommunityFeed(raw,hn);commitPage(w,hn,page(normalized));
  const postId=w.db.prepare('SELECT source_id FROM acquisition_aliases WHERE identity=?').get('hn:4321')?.source_id;
  assert.ok(postId);assert.notEqual(postId,original);
  assert.match(JSON.parse(row(w,postId).data_json).url,/news\.ycombinator\.com\/item\?id=4321/);
  assert.equal(w.db.prepare('SELECT count(*) n FROM source_discoveries WHERE source_id=?').get(original).n,2);
  assert.equal(count(w,'intel_sources'),2);
 });
 await test('A03 arXiv version URLs retain one paper identity and multiple content versions', w => {
  const c=channel(w,'community.arxiv.cs.AI');
  const feed=v=>`<rss><channel><item><title>Paper</title><link>https://arxiv.org/abs/2609.12345v${v}</link><description>Abstract revision ${v}</description></item></channel></rss>`;
  const a=commitPage(w,c,page(normalizeCommunityFeed(feed(1),c))).ids[0];
  const b=commitPage(w,c,page(normalizeCommunityFeed(feed(2),c))).ids[0];
  assert.equal(a,b);assert.equal(row(w,a).acquisition_identity,'arxiv:2609.12345');assert.equal(count(w,'acquisition_source_versions'),2);
 });
 await test('legacy GitHub release channel still parses JSON release content', async w => {
  const c=channel(w,'legacy.channel-ollama');c.options={...c.options,format:'github'};
  const releases=[{id:123,name:'Release 1',tag_name:'v1',html_url:'https://github.com/test/repo/releases/tag/v1',body:'Full release notes',published_at:'2026-09-19T00:00:00Z',author:{login:'builder'}}];
  const results=[];for await(const p of collectCommunity({channel:c,request:async()=>({status:200,headers:{},json:releases,text:JSON.stringify(releases)})}))results.push(p);
  assert.equal(results[0].items[0].title,'Release 1');assert.equal(results[0].items[0].body,'Full release notes');assert.equal(results[0].items[0].readLevel,'original');
 });
 await test('A03 content revisions are immutable; metric-only changes do not create versions', w => {
  const c = channel(w); const first = commitPage(w, c, page([article({ metadata: { metrics: { stars: 1 } } })]));
  const id = first.ids[0], v1 = row(w, id).current_version_id;
  commitPage(w, c, page([article({ metadata: { metrics: { stars: 2 } } })])); assert.equal(count(w, 'acquisition_source_versions'), 1);
  commitPage(w, c, page([article({ body: 'Revised report with corrected factual details.' })])); assert.equal(count(w, 'acquisition_source_versions'), 2);
  assert.equal(JSON.parse(w.db.prepare('SELECT data_json FROM acquisition_source_versions WHERE id=?').get(v1).data_json).body, article().body);
 });
 await test('A04 long transcripts keep all bytes; segments refer to one source and immutable version', w => {
  const c = channel(w, 'follow_builders.bundle'), body = 'Speaker: full transcript.\n'.repeat(5000);
  const id = commitPage(w, c, page([article({ sourceKind: 'podcast_transcript', identity: 'podcast:publisher:guid', body })])).ids[0];
  const stored = row(w, id); assert.equal(JSON.parse(stored.data_json).body, body);
  const segments = w.db.prepare('SELECT * FROM acquisition_segments WHERE version_id=? ORDER BY ordinal').all(stored.current_version_id);
  assert.equal(segments.map(s => body.slice(s.start_offset, s.end_offset)).join(''), body); assert.equal(count(w, 'intel_sources'), 1);
 });
 await test('A05 transaction fault leaves source, versions, snapshots and checkpoint unapplied', w => {
  const c = channel(w); commitPage(w, c, page([], { cursor: 'before' }));
  assert.throws(() => commitPage(w, c, page([article()], { cursor: 'after' }), { failBeforeCheckpoint() { throw Error('injected transaction failure'); } }), /injected/);
  assert.equal(count(w, 'intel_sources'), 0); assert.equal(count(w, 'acquisition_source_versions'), 0); assert.deepEqual(checkpointFor(w, c.id), { cursor: 'before' });
  commitPage(w, c, page([article()], { cursor: 'after' })); assert.equal(count(w, 'intel_sources'), 1);
 });
 await test('A06 expired lease and cancellation prohibit commit; queue type filter protects other workflows', async w => {
  const c = channel(w); const unrelated = w.jobs.enqueue({ kind: 'not-acquisition', idempotencyKey: 'unrelated', payload: {} }).job;
  const run = enqueueAcquisition(w, c.id, { slot: 'lease-test' }); const job = w.jobs.claim({ leaseOwner: 'test', allowedKinds: ACQUISITION_KINDS });
  assert.equal(job.id, run.job_id); assert.equal(w.jobs.get(unrelated.id).status, 'queued');
  w.db.prepare('UPDATE local_jobs SET lease_expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z', job.id);
  assert.throws(() => commitPage(w, c, page([article()]), { job }), /租约|取消/); assert.equal(count(w, 'intel_sources'), 0);
  const run2 = enqueueAcquisition(w, c.id, { slot: 'cancel-test' });
  // Close the deliberately expired task so the next claim selects the new task.
  w.db.prepare("UPDATE local_jobs SET status='failed' WHERE id=?").run(job.id);
  const job2 = w.jobs.claim({ leaseOwner: 'test', allowedKinds: ACQUISITION_KINDS }); assert.equal(job2.id, run2.job_id);
  cancelAcquisition(w, run2.id); assert.throws(() => commitPage(w, c, page([article()]), { job: job2 }), /租约|取消/);
  assert.equal(w.jobs.claim({ leaseOwner: 'empty-filter', allowedKinds: [] }), null);
 });
 await test('runner cancellation during collection prevents late yielded data from persisting', async w => {
  const c = channel(w), run = enqueueAcquisition(w, c.id, { slot: 'midflight-cancel' }), job = w.jobs.claim({ leaseOwner: 'cancel-worker', allowedKinds: ACQUISITION_KINDS });
  await assert.rejects(() => executeAcquisition(w, {}, job.payload, job, {}, { async *collect() { cancelAcquisition(w, run.id); yield page([article()]); } }), /取消|租约/);
  assert.equal(count(w, 'intel_sources'), 0); assert.equal(w.db.prepare('SELECT status FROM acquisition_runs WHERE id=?').get(run.id).status, 'cancelled');
 });
 await test('R07 source expiry and AI permission remain effective at read time before cleanup', w => {
  const c = channel(w, 'community.reddit.localllama'); c.access_status = 'approved';
  const id = commitPage(w, c, page([article({ identity: 'reddit:t1_secret', sourceKind: 'comment', platform: 'reddit', body: 'RESTRICTED_SECRET', rights: { aiAllowed: false, exportAllowed: false } })])).ids[0];
  assert.equal(JSON.parse(row(w, id).rights_json).aiAllowed, false, 'connector-specific rights must not be widened by generic channel permission');
 });
 await test('R07 expired reads hide content before cleanup worker', w => {
  const c=channel(w,'community.reddit.localllama'); c.access_status='approved';
  const id=commitPage(w,c,page([article({identity:'reddit:t1_expiry',sourceKind:'comment',platform:'reddit',body:'RESTRICTED_SECRET'})])).ids[0];
  w.db.prepare('UPDATE intel_sources SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z', id);
  assert.ok(!JSON.stringify(sourceFromRow(row(w, id))).includes('RESTRICTED_SECRET'), 'expired text must not escape reads before asynchronous cleanup');
 });
 await test('R08 removal scrubs versions, discovery author, snapshots and rejects replay resurrection', w => {
  const c = channel(w, 'community.reddit.localllama'); c.access_status = 'approved';
  const item = article({ identity: 'reddit:t1_delete', sourceKind: 'comment', platform: 'reddit', body: 'DELETE_ME_SECRET', author: 'private-author', metadata: { author: 'private-author' } });
  const id = commitPage(w, c, page([item])).ids[0];
  commitPage(w, c, { ...page([]), removals: [{ identity: item.identity, reason: 'upstream_deleted' }] });
  for (const table of ['intel_sources', 'acquisition_source_versions', 'source_discoveries']) assert.ok(!JSON.stringify(w.db.prepare(`SELECT * FROM ${table}`).all()).includes('DELETE_ME_SECRET'));
  assert.ok(!JSON.stringify(w.db.prepare('SELECT * FROM source_discoveries').all()).includes('private-author'));
  assert.equal(commitPage(w, c, page([item])).skipped, 1); assert.ok(!JSON.stringify(row(w, id)).includes('DELETE_ME_SECRET'));
 });
 await test('R09 cleanup expires restricted data while preserving unrestricted original', w => {
  const c = channel(w, 'community.reddit.localllama'); c.access_status = 'approved';
  const id = commitPage(w, c, page([article({ identity: 'reddit:t1_old', sourceKind: 'comment', platform: 'reddit', body: 'EXPIRE_ME' })])).ids[0];
  const pub = commitPage(w, channel(w), page([article({ body: 'Keep public original' })])).ids[0];
  const expires = row(w, id).expires_at; const result = cleanupAcquisition(w, { now: new Date(Date.parse(expires) + 1000) }); assert.equal(result.redacted, 1);
  assert.ok(!JSON.stringify(row(w, id)).includes('EXPIRE_ME')); assert.equal(JSON.parse(row(w, pub).data_json).body, 'Keep public original');
 });
 await test('R10 backup contains no restricted text and never mutates live originals', async (w, directory) => {
  const c = channel(w, 'community.reddit.localllama'); c.access_status = 'approved';
  const id = commitPage(w, c, page([article({ identity: 'reddit:t1_backup', sourceKind: 'comment', platform: 'reddit', body: 'BACKUP_RESTRICTED_SENTINEL', author: 'BACKUP_RESTRICTED_AUTHOR' })])).ids[0];
  const bundle = await createWorkspaceBundle(w, { kind: 'full' }); const files = unzipSync(bundle.bytes);
  const dbEntry = Object.entries(files).find(([name]) => /\.sqlite$|\.db$/.test(name)); assert.ok(dbEntry);
  assert.ok(!Buffer.from(dbEntry[1]).includes(Buffer.from('BACKUP_RESTRICTED_SENTINEL')), 'backup database bytes retain restricted body');
  const backupFile = path.join(directory, 'backup-validation.sqlite'); await fs.writeFile(backupFile, dbEntry[1]); const restored = new Database(backupFile, { readonly: true });
  try { assert.ok(!JSON.stringify(restored.prepare('SELECT * FROM intel_sources').all()).includes('BACKUP_RESTRICTED_SENTINEL')); } finally { restored.close(); }
  assert.equal(JSON.parse(row(w, id).data_json).body, 'BACKUP_RESTRICTED_SENTINEL', 'sanitizing backup must not redact the live workspace');
 });
 await test('S01 URL validation blocks credentials, inner DNS, redirects and XML entities', async w => {
  assert.equal(publicAddress('192.0.66.220'), true); assert.equal(publicAddress('192.0.0.1'), false);
  for (const url of ['http://127.0.0.1/', 'http://metadata.google.internal/', 'https://user:password@example.org/', 'https://example.org:8080/', 'file:///tmp/a', 'https://example.org/{RSSHUB}']) await assert.rejects(() => validateTarget(url, mockDns), undefined, `must reject ${url}`);
  await assert.rejects(() => validateTarget('https://example.org/', async () => [{ address: '10.0.0.1' }]), /DNS/);
  const c = channel(w); let calls = 0;
  const request = acquisitionTransport(w, c, { resolve: mockDns, fetchImpl: async () => { calls++; return mockResponse('', 302, { location: 'http://127.0.0.1/private' }); } });
  await assert.rejects(() => request('https://example.org/start')); assert.equal(calls, 1);
  const xml = acquisitionTransport(w, c, { resolve: mockDns, fetchImpl: async () => mockResponse('<!DOCTYPE rss [<!ENTITY steal SYSTEM "file:///secret">]><rss/>') });
  await assert.rejects(() => xml('https://example.org/xml'), /实体/);
  assert.equal(count(w, 'acquisition_locks'), 0);
 });
 await test('S01 authenticated redirect:error cannot forward or follow OAuth redirected requests', async w => {
  const c = channel(w, 'community.reddit.localllama'); let calls = 0;
  const request = acquisitionTransport(w, c, { resolve: mockDns, fetchImpl: async () => { calls++; return calls === 1 ? mockResponse('', 302, { location: 'https://external.example.org/redirected' }) : mockResponse('{}'); } });
  await assert.rejects(() => request('https://oauth.reddit.com/r/test/new', { headers: { authorization: 'Bearer fake' }, redirect: 'error' })); assert.equal(calls, 1);
 });
 await test('A10 cached 304 from unapplied snapshot must replay content, not silently drop feed', async w => {
  const c = channel(w); c.endpoint = 'https://example.org/feed';
  const feed = '<rss><channel><item><title>Unapplied</title><link>https://example.org/unapplied</link><description>Real feed summary</description></item></channel></rss>'; let calls = 0;
  const request = acquisitionTransport(w, c, { resolve: mockDns, fetchImpl: async () => ++calls === 1 ? mockResponse(feed, 200, { etag: 'v1' }) : mockResponse('', 304) });
  const initial = await request(c.endpoint); assert.equal(initial.status, 200); assert.equal(count(w, 'intel_sources'), 0);
  const responses = []; for await (const p of collectCommunity({ channel: c, request })) responses.push(p);
  assert.equal(responses.flatMap(p => p.items).length, 1, 'valid raw cache is not proof that its items were committed');
  commitPage(w, c, { ...responses[0], snapshots: [initial.snapshotId] }); assert.equal(count(w, 'intel_sources'), 1);
  assert.ok(w.db.prepare('SELECT applied_at FROM acquisition_snapshots WHERE id=?').get(initial.snapshotId).applied_at);
 });
} finally {
 if (previousHome === undefined) delete process.env.XENHO_HOME; else process.env.XENHO_HOME = previousHome;
 await fs.rm(root, { recursive: true, force: true });
}
if (failures.length) { console.error(`${failures.length}/${index} acquisition storage cases failed`); process.exitCode = 1; }
else console.log(`${index} acquisition storage cases passed (real temporary SQLite; mocked HTTP)`);
