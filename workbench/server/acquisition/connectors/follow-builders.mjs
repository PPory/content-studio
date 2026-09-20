import { createHash } from 'node:crypto';

export const FOLLOW_FILES = ['feed-x.json', 'feed-blogs.json', 'feed-podcasts.json', 'state-feed.json'];
const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_schema' }); };
const sha = value => /^[a-f0-9]{40}$/i.test(value || '');
const rights = channel => ({ aiAllowed: channel.rights?.aiAllowed === true, exportAllowed: channel.rights?.exportAllowed === true });
const hash = text => createHash('sha256').update(text).digest('hex');
const blob = text => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
const snapshots = responses => responses.filter(r => r.snapshotId).map(r => r.snapshotId);
const array = (value, name) => Array.isArray(value) ? value : fail(`Follow Builders ${name} is not an array`);
function canonical(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) fail('Follow Builders invalid article URL');
  url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/.test(key)) url.searchParams.delete(key);
  return url.href;
}
function errors(data) {
  if (data.errors === undefined || data.errors === null) return [];
  return Array.isArray(data.errors) ? data.errors : typeof data.errors === 'object' ? Object.values(data.errors) : [String(data.errors)];
}
export function normalizeFollowBundle(files, channel, commitSha) {
  const x = files['feed-x.json'], blogs = files['feed-blogs.json'], podcasts = files['feed-podcasts.json'], upstream = files['state-feed.json'];
  const groups = array(x?.x, 'x'), blogRows = array(blogs?.blogs, 'blogs'), podcastRows = array(podcasts?.podcasts, 'podcasts');
  for (const key of ['seenTweets', 'seenVideos', 'seenArticles']) if (!upstream?.[key] || typeof upstream[key] !== 'object' || Array.isArray(upstream[key])) fail(`Follow Builders state.${key} missing`);
  const items = [], streams = {};
  const base = (row, stream, body) => ({ title: row.title || row.text?.slice(0,120) || '', url: row.url || '', body, summary: row.summary || '', publishedAt: row.publishedAt || row.createdAt || null, author: row.author || row.name || '', readLevel: body ? 'original' : 'summary', contentStatus: body ? 'full_text' : 'summary_only', rights: rights(channel), metadata: { upstream: 'follow_builders', commitSha, stream, generatedAt: files[stream]?.generatedAt || null } });
  for (const group of groups) {
    for (const row of array(group.tweets, 'tweets')) {
      if (!row.id || typeof row.text !== 'string') fail('Follow Builders tweet id/text missing');
      items.push({ ...base(row, 'feed-x.json', row.text), identity: `x:${row.id}`, platform: 'x', platformId: String(row.id), author: group.handle || group.name || '', sourceKind: 'post', metadata: { ...base(row, 'feed-x.json', row.text).metadata, likes: row.likes, retweets: row.retweets, replies: row.replies, quotedTweetId: row.quotedTweetId || null, quoteContextMissing: Boolean(row.quotedTweetId), attribution: group.name || group.handle } });
    }
  }
  for (const group of blogRows) {
    const rows = Array.isArray(group.articles) ? group.articles : [group];
    for (const row of rows) {
      if (!row.url || !row.title) fail('Follow Builders blog url/title missing');
      const body = row.content ?? row.body ?? row.text ?? row.markdown;
      if (typeof body !== 'string') fail('Follow Builders blog body is not text');
      const url = canonical(row.url);
      items.push({ ...base(row, 'feed-blogs.json', body), url, identity: `url:${url}`, platform: 'web', platformId: url, author: row.author || group.name || '', sourceKind: 'article' });
    }
  }
  for (const row of podcastRows) {
    const publisher = row.publisherKey || row.name;
    if (!publisher || !row.guid || !row.title || typeof row.transcript !== 'string') fail('Follow Builders podcast publisher/guid/transcript missing');
    const identity = `podcast:${encodeURIComponent(publisher)}:${encodeURIComponent(row.guid)}`;
    items.push({ ...base(row, 'feed-podcasts.json', row.transcript), identity, platform: 'podcast', platformId: `${publisher}:${row.guid}`, sourceKind: 'podcast_transcript', metadata: { ...base(row, 'feed-podcasts.json', row.transcript).metadata, publisherKey: publisher, guid: row.guid, speakerAttribution: 'upstream transcript', transcriptStructure: row.segments || null } });
  }
  const localTweets = new Set(items.filter(i => i.platform === 'x').map(i => i.platformId));
  for (const i of items) if (i.platform === 'x' && i.metadata.quotedTweetId) i.metadata.quoteContextMissing = !localTweets.has(String(i.metadata.quotedTweetId));
  for (const file of FOLLOW_FILES.slice(0,3)) {
    const count = items.filter(i => i.metadata.stream === file).length, problems = errors(files[file]);
    streams[file] = { generatedAt: files[file].generatedAt || null, count, errors: problems, status: problems.length ? count ? 'upstream_partial' : 'upstream_failed' : count ? 'success' : 'no_new' };
  }
  streams['state-feed.json'] = { status: 'success', seenTweets: Object.keys(upstream.seenTweets).length, seenVideos: Object.keys(upstream.seenVideos).length, seenArticles: Object.keys(upstream.seenArticles).length };
  return { items, streams, upstreamState: upstream };
}

export async function* collectFollowBuilders({ channel, checkpoint = {}, request, signal, now = new Date(), mode = 'sync', budget = 20 }) {
  const repo = channel.options?.repo || 'zarazhangrui/follow-builders', ref = channel.options?.ref || 'main';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) fail('Invalid Follow Builders repository');
  const api = `https://api.github.com/repos/${repo}`;
  let state = mode === 'validate' ? {} : structuredClone(checkpoint), left = Math.max(1, Math.floor(budget));
  const get = url => {if(left<=0)throw Object.assign(new Error('Follow request budget exhausted'),{code:'budget'});left--;return request(url, { headers: { accept: 'application/vnd.github+json' }, signal });};
  if (!state.scan && !state.pending?.length) {
    const head = await get(`${api}/commits/${encodeURIComponent(ref)}`);
    if (!sha(head.json?.sha)) fail('Follow Builders HEAD is not a commit SHA');
    if (mode === 'validate') {
      state.pending=[{sha:head.json.sha,at:head.json.commit?.committer?.date||new Date(now).toISOString()}];
    } else {
    if (state.lastCompleteSha === head.json.sha && mode !== 'backfill') {
      yield { items: [], checkpoint: state, partition: 'default', outcome: 'no_new', snapshots: snapshots([head]), coverage: { commitSha: head.json.sha, unchanged: true } }; return;
    }
    if (state.lastCompleteSha && state.lastCompleteSha !== head.json.sha) {
      const comparison = await get(`${api}/compare/${state.lastCompleteSha}...${head.json.sha}`);
      if (!['ahead','identical'].includes(comparison.json?.status)) throw Object.assign(new Error('Follow Builders history rewritten: previous completion is not an ancestor'), { code: 'history_gap' });
    }
    const days = Math.min(30, Math.max(1, Number(channel.options?.backfillDays || (mode === 'backfill' ? 30 : 7))));
    const since = (mode!=='backfill'&&state.lastCompleteAt) || new Date(new Date(now).getTime() - days * 86400000).toISOString();
    state.scan = { head: head.json.sha, headAt: head.json.commit?.committer?.date || new Date(now).toISOString(), since, pathIndex: 0, page: 1, commits: [] };
    }
  }
  while (state.scan && left > 0) {
    signal?.throwIfAborted();
    const scan = state.scan, file = FOLLOW_FILES[scan.pathIndex];
    const response = await get(`${api}/commits?sha=${scan.head}&path=${encodeURIComponent(file)}&since=${encodeURIComponent(scan.since)}&per_page=100&page=${scan.page}`);
    const commits = array(response.json, 'commit history');
    for (const commit of commits) {
      if (!sha(commit.sha) || !commit.commit?.committer?.date) fail('Follow Builders malformed commit history');
      if (commit.sha !== state.lastCompleteSha && !scan.commits.some(c => c.sha === commit.sha)) scan.commits.push({ sha: commit.sha, at: commit.commit.committer.date });
    }
    const link = response.headers?.link || response.headers?.Link || '';
    const more = /rel="next"/.test(link);
    if (more && !commits.length) fail('Follow Builders empty history continuation');
    if (more) scan.page++;
    else { scan.pathIndex++; scan.page = 1; }
    if (scan.pathIndex >= FOLLOW_FILES.length) {
      if (!scan.commits.some(c => c.sha === scan.head)) scan.commits.push({ sha: scan.head, at: scan.headAt });
      state.pending = scan.commits.sort((a,b) => a.at.localeCompare(b.at) || a.sha.localeCompare(b.sha));
      state.coverageStart = scan.since; state.targetHead = scan.head; delete state.scan;
    }
    yield { items: [], checkpoint: structuredClone(state), partition: 'default', outcome: 'partial', snapshots: snapshots([response]), coverage: { phase: 'history_discovery', path: file, page: scan.page, hasMore: true, coverageStart: scan.since } };
  }
  while (state.pending?.length && left >= 4) {
    signal?.throwIfAborted();
    const commit = state.pending[0], files = {}, responses = [], versions = {};
    // Do not yield a completion checkpoint until ALL FOUR files validate at this exact SHA.
    for (const file of FOLLOW_FILES) {
      const response = await get(`https://raw.githubusercontent.com/${repo}/${commit.sha}/${file}`);
      if (!response.json || typeof response.json !== 'object' || Array.isArray(response.json)) fail(`Follow Builders invalid JSON object: ${file}`);
      files[file] = response.json; responses.push(response);
      const text = response.text ?? JSON.stringify(response.json);
      versions[file] = { blobSha: blob(text), contentHash: hash(text), snapshotId: response.snapshotId || null };
    }
    const result = normalizeFollowBundle(files, channel, commit.sha);
    for(const item of result.items)item.metadata.upstreamCommitAt=commit.at;
    state = { ...state, pending: state.pending.slice(1), lastCompleteSha: commit.sha, lastCompleteAt: commit.at, files: versions };
    const upstreamErrors = Object.values(result.streams).some(s => s.errors?.length);
    yield { items: result.items, checkpoint: structuredClone(state), partition: 'default', outcome: upstreamErrors ? 'partial' : result.items.length ? 'success' : 'no_new', snapshots: snapshots(responses), state: { upstreamState: result.upstreamState, streams: result.streams, files: versions }, coverage: { commitSha: commit.sha, coverageStart: state.coverageStart, hasMore: state.pending.length > 0, streams: result.streams, currentBundleOnly: mode==='validate', boundary: 'Only upstream published and retrievable file versions; upstream omissions cannot be recovered.' } };
  }
  if(state.scan || state.pending?.length)yield {items:[],checkpoint:structuredClone(state),partition:'default',outcome:'partial',coverage:{hasMore:true,reason:'request_budget',remainingRequests:left}};
}
export default collectFollowBuilders;
