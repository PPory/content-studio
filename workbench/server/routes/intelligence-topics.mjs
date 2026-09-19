import {json,fail,readJsonBody} from '../lib/http.mjs';
import {intelligenceTopics,previewIntelligenceTopic,saveIntelligenceTopic,startIntelligenceTopic} from '../domain/intelligence-topics.mjs';
function route(method,path,action){return {method,path:'/api/workspace/intelligence'+path,handler:async c=>{try{const w=await c.workspace;if(!w?.db?.open)throw Object.assign(new Error('本地工作区尚未就绪'),{status:503});const body=method==='GET'?{}:await readJsonBody(c.req,100000);json(c.res,{ok:true,...await action(w,c,body)});}catch(e){fail(c.res,e.message,{status:e.status||400});}}};}
export const intelligenceTopicRoutes=[
 route('GET','/topics',w=>intelligenceTopics(w)),
 route('POST','/topics/preview',async(w,c,b)=>({candidate:await previewIntelligenceTopic(w,c.env,b)})),
 route('POST','/topics',(w,c,b)=>({opportunity:saveIntelligenceTopic(w,b)})),
 route('POST','/topics/:id/start',(w,c,b)=>({research:startIntelligenceTopic(w,c.params.id,b)})),
];
