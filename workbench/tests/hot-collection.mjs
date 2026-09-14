import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createResearch} from '../server/domain/research.mjs';
import {openWorkspace} from '../server/storage/workspace.mjs';
import {collectHotIntelligenceSource,linkIntelligenceSource} from '../server/domain/intelligence.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-hot-collection-'));let w;
try {
 w=await openWorkspace({xenhoHome:path.join(root,'Xenho')});
 const input={title:'测试热点',url:'https://example.com/news',summary:'只是一段未核实的摘要。'};
 for(const value of [{...input,url:'file:///secret'},{...input,title:''},{...input,url:''}])assert.throws(()=>collectHotIntelligenceSource(w,value),e=>e.status===400);
 const source=collectHotIntelligenceSource(w,input);assert.equal(source.readLevel,'summary');assert.equal(collectHotIntelligenceSource(w,{...input,summary:'更新'}).id,source.id);
 for(const value of [{question:'问题'}, {confirmed:true}, {confirmed:true,researchId:'missing'}])assert.throws(()=>linkIntelligenceSource(w,source.id,value));
 assert.equal(w.db.prepare('SELECT COUNT(*) n FROM researches').get().n,0);
 const research=linkIntelligenceSource(w,source.id,{question:'我想理解的问题',confirmed:true});assert.equal(research.notes,'');assert.equal(research.references[0].sourceUrl,input.url);
 assert.equal(linkIntelligenceSource(w,source.id,{question:'我想理解的问题',confirmed:true}).id,research.id);
 assert.equal(linkIntelligenceSource(w,source.id,{researchId:research.id,confirmed:true}).references.length,1);
 const removed=createResearch(w,{question:'已移除的题'});w.domain.softDeleteEntity(removed.id,{actor:'user'});assert.throws(()=>linkIntelligenceSource(w,source.id,{researchId:removed.id,confirmed:true}),e=>e.status===404);
 w.domain.softDeleteEntity(research.references[0].id,{actor:'user'});
 assert.throws(()=>linkIntelligenceSource(w,source.id,{question:'不得复活删除的资料',confirmed:true}),e=>e.status===404);
 assert.equal(w.db.prepare('SELECT COUNT(*) n FROM researches').get().n,2,'删除的来源不产生新选题');
 console.log('热点收藏域：URL去重、摘要标识、确认门槛、幂等引用、软删除和事务回滚通过');
} finally {await w?.close();const rel=path.relative(os.tmpdir(),root);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));await fs.rm(root,{recursive:true,force:true});}
