import assert from 'node:assert/strict';
import { runBrightDataJob } from '../server/acquisition/providers/brightdata.mjs';

let persisted = {};
let triggerCalls = 0;
const common = {
  apiKey: 'mock-key-not-real',
  datasetId: 'dataset-test',
  rows: [{ url: 'https://www.reddit.com/r/test/' }],
  options: { requestSalt: 'fixed-window' },
  jobKey: 'posts:test',
  persist: async state => { persisted = structuredClone(state); },
  heartbeat: () => {},
};

await assert.rejects(
  () => runBrightDataJob({
    ...common,
    state: {},
    client: {
      trigger: async () => { triggerCalls += 1; return 'snapshot-resumable'; },
      progress: async () => { throw new Error('temporary network loss'); },
    },
  }),
  /temporary network loss/,
);
assert.equal(triggerCalls, 1);
assert.equal(persisted.snapshotId, 'snapshot-resumable');
assert.equal(persisted.status, 'starting');

const resumed = await runBrightDataJob({
  ...common,
  state: persisted,
  client: {
    trigger: async () => { triggerCalls += 1; return 'must-not-trigger'; },
    progress: async () => 'ready',
    download: async (_key, snapshotId) => {
      assert.equal(snapshotId, 'snapshot-resumable');
      return [{ post_id: 'abc' }];
    },
  },
});
assert.equal(triggerCalls, 1, '续跑必须复用已写入 checkpoint 的 snapshot id');
assert.deepEqual(resumed.records, [{ post_id: 'abc' }]);
await resumed.complete();
assert.equal(persisted.status, 'complete');
assert.equal(persisted.snapshotId, 'snapshot-resumable');

console.log('Bright Data resumability passed: snapshot persisted before polling and reused after interruption');
