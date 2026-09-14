import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { createUlid } from '../server/storage/ids.mjs';
const ROOT=path.resolve(import.meta.dirname,'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-review-ui-'));
const vars={XENHO_HOME:path.join(temp,'Xenho'),WB_KEEP_ALIVE:'1',HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost'};
const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);let pw;
for(const root of [ROOT,'C:/Users/Lenovo',process.env.APPDATA&&path.join(process.env.APPDATA,'npm','node_modules')].filter(Boolean)){try{pw=require(require.resolve('playwright',{paths:[root]}));break;}catch{}}
let server,browser,page;
const base='http://127.0.0.1:5251';
try {
 server=await createServer({root:ROOT,configFile:path.join(ROOT,'vite.config.mjs'),server:{host:'127.0.0.1',port:5251,strictPort:true,open:false},logLevel:'error'});await server.listen();
 const w=await server.xenhoWorkspace;
 const publication=(title)=>{
  const p=w.domain.createProject({title,confirmed:true,actor:'user'});
  const d=w.domain.createDraft({projectId:p,title,bodyMarkdown:'真实测试正文。',actor:'user'});
  const r=w.domain.saveRevision(d,{title,bodyMarkdown:'真实测试正文。'});
  const hash=w.db.prepare('SELECT content_sha256 h FROM revisions WHERE id=?').get(r).h;
  const id=createUlid();w.repository.createEntity({id,type:'publication'});
  w.db.prepare("INSERT INTO publication_records(id,draft_id,revision_id,content_sha256,platform,title,published_url,published_at,idempotency_key) VALUES(?,?,?,?,'公众号',?,'https://example.com/test',?,?)").run(id,d,r,hash,title,new Date().toISOString(),id);
  return {id,project:p};
 };
 const pending=publication('一次值得复盘的发布');const done=publication('已经总结的文章');
 w.domain.submitPublicationReview(done.id,{status:'普通',basisMarkdown:'测试记录有一条明确的读者反馈。',conclusionMarkdown:'开头的具体场景帮助读者理解。',nextExperimentMarkdown:'下一篇先给出一个实际问题。',actor:'user'});
 browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const shots=path.join(ROOT,'output','playwright');await fs.mkdir(shots,{recursive:true});
 await page.route('**/api/workspace/publications',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,rows:[{title:'平台导入的独立记录',platform:'公众号',date:'2026-09-01',views:18,doc:''}]})}));
 await page.goto(base+'/#/review');await page.getByRole('button',{name:'开始复盘',exact:true}).waitFor();
 assert.equal(await page.locator('.review-card').count(),1);
 assert.equal(await page.locator('.review-page__observations').getAttribute('open'),null);
 await page.screenshot({path:path.join(shots,'review-pending-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'开始复盘',exact:true}).click();await page.waitForURL('**/#/project/'+pending.project);
 await page.goto(base+'/#/review');await page.getByRole('tab',{name:/已完成/}).click();await page.getByText('开头的具体场景帮助读者理解。',{exact:true}).waitFor();
 assert(await page.getByText('下一篇先给出一个实际问题。',{exact:true}).isVisible());
 await page.getByRole('button',{name:'查看复盘',exact:true}).click();await page.waitForURL('**/#/project/'+done.project);
 await page.goto(base+'/#/review');await page.getByRole('tab',{name:/待关联稿件/}).click();await page.getByText('平台导入的独立记录',{exact:true}).waitFor();
 await page.getByRole('button',{name:'打开创作',exact:true}).click();await page.waitForURL('**/#/content');
 await page.goto(base+'/#/review');await page.getByRole('button',{name:'查看发布数据',exact:true}).click();await page.waitForURL('**/#/review-performance');
 await page.goto(base+'/#/review');await page.getByRole('tab',{name:/已完成/}).click();await page.getByText('开头的具体场景帮助读者理解。',{exact:true}).waitFor();
 await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:path.join(shots,'review-completed-dark.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'review-mobile.png'),fullPage:true});
 await page.unroute('**/api/workspace/publications');await page.route('**/api/workspace/publications',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'发布数据读取失败测试'})}));
 await page.reload();await page.getByRole('button',{name:'开始复盘',exact:true}).waitFor();
 await page.getByRole('tab',{name:/待关联稿件/}).click();await page.getByText(/发布数据读取失败测试/).first().waitFor();
 assert(!await page.getByText('没有待关联的发布记录。',{exact:true}).count());
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('复盘：真实发布与结论、任务优先、各按钮落点、分区失败和深浅色手机截图通过');
} catch(e){if(page)console.log(await page.locator('body').innerText());throw e;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}const rel=path.relative(os.tmpdir(),temp);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
