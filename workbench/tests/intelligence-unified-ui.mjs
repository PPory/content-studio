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
const briefs=Array.from({length:40},(_,i)=>({id:`b${i}`,title:`模型更新的实际变化 ${i+1}`,summary:i%3===0?'对照任务显示改善，真实工作流仍待核对。作者指出适用范围有限，尚需在日常写作和资料整理中复测。':'对照任务显示改善，真实工作流仍待核对。',whyItMatters:i%2?'可以核对来源的具体任务和样本。':'可用自己的重复任务做一次对照。',body:'原始说明表明模型在对照任务中改善。',uncertainties:['真实环境未验证'],evidence:[{sourceId:'raw1',quote:source.body}],sourceMeta:[source],sources:[source],sourceDocuments:[source],sourceCount:1,sourceGroups:i%2?['community']:['aihot'],editorialState:i===39?'needs_review':'ready',freshnessKind:'recent_event',read:false,saved:false,dismissed:false,version:1,researchLinks:[],reviewClusterId:i===1?'cluster-1':null}));
const feed=()=>({ok:true,briefs,featuredIds:briefs.slice(0,8).map(b=>b.id),recommendationIds:briefs.slice(0,38).map(b=>b.id),activeRuns:[],preferences:{directions:['AI 实践']},processing:{newCount:10,updatedCount:0,pending:0,failures:0,permissionRequired:intake&&!intake.consent.publicSources?1500:0},lastSuccessfulUpdate:'2026-09-22T09:00:00Z',...(intake?{intake}:{})});
let intake=null,settingsBody=null,deepenCalls=0,splitCalls=0;
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
  if(url.pathname.endsWith('/digest')){const kind=url.searchParams.get('kind');const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
   return send(route,kind==='builders'?{kind,total:1,inHot:0,hiddenOffTopic:2,days:[{day:today,items:[{id:'fb1',title:'I spend 2 hours a day building side projects',author:'nikunj',kind:'post',text:'I spend 2 hours a day building side projects with agents and it changed how I work.',zh:'每天花两小时用 Agent 做副业项目，改变了工作方式',url:'https://x.example/1',publishedAt:new Date().toISOString(),day:today,hot:null}]}]}
    :{kind,total:2,inHot:1,hiddenOffTopic:0,days:[{day:today,items:[{id:'sel1',title:'模型更新的实际变化 2',summary:'在热点里的一条',url:'https://a.example/1',publishedAt:new Date().toISOString(),day:today,hot:{briefId:'b1',title:'模型更新的实际变化 2'}},{id:'sel2',title:'Claude Code 澄清 Cloud sessions 按订阅计费',summary:'没进热点的一条',url:'https://a.example/2',publishedAt:new Date().toISOString(),day:today,hot:null}]}]});}
  if(url.pathname.endsWith('/deepen')){deepenCalls++;const e=briefs.find(b=>b.event);e.deepen={status:'running',stage:'正在补全 2 篇原文'};setTimeout(()=>{Object.assign(e,{depth:'deep',deepen:{status:'done'},summary:'Anthropic 发布 Opus 5.5，价格更低。',body:'深度解读正文：官方说明与第三方评测都提到价格下降。',
   keyFacts:[{text:'官方称每 token 价格更低',evidenceIds:['e1']}],evidence:[{sourceId:'s1',quote:'每token价格更低'}],sources:[{id:'s1',title:'Opus 5.5发布：沟通更好',url:'https://example.com/opus',provider:'aihot',readLevel:'original',quotes:[{number:1,quote:'每token价格更低'}]}],
   claims:[{id:'c1',text:'价格比上一代更低',kind:'author_report',attribution:'Anthropic',evidenceIds:['e1'],limitations:['没有第三方复测']}],uncertainties:['只有官方说明'],useFor:'要评估模型成本的人',notFor:'只用网页聊天的读者',
   angle:{direction:'讲清 Opus 5.5 的成本账',readerValue:'帮读者估算调用成本',needs:['官方价格表']},wiki:[{id:'wk1',title:'心理账户',relation:'explain',quote:'人们对事物变化幅度通常依靠比例感知',application:'「每 token 便宜 40%」是比例口径，读者该用自己每月的调用量算账单。',revision:1},{id:'wk-old',title:'商业目标',reason:'关联商业目标与变现路径规划'}]});},1500);return send(route,{deepen:e.deepen});}
  if(url.pathname.endsWith('/split')){splitCalls++;const e=briefs.find(b=>b.id==='ev1');e.event.members=e.event.members.filter(m=>!body.sourceIds.includes(m.sourceId));return send(route,{brief:e,moved:body.sourceIds});}
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
 // 一个热点页：没有「今天值得做」页签；一批 30 条，滚到底自动加载。
 await page.goto('http://127.0.0.1:5276/#/intel');await page.locator('.brief-card').first().waitFor();assert.equal(await page.locator('.brief-card').count(),30);
 assert.equal(await page.getByRole('tab',{name:'今天值得做'}).count(),0);await page.getByRole('tab',{name:'热点',exact:true}).waitFor();
 // 同一排的卡片顶边、标题、底行对齐。
 const rowAlign=await page.locator('.brief-card').evaluateAll(cards=>cards.slice(0,3).map(c=>['','.brief-card__title','.intel-card__foot'].map(s=>Math.round((s?c.querySelector(s):c).getBoundingClientRect().top))));
 assert(rowAlign.every(r=>r.every((v,i)=>Math.abs(v-rowAlign[0][i])<=1)),'同一排卡片对齐：'+JSON.stringify(rowAlign));assert.equal(await page.locator('.subnav[aria-label="情报下的页面"]').count(),0);
 await page.screenshot({path:path.join(shots,'01-feed-desktop-1440.png'),fullPage:true});
 await page.setViewportSize({width:1920,height:1080});await page.screenshot({path:path.join(shots,'02-feed-desktop-1920.png'),fullPage:true});await page.setViewportSize({width:1440,height:960});
 const cardTop=await page.locator('.brief-card').first().evaluate(el=>el.getBoundingClientRect().top);
 await page.getByRole('button',{name:'筛选情报'}).click();await page.getByRole('dialog',{name:'筛选情报'}).waitFor();
 await page.screenshot({path:path.join(shots,'03-filter-popover.png'),fullPage:true});
 assert.equal(await page.locator('.brief-card').first().evaluate(el=>el.getBoundingClientRect().top),cardTop,'筛选弹层不推动卡片');
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'筛选情报'}).count(),0);
 assert(await page.getByRole('button',{name:'筛选情报'}).evaluate(el=>el===document.activeElement),'Escape restores filter focus');
 await page.locator('.unified-more').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelectorAll('.brief-card').length===38);await page.getByText('已显示全部 38 条',{exact:true}).waitFor();await page.evaluate(()=>{document.querySelector('.main')?.scrollTo(0,0);window.scrollTo(0,0);});
 const first=page.locator('[data-brief="b0"]');await first.locator('.brief-card__title').click();await page.getByText('测试：详情暂不可用',{exact:false}).waitFor();assert.equal(reads,0,'失败不标已读');await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.brief-peek .brief-reading-title, .brief-peek h1').first().waitFor();assert.equal(reads,1);await page.screenshot({path:path.join(shots,'04-reading-peek.png'),fullPage:true});
 await page.keyboard.press('Escape');await page.locator('.brief-peek').waitFor({state:'detached'});assert(await first.locator('.brief-card__title').evaluate(el=>el===document.activeElement),'Escape restores focus');await page.keyboard.press('Enter');await page.locator('.brief-peek').waitFor();await page.keyboard.press('ArrowDown');await page.locator('[data-brief="b1"].is-active').waitFor();await page.keyboard.press('Escape');await first.getByRole('button',{name:'收藏',exact:true}).click();assert.equal(briefs[0].saved,true);
 await first.getByRole('button',{name:'卡片操作'}).click();assert.equal(await first.getByRole('menuitem',{name:/^加入已有选题…/}).evaluate(el=>el.querySelector('span').getBoundingClientRect().height<=26),true,'菜单项的动作名不折行');await first.getByRole('menuitem',{name:/^不感兴趣/}).click();await page.locator('[data-brief="b0"]').waitFor({state:'detached'});await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('[data-brief="b0"]').waitFor();assert.equal(briefs[0].dismissed,false);
 await first.getByRole('button',{name:'加入选题',exact:true}).click();await first.getByRole('button',{name:'已加入选题',exact:true}).waitFor();assert.match(page.url(),/#\/intel$/);assert.equal(operations.size,1);await page.reload();await first.getByRole('button',{name:'已加入选题',exact:true}).waitFor();await page.screenshot({path:path.join(shots,'06-topic-linked-state.png'),fullPage:true});await first.getByRole('button',{name:'已加入选题',exact:true}).click();await page.waitForURL(/#\/research/);assert(page.url().includes([...operations.values()][0]));assert.equal(operations.size,1);assert.equal(previews,0);await page.goto('http://127.0.0.1:5276/#/intel');await first.waitFor();
 await page.locator('[data-brief="b1"] input').check();await page.locator('[data-brief="b2"] input').check();await page.screenshot({path:path.join(shots,'05-multi-select.png'),fullPage:true});await page.getByRole('button',{name:'将所选情报加入一个选题',exact:true}).click();await page.waitForTimeout(150);assert.equal(lastIntent.briefIds.length,2);assert.equal(operations.size,2);
 await first.getByRole('button',{name:'卡片操作'}).click();await first.getByRole('menuitem',{name:/^加入已有选题…/}).click();await page.getByLabel('保存到选题',{exact:true}).selectOption('existing');await page.getByLabel('我的选题想法',{exact:true}).fill('我想比较自己的工作流');await page.getByRole('button',{name:'保存选题',exact:true}).click();await page.waitForTimeout(150);assert.equal(lastIntent.researchId,'existing');assert.equal(lastIntent.notes,'我想比较自己的工作流');
 await first.locator('.brief-card__title').click();await page.getByRole('button',{name:'全屏打开',exact:true}).click();await page.getByRole('button',{name:'探索表达角度',exact:false}).click();await page.getByRole('button',{name:'带入选题',exact:true}).click();await page.waitForTimeout(150);assert.equal(lastIntent.angle.question,'这个改善能用于我的任务吗？');await page.getByRole('button',{name:'← 返回情报',exact:true}).click();await page.getByRole('button',{name:'关闭详情',exact:true}).click();assert.equal(await page.locator('.brief-card').count(),38);
 await page.reload();await page.locator('.brief-card').first().waitFor();assert.equal(await page.locator('.brief-card').count(),38,'刷新后保留已加载的条数');
 await page.goto('http://127.0.0.1:5276/#/intel-topics');await page.locator('.research-overview').waitFor();assert.match(page.url(),/#\/research/);assert.equal(previews,0);
 await page.goto('http://127.0.0.1:5276/#/intel-resources');await page.getByRole('heading',{name:'原始资料',exact:true}).waitFor();await page.locator('.intel-reader').waitFor();await page.getByRole('textbox',{name:'搜索原始资料'}).fill('无匹配');await page.getByRole('heading',{name:'没有匹配的原始资料'}).waitFor();
 // 热点事件卡：卡面是来源数和讨论数；点开先看 AI 概要和来源，深度解读自动生成、完成后替换。
 const eventBrief={id:'ev1',researchLinks:[],title:'Anthropic 发布 Claude Opus 5.5',summary:'多家媒体报道新模型发布，价格低于上一代。',whyItMatters:'影响模型选型和成本',editorialState:'ready',read:false,saved:false,depth:'headline',evidence:[],sourceMeta:[{provider:'aihot',originKind:'external'}],primaryDate:'2026-09-22T18:00:00Z',
  event:{kind:'event',creation:{value:'high',window:'24h',angle:'讲清 Opus 5.5 贵在哪便宜在哪',reason:'英文圈刚发布，中文报道还少'},heat:30,sourceCount:23,discussionCount:16,latestAt:'2026-09-22T18:00:00Z',members:[{sourceId:'s1',title:'Opus 5.5发布：沟通更好',url:'https://example.com/opus',publisher:'X：Claude',platform:'aihot',publishedAt:'2026-09-22T18:00:00Z',kind:'external_digest'},{sourceId:'s3',title:'Anthropic releases Claude Opus 5.5',url:'https://example.com/opus-en',publisher:'The Verge',platform:'web',publishedAt:'2026-09-22T18:30:00Z',kind:'article'},{sourceId:'s2',title:'Opus 5.5 is great at long refactors',url:'https://reddit.example/opus',platform:'reddit',publishedAt:'2026-09-22T19:00:00Z',kind:'post',score:250,comments:80}]}};
 briefs.unshift(eventBrief);await page.goto('http://127.0.0.1:5276/#/intel');await page.reload();
 const eventCard=page.locator('[data-brief="ev1"]');await eventCard.waitFor();
 const eventText=await eventCard.innerText();
 assert.match(eventText,/23 个来源 · 16 条讨论/);assert.match(eventText,/值得做/);assert.match(eventText,/抢时效/);assert.doesNotMatch(eventText,/很值得做|信息差|可上手|适合：/,'不再摆评级标签和平台');
 assert.equal(await eventCard.locator('.intel-mark.is-worth').count(),1,'高价值事件标「值得做」');assert.equal(await page.locator('.intel-mark.is-worth').count(),1,'其它卡不标');
 // 点开：左边换成窄目录，右边是宽预览。
 await eventCard.locator('.brief-card__title').click();const peek=page.locator('.brief-peek');await peek.getByText('AI 概要',{exact:true}).waitFor();
 const widths=await page.evaluate(()=>({index:document.querySelector('.intel-index').getBoundingClientRect().width,peek:document.querySelector('.brief-peek').getBoundingClientRect().width}));
 assert(widths.index<=400&&widths.peek>=700,'目录窄、预览宽：'+JSON.stringify(widths));assert.equal(await page.locator('.brief-card').count(),0,'目录不是卡片');
 // 详情结构：发生了什么 → 具体怎么回事 → 依据与边界 → （与已有知识的连接）→ 有什么用，可以怎么继续。
 const parts=()=>peek.locator('.event-reading__part > h3').evaluateAll(els=>els.map(e=>e.textContent.replace('AI 概要','').trim()));
 assert.deepEqual(await parts(),['发生了什么','具体怎么回事','依据与边界','有什么用，可以怎么继续'],JSON.stringify(await parts()));
 await page.waitForTimeout(600);assert.equal(deepenCalls,0,'打开详情不自动深读');
 await peek.getByText('深入解读会补全原文',{exact:false}).waitFor();
 // 时效只是建议，不叫截止。
 await peek.getByText('建议 24 小时内',{exact:false}).waitFor();assert.doesNotMatch(await peek.innerText(),/截止/);
 // 前 3 个来源直接可见，全部来源与讨论折叠。
 assert.equal(await peek.getByRole('heading',{name:'报道（2）'}).isVisible(),false,'全部来源默认折叠');
 await peek.getByText('全部来源与讨论',{exact:true}).click();await peek.getByRole('heading',{name:'报道（2）'}).waitFor();await peek.getByRole('heading',{name:'大家怎么说（1）'}).waitFor();await peek.getByText('250 赞',{exact:false}).waitFor();
 // 移出：先在提示条里确认，再调用接口。
 await peek.getByRole('button',{name:'移出这件事'}).first().click();assert.equal(splitCalls,0,'先在原处确认');
 await peek.getByRole('button',{name:'确认移出',exact:true}).click();await page.getByText('已移出',{exact:false}).waitFor();assert.equal(splitCalls,1);
 await page.screenshot({path:path.join(shots,'13-event-peek.png'),fullPage:false});
 // 点「深入解读」才生成，显示真实阶段。
 await peek.getByRole('button',{name:'深入解读',exact:true}).click();await peek.getByText('正在补全 2 篇原文',{exact:false}).waitFor();assert.equal(deepenCalls,1);
 await peek.getByText('深度解读正文',{exact:false}).waitFor({timeout:15000});assert.equal(deepenCalls,1,'生成中不重复请求');
 await peek.getByText('官方称每 token 价格更低',{exact:false}).waitFor();
 await peek.getByRole('button',{name:'查看引文 1'}).first().click();await peek.getByText('读取了全文',{exact:false}).waitFor();
 await peek.getByRole('heading',{name:'来源自己的判断'}).waitFor();await peek.getByRole('heading',{name:'仍缺的证据'}).waitFor();
 assert.deepEqual(await parts(),['发生了什么','具体怎么回事','依据与边界','与你已有知识的连接','有什么用，可以怎么继续'],'有知识连接时才出现那一段');
 await peek.getByText('解释',{exact:true}).waitFor();await peek.getByText('知识库只说明你整理过相关内容',{exact:false}).waitFor();
 await peek.getByText('你的笔记：',{exact:false}).waitFor();await peek.getByText('由此形成的切入方向',{exact:true}).waitFor();
 assert.equal(await peek.getByText('《商业目标》',{exact:false}).count(),0,'没有原话的旧式连接不显示');
 assert.equal(await peek.getByText('切入方向：',{exact:false}).count(),0,'有连接时切入方向只在连接段末尾出现一次');
 await page.screenshot({path:path.join(shots,'16-event-deep.png'),fullPage:false});
 await peek.getByText('由此形成的切入方向',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,'17-event-wiki-lens.png'),fullPage:false});
 await peek.getByRole('button',{name:'按这个方向加入选题',exact:true}).click();
 await page.waitForTimeout(300);assert.deepEqual(lastIntent.creation,{angle:'讲清 Opus 5.5 的成本账',window:'24h',readerValue:'帮读者估算调用成本',needs:['官方价格表']},'深读过的用深读里的方向、读者价值和待补材料');
 await page.keyboard.press('Escape');await peek.waitFor({state:'detached'});
 // 只看值得做：筛选里的一项，不是单独页签。
 await page.getByRole('button',{name:'筛选情报'}).click();await page.getByLabel('只看值得做').check();await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelectorAll('.brief-card').length===1);await page.getByRole('button',{name:'筛选情报'}).click();await page.getByLabel('只看值得做').uncheck();await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px 无横向滚动');await page.screenshot({path:path.join(shots,'15-cards-mobile-390.png'),fullPage:false});await page.setViewportSize({width:1440,height:960});
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
 // 已收藏：常驻「移出收藏」，移出后可撤销；卡片菜单里没有「不感兴趣」。筛选里不再有关注方向。
 await page.getByRole('tab',{name:'已收藏',exact:true}).click();const savedCard=page.locator('[data-brief="b3"]');await savedCard.waitFor();
 await savedCard.getByRole('button',{name:'移出收藏',exact:true}).click();await savedCard.waitFor({state:'detached'});assert.equal(briefs.find(b=>b.id==='b3').saved,false);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await savedCard.waitFor();assert.equal(briefs.find(b=>b.id==='b3').saved,true);
 await savedCard.getByRole('button',{name:'卡片操作'}).click();await savedCard.getByRole('menuitem',{name:/^移出收藏/}).waitFor();assert.equal(await savedCard.getByRole('menuitem',{name:/^不感兴趣/}).count(),0,'收藏页没有不感兴趣');
 await page.screenshot({path:path.join(shots,'18-saved-menu.png'),fullPage:false});await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'筛选情报'}).click();assert.equal(await page.getByRole('button',{name:'设置关注方向'}).count(),0,'关注方向是设置，不在筛选里');await page.keyboard.press('Escape');
 await page.getByRole('tab',{name:'热点',exact:true}).click();await page.locator('.brief-card').first().waitFor();
 // 速览：AIhot 精选 / Follow Builders；「在热点里」切回热点并打开那张卡；没进热点的可以加入选题。
 await page.getByRole('tab',{name:'速览',exact:true}).click();await page.getByText('Claude Code 澄清 Cloud sessions 按订阅计费').waitFor();
 assert.equal(await page.getByRole('button',{name:'筛选情报'}).count(),0,'速览里没有筛选');
 await page.getByLabel('只看没进热点的').check();assert.equal(await page.getByText('模型更新的实际变化 2',{exact:true}).count(),0,'只看没进热点的');await page.getByLabel('只看没进热点的').uncheck();
 await page.getByRole('button',{name:'加入选题',exact:true}).first().click();await page.getByRole('dialog',{name:'带入选题'}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'Follow Builders',exact:true}).click();await page.getByText('每天花两小时用 Agent 做副业项目',{exact:false}).waitFor();await page.getByText('@nikunj').waitFor();
 await page.screenshot({path:path.join(shots,'19-digest-builders.png'),fullPage:false});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'速览 390px 无横向滚动');await page.setViewportSize({width:1440,height:960});
 await page.getByRole('button',{name:'AIhot 精选',exact:true}).click();await page.getByRole('button',{name:'在热点里 →'}).click();
 await page.locator('.brief-peek').waitFor();await page.getByRole('tab',{name:'热点',exact:true,selected:true}).waitFor();await page.locator('[data-brief="b1"].is-active').waitFor();
 await page.keyboard.press('Escape');await page.locator('.brief-peek').waitFor({state:'detached'});
 // 未授权：状态行说清楚缺口，一次确认后开始整理；工具菜单出现自动更新开关。
 intake={consent:{publicSources:false,reddit:false,at:null},autoUpdate:true,redditApproved:false,reddit:null};await page.reload();await page.getByText('最近 7 天采到 1500 条新资料，还没授权交给模型整理').waitFor();
 await page.getByRole('button',{name:'允许并开始整理',exact:true}).first().click();const consentDialog=page.getByRole('dialog',{name:'AI 整理授权'});await consentDialog.waitFor();await consentDialog.getByText('Reddit 需要先在「设置」里批准付费采集',{exact:false}).waitFor();
 await page.screenshot({path:path.join(shots,'09-consent-dialog.png'),fullPage:false});
 await consentDialog.getByRole('button',{name:'允许并开始整理',exact:true}).click();await consentDialog.waitFor({state:'detached'});assert.deepEqual(settingsBody,{publicSources:true,reddit:false,autoUpdate:true});
 await page.getByText('已开始更新情报',{exact:false}).waitFor();assert.equal(await page.getByText('还没授权交给模型整理',{exact:false}).count(),0);
 await page.getByRole('button',{name:'情报工具'}).click();const toolsText=await page.locator('.intel-nav-menu').innerText();assert.match(toolsText,/原始资料[\s\S]*关注方向…/);assert.doesNotMatch(toolsText,/信源设置|每周回顾|AIhot 原始信息流|处理详情/,'不起作用和排查用的入口从菜单去掉');await page.getByRole('menuitemcheckbox',{name:'✓ 自动更新（每 6 小时）'}).click();await page.waitForTimeout(100);assert.deepEqual(settingsBody,{autoUpdate:false});
 intake={...intake,reddit:{healthStatus:'QUOTA_EXHAUSTED'}};await page.reload();await page.getByText('Reddit 额度不足，社区内容暂由 Hacker News 补位',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'查看详情'}).count(),0,'状态行就地说明，不跳处理详情');intake=null;
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('http://127.0.0.1:5276/#/intel');await page.locator('.brief-card').first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'07-feed-mobile-390.png'),fullPage:true});await page.locator('[data-brief="b0"] .brief-card__title').click();await page.getByRole('button',{name:'关闭详情',exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'08-reading-mobile-390.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS unified UI: digest tab (AIhot selected / Follow Builders, jump to hot card, add to topic), one hot page with marks, aligned cards, infinite scroll, narrow index + wide preview, manual deep read with real stage, evidence layers, citations, wiki connections, split, suggested timing, AI consent + auto update + Reddit quota status, failed reads, save/undo, direct/idempotent/multi/existing/angle handoff, old route, raw search, mobile, reduced motion');
}catch(e){console.log(await page?.locator('body').innerText());throw e;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}assert(path.dirname(temp)===os.tmpdir());await fs.rm(temp,{recursive:true,force:true});}
