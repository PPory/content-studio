import { errorStatus, successStatus } from './health.mjs';
import { collectAiHot } from './connectors/aihot.mjs';
import { collectFollowBuilders } from './connectors/follow-builders.mjs';
import { collectCommunity } from './connectors/community.mjs';
import { collectReddit } from './connectors/reddit.mjs';
import { acquisitionTransport, acquisitionError, validateTarget } from './transport.mjs';
import { assertLease, checkpointFor, cleanupAcquisition, commitPage, encode, getChannel, stamp } from './store.mjs';
import { createUlid } from '../storage/ids.mjs';
import { contentHash } from '../domain/intelligence-quality.mjs';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { xhtmlToMd } from '../lib/books.mjs';
import { junkReason } from '../lib/article.mjs';
import { acquisitionWindow, batchPlatformLimit, channelItemLimit, gateAcquisitionItems, mergeAcquisitionStats } from './window.mjs';

import { processLocalSource, ensureReviewClusters } from './review.mjs';
import { sourceFromRow } from '../domain/intelligence-quality.mjs';

export const ACQUISITION_KINDS=['acquisition.sync','acquisition.validate','acquisition.backfill','acquisition.fulltext','acquisition.revalidate'];
const connectors={aihot:collectAiHot,follow_builders:collectFollowBuilders,community:collectCommunity,reddit:collectReddit};
export function enqueueAcquisition(w,id,{mode='sync',trigger='manual',slot=stamp(),dueAt,sourceId,threadId,partition,continuation=0,batchId=null,explicit=false,windowStartAt=null,windowEndAt=null}={}) {
  const channel=getChannel(w,id),kind=`acquisition.${mode}`;
  if(!ACQUISITION_KINDS.includes(kind))throw acquisitionError('不支持的采集任务',{status:400});
  return w.db.transaction(()=>{
    const payload={channelId:channel.id,mode,sourceId:sourceId||null,threadId:threadId||null,partition:partition||'default',continuation,batchId,explicit,windowStartAt,windowEndAt};
    const key=`${kind}:${channel.id}:${slot}`;
    const {job}=w.jobs.enqueue({kind,idempotencyKey:key,payload,dueAt,maxAttempts:3});
    const id=createUlid();
    w.db.prepare('INSERT OR IGNORE INTO acquisition_runs(id,job_id,channel_id,kind,trigger_kind,scheduled_slot,created_at,window_start_at,window_end_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,job.id,channel.id,mode,trigger,slot,stamp(),windowStartAt,windowEndAt);
    if(batchId){w.db.prepare('UPDATE acquisition_runs SET batch_id=? WHERE job_id=?').run(batchId,job.id);w.db.prepare("UPDATE acquisition_batches SET finished_at=NULL,status='running' WHERE id=?").run(batchId);}
    return w.db.prepare('SELECT * FROM acquisition_runs WHERE job_id=?').get(job.id);
  })();
}
export function scheduleAcquisition(w,{now=new Date(),env={},startup=false}={}) {
  cleanupAcquisition(w,{now});
  const at=now.toISOString(),out=[];
  w.db.transaction(()=>{
    // Recover terminal lease failures into visible acquisition status.
    w.db.exec("UPDATE acquisition_runs SET status='failed',error='任务租约到期或重试耗尽' WHERE status IN ('queued','running') AND job_id IN (SELECT id FROM local_jobs WHERE status='failed')");
    for(const row of w.db.prepare("SELECT * FROM intel_channels WHERE desired_enabled=1 AND user_disabled=0 AND adapter NOT IN ('','manual') AND (next_due_at IS NULL OR next_due_at<=?)").all(at)) {
      const channel=getChannel(w,row.id);
      if(channel.platform==='reddit'&& !(['true','1'].includes(String(env.REDDIT_PAID_ACQUISITION_APPROVED))&&env.BRIGHTDATA_API_KEY&&(env.REDDIT_ACQUISITION_PROVIDER||'brightdata')==='brightdata')) {
        const message=!['true','1'].includes(String(env.REDDIT_PAID_ACQUISITION_APPROVED))?'PAID_ACCESS_BLOCKED：付费 Reddit 采集未明确批准':'AUTH_BLOCKED：缺少 Bright Data API Key 或 provider 配置无效';
        w.db.prepare("UPDATE intel_channels SET enabled=0,access_status='needs_approval_and_credentials',last_error=?,next_due_at=? WHERE id=?").run(message,new Date(now.getTime()+3600000).toISOString(),channel.id);continue;
      }
      if(channel.platform==='reddit')w.db.prepare("UPDATE intel_channels SET access_status='approved' WHERE id=?").run(channel.id);
      if(channel.access_status==='blocked')continue;
      if(w.db.prepare("SELECT r.id FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id WHERE r.channel_id=? AND r.kind IN ('sync','validate','backfill') AND j.status IN ('queued','retry','running')").get(channel.id))continue;
      // Fixed UTC interval keys coalesce missed slots; the connector replays missing history.
      const interval=Math.max(300,channel.poll_seconds||3600),offset=channel.stream==='daily'?600000:0;
      const slotTime=Math.floor((now.getTime()-offset)/(interval*1000))*interval*1000+offset,slot=new Date(slotTime).toISOString();
      // Calendar-based providers only poll within their documented local publication window.
      if(channel.platform==='follow_builders'||channel.stream==='daily') {
        const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(now));
        const start=channel.platform==='follow_builders'?15:8;
        const beforeDaily=channel.stream==='daily'&&hour===8&&now.getUTCMinutes()<10;
        if(!startup&&channel.last_attempt_at&&(hour<start||hour>start+6||beforeDaily))continue;
      }
      out.push(enqueueAcquisition(w,channel.id,{mode:channel.validation_status==='verified'?'sync':'validate',trigger:'schedule',slot}));
      w.db.prepare('UPDATE intel_channels SET next_due_at=? WHERE id=?').run(new Date(slotTime+interval*1000).toISOString(),channel.id);
    }
  })();
  return out;
}
async function* fulltext({w,payload,channel,request}) {
  const row=w.db.prepare('SELECT * FROM intel_sources WHERE id=? AND deleted_at IS NULL').get(payload.sourceId);
  if(!row)throw acquisitionError('原始资料不存在',{retry:false});
  if(channel.options.fulltextAllowed!==true)throw acquisitionError('尚未允许补全正文',{retry:false});
  const source=JSON.parse(row.data_json);
  if(channel.platform==='reddit'||source.platform==='reddit')throw acquisitionError('Reddit 不允许通用网页正文回退',{blocked:true});
  const response=await request(source.url,{headers:{accept:'text/html'}});
  const {document}=parseHTML(response.text);document.querySelectorAll('script,style,iframe,object,embed').forEach(n=>n.remove());
  const article=new Readability(document).parse();
  const body=article?xhtmlToMd(article.content,src=>{try{const u=new URL(src,source.url);return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}}):'';
  const problem=junkReason(body);
  if(problem)throw acquisitionError(`正文未取得：${problem}`,{retry:false});
  yield {items:[{...source,identity:row.acquisition_identity,sourceKind:row.source_kind,body,readLevel:'original',contentStatus:'full_text'}],checkpoint:{completedAt:stamp(),sourceId:row.id},partition:`body:${row.id}`,outcome:'success',coverage:{fulltext:1},snapshots:[response.snapshotId]};
}
export async function executeAcquisition(w,env,payload,job,execution={},dependencies={}) {
  const channel=getChannel(w,payload.channelId),run=w.db.prepare('SELECT * FROM acquisition_runs WHERE job_id=?').get(job.id);
  const lockKey=`channel:${channel.id}`,at=stamp();
  const window=acquisitionWindow({mode:payload.mode,now:new Date(at),windowStart:payload.windowStartAt||run.window_start_at,windowEnd:payload.windowEndAt||run.window_end_at});
  const got=w.db.prepare(`INSERT INTO acquisition_locks(lock_key,owner,expires_at) VALUES(?,?,?) ON CONFLICT(lock_key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE acquisition_locks.expires_at<?`).run(lockKey,job.leaseToken,new Date(Date.now()+90000).toISOString(),at).changes;
  if(!got)throw acquisitionError('同一信源任务尚未完成',{retryAfterSeconds:30});
  const controller=new AbortController();
  const signal=execution.signal?AbortSignal.any([execution.signal,controller.signal]):controller.signal;
  const check=()=>{assertLease(w,job);execution.heartbeat?.();w.db.prepare('UPDATE acquisition_locks SET expires_at=? WHERE lock_key=? AND owner=?').run(new Date(Date.now()+90000).toISOString(),lockKey,job.leaseToken);};
  const cancelPoll=setInterval(()=>{try{check();}catch(e){controller.abort(e);}},1000);cancelPoll.unref?.();
  const ids=[],transport=dependencies.request||acquisitionTransport(w,channel,{signal,heartbeat:check,snapshotIds:ids});
  const request=async(url,options={})=>{
    const target=new URL(url),host=target.hostname;
    if(host==='api.github.com'&&env.GITHUB_TOKEN)options={...options,headers:{...options.headers,authorization:`Bearer ${env.GITHUB_TOKEN}`}};
    return transport(url,options);
  };
  const partition=payload.partition||'default',initial=checkpointFor(w,channel.id,partition);
  const providerState={
    load:()=>checkpointFor(w,channel.id,partition).providerJobs||{},
    save:(key,value)=>w.db.transaction(()=>{
      assertLease(w,job);
      const current=checkpointFor(w,channel.id,partition),state={...current,providerJobs:{...(current.providerJobs||{}),[key]:value}};
      w.db.prepare('INSERT INTO acquisition_checkpoints(channel_id,partition_key,state_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(channel_id,partition_key) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').run(channel.id,partition,encode(state),stamp());
      return state.providerJobs;
    })(),
    reserveThreads:(threads,max=8)=>w.db.transaction(()=>{
      assertLease(w,job);
      const scope=payload.batchId||run.id,prefix=`reddit-deep:${scope}:`;
      const existing=new Set(w.db.prepare("SELECT observation_key FROM acquisition_observations WHERE observation_key LIKE ?").all(`${prefix}%`).map(row=>row.observation_key.slice(prefix.length)));
      const selected=[];let used=existing.size;
      for(const thread of threads){const id=String(thread.id);if(existing.has(id)){selected.push(thread);continue;}if(used>=max)continue;w.db.prepare('INSERT INTO acquisition_observations(id,channel_id,observation_key,data_json,observed_at) VALUES(?,?,?,?,?)').run(createUlid(),channel.id,prefix+id,encode({kind:'reddit_deep_reservation',scope,threadId:id}),stamp());existing.add(id);selected.push(thread);used++;}
      return selected;
    })(),
  };
  w.db.prepare("UPDATE acquisition_runs SET status='running',started_at=?,window_start_at=?,window_end_at=?,checkpoint_before_json=?,error='' WHERE id=?").run(at,window.windowStart,window.windowEnd,encode(initial),run.id);
  w.db.prepare('UPDATE intel_channels SET last_attempt_at=? WHERE id=?').run(at,channel.id);
  const stats={fetched:0,inWindow:0,outsideWindow:0,unknownTimestamp:0,limited:0,inserted:0,updated:0,duplicate:0,failed:0,found:0,parsed:0,new:0,duplicates:0,summary:0,skipped:0,pages:0};
  const streamStats={};let last;
  try {
    check();
    if(channel.user_disabled && !payload.explicit && !['validate'].includes(payload.mode))throw acquisitionError('信源已暂停',{retry:false});
    if(channel.platform==='reddit') {
      const paid=['true','1'].includes(String(env.REDDIT_PAID_ACQUISITION_APPROVED));
      if(paid&&env.BRIGHTDATA_API_KEY){channel.access_status='approved';w.db.prepare("UPDATE intel_channels SET access_status='approved' WHERE id=?").run(channel.id);}
      channel.options.aiAllowed=false;
      channel.options.threadId=payload.threadId;
    }
    const collect=dependencies.collect||connectors[channel.adapter];
    if(!collect)throw acquisitionError('信源需要手动阅读或适配器未配置',{blocked:true});
    const readSnapshot=id=>w.db.prepare('SELECT payload_text AS text,id AS snapshotId,observed_at AS observedAt FROM acquisition_snapshots WHERE id=? AND channel_id=?').get(id,channel.id)||null;
    const iterable=payload.mode==='fulltext'?fulltext({w,payload,channel,request}):collect({channel,checkpoint:initial,request,readSnapshot,signal,env,mode:payload.mode,budget:payload.mode==='validate'?6:20,now:new Date(at),window,providerState,brightData:dependencies.brightData});
    let acceptedByChannel=0;
    for await(const page of iterable) {
      check();last=page;
      const localLimit=channelItemLimit(channel),localRemaining=Number.isFinite(localLimit)?Math.max(0,localLimit-acceptedByChannel):Infinity;
      const gated=gateAcquisitionItems(page.items||[],window,{limit:localRemaining});
      mergeAcquisitionStats(stats,gated.stats);stats.found=stats.fetched;stats.parsed=stats.inWindow;stats.skipped=stats.outsideWindow+stats.unknownTimestamp+stats.limited;
      for(const [key,value] of Object.entries(gated.byStream)){streamStats[key]||={};mergeAcquisitionStats(streamStats[key],value);}
      page.items=gated.items;acceptedByChannel+=page.items.length;
      const globalLimit=batchPlatformLimit(channel);
      if(payload.batchId&&Number.isFinite(globalLimit)){
        const kindClause=channel.platform==='reddit'?" AND s.source_kind<>'comment'":'';
        const used=w.db.prepare(`SELECT count(DISTINCT i.source_id) n FROM acquisition_run_items i JOIN acquisition_runs r ON r.id=i.run_id JOIN intel_channels c ON c.id=r.channel_id JOIN intel_sources s ON s.id=i.source_id WHERE r.batch_id=? AND c.platform=?${kindClause}`).get(payload.batchId,channel.platform).n;
        let remaining=Math.max(0,globalLimit-used),limited=0;
        page.items=page.items.filter(item=>{if(channel.platform==='reddit'&&item.sourceKind==='comment')return true;if(remaining>0){remaining--;return true;}limited++;return false;});
        if(limited){stats.limited+=limited;stats.skipped+=limited;const key=channel.stream||'default';streamStats[key]||={};streamStats[key].limited=Number(streamStats[key].limited||0)+limited;}
      }
      if(payload.mode==='validate') {stats.pages++;break;}
      page.partition=partition==='default'?page.partition:partition;page.snapshots=[...(page.snapshots||[]),...ids.splice(0)];
      const saved=commitPage(w,channel,page,{job,runId:run.id});stats.pages++;stats.inserted+=saved.new||0;stats.updated+=saved.updated||0;stats.duplicate+=saved.duplicates||0;stats.new=stats.inserted;stats.duplicates=stats.duplicate;stats.summary+=saved.summary||0;
      w.db.prepare('UPDATE acquisition_runs SET stats_json=? WHERE id=?').run(encode(stats),run.id);
      for(const id of saved.ids) {
        const source=w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(id);
        if(w.db.pragma('user_version',{simple:true})>=32){const record=sourceFromRow(source);record.processing=processLocalSource(w,record);ensureReviewClusters(w,[record]);}
        if(source.content_status==='summary_only'&&channel.options.fulltextAllowed===true&&!['reddit','arxiv'].includes(channel.platform))enqueueAcquisition(w,channel.id,{mode:'fulltext',trigger:'enrichment',sourceId:id,slot:`body:${id}:${source.content_hash}`});
      }
      if(payload.mode!=='revalidate')for(const o of page.observations||[])if(o.kind==='reddit_thread_review')for(const hours of o.followupHours||[])enqueueAcquisition(w,channel.id,{mode:'revalidate',trigger:'comment_review',threadId:o.identity.replace(/^reddit:t3_/,''),partition:`review:${o.identity}:${hours}`,slot:`review:${o.identity}:${hours}`,dueAt:new Date(Date.now()+hours*3600000).toISOString()});
    }
    if(!last)throw acquisitionError('适配器没有返回可核验结果',{retry:false});
    check();
    const more=Boolean(last.coverage?.hasMore),partial=last.outcome==='partial'||Boolean(last.coverage?.gap);
    const coverage={...(last.coverage||{}),window:{start:window.windowStart,end:window.windowEnd,providerStart:window.providerWindowStart},streamStats};
    w.db.transaction(()=>{
      assertLease(w,job);
      w.db.prepare("UPDATE acquisition_runs SET status='completed',outcome=?,stats_json=?,coverage_json=?,finished_at=? WHERE id=?").run(partial?'partial':stats.inserted||stats.updated?'success':last.outcome||'no_new',encode(stats),encode(coverage),stamp(),run.id);
      w.db.prepare('UPDATE acquisition_runs SET health_status=? WHERE id=?').run(successStatus(stats,coverage),run.id);
      if(!['fulltext','revalidate'].includes(payload.mode))w.db.prepare("UPDATE intel_channels SET validation_status='verified',enabled=CASE WHEN desired_enabled=1 AND user_disabled=0 THEN 1 ELSE 0 END,health=?,last_success_at=?,last_item_count=?,last_error='',consecutive_failures=0,last_stats_json=? WHERE id=?").run(partial?'partial':stats.found?'ok':'empty',stamp(),stats.found,encode(stats),channel.id);
      if(payload.mode==='validate'&&channel.desired_enabled&&!channel.user_disabled)enqueueAcquisition(w,channel.id,{trigger:'validated',slot:`validated:${run.id}`});
      if(more && payload.mode!=='validate' && payload.continuation<100)enqueueAcquisition(w,channel.id,{mode:payload.mode,trigger:'continuation',slot:`continue:${run.id}`,partition,threadId:payload.threadId,continuation:payload.continuation+1,batchId:payload.batchId,explicit:payload.explicit,windowStartAt:window.windowStart,windowEndAt:window.windowEnd,dueAt:new Date(Date.now()+1000).toISOString()});
    })();
    return {runId:run.id,stats,outcome:last.outcome,coverage};
  } catch(error) {
    stats.failed++;
    w.db.prepare('UPDATE acquisition_runs SET health_status=? WHERE id=?').run(errorStatus(error),run.id);
    const blocked=error.blocked||error.code==='blocked'||[401,403].includes(error.status);
    if(blocked){error.blocked=true;error.retry=false;}
    // Never persist raw exception URLs or headers carrying credentials.
    const message=String(error.message||'采集失败').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,1000);
    w.db.prepare("UPDATE acquisition_runs SET status=?,error=?,stats_json=?,finished_at=? WHERE id=? AND status<>'cancelled'").run(blocked?'blocked':'failed',message,encode(stats),stamp(),run.id);
    if(!['fulltext','revalidate'].includes(payload.mode))w.db.prepare('UPDATE intel_channels SET enabled=CASE WHEN ? THEN 0 ELSE enabled END,access_status=CASE WHEN ? THEN ? ELSE access_status END,health=?,last_error=?,consecutive_failures=consecutive_failures+1 WHERE id=?').run(Number(blocked),Number(blocked),'blocked','failed',message,channel.id);
    throw error;
  } finally {clearInterval(cancelPoll);controller.abort();w.db.prepare('DELETE FROM acquisition_locks WHERE lock_key=? AND owner=?').run(lockKey,job.leaseToken);}
}
export function acquisitionHandlers(w,env={},dependencies={}) {return Object.fromEntries(ACQUISITION_KINDS.map(kind=>[kind,(payload,job,execution)=>executeAcquisition(w,env,payload,job,execution,dependencies)]));}
export function cancelAcquisition(w,id) {
  return w.db.transaction(()=>{
    const run=w.db.prepare('SELECT * FROM acquisition_runs WHERE id=?').get(id);if(!run)throw acquisitionError('采集任务不存在',{status:404});
    w.db.prepare("UPDATE local_job_runs SET status='failed',finished_at=?,error='user cancelled' WHERE job_id=? AND status='running'").run(stamp(),run.job_id);
    w.db.prepare("UPDATE local_jobs SET status='cancelled',lease_owner='',lease_token='',lease_expires_at=NULL,finished_at=? WHERE id=? AND status IN ('queued','retry','running')").run(stamp(),run.job_id);
    w.db.prepare("UPDATE acquisition_runs SET status='cancelled',finished_at=? WHERE id=?").run(stamp(),id);
    return {cancelled:true};
  })();
}
export async function acquisitionAction(w,id,input) {
  const channel=getChannel(w,id);if(input.confirmed!==true)throw acquisitionError('请确认操作',{status:400});
  if(input.action==='configure') {
    if(channel.adapter!=='community'||['reddit','github'].includes(channel.platform))throw acquisitionError('此连接器的入口不能改为通用订阅',{status:400});
    const {url}=await validateTarget(String(input.endpoint||''));
    if(w.db.prepare('SELECT id FROM intel_channels WHERE url=? AND id<>?').get(url.href,channel.id))throw acquisitionError('该入口已由另一个来源管理',{status:409});
    w.db.transaction(()=>{
      for(const run of w.db.prepare("SELECT r.id FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id WHERE r.channel_id=? AND j.status IN ('queued','running','retry')").all(channel.id))cancelAcquisition(w,run.id);
      w.db.prepare("UPDATE intel_channels SET url=?,site_url=?,validation_status='pending',access_status='public_feed',enabled=0,last_error='',next_due_at=NULL,updated_at=? WHERE id=?").run(url.href,url.origin,stamp(),channel.id);
      w.db.prepare('DELETE FROM acquisition_checkpoints WHERE channel_id=?').run(channel.id);
    })();
    return {channel:getChannel(w,id)};
  }
  if(['sync','backfill','validate'].includes(input.action))return {run:enqueueAcquisition(w,id,{mode:input.action})};
  if(['pause','enable'].includes(input.action)) {
    const enabled=input.action==='enable';w.db.prepare('UPDATE intel_channels SET desired_enabled=?,user_disabled=?,enabled=?,next_due_at=NULL WHERE id=?').run(Number(enabled),Number(!enabled),Number(enabled&&channel.validation_status==='verified'&&['public_feed','approved'].includes(channel.access_status)),channel.id);
    if(!enabled)for(const r of w.db.prepare("SELECT r.id FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id WHERE r.channel_id=? AND j.status IN ('queued','running','retry')").all(channel.id))cancelAcquisition(w,r.id);
    return {channel:getChannel(w,id)};
  }
  if(['allow_ai','allow_export','allow_fulltext'].includes(input.action)) {
    if(channel.platform==='reddit')throw acquisitionError('Reddit 权限须在本机配置中明确提供批准范围，不能由通用开关代替',{status:403});
    const key={allow_ai:'aiAllowed',allow_export:'exportAllowed',allow_fulltext:'fulltextAllowed'}[input.action];
    const options={...channel.options,[key]:input.allowed!==false};w.db.prepare('UPDATE intel_channels SET options_json=? WHERE id=?').run(encode(options),channel.id);
    if(key!=='fulltextAllowed')w.db.prepare(`UPDATE intel_sources SET rights_json=json_set(rights_json,?,json(?)) WHERE channel_id=?`).run(`$.${key}`,input.allowed===false?'false':'true',channel.id);
    return {channel:getChannel(w,id)};
  }
  throw acquisitionError('未知信源操作',{status:400});
}
