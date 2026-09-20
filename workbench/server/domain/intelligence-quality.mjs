import crypto from 'node:crypto';
import { createUlid } from '../storage/ids.mjs';
import { sourceContainsVerbatim } from './integrity.mjs';

export const contentHash = body => crypto.createHash('sha256').update(String(body || '')).digest('hex');
export function canonicalSourceUrl(value) {
 try { const u = new URL(value); if (!['https:', 'http:'].includes(u.protocol)) return ''; u.hash = ''; u.hostname = u.hostname.replace(/^www\./, '').replace(/^twitter\.com$/, 'x.com'); for (const k of [...u.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(k)) u.searchParams.delete(k); u.searchParams.sort(); return u.toString(); } catch { return ''; }
}
export function sourceIdentity(source) {
 const canonicalUrl = source.canonicalUrl || canonicalSourceUrl(source.url);
 const sourceKind = source.sourceKind || source.contentKind || (source.title?.startsWith('评论 · ') ? 'comment' : source.localId ? 'note' : 'unknown');
 const internal = source.localId || source.provider === 'local';
 const originKind = internal ? 'internal' : source.originKind || (source.provider === 'manual' ? 'manual' : canonicalUrl ? 'external' : 'unknown');
 let publisherKey = source.publisherKey || ''; try { publisherKey ||= new URL(canonicalUrl).hostname; } catch {}
 const discussion = canonicalUrl.match(/^(https?:\/\/(?:[^/]+\.)?reddit\.com\/r\/[^/]+\/comments\/[^/]+)/i)?.[1];
 return {originKind, originRef: source.originRef || (source.localId ? `${source.localKind || 'local'}:${source.localId}` : null), channelId:source.channelId || null, sourceKind,
  canonicalUrl, publisherKey, contentHash:source.body!==undefined?contentHash(source.body):source.contentHash||contentHash(''), revisionOfId:source.revisionOfId || null,
  parentItemId:source.parentItemId || null, rootItemId:source.rootItemId || null,
  provenanceGroupKey:source.provenanceGroupKey || discussion || canonicalUrl || source.localId || source.id || null};
}
export function sourceFromRow(row) {
 const data = JSON.parse(row.data_json);
 const expired = row.deleted_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now());
 if(expired){data.body="";data.author="";data.url="";data.title="内容已移除";data.metadata={};}
 if(row.acquisition_identity){data.acquisition=true;data.contentStatus=expired?"unavailable":row.content_status;data.rights=expired?{}:JSON.parse(row.rights_json||"{}");data.expiresAt=row.expires_at;data.deletedAt=row.deleted_at;data.versionId=row.current_version_id;}
 const fields = {originKind:row.origin_kind,originRef:row.origin_ref,channelId:row.channel_id,sourceKind:row.source_kind,canonicalUrl:row.canonical_url,publisherKey:row.publisher_key,contentHash:row.content_hash,revisionOfId:row.revision_of_id,parentItemId:row.parent_item_id,rootItemId:row.root_item_id,provenanceGroupKey:row.provenance_group_key};
 if(expired){fields.canonicalUrl='';fields.publisherKey='';}
 for (const k of Object.keys(fields)) if (!fields[k] || fields[k] === 'unknown') delete fields[k];
 return {id:row.id,...data,...sourceIdentity({...data,...fields,id:row.id}),createdAt:row.created_at};
}
export function persistSourceIdentity(w,id,source) {
 const meta=sourceIdentity(source);
 // A known local record or exact copy of a draft cannot become independent external evidence.
 const own = w.db.prepare('SELECT id FROM drafts WHERE body_markdown=? AND length(body_markdown)>=40 LIMIT 1').get(source.body || '');
 if(own){meta.originKind='internal';meta.originRef=`draft:${own.id}`;}
 if(meta.sourceKind==='comment' && !meta.parentItemId){const parent=w.db.prepare("SELECT id FROM intel_sources WHERE canonical_url=? AND source_kind IN ('post','article') ORDER BY created_at LIMIT 1").get(meta.canonicalUrl);meta.parentItemId=parent?.id||null;meta.rootItemId=parent?.id||null;}
 if(!meta.revisionOfId && meta.sourceKind!=='comment') {const prev=w.db.prepare("SELECT id FROM intel_sources WHERE canonical_url=? AND id<>? AND content_hash<>? AND source_kind<>'comment' ORDER BY created_at DESC LIMIT 1").get(meta.canonicalUrl,id,meta.contentHash);if(meta.canonicalUrl)meta.revisionOfId=prev?.id||null;}
 w.db.prepare('UPDATE intel_sources SET origin_kind=?,origin_ref=?,channel_id=?,source_kind=?,canonical_url=?,publisher_key=?,content_hash=?,revision_of_id=?,parent_item_id=?,root_item_id=?,provenance_group_key=? WHERE id=?').run(meta.originKind,meta.originRef,meta.channelId,meta.sourceKind,meta.canonicalUrl,meta.publisherKey,meta.contentHash,meta.revisionOfId,meta.parentItemId,meta.rootItemId,meta.provenanceGroupKey,id);
 return meta;
}
export function backfillIntelligenceIdentity(w) {
 w.repository.transaction(()=>{for(const row of w.db.prepare('SELECT * FROM intel_sources WHERE content_hash IS NULL ORDER BY created_at').all())persistSourceIdentity(w,row.id,{...JSON.parse(row.data_json),id:row.id});w.db.exec("UPDATE intel_sources SET parent_item_id=(SELECT p.id FROM intel_sources p WHERE p.canonical_url=intel_sources.canonical_url AND p.source_kind IN ('post','article') ORDER BY p.created_at LIMIT 1),root_item_id=(SELECT p.id FROM intel_sources p WHERE p.canonical_url=intel_sources.canonical_url AND p.source_kind IN ('post','article') ORDER BY p.created_at LIMIT 1) WHERE source_kind='comment' AND parent_item_id IS NULL");});
}
export function externalEvidence(source) { const m=sourceIdentity(source); return m.originKind==='external' && !['comment','external_digest'].includes(m.sourceKind) && !source.deletedAt && (!source.expiresAt || Date.parse(source.expiresAt)>Date.now()) && Boolean(m.canonicalUrl) && source.readLevel==='original'; }
export function independentEvidenceCount(sources) {const groups=new Set(),hashes=new Set();let count=0;for(const s of sources.filter(externalEvidence)){const m=sourceIdentity(s);if(!groups.has(m.provenanceGroupKey)&&!hashes.has(m.contentHash))count++;groups.add(m.provenanceGroupKey);hashes.add(m.contentHash);}return count;}
export function persistIntelligenceCluster(w,group,sources) {
 const key=contentHash(group.key.toLowerCase().replace(/[\s\p{P}]/gu,''));
 const old=w.db.prepare('SELECT id FROM intel_clusters WHERE cluster_key=?').get(key);
 const id=old?.id||createUlid(),at=new Date().toISOString();
 const primary=sources.find(externalEvidence)||sources[0];
 w.db.prepare('INSERT INTO intel_clusters(id,cluster_key,title,cluster_kind,primary_source_id,first_seen_at,last_evidence_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(cluster_key) DO UPDATE SET title=excluded.title,last_evidence_at=excluded.last_evidence_at').run(id,key,group.focus||group.key,group.relationship||'standalone',primary?.id||null,at,at);
 for(const s of sources)w.db.prepare('INSERT OR IGNORE INTO intel_cluster_members(cluster_id,source_id,role) VALUES(?,?,?)').run(id,s.id,s.sourceKind==='comment'?'comment':s.id===primary?.id?'primary':'supporting');
 return id;
}
const texts=(v,max=8)=>Array.isArray(v)?v.filter(x=>typeof x==='string'&&x.trim()).slice(0,max).map(x=>x.trim().slice(0,1500)):[];
export function assessBriefQuality(item,byId,scopeReview) {
 const reasons=[], evidence=(item.evidence||[]).map((e,i)=>{const s=byId.get(e.sourceId);return {...e,evidenceId:`e${i+1}`,sourceContentHash:s?.contentHash||contentHash(s?.body),quoteCheck:s&&sourceContainsVerbatim(s.body,e.quote)?'matched':'missing',scopeCheck:'unreviewed',relation:'supports'};});
 const claims=(Array.isArray(item.claims)?item.claims:[]).filter(c=>c&&typeof c==='object').slice(0,12).map((c,i)=>({id:`c${i+1}`,text:typeof c.text==='string'?c.text.slice(0,2000):'',kind:['author_report','observation','interpretation','hypothesis'].includes(c.kind)?c.kind:'interpretation',attribution:typeof c.attribution==='string'?c.attribution.slice(0,500):'',evidenceIds:texts(c.evidenceIds,12),limitations:texts(c.limitations)}));
 if(!claims.length)reasons.push('尚未逐条核对主张范围');
 for(const c of claims){if(!c.text||!c.evidenceIds.length||c.evidenceIds.some(id=>!evidence.some(e=>e.evidenceId===id)))reasons.push('主张缺少对应原文');if(c.kind==='author_report'&&!c.attribution)reasons.push('来源自述缺少归属');}
 // Numeric checks are deterministic. Semantic scope is reviewed separately and labelled as AI review.
 const quotes=evidence.map(e=>e.quote).join('\n');
 const nums=v=>(String(v||'').match(/\d+(?:\.\d+)?%?/g)||[]);
 if(nums([item.title,item.summary,...claims.map(c=>c.text)].join('\n')).some(n=>!nums(quotes).includes(n)))reasons.push('数字不在所引原文中');
 const checked=scopeReview?.verdict==='supported' && Array.isArray(scopeReview.claims) && scopeReview.claims.length===claims.length && claims.every(c=>scopeReview.claims.some(r=>r.id===c.id&&r.verdict==='supported'));
 if(!checked)reasons.push('标题、摘要和主张尚未通过范围复核');
 if(checked)evidence.forEach(e=>e.scopeCheck='ai_reviewed');
 const whyItMatters=String(item.whyItMatters||item.why_it_matters||item.reason||'').slice(0,2000),audienceTakeaway=String(item.audienceTakeaway||item.audience_takeaway||'').slice(0,2000);
 const uncertainties=texts(item.uncertainties),suggestedUses=texts(item.suggestedUses||item.suggested_uses);
 if(!audienceTakeaway||!suggestedUses.length||!uncertainties.length)reasons.push('缺少读者用途或证据边界');
 const selected=evidence.map(e=>byId.get(e.sourceId)).filter(Boolean);
 const recent=selected.some(s=>s.publishedAt&&Date.parse(s.publishedAt)>=Date.now()-7*86400000&&Date.parse(s.publishedAt)<=Date.now());
 return {evidence,claims,whyItMatters,audienceTakeaway,uncertainties,suggestedUses,editorialState:reasons.length?'needs_review':'ready',freshnessKind:item.kind==='evergreen'?'evergreen':recent?(item.changeNote?'recent_update':'recent_event'):'newly_discovered',quality:{ruleVersion:'intel-v2.1',scopeMethod:'ai_review_with_code_checks',reasons:[...new Set(reasons)],independentEvidenceCount:independentEvidenceCount(selected)}};
}
export function intelligenceQualitySummary(w) {
 const rows=w.db.prepare('SELECT * FROM intel_sources').all().map(sourceFromRow);
 return {items:rows.length,externalItems:rows.filter(externalEvidence).length,comments:rows.filter(s=>s.sourceKind==='comment').length,internalItems:rows.filter(s=>s.originKind==='internal').length,publishers:new Set(rows.filter(externalEvidence).map(s=>s.publisherKey)).size,independentEvidence:independentEvidenceCount(rows),clusters:w.db.prepare('SELECT count(*) n FROM intel_clusters').get().n};
}
