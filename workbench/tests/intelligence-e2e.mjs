import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { workbenchApi } from "../server/vite-plugin-workbench.mjs";
const ROOT=path.resolve(import.meta.dirname,"..");
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"xenho-intelligence-e2e-"));
const vars={XENHO_HOME:path.join(temp,"Xenho"),WB_KEEP_ALIVE:"1",HTTP_PROXY:"http://127.0.0.1:9",HTTPS_PROXY:"http://127.0.0.1:9",NO_PROXY:"127.0.0.1,localhost"};
const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);let pw;
for(const root of [ROOT,"C:/Users/Lenovo",process.env.APPDATA && path.join(process.env.APPDATA,"npm","node_modules")].filter(Boolean)){try{pw=require(require.resolve("playwright",{paths:[root]}));break;}catch{}}
assert(pw,"Playwright available");
let server,browser,page;
const base="http://127.0.0.1:5239";
async function request(route,options){const response=await fetch(base+route,options);const result=await response.json();assert(response.ok && result.ok,JSON.stringify(result));return result;}
const post=(route,payload)=>request(route,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload||{})});
async function until(read,test,label){const end=Date.now()+30000;while(Date.now()<end){const value=await read();if(test(value))return value;await new Promise(r=>setTimeout(r,150));}throw new Error(`等待超时：${label}`);}
try{
 const env={XENHO_HOME:vars.XENHO_HOME};
 const intelligence={planResearch:async()=>({}),collect:async()=>[{title:"Harness 测试资料",body:"这是一份隔离验收资料：模型能否完成任务，还受到上下文、工具和反馈条件的影响。需要通过可复现案例进一步验证。",provider:"local",readLevel:"original"}],completeJson:async(_env,{user})=>{const input=JSON.parse(user);return {data:{cards:[{question:"为什么更强的模型仍可能无法完成任务？",why:"一条已有记录提出任务条件的解释，值得寻找证据。",angle:"结合具体任务讨论上下文、工具与反馈。",audience:"个人开发者",gaps:"还缺可复现案例",evidence:[{sourceId:input.sources[0].id,quote:"模型能否完成任务，还受到上下文、工具和反馈条件的影响。"}],wiki:[]}]}};}};
 server=await createServer({root:ROOT,configFile:false,plugins:[react(),workbenchApi(env,{jobDependencies:{intelligence}})],server:{host:"127.0.0.1",port:5239,strictPort:true,open:false},logLevel:"error"});await server.listen();
 browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});const errors=[];page.on("pageerror",e=>errors.push(e.message));
 // 历史手动资料API仍兼容；前台原始资料页不再混入灵感编辑。
 await post('/api/workspace/intelligence/sources',{title:'Harness 疑问',body:'更强的模型为什么也会任务失败？这是我想进一步了解的问题。'});
 // 调研流水线由领域 API 驱动：建主题 → 跑一次 → 等真实任务结束。
 const profile=(await post("/api/workspace/intelligence/profiles",{name:"Harness 上下文与任务反馈",query:"Harness 上下文与任务反馈",frequency:"manual"})).profile;
 await post(`/api/workspace/intelligence/profiles/${profile.id}/run`);
 const result=await until(()=>request("/api/workspace/intelligence"),r=>r.runs.some(x=>["done","partial","failed"].includes(x.status)),"真实任务完成");assert.equal(result.runs[0].status,"done",JSON.stringify(result.runs));assert.equal(result.cards.length,1);assert.equal(result.sources.length,2);
 // 处理记录页能看到这条完成的任务。
 await page.goto(base+"/#/intel-runs");await page.locator(".intel-run summary").first().waitFor();
 const shots=path.join(ROOT,"output","playwright");await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,"intelligence-e2e-runs.png"),fullPage:true});
 // 采用候选 → 研究 → 写文章 → 保存/刷新/导出（研究页与写作链不变）。
 const research=(await post(`/api/workspace/intelligence/cards/${result.cards[0].id}/adopt`)).research;assert(research?.id,"采用后应有研究记录");
 // 选题和写作合并（2026-09-24）：打开选题就是打开它对应的那篇内容，先看构思。
 await page.goto(base+`/#/research/${encodeURIComponent(research.id)}`);await page.waitForURL(/#\/project\//);const project=decodeURIComponent(page.url().split("#/project/")[1]);await page.locator(".topic-flow").waitFor();const detail=(await request(`/api/workspace/researches/${research.id}`)).research;assert(detail.references.length>0,"来源进入选题空间");
 await page.getByRole("button",{name:"跳过，直接写",exact:true}).click();await page.locator(".project-draft .cm-content").waitFor();await page.locator(".project-draft .cm-content").fill("我想从具体任务入手，理解上下文、工具和反馈如何影响结果。");assert.equal((await request(`/api/workspace/researches/${research.id}`)).research.projects[0].id,project,"选题和内容一对一");
 await until(()=>request(`/api/workspace/projects/${project}`),r=>r.project.masterDraft.body.includes("具体任务"),"文章写入持久化");
 await page.getByRole("button",{name:"导出",exact:false}).first().click();const [exported]=await Promise.all([page.waitForResponse(r=>r.url().includes("/export")),page.getByRole("menuitem",{name:/^Markdown/}).click()]);assert(exported.ok());await page.reload();await page.locator(".project-draft .cm-content").waitFor();assert((await page.locator(".project-draft .cm-content").innerText()).includes("具体任务"));
 assert.equal(errors.length,0,errors.join("\n"));console.log("情报真实端到端：手动记录 → 任务队列 → 证据卡片 → 采用进研究 → 文章保存/刷新/导出通过。外部采集与模型为注入依赖，无外网付费调用。");
}catch(error){console.log(await page?.locator("body").innerText());throw error;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}const rel=path.relative(os.tmpdir(),temp);assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
