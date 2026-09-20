// Synthetic inputs, isolated temporary SQLite, no external requests or models.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openWorkspace} from '../server/storage/workspace.mjs';
import {getChannel,commitPage,acquisitionSourceDetails} from '../server/acquisition/store.mjs';
import {enqueueAcquisition,acquisitionHandlers,requestSourceFulltext} from '../server/acquisition/runner.mjs';
import {LocalJobRunner} from '../server/jobs/local-job-runner.mjs';
import {sourceFromRow} from '../server/domain/intelligence-quality.mjs';
import {processingHash} from '../server/acquisition/relevance.mjs';
import {processReview,reviewOverview,processingFor} from '../server/acquisition/review.mjs';
import {publisherIdentity} from '../server/acquisition/source-presentation.mjs';
assert.equal(publisherIdentity({url:'https://arstechnica.com/a'},[{channelName:'Ars Technica',channelUrl:'https://feeds.arstechnica.com/feed'}]).publisher,'Ars Technica');
assert.equal(publisherIdentity({url:'https://original.example/a'},[{channelName:'AIHOT',channelUrl:'https://aihot.example/'}]).publisher,'original.example');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'source-delivery-test-'));const w=await openWorkspace({xenhoHome:root});
try{
 const channel=getChannel(w,'t2.ars_technica');
 const id=commitPage(w,channel,{items:[{identity:'test:body',title:'TEST ChatGPT report',url:'https://arstechnica.com/a',sourceKind:'article',body:'Stored summary only.',readLevel:'summary',publishedAt:'2020-01-01T00:00:00Z'}]}).ids[0];
 await assert.rejects(()=>requestSourceFulltext(w,id,{}),/请确认/);
 let requests=0;
 const originalRights=w.db.prepare('SELECT rights_json FROM intel_sources WHERE id=?').get(id).rights_json;
 const request=async()=>{requests++;return {snapshotId:"synthetic-snapshot",text:`<html><body><article><div class="post-content"><p>${'ChatGPT first part with factual source evidence. '.repeat(10)}</p></div><nav>Menu</nav><div class="post-content"><p>${'ChatGPT second part with detailed evaluation. '.repeat(10)}</p></div></article></body></html>`};};
 const run=async(extra)=>{const r=enqueueAcquisition(w,channel.id,{mode:'fulltext',sourceId:id,slot:String(Math.random()),...extra});const runner=new LocalJobRunner(w.jobs,{handlers:acquisitionHandlers(w,{}, {request})});return runner.runNext({leaseOwner:'test',allowedJobIds:[r.job_id]});};
 assert.equal((await run({})).status,'failed');assert.equal(requests,0);
 const result=await run({fulltextUrl:'https://arstechnica.com/a'});assert.equal(result.status,'done');assert.equal(result.result.stats.inWindow,0);assert.equal(result.result.stats.enriched,1);
 let source=acquisitionSourceDetails(w,id).source;assert.match(source.body,/first part/);assert.match(source.body,/second part/);assert.equal(source.publishedAt,'2020-01-01T00:00:00Z');assert.equal(w.db.prepare('SELECT rights_json FROM intel_sources WHERE id=?').get(id).rights_json,originalRights);
 await processReview(w,{}, {confirmed:true});assert.equal(reviewOverview(w).total,0,'historical body enrichment is not new 24h news');assert.equal(reviewOverview(w,{scope:'unreviewed'}).total,1);
 const oldGrant=new Map([[id,processingHash(source)]]);let calls=0;
 const model=async(_env,input)=>{calls++;const material=JSON.parse(input.user).material;return {data:{relevance:'ai_relevant',reason:'Test primary topic',evidence:[material.slice(0,80)],title:'测试模型实践',guideClaims:[]}};};
 await processReview(w,{}, {confirmed:true,semantic:true,sourceIds:[id]}, {authorizedSources:oldGrant,completeJson:model});assert.equal(calls,1);
 w.db.prepare("UPDATE intel_sources SET data_json=json_set(data_json,'$.body',json_extract(data_json,'$.body')||' changed') WHERE id=?").run(id);
 await processReview(w,{}, {confirmed:true,semantic:true,sourceIds:[id]}, {authorizedSources:oldGrant,completeJson:model});assert.equal(calls,1,'one-run consent bound to exact body hash');
 assert.equal(w.db.prepare('SELECT rights_json FROM intel_sources WHERE id=?').get(id).rights_json,originalRights);
 const unknown=commitPage(w,channel,{items:[{identity:'test:metadata',title:'TEST empty',url:'https://arstechnica.com/b',sourceKind:'article',body:'',readLevel:'metadata'}]}).ids[0];
 assert.equal(acquisitionSourceDetails(w,unknown).source.contentStatus,'metadata');
 const ancillary=commitPage(w,channel,{items:[{identity:'test:incidental',title:'TEST 通用操作系统安全认证',url:'https://arstechnica.com/c',sourceKind:'article',body:'本报道讨论通用操作系统认证。'.repeat(100)+'背景包括人工智能训练芯片。',readLevel:'original'}]}).ids[0];
 const row=sourceFromRow(w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(ancillary));
 await processReview(w,{}, {confirmed:true,semantic:true,sourceIds:[ancillary]}, {authorizedSources:new Map([[ancillary,processingHash(row)]]),completeJson:model});
 assert.equal(processingFor(w,row).relevance,'needs_context','incidental AI must not silently enter primary list');
 const batch=[];for(let i=0;i<9;i++){const item=commitPage(w,channel,{items:[{identity:'batch:'+i,title:'TEST ChatGPT '+i,url:'https://arstechnica.com/test-'+i,sourceKind:'article',body:'ChatGPT model evaluation for independent synthetic event '+i+'. This is an explicit synthetic source.',readLevel:'original'}]}).ids[0];batch.push(sourceFromRow(w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(item)));}
 const grants=new Map(batch.map(s=>[s.id,processingHash(s)])),seen=new Set();
 const batchModel=async(_env,input)=>{const d=JSON.parse(input.user);if(d.step==='organize'){d.sources.forEach(s=>seen.add(s.id));return {data:{groups:d.sources.map(s=>({key:s.id,focus:s.title,connection:'Independent synthetic event',relationship:'standalone',sourceIds:[s.id]}))}};}return {data:{relevance:'ai_relevant',reason:'Synthetic model evaluation',evidence:[d.material.slice(0,80)],guideClaims:[]}};};
 for(let i=0;i<2;i++)await processReview(w,{}, {confirmed:true,semantic:true,sourceIds:batch.map(s=>s.id)}, {authorizedSources:grants,completeJson:batchModel});
 assert.equal(seen.size,9,'subsequent model and grouping batches progress beyond first eight');
 assert(batch.every(s=>processingFor(w,s).semanticState==='complete'));
 console.log('PASS source delivery: consent, body hash, full original sections, original date, source identity, metadata, incidental AI and historical scopes');
}finally{w.close();await fs.rm(root,{recursive:true,force:true});}
