import {fail,json,readJsonBody} from "../lib/http.mjs";
import {workspaceActivity,recordActivity,wikiConnections,researchSummary,refreshResearchSummary} from "../domain/workspace-experience.mjs";
function route(method,path,action) {return {method,path,handler:async context=>{
 try {const workspace=await context.workspace;if(!workspace?.db?.open)throw Object.assign(new Error("本地工作区尚未就绪"),{status:503});
 const body=["POST","PUT"].includes(method)?await readJsonBody(context.req,16000):{};
 json(context.res,{ok:true,...await action({...context,workspace,body})});
 }catch(e){fail(context.res,e.message||"操作失败",{status:e.status||(/不存在/.test(e.message)?404:400)});}
}};}
export const workspaceExperienceRoutes=[
 route("GET","/api/workspace/activity",({workspace})=>workspaceActivity(workspace)),
 route("PUT","/api/workspace/activity/:kind/:id",({workspace,params,body})=>({item:recordActivity(workspace,params.kind,params.id,body)})),
 route("GET","/api/workspace/wiki-connections",({workspace,url})=>wikiConnections(workspace,url.searchParams.get("q")||"")),
 route("GET","/api/workspace/researches/:id/summary",({workspace,params})=>({summary:researchSummary(workspace,params.id)})),
 route("POST","/api/workspace/researches/:id/summary",async({env,workspace,params})=>({summary:await refreshResearchSummary(env,workspace,params.id)})),
];
