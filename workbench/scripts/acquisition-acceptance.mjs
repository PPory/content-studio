import { loadEnv } from 'vite';
import fs from 'node:fs/promises';import path from 'node:path';import Database from 'better-sqlite3';import crypto from 'node:crypto';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { runtimeXenhoHome } from '../server/storage/workspace-paths.mjs';
import { LocalJobRunner } from '../server/jobs/local-job-runner.mjs';
import { acquisitionHandlers,ACQUISITION_KINDS,enqueueAcquisition } from '../server/acquisition/runner.mjs';
import { startAcquisitionBatch,batchOverview,finishAcquisitionBatches } from '../server/acquisition/batches.mjs';
const env={...loadEnv('development',process.cwd(),''),...process.env},home=runtimeXenhoHome(env);
if(process.argv[2]!=='--confirmed')throw Error('Pass --confirmed only after authorizing real acquisition into this workspace');
const file=path.join(home,'Workspace','workspace.sqlite');
const db=new Database(file,{readonly:true,fileMustExist:true});
const dir=path.join(home,'Backups','Migration-Points');await fs.mkdir(dir,{recursive:true});const backup=path.join(dir,`before-real-acquisition-${Date.now()}.sqlite`);await db.backup(backup);db.close();
const check=new Database(backup,{readonly:true});if(check.pragma('integrity_check',{simple:true})!=='ok')throw Error('Recovery integrity failed');check.close();await fs.writeFile(backup+'.json',JSON.stringify({sha256:crypto.createHash('sha256').update(await fs.readFile(backup)).digest('hex'),verifiedAt:new Date().toISOString()}));
const w=await openWorkspace({xenhoHome:home});let stop=false;process.on('SIGINT',()=>stop=true);
try{
 const previous=w.db.prepare('SELECT id FROM acquisition_batches ORDER BY started_at DESC LIMIT 1').get();
 if(previous)for(const r of w.db.prepare("SELECT r.channel_id FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id WHERE r.batch_id=? AND j.status='failed' AND (r.error LIKE '%同一来源正在请求%' OR r.error LIKE '%Unterminated%')").all(previous.id))enqueueAcquisition(w,r.channel_id,{batchId:previous.id,explicit:true,trigger:'contention_recovery',slot:`recovery:${Date.now()}:${r.channel_id}`});
 const batch=startAcquisitionBatch(w,{confirmed:true,trigger:'real_acceptance'});console.log(JSON.stringify({batchId:batch.id,channels:batch.channelCount,recoveryPoint:backup}));
 const handlers=acquisitionHandlers(w,env),deadline=Date.now()+20*60*1000;
 while(!stop&&Date.now()<deadline){
  await Promise.all(Array.from({length:1},async(_,i)=>{const runner=new LocalJobRunner(w.jobs,{handlers});let job;while(!stop&&Date.now()<deadline&&(job=await runner.runNext({allowedJobIds:w.db.prepare("SELECT j.id FROM local_jobs j JOIN acquisition_runs r ON r.job_id=j.id JOIN intel_channels c ON c.id=r.channel_id WHERE r.batch_id=? AND j.status IN ('queued','retry','running') AND j.due_at<=? AND (j.status<>'running' OR j.lease_expires_at<?) ORDER BY CASE c.source_group WHEN 'follow_builders' THEN 0 WHEN 'aihot' THEN 1 WHEN 't2_media' THEN 2 ELSE 3 END,CASE c.platform WHEN 'github' THEN 1 ELSE 0 END,j.due_at LIMIT 1").all(batch.id,new Date().toISOString(),new Date().toISOString()).map(r=>r.id),leaseOwner:`acceptance-${process.pid}-${i}`,allowedKinds:ACQUISITION_KINDS}))){console.log(JSON.stringify({job:job.id,status:job.status}));}}));
  finishAcquisitionBatches(w);const result=batchOverview(w,batch.id,{limit:200});
  await fs.mkdir('../output/acquisition',{recursive:true});await fs.writeFile('../output/acquisition/real-acceptance-run.json',JSON.stringify(result,null,2));
  if(result.batch.finishedAt)break;
  const next=w.db.prepare("SELECT min(j.due_at) due FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id WHERE r.batch_id=? AND j.status IN ('queued','retry')").get(batch.id)?.due;
  if(!next||Date.parse(next)-Date.now()>60000){console.log(JSON.stringify({deferredUntil:next,reason:'persistent retry retained; not claimed complete'}));break;}
  await new Promise(resolve=>setTimeout(resolve,Math.min(5000,Math.max(500,Date.parse(next)-Date.now()))));
 }
 console.log(JSON.stringify(batchOverview(w,batch.id).batch));
}finally{w.close();}
