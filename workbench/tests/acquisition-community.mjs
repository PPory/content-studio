// Mocked protocol and normalization tests. These do not prove live Reddit access.
import assert from 'node:assert/strict';
import { collectCommunity, normalizeCommunityFeed } from '../server/acquisition/connectors/community.mjs';
import { collectReddit } from '../server/acquisition/connectors/reddit.mjs';
const all = async iterable => { const results = []; for await (const result of iterable) results.push(result); return results; };
const now = new Date('2026-09-20T00:00:00Z');
const rss = '<rss><channel><item><title>AI report</title><link>https://example.com/a?utm_source=rss</link><guid>https://news.ycombinator.com/item?id=123</guid><comments>https://news.ycombinator.com/item?id=123</comments><description><![CDATA[<p>Summary only</p>]]></description></item></channel></rss>';
const normalized = normalizeCommunityFeed(rss, { platform: 'hacker_news', endpoint: 'https://hnrss.org/frontpage' });
assert.equal(normalized[0].identity, 'hn:123'); assert.equal(normalized[0].summary, 'Summary only'); assert.equal(normalized[0].body, ''); assert.equal(normalized[0].readLevel, 'summary'); assert.equal(normalized[0].url, 'https://news.ycombinator.com/item?id=123'); assert.equal(normalized[1].url, 'https://example.com/a'); assert.equal(normalized[1].sourceKind,'article'); assert.equal(normalized[1].summary,'');
assert.throws(() => normalizeCommunityFeed('<html>not RSS</html>', { endpoint: 'https://example.com' }));
const arxiv = normalizeCommunityFeed('<rss><channel><item><title>Paper</title><link>https://arxiv.org/abs/2609.12345v2</link><description>Abstract</description></item></channel></rss>', { platform: 'arxiv', endpoint: 'https://rss.arxiv.org/rss/cs.AI' });
assert.equal(arxiv[0].identity, 'arxiv:2609.12345'); assert.equal(arxiv[0].metadata.arxivVersion, '2');
const unchanged = await all(collectCommunity({ channel: { endpoint: 'https://example.com' }, checkpoint: { etag: 'v1' }, now, request: async (_, opts) => { assert.equal(opts.headers['if-none-match'], 'v1'); return { status: 304, text:rss }; } }));
assert.equal(unchanged[0].coverage.replayedSnapshot,true);assert.equal(unchanged[0].items.length,1);
await assert.rejects(()=>all(collectCommunity({channel:{endpoint:'https://example.com'},request:async()=>({status:304})})),/正文快照/);
const backlog = await all(collectCommunity({ channel: { endpoint: 'https://example.com' }, mode: 'backfill', now, request: async () => ({ status: 200, text: rss, headers: {} }) }));
assert.equal(backlog[0].coverage.gap, 'rss_has_no_historical_archive_contract');
let calls = 0;
const git = await all(collectCommunity({ channel: { platform: 'github', options: { topic: 'mcp' } }, now, budget: 2, request: async url => { calls++; assert.match(url, /topic%3Amcp/); return { json: calls === 1 ? { items: [], total_count: 1001 } : { items: [{ id: 1, full_name: 'builders/mcp-agent', html_url: 'https://github.com/builders/mcp-agent', description: 'MCP agent runtime', created_at: '2026-09-19T23:00:00Z', archived: false, fork: false, stargazers_count: 7, forks_count: 2 }], total_count: 1, incomplete_results: false } }; } }));
assert.equal(git[0].coverage.splitWindow, true); assert.equal(git[1].items[0].identity, 'github:1'); assert.equal(git[1].items[0].metadata.growth, null); assert.ok(git[1].checkpoint.windows.length);
await assert.rejects(() => all(collectCommunity({ channel: { platform: 'github' }, request: async () => { throw Object.assign(new Error('rate limit'), { status: 429, retryAfterSeconds: 30 }); } })), e => e.status === 429 && e.retryAfterSeconds === 30);

const channel = { name: 'LocalLLaMA', options: { postsPerSubreddit: 15, deepThreadsPerRun: 8, commentsPerThread: 40 } };
const env = { REDDIT_ACQUISITION_PROVIDER: 'brightdata', REDDIT_PAID_ACQUISITION_APPROVED: 'true', BRIGHTDATA_API_KEY: 'test-key-not-real' };
await assert.rejects(() => all(collectReddit({ channel, env: {} })), error => error.blocked === true && error.message.includes('付费'));
await assert.rejects(() => all(collectReddit({ channel, env: { REDDIT_ACQUISITION_PROVIDER: 'brightdata', REDDIT_PAID_ACQUISITION_APPROVED: 'true' } })), error => error.blocked === true && error.message.includes('BRIGHTDATA_API_KEY'));

let jobs = {};
let triggerCalls = 0;
const triggered = [];
const brightData = {
  trigger: async (_key, datasetId, rows, options) => {
    triggerCalls += 1;
    triggered.push({ datasetId, rows, options });
    return 'snapshot-' + triggerCalls;
  },
  progress: async () => 'ready',
  download: async (_key, snapshotId) => snapshotId === 'snapshot-1'
    ? [{
        post_id: 'abc',
        url: 'https://www.reddit.com/r/LocalLLaMA/comments/abc/builder_experience/',
        title: 'Builder experience',
        description: 'A detailed agent building report using MCP tools and inference',
        user_posted: 'builder',
        community_name: 'LocalLLaMA',
        num_upvotes: 100,
        num_comments: 20,
        date_posted: '2026-09-19T23:59:00Z',
        comments: [
          { comment_id: 'embedded', comment: 'Embedded observation', user_commenting: 'reader', num_upvotes: 2, date_posted: '2026-09-19T23:59:30Z' },
          { comment_id: 'robot', comment: 'TL;DR of the discussion generated automatically', user_commenting: 'summary_bot', date_posted: '2026-09-19T23:59:40Z' }
        ]
      }]
    : [
        { comment_id: 'deep', post_id: 'abc', post_url: 'https://www.reddit.com/r/LocalLLaMA/comments/abc/builder_experience/', comment: 'Independent community detail', user_posted: 'human', num_upvotes: 7, date_posted: '2026-09-19T23:59:45Z' },
        { comment_id: 'deleted', post_id: 'abc', post_url: 'https://www.reddit.com/r/LocalLLaMA/comments/abc/builder_experience/', comment: '[deleted]', user_posted: 'human', date_posted: '2026-09-19T23:59:46Z' }
      ]
};
const providerState = {
  load: () => jobs,
  save: (key, state) => (jobs = { ...jobs, [key]: state }),
  reserveThreads: (threads, max) => threads.slice(0, max)
};
const window = { windowEnd: now.toISOString(), providerWindowStart: '2026-09-18T18:00:00.000Z' };
const first = await all(collectReddit({ channel, env, now, window, providerState, brightData }));
assert.equal(first.length, 1);
assert.equal(first[0].coverage.provider, 'brightdata');
assert.equal(first[0].coverage.posts, 1);
assert.equal(first[0].coverage.comments, 2);
assert.equal(first[0].coverage.deepThreads, 1);
assert.equal(first[0].items.find(item => item.platformId === 't1_embedded').metadata.structureComplete, false);
assert.equal(first[0].items.find(item => item.platformId === 't1_deep').parentIdentity, null);
assert.ok(first[0].items.filter(item => item.sourceKind === 'comment').every(item => item.metadata.independentEvidence === false));
assert.ok(first[0].items.every(item => item.rights.aiAllowed === false && item.rights.exportAllowed === false));
assert.equal(triggered[0].rows[0].sort_by, 'New');
assert.equal(triggered[0].options.limitPerInput, 15);
assert.deepEqual(triggered[1].rows, [{ url: 'https://www.reddit.com/r/LocalLLaMA/comments/abc/builder_experience/', days_back: 1 }]);
assert.ok(Object.values(jobs).every(job => job.status === 'complete' && job.snapshotId));

const resumed = await all(collectReddit({ channel, env, now, window, providerState, brightData }));
assert.equal(triggerCalls, 2, '相同窗口重试必须复用已持久化 snapshot，不再次触发付费任务');
assert.equal(resumed[0].coverage.postSnapshotId, first[0].coverage.postSnapshotId);
assert.equal(resumed[0].coverage.commentSnapshotId, first[0].coverage.commentSnapshotId);

console.log('acquisition community mock contracts passed: RSS identity/summary, GitHub windows/quality, Bright Data approval/snapshots/comments');
