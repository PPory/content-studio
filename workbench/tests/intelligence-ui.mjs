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
let failSave=false,retryBody;
try{
 server=await createServer({root:ROOT,configFile:false,plugins:[react(),workbenchApi({XENHO_HOME:vars.XENHO_HOME})],server:{host:"127.0.0.1",port:5238,strictPort:true,open:false},logLevel:"error"});await server.listen();
 browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/workspace/intelligence**",async route=>{const req=route.request(),url=new URL(req.url()),body=req.method()==="GET"?{}:req.postDataJSON();let result={ok:true};
 if(url.pathname.endsWith("/feed")) result={ok:true,briefs:[],recommendationIds:[],preferences:{directions:[]},activeRuns:[]};
 else if(url.pathname.endsWith("/library")) result={ok:true,items:[],total:0,hasMore:false};
 else if(req.method()==="GET" && /\/sources\/[^/]+$/.test(url.pathname)){result={ok:true,source:state.sources.find(s=>s.id===url.pathname.split("/").at(-1))};}
 else if(req.method()==="GET" && url.pathname==="/api/workspace/intelligence") result={...state,sources:state.sources.map(s=>({...s,body:s.body.slice(0,600),bodyTruncated:s.body.length>600}))};
 else if(url.pathname.endsWith("/profiles")){state.profiles=[{...body,id:"profile-1"}];result={ok:true,profile:state.profiles[0]};}
 else if(url.pathname.endsWith("/run")){state.runs=[{id:"run-1",profileId:"profile-1",status:"running",stage:"正在读取来源",coverage:[],createdAt:new Date().toISOString()}];}
 else if(url.pathname.endsWith("/cancel")){state.runs[0]={...state.runs[0],status:"cancelled"};}
 else if(url.pathname.endsWith("/retry")){retryBody=body;state.runs[0].status="running";}
 else if(url.pathname.endsWith("/sources")){if(failSave){await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"模拟收集失败"})});return;}state.sources.push({...body,id:"manual-1",provider:"manual",createdAt:new Date().toISOString()});}
 await route.fulfill({contentType:"application/json",body:JSON.stringify(result)});
 });
 // 处理记录：进行中的任务有取消入口；部分完成的任务能带采集恢复 ID 重试。
 state.profiles=[{id:"profile-1",name:"个人情报精选",query:"个人情报精选",frequency:"manual",enabled:true}];
 state.runs=[{id:"run-1",profileId:"profile-1",status:"running",stage:"正在读取来源",coverage:[],createdAt:new Date().toISOString()}];
 await page.goto("http://127.0.0.1:5238/#/intel-runs");assert.equal(await page.locator(".nav").count(),1,"侧栏DOM只有一份");
 await page.getByRole("button",{name:"取消调研",exact:true}).waitFor();
 state.runs[0]={...state.runs[0],status:"partial",error:"X 返回状态不明确",coverage:[{provider:"x",count:0,status:"failed",uncertain:true,error:"需要采集恢复 ID"}]};
 await page.goto("http://127.0.0.1:5238/#/intel-runs");await page.locator(".intel-run summary").click();await page.getByPlaceholder("s_…").fill("s_existing");await page.getByRole("button",{name:"重试调研",exact:true}).click();assert.equal(retryBody.snapshotIds.x,"s_existing");
 await page.locator(".intel-run summary").waitFor();
 const shots=path.join(ROOT,"output","playwright");await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,"intelligence-runs-desktop.png"),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.goto("http://127.0.0.1:5238/#/intel-runs");await page.locator(".intel-history").waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"手机无横向溢出");await page.screenshot({path:path.join(shots,"intelligence-runs-mobile.png"),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 // 原始资料以检索为主，自己的想法转到笔记。
 await page.goto("http://127.0.0.1:5238/#/intel-resources");await page.getByRole('textbox',{name:'搜索原始资料',exact:true}).waitFor();await page.getByRole('heading',{name:'没有匹配的原始资料',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'添加资料或灵感',exact:true}).count(),0);
 await page.getByRole('button',{name:'记录自己的想法',exact:true}).click();await page.waitForURL(/#\/notes/);
 // 旧版情报工作台已下线：旧书签落到今日精选，不再渲染旧页。
 await page.goto("http://127.0.0.1:5238/#/intel-legacy");await page.getByRole("tab",{name:"推荐",exact:true}).waitFor();assert(!await page.getByLabel("这次想了解什么？",{exact:true}).count(),"旧版选题发现已下线");
 await page.goto("http://127.0.0.1:5238/#/hot");await page.getByRole("tab",{name:"AI 热点",exact:true}).waitFor();assert(!await page.getByRole("button",{name:"平台热榜",exact:true}).count());
 assert.equal(errors.length,0,errors.join("\n"));console.log("情报 UI：处理记录取消/恢复重试、原始资料空态与笔记入口、旧版路由下线、导航与手机截图通过（API 使用隔离桩）");
}catch(error){console.log(await page?.locator("body").innerText());throw error;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}const rel=path.relative(os.tmpdir(),temp);assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
