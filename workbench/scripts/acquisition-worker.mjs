import { loadEnv } from 'vite';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { runtimeXenhoHome } from '../server/storage/workspace-paths.mjs';
import { LocalJobRunner } from '../server/jobs/local-job-runner.mjs';
import { ACQUISITION_KINDS, acquisitionHandlers, scheduleAcquisition, enqueueAcquisition } from '../server/acquisition/runner.mjs';
import { acquisitionOverview } from '../server/acquisition/store.mjs';
import { setTimeout as pause } from 'node:timers/promises';

const env={...loadEnv('development',process.cwd(),''),...process.env};
const w=await openWorkspace({xenhoHome:runtimeXenhoHome(env)});
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
try {
 const action=process.argv[2]||'run',channel=process.argv[3];
 if(action==='status'){const overview=acquisitionOverview(w);console.log(JSON.stringify({channels:overview.channels.map(c=>({key:c.stable_key,enabled:c.enabled,validation:c.validation_status,access:c.access_status,error:c.last_error})),runs:overview.runs},null,2));}
 else if(['sync','validate','backfill'].includes(action)){
  if(!channel)throw new Error('请提供来源 stable key，例如 aihot.selected');
  console.log(JSON.stringify(enqueueAcquisition(w,channel,{mode:action})));
 } else if(action==='observe'){
  const runs=w.db.prepare('SELECT min(created_at) first,max(created_at) last,count(*) total FROM acquisition_runs').get();
  const days=runs.first?Math.floor((Date.now()-Date.parse(runs.first))/86400000):0;
  console.log(JSON.stringify({windowDays:days,sevenDayObservationComplete:days>=7,runs,uncompleted:'仍需检查各来源日覆盖、失败恢复、睡眠恢复和权限状态；运行时长不是验收通过'},null,2));
 } else if(['run','once'].includes(action)) {
  const handlers=acquisitionHandlers(w,env);
  let startup=true;
  do {
   scheduleAcquisition(w,{env,startup});startup=false;
   await Promise.all(Array.from({length:4},async(_,i)=>{
    const runner=new LocalJobRunner(w.jobs,{handlers});
    while(!stopping){const result=await runner.runNext({leaseOwner:`acquisition-${process.pid}-${i}`,allowedKinds:ACQUISITION_KINDS});if(!result)break;console.log(JSON.stringify({job:result.id,status:result.status}));}
   }));
   if(action==='once')break;
   await pause(1000);
  }while(!stopping);
 } else throw new Error('支持 run / once / status / observe / validate KEY / sync KEY / backfill KEY');
} finally {w.close();}
