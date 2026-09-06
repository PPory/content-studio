import { fail,json,readJsonBody } from "../lib/http.mjs";
import { createResearch,getResearch,listResearches,saveResearch,researchReference,researchConversation,researchProject,projectResearches,libraryItems,libraryItem,quickNote,recentWork,workState } from "../domain/research.mjs";
function route(method,path,action) {
  return {method,path,handler:async context=>{
    try {
      const workspace=await context.workspace;
      if(!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"),{status:503});
      const body=["POST","PUT","DELETE"].includes(method)?await readJsonBody(context.req,500000):{};
      json(context.res,{ok:true,...await action({...context,workspace,body})});
    } catch(e) {fail(context.res,e.message||"操作失败",{status:e.status||(/不存在/.test(e.message)?404:400)});}
  }};
}
export const researchRoutes=[
 route("GET","/api/workspace/researches",({workspace})=>({researches:listResearches(workspace)})),
 route("POST","/api/workspace/researches",({workspace,body})=>({research:createResearch(workspace,body)})),
 route("GET","/api/workspace/researches/:id",({workspace,params})=>({research:getResearch(workspace,params.id)})),
 route("PUT","/api/workspace/researches/:id",({workspace,params,body})=>({research:saveResearch(workspace,params.id,body)})),
 route("POST","/api/workspace/researches/:id/references",({workspace,params,body})=>({research:researchReference(workspace,params.id,body)})),
 route("DELETE","/api/workspace/researches/:id/references",({workspace,params,body})=>({research:researchReference(workspace,params.id,body,true)})),
 route("POST","/api/workspace/researches/:id/conversations",({workspace,params,body})=>({research:researchConversation(workspace,params.id,body)})),
 route("POST","/api/workspace/researches/:id/projects",({workspace,params,body})=>researchProject(workspace,params.id,body)),
 route("GET","/api/workspace/projects/:id/researches",({workspace,params})=>({researches:projectResearches(workspace,params.id)})),
 route("GET","/api/workspace/library",({workspace,url})=>({items:libraryItems(workspace,{q:url.searchParams.get("q")||"",kind:url.searchParams.get("kind")||"",limit:url.searchParams.get("limit")||100})})),
 route("GET","/api/workspace/library/:kind/:id",({workspace,params})=>({item:libraryItem(workspace,params.kind,params.id)})),
 route("POST","/api/workspace/quick-notes",({workspace,body})=>({item:quickNote(workspace,body)})),
 route("GET","/api/workspace/recent-work",({workspace,url})=>({items:recentWork(workspace,{includeHidden:url.searchParams.get("includeHidden")==="1"})})),
 route("PUT","/api/workspace/work-state/:kind/:id",({workspace,params,body})=>({state:workState(workspace,params.kind,params.id,body)})),
];
