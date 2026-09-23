import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openWorkspace} from '../server/storage/workspace.mjs';
import {addIntelligenceSource} from '../server/domain/intelligence.mjs';
import {externalEvidence,sourceFromRow} from '../server/domain/intelligence-quality.mjs';
import {processReview,processingFor,semanticMaterial} from '../server/acquisition/review.mjs';

const home=await fs.mkdtemp(path.join(os.tmpdir(),'xenho-reddit-context-'));let w;
try{
 w=await openWorkspace({xenhoHome:home});
 const add=(title,body,url,contentKind,extra={})=>addIntelligenceSource(w,{title,body,url,provider:'reddit',contentKind,readLevel:'original',...extra});
 const root=add('LLM tool use in writing','The language model now calls tools during a writing workflow, according to this post.','https://reddit.com/r/test/comments/ai/post','post');
 const parent=add('Parent observation','I used the same language model tool workflow to check references before publishing.','https://reddit.com/r/test/comments/ai/post/parent','comment',{parentItemId:root.id,rootItemId:root.id});
 const current=add('Reddit comment','I tried this on three articles and found the references still needed manual review.','https://reddit.com/r/test/comments/ai/post/current','comment',{parentItemId:parent.id,rootItemId:root.id});
 const material=semanticMaterial(w,current);
 assert(material?.includes('[主帖]')&&material.includes('[父评论 1]')&&material.includes('[当前评论]'));
 assert(material.indexOf('[主帖]')<material.indexOf('[父评论 1]')&&material.indexOf('[父评论 1]')<material.indexOf('[当前评论]'));
 let calls=0;
 await processReview(w,{}, {confirmed:true,semantic:true,sourceIds:[current.id],skipReplay:true,skipGrouping:true},{
  completeJson:async(_env,input)=>{
   calls++;const request=JSON.parse(input.user);
   assert.equal(request.material,material);
   return {data:{relevance:'ai_relevant',reason:'评论基于主帖中的模型工具工作流提出实测限制',evidence:['I tried this on three articles and found the references still needed manual review.'],title:'实测仍需人工核对引用',guideClaims:[{text:'评论作者称引用仍需人工核对',quotes:['I tried this on three articles and found the references still needed manual review.']}],topic:'模型工具工作流',uncertainties:['仅一位评论者的观察']}};
  }
 });
 assert.equal(calls,1);assert.equal(processingFor(w,current).relevance,'ai_relevant');
 assert.equal(externalEvidence(current),false,'a Reddit comment cannot count as independent external evidence');
 const misleading=add('Camera model recommendation','This camera model is useful for travel photography, and the discussion is about lenses.','https://reddit.com/r/test/comments/camera/post','post');
 const misleadingComment=add('Reddit comment','This model works for me too, especially the lightweight lens.','https://reddit.com/r/test/comments/camera/post/current','comment',{parentItemId:misleading.id,rootItemId:misleading.id});
 await processReview(w,{}, {confirmed:true,semantic:true,sourceIds:[misleadingComment.id],skipReplay:true,skipGrouping:true},{
  completeJson:async(_env,input)=>{
   const text=JSON.parse(input.user).material;
   assert(text.includes('[主帖]')&&text.includes('travel photography'));
   return {data:{relevance:'not_ai',reason:'这里的 model 指相机型号',evidence:['This camera model is useful for travel photography'],guideClaims:[],topic:'摄影',uncertainties:[]}};
  }
 });
 assert.equal(processingFor(w,misleadingComment).relevance,'not_ai');
 const missing=add('Reddit comment','I cannot tell what this reply refers to without the parent comment.','https://reddit.com/r/test/comments/missing/reply','comment',{parentItemId:'missing-parent',rootItemId:'missing-root'});
 assert.equal(semanticMaterial(w,missing),null);
 const joke=add('Reddit comment','lol nice','https://reddit.com/r/test/comments/ai/joke','comment',{parentItemId:root.id,rootItemId:root.id});
 assert.equal(processingFor(w,joke).readable,false,'short jokes stay outside the recommendation path');
 w.db.prepare("UPDATE intel_sources SET acquisition_identity='restricted-root',rights_json='{}' WHERE id=?").run(root.id);
 assert.equal(semanticMaterial(w,current),null,'restricted root text is never added to a model request');
 assert.deepEqual(w.db.pragma('foreign_key_check'),[]);
 console.log('Reddit context: root, parent, current comment, misleading model, missing context, short joke, restricted root and evidence independence passed');
}finally{w?.close();assert(!path.relative(os.tmpdir(),home).startsWith('..'));await fs.rm(home,{recursive:true,force:true});}
