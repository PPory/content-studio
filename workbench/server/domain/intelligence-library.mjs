import { materialProjection } from '../acquisition/review.mjs';
const bad = message => Object.assign(new Error(message),{status:400});
/** Read-only, deduplicated search over all retained source documents, never a 500-row snapshot. */
export function intelligenceLibrary(w,{q='',group='',offset=0,limit=40}={}) {
 if(typeof q!=='string'||q.length>500||!['','all','aihot','follow_builders','t2_media','community','legacy'].includes(group))throw bad('资料筛选条件无效');
 offset=Number(offset);limit=Number(limit);
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw bad('分页范围无效');
 const term=q.toLowerCase().trim();
 const items=materialProjection(w).filter(s=>(!group||group==='all'||(s.sourceGroup||'legacy')===group||s.discoveries?.some(d=>d.sourceGroup===group))&&(!term||`${s.title||''} ${s.body||''} ${s.summary||''}`.toLowerCase().includes(term))).sort((a,b)=>(Date.parse(b.firstSeenAt||b.createdAt)||0)-(Date.parse(a.firstSeenAt||a.createdAt)||0));
 return {total:items.length,offset,limit,hasMore:offset+limit<items.length,items:items.slice(offset,offset+limit).map(s=>({...s,body:(s.body||'').slice(0,600),bodyTruncated:(s.body||'').length>600,type:'source'}))};
}
