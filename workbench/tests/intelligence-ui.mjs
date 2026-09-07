import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { workbenchApi } from "../server/vite-plugin-workbench.mjs";
const ROOT=path.resolve(import.meta.dirname,"..");
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"xenho-intelligence-ui-"));
const vars={XENHO_HOME:path.join(temp,"Xenho"),WB_KEEP_ALIVE:"1",HTTP_PROXY:"http://127.0.0.1:9",HTTPS_PROXY:"http://127.0.0.1:9",NO_PROXY:"127.0.0.1,localhost"};
const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);let pw;
for(const root of [ROOT,"C:/Users/Lenovo",process.env.APPDATA && path.join(process.env.APPDATA,"npm","node_modules")].filter(Boolean)){try{pw=require(require.resolve("playwright",{paths:[root]}));break;}catch{}}
assert(pw,"Playwright available");
let server,browser,page;
const state={ok:true,profiles:[],runs:[],cards:[],sources:[],capabilities:{local:true,web:false,x:true,reddit:true,aihot:true}};
let failSave=false,retryBody,detailReads=0;
try{
 server=await createServer({root:ROOT,configFile:false,plugins:[react(),workbenchApi({XENHO_HOME:vars.XENHO_HOME})],server:{host:"127.0.0.1",port:5238,strictPort:true,open:false},logLevel:"error"});await server.listen();
 browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/workspace/intelligence**",async route=>{const req=route.request(),url=new URL(req.url()),body=req.method()==="GET"?{}:req.postDataJSON();let result={ok:true};
 if(req.method()==="GET" && /\/sources\/[^/]+$/.test(url.pathname)){detailReads++;result={ok:true,source:state.sources.find(s=>s.id===url.pathname.split("/").at(-1))};}
 else if(req.method()==="GET") result={...state,sources:state.sources.map(s=>({...s,body:s.body.slice(0,600),bodyTruncated:s.body.length>600}))};
 else if(url.pathname.endsWith("/profiles")){state.profiles=[{...body,id:"profile-1"}];}
 else if(url.pathname.endsWith("/run")){state.runs=[{id:"run-1",profileId:"profile-1",status:"running",stage:"正在读取来源",coverage:[],createdAt:new Date().toISOString()}];}
 else if(url.pathname.endsWith("/retry")){retryBody=body;state.runs[0].status="running";}
 else if(url.pathname.endsWith("/sources")){if(failSave){await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"模拟收集失败"})});return;}state.sources.push({...body,id:"manual-1",provider:"local",createdAt:new Date().toISOString()});}
 else if(url.pathname.endsWith("/adopt")){result={ok:true,research:{id:"research-test"}};}
 else if(req.method()==="PUT"){state.cards[0].status=body.status;}
 await route.fulfill({contentType:"application/json",body:JSON.stringify(result)});
 });
 await page.goto("http://127.0.0.1:5238/#/intel");await page.getByText("先告诉 AI，你在关注什么",{exact:true}).waitFor();
 await page.getByRole("button",{name:"设置第一个关注方向"}).click();await page.getByLabel("方向名称",{exact:true}).fill("AI 编程的真实问题");await page.getByLabel("你想了解什么",{exact:true}).fill("关注上下文、工具和任务失败的原因，寻找可核对的案例。");
 await page.getByLabel("X 关注账号",{exact:true}).check();await page.getByLabel("X 账号（最多 5 个，逗号分隔）",{exact:true}).fill("example");
 assert(!await page.locator(".intel-paid input").isChecked());await page.getByRole("button",{name:"保存关注方向",exact:true}).click();assert.equal(state.profiles.length,0,"未授权不能触发付费来源配置");
 await page.getByLabel("调研频率",{exact:true}).selectOption("weekly");await page.locator(".intel-paid input").check();await page.getByRole("button",{name:"保存关注方向",exact:true}).click();await page.getByText("关注方向已保存",{exact:true}).waitFor();assert(state.profiles[0].paidApproved);
 await page.getByRole("button",{name:"现在调研",exact:true}).click();await page.getByRole("button",{name:"取消调研",exact:true}).waitFor();
 state.runs[0]={...state.runs[0],status:"partial",error:"X 返回状态不明确",coverage:[{provider:"x",count:0,status:"failed",uncertain:true,error:"需要采集恢复 ID"}]};
 await page.reload();await page.getByText("调研记录",{exact:true}).waitFor();await page.locator(".intel-run summary").click();await page.getByPlaceholder("s_…").fill("s_existing");await page.getByRole("button",{name:"重试调研",exact:true}).click();assert.equal(retryBody.snapshotIds.x,"s_existing");
 await page.goto("http://127.0.0.1:5238/#/intel-inbox");await page.getByLabel("标题",{exact:true}).fill("Harness 的疑问");await page.getByLabel("内容",{exact:true}).fill("为什么模型更强了，任务依旧可能失败？");failSave=true;await page.getByRole("button",{name:"保存到收集箱",exact:true}).click();await page.getByText("模拟收集失败",{exact:false}).waitFor();assert((await page.getByLabel("内容",{exact:true}).inputValue()).includes("任务"));failSave=false;await page.getByRole("button",{name:"保存到收集箱",exact:true}).click();await page.getByText("已收集 · 1",{exact:true}).waitFor();
 state.runs[0].status="done";state.cards=[{id:"card-1",question:"为什么更强的模型仍会把任务做错？",why:"重复出现的疑问指向任务上下文与反馈，而不只是模型本身。",angle:"从一个实际案例解释模型、工具和反馈的关系。",audience:"正在尝试 AI 编程的个人开发者",gaps:["需要补充可复现案例"],wiki:[],evidence:[{sourceId:"manual-1",quote:state.sources[0].body}],status:"new",updatedAt:new Date().toISOString()}];
 state.sources[0].body += "补充资料用于验证按需读取全文。".repeat(60)+"全文结束标记";
 await page.goto("http://127.0.0.1:5238/#/intel");await page.getByRole("heading",{name:state.cards[0].question,exact:true}).waitFor();await page.locator(".intel-card>details>summary").click();await page.getByText("已读取的内容",{exact:true}).waitFor();assert.equal(detailReads,0,"默认不读取来源全文");await page.getByText("已读取的内容",{exact:true}).click();await page.locator(".intel-source-body").filter({hasText:"全文结束标记"}).waitFor();assert.equal(detailReads,1,"展开按需读取全文");
 const shots=path.join(ROOT,"output","playwright");await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,"intelligence-discover-desktop.png"),fullPage:true});
 await page.getByRole("button",{name:"留着观察",exact:true}).click();await page.getByRole("button",{name:"继续观察",exact:true}).click();await page.getByRole("heading",{name:state.cards[0].question,exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"手机无横向溢出");await page.screenshot({path:path.join(shots,"intelligence-discover-mobile.png"),fullPage:true});
 await page.goto("http://127.0.0.1:5238/#/intel-settings");await page.getByRole("button",{name:"编辑",exact:true}).click();await page.getByLabel("方向名称",{exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,"intelligence-settings-mobile.png"),fullPage:true});
 await page.getByRole("button",{name:"保存关注方向",exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,"intelligence-settings-mobile-actions.png"),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.locator(".intel-header").scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,"intelligence-settings-desktop.png"),fullPage:true});
 await page.goto("http://127.0.0.1:5238/#/hot");await page.getByRole("heading",{name:"选题发现",exact:true}).waitFor();assert(!await page.getByRole("heading",{name:"热点",exact:true}).count());
 await page.getByRole("button",{name:"继续观察",exact:true}).click();await page.getByRole("button",{name:"采用并一起讨论",exact:true}).click();await page.waitForURL(/#\/research\/research-test/);assert.equal(errors.length,0,errors.join("\n"));console.log("情报 UI：配置授权、调研恢复、收集失败恢复、候选筛选、导航与手机截图通过（API 使用隔离桩）");
}catch(error){console.log(await page?.locator("body").innerText());throw error;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}const rel=path.relative(os.tmpdir(),temp);assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
