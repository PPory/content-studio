// Live, bounded, public read requests. Business writes are isolated and removed afterwards.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadEnv } from 'vite';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { getChannel, commitPage } from '../server/acquisition/store.mjs';
import { acquisitionTransport } from '../server/acquisition/transport.mjs';
import { collectAiHot } from '../server/acquisition/connectors/aihot.mjs';
import { collectFollowBuilders } from '../server/acquisition/connectors/follow-builders.mjs';
import { collectCommunity } from '../server/acquisition/connectors/community.mjs';
import { collectReddit } from '../server/acquisition/connectors/reddit.mjs';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-acquisition-live-'));
const env={...loadEnv('development',process.cwd(),''),...process.env};
const selectedKeys=process.argv.slice(2);
const report={checkedAt:new Date().toISOString(),type:'live_public_http_and_isolated_sqlite',productionDatabaseModified:false,rows:[]};
const w=await openWorkspace({xenhoHome:temp});
async function check(key,collect,opts={}) {
  if(selectedKeys.length&&!selectedKeys.includes(key))return;
  const channel=getChannel(w,key),snapshots=[];
  const transport=acquisitionTransport(w,channel,{snapshotIds:snapshots});
  let requests=0;
  const request=(url,options={})=>{requests++;if(new URL(url).hostname==='api.github.com'&&env.GITHUB_TOKEN)options={...options,headers:{...options.headers,authorization:`Bearer ${env.GITHUB_TOKEN}`}};return transport(url,options);};
  const row={key,checkedAt:new Date().toISOString(),pages:0,items:0,requests:0};report.rows.push(row);
  try {
    let checkpoint=opts.checkpoint||{};
    if(opts.pinCurrent){const head=await request(channel.endpoint);checkpoint={pending:[{sha:head.json.sha,at:head.json.commit.committer.date}]};}
    for await(const page of collect({channel,checkpoint,request,env:{},now:new Date(),budget:opts.budget||1,...opts})) {
      page.snapshots=[...snapshots.splice(0),...(page.snapshots||[])];
      const saved=commitPage(w,channel,page);row.items+=saved.new;row.pages++;
      row.outcome=page.outcome;row.coverage=page.coverage;row.checkpointSaved=true;
      if(opts.maxPages&&row.pages>=opts.maxPages)break;
    }
    row.status='parsed_and_committed';
  }catch(e){row.status=e.blocked||e.code==='blocked'?'blocked':'failed';row.error=String(e.message).slice(0,500);row.httpStatus=e.status||null;}
  row.requests=requests;console.log(JSON.stringify(row));
}
try {
 await check('aihot.selected',collectAiHot,{budget:1,maxPages:1});
 await check('aihot.hot_topics',collectAiHot,{budget:2});
 await check('aihot.dailies',collectAiHot,{budget:1,maxPages:1});
 await check('follow_builders.bundle',collectFollowBuilders,{pinCurrent:true,budget:4});
 for(const c of w.db.prepare("SELECT stable_key FROM intel_channels WHERE source_group='t2_media'").all())await check(c.stable_key,collectCommunity);
 for(const key of ['community.hacker_news.frontpage','community.github.llm','community.arxiv.cs.AI','community.stackoverflow.langchain.newest','community.devto.ai'])await check(key,collectCommunity,{budget:1,maxPages:1});
 await check('community.reddit.localllama',collectReddit);
 report.sourceCount=w.db.prepare('SELECT count(*) n FROM intel_sources').get().n;
 report.integrity=w.check();
 report.limitations=['Public endpoint smoke only; rights and external-AI permission are not inferred','No live Reddit request; approval and credentials are absent','Historical Git replay and seven-day operation require separate acceptance','No production migration or activation'];
 const output=path.resolve('../output/acquisition/live-smoke.json');await fs.mkdir(path.dirname(output),{recursive:true});if(selectedKeys.length){try{const prior=JSON.parse(await fs.readFile(output,'utf8'));report.previousRuns=[...(prior.previousRuns||[]),{checkedAt:prior.checkedAt,rows:prior.rows}];report.rows=[...prior.rows.filter(r=>!selectedKeys.includes(r.key)),...report.rows];}catch{}}await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(`Report: ${output}`);
}finally{w.close();await fs.rm(temp,{recursive:true,force:true});}
