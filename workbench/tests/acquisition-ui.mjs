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
  const w=await server.xenhoWorkspace;assert(w?.db.open,'isolated SQLite ready');
  w.db.prepare('UPDATE intel_channels SET enabled=0,desired_enabled=0,next_due_at=NULL').run();
  const channels=w.db.prepare('SELECT * FROM intel_channels').all();
  const media=channels.find(c=>c.source_group==='t2_media'),follow=channels.find(c=>c.source_group==='follow_builders'),reddit=channels.find(c=>c.platform==='reddit'),aihot=channels.find(c=>c.source_group==='aihot');
  assert.equal(channels.filter(c=>c.source_group==='t2_media').length,14);
  assert(media&&follow&&reddit&&aihot);
  w.db.prepare("UPDATE intel_channels SET validation_status='failed',last_error='验收样例：入口超时，来源仍保留',last_stats_json=? WHERE id=?").run(JSON.stringify({found:5,new:1,duplicates:3,summary:1}),media.id);
  const full='Speaker 1 | 00:05 - 00:31\n'+('完整转录应该保留发言归属与上下文。\n'.repeat(6000))+'转录全文结束标记';
  const store=(channel,items)=>commitPage(w,getChannel(w,channel.id),{items,checkpoint:{fixture:true},outcome:'success'});
  const transcript=store(follow,[{identity:'podcast:ui:one',platform:'podcast',platformId:'ui:one',title:'验收：完整播客逐字稿',url:'https://example.org/episode',body:full,sourceKind:'podcast_transcript',readLevel:'original',contentStatus:'full_text'}]).ids[0];
  const summary=store(media,[{identity:'url:https://example.org/summary',platform:'web',title:'验收：仅有线索摘要',url:'https://example.org/summary',summary:'这里只取得摘要，不能显示为全文。',sourceKind:'article',readLevel:'summary',contentStatus:'summary_only'}]).ids[0];
  store(aihot,[{identity:'aihot:ui-summary',platform:'aihot',title:'验收：仅有线索摘要',url:'https://example.org/summary',summary:'第二条发现路径。',sourceKind:'article',readLevel:'summary',contentStatus:'summary_only'}]);
  const root=store(reddit,[{identity:'reddit:t3_uiroot',rootIdentity:'reddit:t3_uiroot',platform:'reddit',platformId:'t3_uiroot',title:'验收：讨论及评论上下文',url:'https://reddit.com/r/test/comments/uiroot',body:'这是讨论原帖，仅用于隔离验收。',sourceKind:'post',readLevel:'original',contentStatus:'full_text'}]).ids[0];
  store(reddit,[{identity:'reddit:t1_parent',rootIdentity:'reddit:t3_uiroot',parentIdentity:'reddit:t3_uiroot',platform:'reddit',author:'评论作者甲',title:'父评论',body:'父评论提供了一次真实使用观察。',sourceKind:'comment',readLevel:'original',contentStatus:'full_text'},{identity:'reddit:t1_reply',rootIdentity:'reddit:t3_uiroot',parentIdentity:'reddit:t1_parent',platform:'reddit',author:'评论作者乙',title:'回复',body:'回复指出观察的局限，不能代表全部情况。',sourceKind:'comment',readLevel:'original',contentStatus:'full_text'}]);
  const removed=store(reddit,[{identity:'reddit:t1_removed',platform:'reddit',title:'已删评论',body:'这段已删除内容不能出现在页面',sourceKind:'comment',readLevel:'original',contentStatus:'full_text'}]).ids[0];redactSource(w,removed,'upstream_deleted');
  browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/#/intel-channels');await page.getByRole('region',{name:'情报采集来源'}).waitFor();
  for(const group of ['AIHOT','T2 媒体','社区','Follow Builders'])await page.getByRole('region',{name:group,exact:true}).waitFor();
  assert.equal(await page.getByRole('region',{name:'T2 媒体',exact:true}).locator('article').count(),14);
  await page.getByText('验收样例：入口超时，来源仍保留',{exact:true}).first().waitFor();
  const mediaRow=page.locator(`[data-channel-id="${media.id}"]`);
  const sourceCountBefore=w.db.prepare('SELECT count(*) n FROM intel_sources').get().n;
  await mediaRow.getByRole('button',{name:'修改入口',exact:true}).click();const configure=page.getByRole('dialog',{name:'修改采集入口'});await configure.getByLabel('完整公开网址',{exact:true}).fill('https://example.org/updated-feed.xml');await configure.getByRole('button',{name:'保存入口',exact:true}).click();await configure.waitFor({state:'detached'});
  const configured=w.db.prepare('SELECT url,validation_status,enabled FROM intel_channels WHERE id=?').get(media.id);assert.equal(configured.url,'https://example.org/updated-feed.xml');assert.equal(configured.validation_status,'pending');assert.equal(configured.enabled,0);assert.equal(w.db.prepare('SELECT count(*) n FROM intel_sources').get().n,sourceCountBefore,'configure preserves collected sources');await page.getByText('入口已更新，等待重新验证；尚未确认可用。',{exact:true}).waitFor();
  await mediaRow.locator('.acquisition-permissions>summary').click();await mediaRow.getByRole('button',{name:'允许 AI 处理',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'确认允许 AI 处理'});await dialog.waitFor();
  assert.notEqual(JSON.parse(w.db.prepare('SELECT options_json FROM intel_channels WHERE id=?').get(media.id).options_json).aiAllowed,true);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert(await mediaRow.getByRole('button',{name:'允许 AI 处理',exact:true}).evaluate(e=>e===document.activeElement),'dialog restores keyboard focus');
  await mediaRow.getByRole('button',{name:'允许 AI 处理',exact:true}).click();await page.getByRole('button',{name:'确认允许 AI 处理',exact:true}).click();await dialog.waitFor({state:'detached'});
  assert.equal(JSON.parse(w.db.prepare('SELECT options_json FROM intel_channels WHERE id=?').get(media.id).options_json).aiAllowed,true);
  await mediaRow.getByRole('button',{name:'允许导出',exact:true}).click();await page.getByRole('dialog',{name:'确认允许导出'}).getByRole('button',{name:'确认允许导出',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  assert.equal(JSON.parse(w.db.prepare('SELECT options_json FROM intel_channels WHERE id=?').get(media.id).options_json).exportAllowed,true);
  await mediaRow.getByRole('button',{name:'允许补全公开原文',exact:true}).click();await page.getByRole('button',{name:'确认读取公开原文',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(JSON.parse(w.db.prepare('SELECT options_json FROM intel_channels WHERE id=?').get(media.id).options_json).fulltextAllowed,true);
  await mediaRow.getByRole('button',{name:'申请启用',exact:true}).click();await mediaRow.getByRole('button',{name:'暂停采集',exact:true}).waitFor();assert.equal(w.db.prepare('SELECT enabled FROM intel_channels WHERE id=?').get(media.id).enabled,0,'unverified source cannot become actually enabled');await mediaRow.getByRole('button',{name:'暂停采集',exact:true}).click();await mediaRow.getByRole('button',{name:'申请启用',exact:true}).waitFor();
  const redditRow=page.locator(`[data-channel-id="${reddit.id}"]`);await redditRow.locator('.acquisition-permissions>summary').click();assert.equal(await redditRow.getByRole('button',{name:'允许导出',exact:true}).count(),0);assert(await redditRow.getByRole('button',{name:'允许 AI 处理',exact:true}).isDisabled());
  // Missing Reddit approval is checked before network. This is a real enqueue/worker/API flow.
  await redditRow.getByRole('button',{name:'验证入口',exact:true}).click();
  await page.waitForFunction(async channelId=>{const data=await (await fetch('/api/workspace/acquisition')).json();return data.runs.some(r=>r.channel_id===channelId&&r.status==='blocked');},reddit.id);
  assert(w.db.prepare("SELECT id FROM acquisition_runs WHERE channel_id=? AND status='blocked'").get(reddit.id));
  await page.getByRole('button',{name:'刷新状态',exact:true}).click();
  const future=enqueueAcquisition(w,media.id,{mode:'sync',dueAt:'2099-01-01T00:00:00Z'});
  await page.getByRole('button',{name:'刷新状态',exact:true}).click();const futureRow=page.locator(`[data-run-id="${future.id}"]`);await futureRow.locator('summary').click();await futureRow.getByRole('button',{name:'取消本次采集',exact:true}).click();await page.getByText('已请求取消，已保存的资料会保留。',{exact:true}).waitFor();assert.equal(w.db.prepare('SELECT status FROM acquisition_runs WHERE id=?').get(future.id).status,'cancelled');
  // Other upstream action dispatch is mocked so this test never starts external collection.
  const dispatched=[];
  await page.route('**/api/workspace/acquisition/channels/*/action',async route=>{const body=route.request().postDataJSON();assert.equal(body.confirmed,true);dispatched.push(body.action);await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,run:{id:'mock-action'}})});});
  await mediaRow.getByRole('button',{name:'同步最近 24 小时',exact:true}).click();await page.getByText('已安排任务，完成情况见采集记录。',{exact:true}).waitFor();await mediaRow.getByRole('button',{name:'历史补采',exact:true}).click();await page.waitForFunction(id=>!document.querySelector(`[data-channel-id="${id}"] button`).disabled,media.id);
  assert.deepEqual(dispatched,['sync','backfill']);await page.unroute('**/api/workspace/acquisition/channels/*/action');
  await page.getByLabel('查找来源',{exact:true}).fill('Follow');await page.evaluate(()=>document.querySelector('.main')?.scrollTo(0,0));await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,'acquisition-channels-desktop.png'),fullPage:false});
  await page.goto(base+'/#/intel-resources');await page.locator('summary').getByText('验收：完整播客逐字稿',{exact:true}).click();
  const transcriptRow=page.locator('.intel-v2-resource').filter({has:page.locator('summary strong').getByText('验收：完整播客逐字稿',{exact:true})});
  await transcriptRow.getByText('转录全文结束标记',{exact:false}).first().waitFor();assert.equal(await transcriptRow.locator(':scope > .intel-resource-body').textContent(),full);
  await transcriptRow.locator('.acquisition-segments>summary').click();assert((await transcriptRow.locator('.acquisition-segments section').count())>1);
  await page.getByLabel('正文范围',{exact:true}).selectOption('summary');await page.locator('summary').getByText('验收：仅有线索摘要',{exact:true}).click();
  const summaryRow=page.locator('.intel-v2-resource').filter({has:page.locator('summary strong').getByText('验收：仅有线索摘要',{exact:true})});await summaryRow.getByRole('heading',{name:'发现渠道',exact:true}).waitFor();assert.equal(await summaryRow.locator('.acquisition-discoveries li').count(),2);assert.equal(await page.locator('summary').getByText('验收：完整播客逐字稿',{exact:true}).count(),0);
  await page.getByLabel('正文范围',{exact:true}).selectOption('all');await page.locator('summary').getByText('验收：讨论及评论上下文',{exact:true}).click();
  const rootRow=page.locator('.intel-v2-resource').filter({has:page.locator('summary strong').getByText('验收：讨论及评论上下文',{exact:true})});await rootRow.getByRole('heading',{name:'评论与回复上下文',exact:true}).waitFor();assert.equal(await rootRow.locator('.acquisition-comment').count(),2);await rootRow.getByText('回复指出观察的局限，不能代表全部情况。',{exact:true}).waitFor();assert.equal(await rootRow.getByText('父级上下文尚未取得',{exact:true}).count(),0);
  assert.equal(await page.getByText('这段已删除内容不能出现在页面',{exact:false}).count(),0);
  await page.getByLabel('正文范围',{exact:true}).selectOption('unavailable');await page.locator('summary').getByText('内容已移除',{exact:true}).click();await page.getByText('这条资料已删除或保留期已到，正文不再展示。',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'带入选题',exact:true}).isDisabled());
  await page.getByLabel('正文范围',{exact:true}).selectOption('all');await page.getByRole('textbox',{name:'搜索情报资料'}).fill('讨论及评论上下文');await page.locator('.intel-v2-resource>summary').click();await page.getByRole('heading',{name:'评论与回复上下文',exact:true}).waitFor();await page.locator('.acquisition-comments').screenshot({path:path.join(shots,'acquisition-comments-desktop.png')});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'resources no mobile overflow');await page.locator('.acquisition-comments').screenshot({path:path.join(shots,'acquisition-comments-mobile.png')});
  await page.goto(base+'/#/intel-channels');await page.getByLabel('查找来源',{exact:true}).fill('Follow');await page.locator('.acquisition-legacy>summary').click();await page.getByText('三个内容流与上游状态',{exact:true}).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'channels no mobile overflow');await page.screenshot({path:path.join(shots,'acquisition-channels-mobile.png'),fullPage:true});
  await page.getByLabel('查找来源',{exact:true}).fill('不会存在的来源');await page.getByText('没有匹配的来源。',{exact:true}).waitFor();
  let failOnce=true;await page.route('**/api/workspace/acquisition',async route=>{if(failOnce){failOnce=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'模拟：状态读取暂不可用'})});}else await route.continue();});
  await page.getByRole('button',{name:'刷新状态',exact:true}).click();await page.getByText('模拟：状态读取暂不可用',{exact:false}).waitFor();await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('模拟：状态读取暂不可用',{exact:false}).waitFor({state:'detached'});
  assert.deepEqual(errors,[]);console.log('acquisition-ui: isolated real SQLite/API/browser UI passed; sync/backfill dispatch and error response mocked; no live upstream validation');
} catch(error) { console.log((await page?.locator('body').innerText())?.slice(-1200)); throw error; }
finally { await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}const rel=path.relative(os.tmpdir(),temp);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true}); }
