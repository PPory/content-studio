import { assertJsonDepth } from './parsing.mjs';
import { setTimeout as wait } from 'node:timers/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, ProxyAgent, request as httpRequest } from 'undici';
import { createHash, randomUUID } from 'node:crypto';
import { createUlid } from '../storage/ids.mjs';

const hash = v => createHash('sha256').update(v).digest('hex');
export const acquisitionError = (message, extra={}) => Object.assign(new Error(message), extra);
export function publicAddress(ip) {
  if (isIP(ip) === 6) return /^2[0-9a-f]{3}:/i.test(ip) && !/^2001:(db8|0|10|20):/i.test(ip);
  if (isIP(ip) !== 4) return false;
  const [a,b,c] = ip.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}
export async function validateTarget(value, resolve=lookup) {
  let u; try {u=new URL(value);} catch {throw acquisitionError('无效来源网址',{retry:false});}
  if (!['https:','http:'].includes(u.protocol)||u.username||u.password||(u.port&&!['80','443'].includes(u.port))||u.href.length>4000||/[{}]|%7[bBdD]/.test(u.href)) throw acquisitionError('仅允许公开 HTTP(S) 标准端口网址',{retry:false});
  const host=u.hostname.replace(/^\[|\]$/g,'');
  if (/^(localhost|metadata\.)|\.(local|internal|localhost)\.?$/i.test(host)) throw acquisitionError('禁止本机、内网或元数据服务',{retry:false});
  const addresses=isIP(host)?[{address:host}]:await resolve(host,{all:true,verbatim:true});
  if (!addresses.length||addresses.some(a=>!publicAddress(a.address))) throw acquisitionError('DNS 指向非公开地址，已阻止请求',{retry:false});
  return {url:u,address:addresses[0].address};
}
export function retryAfter(headers, now=Date.now()) {
  const value=headers['retry-after'];
  const retry=Number(value);
  if (value && Number.isFinite(retry)) return Math.max(1,retry);
  if (value && Number.isFinite(Date.parse(value))) return Math.max(1,Math.ceil((Date.parse(value)-now)/1000));
  if (headers['x-ratelimit-remaining']!==undefined && Number(headers['x-ratelimit-remaining'])<=0 && headers['x-ratelimit-reset']) return Math.max(1,Number(headers['x-ratelimit-reset'])-(Number(headers['x-ratelimit-reset'])>1000000000?Math.floor(now/1000):0));
  return undefined;
}
function lock(w,key,owner,seconds=35) {
  const at=new Date().toISOString(),expires=new Date(Date.now()+seconds*1000).toISOString();
  return w.db.prepare(`INSERT INTO acquisition_locks(lock_key,owner,expires_at) VALUES(?,?,?) ON CONFLICT(lock_key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE acquisition_locks.expires_at<?`).run(key,owner,expires,at).changes===1;
}

// Requests connect to the validated IP (also through CONNECT proxies), with the original
// Host and TLS SNI. A second DNS lookup cannot rebind the connection to a private host.
async function pinnedFetch(target, options) {
  const original=target.url, pinned=new URL(original);
  pinned.hostname=isIP(target.address)===6?`[${target.address}]`:target.address;
  const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
  const dispatcher=proxy ? new ProxyAgent({uri:proxy,requestTls:{servername:original.hostname}}) : new Agent({connect:{servername:original.hostname}});
  try {
    const result=await httpRequest(pinned,{...options,method:options.method||'GET',headers:{...options.headers,host:original.host},dispatcher,maxRedirections:0});
    result.body.cancel=()=>result.body.dump();
    const headers=new Headers();for(const [key,value] of Object.entries(result.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
    return {response:{status:result.statusCode,headers,body:result.body},close:()=>dispatcher.close()};
  }
  catch (e) {await dispatcher.close();throw e;}
}
export function acquisitionTransport(w,channel,{signal,fetchImpl=pinnedFetch,resolve=lookup,heartbeat=()=>{},snapshotIds=[]}={}) {
  return async (url,options={}) => {
    const owner=randomUUID();let slot=null,hostKey=null;
    const deadline=AbortSignal.timeout(30000);
    const combined=signal?AbortSignal.any([signal,deadline]):deadline;
    const requestKey=hash(JSON.stringify([url,hash(String(options.headers?.Authorization||options.headers?.authorization||'')),options.headers?.Accept||options.headers?.accept||'default',options.method||'GET',options.body||'']));
    const cached=w.db.prepare('SELECT * FROM acquisition_snapshots WHERE channel_id=? AND request_key=? AND expires_at>? ORDER BY observed_at DESC LIMIT 1').get(channel.id,requestKey,new Date().toISOString());
    const headers={'user-agent':'Xenho-Content-Studio/3.0 (local acquisition)',accept:'application/json, application/rss+xml, application/atom+xml, text/html;q=0.8',...options.headers};
    if(!cached) {delete headers['if-none-match'];delete headers['if-modified-since'];delete headers['If-None-Match'];delete headers['If-Modified-Since'];}
    const cacheHeaders=cached?JSON.parse(cached.headers_json):{};
    if (cacheHeaders.etag) headers['if-none-match']=cacheHeaders.etag;
    if (cacheHeaders['last-modified']) headers['if-modified-since']=cacheHeaders['last-modified'];
    let target=await validateTarget(url,resolve);
    try {
      heartbeat();
      for(let i=0;i<4;i++)if(lock(w,`global:${i}`,owner)){slot=`global:${i}`;break;}
      if(!slot)throw acquisitionError('采集并发预算已满，稍后续采',{retryAfterSeconds:5});
      for(let redirects=0;redirects<=5;redirects++) {
        hostKey=`host:${target.url.hostname}`;
        const deferred=w.db.prepare('SELECT not_before FROM acquisition_network_budget WHERE host=?').get(target.url.hostname);
        if(deferred&&Date.parse(deferred.not_before)>Date.now()){
          const remaining=Date.parse(deferred.not_before)-Date.now();
          if(remaining>5000)throw acquisitionError('来源限流等待中',{retryAfterSeconds:Math.ceil(remaining/1000)});
          await wait(remaining,undefined,{signal:combined});
        }
        if(!lock(w,hostKey,owner))throw acquisitionError('同一来源正在请求，稍后续采',{retryAfterSeconds:5});
        const {response,close}=await fetchImpl(target,{...options,headers,signal:combined});
        let next;
        try {
          const responseHeaders=Object.fromEntries(response.headers.entries());
          const status=response.status;
          const wait=retryAfter(responseHeaders)|| (target.url.hostname==='oauth.reddit.com'?3:undefined);
          if(wait)w.db.prepare('INSERT INTO acquisition_network_budget(host,not_before) VALUES(?,?) ON CONFLICT(host) DO UPDATE SET not_before=excluded.not_before').run(target.url.hostname,new Date(Date.now()+wait*1000).toISOString());
          if([301,302,303,307,308].includes(status)) {
            if(options.redirect==='error')throw acquisitionError('此授权请求不允许重定向',{blocked:true,retry:false});
            if(!responseHeaders.location)throw acquisitionError('重定向缺少 Location',{retry:false});
            next=await validateTarget(new URL(responseHeaders.location,target.url).href,resolve);
            if(next.url.origin!==target.url.origin) {delete headers.Authorization;delete headers.authorization;delete headers['if-none-match'];delete headers['if-modified-since'];}
            await response.body?.cancel();
          } else {
            if(status===304&&!cached)throw acquisitionError('304 缺少有效缓存，无法确认消费成功');
            if(status!==304 && (status<200||status>=300)) {await response.body?.cancel();throw acquisitionError(`来源返回 HTTP ${status}`,{status,blocked:status===401||status===403,retry:status===429||status>=500,retryAfterSeconds:wait});}
            let text=cached?.payload_text||'';
            if(status!==304) {
              const chunks=[];let bytes=0;const max=channel.platform==='follow_builders'?40*1024*1024:12*1024*1024;
              for await(const chunk of response.body) {bytes+=chunk.length;if(bytes>max)throw acquisitionError('响应超过解压后字节预算',{retry:false});chunks.push(chunk);}
              text=Buffer.concat(chunks).toString('utf8');
              if (/<!ENTITY/i.test(text)||(/<!DOCTYPE/i.test(text)&&!/^\s*<!doctype html/i.test(text)))throw acquisitionError('响应含不允许的 XML 实体声明',{retry:false});
            }
            let parsed;try{parsed=JSON.parse(text);}catch{}
            if(parsed)assertJsonDepth(parsed);
            const id=status===304?cached.id:createUlid(),at=new Date().toISOString();
            const expires=new Date(Date.now()+(channel.platform==='reddit'?48*3600:30*86400)*1000).toISOString();
            const savedHeaders={};for(const key of ['etag','last-modified','content-type','date','x-ratelimit-remaining','x-ratelimit-reset'])if(responseHeaders[key])savedHeaders[key]=responseHeaders[key];
            w.db.prepare('INSERT INTO acquisition_snapshots(id,channel_id,request_key,url,payload_hash,payload_text,headers_json,observed_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(channel_id,request_key,payload_hash) DO UPDATE SET observed_at=excluded.observed_at,expires_at=excluded.expires_at,headers_json=excluded.headers_json').run(id,channel.id,requestKey,url,hash(text),text,JSON.stringify(savedHeaders),at,expires);
            const row=w.db.prepare('SELECT id FROM acquisition_snapshots WHERE channel_id=? AND request_key=? AND payload_hash=?').get(channel.id,requestKey,hash(text));
            snapshotIds.push(row.id);
            return {status:status===304&&!cached?.applied_at?200:status,originalStatus:status,headers:responseHeaders,text,json:parsed,snapshotId:row.id};
          }
        } finally {await close();w.db.prepare('DELETE FROM acquisition_locks WHERE lock_key=? AND owner=?').run(hostKey,owner);hostKey=null;}
        target=next;
      }
      throw acquisitionError('重定向超过预算',{retry:false});
    } catch(error) {
      if(error.status||error.retry!==undefined||error.retryAfterSeconds)throw error;
      throw acquisitionError(combined.aborted?'请求超时或已取消':'来源网络请求失败',{retry:!signal?.aborted});
    } finally {
      if(hostKey)w.db.prepare('DELETE FROM acquisition_locks WHERE lock_key=? AND owner=?').run(hostKey,owner);
      if(slot)w.db.prepare('DELETE FROM acquisition_locks WHERE lock_key=? AND owner=?').run(slot,owner);
    }
  };
}
