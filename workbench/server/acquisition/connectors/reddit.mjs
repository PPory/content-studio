const fail = message => Object.assign(new Error(message), { code: 'blocked', status: 403, blocked: true, retry: false });
function configuration(channel) { return { ...channel, ...(typeof channel.config_json === 'string' ? JSON.parse(channel.config_json) : {}), ...channel.config, ...channel.options }; }
const fullname = (id, type) => String(id || '').startsWith(type + '_') ? String(id) : `${type}_${id}`;
const identity = name => `reddit:${name}`;
const removed = data => data?.body === '[deleted]' || data?.body === '[removed]' || data?.selftext === '[deleted]' || data?.selftext === '[removed]' || Boolean(data?.removed_by_category);
const utc = seconds => Number.isFinite(Number(seconds)) ? new Date(Number(seconds) * 1000).toISOString() : null;

export async function* collectReddit({ channel, checkpoint = {}, request, signal, now = new Date(), budget = 20, env = {}, mode = 'sync' }) {
 const c = configuration(channel);
 if (c.access_status !== 'approved' || !['true', '1'].includes(String(env.REDDIT_ACCESS_APPROVED))) throw fail('Reddit requires an approved application and explicit access approval');
 if (!env.REDDIT_ACCESS_TOKEN || !env.REDDIT_USER_AGENT) throw fail('Reddit OAuth token and application User-Agent are required');
 const subreddit = c.subreddit || c.name;
 if (!/^[A-Za-z0-9_]{2,40}$/.test(subreddit || '')) throw fail('Invalid configured subreddit');
 const aiAllowed = ['true', '1'].includes(String(env.REDDIT_AI_APPROVED));
 const rights = { aiAllowed, exportAllowed: false };
 let count = 0, cp = structuredClone(checkpoint), removals = [], rateLimit = {};
 if (mode === 'revalidate' && c.threadId && !cp.pendingThreads?.length) cp = { ...cp, pendingThreads: [{ id: c.threadId, high: Boolean(c.highPriority) }], sortIndex: (c.sorts || ['new', 'hot']).length, commentSortIndex: 0, moreIds: [], moreRequests: 0, seenCommentIds: [], contextIds: [] };
 const call = async url => {
  signal?.throwIfAborted(); if (count >= budget) throw Object.assign(new Error('request budget exhausted'), { code: 'budget' });
  const target = new URL(url); if (target.protocol !== 'https:' || target.hostname !== 'oauth.reddit.com') throw fail('Reddit credentials may only be sent to oauth.reddit.com');
  count++; const r = await request(target.href, { signal, headers: { authorization: `Bearer ${env.REDDIT_ACCESS_TOKEN}`, 'user-agent': env.REDDIT_USER_AGENT }, redirect: 'error' });
  rateLimit = Object.fromEntries(['x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-used'].filter(k => r.headers?.[k] != null).map(k => [k, r.headers[k]]));
  return r.json ?? JSON.parse(r.text);
 };
 const normalize = (data, kind, root, depth, sort) => {
  const name = data.name || fullname(data.id, kind === 'comment' ? 't1' : 't3');
  if (removed(data)) { removals.push({ identity: identity(name), reason: 'upstream_deleted_or_removed', observedAt: now.toISOString() }); return null; }
  const body = kind === 'comment' ? data.body || '' : data.selftext || '';
  return { identity: identity(name), title: kind === 'comment' ? 'Reddit comment' : data.title || '', url: data.permalink ? new URL(data.permalink, 'https://www.reddit.com').href : `https://www.reddit.com/comments/${root.replace('t3_', '')}/`, body, summary: '', publishedAt: utc(data.created_utc), author: data.author === '[deleted]' ? '' : data.author || '', sourceKind: kind, platform: 'reddit', platformId: name, parentIdentity: kind === 'comment' ? identity(data.parent_id || root) : null, rootIdentity: identity(root), readLevel: body ? 'original' : 'metadata', contentStatus: body ? 'full_text' : 'discovered', rights, metadata: { score: data.score ?? null, numComments: data.num_comments ?? null, editedAt: data.edited && data.edited !== true ? utc(data.edited) : null, depth, sortBucket: sort, communityObservation: kind === 'comment', independentEvidence: false, observedAt: now.toISOString(), bodyMaxAgeHours: 48, upstreamExternalUrl: kind === 'post' ? data.url : null } };
 };
 while (count < budget) {
  if (!cp.pendingThreads?.length) {
   const sorts = c.sorts || ['new', 'hot']; const sortIndex = cp.sortIndex || 0;
   if (sortIndex >= sorts.length) return;
   const sort = sorts[sortIndex]; if (!['new', 'hot'].includes(sort)) throw fail('Unsupported Reddit listing sort');
   const listing = await call(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}?limit=20&raw_json=1${cp.after ? '&after=' + encodeURIComponent(cp.after) : ''}`);
   if (!Array.isArray(listing?.data?.children)) throw new Error('Reddit listing schema invalid');
   const listedPosts = listing.data.children.filter(x => x.kind === 't3').map(x => x.data);
   const cutoff = now.getTime() - (c.lookbackHours || 48) * 3600000;
   const posts = listedPosts.filter(p => Number(p.created_utc) * 1000 >= cutoff);
   const after = sort === 'new' && listedPosts.some(p => Number(p.created_utc) * 1000 < cutoff) ? null : listing.data.after;
   const terms = (c.relevanceTerms || []).map(t => String(t).toLowerCase());
   const candidates = posts.filter(p => p.num_comments > 0 && (!terms.length || terms.some(t => `${p.title} ${p.selftext}`.toLowerCase().includes(t))));
   const threadBudget = Math.max(0, Math.min(20, cp.remainingThreadBudget ?? c.threadBudget ?? 20));
   const exploration = [...candidates].sort((a, b) => b.created_utc - a.created_utc).slice(0, Math.ceil(threadBudget * 0.2));
   const exploreIds = new Set(exploration.map(p => p.id));
   const eligible = [...exploration, ...candidates.filter(p => !exploreIds.has(p.id)).sort((a, b) => (b.score + b.num_comments) - (a.score + a.num_comments))].slice(0, threadBudget);
   const items = posts.map(p => normalize(p, 'post', p.name || fullname(p.id, 't3'), 0, sort)).filter(Boolean);
   cp = { ...cp, remainingThreadBudget: threadBudget - eligible.length, after: after || null, sortIndex: after ? sortIndex : sortIndex + 1, pendingThreads: eligible.map(p => ({ id: p.id, high: p.score >= 1000 && p.num_comments >= 200 })), commentSortIndex: 0, moreIds: [], moreRequests: 0, seenCommentIds: [], contextIds: [], ancestorIds: [], ancestorRequests: 0, depths: {} };
   yield { items, removals, checkpoint: !cp.pendingThreads.length && cp.sortIndex >= sorts.length ? { completedAt: now.toISOString() } : structuredClone(cp), partition: 'default', outcome: cp.pendingThreads.length || cp.sortIndex < sorts.length ? 'partial' : items.length ? 'success' : 'no_new', coverage: { requests: 1, rateLimit, discoveredPosts: items.length, commentThreadsSelected: eligible.length, threadBudgetUsed: eligible.length, threadBudgetRemaining: cp.remainingThreadBudget, explorationThreads: exploration.length, selection: terms.length ? 'configured_terms_and_activity' : 'activity_only_no_semantic_claim', hasMore: Boolean(cp.pendingThreads.length || cp.sortIndex < sorts.length), skippedOlderPosts: listedPosts.length - posts.length, listingSort: sort } }; removals = [];
   if (count >= budget || (!cp.pendingThreads.length && cp.sortIndex >= sorts.length)) return;
   if (!cp.pendingThreads.length) continue;
  }
  const thread = cp.pendingThreads[0], root = fullname(thread.id, 't3');
  const cap = thread.high ? 100 : 40, depthCap = thread.high ? 5 : 3, moreCap = thread.high ? 5 : 2;
  const sorts = ['top', 'controversial', 'new']; const sortIndex = cp.commentSortIndex || 0;
  const items = [], more = [], context = new Set(cp.contextIds || []), seen = new Set(cp.seenCommentIds || []), ancestors = new Set(cp.ancestorIds || []);
  let bucketAdded = 0;
  const visit = (children, depth, sort) => {
   for (const child of children || []) {
    if (child.kind === 'more') { more.push(...(child.data?.children || [])); continue; }
    if (child.kind !== 't1' || !child.data) continue;
    const data = child.data, name = data.name || fullname(data.id, 't1');
    const actualDepth = Number.isFinite(data.depth) ? data.depth + 1 : (cp.depths?.[data.parent_id] != null ? cp.depths[data.parent_id] + 1 : depth);
    if (removed(data)) { normalize(data, 'comment', root, depth, sort); continue; }
    const isContext = sort === 'ancestor_context';
    const bucketLimit = sort === 'morechildren' ? cap : (thread.high ? { top: 50, controversial: 25, new: 25 } : { top: 20, controversial: 10, new: 10 })[sort] || 20;
    if (actualDepth > depthCap || (!isContext && !seen.has(name) && (seen.size >= cap || bucketAdded >= bucketLimit))) continue;
    if (isContext) { ancestors.add(name); context.delete(name); } else { if (!seen.has(name)) bucketAdded++; seen.add(name); } cp.depths ||= {}; cp.depths[name] = actualDepth; const item = normalize(data, 'comment', root, actualDepth, sort); if (item) items.push(item);
    if (data.parent_id?.startsWith('t1_') && !seen.has(data.parent_id)) context.add(data.parent_id);
    visit(data.replies?.data?.children, actualDepth + 1, sort);
   }
  };
  let requestedSort = sorts[sortIndex];
  if (sortIndex < 3) {
   const response = await call(`https://oauth.reddit.com/comments/${encodeURIComponent(thread.id)}?sort=${requestedSort}&limit=${thread.high ? [50, 25, 25][sortIndex] : [20, 10, 10][sortIndex]}&depth=${depthCap}&raw_json=1`);
   if (!Array.isArray(response) || !Array.isArray(response[1]?.data?.children)) throw new Error('Reddit comments schema invalid');
   for (const p of response[0]?.data?.children || []) if (p.kind === 't3' && removed(p.data)) normalize(p.data, 'post', root, 0, requestedSort);
   visit(response[1].data.children, 1, requestedSort); cp.commentSortIndex = sortIndex + 1;
  } else if (cp.contextIds?.length && !cp.ancestorRequests && (!thread.high || seen.size < cap)) {
   const ids = cp.contextIds.slice(0, thread.high ? Math.max(0, 100 - seen.size) : 20); requestedSort = 'ancestor_context';
   const response = await call(`https://oauth.reddit.com/api/info?id=${encodeURIComponent(ids.join(','))}&raw_json=1`);
   if (!Array.isArray(response?.data?.children)) throw new Error('Reddit ancestor context schema invalid');
   visit(response.data.children, 1, requestedSort); cp.ancestorRequests = 1;
  } else if (cp.moreIds?.length && cp.moreRequests < moreCap && seen.size < cap) {
   const ids = cp.moreIds.slice(0, Math.min(100, cap - seen.size)); requestedSort = 'morechildren';
   const response = await call(`https://oauth.reddit.com/api/morechildren?api_type=json&link_id=${root}&children=${encodeURIComponent(ids.join(','))}&raw_json=1`);
   if (!Array.isArray(response?.json?.data?.things)) throw new Error('Reddit morechildren schema invalid');
   visit(response.json.data.things, 1, requestedSort); cp.moreIds = cp.moreIds.slice(ids.length); cp.moreRequests++;
  } else {
   const complete = cp.pendingThreads.length === 1 && cp.sortIndex >= (c.sorts || ['new', 'hot']).length;
   cp = { ...cp, pendingThreads: cp.pendingThreads.slice(1), commentSortIndex: 0, moreIds: [], moreRequests: 0, seenCommentIds: [], contextIds: [], ancestorIds: [], ancestorRequests: 0, depths: {} };
   yield { items: [], observations: [{ kind: 'reddit_thread_review', identity: identity(root), observedAt: now.toISOString(), followupHours: [6, 24, 48] }], checkpoint: complete ? { completedAt: now.toISOString() } : structuredClone(cp), partition: 'default', outcome: complete ? 'success' : 'partial', coverage: { requests: 0, hasMore: !complete, threadId: thread.id, uniqueComments: seen.size, completeness: 'bounded_comment_sample', followupHours: [6, 24, 48] } };
   if (complete) return;
   continue;
  }
  cp.seenCommentIds = [...seen]; cp.moreIds = [...new Set([...(cp.moreIds || []), ...more])].filter(id => !seen.has(fullname(id, 't1'))); cp.ancestorIds = [...ancestors]; cp.contextIds = [...context].filter(id => !seen.has(id) && !ancestors.has(id));
  const contextLimit = thread.high ? Math.max(0, 100 - seen.size - ancestors.size) : Math.max(0, 20 - ancestors.size);
  // Missing parents remain explicit placeholders; their text is never invented or sent to an AI as evidence.
  for (const name of cp.contextIds.slice(0, contextLimit)) items.push({ identity: identity(name), title: 'Reddit context unavailable', url: `https://www.reddit.com/comments/${thread.id}/comment/${name.slice(3)}/`, body: '', summary: '', sourceKind: 'comment', platform: 'reddit', platformId: name, rootIdentity: identity(root), readLevel: 'metadata', contentStatus: 'context_missing', rights, metadata: { contextOnly: true, independentEvidence: false, observedAt: now.toISOString(), bodyMaxAgeHours: 48 } });
  yield { items, removals, checkpoint: structuredClone(cp), partition: 'default', outcome: 'partial', coverage: { requests: 1, rateLimit, hasMore: true, threadId: thread.id, sort: requestedSort, uniqueComments: seen.size, commentCap: cap, depthTarget: depthCap, morechildrenRequests: cp.moreRequests, ancestorRequests: cp.ancestorRequests || 0, remainingMoreIds: cp.moreIds.length, missingAncestorCount: cp.contextIds.length, contextPlaceholders: Math.min(contextLimit, cp.contextIds.length), completeness: 'bounded_comment_sample', followupHours: [6, 24, 48] } }; removals = [];
 }
}
