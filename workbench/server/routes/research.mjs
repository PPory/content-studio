import { getNote,listNotes,saveNote,trashNote,noteInsight,getPersonalAsset,listPersonalAssets,personalAssetVersions,savePersonalAsset,trashPersonalAsset,projectPersonalAssets,referencePersonalAsset } from "../domain/personal-assets.mjs";
import { fail,json,readJsonBody } from "../lib/http.mjs";
import { createResearch,getResearch,listResearches,saveResearch,trashResearch,restoreResearch,researchReference,researchConversation,researchProject,projectResearches,libraryItems,libraryItem,quickNote,recentWork,workState } from "../domain/research.mjs";
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
 route("GET","/api/workspace/quick-notes",({workspace,url})=>listNotes(workspace,{q:url.searchParams.get("q")||"",tag:url.searchParams.get("tag")||""})),
 route("GET","/api/workspace/quick-notes/:id",({workspace,params})=>({item:getNote(workspace,params.id)})),
 route("PUT","/api/workspace/quick-notes/:id",({workspace,params,body})=>({item:saveNote(workspace,params.id,body)})),
 route("POST","/api/workspace/quick-notes/:id/trash",({workspace,params})=>({item:trashNote(workspace,params.id)})),
 route("POST","/api/workspace/quick-notes/:id/insights",async({workspace,params,env})=>({insight:await noteInsight(env,workspace,params.id)})),
 route("GET","/api/workspace/personal-assets",({workspace,url})=>({items:listPersonalAssets(workspace,{q:url.searchParams.get("q")||"",kind:url.searchParams.get("kind")||""})})),
 route("POST","/api/workspace/personal-assets",({workspace,body})=>({item:savePersonalAsset(workspace,null,body)})),
 route("GET","/api/workspace/personal-assets/:id",({workspace,params})=>({item:getPersonalAsset(workspace,params.id),versions:personalAssetVersions(workspace,params.id)})),
 route("PUT","/api/workspace/personal-assets/:id",({workspace,params,body})=>({item:savePersonalAsset(workspace,params.id,body)})),
 route("POST","/api/workspace/personal-assets/:id/trash",({workspace,params,body})=>({item:trashPersonalAsset(workspace,params.id,body)})),
 route("GET","/api/workspace/projects/:id/personal-assets",({workspace,params,url})=>projectPersonalAssets(workspace,params.id,{q:url.searchParams.get("q")||""})),
 route("POST","/api/workspace/projects/:id/personal-assets",({workspace,params,body})=>referencePersonalAsset(workspace,params.id,body)),
 route("DELETE","/api/workspace/projects/:id/personal-assets",({workspace,params,body})=>referencePersonalAsset(workspace,params.id,body,true)),
 route("GET","/api/workspace/researches",({workspace})=>({researches:listResearches(workspace)})),
 route("POST","/api/workspace/researches",({workspace,body})=>({research:createResearch(workspace,body)})),
 route("GET","/api/workspace/researches/:id",({workspace,params})=>({research:getResearch(workspace,params.id)})),
 route("POST","/api/workspace/researches/:id/trash",({workspace,params})=>({research:trashResearch(workspace,params.id)})),
 route("POST","/api/workspace/researches/:id/restore",({workspace,params})=>({research:restoreResearch(workspace,params.id)})),
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
