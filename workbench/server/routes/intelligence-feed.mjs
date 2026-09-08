import { json,fail,readJsonBody } from '../lib/http.mjs';
import { intelligenceFeed,intelligenceBrief,feedbackIntelligenceBrief,blockIntelligenceSource,mergeIntelligenceBriefs,saveFeedPreferences,refreshIntelligenceFeed,createIntelligenceReport } from '../domain/intelligence-feed.mjs';
function route(method,path,action){return {method,path,handler:async c=>{try{const workspace=await c.workspace;if(!workspace?.db?.open)throw Object.assign(new Error('本地工作区尚未就绪'),{status:503});const body=method==='GET'?{}:await readJsonBody(c.req,100000);json(c.res,{ok:true,...await action({...c,workspace,body})});}catch(e){fail(c.res,e.message,{status:e.status||400});}}};}
const base='/api/workspace/intelligence';
export const intelligenceFeedRoutes=[
 route('GET',base+'/feed',({workspace})=>intelligenceFeed(workspace)),
 route('GET',base+'/briefs/:id',({workspace,params})=>({brief:intelligenceBrief(workspace,params.id)})),
 route('POST',base+'/briefs/:id/feedback',({workspace,params,body})=>({brief:feedbackIntelligenceBrief(workspace,params.id,body)})),
 route('POST',base+'/blocked-sources',({workspace,body})=>({blockedSources:blockIntelligenceSource(workspace,body)})),
 route('POST',base+'/merge',({workspace,body})=>({research:mergeIntelligenceBriefs(workspace,body)})),
 route('POST',base+'/preferences',({workspace,body})=>({preferences:saveFeedPreferences(workspace,body)})),
 route('POST',base+'/feed/refresh',({workspace})=>({run:refreshIntelligenceFeed(workspace)})),
 route('POST',base+'/reports',async({workspace,env,body})=>({report:await createIntelligenceReport(workspace,env,body)})),
];
