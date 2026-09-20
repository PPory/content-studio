// Explicit operator acceptance. Runs the existing pipeline; never schedules or
// grants ongoing paid/model permissions. Do not run without the stated approval.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadEnv } from 'vite';
import Database from 'better-sqlite3';
import { resolveWorkspacePaths } from '../server/storage/workspace-paths.mjs';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { enqueueAcquisition, acquisitionHandlers } from '../server/acquisition/runner.mjs';
import { LocalJobRunner } from '../server/jobs/local-job-runner.mjs';
import { sourceFromRow } from '../server/domain/intelligence-quality.mjs';
import { processingHash } from '../server/acquisition/relevance.mjs';
import { processReview, materialProjection, reviewOverview } from '../server/acquisition/review.mjs';
import { acquisitionCatalog } from '../server/acquisition/catalog.mjs';
import { createUlid } from '../server/storage/ids.mjs';
import { batchOverview, finishAcquisitionBatches } from '../server/acquisition/batches.mjs';

const args=process.argv.slice(2), phase=args.find(x=>x.startsWith('--phase='))?.slice(8)||'report';
if(!args.includes('--confirmed'))throw Error('Requires explicit confirmation of local persistence and public source fetching.');
const env={...loadEnv('development',process.cwd(),''),...process.env},paths=resolveWorkspacePaths({env});
const output=path.resolve('../output/acquisition/source-delivery-acceptance.json');
let report;try{report=JSON.parse(await fs.readFile(output,'utf8'));}catch{report={startedAt:new Date().toISOString(),phases:{}};}
if(phase==='reddit'&&report.phases.reddit?.runs?.some(r=>r.coverage?.postSnapshotId))throw Error('This one-run paid sample already exists. Reuse its saved snapshot; do not create another paid job.');
const read=new Database(paths.databaseFile,{readonly:true,fileMustExist:true});
const backup=path.join(paths.backupsDir,'Migration-Points',`before-source-delivery-${phase}-${Date.now()}.sqlite`);
await fs.mkdir(path.dirname(backup),{recursive:true});await read.backup(backup);read.close();
await fs.writeFile(backup+'.json',JSON.stringify({sha256:createHash('sha256').update(await fs.readFile(backup)).digest('hex'),at:new Date().toISOString(),phase}));
const w=await openWorkspace({xenhoHome:paths.root});
const save=async()=>{await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));};
const run=async(runs,dependencies={},runEnv=env)=>{
 const runner=new LocalJobRunner(w.jobs,{handlers:acquisitionHandlers(w,runEnv,dependencies)});
 // Only these exact jobs, once each; no follow-up jobs, retries, or scheduler.
 const results=[];
 for(const item of runs){
  const result=await runner.runNext({leaseOwner:'source-delivery-acceptance',allowedJobIds:[item.job_id]});
  const row=w.db.prepare('SELECT * FROM acquisition_runs WHERE id=?').get(item.id);
  results.push({runId:item.id,channelId:row.channel_id,status:row.health_status,error:row.error,stats:JSON.parse(row.stats_json),coverage:JSON.parse(row.coverage_json),jobStatus:result?.status});
  console.log(JSON.stringify(results.at(-1)));
  report.phases[phase].runs=results;await save();
 }
 return results;
};
try{
 if(report.phases[phase]){report.phaseHistory ||= [];report.phaseHistory.push({phase,...report.phases[phase]});}
 report.phases[phase]={startedAt:new Date().toISOString(),recoveryPoint:backup};await save();
 if(phase==='sources'){
  const actual=acquisitionCatalog().find(c=>c.key==='t2.the_verge_ai');
  // Only replace the specifically verified obsolete URL, never a custom URL.
  w.db.prepare('UPDATE intel_channels SET url=? WHERE stable_key=? AND url=?').run(actual.endpoint,actual.key,'https://www.theverge.com/ai-artificial-intelligence/rss/index.xml');
  const channels=w.db.prepare("SELECT * FROM intel_channels WHERE source_group IN ('aihot','follow_builders','t2_media','community') AND desired_enabled=1 AND user_disabled=0 AND platform<>'reddit' ORDER BY source_group,name").all();
  const id=createUlid(),at=new Date().toISOString(),start=new Date(Date.now()-86400000).toISOString();
  w.db.prepare('INSERT INTO acquisition_batches(id,trigger_kind,started_at,channel_count,window_start_at,window_end_at) VALUES(?,?,?,?,?,?)').run(id,'delivery_acceptance',at,channels.length,start,at);
  report.phases[phase].batchId=id;
  await run(channels.map(c=>enqueueAcquisition(w,c.id,{trigger:'delivery_acceptance',slot:`delivery:${id}`,batchId:id,explicit:true,windowStartAt:start,windowEndAt:at})));
  finishAcquisitionBatches(w);report.phases[phase].batch=batchOverview(w,id).batch;
 }
 if(phase==='resume'){
  const batchId=report.phases.sources.batchId;
  const runs=w.db.prepare("SELECT r.* FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id WHERE r.batch_id=? AND j.status IN ('queued','retry','running') ORDER BY r.created_at").all(batchId);
  await run(runs);finishAcquisitionBatches(w);report.phases.sources.batch=batchOverview(w,batchId).batch;
 }
 if(phase==='reddit'){
  if(!args.includes('--allow-reddit'))throw Error('This phase requires the one-run 5 posts / 1 thread / 20 comments approval.');
  const channel=w.db.prepare("SELECT id FROM intel_channels WHERE stable_key='community.reddit.localllama' AND user_disabled=0").get();
  if(!channel)throw Error('Existing LocalLLaMA source unavailable or paused.');
  const at=new Date().toISOString(),start=new Date(Date.now()-86400000).toISOString();
  await run([enqueueAcquisition(w,channel.id,{trigger:'delivery_sample',slot:`delivery-reddit:${at}`,explicit:true,windowStartAt:start,windowEndAt:at})],{oneRunPaidApproval:true,runLimits:{postsPerSubreddit:5,deepThreadsPerRun:1,commentsPerThread:20}}, {...env,REDDIT_PAID_ACQUISITION_APPROVED:'true',REDDIT_ACQUISITION_PROVIDER:'brightdata'});
 }
 if(phase==='fulltext'){
  const ids=(args.find(x=>x.startsWith('--ids='))?.slice(6)||'').split(',').filter(Boolean);
  if(!ids.length||ids.length>12)throw Error('Specify 1-12 existing public material IDs.');
  const sources=ids.map(id=>w.db.prepare('SELECT * FROM intel_sources WHERE id=? AND deleted_at IS NULL').get(id));
  if(sources.some(s=>!s||sourceFromRow(s).platform==='reddit'))throw Error('Missing or restricted material.');
  const authorizedFulltextSources=new Map(sources.map(s=>[s.id,sourceFromRow(s).url]));
  await run(sources.map(s=>enqueueAcquisition(w,s.channel_id,{mode:'fulltext',trigger:'delivery_acceptance',sourceId:s.id,slot:`delivery-body:${s.id}:${Date.now()}`})),{authorizedFulltextSources});
 }
 if(phase==='semantic'){
  if(!args.includes('--allow-ai'))throw Error('Requires one-run approval for up to eight selected public non-Reddit materials.');
  const ids=(args.find(x=>x.startsWith('--ids='))?.slice(6)||'').split(',').filter(Boolean);
  if(!ids.length||ids.length>8)throw Error('Specify 1-8 selected material IDs.');
  const sources=ids.map(id=>w.db.prepare('SELECT * FROM intel_sources WHERE id=? AND deleted_at IS NULL').get(id)).map(r=>r&&sourceFromRow(r));
  if(sources.some(s=>!s||s.platform==='reddit'||s.originKind!=='external'))throw Error('Missing or restricted material.');
  const authorizedSources=new Map(sources.map(s=>[s.id,processingHash(s)]));
  report.phases[phase].grants=sources.map(s=>({id:s.id,title:s.title,url:s.url,contentHash:processingHash(s),scope:'one-run classification, grounded guide, event grouping',expires:'end of this process'}));await save();
  const result=await processReview(w,env,{confirmed:true,semantic:true,sourceIds:ids},{authorizedSources});
  report.phases[phase].result={modelCalls:result.modelCalls,stats:result.stats};
 }
 if(phase==='report')await processReview(w,env,{confirmed:true,semantic:false});
 const materials=materialProjection(w);
 report.phases[phase].finishedAt=new Date().toISOString();
 report.stats=reviewOverview(w).stats;
 report.channels=w.db.prepare("SELECT stable_key,name,url,platform,desired_enabled,user_disabled,health,last_error,last_success_at FROM intel_channels WHERE source_group IN ('aihot','follow_builders','t2_media','community') ORDER BY source_group,name").all();
 report.samples=materials.filter(s=>s.processing.method==='semantic'||s.discoveries.some(d=>d.sourceGroup==='follow_builders')).map(s=>({id:s.id,title:s.title,publisher:s.publisher,url:s.url,publishedAt:s.publishedAt,firstSeenAt:s.firstSeenAt,upstreamFirstSeenAt:s.upstreamFirstSeenAt,bodyCharacters:s.body.length,processing:{...s.processing,readingBody:undefined},discoveries:s.discoveries.map(d=>({channelName:d.channelName,stream:d.stream})),clusterId:w.db.prepare('SELECT cluster_id FROM acquisition_review_members WHERE source_id=?').get(s.id)?.cluster_id}));
 report.eventClusters=reviewOverview(w,{scope:'events',limit:50}).clusters.filter(c=>c.relationship==='same_event').map(c=>({id:c.id,title:c.title,connection:c.connection,items:c.items.map(s=>({id:s.id,title:s.title,url:s.url,publisher:s.publisher}))}));
 await save();console.log(JSON.stringify({phase,output,stats:report.stats}));
}finally{w.close();}
