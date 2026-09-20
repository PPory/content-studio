// Read-only endpoint audit. Does not activate connectors or write business data.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertPublicArticleUrl } from '../server/lib/article.mjs';
import { proxyFetch } from '../server/lib/fetch.mjs';
import { parseChannelFeed } from '../server/domain/intelligence-channels.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const manifest=JSON.parse(await fs.readFile(path.join(root,'workbench/config/acquisition-v3/source-manifest.json'),'utf8'));
const inventory=JSON.parse(await fs.readFile(path.join(root,'workbench/config/acquisition-v3/source-inventory.original.json'),'utf8'));
const results=process.argv[2]==='supplement'?JSON.parse(await fs.readFile(path.join(root,'output/acquisition/source-validation.json'),'utf8')).results:[];
const env={node:process.version,platform:process.platform,proxyConfigured:Boolean(process.env.HTTPS_PROXY||process.env.https_proxy),credentialsUsed:false};
async function request(url){
 const signal=AbortSignal.timeout(25000); let target=url;
 for(let redirects=0;redirects<5;redirects++){
  await assertPublicArticleUrl(target);
  const r=await proxyFetch(target,{signal,redirect:'manual',headers:{'user-agent':'ContentStudio-SourceAudit/3.0','accept':'application/json,application/rss+xml,application/atom+xml,text/html'}});
  if(r.status>=300&&r.status<400&&r.headers.get('location')){await r.body?.cancel();target=new URL(r.headers.get('location'),target).href;continue;}
  const chunks=[];let bytes=0;
  for await(const chunk of r.body){bytes+=chunk.length;if(bytes>12_000_000)throw Error('response exceeds 12 MB audit bound');chunks.push(chunk);}
  return {http:r.status,finalUrl:target,contentType:r.headers.get('content-type'),body:Buffer.concat(chunks).toString('utf8')};
 }
 throw Error('redirect budget exceeded');
}
function shape(value,depth=0){if(Array.isArray(value))return {type:'array',count:value.length,...(value.length&&depth<2?{sample:shape(value[0],depth+1)}:{})};if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,35).map(([k,v])=>[k,depth<2?shape(v,depth+1):typeof v]));return {type:typeof value,...(typeof value==='string'?{length:value.length}:{})};}
async function probe(key,url,type='rss',extra={}){
 const row={key,url,checkedAt:new Date().toISOString(),env,inputRefs:[],access:'public_endpoint_only_rights_not_granted',missing:['fulltext_reuse_rights_review'],...extra};results.push(row);
 try{const r=await request(url);Object.assign(row,{http:r.http,finalUrl:r.finalUrl,contentType:r.contentType,bytes:Buffer.byteLength(r.body),sha256:createHash('sha256').update(r.body).digest('hex')});if(r.http!==200){row.status='http_error';return;}
  if(type==='rss'){const items=parseChannelFeed(r.body,{format:'rss',url:r.finalUrl});row.schema={kind:'rss_or_atom',itemCount:items.length,sampleUrl:items[0]?.url};row.status='endpoint_parsed';}
  else if(type==='json'){const value=JSON.parse(r.body);row.schema=shape(value);row.status='endpoint_parsed';row.contractSummary={};if(value.items?.[0])row.contractSummary.itemShape=shape(value.items[0]);if(value.report)row.contractSummary.reportShape=shape(value.report);if(value.x?.[0]?.tweets?.[0])row.contractSummary.tweetShape=shape(value.x[0].tweets[0]);if(value.seenTweets)row.contractSummary.stateCounts=Object.fromEntries(['seenTweets','seenVideos','seenArticles'].map(k=>[k,Object.keys(value[k]||{}).length]));return value;}
  else {row.schema={alternateLinks:[...r.body.matchAll(/<link\b[^>]*>/gi)].map(x=>x[0]).filter(x=>/alternate/i.test(x)&&/rss|atom/i.test(x)).slice(0,10)};row.status='homepage_read';}
 }catch(e){row.status='failed';row.error=e.message;}
 finally{console.log(key,row.status,row.http||'');await save();}
}
async function save(){for(const r of results){r.http??=null;r.schema??=null;r.access??='not_activated';r.missing??=[];r.inputRefs??=[];if(!r.inputRefs.length&&r.key.startsWith('community.'))r.inputRefs=manifest.communityInputRowMap.filter(m=>m.logicalTargets.some(t=>t===r.key||t.startsWith(r.key.split('.').slice(0,2).join('.')+'.'))).map(m=>m.inputRef);}await fs.mkdir(path.join(root,'output/acquisition'),{recursive:true});await fs.writeFile(path.join(root,'output/acquisition/source-validation.json'),JSON.stringify({checkedAt:new Date().toISOString(),purpose:'read_only_live_probe_not_deployment',results,originalCoverage:inventory.map(f=>({file:f.file,sheets:f.sheets.map(s=>({sheet:s.name,rows:s.rows.filter(r=>r.row>1).map(r=>({row:r.row,values:r.values,mapping:f.file==='社区.xlsx'?manifest.communityInputRowMap.find(m=>m.inputRef.row===r.row):manifest.groups.find(g=>g.key==='t2_media').sources.filter(x=>x.inputRef.row===r.row).map(x=>x.stableKey)}))}))}))},null,2));}
const only=process.argv[2]||'all';
if(only==='supplement'){
 for(const s of manifest.groups.find(g=>g.key==='t2_media').sources.filter(s=>['t2.techcrunch_ai','t2.mit_technology_review_ai','t2.import_ai'].includes(s.stableKey)))await probe(s.stableKey+'.after_dns_fix',s.candidateEndpoint,'rss',{inputRefs:[s.inputRef],retestOf:s.stableKey});
 const parent='0dbf5a4feafbd386cc239960d673e3195909d7b0';
 const blogs=await probe('follow_builders.blogs.parent_contract',`https://raw.githubusercontent.com/zarazhangrui/follow-builders/${parent}/feed-blogs.json`,'json',{commit:parent});
 if(blogs?.blogs?.[0])results.at(-1).contractSummary.blogShape=shape(blogs.blogs[0]);

 await probe('t2.the_verge_ai.official_alternate','https://www.theverge.com/rss/index.xml','rss',{candidateOnly:true,evidence:'homepage rel=alternate',scopeDifference:'entire publication, not AI-only'});
 for(const u of ['https://www.jiqizhixin.com/rss','https://36kr.com/feed','https://36kr.com/feed-article','https://36kr.com/feed-newsflash'])await probe('media.non_feed_diagnosis',u,'html',{candidateOnly:true});
 const hot=await probe('aihot.hot_topics.contract_detail','https://aihot.news/api/v1/hot-topics','json');
 if(hot?.items?.[0])results.at(-1).contractSummary.publicReference={id:hot.items[0].id,links:hot.items[0].links,source:hot.items[0].source};
 const sha='e062f01a3dd8a32505169a5b9765707f5895a6e1';
 for(const f of ['feed-x.json','state-feed.json'])await probe('follow_builders.contract_detail.'+f,`https://raw.githubusercontent.com/zarazhangrui/follow-builders/${sha}/${f}`,'json',{commit:sha});
}

if(only==='all'||only==='media')for(const s of manifest.groups.find(g=>g.key==='t2_media').sources){await probe(s.stableKey,s.candidateEndpoint,'rss',{inputRefs:[s.inputRef]});if(results.at(-1).status!=='endpoint_parsed'){await probe(s.stableKey+'.homepage',new URL(s.candidateEndpoint).origin,'html',{inputRefs:[s.inputRef],candidateOnly:true});for(const f of s.fallbackCandidates)await probe(s.stableKey+'.candidate',f.endpoint,'rss',{candidateOnly:true,inputRefs:[s.inputRef]});}}
if(only==='all'||only==='community')for(const p of manifest.groups.find(g=>g.key==='community').platforms){
 if(p.key==='reddit'){for(const s of p.sources)results.push({key:s.stableKey,checkedAt:new Date().toISOString(),env,http:null,schema:null,access:'blocked',status:'blocked',missing:['approved_reddit_application','oauth_credentials','permitted_retention_and_external_ai_processing'],inputRefs:[s.inputRef],anonymousProbeAttempted:false});continue;}
 if(p.feeds)for(const f of p.feeds)await probe(`community.${p.key}.${f.key}`,f.candidateEndpoint);
 if(p.categories)for(const c of p.categories)await probe(`community.${p.key}.${c.key}`,c.candidateEndpoint);
 if(p.key==='github')for(const topic of p.topics)await probe(`community.github.${topic}`,`https://api.github.com/search/repositories?q=${encodeURIComponent('topic:'+topic)}&sort=updated&per_page=1`,'json',{missing:['authenticated_quota_optional','search_window_completeness_not_tested']});
 if(p.tags)for(const tag of p.tags)for(const sort of p.sorts||[''])await probe(`community.${p.key}.${tag}${sort?'.'+sort:''}`,p.candidateEndpointTemplate.replace('{tag}',tag).replace('{sort}',sort));
 for(const c of p.disabledCandidates||[])results.push({key:`community.${p.key}.${c.key}`,status:'disabled_candidate',url:c.candidateEndpoint,missing:[c.reason],checkedAt:new Date().toISOString(),env});
 if(p.fullSiteFeed)results.push({key:'community.devto.full_site',status:'disabled_candidate',url:p.fullSiteFeed.candidateEndpoint,checkedAt:new Date().toISOString(),env});
}
if(only==='all'||only==='aihot'){
 const selected=await probe('aihot.selected','https://aihot.news/api/v1/selected/snapshot?limit=1','json');
 const cursor=selected?.cursor||selected?.data?.cursor||selected?.nextCursor;
 if(cursor)await probe('aihot.selected.changes',`https://aihot.news/api/v1/selected/changes?cursor=${encodeURIComponent(cursor)}&limit=1`,'json');
 await probe('aihot.hot_topics','https://aihot.news/api/v1/hot-topics','json');
 await probe('aihot.dailies.index','https://aihot.news/api/v1/dailies?limit=1','json');
 await probe('aihot.dailies.latest','https://aihot.news/api/v1/dailies/latest','json');
}
if(only==='all'||only==='follow'){
 const group=manifest.groups.find(g=>g.key==='follow_builders'),sha='e062f01a3dd8a32505169a5b9765707f5895a6e1';
 for(const artifact of [...group.artifacts,{path:group.referenceCatalogPath}]){
  const value=await probe('follow_builders.'+artifact.path,`https://raw.githubusercontent.com/${group.repository}/${sha}/${artifact.path}`,'json',{commit:sha,missing:['upstream_content_reuse_rights_review','history_replay_not_tested']});
  if(value){const row=results.at(-1);row.generatedAt=value.generatedAt??null;row.upstreamErrors=value.errors??null;row.fieldLengths=[];const visit=(v,p='')=>{if(Array.isArray(v))v.forEach((x,i)=>visit(x,p+'['+i+']'));else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(typeof x==='string'&&/transcript|content|text|body/i.test(k)&&x.length>500)row.fieldLengths.push({path:p+'.'+k,length:x.length});else if(x&&typeof x==='object')visit(x,p+'.'+k);}};visit(value);await save();}
 }
}
await save();
