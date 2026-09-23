import { sourceFromRow } from './intelligence-quality.mjs';
import { processingFor } from '../acquisition/review.mjs';
import { publisherIdentity } from '../acquisition/source-presentation.mjs';

const bad = message => Object.assign(new Error(message),{status:400});
const key = "CASE WHEN s.source_kind LIKE '%podcast%' OR s.source_kind LIKE '%comment%' THEN coalesce(nullif(s.acquisition_identity,''),nullif(json_extract(s.data_json,'$.platformId'),''),s.id) ELSE coalesce(nullif(s.canonical_url,''),nullif(json_extract(s.data_json,'$.url'),''),s.id) END";
const active = "s.deleted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>?) AND (s.origin_kind='external' OR (s.origin_kind='manual' AND s.source_kind='hot-summary'))";

export function intelligenceLibrary(w,{q='',group='',offset=0,limit=40}={}) {
 if(typeof q!=='string'||q.length>500||!['','all','aihot','follow_builders','t2_media','community','legacy'].includes(group))throw bad('资料筛选条件无效');
 offset=Number(offset);limit=Number(limit);
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw bad('分页范围无效');
 const term=q.toLowerCase().trim(),time=new Date().toISOString(),args=[time];
 let match="SELECT DISTINCT "+key+" docKey FROM intel_sources s WHERE "+active;
 if(group&&group!=='all'){
  match+=group==='legacy'
   ?" AND NOT EXISTS (SELECT 1 FROM source_discoveries d JOIN intel_channels c ON c.id=d.channel_id WHERE d.source_id=s.id)"
   :" AND EXISTS (SELECT 1 FROM source_discoveries d JOIN intel_channels c ON c.id=d.channel_id WHERE d.source_id=s.id AND c.source_group=?)";
  if(group!=='legacy')args.push(group);
 }
 if(term){
  match+=" AND instr(lower(coalesce(json_extract(s.data_json,'$.title'),'')||' '||coalesce(json_extract(s.data_json,'$.body'),'')||' '||coalesce(json_extract(s.data_json,'$.summary'),'')),?)>0";
  args.push(term);
 }
 const total=w.db.prepare("SELECT count(*) n FROM ("+match+")").get(...args).n;
 if(!total||offset>=total)return {total,offset,limit,hasMore:false,items:[]};
 const pageSql="WITH matching AS ("+match+"), ranked AS (SELECT s.id,"+key+" docKey,min(s.created_at) OVER (PARTITION BY "+key+") firstSeenAt,row_number() OVER (PARTITION BY "+key+" ORDER BY CASE WHEN s.content_status='full_text' THEN 1 ELSE 0 END DESC,length(coalesce(json_extract(s.data_json,'$.body'),'')) DESC,s.created_at DESC,s.id DESC) rn FROM intel_sources s JOIN matching m ON m.docKey="+key+" WHERE "+active+") SELECT id,docKey,firstSeenAt FROM ranked WHERE rn=1 ORDER BY firstSeenAt DESC,id DESC LIMIT ? OFFSET ?";
 const page=w.db.prepare(pageSql).all(...args,time,limit,offset);
 const placeholders=page.map(()=>'?').join(',');
 const aliasSql="SELECT s.id,"+key+" docKey FROM intel_sources s WHERE "+active+" AND "+key+" IN ("+placeholders+")";
 const aliases=w.db.prepare(aliasSql).all(time,...page.map(row=>row.docKey));
 const aliasMap=new Map(page.map(row=>[row.docKey,[]]));
 for(const row of aliases)aliasMap.get(row.docKey)?.push(row.id);
 const aliasIds=aliases.map(row=>row.id);
 const discoveries=aliasIds.length?w.db.prepare("SELECT d.*,c.name AS channelName,c.source_group AS sourceGroup,c.stream,c.platform,c.url AS channelUrl,c.site_url AS siteUrl FROM source_discoveries d JOIN intel_channels c ON c.id=d.channel_id WHERE d.source_id IN ("+aliasIds.map(()=>'?').join(',')+") ORDER BY d.first_seen_at").all(...aliasIds):[];
 const paths=new Map();
 for(const row of discoveries){
  if(!paths.has(row.source_id))paths.set(row.source_id,[]);
  paths.get(row.source_id).push(row);
 }
 const items=page.map(entry=>{
  const row=w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(entry.id),source=sourceFromRow(row),ids=aliasMap.get(entry.docKey)||[entry.id];
  const allPaths=ids.flatMap(id=>paths.get(id)||[]).filter((discovery,index,array)=>array.findIndex(other=>other.channel_id===discovery.channel_id&&other.discovery_key===discovery.discovery_key)===index);
  const body=source.body||'';
  return {...source,...publisherIdentity(source,allPaths),processing:processingFor(w,source),discoveries:allPaths,aliasSourceIds:ids,sourceGroup:allPaths[0]?.sourceGroup||'legacy',stream:source.metadata?.stream||allPaths[0]?.stream,firstSeenAt:entry.firstSeenAt,lastSeenAt:row.updated_at,body:body.slice(0,600),bodyTruncated:body.length>600,type:'source'};
 });
 return {total,offset,limit,hasMore:offset+limit<total,items};
}