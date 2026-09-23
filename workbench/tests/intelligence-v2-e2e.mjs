import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {workbenchApi} from '../server/vite-plugin-workbench.mjs';
import {openWorkspace} from '../server/storage/workspace.mjs';
import {saveIntelligenceProfile,enqueueIntelligence,addIntelligenceSource} from '../server/domain/intelligence.mjs';
import {saveIntelligenceBriefs} from '../server/domain/intelligence-feed.mjs';
const ROOT=path.resolve(import.meta.dirname,'..'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-intel-v2-e2e-'));
const vars={XENHO_HOME:path.join(temp,'Xenho'),WB_KEEP_ALIVE:'1',HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost'};
const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);let pw;
for(const root of [ROOT,'C:/Users/Lenovo',process.env.APPDATA&&path.join(process.env.APPDATA,'npm','node_modules')].filter(Boolean)){try{pw=require(require.resolve('playwright',{paths:[root]}));break;}catch{}}
assert(pw);let server,browser,page,w,model;const base='http://127.0.0.1:5264';
async function api(suffix,body){const response=await fetch(base+'/api/workspace/'+suffix,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();assert(response.ok&&data.ok,JSON.stringify(data));return data;}
try {
 w=await openWorkspace({xenhoHome:vars.XENHO_HOME});
 const profile=saveIntelligenceProfile(w,{name:'V2完整流程',query:'任务验收',providers:['web'],output:'briefs'}),run=enqueueIntelligence(w,profile.id);
 const quote='这是隔离验收原文：需要直接检查任务产物，不能仅依赖模型的完成声明。';
 const source=addIntelligenceSource(w,{provider:'web',publishedAt:new Date(Date.now()-3600000).toISOString(),title:'独立验收实验说明',url:'https://example.com/acceptance',body:quote+'该材料仅供软件测试，不代表真实实验结论。',contentKind:'article',readLevel:'original'},run.id);
 const item={storyKey:'e2e-acceptance',title:'如何检查任务产物是否真正完成',summary:'隔离案例用于验证证据可追溯的工作流。',reason:'帮助创作者检查产物',body:'## 发生了什么\n\n材料说明需要检查实际产物。[引文1]',confidence:'watch',kind:'practice',whyItMatters:'把验收变成可执行步骤',audienceTakeaway:'检查实际产物',suggestedUses:['设计一份验收清单'],uncertainties:['这是隔离测试材料'],claims:[{text:'材料提出检查实际产物',kind:'author_report',attribution:'材料作者',evidenceIds:['e1']}],evidence:[{sourceId:source.id,quote}]};
 const brief=saveIntelligenceBriefs(w,run.id,[item],[],null,[{index:0,verdict:'supported',claims:[{id:'c1',verdict:'supported'}]}]).saved[0];
 w.db.prepare("UPDATE intel_runs SET status='done' WHERE id=?").run(run.id);w.close();w=null;
 let modelCalls=0;
 model=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body),context=JSON.parse(request.messages.at(-1).content);assert.equal(context.briefs[0].id,brief.id);modelCalls++;const candidate={workingTitle:'制作一份内容Agent验收清单',audience:'个人创作者',angle:'检查产物而非完成声明',deliverable:'可执行检查清单',whyNow:'用隔离案例验证工作流',evidenceGaps:['需要补充真实实践'],researchTasks:['设计检查并记录实际结果'],nonClaims:['不宣称所有模型都适用'],evidence:[{sourceId:source.id,quote}]};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({candidate})}}],usage:{total_tokens:100}}));});
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 const env={XENHO_HOME:vars.XENHO_HOME,AGENT_INGEST_BASE_URL:`http://127.0.0.1:${model.address().port}/v1`,AGENT_INGEST_API_KEY:'isolated-test-key',AGENT_INGEST_MODEL:'test-only'};
 server=await createServer({root:ROOT,configFile:false,plugins:[react(),workbenchApi(env)],server:{host:'127.0.0.1',port:5264,strictPort:true,open:false},logLevel:'error'});await server.listen();
 browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#/intel');await page.locator('.brief-card').filter({hasText:brief.title}).getByRole('button',{name:'加入选题',exact:true}).click();await page.getByRole('button',{name:'查看选题',exact:true}).waitFor();
 assert.equal(modelCalls,0,'直接选中情报无需调用模型');assert.equal((await api('intelligence/topics')).opportunities.length,0,'不产生第二套中间候选');
 await page.getByRole('button',{name:'查看选题',exact:true}).click();await page.waitForURL(/#\/research\//);await page.getByLabel('我的笔记',{exact:true}).waitFor();
 const id=decodeURIComponent(page.url().split('#/research/')[1]),research=(await api('researches/'+id)).research;
 assert.equal(research.references.length,1);assert.equal(research.intelligenceIntents.length,1);assert.deepEqual(research.intelligenceIntents[0].briefIds,[brief.id]);
 await page.reload();await page.getByLabel('我的笔记',{exact:true}).waitFor();assert.equal(modelCalls,0);
 assert.deepEqual((await api('intelligence/briefs/'+brief.id)).brief.researchIds,[id]);
 const shots=path.join(ROOT,'output','playwright');await fs.mkdir(shots,{recursive:true});
 await page.getByRole('button',{name:'开始写文章',exact:true}).click();await page.getByRole('button',{name:'创建文章',exact:true}).click();await page.getByLabel('文章标题',{exact:true}).waitFor();
 assert.equal((await api('researches/'+id)).research.projects.length,1);await page.screenshot({path:path.join(shots,'intelligence-v2-e2e-research.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('intelligence-v2-e2e: real HTTP, SQLite, direct topic intent with zero model calls, reload, provenance and article creation passed');
}finally{w?.close();await browser?.close();await server?.close();await server?.xenhoClose?.();if(model)await new Promise(resolve=>model.close(resolve));for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}const rel=path.relative(os.tmpdir(),temp);assert(rel&&!rel.startsWith('..'));await fs.rm(temp,{recursive:true,force:true});}
