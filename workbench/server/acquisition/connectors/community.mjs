import { DOMParser } from 'linkedom';
import { parseChannelFeed } from '../../domain/intelligence-channels.mjs';
import { xhtmlToMd } from '../../lib/books.mjs';

function config(channel) { try { return { ...channel, ...(typeof channel.config_json === 'string' ? JSON.parse(channel.config_json) : {}), ...channel.config, ...channel.options }; } catch { throw new Error('Invalid acquisition channel configuration'); } }
const value = (node, ...names) => { for (const name of names) { const n = [...(node?.children || [])].find(c => c.localName === name || c.tagName === name); if (n?.textContent) return n.textContent.trim(); } return ''; };
const text = html => xhtmlToMd(String(html || ''),()=> '').trim();
const canonical = input => { const u = new URL(input); u.hash = ''; for (const key of [...u.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) u.searchParams.delete(key); return u.href; };

/** Discovery payloads deliberately remain summaries/metadata until a separate fulltext fetch succeeds. */
export function normalizeCommunityFeed(raw, channel) {
 const c = config(channel), endpoint = c.endpoint || c.url || c.candidateEndpoint;
 const parsed = parseChannelFeed(raw, { url: endpoint, format: c.format === 'github' ? 'github' : 'rss', limit:1000 });
 if (c.format === 'github') return parsed.map(entry => ({ identity: `github:release:${canonical(entry.url)}`, title: entry.title, url: canonical(entry.url), body: entry.body, summary: '', publishedAt: entry.publishedAt, author: entry.author, sourceKind: 'post', platform: 'github', readLevel: 'original', contentStatus: 'full_text', rights: { aiAllowed: c.aiAllowed !== false, exportAllowed: c.exportAllowed !== false }, metadata: { releaseNotes: true, fulltextPending: false } }));
 const doc = new DOMParser().parseFromString(raw, 'text/xml');
 const nodes = [...doc.getElementsByTagName('item'), ...doc.getElementsByTagName('entry')];
 return parsed.flatMap(entry => {
  const node = nodes.find(n => value(n, 'title') === entry.title);
  const summary = text(value(node, 'description', 'summary', 'content', 'encoded', 'content:encoded'));
  const guid = value(node, 'guid', 'id');
  const discussion = value(node, 'comments');
  const platform = c.platform || (c.key || c.stableKey || '').split('.')[1] || 'web';
  let platformId, identity, url = canonical(entry.url), sourceKind = 'article';
  if (platform === 'hacker_news' || platform === 'hn') {
   platformId = [discussion, guid, entry.url, value(node, 'description')].map(s => String(s).match(/(?:news\.ycombinator\.com\/item\?id=|hnrss\.org\/item\?id=)(\d+)/)?.[1]).find(Boolean);
   identity = platformId ? `hn:${platformId}` : `url:${url}`; sourceKind = 'post';
  } else if (platform === 'arxiv') {
   platformId = [guid, entry.url].map(s => String(s).match(/(?:abs|arxiv\.org\/a)\/(\d{4}\.\d+(?:v\d+)?|[a-z-]+\/\d+(?:v\d+)?)/i)?.[1]).find(Boolean);
   identity = platformId ? `arxiv:${platformId.replace(/v\d+$/, '')}` : `url:${url}`;
  } else if (platform === 'stackoverflow') {
   platformId = entry.url.match(/\/questions\/(\d+)/)?.[1]; identity = platformId ? `stackoverflow:${platformId}` : `url:${url}`; sourceKind = 'post';
  } else { identity = `url:${url}`; platformId = guid || null; }
  const result = { identity, title: entry.title, url, body: '', summary, publishedAt: entry.publishedAt, author: entry.author,
   sourceKind, platform, platformId, readLevel: summary ? 'summary' : 'metadata', contentStatus: 'discovered',
   rights: { aiAllowed: c.aiAllowed !== false, exportAllowed: c.exportAllowed !== false },
   metadata: { feedGuid: guid || null, discussionUrl: discussion || null, transportProvider: c.transportProvider || null, arxivVersion: platform === 'arxiv' ? platformId?.match(/v(\d+)$/)?.[1] || null : null, fulltextPending: true } };
  if (platform === 'hacker_news' || platform === 'hn') {
   if (!platformId) return { ...result, sourceKind: 'article', identity: `url:${url}` };
   const discussionUrl = `https://news.ycombinator.com/item?id=${platformId}`;
   const post = { ...result, url: discussionUrl, metadata: { ...result.metadata, discussionUrl, externalOriginalUrl: url, fulltextPending: false } };
   if (new URL(url).hostname === 'news.ycombinator.com') return post;
   return [post, { ...result, identity: `url:${url}`, sourceKind: 'article', platform: 'web', platformId: null, summary: '', readLevel: 'metadata', metadata: { ...result.metadata, discussionUrl, discoveredViaDiscussion: identity, fulltextPending: true } }];
  }
  return result;
 });
}

export async function* collectCommunity({ channel, checkpoint = {}, request, signal, now = new Date(), budget = 20, mode = 'sync', window }) {
 const c = config(channel);
 if (c.adapter === 'github_search_api' || c.platform === 'github') { yield* collectGitHub({ c, checkpoint, request, signal, now, budget, mode, window }); return; }
 const endpoint = c.endpoint || c.url || c.candidateEndpoint;
 if (!endpoint || endpoint.includes('{')) throw Object.assign(new Error('Unresolved community endpoint'), { code: 'blocked' });
 if (budget < 1) { yield { items: [], checkpoint, outcome: 'partial', partition: 'default', coverage: { requests: 0, reason: 'request_budget_exhausted' } }; return; }
 const headers = { ...(checkpoint.etag ? { 'if-none-match': checkpoint.etag } : {}), ...(checkpoint.lastModified ? { 'if-modified-since': checkpoint.lastModified } : {}) };
 const response = await request(endpoint, { headers, signal });
 if (response.status === 304) { yield { items: [], checkpoint: { ...checkpoint, checkedAt: now.toISOString() }, partition: 'default', outcome: 'no_new', coverage: { requests: 1, status: 304, completeness: 'current_feed_only' } }; return; }
 const items = normalizeCommunityFeed(response.text, c);
 yield { items, checkpoint: { etag: response.headers?.etag || null, lastModified: response.headers?.['last-modified'] || null, checkedAt: now.toISOString() }, partition: 'default', outcome: items.length ? 'success' : 'no_new', coverage: { requests: 1, discovered: items.length, fulltext: 0, completeness: 'current_feed_only', historicalReplaySupported: false, ...(mode === 'backfill' ? { gap: 'rss_has_no_historical_archive_contract' } : {}) } };
}

async function* collectGitHub({ c, checkpoint, request, signal, now, budget, mode, window: acquisition }) {
 const normal=mode!=='backfill',end=normal?(acquisition?.windowEnd||now.toISOString()):(checkpoint.end||now.toISOString());
 let windows = normal ? [{start:acquisition?.providerWindowStart||new Date(now.getTime()-30*3600000).toISOString(),end,page:1}] : checkpoint.windows || [{ start: new Date(now.getTime() - (c.backfillDays || 30) * 86400000).toISOString(), end, page: 1 }];
 let requests = 0;
 while (windows.length && requests < budget) {
  signal?.throwIfAborted(); const window = windows[0];
  const query = `${c.query || `topic:${c.topic || 'llm'}`} created:${window.start}..${window.end} archived:false fork:false`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=30&page=${window.page || 1}`;
  const response = await request(url, { signal, headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } }); requests++;
  const data = response.json ?? JSON.parse(response.text);
  if (!Array.isArray(data.items) || !Number.isFinite(data.total_count)) throw new Error('GitHub search response schema invalid');
  if (data.total_count > 1000 && Date.parse(window.end) - Date.parse(window.start) > 1000) {
   const midpoint = new Date(Math.floor((Date.parse(window.start) + Date.parse(window.end)) / 2)).toISOString();
   windows = [{ start: window.start, end: midpoint, page: 1 }, { start: midpoint, end: window.end, page: 1 }, ...windows.slice(1)];
   yield { items: [], checkpoint: { windows, end }, partition: 'default', outcome: 'partial', coverage: { requests: 1, splitWindow: true, hasMore: true, reportedTotal: data.total_count } }; continue;
  }
  const page = window.page || 1;
  const gap = data.incomplete_results || data.total_count > 1000;
  const hasNext = !normal && data.items.length === 30 && page * 30 < Math.min(data.total_count, 1000);
  windows = hasNext ? [{ ...window, page: page + 1 }, ...windows.slice(1)] : windows.slice(1);
  const topic=String(c.topic||'').toLowerCase(),tokens=topic.split(/[-_\s]+/).filter(Boolean);
  const informative=data.items.filter(repo=>repo.description&&!repo.archived&&!repo.fork&&!/(^|[-_.])(test|demo|tmp|sandbox|hello[-_]?world)([-_.]|$)/i.test(repo.name||repo.full_name||''));
  const score=repo=>{const created=Date.parse(repo.created_at)||0,freshness=Math.max(0,1-(Date.parse(end)-created)/(30*3600000));const relevance=tokens.some(term=>`${repo.name} ${repo.description} ${(repo.topics||[]).join(' ')}`.toLowerCase().includes(term))?1:0;return relevance*1e9+freshness*1e8+Math.log10(1+Number(repo.stargazers_count||0))*1e6+Math.log10(1+Number(repo.forks_count||0))*1e4;};
  const ranked=informative.sort((a,b)=>score(b)-score(a)||String(a.full_name).localeCompare(String(b.full_name))).slice(0,Math.max(1,Number(c.maxPerTopic||15)));
  const items = ranked.map(repo => ({ identity: `github:${repo.id}`, title: repo.full_name, url: repo.html_url, body: '', summary: repo.description || '', publishedAt: repo.created_at, author: repo.owner?.login || '', sourceKind: 'post', platform: 'github', platformId: String(repo.id), readLevel: 'metadata', contentStatus: 'discovered', rights: { aiAllowed: true, exportAllowed: true }, metadata: { stream:c.stream||c.topic||'github',stars: repo.stargazers_count, forks: repo.forks_count, updatedAt: repo.updated_at, observedAt: now.toISOString(), growth: null, growthRequiresPriorObservation: true, query } }));
  yield { items, observations: items.map(i => ({ identity: i.identity, kind: 'github_metrics', observedAt: now.toISOString(), stars: i.metadata.stars, forks: i.metadata.forks })), checkpoint: windows.length ? { windows, end } : { completedAt: now.toISOString() }, partition: 'default', outcome: gap || windows.length ? 'partial' : items.length ? 'success' : 'no_new', coverage: { requests: 1, reportedTotal: data.total_count, page, hasNext, hasMore: windows.length > 0, window, completeness: gap ? 'gap' : 'bounded_search_window', gap: gap ? 'github_search_truncated_or_incomplete' : null, mode } };
 }
}
