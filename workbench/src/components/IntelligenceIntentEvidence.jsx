import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { ErrorNote, Loading } from './ui.jsx';
import { creationLine } from './EventReading.jsx';
export function LegacyTopicOpen({id,onGo}) {
 const [item,setItem]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false);
 const [,kind,...parts]=id.split(':');const legacyId=parts.join(':');
 useEffect(()=>{api.researches().then(r=>setItem(r.researches.find(x=>x.id===id)||{title:'历史选题'})).catch(setError);},[id]);
 return <section className="research-overview"><button className="btn" onClick={()=>onGo('research')}>← 全部选题</button>{error&&<ErrorNote error={error} what="打开历史选题"/>}{!item?<Loading rows={2}/>:<><h1>{item.title||item.question}</h1><p>{item.notes||item.excerpt}</p><p>这是此前已保存的选题。打开后会在当前选题空间承接，已有研究和文章关联会复用。</p><button className="btn btn-primary" disabled={busy} onClick={async()=>{setBusy(true);try{const r=await api.intelligenceLegacyTopic(kind,legacyId);onGo('research',r.research.id);}catch(e){setError(e);}finally{setBusy(false);}}}>打开历史选题</button></>}</section>;
}
export function IntelligenceIntentEvidence({intents,onGo}) {
  if(!intents?.length)return null;
  return <details className="topic-detail" open>
    <summary>来自情报的选题意图 · {intents.length}</summary>
    {intents.map(intent=><section key={intent.operationId} className="intel-topic-content">
      {intent.creation&&<p className="research-creation">{intent.creation.angle?`切入：${intent.creation.angle} · `:''}{creationLine(intent.creation)}</p>}
      <p>{intent.notes}</p>
      {intent.angle && <div>
        <h3>{typeof intent.angle==='string'?intent.angle:intent.angle.question}</h3>
        {typeof intent.angle==='object' && <dl>
          {[['面向谁',intent.angle.audience],['我的切入',intent.angle.connection],['仍待核实',intent.angle.gap]].filter(([,v])=>v).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>}
      </div>}
      {intent.unavailable ? <p>来源访问条件已变化，相关内容暂不展示。</p> : <div>
        <div className="row-actions">{intent.briefIds?.map((id,index)=><button className="btn btn-sm" key={id} onClick={()=>onGo('intel-detail',id)}>查看情报 {index+1}</button>)}</div>
        {!!intent.evidence?.length && <details><summary>原文依据</summary>{intent.evidence.map((e,i)=><blockquote key={i}>{e.quote}<small>{e.title||e.sourceId}</small></blockquote>)}</details>}
      </div>}
      {!!intent.nonClaims?.length && <p>{intent.nonClaims.join('；')}</p>}
    </section>)}
  </details>;
}
