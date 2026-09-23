import { createUlid } from '../storage/ids.mjs';
import { sourceFromRow } from '../domain/intelligence-quality.mjs';
import { enqueueAcquisition } from './runner.mjs';
import { acquisitionWindow, mergeAcquisitionStats } from './window.mjs';
import { POOL_CHANNEL_SQL, MAX_BACKFILL_MS, REDDIT_MIN_INTERVAL_MS } from '../domain/intelligence-pool.mjs';
const empty=()=>({fetched:0,inWindow:0,outsideWindow:0,unknownTimestamp:0,limited:0,inserted:0,updated:0,duplicate:0,failed:0,deepRead:0});
const names={'aihot:selected':'AIHOT Selected','aihot:hot':'AIHOT Hot','aihot:daily':'AIHOT Daily','follow_builders:feed-x.json':'Follow Builders X','follow_builders:feed-podcasts.json':'Follow Builders Podcast','follow_builders:feed-blogs.json':'Follow Builders Blog','follow_builders:state-feed.json':'Follow Builders State','t2_media:feed':'T2 Media','community:hacker_news':'Hacker News','community:reddit_posts':'Reddit Posts','community:reddit_comments':'Reddit Comments','community:github':'GitHub','community:arxiv':'arXiv','community:stackoverflow':'Stack Overflow','community:devto':'Dev.to'};
function streamKey(group,platform,stream,kind){return `${group}:${group==='community'?platform==='reddit'?kind==='comment'?'reddit_comments':'reddit_posts':platform:stream}`;}
/**
 * 每个频道从上次成功覆盖的终点接着采（留 2 小时重叠应对上游延迟），最多回溯 7 天，至少覆盖 24 小时。
 * 几天没开应用时，窗口外的新内容不会再被当作「超出窗口」丢掉。
 */
function channelWindowStart(w,channelId,window){
 const end=Date.parse(window.windowEnd),floor=end-MAX_BACKFILL_MS,base=Date.parse(window.windowStart);
 const last=w.db.prepare("SELECT max(window_end_at) at FROM acquisition_runs WHERE channel_id=? AND status='completed' AND kind IN ('sync','backfill')").get(channelId)?.at;
 if(!last)return window.windowStart;
 return new Date(Math.max(floor,Math.min(base,Date.parse(last)-2*3600000))).toISOString();
}
export function startAcquisitionBatch(w,{confirmed,trigger='manual'}={}) {
 if(confirmed!==true)throw Object.assign(new Error('请确认同步现有来源并保存真实资料'),{status:400});
 return w.db.transaction(()=>{
 const active=w.db.prepare("SELECT b.id FROM acquisition_batches b JOIN acquisition_runs r ON r.batch_id=b.id JOIN local_jobs j ON j.id=r.job_id WHERE j.status IN ('queued','retry','running') ORDER BY b.started_at DESC LIMIT 1").get();
 if(active)return batchOverview(w,active.id).batch;
 // 只调度情报池：arXiv、GitHub、dev.to 等频道保留配置，但不再随「更新情报」采集。
 // Reddit 排在最后：任务串行执行，它每个社区要等 Bright Data 快照几分钟，排前面会堵住其它信源。
 const recent=Date.now()-REDDIT_MIN_INTERVAL_MS;
 const channels=w.db.prepare(`SELECT * FROM intel_channels WHERE ${POOL_CHANNEL_SQL} AND desired_enabled=1 AND user_disabled=0 ORDER BY platform='reddit',source_group,name`).all()
  // Reddit 按条计费：一天只跑一次，手动点也一样；因授权缺失被拦的不算跑过。
  .filter(c=>c.platform!=='reddit'||!w.db.prepare("SELECT id FROM acquisition_runs WHERE channel_id=? AND kind IN ('sync','validate') AND status IN ('completed','failed','running','queued') AND COALESCE(started_at,created_at)>=?").get(c.id,new Date(recent).toISOString()));
 const id=createUlid(),at=new Date().toISOString(),window=acquisitionWindow({mode:'sync',now:new Date(at)});w.db.prepare('INSERT INTO acquisition_batches(id,trigger_kind,started_at,channel_count,window_start_at,window_end_at) VALUES(?,?,?,?,?,?)').run(id,trigger,at,channels.length,window.windowStart,window.windowEnd);
 for(const c of channels)enqueueAcquisition(w,c.id,{trigger,slot:`batch:${id}`,batchId:id,explicit:true,windowStartAt:channelWindowStart(w,c.id,window),windowEndAt:window.windowEnd});
 return batchOverview(w,id).batch;
 })();
}
export function batchOverview(w,id='latest',{offset=0,limit=60,group='',stream='',changesOnly='false'}={}) {
 const b=id==='latest'?w.db.prepare('SELECT * FROM acquisition_batches ORDER BY started_at DESC LIMIT 1').get():w.db.prepare('SELECT * FROM acquisition_batches WHERE id=?').get(id);
 if(!b)return {batch:null,items:[],total:0,nextOffset:null};
 const runs=w.db.prepare('SELECT r.*,j.status job_status,j.last_error job_error,j.due_at,c.name,c.source_group,c.platform,c.stream,c.stable_key FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id JOIN intel_channels c ON c.id=r.channel_id WHERE r.batch_id=? ORDER BY r.created_at').all(b.id);
 const rows=w.db.prepare('SELECT i.*,r.channel_id,r.started_at,r.finished_at,c.name,c.source_group,c.platform,c.stream channel_stream FROM acquisition_run_items i JOIN acquisition_runs r ON r.id=i.run_id JOIN intel_channels c ON c.id=r.channel_id WHERE r.batch_id=? ORDER BY i.observed_at DESC').all(b.id);
 const channels=new Map(),streams=new Map(Object.entries(names).map(([key,label])=>[key,{key,label,sourceGroup:key.split(':')[0],status:'NO_NEW_ITEMS',stats:empty()}]));
 for(const r of runs){const coverage=JSON.parse(r.coverage_json),runStats=JSON.parse(r.stats_json);let c=channels.get(r.channel_id);if(!c){c={id:r.channel_id,name:r.name,key:r.stable_key,sourceGroup:r.source_group,platform:r.platform,stream:r.stream,startedAt:r.started_at,finishedAt:r.finished_at,status:r.health_status||(r.job_status==='failed'?'SOURCE_UNAVAILABLE':'RUNNING'),error:r.error||r.job_error||'',stats:empty(),runs:[]};channels.set(c.id,c);}mergeAcquisitionStats(c.stats,runStats);c.runs.push({id:r.id,status:r.job_status,healthStatus:r.health_status,error:r.error||r.job_error||'',dueAt:r.due_at,coverage,windowStart:r.window_start_at,windowEnd:r.window_end_at});c.status=r.health_status||(r.job_status==='failed'?'SOURCE_UNAVAILABLE':'RUNNING');c.error=r.error||r.job_error||'';c.finishedAt=r.finished_at;
  for(const [sub,values] of Object.entries(coverage.streamStats||{})){const key=r.source_group==='follow_builders'?`follow_builders:${sub}`:r.platform==='reddit'?`community:${sub.startsWith('reddit_')?sub:'reddit_posts'}`:streamKey(r.source_group,r.platform,r.stream);const target=streams.get(key);if(target)mergeAcquisitionStats(target.stats,values);}
  if(['failed','blocked'].includes(r.status)&&!['queued','retry','running'].includes(r.job_status))c.stats.failed=Math.max(1,c.stats.failed);
 }
 for(const row of rows){const s=w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(row.source_id);const key=streamKey(row.source_group,row.platform,row.stream,s.source_kind);const target=streams.get(key);if(target)target.stats[row.outcome]++;}
 for(const c of channels.values()){
  c.stats.failed=['OK','NO_NEW_ITEMS','RUNNING'].includes(c.status)?c.stats.failed:Math.max(1,c.stats.failed);
  if(['OK','NO_NEW_ITEMS'].includes(c.status))c.status=c.stats.inserted||c.stats.updated?'OK':'NO_NEW_ITEMS';
  const keys=c.sourceGroup==='follow_builders'?Object.keys(names).filter(k=>k.startsWith('follow_builders:')):c.platform==='reddit'?['community:reddit_posts','community:reddit_comments']:[streamKey(c.sourceGroup,c.platform,c.stream)];
  for(const key of keys){const t=streams.get(key);if(!t)continue;if(c.stats.failed){t.stats.failed+=c.stats.failed;t.status=c.status;}else if(['RUNNING','RATE_LIMITED','TIMEOUT','PARSE_FAILED','SOURCE_UNAVAILABLE','AUTH_BLOCKED','STALE_UPSTREAM'].includes(c.status))t.status=c.status;else if(t.stats.inserted||t.stats.updated)t.status='OK';}
  if(c.sourceGroup==='follow_builders')for(const run of c.runs){for(const [file,state] of Object.entries(run.coverage.streams||{})){const t=streams.get(`follow_builders:${file}`);if(t){t.upstreamUpdatedAt=state.generatedAt;t.upstreamCount=state.count??null;if(state.errors?.length){t.status='STALE_UPSTREAM';t.error=state.errors.join('; ');}else if(file==='state-feed.json')t.status='OK';}}}
 }
 for(const c of channels.values()){const unchanged=c.runs.some(r=>r.coverage.unchanged||r.coverage.upstreamUnchanged);c.reason=c.stats.failed?(c.status==='AUTH_BLOCKED'?'权限受限':'请求失败'):unchanged?'上游未变，已有未审阅内容仍可阅读':c.stats.duplicate&&!c.stats.inserted&&!c.stats.updated?'取得内容全部重复':c.stats.outsideWindow&&!c.stats.inWindow?'超出24小时窗口，深读另列':'本次检查完成，无新增不等于来源没有内容';}
 const saved=w.db.prepare("SELECT DISTINCT s.id,s.source_kind,s.content_status,c.source_group,c.platform,COALESCE(json_extract(s.data_json,'$.metadata.stream'),c.stream) stream FROM intel_sources s JOIN source_discoveries d ON d.source_id=s.id JOIN intel_channels c ON c.id=d.channel_id WHERE s.deleted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>?)").all(new Date().toISOString());
 for(const t of streams.values()){
  const matching=[...channels.values()].filter(c=>c.sourceGroup===t.sourceGroup&&(c.sourceGroup!=='community'||t.key.includes(c.platform)));
  const owned=saved.filter(s=>streamKey(s.source_group,s.platform,s.stream,s.source_kind)===t.key);
  t.existingMaterials=new Set(owned.map(s=>s.id)).size;t.existingFulltext=new Set(owned.filter(s=>s.content_status==='full_text').map(s=>s.id)).size;
  if(!matching.length){t.status='NOT_RUN';t.reason='本批未执行此来源；已有资料与单独运行结果另列。';}
  else if(matching.some(c=>c.runs.some(r=>r.coverage.upstreamUnchanged||r.coverage.unchanged)))t.reason='上游未变，本轮无新增仍可阅读已有资料。';
 }
 for(const t of streams.values())if(t.stats.failed&&['OK','NO_NEW_ITEMS'].includes(t.status))t.status='SOURCE_UNAVAILABLE';
 const stats=empty();for(const c of channels.values())for(const key of Object.keys(stats))stats[key]+=c.stats[key];
 const pending=runs.some(r=>['queued','retry','running'].includes(r.job_status)),finishedAt=pending?null:runs.map(r=>r.finished_at).filter(Boolean).sort().at(-1)||b.started_at;
 const status=pending?'running':stats.failed?'partial':'completed';
 const seen=new Set(),items=[];
 for(const row of rows){if(changesOnly!=='false'&&row.outcome==='duplicate')continue;if(group&&row.source_group!==group||stream&&stream!==streamKey(row.source_group,row.platform,row.stream,w.db.prepare('SELECT source_kind FROM intel_sources WHERE id=?').get(row.source_id).source_kind))continue;if(seen.has(row.source_id))continue;seen.add(row.source_id);const raw=w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(row.source_id),source=sourceFromRow(raw);items.push({...source,body:source.body?.slice(0,500)||'',bodyLength:source.body?.length||0,sourceGroup:row.source_group,channelName:row.name,stream:row.stream,firstSeenAt:raw.created_at,lastSeenAt:row.observed_at,runId:row.run_id,dedupResult:row.outcome});}
 offset=Math.max(0,Number(offset)||0);limit=Math.min(200,Math.max(1,Number(limit)||60));
 return {batch:{id:b.id,trigger:b.trigger_kind,startedAt:b.started_at,finishedAt,windowStart:b.window_start_at,windowEnd:b.window_end_at,durationMs:(finishedAt?Date.parse(finishedAt):Date.now())-Date.parse(b.started_at),status,channelCount:channels.size,stats,channels:[...channels.values()],streams:[...streams.values()]},items:items.slice(offset,offset+limit),total:items.length,nextOffset:offset+limit<items.length?offset+limit:null};
}
export function finishAcquisitionBatches(w){for(const b of w.db.prepare("SELECT id FROM acquisition_batches WHERE finished_at IS NULL").all()){const {batch}=batchOverview(w,b.id);if(batch.finishedAt)w.db.prepare('UPDATE acquisition_batches SET finished_at=?,status=? WHERE id=?').run(batch.finishedAt,batch.status,b.id);}}
