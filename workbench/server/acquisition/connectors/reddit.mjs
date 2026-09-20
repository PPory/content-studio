import { BRIGHTDATA_DATASETS, runBrightDataJob } from '../providers/brightdata.mjs';

const blocked = (message, code = 'AUTH_BLOCKED') => Object.assign(new Error(`${code}：${message}`), { code: 'blocked', status: 403, blocked: true, retry: false });
const configuration = channel => ({ ...channel, ...(typeof channel.config_json === 'string' ? JSON.parse(channel.config_json) : {}), ...channel.config, ...channel.options });
const truthy = value => ['true','1'].includes(String(value).toLowerCase());
const pick = (row,...keys) => keys.map(key=>row?.[key]).find(value=>value!==undefined&&value!==null&&value!=='');
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const iso = value => { const time=typeof value==='number'&&value<1e12?value*1000:Date.parse(value);return Number.isFinite(time)?new Date(time).toISOString():null; };
const fullname = (value,type) => String(value||'').startsWith(`${type}_`) ? String(value) : `${type}_${value}`;
const identity = value => `reddit:${value}`;
const cleanUrl = value => { try { const url=new URL(value,'https://www.reddit.com');url.hash='';return url.href; } catch { return ''; } };
const deleted = value => ['[deleted]','[removed]'].includes(String(value||'').trim().toLowerCase());
const bot = row => /(^|[-_])(bot|automoderator)$/i.test(String(pick(row,'user_commenting','user_posted','author')||'')) || /^\s*TL;DR of the discussion generated automatically/i.test(String(pick(row,'comment','body','text')||''));

function normalizePost(row,channel,now){
  const url=cleanUrl(pick(row,'url','post_url','link')),rawId=pick(row,'post_id','id');
  const id=rawId?fullname(rawId,'t3'):url.match(/\/comments\/([^/]+)/)?.[1]?fullname(url.match(/\/comments\/([^/]+)/)[1],'t3'):'';
  if(!id||!url)return null;
  const body=String(pick(row,'description','selftext','text')||'');if(deleted(body))return null;
  return {identity:identity(id),title:String(pick(row,'title','post_title')||'').slice(0,500),url,body,summary:'',publishedAt:iso(pick(row,'date_posted','created_at','creation_date','created_utc')),author:String(pick(row,'user_posted','author')||''),sourceKind:'post',platform:'reddit',platformId:id,rootIdentity:identity(id),readLevel:body?'original':'metadata',contentStatus:body?'full_text':'discovered',rights:{aiAllowed:false,exportAllowed:false},metadata:{stream:'reddit_posts',subreddit:pick(row,'community_name','subreddit')||channel.name,score:number(pick(row,'num_upvotes','upvotes','score')),numComments:number(pick(row,'num_comments','comments_count')),observedAt:now.toISOString(),communityObservation:false,independentEvidence:true,bodyMaxAgeHours:48,rawComments:Array.isArray(row.comments)?row.comments:[]}};
}

function normalizeComment(row,post,now,{embedded=false}={}){
  const body=String(pick(row,'comment','body','text')||'').trim();if(!body||deleted(body)||bot(row))return null;
  const rawId=pick(row,'comment_id','id'),id=rawId?fullname(rawId,'t1'):`t1_brightdata_${Buffer.from(`${post.platformId}\0${body}\0${pick(row,'user_commenting','user_posted','author')||''}`).toString('base64url').slice(0,40)}`;
  const rawParent=pick(row,'parent_id','parent_comment_id'),hasStructure=Boolean(rawParent)||Number.isFinite(Number(row.depth));
  const parentIdentity=rawParent?identity(String(rawParent).startsWith('t')?rawParent:fullname(rawParent,'t1')):post.identity;
  const depth=Number.isFinite(Number(row.depth))?Number(row.depth):null;
  return {identity:identity(id),title:'Reddit comment',url:cleanUrl(pick(row,'url','comment_url')||`${post.url.replace(/\/$/,'')}/comment/${id.slice(3)}/`),body,summary:'',publishedAt:iso(pick(row,'date_posted','created_at','creation_date','created_utc')),author:String(pick(row,'user_commenting','user_posted','author')||''),sourceKind:'comment',platform:'reddit',platformId:id,parentIdentity,rootIdentity:post.identity,readLevel:'original',contentStatus:'full_text',rights:{aiAllowed:false,exportAllowed:false},metadata:{stream:'reddit_comments',subreddit:pick(row,'community_name','subreddit')||post.metadata.subreddit,score:number(pick(row,'num_upvotes','upvotes','score')),observedAt:now.toISOString(),communityObservation:true,independentEvidence:false,structureComplete:hasStructure,depth,embedded,bodyMaxAgeHours:48}};
}

const highValue = post => Number(post.metadata.numComments||0)>=10 || Number(post.metadata.score||0)>=50 || post.body.length>=500 || /\b(ai|agent|agents|model|models|llm|mcp|tool|tools|gpt|claude|gemini|qwen|deepseek)\b/i.test(`${post.title} ${post.body}`);
const rank = post => Number(post.metadata.numComments||0)*1000+Number(post.metadata.score||0)*10+Math.min(post.body.length,5000);

export async function* collectReddit({channel,checkpoint={},signal,now=new Date(),env={},mode='sync',window,providerState,brightData}){
  const c=configuration(channel),provider=env.REDDIT_ACQUISITION_PROVIDER||'brightdata';
  if(provider!=='brightdata')throw blocked('当前只支持 brightdata provider','AUTH_BLOCKED');
  if(!truthy(env.REDDIT_PAID_ACQUISITION_APPROVED))throw blocked('付费 Reddit acquisition 未明确批准','PAID_ACCESS_BLOCKED');
  if(!env.BRIGHTDATA_API_KEY)throw blocked('缺少 BRIGHTDATA_API_KEY','AUTH_BLOCKED');
  const subreddit=c.subreddit||c.name;if(!/^[A-Za-z0-9_]{2,40}$/.test(subreddit||''))throw blocked('subreddit 配置无效','AUTH_BLOCKED');
  const jobs=providerState?.load?.()||checkpoint.providerJobs||{},persist=(key,state)=>{jobs[key]=state;return providerState?.save?.(key,state)||jobs;};
  const postsPerSubreddit=Math.max(1,Math.min(50,Number(c.postsPerSubreddit||15))),postRows=[{url:`https://www.reddit.com/r/${subreddit}/`,sort_by:'New'}];
  const postKey=`posts:${subreddit}`,postJob=await runBrightDataJob({apiKey:env.BRIGHTDATA_API_KEY,datasetId:BRIGHTDATA_DATASETS.redditPosts,rows:postRows,options:{discoverBy:'subreddit_url',limitPerInput:postsPerSubreddit,requestSalt:window?.windowEnd||now.toISOString()},jobKey:postKey,state:jobs[postKey],persist:state=>persist(postKey,state),signal,heartbeat:()=>{},client:brightData});
  const posts=[...new Map(postJob.records.map(row=>normalizePost(row,channel,now)).filter(Boolean).map(post=>[post.identity,post])).values()].sort((a,b)=>rank(b)-rank(a)||a.identity.localeCompare(b.identity)).slice(0,postsPerSubreddit);
  const comments=[];
  for(const post of posts)for(const row of post.metadata.rawComments){const comment=normalizeComment(row,post,now,{embedded:true});if(comment)comments.push(comment);}
  for(const post of posts)delete post.metadata.rawComments;
  await postJob.complete();
  let deep=posts.filter(highValue).sort((a,b)=>rank(b)-rank(a)||a.identity.localeCompare(b.identity)).slice(0,8).map(post=>({id:post.platformId,url:post.url,post}));
  if(providerState?.reserveThreads)deep=providerState.reserveThreads(deep,Math.max(0,Math.min(8,Number(c.deepThreadsPerRun||8))));
  let commentSnapshotId=null;
  if(deep.length){
    const rows=deep.map(thread=>({url:thread.url,days_back:mode==='backfill'?Math.max(1,Number(c.backfillDays||7)):1})),commentKey=`comments:${subreddit}`;
    const commentJob=await runBrightDataJob({apiKey:env.BRIGHTDATA_API_KEY,datasetId:BRIGHTDATA_DATASETS.redditComments,rows,options:{requestSalt:`${window?.windowEnd||now.toISOString()}:${deep.map(x=>x.id).sort().join(',')}`},jobKey:commentKey,state:(providerState?.load?.()||jobs)[commentKey],persist:state=>persist(commentKey,state),signal,heartbeat:()=>{},client:brightData});
    commentSnapshotId=commentJob.state.snapshotId;
    const byUrl=new Map(deep.map(item=>[cleanUrl(item.url),item.post])),byId=new Map(deep.map(item=>[String(item.id).replace(/^t3_/,''),item.post])),counts=new Map();
    for(const row of commentJob.records){const post=byUrl.get(cleanUrl(pick(row,'post_url','url'))) || byId.get(String(pick(row,'post_id')||'').replace(/^t3_/,''));if(!post)continue;const count=counts.get(post.identity)||0;if(count>=Math.max(1,Math.min(40,Number(c.commentsPerThread||40))))continue;const comment=normalizeComment(row,post,now);if(comment){comments.push(comment);counts.set(post.identity,count+1);}}
    await commentJob.complete();
  }
  const uniqueComments=[...new Map(comments.map(comment=>[comment.identity,comment])).values()];
  const providerJobs=providerState?.load?.()||{};
  yield {items:[...posts,...uniqueComments],checkpoint:{...checkpoint,providerJobs,completedAt:now.toISOString()},partition:'default',outcome:posts.length||uniqueComments.length?'success':'no_new',coverage:{provider:'brightdata',postSnapshotId:postJob.state.snapshotId,commentSnapshotId,posts:posts.length,comments:uniqueComments.length,deepThreads:deep.length,hasMore:false,costGuard:{approved:true,postsPerSubreddit,deepThreads:Math.min(8,Number(c.deepThreadsPerRun||8)),commentsPerThread:Math.min(40,Number(c.commentsPerThread||40))}}};
}

export const redditNormalization={normalizePost,normalizeComment,highValue};
