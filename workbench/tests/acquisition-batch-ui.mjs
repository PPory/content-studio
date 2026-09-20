// Real local SQLite/API/browser acceptance. External upstream responses are NOT tested here.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { workbenchApi } from '../server/vite-plugin-workbench.mjs';
import { enqueueAcquisition } from '../server/acquisition/runner.mjs';
import { commitPage, getChannel, redactSource } from '../server/acquisition/store.mjs';

const ROOT=path.resolve(import.meta.dirname,'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-acquisition-ui-'));
const vars={XENHO_HOME:path.join(temp,'Xenho'),WB_KEEP_ALIVE:'1',ACQUISITION_AUTOSTART:'false',HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost'};
const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);let pw;
for(const root of [ROOT,'C:/Users/Lenovo',process.env.APPDATA&&path.join(process.env.APPDATA,'npm','node_modules')].filter(Boolean)){try{pw=require(require.resolve('playwright',{paths:[root]}));break;}catch{}}
assert(pw,'Playwright available');
let server,browser,page;const base='http://127.0.0.1:5274',shots=path.join(ROOT,'output','playwright');
try {
  server=await createServer({root:ROOT,configFile:false,plugins:[react(),workbenchApi({XENHO_HOME:vars.XENHO_HOME})],server:{host:'127.0.0.1',port:5274,strictPort:true,open:false},logLevel:'error'});await server.listen();
  const w=await server.xenhoWorkspace;w.db.prepare('UPDATE intel_channels SET enabled=0,desired_enabled=0,next_due_at=NULL').run();
  const follow=w.db.prepare("SELECT * FROM intel_channels WHERE source_group='follow_builders'").get();
  const full='验收转录开始\n'+('这是一段隔离浏览器验收正文，不是真实外部采集证据。\n'.repeat(7000))+'TRANSCRIPT END';
  const id=commitPage(w,getChannel(w,follow.id),{items:[{identity:'podcast:batch-test',platform:'podcast',platformId:'batch-test',title:'界面契约：完整 Podcast',url:'https://example.org/episode',body:full,sourceKind:'podcast_transcript',contentStatus:'full_text',readLevel:'original'}],checkpoint:{fixture:true},outcome:'success'}).ids[0];
  const stats={fetched:8,inWindow:5,outsideWindow:2,unknownTimestamp:1,inserted:1,updated:0,duplicate:4,failed:1};
  const batch={id:'fixture-ui-batch',startedAt:'2026-09-20T05:00:00Z',finishedAt:'2026-09-20T05:01:00Z',windowStart:'2026-09-19T05:00:00Z',windowEnd:'2026-09-20T05:00:00Z',status:'partial',channelCount:2,stats,channels:[{id:follow.id,name:'Follow Builders',sourceGroup:'follow_builders',status:'OK',stats},{id:'reddit-blocked',name:'Reddit',sourceGroup:'community',status:'AUTH_BLOCKED',error:'缺少本轮 Reddit 访问授权',stats:{failed:1}}],streams:[{key:'follow_builders.podcast',label:'Podcast',sourceGroup:'follow_builders',status:'OK',stats},{key:'follow_builders.blog',label:'Blog',sourceGroup:'follow_builders',status:'NO_NEW_ITEMS',stats:{}}]};
  browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let synced=false,fail=false;
  await page.route('**/api/workspace/acquisition/batches**',async route=>{if(route.request().method()==='POST'){assert.equal(route.request().postDataJSON().confirmed,true);synced=true;return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,batch})});}if(fail){fail=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'验收：批次暂时不可读'})});}const query=new URL(route.request().url()).searchParams;const items=query.get('stream')==='follow_builders.blog'?[]:[{id,title:'界面契约：完整 Podcast',sourceGroup:'follow_builders',channelName:'Follow Builders',stream:'podcast',platform:'podcast',sourceKind:'podcast_transcript',publishedAt:'2026-09-19T03:00:00Z',lastSeenAt:'2026-09-20T05:00:50Z',runId:'fixture-run',contentStatus:'full_text',body:full.slice(0,120),dedupResult:'inserted'}];await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,batch,items,total:items.length,nextOffset:null})});});
  await page.goto(base+'/#/intel-resources');await page.getByRole('tab',{name:'本次采集',exact:true}).click();
  const region=page.getByRole('region',{name:'本次采集',exact:true});await region.getByText('fixture-ui-batch',{exact:true}).waitFor();await region.getByText('NO_NEW_ITEMS',{exact:true}).waitFor();
  await region.getByRole('region',{name:'Community 本轮结果'}).locator('summary').click();await region.getByText('缺少本轮 Reddit 访问授权',{exact:true}).waitFor();
  await region.getByText('采集窗口',{exact:true}).waitFor();await region.locator('.acquisition-batch-totals').getByText('窗内',{exact:true}).waitFor();
  await fs.mkdir(shots,{recursive:true});await page.evaluate(()=>document.querySelector('.main')?.scrollTo(0,0));await page.screenshot({path:path.join(shots,'acquisition-batch-desktop.png')});
  await region.getByText('界面契约：完整 Podcast',{exact:true}).click();const card=region.locator('.intel-v2-resource');await card.getByText('TRANSCRIPT END',{exact:false}).first().waitFor();assert.equal((await card.locator('.acquisition-reading-body .markdown-body').textContent()).replace(/\s/g,''),full.replace(/\s/g,''));await card.getByText('采集详情',{exact:true}).click();await card.getByText('fixture-run',{exact:true}).waitFor();
  await region.getByLabel('本轮内容流',{exact:true}).selectOption('follow_builders.blog');await region.getByText('本轮所选范围没有发现记录；不表示来源没有内容。请核对请求失败、上游未变、全部重复、超出窗口或权限受限的逐源结果。',{exact:true}).waitFor();
  await region.getByRole('button',{name:'立即同步最近 24 小时',exact:true}).click();assert(synced);await region.getByLabel('本轮内容流',{exact:true}).selectOption('');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.querySelector('.main')?.scrollTo(0,0));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no mobile overflow');await page.screenshot({path:path.join(shots,'acquisition-batch-mobile.png'),fullPage:true});
  fail=true;await region.getByRole('button',{name:'刷新本次采集',exact:true}).click();await region.getByText('验收：批次暂时不可读',{exact:false}).waitFor();await region.getByRole('button',{name:'重试',exact:true}).click();await region.getByText('验收：批次暂时不可读',{exact:false}).waitFor({state:'detached'});
  assert.deepEqual(errors,[]);console.log('batch UI passed: local SQLite full transcript/API/browser; batch summary fixture only, NOT live acquisition proof');
} finally { await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}const rel=path.relative(os.tmpdir(),temp);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true}); }
