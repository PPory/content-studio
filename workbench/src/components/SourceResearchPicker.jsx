import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useDialog } from "../lib/use-dialog.js";
import { ErrorNote } from "./ui.jsx";
import "./source-research-picker.css";

export function SourceResearchPicker({source,onClose,onGo}) {
 const [items,setItems]=useState(null),[target,setTarget]=useState(""),[question,setQuestion]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(null);
 const close=useCallback(()=>{if(!busy)onClose();},[busy,onClose]);
 const ref=useDialog(true,close);
 const load=useCallback(()=>{setError(null);api.researches().then(r=>setItems(r.researches||[])).catch(setError);},[]);
 useEffect(load,[load]);
 async function submit(event){event.preventDefault();setBusy(true);setError(null);try{const result=await api.intelligenceSourceResearch(source.id,{researchId:target,question:target?"":question.trim(),confirmed:true});onClose();onGo("research",result.research.id);}catch(e){setError(e);}finally{setBusy(false);}}
 return <div className="scrim scrim--center"><form ref={ref} className="source-research-picker" role="dialog" aria-modal="true" aria-label="带入选题" onSubmit={submit}><header><h2>带入选题</h2><button type="button" className="btn btn-sm" onClick={close} disabled={busy}>取消</button></header><p className="source-research-picker__source">{source.title}</p><p>将这条内容作为资料引用保留，原文链接随资料一起带入。</p><ErrorNote error={error} what="带入选题" onRetry={items===null?load:undefined}/>{items===null&&!error?<p role="status">正在读取选题…</p>:null}{items!==null&&<><label>放到哪里<select aria-label="放到哪里" data-autofocus value={target} onChange={e=>setTarget(e.target.value)} disabled={busy}><option value="">新建一个选题</option>{items.map(item=><option key={item.id} value={item.id}>{item.question||item.title}</option>)}</select></label>{!target&&<label>想研究的问题<input value={question} onChange={e=>setQuestion(e.target.value)} required maxLength={300} placeholder="你想从这条资料弄明白什么？" disabled={busy}/></label>}<footer><button className="btn btn-primary" disabled={busy||(!target&&!question.trim())}>{busy?"正在带入…":target?"确认带入":"创建选题并带入"}</button></footer></>}</form></div>;
}
