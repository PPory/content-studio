import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { IntelligenceHeader } from "../components/IntelligenceHeader.jsx";
import { IntelligenceNav } from "../components/IntelligenceNav.jsx";
import { IntelligenceReader } from "../components/IntelligenceReader.jsx";
import { AcquisitionResource } from "../components/AcquisitionResource.jsx";
import { SourceResearchPicker } from "../components/SourceResearchPicker.jsx";
import { Empty, ErrorNote, Loading, SearchBox } from "../components/ui.jsx";
import { sourceDate, platformName } from "../components/BriefReading.jsx";
import "./intelligence-v2.css";
const kinds={post:"讨论帖",article:"原文",comment:"评论",external_digest:"资讯摘要",podcast_transcript:"播客转录",tweet:"动态"};
export function IntelligenceResources({onGo}) {
 const [data,setData]=useState(null),[error,setError]=useState(null),[q,setQ]=useState(''),[group,setGroup]=useState('all'),[offset,setOffset]=useState(0),[nonce,setNonce]=useState(0),[linking,setLinking]=useState(null);
 const sequence=useRef(0);
 useEffect(()=>{const ticket=++sequence.current;setData(null);const timer=setTimeout(()=>api.intelligenceLibrary({q,group,offset,limit:40}).then(r=>{if(sequence.current===ticket){setData(r);setError(null);}}).catch(e=>{if(sequence.current===ticket)setError(e);}),150);return()=>{clearTimeout(timer);sequence.current++;};},[q,group,offset,nonce]);
 return <div className="intel-workspace intelligence-v2 intel-resources-page"><IntelligenceNav current="intel-resources" onGo={onGo}/><IntelligenceHeader title="原始资料" desc="查找保留的原文与出处。同一原文合并显示，讨论帖与引用的文章分别保留。"/>
 <div className="intel-v2-toolbar"><SearchBox value={q} onChange={v=>{setQ(v);setOffset(0);}} ariaLabel="搜索原始资料" placeholder="搜索全部保留资料"/><label>信源<select aria-label="原始资料信源" value={group} onChange={e=>{setGroup(e.target.value);setOffset(0);}}><option value="all">全部信源</option>{Object.entries({aihot:"AIhot",follow_builders:"Follow Builders",t2_media:"T2 媒体",community:"社区",legacy:"其他来源"}).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><button className="text-action" onClick={()=>onGo("notes")}>记录自己的想法</button></div>
 {error?<ErrorNote error={error} what="读取原始资料" onRetry={()=>setNonce(n=>n+1)}/>:!data?<Loading rows={4}/>:!data.items.length?<Empty><h2>没有匹配的原始资料</h2><p>可调整搜索或信源范围；已有收藏仍在情报页。</p></Empty>:<><p className="intel-v2-hint">共 {data.total} 份资料 · 第 {offset+1}—{offset+data.items.length} 份 · 保留资料不代表已通过推荐检查</p><IntelligenceReader key={`${q}:${group}:${offset}`} items={data.items} label="原文目录" title={s=>s.displayTitle||s.title||s.body?.slice(0,60)||"未命名资料"} meta={s=>`${kinds[s.sourceKind||s.contentKind]||"资料"} · ${platformName(s.platform||s.provider)} · ${sourceDate(s.publishedAt)||"原始日期未知"} · ${{fulltext:"全文",full_text:"全文",short_content:"短内容",summary_only:"仅摘要",metadata_only:"仅元数据",metadata:"仅元数据"}[s.processing?.readability||s.contentStatus]||"范围见详情"}`} render={item=><AcquisitionResource item={item} onGo={onGo} onLink={setLinking} initialOpen/>}/><div className="row-actions"><button className="btn" disabled={!offset} onClick={()=>setOffset(v=>Math.max(0,v-40))}>上一页</button><span>第 {offset/40+1} 页</span><button className="btn" disabled={!data.hasMore} onClick={()=>setOffset(v=>v+40)}>下一页</button></div></>}
 {linking&&<SourceResearchPicker source={linking} onClose={()=>setLinking(null)} onGo={onGo}/>}</div>;
}
