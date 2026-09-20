// Deterministic connector contract tests. These do NOT assert live upstream connectivity.
import assert from 'node:assert/strict';
import { collectAiHot } from '../server/acquisition/connectors/aihot.mjs';
import { collectFollowBuilders, FOLLOW_FILES, normalizeFollowBundle } from '../server/acquisition/connectors/follow-builders.mjs';
const response = json => ({ status: 200, headers: {}, json, text: JSON.stringify(json), snapshotId: 'fixture' });
const drain = async iterator => { const result = []; for await (const page of iterator) result.push(page); return result; };
const row = id => ({ id, title: `Title ${id}`, summary: 'Summary only', links: { original: `https://example.org/${id}` } });
let calls = [];
const selected = await drain(collectAiHot({ channel: { stream: 'selected' }, request: async url => {
  calls.push(url);
  if (url.includes('changes')) { assert.ok(url.includes('cursor=first')); return response({ cursor: 'next', hasMore: false, changes: [{ op: 'remove', id: 'old' }, { op: 'upsert', item: row('new') }] }); }
  return response(url.includes('page=page2') ? { cursor: 'first', hasMore: false, nextPage: null, items: [row('two')] } : { cursor: 'first', hasMore: true, nextPage: 'page2', items: [row('one')] });
} }));
assert.equal(calls.length, 3); assert.equal(selected[0].checkpoint.cursor, null); assert.equal(selected[1].checkpoint.cursor, 'first'); assert.deepEqual(selected[2].removals, ['aihot:old']); assert.equal(selected[0].items[0].body, ''); assert.equal(selected[0].items[0].rights.aiAllowed, false);
let rejected = false;
const recovered = await drain(collectAiHot({ channel: { stream: 'selected' }, checkpoint: { cursor: 'expired' }, request: async url => {
  if (url.includes('cursor=expired')) { rejected = true; throw Object.assign(new Error('snapshot_required'), { status: 409 }); }
  return response(url.includes('snapshot') ? { cursor: 'fresh', hasMore: false, items: [] } : { cursor: 'fresh', hasMore: false, changes: [] });
} }));
assert.ok(rejected); assert.equal(recovered.at(-1).checkpoint.cursor, 'fresh');
await assert.rejects(() => drain(collectAiHot({ channel: { stream: 'selected' }, request: async () => response({ cursor:'x', hasMore:true, items:[] }) })), /page did not advance/);
await assert.rejects(() => drain(collectAiHot({ channel: { stream: 'selected' }, request: async () => { throw Object.assign(new Error('rate limited'), { status:429, retryAfterSeconds:99 }); } })), e => e.status === 429 && e.retryAfterSeconds === 99);
calls=[];
const hot = await drain(collectAiHot({ channel:{stream:'hot'}, request:async url => { calls.push(url); return response(url.includes('hot-topics') ? {items:[{...row('event'),links:{story:'https://aihot.news/story/public-id'}}]} : {story:{digest:'secondary'}}); } }));
assert.equal(hot[0].items.length,1);assert.equal(hot[0].items[0].sourceKind,'external_digest');assert.equal(hot[0].items[0].metadata.stream,'hot'); assert.equal(hot[0].observations.length,1); assert.ok(calls[1].endsWith('/api/v1/stories/public-id'));
const daily = await drain(collectAiHot({channel:{stream:'daily'},now:new Date('2026-09-20T01:00:00Z'),request:async url => response(url.includes('?') ? {items:[{date:'2026-09-19'}]} : {report:{date:'2026-09-19',generatedAt:'2026-09-19T00:00:00Z',lead:{title:'Digest',leadParagraph:'Lead'},sections:[{label:'AI',items:[{title:'Article',summary:'Text',links:{original:'https://example.org/a'}}]}],flashes:[],links:{aihot:'https://aihot.news/daily/2026-09-19'}}})}));
assert.equal(daily[0].items.length,1);assert.equal(daily[0].items[0].sourceKind,'external_digest');assert.equal(daily[0].items[0].metadata.references.length,1);
const extended = await drain(collectAiHot({channel:{stream:'daily'},mode:'backfill',checkpoint:{coverageStart:'2026-09-13'},now:new Date('2026-09-20'),request:async url=>response(url.includes('?')?{items:[{date:'2026-09-01'}]}:{report:{date:'2026-09-01',sections:[],flashes:[],lead:{title:'Older report'}}})}));
assert.equal(extended[0].items[0].platformId,'2026-09-01','explicit backfill extends beyond the previous seven-day checkpoint');
let dailyRequests = 0;
const revision = await drain(collectAiHot({channel:{stream:'daily'}, checkpoint:{completedDates:['2026-09-19'],completedVersions:{'2026-09-19':'old'}},now:new Date('2026-09-20'),request:async url=>{dailyRequests++;return response(url.includes('?')?{items:[{date:'2026-09-19',generatedAt:'revised'}]}:{report:{date:'2026-09-19',generatedAt:'revised',sections:[],flashes:[],lead:{title:'Updated'}}});}}));
assert.equal(dailyRequests,2);assert.equal(revision[0].checkpoint.completedVersions['2026-09-19'],'revised');
const missing = await drain(collectAiHot({channel:{stream:'daily'},now:new Date('2026-09-20'),request:async url=>{if(url.includes('?'))return response({items:[{date:'2026-09-19'}]});throw Object.assign(new Error('not published'),{status:404});}}));
assert.equal(missing[0].outcome,'partial');assert.ok(!missing[0].checkpoint.completedDates?.includes('2026-09-19'));
const a='a'.repeat(40), b='b'.repeat(40);
const bundle={
 'feed-x.json':{generatedAt:'2026-09-20',x:[{name:'Builder',handle:'builder',tweets:[{id:'123',text:'Original post',quotedTweetId:'missing',url:'https://x.com/builder/status/123'}]}]},
 'feed-blogs.json':{generatedAt:'2026-09-18',blogs:[]},
 'feed-podcasts.json':{generatedAt:'2026-09-19',podcasts:[{name:'Show',guid:'one',title:'Episode 1',url:'https://youtube.com/@show',transcript:'Speaker 1 | 00:00\n'+'full transcript '.repeat(10000)},{name:'Show',guid:'two',title:'Episode 2',url:'https://youtube.com/@show',transcript:'Second transcript'}]},
 'state-feed.json':{seenTweets:{'123':1},seenVideos:{one:1,two:1,failed:1},seenArticles:{},extension:'preserved'},
};
const blogFixture=structuredClone(bundle);blogFixture['feed-blogs.json'].blogs=[{name:'Fixture publisher',articles:[{url:'https://example.org/blog',title:'Blog parser fixture',content:'Complete fixture body',publishedAt:'2026-09-19'}]}];
const parsedBlog=normalizeFollowBundle(blogFixture,{},a).items.find(item=>item.metadata.stream==='feed-blogs.json');assert.equal(parsedBlog.body,'Complete fixture body');assert.equal(parsedBlog.contentStatus,'full_text');assert.equal(parsedBlog.author,'Fixture publisher');
const normalized=normalizeFollowBundle(bundle,{},a);
assert.equal(normalized.items.length,3);assert.notEqual(normalized.items[1].identity,normalized.items[2].identity);assert.ok(normalized.items[1].body.length>70000);assert.equal(normalized.streams['feed-blogs.json'].status,'no_new');assert.equal(normalized.upstreamState.extension,'preserved');assert.ok(normalized.items[0].metadata.quoteContextMissing);
const request=async url=>{
 calls.push(url);
 if(url.includes('/commits/main'))return response({sha:b,commit:{committer:{date:'2026-09-20T01:00:00Z'}}});
 if(url.includes('/commits?'))return response([{sha:a,commit:{committer:{date:'2026-09-19T01:00:00Z'}}},{sha:b,commit:{committer:{date:'2026-09-20T01:00:00Z'}}}]);
 return response(bundle[url.split('/').at(-1)]);
};
calls=[];
const first=await drain(collectFollowBuilders({channel:{},request,budget:2,now:new Date('2026-09-20')}));
assert.equal(first.length,2);assert.ok(first.at(-1).checkpoint.scan);assert.ok(!first.at(-1).checkpoint.lastCompleteSha);
const rest=await drain(collectFollowBuilders({channel:{},checkpoint:first.at(-1).checkpoint,request,budget:20}));
assert.equal(rest.at(-1).checkpoint.lastCompleteSha,b);assert.equal(rest.filter(p=>p.items.length).length,2);
const raw=calls.filter(u=>u.includes('raw.githubusercontent.com'));assert.equal(raw.length,8);assert.ok(raw.slice(0,4).every(u=>u.includes(`/${a}/`)));assert.ok(raw.slice(4).every(u=>u.includes(`/${b}/`)));
assert.equal(rest.at(-1).state.upstreamState.seenVideos.failed,1);assert.equal(rest.at(-1).state.files['feed-x.json'].blobSha.length,40);
calls=[];
const validated=await drain(collectFollowBuilders({channel:{},mode:'validate',request,budget:6}));
assert.equal(calls.length,5,'validation must read HEAD and all four pinned files, not only history');
assert.equal(validated.length,1);assert.ok(validated[0].state.streams['state-feed.json']);
assert.ok(calls.slice(1).every(url=>url.includes(`/${b}/`)));
const pending={pending:[{sha:a,at:'2026-09-19T01:00:00Z'}]};let yielded=0;
await assert.rejects(async()=>{for await(const page of collectFollowBuilders({channel:{},checkpoint:pending,request:async url=>{if(url.endsWith('state-feed.json'))throw new Error('state file failed');return response(bundle[url.split('/').at(-1)]);}})){yielded++;}},/state file failed/);
assert.equal(yielded,0);assert.equal(pending.pending.length,1);
const partial=structuredClone(bundle);partial['feed-blogs.json'].errors=['upstream extraction failed'];assert.equal(normalizeFollowBundle(partial,{},a).streams['feed-blogs.json'].status,'upstream_failed');
const invalid=structuredClone(bundle);invalid['feed-podcasts.json'].podcasts[0].guid='';assert.throws(()=>normalizeFollowBundle(invalid,{},a),/guid/);
let historyCalls=0;
const resumed=await drain(collectFollowBuilders({channel:{},checkpoint:{scan:{head:a,since:'2026-09-01',pathIndex:0,page:1,commits:[],headAt:'2026-09-19'}},budget:1,request:async()=>{historyCalls++;return {...response([{sha:a,commit:{committer:{date:'2026-09-19'}}}]),headers:{link:'<https://api.github.com/next>; rel="next"'}};}}));
assert.equal(historyCalls,1);assert.equal(resumed[0].checkpoint.scan.page,2);
await assert.rejects(()=>drain(collectFollowBuilders({channel:{},checkpoint:{lastCompleteSha:a,lastCompleteAt:'2026-09-19'},request:async url=>response(url.includes('/compare/')?{status:'diverged'}:{sha:b})})),e=>e.code==='history_gap');
assert.equal(FOLLOW_FILES.length,4);
console.log('acquisition-providers: mock contract tests passed (not live integration)');
