import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {workbenchApi} from '../server/vite-plugin-workbench.mjs';
const ROOT=path.resolve(import.meta.dirname,'..'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-unified-ui-'));
const vars={XENHO_HOME:path.join(temp,'Xenho'),WB_KEEP_ALIVE:'1',HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost'};
const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);const {chromium}=require(require.resolve('playwright',{paths:[ROOT,'C:/Users/Lenovo']}));
const shots=path.join(ROOT,'output/playwright/intel-refinement');await fs.mkdir(shots,{recursive:true});
const source={id:'raw1',title:'模型更新原始说明',body:'模型在对照任务中改善，真实环境仍需验证。',url:'https://example.com/release',provider:'web',originKind:'external',publishedAt:'2026-09-20',sourceGroup:'aihot'};
const briefs=Array.from({length:11},(_,i)=>({id:`b${i}`,title:`模型更新的实际变化 ${i+1}`,summary:i%3===0?'对照任务显示改善，真实工作流仍待核对。作者指出适用范围有限，尚需在日常写作和资料整理中复测。':'对照任务显示改善，真实工作流仍待核对。',whyItMatters:i%2?'可以核对来源的具体任务和样本。':'可用自己的重复任务做一次对照。',body:'原始说明表明模型在对照任务中改善。',uncertainties:['真实环境未验证'],evidence:[{sourceId:'raw1',quote:source.body}],sourceMeta:[source],sources:[source],sourceDocuments:[source],sourceCount:1,sourceGroups:i%2?['community']:['aihot'],editorialState:i===10?'needs_review':'ready',freshnessKind:'recent_event',read:false,saved:false,dismissed:false,version:1,researchLinks:[],reviewClusterId:i===1?'cluster-1':null}));
const feed=()=>({ok:true,briefs,featuredIds:briefs.slice(0,8).map(b=>b.id),recommendationIds:briefs.slice(0,10).map(b=>b.id),activeRuns:[],preferences:{directions:['AI 实践']},processing:{newCount:10,updatedCount:0,pending:0,failures:0},lastSuccessfulUpdate:'2026-09-22T09:00:00Z'});
const researches=[{id:'existing',title:'已有选题',question:'已有选题',notes:'用户已有笔记',references:[],projects:[],conversations:[],updatedAt:'2026-09-20'}];
const operations=new Map();let calls=0,reads=0,failDetail=true,previews=0,lastIntent,server,browser,page;
try{
 server=await createServer({root:ROOT,configFile:false,plugins:[react(),workbenchApi({XENHO_HOME:vars.XENHO_HOME})],server:{host:'127.0.0.1',port:5276,strictPort:true,open:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch();page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const send=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({ok:status===200,...data})});
 await page.route('**/api/workspace/researches',route=>send(route,{researches}));
 await page.route('**/api/workspace/intelligence**',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.method()==='GET'?{}:req.postDataJSON();
  if(url.pathname.endsWith('/feed'))return send(route,feed());
  if(url.pathname.endsWith('/summary'))return send(route,{unread:10,saved:0});
  if(url.pathname.endsWith('/feed/refresh'))return send(route,{run:{id:'r1',status:'queued'}});
  if(url.pathname.endsWith('/topics/preview')){previews++;return send(route,{},503);}
  if(url.pathname.endsWith('/topics/intents')){calls++;lastIntent=body;assert.equal(body.confirmed,true);if(!operations.has(body.operationId)){operations.set(body.operationId,body.researchId||`research-${operations.size}`);const title=briefs.find(b=>b.id===body.briefIds[0]).title;if(!body.researchId)researches.push({id:operations.get(body.operationId),title,notes:body.notes||'',references:[],projects:[],conversations:[],updatedAt:'2026-09-21'});for(const id of body.briefIds){const brief=briefs.find(b=>b.id===id);if(!brief.researchLinks.some(link=>link.id===operations.get(body.operationId)))brief.researchLinks.push({id:operations.get(body.operationId),title});}}return send(route,{research:{id:operations.get(body.operationId)}});}
  if(url.pathname.endsWith('/angles'))return send(route,{version:1,angles:[{question:'这个改善能用于我的任务吗？',audience:'个人创作者',connection:'实际任务对照',gap:'缺少自己的验证',evidence:[{sourceId:'raw1',quote:source.body,title:source.title}]}]});
  if(url.pathname.includes('/briefs/')){const id=url.pathname.split('/briefs/')[1].split('/')[0],brief=briefs.find(b=>b.id===id);if(url.pathname.endsWith('/feedback')){if(body.read)reads++;Object.assign(brief,body);return send(route,{brief});}if(failDetail){failDetail=false;return send(route,{error:'测试：详情暂不可用'},503);}return send(route,{brief});}
  if(url.pathname.endsWith('/library'))return send(route,{items:url.searchParams.get('q')?[ ]:[{...source,type:'source',sourceKind:'article'}],total:url.searchParams.get('q')?0:1,hasMore:false});
  if(url.pathname.includes('/sources/'))return send(route,{source});
  return send(route,{});
 });
 await page.goto('http://127.0.0.1:5276/#/intel');await page.locator('.brief-card').first().waitFor();assert.equal(await page.locator('.brief-card').count(),8);assert.equal(await page.locator('.subnav[aria-label="情报下的页面"]').count(),0);
 await page.screenshot({path:path.join(shots,'01-feed-desktop-1440.png'),fullPage:true});
 await page.setViewportSize({width:1920,height:1080});await page.screenshot({path:path.join(shots,'02-feed-desktop-1920.png'),fullPage:true});await page.setViewportSize({width:1440,height:960});
 const cardTop=await page.locator('.brief-card').first().evaluate(el=>el.getBoundingClientRect().top);
 await page.getByRole('button',{name:'筛选情报'}).click();await page.getByRole('dialog',{name:'筛选情报'}).waitFor();
 await page.screenshot({path:path.join(shots,'03-filter-popover.png'),fullPage:true});
 assert.equal(await page.locator('.brief-card').first().evaluate(el=>el.getBoundingClientRect().top),cardTop,'筛选弹层不推动卡片');
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'筛选情报'}).count(),0);
 assert(await page.getByRole('button',{name:'筛选情报'}).evaluate(el=>el===document.activeElement),'Escape restores filter focus');
 await page.getByRole('button',{name:'查看更多（还有 2 条）',exact:true}).click();assert.equal(await page.locator('.brief-card').count(),10);
 const first=page.locator('[data-brief="b0"]');await first.locator('.brief-card__title').click();await page.getByText('测试：详情暂不可用',{exact:false}).waitFor();assert.equal(reads,0,'失败不标已读');await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.brief-peek .brief-reading-title, .brief-peek h1').first().waitFor();assert.equal(reads,1);await page.screenshot({path:path.join(shots,'04-reading-peek.png'),fullPage:true});
 await page.keyboard.press('Escape');await page.locator('.brief-peek').waitFor({state:'detached'});assert(await first.locator('.brief-card__title').evaluate(el=>el===document.activeElement),'Escape restores focus');await page.keyboard.press('Enter');await page.locator('.brief-peek').waitFor();await page.keyboard.press('ArrowDown');await page.locator('[data-brief="b1"].is-active').waitFor();await page.keyboard.press('Escape');await first.getByRole('button',{name:'收藏',exact:true}).click();assert.equal(briefs[0].saved,true);
 await first.getByRole('button',{name:'卡片操作'}).click();await first.getByRole('menuitem',{name:'忽略',exact:true}).click();await page.locator('[data-brief="b0"]').waitFor({state:'detached'});await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('[data-brief="b0"]').waitFor();assert.equal(briefs[0].dismissed,false);
 await first.getByRole('button',{name:'加入选题',exact:true}).click();await first.getByRole('button',{name:'✓ 已加入选题',exact:true}).waitFor();assert.match(page.url(),/#\/intel$/);assert.equal(operations.size,1);await page.reload();await first.getByRole('button',{name:'✓ 已加入选题',exact:true}).waitFor();await page.screenshot({path:path.join(shots,'06-topic-linked-state.png'),fullPage:true});await first.getByRole('button',{name:'✓ 已加入选题',exact:true}).click();await page.waitForURL(/#\/research/);assert(page.url().includes([...operations.values()][0]));assert.equal(operations.size,1);assert.equal(previews,0);await page.goto('http://127.0.0.1:5276/#/intel');await first.waitFor();
 await page.locator('[data-brief="b1"] input').check();await page.locator('[data-brief="b2"] input').check();await page.screenshot({path:path.join(shots,'05-multi-select.png'),fullPage:true});await page.getByRole('button',{name:'将所选情报加入一个选题',exact:true}).click();await page.waitForTimeout(150);assert.equal(lastIntent.briefIds.length,2);assert.equal(operations.size,2);
 await first.getByRole('button',{name:'卡片操作'}).click();await first.getByRole('menuitem',{name:'加入已有选题 / 补充想法',exact:true}).click();await page.getByLabel('保存到选题',{exact:true}).selectOption('existing');await page.getByLabel('我的选题想法',{exact:true}).fill('我想比较自己的工作流');await page.getByRole('button',{name:'保存选题',exact:true}).click();await page.waitForTimeout(150);assert.equal(lastIntent.researchId,'existing');assert.equal(lastIntent.notes,'我想比较自己的工作流');
 await first.locator('.brief-card__title').click();await page.getByRole('button',{name:'全屏打开',exact:true}).click();await page.getByRole('button',{name:'探索表达角度',exact:false}).click();await page.getByRole('button',{name:'带入选题',exact:true}).click();await page.waitForTimeout(150);assert.equal(lastIntent.angle.question,'这个改善能用于我的任务吗？');await page.getByRole('button',{name:'← 返回情报',exact:true}).click();await page.getByRole('button',{name:'关闭详情',exact:true}).click();assert.equal(await page.locator('.brief-card').count(),10);
 await page.reload();await page.locator('.brief-card').first().waitFor();assert.equal(await page.locator('.brief-card').count(),10);
 await page.goto('http://127.0.0.1:5276/#/intel-topics');await page.locator('.research-overview').waitFor();assert.match(page.url(),/#\/research/);assert.equal(previews,0);
 await page.goto('http://127.0.0.1:5276/#/intel-resources');await page.getByRole('heading',{name:'原始资料',exact:true}).waitFor();await page.locator('.intel-reader').waitFor();await page.getByRole('textbox',{name:'搜索原始资料'}).fill('无匹配');await page.getByRole('heading',{name:'没有匹配的原始资料'}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('http://127.0.0.1:5276/#/intel');await page.locator('.brief-card').first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'07-feed-mobile-390.png'),fullPage:true});await page.locator('[data-brief="b0"] .brief-card__title').click();await page.getByRole('button',{name:'关闭详情',exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'08-reading-mobile-390.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS unified UI: one reading flow, 8 + more, failed reads, save/undo, direct/idempotent/multi/existing/angle handoff, old route, raw search, mobile, reduced motion');
}catch(e){console.log(await page?.locator('body').innerText());throw e;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}assert(path.dirname(temp)===os.tmpdir());await fs.rm(temp,{recursive:true,force:true});}
