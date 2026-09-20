import { useCallback, useEffect, useRef, useState } from 'react';
import { AcquisitionResource } from './AcquisitionResource.jsx';
import { Empty, ErrorNote, Loading } from './ui.jsx';

export const acquisitionGroups = { aihot:'AIHOT', follow_builders:'Follow Builders', t2_media:'T2 Media', community:'Community' };
export const acquisitionTime = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '—';
const counts = {fetched:'抓取',inWindow:'窗内',outsideWindow:'窗外',deepRead:'本期深读',unknownTimestamp:'时间未知',inserted:'新增',updated:'更新',duplicate:'重复',failed:'失败'};
const stateName = {running:'采集中',queued:'等待采集',pending:'等待采集',completed:'已完成',success:'已完成',done:'已完成',partial:'部分完成',failed:'采集失败',blocked:'受阻',cancelled:'已取消'};
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
async function request(url, body) {
  const response=await fetch(url,body ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)} : {});
  const result=await response.json();
  if(!response.ok || result.ok===false)throw new Error(result.error || '读取本次采集失败');
  return result;
}
function CountRow({stats={}}) { return <span className="acquisition-count-line">{Object.entries(counts).map(([key,label])=><span key={key}>{label} <strong>{number(stats[key])}</strong></span>)}</span>; }
export function AcquisitionBatch({onGo,onLink}) {
  const [data,setData]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false),[group,setGroup]=useState(''),[stream,setStream]=useState(''),[offset,setOffset]=useState(0),[changesOnly,setChangesOnly]=useState(false);
  const sequence=useRef(0);
  const load=useCallback(async()=>{
    const ticket=++sequence.current;
    try {const query=new URLSearchParams({offset:String(offset),limit:'30',changesOnly:String(changesOnly)});if(group)query.set('group',group);if(stream)query.set('stream',stream);const value=await request(`/api/workspace/acquisition/batches/latest?${query}`);if(sequence.current===ticket){setData(value);setError(null);}}
    catch(e){if(sequence.current===ticket)setError(e);}
  },[group,stream,offset,changesOnly]);
  useEffect(()=>{void load();return ()=>{sequence.current++;};},[load]);
  const active=['running','queued','pending','retry'].includes(data?.batch?.status);
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>void load(),4000);return ()=>clearInterval(timer);},[active,load]);
  async function sync(){setBusy(true);try{await request('/api/workspace/acquisition/batches',{confirmed:true});setOffset(0);setGroup('');setStream('');await load();}catch(e){setError(e);}finally{setBusy(false);}}
  const batch=data?.batch,stats=batch?.stats || {},duration=batch?.startedAt ? Math.max(0,Math.round(((batch.finishedAt ? Date.parse(batch.finishedAt) : Date.now())-Date.parse(batch.startedAt))/1000)) : null;
  const channels=batch?.channels || [],streams=batch?.streams || [],items=data?.items || [];
  return <section className="acquisition-batch" aria-label="本次采集">
    <header className="intel-v2-toolbar"><div><h2>本次采集</h2><p className="intel-v2-hint">诊断本轮请求、上游变化、时间窗口和重复情况。已有未读资料请回到 AI 情报待审阅。</p></div><div className="intel-v2-actions"><button className="btn" disabled={busy} onClick={load}>刷新本次采集</button><button className="btn btn-primary" disabled={busy || active} onClick={sync}>{busy ? '正在安排…' : active ? '正在采集…' : '立即同步最近 24 小时'}</button></div></header>
    <ErrorNote error={error} what="读取本次采集" onRetry={load}/>
    {!data && !error ? <Loading rows={4}/> : !batch ? <Empty><h3>还没有整批采集记录</h3><p>点击「立即同步」后，将通过正式采集流程同步已启用的来源，结果会保存在这里。</p></Empty> : <>
      <p className="acquisition-batch-id">{stateName[batch.status] || batch.status} · {batch.channelCount ?? channels.length} 个入口 · <code>{batch.id}</code></p>
      <dl className="acquisition-times"><div><dt>采集窗口</dt><dd>{batch.windowStart ? `${acquisitionTime(batch.windowStart)} → ${acquisitionTime(batch.windowEnd)}` : '旧批次未记录'}</dd></div><div><dt>开始时间</dt><dd>{acquisitionTime(batch.startedAt)}</dd></div><div><dt>结束时间</dt><dd>{batch.finishedAt ? acquisitionTime(batch.finishedAt) : '尚未结束'}</dd></div><div><dt>耗时</dt><dd>{duration===null ? '—' : `${Math.floor(duration/60)} 分 ${duration%60} 秒`}</dd></div></dl>
      <dl className="acquisition-batch-totals">{Object.entries(counts).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{number(stats[key])}</dd></div>)}</dl>
      <p className="intel-v2-hint">本期深读允许近期上游新收录的较早博客与播客，与窗外数可能重叠，不应相加，也不计入过去 24 小时新资讯。</p><div className="acquisition-batch-groups">{Object.entries(acquisitionGroups).map(([key,label])=>{const rows=streams.filter(row=>row.sourceGroup===key),members=channels.filter(row=>row.sourceGroup===key);return <section key={key} aria-label={`${label} 本轮结果`}><h3>{label}</h3>{rows.map(row=><div className="acquisition-stream-result" key={row.key}><strong>{row.label || row.key}</strong><span className="acquisition-status">{row.status}</span><CountRow stats={row.stats}/>{row.reason && <p className="intel-v2-hint">{row.reason}</p>}{row.upstreamUpdatedAt && <span className="intel-v2-hint">上游更新 {acquisitionTime(row.upstreamUpdatedAt)}</span>}{row.error && <p className="intel-channel-error">{row.error}</p>}</div>)}{!rows.length && !members.length && <p className="intel-v2-hint">本轮没有此组的入口</p>}<details className="acquisition-channel-results"><summary>逐源结果与失败原因 · {members.length}</summary>{members.map(row=><div key={row.id}><strong>{row.name}</strong><span className="acquisition-status">{row.status}</span><CountRow stats={row.stats}/>{row.reason && <p className="intel-v2-hint">{row.reason}</p>}{row.error && <p className="intel-channel-error">{row.error}</p>}<p className="intel-v2-hint">检查 {acquisitionTime(row.startedAt)} · 结束 {acquisitionTime(row.finishedAt)}</p></div>)}</details></section>;})}</div>
      <div className="intel-v2-toolbar"><h3>{changesOnly ? '本轮新增与更新的内容' : '本轮全部发现（含重复）'} <span className="intel-v2-hint">{data.total ?? items.length} 条</span></h3><button className="text-action" onClick={()=>onGo('intel-channels')}>查看全部来源与失败状态</button></div>
      <div className="acquisition-resource-filters"><label>发现范围<select aria-label="发现范围" value={String(changesOnly)} onChange={event=>{setChangesOnly(event.target.value==='true');setOffset(0);}}><option value="true">新增 / 更新</option><option value="false">全部发现（含重复）</option></select></label><label>本轮来源组<select aria-label="本轮来源组" value={group} onChange={event=>{setGroup(event.target.value);setStream('');setOffset(0);}}><option value="">全部来源组</option>{Object.entries(acquisitionGroups).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>本轮内容流<select aria-label="本轮内容流" value={stream} onChange={event=>{setStream(event.target.value);setOffset(0);}}><option value="">全部内容流</option>{streams.filter(row=>!group || row.sourceGroup===group).map(row=><option key={row.key} value={row.key}>{row.label || row.key}</option>)}</select></label></div>
      {!items.length ? <p className="intel-v2-hint">{active ? '正在采集，取得资料后会显示在这里。' : '本轮所选范围没有发现记录；不表示来源没有内容。请核对请求失败、上游未变、全部重复、超出窗口或权限受限的逐源结果。'}</p> : <div className="intel-v2-list acquisition-batch-items">{items.map(item=><AcquisitionResource key={item.id} item={{...item,type:'source',acquisitionBatch:true}} onGo={onGo} onLink={onLink}/>)}</div>}
      <div className="intel-v2-actions"><button className="btn" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-30))}>上一页</button><span className="intel-v2-hint">第 {Math.floor(offset/30)+1} 页</span><button className="btn" disabled={data.nextOffset===null || data.nextOffset===undefined} onClick={()=>setOffset(data.nextOffset)}>下一页</button></div>
    </>}
  </section>;
}
