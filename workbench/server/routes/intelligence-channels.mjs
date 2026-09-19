import { fail, json, readJsonBody } from '../lib/http.mjs';
import { intelligenceChannels, saveIntelligenceChannel } from '../domain/intelligence-channels.mjs';
function route(method,path,action){return {method,path,handler:async c=>{try{
 const workspace=await c.workspace;
 if(!workspace?.db?.open)throw Object.assign(new Error('本地工作区尚未就绪'),{status:503});
 const body=method==='GET'?{}:await readJsonBody(c.req,12000);
 json(c.res,{ok:true,...await action({workspace,body,params:c.params||{}})});
}catch(e){fail(c.res,e.message,{status:e.status||400});}}};}
export const intelligenceChannelRoutes=[
 route('GET','/api/workspace/intelligence/channels',({workspace})=>intelligenceChannels(workspace)),
 route('POST','/api/workspace/intelligence/channels',async({workspace,body})=>({channel:await saveIntelligenceChannel(workspace,{...body,id:undefined})})),
 route('PATCH','/api/workspace/intelligence/channels/:id',async({workspace,body,params})=>({channel:await saveIntelligenceChannel(workspace,{...body,id:params.id})})),
];
