import {addIntelligenceSource} from '../server/domain/intelligence.mjs';
import {buildDiscoveryContext,writeDiscoveryCache,readDiscoveryCache,discoveryReadiness} from '../server/domain/content-discovery.mjs';
import {discoverConnections} from '../server/domain/content-discovery-ai.mjs';
import {directionKey,keepDirection,dismissDirection,savedDirections,developDirection} from '../server/domain/intelligence-directions.mjs';
import {createResearch,getResearch} from '../server/domain/research.mjs';
import {createUlid} from '../server/storage/ids.mjs';
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { workbenchApi } from "../server/vite-plugin-workbench.mjs";
const ROOT=path.resolve(import.meta.dirname,"..");
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"xenho-intelligence-directions-ui-"));
const vars={XENHO_HOME:path.join(temp,"Xenho"),WB_KEEP_ALIVE:"1",HTTP_PROXY:"http://127.0.0.1:9",HTTPS_PROXY:"http://127.0.0.1:9",NO_PROXY:"127.0.0.1,localhost"};
const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
const require=createRequire(import.meta.url);let pw;
for(const root of [ROOT,"C:/Users/Lenovo",process.env.APPDATA && path.join(process.env.APPDATA,"npm","node_modules")].filter(Boolean)){try{pw=require(require.resolve("playwright",{paths:[root]}));break;}catch{}}
assert(pw,"Playwright available");
let server,browser,page;

try{
 server=await createServer({root:ROOT,configFile:false,plugins:[react(),workbenchApi({XENHO_HOME:vars.XENHO_HOME})],server:{host:'127.0.0.1',port:5243,strictPort:true,open:false},logLevel:'error'});await server.listen();
 const w=await server.xenhoWorkspace;
 const source=addIntelligenceSource(w,{provider:'manual',title:'关于使用 AI 学习的疑问',body:'我发现让 AI 解释概念很快，但独立解决新问题时仍然不知道从哪里开始。',url:''});
 const context=buildDiscoveryContext(w);assert.equal(context.wikiPages.length,0);assert(discoveryReadiness(context).ready);assert(context.discoveries.some(s=>s.id===source.id));
 const candidate={problem:{statement:'理解解释与独立运用之间，还差什么？',origin:'hypothesis'},knowledge_anchors:[],basis:[{kind:'intelligence',id:source.id,quote:'独立解决新问题时仍然不知道从哪里开始'}],fit:'medium',fit_reason:'这条记录提示了理解与应用之间的落差，值得进一步验证。',knowledge_explanation:'可以从主动回忆和迁移练习的角度提出问题，尚需外部依据。',core_claim:'读懂 AI 的解释，可能还不足以独立运用知识。',cognitive_gap:'区分熟悉解释与能够应用。',evidence_gaps:['寻找实际学习过程中的对照案例']};
 const model={CONTENT_DISCOVERY_COMPLETE_JSON:async()=>({data:{connections:[candidate]}})};
 const generated=await discoverConnections(model,w,context);assert.equal(generated.connections.length,1,'no Wiki does not prevent discovery');
 const invalid=await discoverConnections({CONTENT_DISCOVERY_COMPLETE_JSON:async()=>({data:{connections:[{...candidate,basis:[{kind:'intelligence',id:source.id,quote:'这里不存在的原文不能保留'}]}]}})},w,context);assert.equal(invalid.connections.length,0);
 const connection=generated.connections[0];writeDiscoveryCache(w,{connections:[connection,{...connection,coreClaim:"先试着独立应用，再回看 AI 的解释。"},{...connection,coreClaim:"怎样判断自己真的理解了一个概念？"}],read:context.read,scannedAt:new Date().toISOString(),fingerprint:context.fingerprint});
 const counts=()=>({research:w.db.prepare('SELECT count(*) n FROM researches').get().n,projects:w.db.prepare('SELECT count(*) n FROM projects').get().n});
 const before=counts();assert.throws(()=>keepDirection(w,'x'.repeat(64)),e=>e.status===409);
 browser=await pw.chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5243/#/intel');await page.locator('.subnav').getByRole('button',{name:'选题',exact:true}).click();await page.getByRole('button',{name:'从已有知识探索',exact:true}).click();await page.locator('.opportunity-home .view-tabs').waitFor();assert.equal(await page.locator('.view-head__name').innerText().then(t=>t.split('知识选题').length-1),1,'面包屑里页名只出现一次');assert.equal(await page.locator('.opportunity-home h2').filter({hasText:'发现方向'}).count(),0,'页面不再自我介绍');assert(await page.locator('.nav').innerText().then(t=>!t.includes('内容机会')));
 assert.equal(await page.locator('.direction-overview-card').count(),3);assert.equal(await page.locator('.opportunity-brief').count(),0);
 // 卡片 / 列表双视图，选择记在 localStorage（每页一份）。
 await page.getByRole('button',{name:'列表视图',exact:true}).click();
 assert.equal(await page.locator('.direction-rows .row').count(),3,'切成列表之后条目一条不少');
 assert(await page.locator('.direction-rows .row-meta').evaluateAll(ns=>{
   const rects=ns.map(n=>n.getBoundingClientRect());
   return rects.every(r=>Math.abs(r.left-rects[0].left)<2&&Math.abs(r.right-rects[0].right)<2);
 }),'方向列表右侧各列对齐');
 assert.equal(await page.locator('.direction-overview-card').count(),0);
 await page.reload();await page.locator('.direction-rows .row').first().waitFor();
 assert.equal(await page.locator('.direction-overview-card').count(),0,'刷新之后还是列表');
 await page.getByRole('button',{name:'卡片视图',exact:true}).click();
 assert.equal(await page.locator('.direction-overview-card').count(),3,'切回卡片');await fs.mkdir(path.join(ROOT,'output','playwright'),{recursive:true});await page.screenshot({path:path.join(ROOT,'output','playwright','direction-cards-overview.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.locator('.direction-overview-card').last().scrollIntoViewIfNeeded();const gridScroll=await page.locator('.main').evaluate(el=>el.scrollTop);await page.locator('.direction-overview-card').last().click();assert(await page.getByRole('button',{name:'下一条',exact:true}).isDisabled());await page.getByRole('button',{name:'上一条',exact:true}).click();await page.getByRole('button',{name:'← 返回卡片总览',exact:true}).click();assert.equal(await page.locator('.main').evaluate(el=>el.scrollTop),gridScroll);await page.setViewportSize({width:1440,height:1000});await page.locator('.main').evaluate(el=>el.scrollTop=0);await page.getByRole('button',{name:connection.coreClaim,exact:true}).focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('[data-reader-active="true"] h4').count(),1,'方向详情只剩「还需要验证」一个眉标（这条候选没有 Wiki 连接）');await page.locator('[data-reader-active="true"] .opportunity-basis>summary').click();await page.locator('[data-reader-active="true"] summary').filter({hasText:'查看原始记录'}).click();await page.locator('[data-reader-active="true"]').getByText(source.body,{exact:true}).waitFor();assert.deepEqual(counts(),before);
 await page.getByRole('button',{name:'保存方向',exact:true}).click();await page.getByText('方向已保存，仍是待讨论的候选。',{exact:true}).waitFor();assert.deepEqual(counts(),before);
 await page.getByRole('button',{name:'聊聊这个方向',exact:true}).click();await page.locator('.direction-chat textarea').waitFor();assert.deepEqual(counts(),before);
 await page.locator('.direction-chat textarea').fill('暂时还没发出的想法');
 const reader=page.locator('[data-reader-active="true"]');await reader.evaluate(el=>el.scrollTop=260);const readingPosition=await reader.evaluate(el=>el.scrollTop);
 await page.getByRole('navigation',{name:'切换方向'}).getByRole('button').nth(1).click();assert.equal(await page.locator('[data-reader-active="true"] .direction-chat').count(),0);
 await page.getByRole('navigation',{name:'切换方向'}).getByRole('button').first().click();assert.equal(await page.locator('.direction-chat textarea').inputValue(),'暂时还没发出的想法');assert.equal(await reader.evaluate(el=>el.scrollTop),readingPosition);
 await page.getByRole('button',{name:'← 返回卡片总览',exact:true}).click();assert.equal(await page.locator('.direction-overview-card').count(),3);await page.getByRole('button',{name:connection.coreClaim,exact:true}).click();assert.equal(await page.locator('.direction-chat textarea').inputValue(),'暂时还没发出的想法');
 await page.getByRole('button',{name:'收起讨论',exact:true}).click();
 const id=directionKey(connection),cid=createUlid();w.repository.createEntity({id:cid,type:'ai_conversation'});w.db.prepare("INSERT INTO ai_conversations(id,title,scope_type,scope_id,record_json) VALUES(?,?,'global',?,?)").run(cid,'方向讨论',`direction:${id}`,JSON.stringify({messages:[]}));
 const shots=path.join(ROOT,'output','playwright');await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,'intelligence-directions-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'带入选题',exact:true}).click();await page.getByRole('dialog',{name:'带入选题',exact:true}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(counts(),before);
 // 已保存那一档里能移除一条，回执带撤销；新发现那一档没有「移除」——那儿还没有对象。
 await page.reload();await page.getByRole('tab',{name:/已保存/}).click();
 await page.locator('.direction-overview-card').first().waitFor();
 assert.equal(await page.getByRole('button',{name:/^移除方向：/}).count(),1,'已保存的方向能移除');
 await page.getByRole('button',{name:/^移除方向：/}).click();await page.waitForTimeout(400);
 await page.getByRole('button',{name:'移除方向',exact:true}).click();
 await page.getByText('方向已移除',{exact:true}).waitFor();
 assert.equal(await page.locator('.direction-overview-card').count(),0,'移除之后已保存里就没有它了');
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await page.locator('.direction-overview-card').first().waitFor();
 // 新发现那一档里只有**已经保存过**的那张才给「移除」——其余候选还没落库，没有对象可移除。
 await page.getByRole('tab',{name:/新发现/}).click();
 await page.locator('.direction-overview-card').first().waitFor();
 assert.equal(await page.locator('.direction-overview-card').count(),3);
 assert.equal(await page.getByRole('button',{name:/^移除方向：/}).count(),1,'只有已保存的那张能移除');
 await page.getByRole('tab',{name:/已保存/}).click();await page.getByLabel('搜索已保存的机会').fill('不匹配的搜索');await page.getByText('没有找到匹配的机会，试试其他关键词。',{exact:true}).waitFor();await page.getByLabel('搜索已保存的机会').fill('读懂 AI');await page.locator('.direction-overview-card').first().click();await page.getByRole('button',{name:'← 返回卡片总览',exact:true}).click();assert.equal(await page.getByLabel('搜索已保存的机会').inputValue(),'读懂 AI');await page.locator('.direction-overview-card').first().click();await page.getByRole('button',{name:'聊聊这个方向',exact:true}).click();await page.locator('.direction-chat textarea').waitFor();await page.getByRole('button',{name:'收起讨论',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'带入选题',exact:true}).scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const backBox=await page.getByRole('button',{name:'← 返回卡片总览',exact:true}).boundingBox();assert(backBox.y>=0&&backBox.y+backBox.height<=844);await page.screenshot({path:path.join(shots,'intelligence-directions-mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'带入选题',exact:true}).click();await page.getByRole('button',{name:'确认带入',exact:true}).click();await page.waitForURL(/#\/research\//);const researchId=decodeURIComponent(page.url().split('#/research/')[1]);const research=getResearch(w,researchId);assert(research.notes.includes(candidate.evidence_gaps[0]));assert(research.references.length===1);assert(research.conversations.some(c=>c.id===cid));assert.equal(counts().projects,before.projects);assert.equal(developDirection(w,id,{confirmed:true}).id,research.id);assert.throws(()=>developDirection(w,id,{}),e=>e.status===400);
 // Existing research append and stale-cache preservation.
 const second={...connection,coreClaim:'另一条待讨论的问题'};writeDiscoveryCache(w,{...readDiscoveryCache(w),connections:[second]});const kept=keepDirection(w,directionKey(second));const target=createResearch(w,{question:'原有选题',notes:'保留已有笔记'});developDirection(w,kept.id,{confirmed:true,researchId:target.id});assert(getResearch(w,target.id).notes.startsWith('保留已有笔记'));assert.equal(errors.length,0,errors.join('\n'));
 // 移除方向：只动标记位，行还在，能恢复；而「再保存一次」本身就是恢复
 // （不清 dismissed 的话保存会「成功」而列表里查无此条，且不报错）。
 const removable=directionKey(second);
 assert.equal(dismissDirection(w,removable).dismissed,true);
 assert.equal(savedDirections(w).some(d=>d.id===removable),false,'移除过的方向不出现在已保存里');
 assert.equal(dismissDirection(w,removable,false).dismissed,false);
 assert.equal(savedDirections(w).some(d=>d.id===removable),true);
 dismissDirection(w,removable);
 assert.equal(keepDirection(w,removable).dismissed,false,'再保存一次就是要它回来');
 assert.throws(()=>dismissDirection(w,'y'.repeat(64)),e=>e.status===404);
 console.log('方向：无Wiki生成、逐字证据、保存不建文、持续讨论、刷新恢复、取消、确认汇入、已有笔记、移除与恢复、手机通过');
}finally{await browser?.close();await server?.close();await server?.xenhoClose?.();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}const rel=path.relative(os.tmpdir(),temp);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));await fs.rm(temp,{recursive:true,force:true});}
