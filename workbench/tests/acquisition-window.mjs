import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { getChannel } from '../server/acquisition/store.mjs';
import { enqueueAcquisition, executeAcquisition } from '../server/acquisition/runner.mjs';
import {
  acquisitionWindow,
  gateAcquisitionItems,
  channelItemLimit,
  batchPlatformLimit,
} from '../server/acquisition/window.mjs';

const now = new Date('2026-09-20T00:00:00.000Z');
const window = acquisitionWindow({ now });
assert.deepEqual(window, {
  mode: 'sync',
  windowStart: '2026-09-19T00:00:00.000Z',
  windowEnd: '2026-09-20T00:00:00.000Z',
  providerWindowStart: '2026-09-18T18:00:00.000Z',
  hardGate: true,
});

const item = (identity, publishedAt, metadata = {}) => ({
  identity,
  title: identity,
  url: 'https://example.org/' + identity,
  body: identity,
  sourceKind: 'article',
  publishedAt,
  metadata,
});
const gated = gateAcquisitionItems([
  item('at-start', window.windowStart),
  item('before-start', '2026-09-18T23:59:59.999Z'),
  item('at-end', window.windowEnd),
  item('after-end', '2026-09-20T00:00:00.001Z'),
  item('unknown', null, { observedAt: window.windowEnd, discoveredAt: window.windowEnd }),
], window, { limit: 1 });
assert.deepEqual(gated.items.map(value => value.identity), ['at-start']);
assert.deepEqual(gated.stats, { fetched: 5, inWindow: 2, outsideWindow: 2, unknownTimestamp: 1, limited: 1 });
assert.equal(acquisitionWindow({ mode: 'backfill', now }).hardGate, false);
assert.equal(channelItemLimit({ source_group: 't2_media', options: {} }), 20);
assert.equal(channelItemLimit({ platform: 'github', options: {} }), 15);
assert.equal(batchPlatformLimit({ platform: 'reddit' }), 80);
assert.equal(batchPlatformLimit({ platform: 'reddit', options: { maxPostsPerBatch: 12 } }), 12);
assert.equal(batchPlatformLimit({ platform: 'github', options: { maxPerBatch: 9 } }), 9);

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'acquisition-window-'));
let workspace;
try {
  workspace = await openWorkspace({ xenhoHome: home });
  const channel = getChannel(workspace, 't2.the_decoder');
  workspace.db.prepare('UPDATE intel_channels SET desired_enabled=1,user_disabled=0,enabled=1 WHERE id=?').run(channel.id);
  const run = enqueueAcquisition(workspace, channel.id, {
    explicit: true,
    windowStartAt: window.windowStart,
    windowEndAt: window.windowEnd,
    slot: 'fixed-window-contract',
  });
  const job = workspace.jobs.claim({ leaseOwner: 'window-test', allowedJobIds: [run.job_id] });
  const result = await executeAcquisition(workspace, {}, job.payload, job, {}, {
    async *collect({ window: received }) {
      assert.equal(received.windowStart, window.windowStart);
      assert.equal(received.windowEnd, window.windowEnd);
      yield {
        items: [
          item('inside', '2026-09-19T12:00:00.000Z'),
          item('old', '2026-09-18T23:59:59.999Z'),
          item('no-time', null, { observedAt: window.windowEnd }),
        ],
        checkpoint: {},
        coverage: { hasMore: false },
        outcome: 'success',
      };
    },
  });
  assert.equal(result.stats.inserted, 1);
  assert.equal(result.stats.outsideWindow, 1);
  assert.equal(result.stats.unknownTimestamp, 1);
  const stored = workspace.db.prepare('SELECT window_start_at,window_end_at,stats_json,coverage_json FROM acquisition_runs WHERE id=?').get(run.id);
  assert.equal(stored.window_start_at, window.windowStart);
  assert.equal(stored.window_end_at, window.windowEnd);
  assert.equal(JSON.parse(stored.stats_json).fetched, 3);
  assert.deepEqual(JSON.parse(stored.coverage_json).window, {
    start: window.windowStart,
    end: window.windowEnd,
    providerStart: window.providerWindowStart,
  });
  assert.equal(workspace.db.prepare('SELECT count(*) n FROM intel_sources WHERE acquisition_identity IS NOT NULL').get().n, 1);
} finally {
  workspace?.close();
  await fs.rm(home, { recursive: true, force: true });
}

console.log('acquisition 24h window passed: fixed boundaries, 30h overlap, unknown exclusion, caps and persisted observability');
