import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { workbenchApi } from "../server/vite-plugin-workbench.mjs";
const ROOT=path.resolve(import.meta.dirname,"..");
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"xenho-intelligence-v2-ui-"));
const vars={XENHO_HOME:path.join(temp,"Xenho"),WB_KEEP_ALIVE:"1",HTTP_PROXY:"http://127.0.0.1:9",HTTPS_PROXY:"http://127.0.0.1:9",NO_PROXY:"127.0.0.1,localhost"};
const previous=Object.fromEntries(Object.keys(vars).map(key=>[key,process.env[key]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);let pw;
for(const root of [ROOT,"C:/Users/Lenovo",process.env.APPDATA && path.join(process.env.APPDATA,"npm","node_modules")].filter(Boolean)){try{pw=require(require.resolve("playwright",{paths:[root]}));break;}catch{}}
assert(pw,"Playwright available");
let server,browser,page;
const base="http://127.0.0.1:5268",date="2026-09-17";
const source={id:"source-v2",title:"模型更新的一手说明",body:"模型在给定任务的对照结果有所改善，但真实工作流仍需要独立验证。",url:"https://example.com/release",provider:"web",originKind:"external",publishedAt:date};
const briefs=Array.from({length:10},(_,index)=>({id:`brief-${index}`,title:`模型更新中的实际变化 ${index+1}`,summary:"先区分原文证据和解释，再验证自己的使用场景。",body:"此次公开结果来自给定测试任务。",whyItMatters:"影响任务评估方式。",audienceTakeaway:"用实际任务核对变化。",uncertainties:["真实工作流中的表现尚未验证"],suggestedUses:["设计一次任务对照"],editorialState:"ready",freshnessKind:"recent_event",confidence:"reliable",editionDate:date,sourceMeta:[source],sources:[source],sourceDocuments:[source],version:1}));
briefs[1].saved=true;
briefs.push({...briefs[0],id:"legacy",title:"历史记录需要重新核对",editorialState:"needs_review",freshnessKind:"unknown",quality:{reasons:["缺少证据范围复核"]}});
const feed={featuredIds:briefs.slice(0,8).map(item=>item.id).reverse(),briefs,reports:[],blockedSources:[],preferences:{directions:["AI 使用方法"],customized:true},activeRuns:[],latestEditionDate:date,lastSuccessfulUpdate:date,latestRun:{id:"run-v2",status:"failed",createdAt:date,error:"测试：某个渠道暂不可用",coverage:[{provider:"channels",count:0,status:"failed",error:"测试：某个渠道暂不可用"},{provider:"quality",status:"done",ready:8,needsReview:1,rejected:1,rejectionReasons:[{title:"测试候选",error:"引用无法核对"}]}]}};
const channels=[{id:"channel-v2",name:"官方更新",url:"https://example.com/feed.xml",category:"official",format:"rss",enabled:true,health:"failed",lastError:"测试：订阅超时",lastAttemptAt:date,lastItemCount:0}];
const intel={profiles:[],runs:[feed.latestRun],cards:[],sources:[source,{id:"manual-v2",title:"手动记录的疑问",body:"这个实践是否适合个人创作者？",provider:"manual",originKind:"manual",createdAt:date}],capabilities:{}};
const topics=[{id:"old-card",kind:"intel",workingTitle:"过去留下的待研究问题",audience:"个人创作者",angle:"补充真实实践",readiness:"untriaged",evidenceGaps:["核对原始依据"],researchTasks:[],nonClaims:[],evidence:[]}];
let saves=0,starts=0,previews=0,feedback,failPreview=true;
let candidate;
try {
 server=await createServer({root:ROOT,configFile:false,plugins:[react(),workbenchApi({XENHO_HOME:vars.XENHO_HOME})],server:{host:"127.0.0.1",port:5268,strictPort:true,open:false},logLevel:"error"});await server.listen();
 browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on("pageerror",error=>errors.push(error.message));
 await page.route("**/api/workspace/seeds",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,seeds:[{id:"seed-v2",take:"我想记录的一次观察",status:"攒着",createdAt:date}]})}));
 await page.route("**/api/workspace/intelligence**",async route=>{
  const request=route.request(),url=new URL(request.url()),body=request.method()==="GET" ? {} : request.postDataJSON();let result={ok:true};
  if(url.pathname.endsWith("/feed"))result={...result,...feed};
  else if(url.pathname.endsWith("/topics/preview")){previews++;if(failPreview){failPreview=false;await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"测试：预览暂不可用"})});return;}candidate={workingTitle:"怎样核对模型更新对自己的任务有用？",audience:"使用 AI 的个人创作者",angle:"比较具体任务",deliverable:"一份可以复用的对照记录",whyNow:"模型刚有更新",evidenceGaps:["缺少真实工作流对照"],researchTasks:["执行两组相同任务并记录失败"],nonClaims:["不能把材料中的经历当成自己的经历"],readiness:"needs_evidence",briefIds:body.briefIds,sourceIds:[source.id],sourceHashes:{[source.id]:"fixture-hash"},briefVersions:Object.fromEntries(body.briefIds.map(id=>[id,1])),evidence:[{sourceId:source.id,quote:source.body}]};result.candidate=candidate;}
  else if(url.pathname.endsWith("/topics") && request.method()==="GET")result={...result,opportunities:topics,cards:[]};
  else if(url.pathname.endsWith("/topics")){assert.equal(body.confirmed,true);assert.deepEqual(body.candidate.sourceHashes,candidate.sourceHashes);assert.deepEqual(body.candidate.briefVersions,candidate.briefVersions);saves++;topics.unshift({...body.candidate,id:"topic-v2",kind:"intel"});result.opportunity=topics[0];}
  else if(url.pathname.endsWith("/start")){assert.equal(body.confirmed,true);starts++;result.research={id:"research-v2"};}
  else if(url.pathname.endsWith("/channels")){if(request.method()==="POST")channels.push({...body,id:"custom-v2",health:"never"});result={...result,channels,summary:{total:channels.length,enabled:channels.filter(item=>item.enabled).length,failed:1}};}
  else if(url.pathname.includes("/channels/")){Object.assign(channels.find(item=>item.id===url.pathname.split("/").at(-1)),body);}
  else if(url.pathname.includes("/briefs/")){const brief=briefs.find(item=>item.id===url.pathname.split("/briefs/")[1].split("/")[0]);if(url.pathname.endsWith("/feedback")){feedback=body;Object.assign(brief,body);}result.brief=brief;}
  else if(url.pathname.includes("/sources/"))result.source=intel.sources.find(item=>item.id===url.pathname.split("/").at(-1));
  else if(url.pathname.endsWith("/sources")){intel.sources.push({...body,id:`added-v2-${intel.sources.length}`,provider:"manual"});}
  else if(url.pathname.endsWith("/intelligence"))result={...result,...intel};
  await route.fulfill({contentType:"application/json",body:JSON.stringify(result)});
 });
 await page.goto(base+"/#/intel");await page.locator(".brief-card").first().waitFor();assert.equal(await page.locator(".brief-card").count(),8,"默认最多8条");assert((await page.locator(".brief-card").first().innerText()).includes(briefs[7].title),"保留服务端精选排序");assert.equal(await page.getByRole("button",{name:"历史记录需要重新核对",exact:true}).count(),0,"未审核旧简报不进入精选");assert.deepEqual(await page.locator('.subnav[aria-label="情报下的页面"] button').allTextContents(),["精选","选题","资料"]);
 const navigation=page.getByRole("navigation",{name:"情报管理",exact:true});
 assert.equal(await navigation.locator('[aria-current="page"]').innerText(),"精选");
 await navigation.getByRole("link",{name:"选题",exact:true}).focus();await page.keyboard.press("Enter");
 await page.waitForURL(/intel-topics/);await navigation.locator('a[aria-current="page"]').filter({hasText:"选题"}).waitFor();assert.equal(await navigation.locator('[aria-current="page"]').innerText(),"选题");
 await navigation.getByRole("link",{name:"精选",exact:true}).click();await page.locator(".brief-card").first().waitFor();
 await page.getByRole("tab",{name:"历史与待复核",exact:true}).click();await page.getByRole("heading",{name:"待复核",exact:true}).waitFor();await page.getByRole("button",{name:"历史记录需要重新核对",exact:true}).click();await page.locator(".brief-peek").getByText("待复核",{exact:true}).waitFor();await page.locator(".brief-peek").getByText("缺少证据范围复核",{exact:true}).waitFor();await page.keyboard.press("Escape");
 await page.getByRole("tab",{name:"本期精选",exact:true}).click();await page.getByRole("button",{name:briefs[0].title,exact:true}).click();await page.locator(".brief-peek").getByRole("heading",{name:"为什么值得关注",exact:true}).waitFor();await page.locator(".brief-peek").getByRole("heading",{name:"读者能带走什么",exact:true}).waitFor();await page.keyboard.press("e");await page.getByRole("button",{name:"依据不足",exact:true}).click();assert.equal(feedback.reason,"weak_evidence");await page.getByRole("tab",{name:"已忽略",exact:true}).click();await page.getByRole("button",{name:"恢复推荐",exact:true}).click();
 await page.getByRole("tab",{name:"本期精选",exact:true}).click();await page.getByLabel(`选择：${briefs[0].title}`).check();await page.getByRole("button",{name:"一起展开成选题",exact:true}).click();await page.getByText("测试：预览暂不可用",{exact:false}).waitFor();assert.equal(saves,0);assert.equal(starts,0);await page.getByRole("button",{name:"重试",exact:true}).click();await page.getByRole("button",{name:"确认保存选题",exact:true}).waitFor();assert.equal(saves,0,"预览不保存");assert.equal(starts,0,"预览不开始研究");assert.equal(previews,2);
 const shots=path.join(ROOT,"output","playwright");await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,"intelligence-v2-topic-preview.png"),fullPage:true});
 await page.getByRole("button",{name:"确认保存选题",exact:true}).click();await page.getByRole("button",{name:"确认保存选题",exact:true}).waitFor({state:"detached"});assert.equal(saves,1);assert.equal(starts,0);
 await page.locator(".intel-v2-list article").filter({hasText:candidate.workingTitle}).getByRole("button",{name:"开始研究",exact:true}).click();await page.getByRole("dialog",{name:"确认开始研究"}).waitFor();assert.equal(starts,0);await page.getByRole("button",{name:"取消",exact:true}).click();assert.equal(starts,0);await page.locator(".intel-v2-list article").filter({hasText:"过去留下的待研究问题"}).getByRole("button",{name:"开始研究",exact:true}).click();await page.getByRole("button",{name:"确认开始研究",exact:true}).click();await page.waitForURL(/research-v2/);assert.equal(starts,1,"旧候选可进入补证研究");
 await page.goto(base+"/#/intel-resources");await page.getByRole("tab",{name:"全部资料",exact:true}).click();await page.locator("summary").getByText("我想记录的一次观察",{exact:true}).waitFor();await page.getByText("手动记录的疑问",{exact:true}).waitFor();await page.getByRole("tab",{name:"收藏情报",exact:true}).click();await page.getByRole("button",{name:briefs[1].title,exact:true}).click();await page.waitForURL(/intel-detail/);await page.locator(".brief-detail-layout").waitFor();await page.goto(base+"/#/intel-resources");await page.getByRole("tab",{name:"全部资料",exact:true}).click();await page.getByRole("button",{name:"添加资料或灵感",exact:true}).click();await page.getByLabel("标题（可选）",{exact:true}).fill("保存一条原始记录");await page.getByLabel("原始内容",{exact:true}).fill("这是用户提供的原始内容，不应被AI自动重写。");await page.getByRole("button",{name:"确认保存资料",exact:true}).click();await page.getByText("保存一条原始记录",{exact:true}).waitFor();await page.getByRole("button",{name:"添加资料或灵感",exact:true}).click();await page.getByLabel("原始内容",{exact:true}).fill("一句话也可以成为原始灵感记录。");await page.getByRole("button",{name:"确认保存资料",exact:true}).click();await page.getByText("一句话也可以成为原始灵感记录。",{exact:true}).first().waitFor();assert.equal(intel.sources.at(-1).title,"一句话也可以成为原始灵感记录。");await page.getByRole("textbox",{name:"搜索情报资料"}).fill("不会匹配");await page.getByRole("heading",{name:"没有匹配的资料",exact:true}).waitFor();await page.getByRole("textbox",{name:"搜索情报资料"}).fill("");await page.screenshot({path:path.join(shots,"intelligence-v2-resources.png"),fullPage:true});
 await page.goto(base+"/#/intel-channels");await page.getByText("测试：订阅超时",{exact:true}).waitFor();await page.getByRole("button",{name:"暂停",exact:true}).click();await page.getByRole("button",{name:"启用",exact:true}).waitFor();assert.equal(channels[0].enabled,false);await page.getByRole("button",{name:"添加信源",exact:true}).click();await page.getByLabel("名称",{exact:true}).fill("我的实践订阅");await page.getByLabel("订阅地址",{exact:true}).fill("https://example.com/practice.xml");await page.getByRole("button",{name:"保存信源",exact:true}).click();await page.getByRole("heading",{name:"我的实践订阅",exact:true}).waitFor();await page.screenshot({path:path.join(shots,"intelligence-v2-channels.png"),fullPage:true});
 await page.goto(base+"/#/intel-runs");await page.locator(".intel-run>summary").click();await page.getByText("质量检查 · 可推荐 8 条 · 待复核 1 条 · 未通过 1 条 · 已完成",{exact:true}).waitFor();await page.getByText("测试候选：引用无法核对",{exact:true}).waitFor();
 await page.screenshot({path:path.join(shots,"intelligence-v2-runs.png"),fullPage:true});
 await page.setViewportSize({width:390,height:844});for(const view of ["intel","intel-topics","intel-resources","intel-channels","intel-runs"]){await page.goto(base+"/#/"+view);if(view==="intel-resources")await page.getByRole("tab",{name:"全部资料",exact:true}).click();await page.locator(view==="intel-runs" ? ".intel-history" : view==="intel" ? ".brief-card" : ".intel-v2-list").first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${view}手机无横向溢出`);await page.screenshot({path:path.join(shots,`intelligence-v2-${view}-mobile.png`),fullPage:true});}
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.goto(base+"/#/intel-reports");await page.getByRole("heading",{name:"把一周的信息连起来",exact:true}).waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(shots,"intelligence-v2-reports-mobile.png"),fullPage:true});
 assert.deepEqual(errors,[]);console.log("情报 V2 UI：三入口、8条精选、旧记录审核、原因反馈、失败重试、无写入预览、显式保存/研究、旧候选补证、资料种子合并、信源管理与390px截图通过。");
} catch(error){console.log(await page?.locator("body").innerText());throw error;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}const rel=path.relative(os.tmpdir(),temp);assert(rel&&!rel.startsWith("..")&&!path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
