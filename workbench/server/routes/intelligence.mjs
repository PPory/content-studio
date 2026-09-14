import { fail,json,readJsonBody } from "../lib/http.mjs";
import { intelligenceOverview,intelligenceSource,collectHotIntelligenceSource,linkIntelligenceSource,saveIntelligenceProfile,enqueueIntelligence,retryIntelligence,cancelIntelligence,addIntelligenceSource,adoptIntelligenceCard,setIntelligenceCard } from "../domain/intelligence.mjs";
function route(method,path,action){return {method,path,handler:async c=>{try{
 const workspace=await c.workspace;if(!workspace?.db?.open)throw Object.assign(new Error("本地工作区尚未就绪"),{status:503});
 const body=method==="GET"?{}:await readJsonBody(c.req,200000);
 json(c.res,{ok:true,...await action({...c,workspace,body})});
 }catch(e){fail(c.res,e.message,{status:e.status||400});}}};}
export const intelligenceRoutes=[
 route("POST","/api/workspace/intelligence/hot-collection",({workspace,body})=>({source:collectHotIntelligenceSource(workspace,body)})),
 route("POST","/api/workspace/intelligence/sources/:id/research",({workspace,params,body})=>({research:linkIntelligenceSource(workspace,params.id,body)})),
 route("GET","/api/workspace/intelligence/sources/:id",({workspace,params})=>({source:intelligenceSource(workspace,params.id)})),
 route("GET","/api/workspace/intelligence",({workspace,env})=>intelligenceOverview(workspace,env)),
 route("POST","/api/workspace/intelligence/profiles",({workspace,body})=>({profile:saveIntelligenceProfile(workspace,body)})),
 route("POST","/api/workspace/intelligence/profiles/:id/run",({workspace,params})=>({run:enqueueIntelligence(workspace,params.id)})),
 route("POST","/api/workspace/intelligence/runs/:id/retry",({workspace,params,body})=>({run:retryIntelligence(workspace,params.id,body)})),
 route("POST","/api/workspace/intelligence/runs/:id/cancel",({workspace,params})=>({run:cancelIntelligence(workspace,params.id)})),
 route("POST","/api/workspace/intelligence/sources",({workspace,body})=>({source:addIntelligenceSource(workspace,{title:body.title,body:body.body,url:body.url,provider:"manual"})})),
 route("PUT","/api/workspace/intelligence/cards/:id",({workspace,params,body})=>{setIntelligenceCard(workspace,params.id,body.status);return {}; }),
 route("POST","/api/workspace/intelligence/cards/:id/adopt",({workspace,params})=>({research:adoptIntelligenceCard(workspace,params.id)})),
];
