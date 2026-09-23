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
const feed=()=>({ok:true,briefs,featuredIds:briefs.slice(0,8).map(b=>b.id),recommendationIds:briefs.slice(0,10).map(b=>b.id),opportunityIds:briefs.filter(b=>b.event?.creation&&b.event.creation.value!=='low').map(b=>b.id),activeRuns:[],preferences:{directions:['AI 实践']},processing:{newCount:10,updatedCount:0,pending:0,failures:0,permissionRequired:intake&&!intake.consent.publicSources?1500:0},lastSuccessfulUpdate:'2026-09-22T09:00:00Z',...(intake?{intake}:{})});
let intake=null,settingsBody=null,deepenCalls=0;
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
  if(url.pathname.endsWith('/deepen')){deepenCalls++;const e=briefs.find(b=>b.event);e.deepen={status:'running'};setTimeout(()=>{Object.assign(e,{depth:'deep',deepen:{status:'done'},body:'## 发生了什么\n\n深度解读正文：官方说明与第三方评测都提到价格下降。'});},1500);return send(route,{deepen:e.deepen});}
  if(url.pathname.endsWith('/feed/settings')){settingsBody=body;intake={...intake,consent:{publicSources:body.publicSources??intake.consent.publicSources,reddit:body.reddit??intake.consent.reddit},autoUpdate:body.autoUpdate??intake.autoUpdate};return send(route,{intake,run:body.publicSources?{id:'r2',status:'queued'}:null});}
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
 // 默认是「今天值得做」；这里的夹具没有创作判断，先如实显示空状态，再去「全部热点」。
 await page.goto('http://127.0.0.1:5276/#/intel');await page.getByRole('heading',{name:'今天没有特别值得做的'}).waitFor();
 await page.getByRole('button',{name:'看全部热点',exact:true}).click();await page.locator('.brief-card').first().waitFor();assert.equal(await page.locator('.brief-card').count(),8);assert.equal(await page.locator('.subnav[aria-label="情报下的页面"]').count(),0);
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
 // 热点事件卡：卡面是来源数和讨论数；点开先看 AI 概要和来源，深度解读自动生成、完成后替换。
 const eventBrief={id:'ev1',researchLinks:[],title:'Anthropic 发布 Claude Opus 5.5',summary:'多家媒体报道新模型发布，价格低于上一代。',whyItMatters:'影响模型选型和成本',editorialState:'ready',read:false,saved:false,depth:'headline',evidence:[],sourceMeta:[{provider:'aihot',originKind:'external'}],primaryDate:'2026-09-22T18:00:00Z',
  event:{kind:'event',creation:{value:'high',window:'24h',angle:'讲清 Opus 5.5 贵在哪便宜在哪',reason:'英文圈刚发布，中文报道还少'},heat:30,sourceCount:23,discussionCount:16,latestAt:'2026-09-22T18:00:00Z',members:[{sourceId:'s1',title:'Opus 5.5发布：沟通更好',url:'https://example.com/opus',publisher:'X：Claude',platform:'aihot',publishedAt:'2026-09-22T18:00:00Z',kind:'external_digest'},{sourceId:'s2',title:'Opus 5.5 is great at long refactors',url:'https://reddit.example/opus',platform:'reddit',publishedAt:'2026-09-22T19:00:00Z',kind:'post',score:250,comments:80}]}};
 briefs.unshift(eventBrief);await page.goto('http://127.0.0.1:5276/#/intel');await page.reload();
 const eventCard=page.locator('[data-brief="ev1"]');await eventCard.waitFor();
 assert.match(await eventCard.innerText(),/23 个来源 · 16 条讨论/);assert.match(await eventCard.innerText(),/抢时效/,"卡片顶行只留抢时效");assert.doesNotMatch(await eventCard.innerText(),/很值得做|适合：/);
 await eventCard.locator('.brief-card__title').click();const peek=page.locator('.brief-peek');await peek.getByText('AI 概要',{exact:true}).waitFor();
 await peek.getByRole('heading',{name:'来源（1）'}).waitFor();await peek.getByRole('heading',{name:'大家怎么说（1）'}).waitFor();await peek.getByText('250 赞',{exact:false}).waitFor();
 await peek.getByText('正在生成深度解读',{exact:false}).waitFor();assert.equal(deepenCalls,1,'打开时自动生成一次');
 await page.screenshot({path:path.join(shots,'13-event-peek.png'),fullPage:false});
 await peek.getByText('深度解读正文',{exact:false}).waitFor({timeout:15000});assert.equal(deepenCalls,1,'生成中不重复请求');
 await page.keyboard.press('Escape');await peek.waitFor({state:'detached'});
 // 今天值得做：带序号的清单，标题、切入角度、理由；只有「抢时效」一个标签；悬停出现加入选题。
 await page.getByRole('tab',{name:'今天值得做'}).click();
 const today=page.locator('[data-brief="ev1"]');await today.waitFor();const todayText=await today.innerText();
 assert.equal(await page.locator('.intel-today__item').count(),1,'只放有创作价值的事件');assert.equal(await page.locator('.brief-card').count(),0,'不是宫格');
 assert.match(todayText,/^1/);assert.match(todayText,/切入：讲清 Opus 5\.5/);assert.match(todayText,/英文圈刚发布，中文报道还少 · 23 个来源 · 16 条讨论/);assert.match(todayText,/抢时效/);
 assert.doesNotMatch(todayText,/很值得做|信息差|可上手|适合：/,'不再摆评级标签和平台');assert.equal(await page.locator('.intel-platforms').count(),0,'没有平台筛选');
 assert.equal(await page.getByRole('group',{name:'显示方式'}).count(),0,'清单不提供卡片/列表切换');
 await today.hover();await page.screenshot({path:path.join(shots,'14-today-desktop-1440.png'),fullPage:false});
 await today.getByRole('button',{name:'加入选题',exact:true}).click();
 await page.waitForTimeout(300);assert.deepEqual(lastIntent.creation,{angle:'讲清 Opus 5.5 贵在哪便宜在哪',window:'24h'},'加入选题带上切入角度和时效');
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'今天值得做 390px 无横向滚动');await page.screenshot({path:path.join(shots,'15-today-mobile-390.png'),fullPage:false});await page.setViewportSize({width:1440,height:960});
 await page.getByRole('tab',{name:'全部热点'}).click();
 briefs.shift();
 // 卡片 / 列表双模式：和选题页同一颗开关，刷新后保持；列表行同样能收藏、加入选题。
 await page.goto('http://127.0.0.1:5276/#/intel');await page.locator('.brief-card').first().waitFor();
 const cardBox=await page.locator('.brief-card').first().boundingBox();assert(cardBox.height<260,'卡片高度对齐选题页，不再是大卡：'+cardBox.height);
 await page.getByRole('button',{name:'列表视图',exact:true}).click();await page.locator('.brief-row').first().waitFor();assert.equal(await page.locator('.brief-card').count(),0);
 await page.screenshot({path:path.join(shots,'10-list-desktop-1440.png'),fullPage:false});
 await page.reload();await page.locator('.brief-row').first().waitFor();assert.equal(await page.locator('.brief-card').count(),0,'刷新后保持列表模式');
 const listRow=page.locator('[data-brief="b3"]');await listRow.hover();await listRow.getByRole('button',{name:'收藏',exact:true}).click();await listRow.getByRole('button',{name:'已收藏',exact:true}).waitFor();
 await listRow.locator('.brief-row__open').click();await page.locator('.brief-peek').waitFor();await page.keyboard.press('Escape');await page.locator('.brief-peek').waitFor({state:'detached'});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'列表模式 390px 无横向滚动');await page.screenshot({path:path.join(shots,'11-list-mobile-390.png'),fullPage:false});await page.setViewportSize({width:1440,height:960});
 await page.getByRole('button',{name:'卡片视图',exact:true}).click();await page.locator('.brief-card').first().waitFor();await page.screenshot({path:path.join(shots,'12-card-desktop-1440.png'),fullPage:false});
 // 未授权：状态行说清楚缺口，一次确认后开始整理；工具菜单出现自动更新开关。
 intake={consent:{publicSources:false,reddit:false,at:null},autoUpdate:true,redditApproved:false,reddit:null};await page.reload();await page.getByText('最近 7 天采到 1500 条新资料，还没授权交给模型整理').waitFor();
 await page.getByRole('button',{name:'允许并开始整理',exact:true}).first().click();const consentDialog=page.getByRole('dialog',{name:'AI 整理授权'});await consentDialog.waitFor();await consentDialog.getByText('Reddit 需要先在「设置」里批准付费采集',{exact:false}).waitFor();
 await page.screenshot({path:path.join(shots,'09-consent-dialog.png'),fullPage:false});
 await consentDialog.getByRole('button',{name:'允许并开始整理',exact:true}).click();await consentDialog.waitFor({state:'detached'});assert.deepEqual(settingsBody,{publicSources:true,reddit:false,autoUpdate:true});
 await page.getByText('已开始更新情报',{exact:false}).waitFor();assert.equal(await page.getByText('还没授权交给模型整理',{exact:false}).count(),0);
 await page.getByRole('button',{name:'情报工具'}).click();await page.getByRole('menuitemcheckbox',{name:'✓ 自动更新（每 6 小时）'}).click();await page.waitForTimeout(100);assert.deepEqual(settingsBody,{autoUpdate:false});
 intake={...intake,reddit:{healthStatus:'QUOTA_EXHAUSTED'}};await page.reload();await page.getByText('Reddit 额度不足，社区内容暂由 Hacker News 补位').waitFor();intake=null;
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('http://127.0.0.1:5276/#/intel');await page.locator('.brief-card').first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'07-feed-mobile-390.png'),fullPage:true});await page.locator('[data-brief="b0"] .brief-card__title').click();await page.getByRole('button',{name:'关闭详情',exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'08-reading-mobile-390.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS unified UI: one reading flow, AI consent + auto update + Reddit quota status, 8 + more, failed reads, save/undo, direct/idempotent/multi/existing/angle handoff, old route, raw search, mobile, reduced motion');
}catch(e){console.log(await page?.locator('body').innerText());throw e;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}assert(path.dirname(temp)===os.tmpdir());await fs.rm(temp,{recursive:true,force:true});}
