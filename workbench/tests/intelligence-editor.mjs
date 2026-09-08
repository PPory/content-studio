import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openWorkspace} from '../server/storage/workspace.mjs';
import {saveIntelligenceProfile,enqueueIntelligence,intelligenceOverview} from '../server/domain/intelligence.mjs';
import {executeIntelligence} from '../server/domain/intelligence-runner.mjs';
import {intelligenceFeed,intelligenceBrief,feedbackIntelligenceBrief,blockIntelligenceSource} from '../server/domain/intelligence-feed.mjs';
import {configureAssistantWorkspace,runAssistantTurn,assistantConversation,createAssistantConversation} from '../server/agent-runtime/assistant-runner.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-editor-'));
let w;
try {
 w=await openWorkspace({xenhoHome:path.join(root,'Xenho')});configureAssistantWorkspace(w);
 const p=saveIntelligenceProfile(w,{name:'个人精选',query:'AI与学习',providers:['web','x','reddit'],frequency:'manual',limit:2,output:'briefs'});
 assert.throws(()=>saveIntelligenceProfile(w,{...p,frequency:'daily'}));
 const r=enqueueIntelligence(w,p.id),reads=[];
 const quote='Use feedback loops to understand model limitations.';
 const done=await executeIntelligence(w,{}, {runId:r.id},{
  planResearch:async()=>({query:'AI learning',queries:{web:['model feedback','learning practice'],x:'agent practice',reddit:'local models'}}),
  searchWeb:async(_env,input)=>({sources:[{url:'https://example.com/'+encodeURIComponent(input.query),title:'Model practice'}]}),
  readArticle:async url=>{reads.push(url);return {url,title:'Model practice',markdown:quote+' FULL_PUBLIC_BODY_NOT_FOR_CHAT'};},
  completeJson:async(_env,input)=>{const d=JSON.parse(input.user);assert.ok(d.sources.some(s=>s.provider==='x'));assert.ok(d.sources.some(s=>s.provider==='reddit'));return {data:{briefs:[{storyKey:'model-feedback',title:'反馈能帮助理解模型的局限',summary:'测试解读摘要',reason:'连接AI与学习实践',body:'先明确任务，再通过反馈观察局限。[来源1]',confidence:'reliable',kind:'practice',evidence:[{sourceId:d.sources[0].id,quote}],wiki:[]}]}};}
 });
 assert.equal(done.status,'done');assert.ok(reads.some(x=>x.includes('learning%20practice')),'complementary query is read');
 const b=intelligenceFeed(w).briefs[0];assert.ok(b);assert.equal(intelligenceOverview(w).cards.length,0,'curation does not create topic candidates');
 const researchCount=()=>w.db.prepare("SELECT count(*) n FROM entities WHERE entity_type='research' AND deleted_at IS NULL").get().n;
 const before=researchCount();
 let prompt='';
 const turn=await runAssistantTurn({}, {scopeId:b.scopeId,message:'这个观点有哪些局限？',document:{},materials:[],mode:'general',permissionMode:'daily',model:'test-model'}, {createRun:async input=>{prompt=input.prompt;return {result:{finalResponse:'需要结合具体任务判断。'},piSessionId:'',piSessionFile:'',permissionMode:'daily'};}});
 assert.match(prompt,/反馈能帮助理解模型的局限/);assert.ok(prompt.includes(quote));assert.ok(!prompt.includes('FULL_PUBLIC_BODY_NOT_FOR_CHAT'));
 assert.equal(researchCount(),before,'reading and discussion cannot create a research');
 assert.equal(intelligenceBrief(w,b.id).conversations[0].id,turn.conversation.id);
 feedbackIntelligenceBrief(w,b.id,{saved:true,helpful:true});
 await assert.rejects(()=>createAssistantConversation('intelligence:nonexistent'));
 w.close();w=await openWorkspace({xenhoHome:path.join(root,'Xenho')});configureAssistantWorkspace(w);
 assert.equal(intelligenceBrief(w,b.id).saved,true);assert.equal((await assistantConversation(b.scopeId,turn.conversation.id)).messages.at(-1).text,'需要结合具体任务判断。');
 blockIntelligenceSource(w,{host:'blocked.example.com',blocked:true});
 const next=enqueueIntelligence(w,p.id);let blockedRead=false;
 await executeIntelligence(w,{}, {runId:next.id},{planResearch:async()=>({query:'AI'}),searchWeb:async()=>({sources:[{url:'https://blocked.example.com/a'}]}),readArticle:async()=>{blockedRead=true;return{};},completeJson:async()=>({data:{briefs:[]}})});
 assert.equal(blockedRead,false,'blocked host is filtered before any read');
 console.log('intelligence-editor: provider search, brief generation, chat privacy, persistence and blocking passed');
} finally {w?.close();await fs.rm(root,{recursive:true,force:true});}
