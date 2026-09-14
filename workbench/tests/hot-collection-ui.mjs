import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { workbenchApi } from "../server/vite-plugin-workbench.mjs";
const ROOT=path.resolve(import.meta.dirname,"..");
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"xenho-hot-collection-ui-"));
const vars={XENHO_HOME:path.join(temp,"Xenho"),WB_KEEP_ALIVE:"1",HTTP_PROXY:"http://127.0.0.1:9",HTTPS_PROXY:"http://127.0.0.1:9",NO_PROXY:"127.0.0.1,localhost"};
const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);let pw;
for(const root of [ROOT,"C:/Users/Lenovo",process.env.APPDATA && path.join(process.env.APPDATA,"npm","node_modules")].filter(Boolean)){try{pw=require(require.resolve("playwright",{paths:[root]}));break;}catch{}}
assert(pw,"Playwright available");
let server,browser,page;
const base="http://127.0.0.1:5255",calls=[];
const data={ok:true,fetchedAt:new Date().toISOString(),stale:false,stats:{shown:2,matched:1,total:2},groups:[{day:"2026-09-08",items:[{title:"模型发布后的实践观察",summary:"一条 AI Hot 测试摘要。",link:"https://example.com/ai",at:"2026-09-08T01:00:00Z",sources:["测试来源"],sourceCount:1,category:"模型",hits:[]},{title:"开发工具的新用法",summary:"另一条测试摘要。",link:"https://example.com/dev",at:"2026-09-08T02:00:00Z",sources:["另一来源"],sourceCount:1,hits:[]}]}]};
try{
 server=await createServer({root:ROOT,configFile:false,plugins:[react(),workbenchApi({XENHO_HOME:vars.XENHO_HOME})],server:{host:"127.0.0.1",port:5255,strictPort:true,open:false},logLevel:"error"});await server.listen();browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/hot/**",async route=>{const url=new URL(route.request().url());calls.push(url.pathname+url.search);let result={ok:true};if(url.pathname.endsWith("/ai"))result=data;else if(url.pathname.endsWith("/trace"))result={ok:true,items:{}};else if(url.pathname.endsWith("/read"))result={ok:true,article:{title:"模型发布后的实践观察",url:"https://example.com/ai",markdown:"# 真实测试原文\n\n用于隔离验证的原文阅读内容。"}};else if(url.pathname.endsWith("/models"))result={ok:true,fetchedAt:new Date().toISOString(),count:1,items:[{rank:1,name:"测试模型",vendor:"测试厂商",released:"2026-09",score:"90",link:"https://example.com/model",completeness:"100%"}]};await route.fulfill({contentType:"application/json",body:JSON.stringify(result)});});
 await page.goto(base+"/#/hot");await page.getByRole("heading",{name:"模型发布后的实践观察",exact:true}).waitFor();assert(calls.some(c=>c.includes("/ai?all=1")),"默认全部AI信息");assert(!await page.getByRole("button",{name:"平台热榜",exact:true}).count());assert(!calls.some(c=>c.includes("/boards")),"从不读取平台榜");
 await page.getByLabel("搜索 AI 热点",{exact:true}).fill("开发工具");await page.getByRole("heading",{name:"开发工具的新用法",exact:true}).waitFor();assert.equal(await page.locator(".ai-item").count(),1);await page.getByLabel("搜索 AI 热点",{exact:true}).fill("不存在的词");await page.getByText("没有匹配的 AI 热点",{exact:true}).waitFor();await page.getByLabel("搜索 AI 热点",{exact:true}).fill("");

 await page.getByRole('button',{name:'收进灵感库',exact:true}).first().click();
 await page.getByText('已收藏',{exact:true}).waitFor();
 let info=await(await page.request.get(base+'/api/workspace/intelligence')).json();const source=info.sources.find(s=>s.url==='https://example.com/ai');assert(source);assert.equal(source.readLevel,'summary');assert(source.body.includes('一条 AI Hot 测试摘要。'));
 const again=await(await page.request.post(base+'/api/workspace/intelligence/hot-collection',{data:{title:source.title,url:source.url,summary:'变化后的摘要'}})).json();assert.equal(again.source.id,source.id,'同URL不重复收藏');
 const endpoint=base+'/api/workspace/intelligence/sources/'+source.id+'/research';
 assert.equal((await page.request.post(endpoint,{data:{question:'未确认'}})).status(),400);
 assert.equal((await page.request.post(endpoint,{data:{confirmed:true}})).status(),400);
 assert.equal((await page.request.post(endpoint,{data:{confirmed:true,researchId:'missing'}})).status(),404);
 let researches=await(await page.request.get(base+'/api/workspace/researches')).json();assert.equal(researches.researches.length,0,'无效或未确认请求不建选题');
 await page.reload();await page.getByText('已收藏',{exact:true}).waitFor();await page.getByRole('button',{name:'带入选题',exact:true}).click();await page.getByRole('dialog',{name:'带入选题'}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();
 researches=await(await page.request.get(base+'/api/workspace/researches')).json();assert.equal(researches.researches.length,0,'取消不建选题');
 await page.getByRole('button',{name:'查看灵感',exact:true}).click();await page.locator('.intel-source summary').filter({hasText:source.title}).click();await page.getByRole('link',{name:'查看原文 ↗',exact:true}).waitFor();await page.getByRole('button',{name:'带入选题',exact:true}).click();await page.getByLabel('想研究的问题',{exact:true}).fill('模型如何帮助实际工作？');
 const shots2=path.join(ROOT,'output','playwright');await fs.mkdir(shots2,{recursive:true});await page.screenshot({path:path.join(shots2,'hot-source-research-dialog.png')});
 await page.getByRole('button',{name:'创建选题并带入',exact:true}).click();await page.waitForURL(/research\//);
 researches=await(await page.request.get(base+'/api/workspace/researches')).json();assert.equal(researches.researches.length,1);const research=researches.researches[0];assert.equal(research.notes,'');assert.equal(research.references.length,1);assert.equal(research.references[0].sourceUrl,source.url);assert(research.references[0].excerpt.includes('尚未核对原文'));
 const repeated=await(await page.request.post(endpoint,{data:{confirmed:true,question:'模型如何帮助实际工作？'}})).json();assert.equal(repeated.research.id,research.id,'重试新建幂等');
 const existing=await(await page.request.post(endpoint,{data:{confirmed:true,researchId:research.id}})).json();assert.equal(existing.research.references.length,1,'重复关联幂等');
 await page.goto(base+'/#/hot');await page.getByRole('button',{name:'带入选题',exact:true}).click();await page.getByLabel('放到哪里',{exact:true}).selectOption(research.id);await page.getByRole('button',{name:'确认带入',exact:true}).click();await page.waitForURL(/research\//);
 await page.goto(base+'/#/intel-inbox');await page.locator('.intel-source').first().waitFor();await page.setViewportSize({width:970,height:698});await page.screenshot({path:path.join(shots2,'inspiration-toolbar-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots2,'inspiration-toolbar-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/#/hot');await page.getByText('已收藏',{exact:true}).waitFor();
 await page.route('**/api/workspace/intelligence/hot-collection',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'模拟收藏失败'})}));await page.getByRole('button',{name:'收进灵感库',exact:true}).click();await page.getByText(/收录失败/).waitFor();await page.unroute('**/api/workspace/intelligence/hot-collection');
 await page.getByRole("button",{name:"聊一聊",exact:true}).first().click();
 await page.locator('.rpick textarea').fill('测试热点看法：先验证具体用途。');
 await page.getByRole('button',{name:'记下来',exact:true}).click();await page.locator('.rpick').waitFor({state:'hidden'});
 await page.reload();await page.getByRole('heading',{name:'模型发布后的实践观察',exact:true}).waitFor();
 const saved=await (await page.request.get(base+'/api/workspace/seeds')).json();
 assert(JSON.stringify(saved).includes('测试热点看法：先验证具体用途。'),'热点看法保存并在刷新后存在');
 console.log('热点看法刷新后仍可读取');
 const shots=path.join(ROOT,"output","playwright");await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,"aihot-restored-desktop.png"),fullPage:true});await page.getByRole("button",{name:"在这里读",exact:true}).first().click();await page.getByText("用于隔离验证的原文阅读内容。",{exact:true}).waitFor();await page.keyboard.press("Escape");await page.getByRole("tab",{name:"模型榜",exact:true}).click();await page.getByText("测试模型",{exact:true}).waitFor();await page.getByRole("tab",{name:"AI 热点",exact:true}).click();await page.getByRole("heading",{name:"模型发布后的实践观察",exact:true}).waitFor();await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"手机无横向溢出");assert(await page.locator(".ai-hot-panel .panel-head__aside").evaluate(el=>el.scrollWidth<=el.clientWidth),"热点工具栏没有被裁切");await page.screenshot({path:path.join(shots,"aihot-restored-mobile.png"),fullPage:true});assert.equal(errors.length,0,errors.join("\n"));console.log("AI Hot：默认全部、本地搜索、原文阅读、模型榜保留、无平台榜调用及手机通过");
}catch(error){console.log(await page?.locator("body").innerText());throw error;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}const rel=path.relative(os.tmpdir(),temp);assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
