import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { proxyFetch } from '../../lib/fetch.mjs';

const API = 'https://api.brightdata.com/datasets/v3';
export const BRIGHTDATA_DATASETS = Object.freeze({ redditPosts: 'gd_lvz8ah06191smkebj4', redditComments: 'gd_lvzdpsdlw09j6t702' });

export class BrightDataError extends Error {
  constructor(message, hint = '', options = {}) { super(message); this.hint = hint; Object.assign(this, options); }
}

const timeoutSignal = (signal, milliseconds) => signal ? AbortSignal.any([signal,AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds);
const json = async response => { const text=await response.text(); try{return {text,data:JSON.parse(text)};}catch{return {text,data:null};} };

export async function trigger(key, datasetId, rows, { discoverBy, limitPerInput, signal, fetchImpl = proxyFetch } = {}) {
  const query=new URLSearchParams({dataset_id:datasetId,format:'json',include_errors:'true'});
  if(discoverBy){query.set('type','discover_new');query.set('discover_by',discoverBy);}
  if(limitPerInput!==undefined && (!Number.isInteger(limitPerInput)||limitPerInput<1))throw new TypeError('limitPerInput must be a positive integer');
  // Bright Data documents the same object envelope for /scrape and /trigger.
  const payload=limitPerInput?{input:rows,limit_per_input:limitPerInput}:rows;
  const response=await fetchImpl(`${API}/trigger?${query}`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:timeoutSignal(signal,30000)});
  const result=await json(response);
  if(!response.ok)throw new BrightDataError(`Bright Data 触发失败（HTTP ${response.status}）：${result.text.slice(0,300)}`,'检查 dataset 权限与输入 schema',{status:response.status,blocked:[401,403].includes(response.status)});
  if(!result.data?.snapshot_id)throw new BrightDataError(`Bright Data 触发未返回 snapshot_id：${result.text.slice(0,300)}`,'停止重试，先核对 dataset 与输入 schema',{code:'invalid_schema',retry:false});
  return result.data.snapshot_id;
}

export async function progress(key,id,{signal,fetchImpl=proxyFetch}={}){
  const response=await fetchImpl(`${API}/progress/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${key}`},signal:timeoutSignal(signal,30000)});
  const result=await json(response);
  if(!response.ok)throw new BrightDataError(`Bright Data 进度查询失败（HTTP ${response.status}）`,`保留 snapshot ${id}，稍后继续`,{status:response.status});
  return result.data?.status||'';
}

export async function waitReady(key,id,label,log=()=>{},options={}){
  const deadline=Date.now()+(options.timeoutMs||15*60*1000);let misses=0,last='';
  while(Date.now()<deadline){
    try{const status=await progress(key,id,options);misses=0;if(status!==last){log(`    ${label}: ${status}`);last=status;}if(status==='ready')return;if(status==='failed')throw new BrightDataError(`${label} 采集失败`,`检查 snapshot ${id}`,{retry:false});}
    catch(error){if(error instanceof BrightDataError&&error.retry===false)throw error;if(++misses>=5)throw new BrightDataError(`${label} 连续 5 次查询进度失败`,`snapshot ${id} 已保留，可继续取回`,{cause:error});}
    await (options.pause||pause)(options.pollMs||10000,undefined,{signal:options.signal});
  }
  throw new BrightDataError(`${label} 等待超时`,`snapshot ${id} 已保留，可继续取回`,{retryAfterSeconds:60});
}

export async function download(key,id,{signal,fetchImpl=proxyFetch}={}){
  const response=await fetchImpl(`${API}/snapshot/${encodeURIComponent(id)}?format=json`,{headers:{Authorization:`Bearer ${key}`},signal:timeoutSignal(signal,60000)});
  const result=await json(response);
  if(!response.ok)throw new BrightDataError(`Bright Data snapshot 下载失败（HTTP ${response.status}）`,`snapshot ${id} 已保留，可继续下载`,{status:response.status});
  if(!Array.isArray(result.data))throw new BrightDataError('Bright Data snapshot 不是 JSON 数组','停止入库并核对 dataset 输出',{code:'invalid_schema',retry:false});
  return result.data;
}

export async function collect(key,datasetId,rows,opts,label,log){const id=await trigger(key,datasetId,rows,opts);log(`    ${label}: snapshot ${id}`);await waitReady(key,id,label,log,opts);return download(key,id,opts);}

export function brightDataRequestKey(datasetId,rows,options={}){
  return createHash('sha256').update(JSON.stringify({datasetId,rows,discoverBy:options.discoverBy||'',limitPerInput:options.limitPerInput||0,requestSalt:options.requestSalt||''})).digest('hex');
}

export async function runBrightDataJob({apiKey,datasetId,rows,options={},jobKey,state={},persist,signal,heartbeat,client={}}){
  const requestKey=brightDataRequestKey(datasetId,rows,options);let current=state?.requestKey===requestKey?{...state}:null;
  const save=async patch=>{current={...(current||{}),...patch,requestKey,datasetId,inputCount:rows.length};await persist(current);heartbeat?.();return current;};
  if(!current?.snapshotId){
    const snapshotId=await (client.trigger||trigger)(apiKey,datasetId,rows,{...options,signal});
    await save({provider:'brightdata',jobKey,phase:'polling',snapshotId,triggeredAt:new Date().toISOString(),status:'starting',downloadedAt:null,completedAt:null});
  }
  while(!['ready','downloaded','complete'].includes(current.status)){
    const status=await (client.progress||progress)(apiKey,current.snapshotId,{signal});
    await save({phase:'polling',status});
    if(status==='failed')throw new BrightDataError(`Bright Data ${jobKey} snapshot 失败`,`检查 snapshot ${current.snapshotId}`,{retry:false});
    if(status!=='ready')await (client.pause||pause)(client.pollMs||10000,undefined,{signal});
  }
  const records=await (client.download||download)(apiKey,current.snapshotId,{signal});
  await save({phase:'normalize',status:'downloaded',downloadedAt:new Date().toISOString(),recordCount:records.length});
  return {records,state:current,complete:()=>save({phase:'complete',status:'complete',completedAt:new Date().toISOString()})};
}
