import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { workbenchApi } from "../server/vite-plugin-workbench.mjs";
const ROOT=path.resolve(import.meta.dirname,"..");
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"xenho-intelligence-feed-ui-"));
const vars={XENHO_HOME:path.join(temp,"Xenho"),WB_KEEP_ALIVE:"1",HTTP_PROXY:"http://127.0.0.1:9",HTTPS_PROXY:"http://127.0.0.1:9",NO_PROXY:"127.0.0.1,localhost"};
const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);let pw;
for(const root of [ROOT,"C:/Users/Lenovo",process.env.APPDATA && path.join(process.env.APPDATA,"npm","node_modules")].filter(Boolean)){try{pw=require(require.resolve("playwright",{paths:[root]}));break;}catch{}}
assert(pw,"Playwright available");
let server,browser,page;
const stamp=new Date().toISOString().slice(0,10);
const base="http://127.0.0.1:5242";
const state={ok:true,briefs:[{id:"brief-one",title:"模型更新后，哪些变化影响实际使用？",summary:"先核对真实变化，再看它们对日常任务的影响。",reason:"与你关注的 AI 使用方式有关。",body:"## 发生了什么\n\n这是一条隔离测试的 AI 解读。\n\n## 可以怎么用\n\n先用熟悉的任务比较结果。",technical:"细节默认折叠。",confidence:"reliable",kind:"update",editionDate:stamp,read:false,saved:false,helpful:false,sources:[{id:"source-one",title:"模型官方说明（测试）",body:"仅用于测试的公开原文。",quotes:[{number:1,quote:"第一段原文引文"},{number:2,quote:"第二段原文引文"},{number:3,quote:"第三段原文引文"}],url:"https://example.com/model"}],sourceMeta:[{id:"source-one",provider:"x",publishedAt:"2026-09-07T01:00:00Z",collectedAt:"2026-09-08T02:00:00Z"}],publicationRange:{from:"2026-09-07T01:00:00Z",to:"2026-09-07T01:00:00Z",knownCount:1,unknownCount:0},scopeId:"intelligence:brief-one",conversations:[]},{id:"brief-watch",title:"一个值得继续观察的新用法",summary:"目前只有初步线索。",reason:"可能带来新的创作方法。",body:"线索尚未验证。",confidence:"watch",editionDate:stamp,read:false,saved:false,sources:[]},{id:"brief-earlier",title:"上期还没读完的内容",summary:"留到有时间再看。",reason:"保留阅读连续性。",confidence:"reliable",editionDate:"2026-09-01",read:false,saved:false,sources:[]}],reports:[],blockedSources:[],preferences:{directions:["AI 模型进展"],pilotOnly:true},activeRuns:[],latestEditionDate:stamp,unreadEarlierCount:1};
state.briefs.forEach(brief=>{brief.editorialState="ready";brief.freshnessKind="recent_event";});
state.briefs[0].version=1;
state.featuredIds=["brief-one","brief-watch"];
state.preferences.nativeSocialEnabled=true;
state.latestRun={id:"test-run",status:"done",briefCount:2,window:{start:"2026-09-01T00:00:00Z",end:"2026-09-08T00:00:00Z"},sourceStats:[{provider:"x",acquisitionMethod:"brightdata",collected:3,adopted:1}],coverage:[{provider:"x",targets:["karpathy","swyx"]}]};
state.briefs[0].sourceDocuments=[{...state.briefs[0].sources[0],records:[state.briefs[0].sources[0],{id:"second-comment",contentKind:"comment",author:"另一位讨论者",body:"另一位作者的评论保留在同一资料下。"}]}];
state.briefs[0].analysis={focus:"模型如何改善任务",documentCount:2};
let explores=0,angleMode="error";
let merged=null,refreshes=0,failDetailOnce=true;
const topics=[];
let candidate;
try{
 server=await createServer({root:ROOT,configFile:false,plugins:[react(),workbenchApi({XENHO_HOME:vars.XENHO_HOME})],server:{host:"127.0.0.1",port:5242,strictPort:true,open:false},logLevel:"error"});await server.listen();browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route('**/api/assistant/conversations**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,conversations:[]})}));
 await page.route("**/api/workspace/intelligence/**",async route=>{const req=route.request(),url=new URL(req.url()),body=req.method()==="GET"?{}:req.postDataJSON();let result={ok:true};
 if(url.pathname.endsWith("/topics/preview")){candidate={workingTitle:"怎样判断模型改善了创作？",audience:"希望验证效果的创作者",angle:"验证熟悉任务",deliverable:"任务对照方法",whyNow:"模型变化",evidenceGaps:["补充一次任务对照"],researchTasks:["执行对照"],nonClaims:[],readiness:"needs_evidence",briefIds:body.briefIds,sourceHashes:{"source-one":"fixture"},briefVersions:{"brief-one":1},evidence:[{sourceId:"source-one",quote:"仅用于测试的公开原文。"}]};result={ok:true,candidate};}
 else if(url.pathname.endsWith("/topics") && req.method()==="GET")result={ok:true,opportunities:topics,cards:[]};
 else if(url.pathname.endsWith("/topics")){assert.equal(body.confirmed,true);merged=body.candidate;topics.splice(0,topics.length,{...body.candidate,id:"topic-test",kind:"intel"});result={ok:true,opportunity:topics[0]};}
 else if(url.pathname.endsWith("/start")){assert.equal(body.confirmed,true);result={ok:true,research:{id:"research-merged"}};}
 else if(url.pathname.endsWith("/feed"))result=state;
 else if(url.pathname.endsWith("/feed/refresh")){refreshes++;result={ok:true,run:{id:"run-one"}};}
 else if(url.pathname.endsWith("/angles")){explores++;if(angleMode==="error"){angleMode="success";await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"模拟探索暂不可用"})});return;}if(angleMode==="empty"){await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,version:1,angles:[]})});return;}result={ok:true,version:1,angles:[{question:"怎样判断模型改善了创作？",audience:"希望验证效果的创作者",connection:"暂无个人实践，可以从熟悉的任务出发",gap:"补充一次任务对照",evidence:[{sourceId:"source-one",title:"测试原文",quote:"仅用于测试的公开原文。"}]}]};}
 else if(url.pathname.includes("/briefs/")){const id=url.pathname.split("/briefs/")[1].split("/")[0],brief=state.briefs.find(b=>b.id===id);if(req.method()==="GET"&&failDetailOnce){failDetailOnce=false;await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"模拟详情暂不可用"})});return;}if(url.pathname.endsWith("/feedback"))Object.assign(brief,body);result={ok:true,brief};}
 else if(url.pathname.endsWith("/preferences")){state.preferences={...state.preferences,...body};}
 else if(url.pathname.endsWith("/reports")){const report={id:"report-one",title:"这一周的变化与实践",body:"## 本周回顾\n\n完整周报内容。",periodStart:"2026-09-01",periodEnd:stamp,evidence:[{sourceId:"source-one",title:"周报测试出处",url:"https://example.com/model",quote:"仅用于测试的公开原文。"}]};state.reports.push(report);result={ok:true,report};}
 else if(url.pathname.endsWith("/merge")){merged=body;result={ok:true,research:{id:"research-merged"}};}
 await route.fulfill({contentType:"application/json",body:JSON.stringify(result)});});
 await page.goto(base+"/#/intel");await page.getByRole('tab',{name:'全部热点',exact:true}).click();assert.equal(refreshes,0,'打开首页不自动采集');
 await page.getByRole('button',{name:'更新情报',exact:true}).click();await page.getByText('正在更新情报，已有内容仍可阅读',{exact:true}).waitFor();assert.equal(refreshes,1);
 await page.locator('.brief-card__title').filter({hasText:state.briefs[0].title}).click();await page.locator('.brief-peek').getByText('模拟详情暂不可用',{exact:false}).waitFor();assert.equal(state.briefs[0].read,false);
 await page.locator('.brief-peek').getByRole('button',{name:'重试',exact:true}).click();await page.locator('.brief-peek').getByRole('heading',{name:'综合理解',exact:true}).waitFor();assert.equal(state.briefs[0].read,true);
 const provenance=await page.locator('.brief-peek .brief-provenance').first().innerText();assert(provenance.includes('X')&&provenance.includes('2026/09/07')&&provenance.includes('2026/09/08'),'发布日期和采集日期独立展示');
 await page.locator('.brief-peek').getByRole('button',{name:'全屏打开',exact:true}).click();await page.waitForURL(/intel-detail/);
 await page.getByText('资料 1 · 模型官方说明（测试）',{exact:true}).click();assert.equal(await page.locator('.brief-originals>details').count(),1);assert.equal(await page.locator('.brief-source-quotes blockquote').count(),3);assert.equal(await page.locator('.brief-source-record').count(),2);
 assert.equal(explores,0);await page.getByRole('button',{name:'探索表达角度',exact:true}).click();await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'重试探索',exact:true}).click();await page.getByRole('heading',{name:'怎样判断模型改善了创作？',exact:true}).waitFor();assert.equal(explores,2);assert.equal(merged,null,'探索角度不写入选题');
 await page.getByRole('button',{name:'和 AI 聊聊',exact:true}).click();await page.locator('.brief-chat textarea').waitFor();await page.getByRole('button',{name:'收起讨论',exact:true}).click();
 await page.goto(base+'/#/intel-settings');await page.getByRole('dialog',{name:'关注方向',exact:true}).waitFor();await page.getByLabel('关注方向内容',{exact:true}).fill('AI 模型进展\n内容创作方法');await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('dialog[open]').waitFor({state:'detached'});assert.deepEqual(state.preferences.directions,['AI 模型进展','内容创作方法']);
 await page.goto(base+'/#/intel-reports');await page.getByRole('button',{name:'生成本周回顾',exact:true}).click();await page.getByRole('button',{name:/这一周的变化与实践/}).click();await page.getByRole('heading',{name:'本周回顾',exact:true}).waitFor();assert.equal(await page.locator('.brief-report-evidence a').getAttribute('href'),'https://example.com/model');
 const shots=path.join(ROOT,'output','playwright');await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,'intelligence-reports-split-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'intelligence-reports-split-mobile.png'),fullPage:true});
 assert.equal(errors.length,0,errors.join('\n'));console.log('情报阅读补充验收：手动更新、详情失败不标已读、时间依据、完整原文、角度失败重试、讨论、关注方向和周报通过');
}catch(error){console.log(await page?.locator("body").innerText());throw error;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}const rel=path.relative(os.tmpdir(),temp);assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
