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
 // 单一阅读主线：精选排序由服务端决定，历史待复核仅通过筛选访问。
 await page.goto(base+'/#/intel');await page.getByRole('tab',{name:'热点',exact:true}).click();await page.locator('.brief-card').first().waitFor();assert.equal(await page.locator('.brief-card').count(),10,'不再只显示 8 条');assert((await page.locator('.brief-card').first().innerText()).includes(briefs[7].title));assert.equal(await page.locator('.brief-card__title').filter({hasText:'历史记录需要重新核对'}).count(),0);
 assert.equal(await page.locator('.subnav[aria-label="情报下的页面"]').count(),0);
 await page.getByRole('button',{name:'筛选情报'}).click();await page.getByLabel('历史与待复核',{exact:true}).check();await page.keyboard.press('Escape');await page.locator('.brief-card__title').filter({hasText:'历史记录需要重新核对'}).click();await page.locator('.brief-peek').getByText('缺少证据范围复核',{exact:true}).waitFor();
 const shots=path.join(ROOT,'output','playwright');await fs.mkdir(shots,{recursive:true});
 await page.goto(base+"/#/intel-channels");await page.getByText("测试：订阅超时",{exact:true}).waitFor();await page.getByRole("button",{name:"暂停",exact:true}).click();await page.getByRole("button",{name:"启用",exact:true}).waitFor();assert.equal(channels[0].enabled,false);await page.getByRole("button",{name:"添加信源",exact:true}).click();await page.getByLabel("名称",{exact:true}).fill("我的实践订阅");await page.getByLabel("订阅地址",{exact:true}).fill("https://example.com/practice.xml");await page.getByRole("button",{name:"保存信源",exact:true}).click();await page.getByRole("heading",{name:"我的实践订阅",exact:true}).waitFor();const sourceRegion=page.getByRole("region",{name:"情报采集来源",exact:true});await sourceRegion.getByRole("tab",{name:"已启用",exact:true}).click();assert((await sourceRegion.locator(".intel-channel-state").allTextContents()).every(text=>text.includes("实际：已启用")));await sourceRegion.getByLabel("查找来源",{exact:true}).fill("不可能匹配的设计验收信源");await sourceRegion.getByText("没有匹配的来源。",{exact:true}).waitFor();await sourceRegion.getByLabel("查找来源",{exact:true}).fill("");await sourceRegion.getByRole("tab",{name:"全部信源",exact:true}).click();await sourceRegion.locator(".acquisition-group").first().waitFor();await page.screenshot({path:path.join(shots,"intelligence-v2-channels.png"),fullPage:true});
 await page.goto(base+"/#/intel-runs");await page.locator(".intel-run>summary").click();await page.getByText("质量检查 · 可推荐 8 条 · 待复核 1 条 · 未通过 1 条 · 已完成",{exact:true}).waitFor();await page.getByText("测试候选：引用无法核对",{exact:true}).waitFor();
 await page.screenshot({path:path.join(shots,"intelligence-v2-runs.png"),fullPage:true});
 await page.setViewportSize({width:390,height:844});for(const view of ['intel-channels','intel-runs']){await page.goto(base+'/#/'+view);await page.locator(view==='intel-runs'?'.intel-history':'.intel-v2-list').first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,`intelligence-v2-${view}-mobile.png`),fullPage:true});}
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base+'/#/intel-reports');await page.getByRole('heading',{name:'把一周的信息连起来',exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log("情报兼容工具验收：服务端排序、历史待复核、信源配置、处理详情与小屏通过。");
} catch(error){console.log(await page?.locator("body").innerText());throw error;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}const rel=path.relative(os.tmpdir(),temp);assert(rel&&!rel.startsWith("..")&&!path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
