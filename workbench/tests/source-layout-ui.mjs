import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { createBookRecord } from '../server/routes/books-local.mjs';
import { createResearch } from '../server/domain/research.mjs';
const ROOT=path.resolve(import.meta.dirname,'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-source-layout-'));
const vars={XENHO_HOME:path.join(temp,'Xenho'),WB_KEEP_ALIVE:'1',HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost'};
const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);let pw;
for(const root of [ROOT,'C:/Users/Lenovo',process.env.APPDATA&&path.join(process.env.APPDATA,'npm','node_modules')].filter(Boolean)){try{pw=require(require.resolve('playwright',{paths:[root]}));break;}catch{}}
let server,browser,page;
const base='http://127.0.0.1:5254';
try {
 server=await createServer({root:ROOT,configFile:path.join(ROOT,'vite.config.mjs'),server:{host:'127.0.0.1',port:5254,strictPort:true,open:false},logLevel:'error'});await server.listen();
 const w=await server.xenhoWorkspace;

 await createBookRecord(w,{title:'课程：构建自己的知识库',kind:'藏书',sourceKind:'课程',chapters:[{title:'第1节. 构建知识库',text:'章节测试正文。'.repeat(200)},{title:'第2节. 让资料成为可核对的知识来源',text:'第二节正文。'.repeat(60)}]});
 createResearch(w,{question:'怎样建立可持续使用的知识库？',notes:'先从真实阅读和核对开始。'});
 browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:970,height:698},colorScheme:'dark'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const shots=path.join(ROOT,'output','playwright');await fs.mkdir(shots,{recursive:true});
 await page.goto(base+'/#/sources');await page.getByRole('button',{name:'课程：构建自己的知识库',exact:true}).click();await page.locator('.src-row--child').first().waitFor();
 async function aligned(){
  assert(await page.locator('.src-table').evaluate(el=>{
   const rows=[...el.querySelectorAll('.src-row')];const header=rows[0];
   const rects=n=>[...n.children].filter(c=>getComputedStyle(c).display!=='none').map(c=>c.getBoundingClientRect());const cols=rects(header);
   return rows.every(row=>{const cells=rects(row);return cells.length===cols.length&&cells.every((c,i)=>Math.abs(c.left-cols[i].left)<2&&c.width>0);});
  }),'父行、章节与表头列对齐');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'页面无横向溢出');
 }
 for(const width of [970,1440,800,390]){
  await page.setViewportSize({width,height:width===390?844:698});await aligned();
  await page.screenshot({path:path.join(shots,'sources-expanded-'+width+'.png'),fullPage:true});
  await page.getByRole('button',{name:'批量选择',exact:true}).click();await aligned();
  await page.getByRole('checkbox',{name:'选择 课程：构建自己的知识库',exact:true}).check();
  await page.screenshot({path:path.join(shots,'sources-selected-'+width+'.png'),fullPage:true});
  await page.getByRole('button',{name:'取消选择',exact:true}).click();await aligned();
 }
 await page.setViewportSize({width:970,height:698});
 await page.getByRole('button',{name:'第1节. 构建知识库',exact:true}).click();await page.getByRole('button',{name:'返回来源',exact:true}).waitFor();await page.getByRole('button',{name:'返回来源',exact:true}).click();
 await page.goto(base+'/#/research');await page.locator('.research-card').waitFor();assert.equal(await page.locator('.research-overview h1').count(),0);assert.equal(await page.getByText('围绕一个问题，读资料、记想法、讨论和写作。',{exact:true}).count(),0);
 await page.screenshot({path:path.join(shots,'research-compact-970.png'),fullPage:true});
 await page.getByRole('button',{name:'＋ 新建选题',exact:true}).click();await page.getByRole('textbox',{name:'你想弄明白什么',exact:true}).fill('从真实材料展开的新问题');await page.getByRole('button',{name:'开始展开',exact:true}).click();await page.waitForURL(/#\/research\//);
 assert.equal(errors.length,0,errors.join('\n'));console.log('来源：展开及批量选择父子列对齐、970/1440/800/390截图、阅读入口；选题精简与新建通过');
}finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}const rel=path.relative(os.tmpdir(),temp);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
