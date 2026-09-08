// Source identity is independent of collection provider; comments with different text remain distinct.
export function intelligenceDocumentKey(source){
 try{const u=new URL(source.url);u.hash='';u.hostname=u.hostname.replace(/^www\./,'').replace(/^twitter\.com$/,'x.com');for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.toString();}catch{return source.id;}
}
export function uniqueIntelligenceSources(sources){const seen=new Set();return sources.filter(s=>{const key=intelligenceDocumentKey(s)+'\n'+String(s.body||'').replace(/\s+/g,' ').trim();if(seen.has(key))return false;seen.add(key);return true;});}
export function intelligenceDocumentCount(sources){return new Set(sources.filter(s=>!['local','manual'].includes(s.provider)&&/^https?:/.test(s.url||'')).map(intelligenceDocumentKey)).size;}
export function intelligenceReadingSources(evidence,sources){const byId=new Map(sources.map(s=>[s.id,s])),groups=new Map();for(const [i,e]of evidence.entries()){const s=byId.get(e.sourceId);if(!s)continue;if(!groups.has(s.id))groups.set(s.id,{...s,quote:e.quote,quotes:[]});groups.get(s.id).quotes.push({number:i+1,quote:e.quote});}return [...groups.values()];}
export const intelligenceCitationText=body=>String(body||'').replace(/\[([^\]\n]+)\]/g,(all,inner)=>inner.match(/来源\s*\d/)?'['+inner.replace(/来源\s*(\d+)/g,'引文$1')+']':all);

export function intelligenceSourceDocuments(sources){
 const groups=new Map();for(const source of sources){const key=intelligenceDocumentKey(source);if(!groups.has(key))groups.set(key,{key,title:source.title.replace(/^评论 · /,''),url:source.url,publishedAt:source.contentKind==='comment'?null:source.publishedAt,provider:source.provider,records:[],quotes:[]});const document=groups.get(key);if(!document.records.some(r=>String(r.body||'').replace(/\s+/g,' ').trim()===String(source.body||'').replace(/\s+/g,' ').trim()))document.records.push(source);document.quotes.push(...(source.quotes||[]));if(source.contentKind==='post'){document.title=source.title;document.publishedAt=source.publishedAt;}}
 return [...groups.values()];
}
