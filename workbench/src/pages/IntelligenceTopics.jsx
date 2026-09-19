import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { Empty, ErrorNote, Loading, PageHeader, ViewTabs } from "../components/ui.jsx";
import "./intelligence-v2.css";

const readinessLabel = {untriaged:"待整理",needs_evidence:"待补证",ready:"可研究",in_progress:"研究中"};
const textList = values => (values || []).map(value => typeof value === "string" ? value : value.description || value.task || value.title || value.quote || JSON.stringify(value));
function TopicContent({item}) {
  return <div className="intel-topic-content">
    <dl>{[["面向谁",item.audience],["切入角度",item.angle || item.coreClaim],["读者能获得什么",item.deliverable],["为什么现在做",item.whyNow]].filter(([,value])=>value).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {[["尚缺证据",item.evidenceGaps],["下一步研究",item.researchTasks],["目前不能声称",item.nonClaims]].filter(([,values])=>values?.length).map(([label,values])=><section key={label}><h3>{label}</h3><ul>{textList(values).map((value,index)=><li key={index}>{value}</li>)}</ul></section>)}
    {item.evidence?.length>0 && <details><summary>依据 · {item.evidence.length} 条</summary>{item.evidence.map((value,index)=><blockquote key={index}>{value.quote || value.text}<small>{value.title || value.sourceId}</small></blockquote>)}</details>}
  </div>;
}
export function IntelligenceTopics({state,onGo}) {
  const [data,setData]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false),[filter,setFilter]=useState("all");
  const [previewNonce,setPreviewNonce]=useState(0);
  const [candidate,setCandidate]=useState(null),[starting,setStarting]=useState(null),[notice,setNotice]=useState("");
  const dialog=useRef(null);
  const load=useCallback(async()=>{try{setData(await api.intelligenceTopics());setError(null);}catch(e){setError(e);}},[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(starting)dialog.current?.showModal();},[starting]);
  useEffect(()=>{if(!state)return;let body;try{body=JSON.parse(state);}catch{return;}if(!body.briefIds?.length)return;let stopped=false;setBusy(true);setCandidate(null);api.intelligenceTopicPreview({briefIds:body.briefIds}).then(result=>{if(!stopped){setCandidate(result.candidate);if(!result.candidate)setNotice("本批资料暂未形成可执行选题，可以回到精选换一组资料。");}}).catch(e=>{if(!stopped)setError(e);}).finally(()=>{if(!stopped)setBusy(false);});return()=>{stopped=true;};},[state,previewNonce]);
  async function save(){setBusy(true);setError(null);try{await api.intelligenceTopicSave(candidate);setCandidate(null);setNotice("选题已保存，可补足证据后开始研究。");await load();onGo("intel-topics");}catch(e){setError(e);}finally{setBusy(false);}}
  async function start(){setBusy(true);setError(null);try{const result=await api.intelligenceTopicStart(starting.id);setStarting(null);if(result.research?.id)onGo("research",result.research.id);}catch(e){setError(e);}finally{setBusy(false);}}
  const opportunities=data?.opportunities || [];
  const cards=(data?.cards || []).filter(card=>!opportunities.some(item=>item.id===card.id));
  const items=[...opportunities,...cards.map(card=>({...card,kind:"intel",workingTitle:card.workingTitle || card.question,readiness:card.readiness || "untriaged"}))].filter(item=>filter==="all" || item.readiness===filter);
  return <div className="intelligence-v2">
    <PageHeader title="选题" aside={<button className="btn" onClick={()=>onGo("bridge")}>从已有知识探索</button>} />
    <p className="intel-v2-hint">从精选提炼可展开的题目，核对读者价值与依据，再进入研究。</p>
    {error && <ErrorNote error={error} what="处理选题" onRetry={()=>{void load();if(state)setPreviewNonce(v=>v+1);}}/>}
    {notice && <p role="status">{notice}</p>}
    {busy && !candidate && <p role="status">正在核对资料并整理候选…</p>}
    {candidate && <section className="intel-topic-preview"><p className="intel-v2-hint">候选预览 · 尚未保存 · {readinessLabel[candidate.readiness] || "待整理"}</p><h2>{candidate.workingTitle}</h2><TopicContent item={candidate}/><p>确认保存后加入选题列表，原始资料保持独立。</p><div className="intel-v2-actions"><button className="btn btn-primary" disabled={busy} onClick={save}>确认保存选题</button><button className="btn" disabled={busy} onClick={()=>{setCandidate(null);onGo("intel-topics");}}>放弃候选</button></div></section>}
    <ViewTabs items={[{key:"all",label:"全部"},...Object.entries(readinessLabel).map(([key,label])=>({key,label}))]} value={filter} onChange={setFilter} label="选题准备状态" />
    {!data ? <Loading rows={3}/> : !items.length ? <Empty><h2>这里还没有{filter==="all" ? "" : readinessLabel[filter]}选题</h2><p>在精选中选择一条或多条信息，预览选题后再保存。</p><button className="btn" onClick={()=>onGo("intel")}>阅读精选</button></Empty> : <div className="intel-v2-list">{items.map(item=><article key={`${item.kind}:${item.id}`}><header><span className="intel-v2-state">{readinessLabel[item.readiness] || "待整理"}</span><h2>{item.workingTitle || item.title || item.coreClaim || item.core_claim || item.question}</h2></header><TopicContent item={item}/><div className="intel-v2-actions">{item.kind==="bridge" ? <button className="btn" onClick={()=>onGo("bridge",`opportunity:${item.id}`)}>打开知识选题</button> : item.researchId ? <button className="btn" onClick={()=>onGo("research",item.researchId)}>继续研究</button> : <button className="btn" disabled={busy} onClick={()=>setStarting(item)}>开始研究</button>}</div></article>)}</div>}
    {starting && <dialog className="brief-settings" ref={dialog} aria-label="确认开始研究" onCancel={()=>setStarting(null)}><h2>开始研究「{starting.workingTitle || starting.question}」</h2><p>将建立研究记录，并带入现有资料、待验证问题与表达边界。证据缺口会保留在研究中，不能当成已证实结论。</p><div className="intel-v2-actions"><button className="btn btn-primary" disabled={busy} onClick={start}>确认开始研究</button><button className="btn" disabled={busy} onClick={()=>setStarting(null)}>取消</button></div></dialog>}
  </div>;
}
