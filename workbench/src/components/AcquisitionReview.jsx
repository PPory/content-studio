import { useCallback, useEffect, useRef, useState } from 'react';
import { AcquisitionResource } from './AcquisitionResource.jsx';
import { markdown } from './BriefReading.jsx';
import { Empty, ErrorNote, Loading, ViewTabs } from './ui.jsx';

const primaryScopes=[{key:'recent',label:'过去 24 小时新资讯'},{key:'deep',label:'本期 AI 深读'}];
const secondaryScopes=[{key:'events',label:'已归并事件（含历史）'},{key:'unreviewed',label:'全部历史待审阅'},{key:'needs_context',label:'主题待复核'},{key:'unreadable',label:'待补正文'},{key:'not_ai',label:'已过滤'},{key:'reviewed',label:'已审阅 / 已忽略'}];
async function request(path,body) {
  const response=await fetch(`/api/workspace/acquisition/review${path}`,body ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)} : {});
  const value=await response.json();
  if(!response.ok || value.ok===false)throw new Error(value.error || '处理审阅资料失败');
  return value;
}
function Cluster({cluster,clusters,busy,onAction,onGo,onLink}) {
  const [editing,setEditing]=useState(''),[selected,setSelected]=useState([]),[target,setTarget]=useState('');
  const items=cluster.items || [];
  return <article className="acquisition-review-cluster" aria-label={cluster.title}>
    <header><div className="brief-v2-labels"><span>{cluster.manual ? '人工修正已保留' : '自动聚簇候选'}</span><span>{items.length} 份原始材料</span><span>{({kept:'已保留',keep:'已保留',ignored:'已忽略',ignore:'已忽略',unreviewed:'待审阅'}[cluster.status] || cluster.status)}</span></div><h2>{cluster.title || '标题待核对'}</h2></header>
    {cluster.guide && <div className="acquisition-cluster-guide"><p className="intel-v2-hint">{['none','extractive','deterministic','local'].includes(cluster.guideKind) ? '本地阅读提示' : '机器导读候选 · 依据见各篇原文'}</p>{markdown(cluster.guide)}</div>}
    <p className="intel-v2-hint">材料组成：{items.map(item=>item.publisher || '发布者未提供').join(' · ')}</p>
    {(cluster.relationship || cluster.connection) && <p className="intel-v2-hint">聚簇依据：{cluster.connection || cluster.relationship}</p>}
    {!!cluster.eventEvidence?.length && <details><summary>核对同事件依据</summary>{cluster.eventEvidence.map((e,i)=><div key={i}><p>{items.find(s=>s.id===e.sourceId)?.title || e.sourceId}</p><blockquote>{e.quote}</blockquote></div>)}</details>}
    <details className="acquisition-cluster-unknown"><summary>分歧与未知</summary>{cluster.uncertainties?.length ? <ul>{cluster.uncertainties.map((item,index)=><li key={index}>{typeof item==='string' ? item : item.description || item.text}</li>)}</ul> : <p>尚未提炼材料间分歧；未记录不表示没有分歧。</p>}</details>
    <div className="acquisition-cluster-materials">{items.map(item=><AcquisitionResource key={item.id} item={{...item,type:'source',acquisitionBatch:true}} onGo={onGo} onLink={onLink}/>)}</div>
    <p className="intel-v2-hint">保留或忽略会更新本簇审阅状态，不删除原文；可在已审阅范围恢复。已过滤材料恢复至待复核，不直接进入主阅读列表。拆分与合并会固定人工分组。</p>
    <div className="intel-v2-actions"><button className="btn" disabled={busy} onClick={()=>onAction(cluster.id,'keep')}>确认保留</button><button className="btn" disabled={busy} onClick={()=>onAction(cluster.id,'ignore')}>确认忽略</button>{cluster.status && cluster.status!=='unreviewed' && <button className="btn" disabled={busy} onClick={()=>onAction(cluster.id,'restore')}>确认恢复待审阅</button>}{items.some(item=>item.processing?.relevance==='not_ai') && <button className="btn" disabled={busy} onClick={()=>onAction(cluster.id,'reconsider')}>确认恢复至待复核</button>}<button className="text-action" disabled={busy || items.length<2} onClick={()=>setEditing(editing==='split' ? '' : 'split')}>拆分材料</button><button className="text-action" disabled={busy || clusters.length<2} onClick={()=>setEditing(editing==='merge' ? '' : 'merge')}>合并到另一簇</button></div>
    {editing==='split' && <fieldset className="acquisition-cluster-edit"><legend>选中的材料将独立成簇</legend>{items.map(item=><label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event=>setSelected(event.target.checked ? [...selected,item.id] : selected.filter(id=>id!==item.id))}/>{item.title}</label>)}<button className="btn" disabled={busy || !selected.length || selected.length===items.length} onClick={async()=>{if(await onAction(cluster.id,'split',{sourceIds:selected}))setEditing('');}}>确认拆分</button></fieldset>}
    {editing==='merge' && <div className="acquisition-cluster-edit"><label>目标聚簇<select aria-label={`合并 ${cluster.title} 到`} value={target} onChange={event=>setTarget(event.target.value)}><option value="">请选择目标</option>{clusters.filter(item=>item.id!==cluster.id).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label><p className="intel-v2-hint">确认后，两簇材料将合并，所有原始来源与发现路径保留。</p><button className="btn" disabled={busy || !target} onClick={async()=>{if(await onAction(cluster.id,'merge',{targetId:target}))setEditing('');}}>确认合并</button></div>}
  </article>;
}
export function AcquisitionReview({onGo,onLink}) {
  const [scope,setScope]=useState('recent'),[offset,setOffset]=useState(0),[data,setData]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const sequence=useRef(0);
  const load=useCallback(async()=>{const ticket=++sequence.current;try{const value=await request(`?${new URLSearchParams({scope,offset:String(offset),limit:'20'})}`);if(ticket===sequence.current){setData(value);setError(null);}}catch(e){if(ticket===sequence.current)setError(e);}},[scope,offset]);
  useEffect(()=>{setData(null);void load();return ()=>{sequence.current++;};},[load]);
  async function action(id,actionName,extra={}){setBusy(true);setNotice('');try{await request(`/clusters/${encodeURIComponent(id)}/action`,{confirmed:true,action:actionName,...extra});await load();setNotice('审阅结果已保存。');return true;}catch(e){setError(e);return false;}finally{setBusy(false);}}
  async function process(semantic){setBusy(true);setNotice('');try{await request('/process',{confirmed:true,semantic});await load();setNotice(semantic ? '已完成本批已授权材料的处理；失败或上下文不足的材料仍保留待复核。' : '已有材料已按当前规则重处理，无需等待上游更新。');}catch(e){setError(e);}finally{setBusy(false);}}
  function changeScope(value){setScope(value);setOffset(0);}
  const clusters=data?.clusters || [],stats=data?.stats || {};
  return <section className="acquisition-review" aria-label="AI 情报待审阅">
    <ViewTabs items={primaryScopes} value={scope} onChange={changeScope} label="AI 阅读范围"/>
    <p className="intel-v2-hint">{scope==='recent' ? '严格依据原始发布时间筛选过去 24 小时新资讯，未知日期不计入。' : scope==='deep' ? 'Follow Builders 博客与播客近期新收录的深读材料；原文可能早于 24 小时，原始日期单独标记。' : '从已保存的资料、完整发现路径与审阅状态生成，未读内容不随最新采集批次消失。'}</p>
    <details className="acquisition-review-secondary" open={secondaryScopes.some(item=>item.key===scope)}><summary>待处理与已审阅范围</summary><ViewTabs items={secondaryScopes} value={scope} onChange={changeScope} label="次级阅读范围"/></details>
    <details className="acquisition-review-processing"><summary>重处理已有材料与统计口径</summary><p>本地处理会更新相关性、阅读版本与自动聚簇，保留原始正文和人工分组；语义处理仅向已配置模型发送已获 AI 处理授权的材料。</p><div className="intel-v2-actions"><button className="btn" disabled={busy} onClick={()=>process(false)}>确认本地重处理</button><button className="btn" disabled={busy} onClick={()=>process(true)}>确认处理已授权材料（AI）</button><button className="text-action" disabled={busy} onClick={load}>刷新审阅列表</button></div><p>以下统计针对已保存资料与当前处理结果，以稳定原文身份去重；不等于本轮抓取量。抓取、窗外与重复量见「本次采集」。</p><dl className="acquisition-times">{Object.entries({materials:'已有资料',readable:'可读资料',irrelevant:'无关资料',needsContext:'待补上下文',unreadable:'不可读资料',pending:'待审阅资料',clusters:'聚簇'}).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{stats[key] ?? '—'}</dd></div>)}</dl></details>
    {busy && <p role="status">正在处理，请稍候…</p>}{notice && <p role="status">{notice}</p>}<ErrorNote error={error} what="读取或更新审阅资料" onRetry={load}/>
    {!data && !error ? <Loading rows={4}/> : !clusters.length ? <Empty><h3>此范围暂无聚簇</h3><p>这不表示来源没有内容。可查看待补正文与主题待复核，或展开「重处理已有材料」运行本地规则，无需重新采集。</p></Empty> : clusters.map(cluster=><Cluster key={cluster.id} cluster={cluster} clusters={clusters} busy={busy} onAction={action} onGo={onGo} onLink={onLink}/>)}
    <div className="intel-v2-actions"><button className="btn" disabled={busy || !offset} onClick={()=>setOffset(Math.max(0,offset-20))}>上一页</button><span className="intel-v2-hint">第 {Math.floor(offset/20)+1} 页</span><button className="btn" disabled={busy || data?.nextOffset==null} onClick={()=>setOffset(data.nextOffset)}>下一页</button></div>
  </section>;
}
