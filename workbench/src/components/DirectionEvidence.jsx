import {useState,useRef} from 'react';
import {api} from '../lib/api.js';
export function DirectionEvidence({basis:b,onGo}){
 const [source,setSource]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),pending=useRef(false);
 const load=async()=>{if(source||pending.current)return;pending.current=true;setBusy(true);setError('');try{const r=b.kind==='capture'?await api.libraryItem('capture',b.id):await api.intelligenceSourceDetail(b.id);setSource(r.source||r.item);}catch(e){setError(e.message);}finally{pending.current=false;setBusy(false);}};
 return <div><strong>{b.title}</strong><blockquote>{b.quote}</blockquote>{b.briefId&&<button className="btn btn-sm" onClick={()=>onGo('intel-detail',b.briefId)}>回到情报</button>}<details onToggle={e=>{if(e.currentTarget.open)void load();}}><summary>查看原始记录</summary>{busy&&<p role="status">正在读取…</p>}{error&&<p role="alert">{error}<button className="btn btn-sm" onClick={load}>重试</button></p>}{source&&<p style={{whiteSpace:'pre-wrap'}}>{source.body||source.bodyMarkdown||source.excerpt}</p>}{/^https?:\/\//i.test(b.url||'')&&<a href={b.url} target="_blank" rel="noreferrer">打开原文 ↗</a>}</details></div>;
}
