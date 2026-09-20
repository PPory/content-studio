import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openWorkspace} from '../server/storage/workspace.mjs';
import {saveIntelligenceProfile,enqueueIntelligence,runSources} from '../server/domain/intelligence.mjs';
import {executeIntelligence} from '../server/domain/intelligence-runner.mjs';
import {saveFeedPreferences,refreshIntelligenceFeed,feedPreferences} from '../server/domain/intelligence-feed.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-native-budget-'));let w;
try {
 w=await openWorkspace({xenhoHome:path.join(root,'Xenho')});
 // This test exercises social adapters; channel transport is covered separately.
 w.db.prepare('UPDATE intel_channels SET enabled=0').run();
 const directions=['模型原理与使用','个人创造与学习'];
 assert.equal(feedPreferences(w).nativeSocialEnabled,false);
 assert.throws(()=>saveFeedPreferences(w,{directions,nativeSocialEnabled:'true'}));
 saveFeedPreferences(w,{directions,nativeSocialEnabled:true});saveFeedPreferences(w,{directions});
 assert.equal(feedPreferences(w).nativeSocialEnabled,true,'editing interests preserves authorization');
 const feedRun=refreshIntelligenceFeed(w);
 assert.equal(feedRun.config.autoSocial,false);assert.deepEqual(feedRun.config.providers,['collected','local']);
 await executeIntelligence(w,{}, {runId:feedRun.id},{completeJson:async()=>({data:{briefs:[]}}),trigger:()=>{throw Error('feed refresh must not trigger paid collection');},fetchAiHot:()=>{throw Error('feed refresh must consume local acquisition');}});
 const profile=saveIntelligenceProfile(w,{name:'explicit social research',query:directions.join(' '),providers:['x','reddit'],output:'briefs',autoSocial:true,paidApproved:true,frequency:'manual'});
 const run=enqueueIntelligence(w,profile.id),calls=[],snapshots=new Map();
 assert.equal(run.config.autoSocial,true);assert.equal(run.config.frequency,'manual');
 await executeIntelligence(w,{BRIGHTDATA_API_KEY:'isolated-test'}, {runId:run.id},{
  completeJson:async(_env,input)=>{const d=JSON.parse(input.user);if(d.step==='plan'){assert(d.focus.includes(directions[0]));return {data:{query:'model practice',queries:{web:['model practice','learning'],aihot:'AI'},accounts:[...d.existingSources.x.accounts,'unlisted'],subreddits:d.existingSources.reddit.subreddits.map(s=>s.match(/\/r\/([^/]+)/)[1])}};}if(d.step==='organize')return {data:{groups:[]}};if(d.candidates){assert(d.focus.includes(directions[0]));return {data:{indices:[2]}};}return {data:{briefs:[]}};},
  trigger:async(_key,dataset,input,options)=>{calls.push({dataset,input,options});const id='snapshot-'+calls.length;snapshots.set(id,{dataset,input});return id;},
  progress:async()=> 'ready',
  download:async(_key,id)=>{const {dataset,input}=snapshots.get(id),reddit=dataset.includes('lvz8');return input.flatMap((target,n)=>Array.from({length:5},(_,i)=>({url:reddit?target.url+'comments/post'+n+i+'/title':target.url+'/status/'+(100+n*10+i),description:'A useful original observation about model practice.',date_posted:run.createdAt,discovery_input:{url:target.url},user_posted:'writer'})));},
  searchWeb:async()=>({sources:[]}),
  fetchAiHot:async()=>({ok:true,items:[0,1,2].map(i=>({title:'AI item '+i,summary:'summary',link:'https://example.com/'+i,at:run.createdAt}))}),
  readArticle:async url=>{assert.equal(url,'https://example.com/2','AI Hot follows selected relevance, not first item');return {url,title:'Selected item',markdown:'A useful original explanation with sufficient detail to read.'};}
 });
 assert.equal(calls.length,2);assert.equal(calls[0].input.length,6);assert.equal(calls[1].input.length,4);assert(calls.every(c=>c.options.limitPerInput===3));assert(calls[1].input.every(i=>i.sort_by==='New'));
 const sources=runSources(w,run.id);assert.equal(sources.filter(s=>s.provider==='x').length,18);assert.equal(sources.filter(s=>s.provider==='reddit').length,12);
 assert.equal(sources.filter(s=>s.provider==='aihot').length,0,'explicit social research does not add unrelated AIHOT collection');
 await executeIntelligence(w,{}, {runId:run.id},{trigger:()=>{throw Error('must not retrigger a completed run');}});
 assert.throws(()=>saveIntelligenceProfile(w,{name:'invalid',query:'AI',providers:['x'],output:'briefs',autoSocial:true,paidApproved:false,frequency:'manual'}));
 console.log('native budget: local-only default refresh, explicit 6 X + 4 Reddit, 3 each and authorization passed');
} finally {w?.close();const relative=path.relative(os.tmpdir(),root);assert(relative&&!relative.startsWith('..'));await fs.rm(root,{recursive:true,force:true});}
