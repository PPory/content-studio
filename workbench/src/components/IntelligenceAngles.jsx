import {useRef,useState} from 'react';
import {api} from '../lib/api.js';
export function IntelligenceAngles({brief,onChoose}){
 const [open,setOpen]=useState(false),[angles,setAngles]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const pending=useRef(false);
 const generate=async()=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');try{const result=await api.intelligenceAngles(brief.id);if(result.version!==brief.version&&brief.version)throw Error('情报已更新，请重新打开后探索');setAngles(result.angles);}catch(e){setError(e.message);}finally{pending.current=false;setBusy(false);}};
 return <section className="brief-angle-section"><button className="brief-angle-toggle" aria-expanded={open} aria-controls={`angles-${brief.id}`} onClick={()=>{setOpen(!open);if(!open&&angles===null&&!busy)void generate();}}><span>探索表达角度</span><span aria-hidden="true">{open?'−':'＋'}</span></button><p className="brief-angle-hint">想把理解说给别人听时，再看看有哪些值得展开的问题。</p>{open&&<div id={`angles-${brief.id}`}>
 {busy&&<p role="status">正在结合原文整理角度…</p>}{error&&<div role="alert"><p>{error}</p><button className="btn" disabled={busy} onClick={generate}>重试探索</button></div>}
 {angles?.length===0&&<p>暂时没有自然的表达角度，可以先围绕这条情报继续讨论。</p>}
 {angles?.map((angle,index)=><article className="brief-angle" key={index}><span className="brief-meta">可探索的方向 {index+1} · 待讨论</span><h3>{angle.question}</h3><dl><dt>可能回应的困惑</dt><dd>{angle.audience}</dd><dt>已有理解能补充什么</dt><dd>{angle.connection}</dd><dt>还需要验证</dt><dd>{angle.gap}</dd></dl><details><summary>这个角度的依据</summary>{angle.evidence.map((e,i)=><blockquote key={i}>{e.quote}<cite>{e.title}</cite></blockquote>)}</details><button className="btn" onClick={()=>onChoose(angle)}>带入选题</button></article>)}
 </div>}</section>;
}
