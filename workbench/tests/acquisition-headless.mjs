// LIVE acceptance of ONE public feed and the standalone worker; never a whole-catalog claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { getChannel } from '../server/acquisition/store.mjs';

const ROOT=path.resolve(import.meta.dirname,'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-acquisition-headless-'));
const home=path.join(temp,'Xenho'),key='t2.the_decoder';
let w,child,timer;
const report={checkedAt:new Date().toISOString(),type:'live_single_public_feed_headless_worker',channel:key,productionDatabaseModified:false,uiStarted:false,modelConfigured:false,scope:'One current public RSS feed; not full-catalog or historical completeness acceptance.',status:'not_run'};
try {
  w=await openWorkspace({xenhoHome:home});
  // Disable every catalog entry first. No implicit source expansion is permitted.
  w.db.prepare('UPDATE intel_channels SET enabled=0,desired_enabled=0,user_disabled=1,next_due_at=NULL').run();
  const channel=getChannel(w,key);
  assert.equal(channel.url,'https://the-decoder.com/feed/');
  w.db.prepare("UPDATE intel_channels SET enabled=1,desired_enabled=1,user_disabled=0,validation_status='verified',access_status='public_feed',next_due_at=NULL,options_json=? WHERE id=?").run(JSON.stringify({...channel.options,aiAllowed:false,exportAllowed:false,fulltextAllowed:false}),channel.id);
  report.endpoint=channel.url;
  w.close();w=null;
  // Launch from a clean cwd so worker loadEnv cannot load project .env model credentials.
  // Only proxy variables and basic process paths are inherited, never API tokens.
  const env={};
  for(const name of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','HTTPS_PROXY','HTTP_PROXY','https_proxy','http_proxy','NO_PROXY','no_proxy'])if(process.env[name])env[name]=process.env[name];
  Object.assign(env,{XENHO_HOME:home,ACQUISITION_AUTOSTART:'false',WB_KEEP_ALIVE:'1'});
  let stdout='',stderr='';
  const exited=await new Promise((resolve,reject)=>{
    child=spawn(process.execPath,[path.join(ROOT,'scripts','acquisition-worker.mjs'),'once'],{cwd:temp,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();});child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
    timer=setTimeout(()=>{child.kill();reject(new Error('Standalone worker exceeded 120-second acceptance deadline'));},120000);
    child.once('error',reject);child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});
  });
  report.process=exited;
  assert.equal(exited.code,0,`worker exit: ${stderr.slice(-1500)}`);
  w=await openWorkspace({xenhoHome:home});
  const runs=w.db.prepare('SELECT r.*,j.status job_status FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id').all();
  report.runs=runs.map(r=>({channelId:r.channel_id,status:r.status,jobStatus:r.job_status,outcome:r.outcome,error:r.error,stats:JSON.parse(r.stats_json),coverage:JSON.parse(r.coverage_json)}));
  assert(runs.length>0,'worker scheduled a run');
  assert(runs.every(r=>r.channel_id===channel.id),'worker must only run the selected source');
  assert(runs.some(r=>r.job_status==='done'||r.job_status==='completed'),`no completed job: ${JSON.stringify(report.runs)}`);
  const count=w.db.prepare('SELECT count(*) n FROM source_discoveries WHERE channel_id=?').get(channel.id).n;
  report.discoveries=count;
  assert(count>0,'real feed must produce stored source discoveries, not just HTTP success');
  assert.equal(w.db.prepare('SELECT count(*) n FROM intel_sources WHERE channel_id<>?').get(channel.id).n,0);
  assert.equal(w.db.prepare("SELECT count(*) n FROM local_jobs WHERE kind NOT LIKE 'acquisition.%'").get().n,0,'no AI or unrelated worker jobs');
  assert.deepEqual(w.db.pragma('foreign_key_check'),[]);
  report.status='passed';report.workerLog=stdout.trim().split('\n').filter(Boolean);
  console.log(`acquisition-headless: LIVE single-source worker passed; ${count} discoveries; no UI/model; no full-catalog claim`);
} catch(error) {report.status='failed';report.error=error.message;throw error;}
finally {
  clearTimeout(timer);if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('close',resolve));}
  w?.close();
  const output=path.resolve(ROOT,'..','output','acquisition');await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'headless-smoke.json'),JSON.stringify(report,null,2));
  const relative=path.relative(os.tmpdir(),temp);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(temp,{recursive:true,force:true});
}
