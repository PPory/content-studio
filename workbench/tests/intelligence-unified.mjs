// 统一整理（热点事件雷达，2026-09-23）：一次跑完、权限隔离、成员不变不重复调用、模型失败可恢复、
// 大量无关资料只在本地过滤、卡片身份合并后用户状态保留。独立的临时 XENHO_HOME，模型为模拟。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openWorkspace} from '../server/storage/workspace.mjs';
import {addIntelligenceSource,saveIntelligenceProfile,enqueueIntelligence} from '../server/domain/intelligence.mjs';
import {executeIntelligence} from '../server/domain/intelligence-runner.mjs';
import {intelligenceFeed,feedbackIntelligenceBrief,intelligenceBrief} from '../server/domain/intelligence-feed.mjs';
import {unifiedSummary,mergeBriefIdentities,canonicalBriefId} from '../server/domain/intelligence-unified.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-unified-'));let w;
// 情报只整理 7 天内发布的资料；夹具默认是一小时前发布的。
const fresh=new Date(Date.now()-3600000).toISOString();
try {
 w=await openWorkspace({xenhoHome:root});
 const profile=saveIntelligenceProfile(w,{name:'测试情报',query:'AI',providers:['collected'],output:'briefs'});
 const topics=['Opus 5.5','GPT-6 Sol','Gemini 4 Flash','Qwen-Image 2.1','Llama 6'];
 const sources=topics.map((t,i)=>addIntelligenceSource(w,{publishedAt:fresh,title:`${t} language model release report`,url:`https://publisher${i}.example/report`,body:`The ${t} language model release was reported with pricing and benchmark details.`,provider:'web',readLevel:'original'}));
 const blocked=addIntelligenceSource(w,{publishedAt:fresh,title:'Mistral 9 private language model report',url:'https://private.example/report',body:'Mistral 9 private text about a language model.',provider:'web',readLevel:'original'});
 w.db.prepare("UPDATE intel_sources SET acquisition_identity='private-test',rights_json='{}' WHERE id=?").run(blocked.id);
 let calls=0,seen=[],fail=false;
 const deps={completeJson:async(_env,input)=>{const d=JSON.parse(input.user);if(d.step!=='event-judge')throw Error('unexpected model task '+(d.step||'material'));calls++;if(fail)throw Error('model unavailable');seen=d.events.flatMap(e=>e.items.map(i=>i.title));
  return {data:{events:d.events.map(e=>({id:e.id,keep:true,kind:'event',title:`事件：${e.items[0].title.slice(0,20)}`,summary:'概要。',whyItMatters:'意义'}))}};}};
 const run=enqueueIntelligence(w,profile.id);
 let result=await executeIntelligence(w,{}, {runId:run.id},deps);
 assert.equal(result.status,'done','一次跑完，不再分轮等待');
 assert.equal(calls,1,'所有事件一次批量判断');
 assert(!seen.some(t=>t.includes('Mistral 9')),'未授权的资料不发给模型');
 assert.equal(unifiedSummary(w).permissionRequired,1);
 assert.equal(intelligenceFeed(w).briefs.length,5,'不同型号各自成卡');
 assert.equal(intelligenceFeed(w).recommendationIds.length,5);
 const selected=intelligenceFeed(w).briefs[0];feedbackIntelligenceBrief(w,selected.id,{saved:true,dismissed:true});
 await executeIntelligence(w,{}, {runId:enqueueIntelligence(w,profile.id).id},deps);
 assert.equal(calls,1,'成员不变不再调用模型');assert.equal(intelligenceFeed(w).briefs.length,5);
 assert.equal(intelligenceBrief(w,selected.id).saved,true);assert.equal(intelligenceBrief(w,selected.id).dismissed,true);
 // 模型失败：这次不出新卡、不抛出；恢复后下一次更新补上。
 const late=addIntelligenceSource(w,{publishedAt:fresh,title:'DeepSeek V5 language model release report',url:'https://late.example/report',body:'The DeepSeek V5 language model release report.',provider:'web',readLevel:'original'});
 fail=true;result=await executeIntelligence(w,{}, {runId:enqueueIntelligence(w,profile.id).id},deps);
 assert.equal(result.status,'partial','模型失败如实标记');assert.equal(intelligenceFeed(w).briefs.length,5);
 fail=false;await executeIntelligence(w,{}, {runId:enqueueIntelligence(w,profile.id).id},deps);
 assert.ok(intelligenceFeed(w).briefs.some(b=>b.event?.members?.some(m=>m.sourceId===late.id)),'模型恢复后补上');
 // 大量明显无关的资料在本地过滤，不进模型。
 w.db.transaction(()=>{for(let i=0;i<1200;i++)addIntelligenceSource(w,{publishedAt:fresh,title:'Netflix TV shows and movies '+i,url:'https://local-filter.example/'+i,body:'A discussion of movies and television with no technical subject.',provider:'web',readLevel:'original'});})();
 const before=calls;const localResult=await executeIntelligence(w,{}, {runId:enqueueIntelligence(w,profile.id).id},deps);
 assert.equal(localResult.status,'done');assert.equal(calls,before,'无关资料不调用模型');
 assert(unifiedSummary(w).filtered>=1200);
 // 卡片身份合并：别名可解析，用户状态并入规范卡。
 const canonical=intelligenceFeed(w).briefs.find(b=>b.id!==selected.id).id;
 mergeBriefIdentities(w,canonical,[selected.id]);
 assert.equal(canonicalBriefId(w,selected.id),canonical);assert.equal(intelligenceBrief(w,selected.id).id,canonical);assert.equal(intelligenceBrief(w,canonical).saved,true);
 assert.deepEqual(w.db.pragma('foreign_key_check'),[]);
 console.log('intelligence-unified: single pass, permission isolation, judge cache, user state, model failure recovery, 1200 local exclusions and identity merge passed');
} finally {w?.close();assert(!path.relative(os.tmpdir(),root).startsWith('..'));await fs.rm(root,{recursive:true,force:true});}
