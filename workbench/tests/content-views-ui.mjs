import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const ROOT=path.resolve(import.meta.dirname,'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-content-views-ui-'));
const vars={XENHO_HOME:path.join(temp,'Xenho'),WB_KEEP_ALIVE:'1',HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost'};
const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);let pw;
for(const root of [ROOT,'C:/Users/Lenovo',process.env.APPDATA&&path.join(process.env.APPDATA,'npm','node_modules')].filter(Boolean)){try{pw=require(require.resolve('playwright',{paths:[root]}));break;}catch{}}
let server,browser,page;
const base='http://127.0.0.1:5252';
try {
 server=await createServer({root:ROOT,configFile:path.join(ROOT,'vite.config.mjs'),server:{host:'127.0.0.1',port:5252,strictPort:true,open:false},logLevel:'error'});await server.listen();
 const w=await server.xenhoWorkspace;
 const title='如何把读过的书变成自己的判断，而不是越来越长的收藏夹';
 const ids=[];
 for(const name of [title,'给创作留下一点不确定','记录一次失败的尝试']) {
  const id=w.domain.createProject({title:name,confirmed:true,actor:'user'});ids.push(id);
  w.domain.createDraft({projectId:id,title:name,bodyMarkdown:'用于隔离测试的真实正文。',actor:'user'});
 }
 browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const shots=path.join(ROOT,'output','playwright');await fs.mkdir(shots,{recursive:true});
 console.log('open content');await page.goto(base+'/#/content');await page.locator('.ptable__row').first().waitFor();
 assert.equal(await page.locator('.ptable__row').count(),3);
 assert.equal(await page.getByRole('button',{name:'列表视图',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'卡片视图',exact:true}).click();await page.locator('.content-card').first().waitFor();
 assert.equal(await page.locator('.content-card').count(),3);
 await page.reload();await page.locator('.content-card').first().waitFor();
 assert.equal(await page.getByRole('button',{name:'卡片视图',exact:true}).getAttribute('aria-pressed'),'true');
 console.log('cards loaded');const card=page.locator('.content-card').filter({hasText:title});
 console.log('open card');await card.getByRole('button',{name:'打开「'+title+'」',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForURL('**/#/project/'+ids[0]);
 await page.goto(base+'/#/content');await page.locator('.content-card').first().waitFor();
 await card.getByRole('button',{name:'把「'+title+'」放进合集',exact:true}).click();
 console.log('filing');const picker=page.getByRole('dialog',{name:'把这篇文章放进合集'});
 await picker.getByRole('textbox',{name:'搜索',exact:true}).fill('阅读与创作');
 await picker.getByRole('button',{name:'新建合集「阅读与创作」'}).click();
 await picker.getByRole('button',{name:'确认',exact:true}).click();
 await card.locator('.content-card__collections').waitFor();assert.equal(await card.locator('.content-card__collections').innerText(),'阅读与创作');
 await card.getByRole('button',{name:/删除「/}).click();await page.waitForTimeout(420);await card.getByRole('button',{name:'删掉整篇',exact:true}).click();
 await page.getByText('「'+title+'」已移入回收站',{exact:true}).waitFor();assert.equal(await page.locator('.content-card').count(),2);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await card.locator('.content-card__collections').waitFor();assert.equal(await page.locator('.content-card').count(),3);
 await page.reload();await card.locator('.content-card__collections').waitFor();
 await page.screenshot({path:path.join(shots,'content-cards-desktop.png'),fullPage:true});
 await page.emulateMedia({colorScheme:'dark'});await page.setViewportSize({width:970,height:698});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'content-cards-dark.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'content-cards-mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'已发布',exact:true}).click();await page.getByText('发布后的作品会留在这里。',{exact:true}).waitFor();assert.equal(await page.locator('.content-card').count(),0);
 await page.getByRole('button',{name:'进行中 3',exact:true}).click();await card.waitFor();
 await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'列表视图',exact:true}).click();await page.locator('.ptable__row').first().waitFor();
 assert.equal(await page.locator('.ptable__row').count(),3);assert.equal(await page.locator('.ptable__series').innerText(),'阅读与创作');
 await page.reload();await page.locator('.ptable__row').first().waitFor();assert.equal(await page.getByRole('button',{name:'列表视图',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(errors.length,0,errors.join('\n'));console.log('创作双视图：默认列表、偏好记忆、键盘打开、合集归类、删除撤销、空状态及桌面手机截图通过');
} catch(e){if(page)console.log(await page.locator('body').innerText());throw e;}
finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}const rel=path.relative(os.tmpdir(),temp);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
