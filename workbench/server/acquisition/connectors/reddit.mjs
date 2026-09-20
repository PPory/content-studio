import { createHash } from 'node:crypto';
import { classifyAiRelevance } from '../relevance.mjs';
import { acquisitionWindow, gateAcquisitionItems } from '../window.mjs';
import { BRIGHTDATA_DATASETS, runBrightDataJob } from '../providers/brightdata.mjs';

const blocked = (message, code = 'AUTH_BLOCKED') => Object.assign(new Error(`${code}：${message}`), { code: 'blocked', status: 403, blocked: true, retry: false });
const configuration = channel => ({ ...channel, ...(typeof channel.config_json === 'string' ? JSON.parse(channel.config_json) : {}), ...channel.config, ...channel.options });
const truthy = value => ['true','1'].includes(String(value).toLowerCase());
const pick = (row,...keys) => keys.map(key=>row?.[key]).find(value=>value!==undefined&&value!==null&&value!=='');
const number = value => value!==undefined && value!==null && value!=='' && Number.isFinite(Number(value)) ? Number(value) : null;
const bounded = (value,fallback,min,max) => { const parsed=number(value);return parsed===null?fallback:Math.max(min,Math.min(max,Math.floor(parsed))); };
const iso = value => { const time=typeof value==='number'&&value<1e12?value*1000:Date.parse(value);return Number.isFinite(time)?new Date(time).toISOString():null; };
const fullname = (value,type) => String(value||'').startsWith(`${type}_`) ? String(value) : `${type}_${value}`;
const identity = value => `reddit:${value}`;
const cleanUrl = value => { if(!value)return '';try { const url=new URL(value,'https://www.reddit.com');url.hash='';return url.href; } catch { return ''; } };
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
  const author=String(pick(row,'user_commenting','user_posted','author')||''),publishedAt=iso(pick(row,'date_posted','created_at','creation_date','created_utc'));
  const suppliedUrl=cleanUrl(pick(row,'comment_url','url')||''),urlId=suppliedUrl.match(/\/comments\/[^/]+\/[^/]*\/([a-z0-9]+)(?:\/|$)/i)?.[1];
  const rawId=pick(row,'comment_id','id')||urlId;
  const id=rawId?fullname(rawId,'t1'):null;
  const localIdentity=id?identity(id):'reddit:comment-fingerprint:'+createHash('sha256').update(JSON.stringify([post.platformId,body,author,publishedAt])).digest('hex');
  const rawParent=pick(row,'parent_id','parent_comment_id');
  const parentIdentity=rawParent?identity(/^t[13]_/.test(String(rawParent))?String(rawParent):String(rawParent)===post.platformId.replace(/^t3_/,'')?fullname(rawParent,'t3'):fullname(rawParent,'t1')):null;
  const depthValue=number(row.depth),depth=depthValue!==null&&Number.isInteger(depthValue)&&depthValue>=0?depthValue:null;
  const missing=['comment_id','parent_id','depth','published_at'].filter(key=>({comment_id:!id,parent_id:!parentIdentity,depth:depth===null,published_at:!publishedAt})[key]);
  return {identity:localIdentity,title:'Reddit comment',url:suppliedUrl||post.url,body,summary:'',publishedAt,author,sourceKind:'comment',platform:'reddit',platformId:id,parentIdentity,rootIdentity:post.identity,readLevel:'original',contentStatus:'full_text',rights:{aiAllowed:false,exportAllowed:false},metadata:{stream:'reddit_comments',subreddit:pick(row,'community_name','subreddit')||post.metadata.subreddit,score:number(pick(row,'num_upvotes','upvotes','score')),observedAt:now.toISOString(),communityObservation:true,independentEvidence:false,structureComplete:Boolean(parentIdentity)&&depth!==null,missingContextFields:missing,identityBasis:id?'upstream_id':'local_content_fingerprint',urlKind:suppliedUrl&&urlId?'comment':'thread',depth,embedded,bodyMaxAgeHours:48}};
}

const highValue = post => Number(post.metadata.numComments||0)>=10 || Number(post.metadata.score||0)>=50 || post.body.length>=500 || /\b(ai|agent|agents|model|models|llm|mcp|tool|tools|gpt|claude|gemini|qwen|deepseek)\b/i.test(`${post.title} ${post.body}`);
const rank = post => Number(post.metadata.numComments||0)*1000+Number(post.metadata.score||0)*10+Math.min(post.body.length,5000);

export async function* collectReddit({channel,checkpoint={},signal,now=new Date(),env={},mode='sync',window,providerState,brightData,runLimits={}}){
  const c=configuration(channel),provider=env.REDDIT_ACQUISITION_PROVIDER||'brightdata';
  if(provider!=='brightdata')throw blocked('当前只支持 brightdata provider','AUTH_BLOCKED');
  if(!truthy(env.REDDIT_PAID_ACQUISITION_APPROVED))throw blocked('付费 Reddit acquisition 未明确批准','PAID_ACCESS_BLOCKED');
  if(!env.BRIGHTDATA_API_KEY)throw blocked('缺少 BRIGHTDATA_API_KEY','AUTH_BLOCKED');
  const subreddit=c.subreddit||c.name;if(!/^[A-Za-z0-9_]{2,40}$/.test(subreddit||''))throw blocked('subreddit 配置无效','AUTH_BLOCKED');
  const jobs=providerState?.load?.()||checkpoint.providerJobs||{},persist=(key,state)=>{jobs[key]=state;return providerState?.save?.(key,state)||jobs;};
  const postsPerSubreddit=bounded(runLimits.postsPerSubreddit??c.postsPerSubreddit,15,1,50),deepThreadsPerRun=bounded(runLimits.deepThreadsPerRun??c.deepThreadsPerRun,8,0,8),commentsPerThread=bounded(runLimits.commentsPerThread??c.commentsPerThread,40,0,40);
  const postRows=[{url:`https://www.reddit.com/r/${subreddit}/`,sort_by:'New'}];
  const postKey=`posts:${subreddit}`,postJob=await runBrightDataJob({apiKey:env.BRIGHTDATA_API_KEY,datasetId:BRIGHTDATA_DATASETS.redditPosts,rows:postRows,options:{discoverBy:'subreddit_url',limitPerInput:postsPerSubreddit,requestSalt:window?.windowEnd||now.toISOString()},jobKey:postKey,state:jobs[postKey],persist:state=>persist(postKey,state),signal,heartbeat:()=>{},client:brightData});
  const posts=[...new Map(postJob.records.map(row=>normalizePost(row,channel,now)).filter(Boolean).map(post=>[post.identity,post])).values()].sort((a,b)=>rank(b)-rank(a)||a.identity.localeCompare(b.identity)).slice(0,postsPerSubreddit);
  const eligibilityWindow=acquisitionWindow({mode,now,windowStart:window?.windowStart,windowEnd:window?.windowEnd});
  const windowPosts=gateAcquisitionItems(posts,eligibilityWindow);
  const eligible=windowPosts.items.filter(post=>classifyAiRelevance(post).relevance==='ai_relevant');
  const comments=[];
  await postJob.complete();
  let deep=eligible.filter(highValue).sort((a,b)=>rank(b)-rank(a)||a.identity.localeCompare(b.identity)).slice(0,commentsPerThread?deepThreadsPerRun:0).map(post=>({id:post.platformId,url:post.url,post}));
  if(providerState?.reserveThreads)deep=providerState.reserveThreads(deep,deepThreadsPerRun);
  for(const {post} of deep)for(const row of post.metadata.rawComments.slice(0,commentsPerThread)){const comment=normalizeComment(row,post,now,{embedded:true});if(comment)comments.push(comment);}
  for(const post of posts)delete post.metadata.rawComments;
  let commentSnapshotId=null;
  if(deep.length){
    const rows=deep.map(thread=>({url:thread.url,days_back:mode==='backfill'?Math.max(1,Number(c.backfillDays||7)):1})),commentKey=`comments:${subreddit}`;
    const commentJob=await runBrightDataJob({apiKey:env.BRIGHTDATA_API_KEY,datasetId:BRIGHTDATA_DATASETS.redditComments,rows,options:{limitPerInput:commentsPerThread,requestSalt:`${window?.windowEnd||now.toISOString()}:${deep.map(x=>x.id).sort().join(',')}`},jobKey:commentKey,state:(providerState?.load?.()||jobs)[commentKey],persist:state=>persist(commentKey,state),signal,heartbeat:()=>{},client:brightData});
    commentSnapshotId=commentJob.state.snapshotId;
    const byUrl=new Map(deep.map(item=>[cleanUrl(item.url),item.post])),byId=new Map(deep.map(item=>[String(item.id).replace(/^t3_/,''),item.post])),counts=new Map();
    for(const row of commentJob.records){const post=byUrl.get(cleanUrl(pick(row,'post_url','url'))) || byId.get(String(pick(row,'post_id')||cleanUrl(pick(row,'post_url','url')).match(/\/comments\/([^/]+)/)?.[1]||'').replace(/^t3_/,''));if(!post)continue;const count=counts.get(post.identity)||0;if(count>=commentsPerThread)continue;const comment=normalizeComment(row,post,now);if(comment){comments.push(comment);counts.set(post.identity,count+1);}}
    await commentJob.complete();
  }
  const commentCounts=new Map();
  const uniqueComments=gateAcquisitionItems([...new Map(comments.map(comment=>[comment.identity,comment])).values()],eligibilityWindow).items.filter(comment=>{const count=commentCounts.get(comment.rootIdentity)||0;if(count>=commentsPerThread)return false;commentCounts.set(comment.rootIdentity,count+1);return true;});
  const providerJobs=providerState?.load?.()||{};
  yield {items:[...posts,...uniqueComments],checkpoint:{...checkpoint,providerJobs,completedAt:now.toISOString()},partition:'default',outcome:posts.length||uniqueComments.length?'success':'no_new',coverage:{provider:'brightdata',postSnapshotId:postJob.state.snapshotId,commentSnapshotId,posts:posts.length,comments:uniqueComments.length,deepThreads:deep.length,commentEligibility:{outsideWindow:windowPosts.stats.outsideWindow,unknownTimestamp:windowPosts.stats.unknownTimestamp,notConfirmedAi:windowPosts.items.length-eligible.length},hasMore:false,costGuard:{approved:true,postsPerSubreddit,deepThreads:deepThreadsPerRun,commentsPerThread}}};
}

export const redditNormalization={normalizePost,normalizeComment,highValue};
