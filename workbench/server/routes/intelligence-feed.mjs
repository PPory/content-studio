import {exploreIntelligenceAngles} from '../domain/intelligence-angles.mjs';
import { json,fail,readJsonBody } from '../lib/http.mjs';
import { intelligenceFeed,intelligenceFeedSummary,intelligenceBrief,feedbackIntelligenceBrief,blockIntelligenceSource,mergeIntelligenceBriefs,saveFeedPreferences,refreshIntelligenceFeed,createIntelligenceReport,saveIntelligenceSettings } from '../domain/intelligence-feed.mjs';
function route(method,path,action){return {method,path,handler:async c=>{try{const workspace=await c.workspace;if(!workspace?.db?.open)throw Object.assign(new Error('本地工作区尚未就绪'),{status:503});const body=method==='GET'?{}:await readJsonBody(c.req,100000);json(c.res,{ok:true,...await action({...c,workspace,body})});}catch(e){fail(c.res,e.message,{status:e.status||400});}}};}
const base='/api/workspace/intelligence';
export const intelligenceFeedRoutes=[
 route('POST',base+'/briefs/:id/angles',async({workspace,env,params})=>await exploreIntelligenceAngles(workspace,env,params.id)),
 route('GET',base+'/feed',({workspace,env})=>intelligenceFeed(workspace,{env})),
 // 一次性授权与自动更新开关；授权放开后立即完整更新一次
 route('POST',base+'/feed/settings',({workspace,env,body})=>saveIntelligenceSettings(workspace,body,env)),
 // 首页那一行只要三个数，不该为此把 300 条简报正文搬一遍
 route('GET',base+'/feed/summary',({workspace})=>intelligenceFeedSummary(workspace)),
 route('GET',base+'/briefs/:id',({workspace,params})=>({brief:intelligenceBrief(workspace,params.id)})),
 route('POST',base+'/briefs/:id/feedback',({workspace,params,body})=>({brief:feedbackIntelligenceBrief(workspace,params.id,body)})),
 route('POST',base+'/blocked-sources',({workspace,body})=>({blockedSources:blockIntelligenceSource(workspace,body)})),
 route('POST',base+'/merge',({workspace,body})=>({research:mergeIntelligenceBriefs(workspace,body)})),
 route('POST',base+'/preferences',({workspace,body})=>({preferences:saveFeedPreferences(workspace,body)})),
 route('POST',base+'/feed/refresh',({workspace})=>({run:refreshIntelligenceFeed(workspace)})),
 route('POST',base+'/reports',async({workspace,env,body})=>({report:await createIntelligenceReport(workspace,env,body)})),
];
