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
/**
 * 可以作为卡片依据的外部资料：原文或订阅源给的摘要都算（2026-09-23 决策：先补全文，补不到用摘要，并标「仅基于摘要」）。
 * 评论和日报汇编仍不能单独撑起一张卡。只用于「有没有外部来源」「综合卡是否至少两份」这类门槛；
 * 排序用的 independentEvidenceCount 仍只数全文。
 */
export function externalReadable(source) { const m=sourceIdentity(source); return m.originKind==='external' && !['comment','external_digest'].includes(m.sourceKind) && !source.deletedAt && (!source.expiresAt || Date.parse(source.expiresAt)>Date.now()) && Boolean(m.canonicalUrl) && ['original','summary'].includes(source.readLevel); }
export function readableDocumentCount(sources) { return new Set(sources.filter(externalReadable).map(s=>sourceIdentity(s).provenanceGroupKey)).size; }
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
/**
 * 数字比对用的归一形式（2026-09-24）：5.0 与 5、2.00 与 2 视为一致，「40%」也认「40」；
 * 日期写法（2026年9月24日、9月24日、2026-09-24、9/24）不参与比对——它们不是「编出来的数字」这类风险。
 */
const DATE_RE=/\d{4}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}-\d{1,2}-\d{1,2}|\b\d{1,2}\/\d{1,2}\b/g;
export const normalizeNumber=raw=>{const pct=raw.endsWith('%');let n=pct?raw.slice(0,-1):raw;n=n.replace(/,/g,'');if(n.includes('.'))n=n.replace(/0+$/,'').replace(/\.$/,'');n=n.replace(/^0+(?=\d)/,'');return n;};
export function numberKeys(text){const out=[];for(const m of String(text||'').replace(DATE_RE,' ').matchAll(/\d[\d,]*(?:\.\d+)?%?/g)){out.push(normalizeNumber(m[0]));}return out;}
export function assessBriefQuality(item,byId,scopeReview) {
 const reasons=[], evidence=(item.evidence||[]).map((e,i)=>{const s=byId.get(e.sourceId);return {...e,evidenceId:`e${i+1}`,sourceContentHash:s?.contentHash||contentHash(s?.body),quoteCheck:s&&sourceContainsVerbatim(s.body,e.quote)?'matched':'missing',scopeCheck:'unreviewed',relation:'supports'};});
 const claims=(Array.isArray(item.claims)?item.claims:[]).filter(c=>c&&typeof c==='object').slice(0,12).map((c,i)=>({id:`c${i+1}`,text:typeof c.text==='string'?c.text.slice(0,2000):'',kind:['author_report','observation','interpretation','hypothesis'].includes(c.kind)?c.kind:'interpretation',attribution:typeof c.attribution==='string'?c.attribution.slice(0,500):'',evidenceIds:texts(c.evidenceIds,12),limitations:texts(c.limitations)}));
 if(!claims.length)reasons.push('尚未逐条核对主张范围');
 for(const c of claims){if(!c.text||!c.evidenceIds.length||c.evidenceIds.some(id=>!evidence.some(e=>e.evidenceId===id)))reasons.push('主张缺少对应原文');if(c.kind==='author_report'&&!c.attribution)reasons.push('来源自述缺少归属');}
 // Numeric checks are deterministic. Semantic scope is reviewed separately and labelled as AI review.
 const quotes=evidence.map(e=>e.quote).join('\n');
 const nums=numberKeys;
 // 数字要能在原文里找到：短引文里，或被引用来源的全文里（2026-09-23）。编造的数字两处都没有，照样拦下。
 const sourceNums=new Set(nums(evidence.map(e=>byId.get(e.sourceId)?.body||'').join('\n')));const quoteNums=new Set(nums(quotes));
 const missing=[...new Set(nums([item.title,item.summary,...claims.map(c=>c.text),...(Array.isArray(item.keyFacts)?item.keyFacts:[]).map(f=>f?.text||'')].join('\n')).filter(n=>!quoteNums.has(n)&&!sourceNums.has(n)))];
 // 写出是哪个数字，失败原因才能被看懂、被追查。
 if(missing.length)reasons.push(`数字不在所引原文中：${missing.slice(0,5).join('、')}`);
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
