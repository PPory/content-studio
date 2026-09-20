import { startAcquisitionBatch, batchOverview } from '../acquisition/batches.mjs';
import { fail, json, readJsonBody } from '../lib/http.mjs';
import { acquisitionOverview, acquisitionSourceDetails } from '../acquisition/store.mjs';
import { acquisitionAction, cancelAcquisition } from '../acquisition/runner.mjs';
function route(method,path,action) {return {method,path,handler:async c=>{try{const w=await c.workspace;if(!w?.db?.open)throw Object.assign(new Error('本地工作区尚未就绪'),{status:503});const body=method==='GET'?{}:await readJsonBody(c.req,10000);json(c.res,{ok:true,...await action(w,c.params,body,c)});}catch(e){fail(c.res,e.message,{status:e.status||400});}}};}
export const acquisitionRoutes=[
 route('GET','/api/workspace/acquisition/batches/latest',(w,p,b,c)=>batchOverview(w,'latest',Object.fromEntries(new URL(c.req.url,'http://localhost').searchParams))),
 route('GET','/api/workspace/acquisition/batches/:id',(w,p,b,c)=>batchOverview(w,p.id,Object.fromEntries(new URL(c.req.url,'http://localhost').searchParams))),
 route('POST','/api/workspace/acquisition/batches',(w,p,b)=>({batch:startAcquisitionBatch(w,b)})),
 route('GET','/api/workspace/acquisition',w=>acquisitionOverview(w)),
 route('POST','/api/workspace/acquisition/channels/:id/action',(w,p,b)=>acquisitionAction(w,p.id,b)),
 route('POST','/api/workspace/acquisition/runs/:id/cancel',(w,p)=>cancelAcquisition(w,p.id)),
 route('GET','/api/workspace/acquisition/sources/:id',(w,p)=>acquisitionSourceDetails(w,p.id)),
];
