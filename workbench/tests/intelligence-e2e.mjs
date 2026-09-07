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
async function request(route){const response=await fetch(base+route);const result=await response.json();assert(response.ok && result.ok,JSON.stringify(result));return result;}
async function until(read,test,label){const end=Date.now()+30000;while(Date.now()<end){const value=await read();if(test(value))return value;await new Promise(r=>setTimeout(r,150));}throw new Error(`等待超时：${label}`);}
try{
 const env={XENHO_HOME:vars.XENHO_HOME};
 const intelligence={planResearch:async()=>({}),collect:async()=>[{title:"Harness 测试资料",body:"这是一份隔离验收资料：模型能否完成任务，还受到上下文、工具和反馈条件的影响。需要通过可复现案例进一步验证。",provider:"local",readLevel:"original"}],completeJson:async(_env,{user})=>{const input=JSON.parse(user);return {data:{cards:[{question:"为什么更强的模型仍可能无法完成任务？",why:"一条已有记录提出任务条件的解释，值得寻找证据。",angle:"结合具体任务讨论上下文、工具与反馈。",audience:"个人开发者",gaps:"还缺可复现案例",evidence:[{sourceId:input.sources[0].id,quote:"模型能否完成任务，还受到上下文、工具和反馈条件的影响。"}],wiki:[]}]}};}};
 server=await createServer({root:ROOT,configFile:false,plugins:[react(),workbenchApi(env,{jobDependencies:{intelligence}})],server:{host:"127.0.0.1",port:5239,strictPort:true,open:false},logLevel:"error"});await server.listen();
 browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(base+"/#/intel-inbox");await page.getByRole("button",{name:"我的灵感",exact:true}).click();await page.getByRole("button",{name:"记一条灵感",exact:true}).click();await page.getByLabel("标题",{exact:true}).fill("Harness 疑问");await page.getByLabel("内容",{exact:true}).fill("更强的模型为什么也会任务失败？这是我想进一步了解的问题。");await page.getByRole("button",{name:"保存灵感",exact:true}).click();await page.locator(".intel-source>summary").filter({hasText:"Harness 疑问"}).waitFor();
 await page.goto(base+"/#/intel");await page.getByLabel("这次想了解什么？",{exact:true}).fill("Harness 上下文与任务反馈");await page.getByRole("button",{name:"开始调研",exact:true}).click();const result=await until(()=>request("/api/workspace/intelligence"),r=>r.runs.some(x=>["done","partial","failed"].includes(x.status)),"真实任务完成");assert.equal(result.runs[0].status,"done",JSON.stringify(result.runs));assert.equal(result.cards.length,1);assert.equal(result.sources.length,2);
 await page.goto(base+"/#/intel");await page.getByRole("heading",{name:result.cards[0].question,exact:true}).waitFor();await page.locator(".intel-card>details:not(.intel-card-thinking)>summary").click();await page.getByText("Harness 测试资料",{exact:true}).waitFor();
 const shots=path.join(ROOT,"output","playwright");await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,"intelligence-e2e-discover.png"),fullPage:true});
 await page.getByRole("button",{name:"采用并一起讨论",exact:true}).click();await page.waitForURL(/#\/research\//);const id=decodeURIComponent(page.url().split("#/research/")[1]);await page.getByLabel("我的笔记",{exact:true}).waitFor();const research=(await request(`/api/workspace/researches/${id}`)).research;assert(research.references.length>0,"来源进入选题空间");
 await page.getByRole("button",{name:"开始写文章",exact:true}).click();await page.getByRole("button",{name:"创建文章",exact:true}).click();await page.getByLabel("文章标题",{exact:true}).waitFor();await page.locator(".topic-article .cm-content").fill("我想从具体任务入手，理解上下文、工具和反馈如何影响结果。");const savedResearch=(await request(`/api/workspace/researches/${id}`)).research;const project=savedResearch.projects[0].id;
 await until(()=>request(`/api/workspace/projects/${project}`),r=>r.project.masterDraft.body.includes("具体任务"),"文章写入持久化");
 const download=page.waitForEvent("download");await page.getByRole("button",{name:"导出文章",exact:true}).click();assert((await download).suggestedFilename().endsWith(".md"));await page.reload();await page.getByRole("button",{name:"文章",exact:true}).click();await page.locator(".topic-article .cm-content").waitFor();assert((await page.locator(".topic-article .cm-content").innerText()).includes("具体任务"));
 await page.goto(base+"/#/intel");await page.getByRole("button",{name:"已采用",exact:true}).click();await page.getByRole("button",{name:"继续讨论",exact:true}).waitFor();assert.equal(errors.length,0,errors.join("\n"));console.log("情报真实端到端：手工记录 → 配置 → 任务队列 → 证据卡片 → 选题引用 → 文章保存/刷新/导出通过。外部采集与模型为注入依赖，无外网付费调用。");
}catch(error){console.log(await page?.locator("body").innerText());throw error;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}const rel=path.relative(os.tmpdir(),temp);assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
