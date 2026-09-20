import { publisherIdentity } from './source-presentation.mjs';
import { processingFor } from './review.mjs';
import { createUlid } from '../storage/ids.mjs';
import { canonicalSourceUrl, contentHash, sourceFromRow } from '../domain/intelligence-quality.mjs';
import { channelView } from './catalog.mjs';
import { acquisitionError } from './transport.mjs';

export const stamp = () => new Date().toISOString();
export const encode = v => JSON.stringify(v ?? {});
export function getChannel(w,id) {
  const row=w.db.prepare('SELECT * FROM intel_channels WHERE id=? OR stable_key=?').get(id,id);
  if(!row)throw acquisitionError('信源不存在',{status:404,retry:false});
  return channelView(row);
}
export function checkpointFor(w,id,partition='default') {return JSON.parse(w.db.prepare('SELECT state_json FROM acquisition_checkpoints WHERE channel_id=? AND partition_key=?').get(id,partition)?.state_json||'{}');}
export function assertLease(w,job) {
  if(!job)return;
  if(!w.db.prepare("SELECT id FROM local_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_owner=? AND lease_expires_at>=?").get(job.id,job.leaseToken,job.leaseOwner,stamp()))throw acquisitionError('任务已取消或租约失效，拒绝提交',{retry:false});
}
function identityOf(item) {
  // Article URL identities cross providers; platform discussions keep their own identity.
  if(item.sourceKind==='article'&&item.url&&!['arxiv'].includes(item.platform))return `url:${canonicalSourceUrl(item.url)}`;
  const identity=String(item.identity||'');
  if(!identity||identity.length>4000)throw acquisitionError('条目缺少稳定身份',{retry:false});
  return identity;
}
function placeholder(w,identity,channel) {
  if(!identity)return null;
  const old=w.db.prepare('SELECT source_id FROM acquisition_aliases WHERE identity=?').get(identity);
  if(old)return old.source_id;
  const id=createUlid(),at=stamp();
  w.db.prepare(`INSERT INTO intel_sources(id,fingerprint,data_json,created_at,origin_kind,source_kind,channel_id,acquisition_identity,content_status,rights_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,contentHash(identity),encode({title:'上下文待补齐',body:'',provider:channel.platform,readLevel:'summary',platform:channel.platform}),at,'external','comment',channel.id,identity,'context_missing',encode({aiAllowed:false,exportAllowed:false}),at);
  w.db.prepare('INSERT INTO acquisition_aliases(identity,source_id) VALUES(?,?)').run(identity,id);
  return id;
}
function upsertItem(w,channel,item,at) {
  const identity=identityOf(item),alias=item.identity,canonical=canonicalSourceUrl(item.url);
  if(w.db.prepare('SELECT identity FROM acquisition_tombstones WHERE identity IN (?,?)').get(identity,alias||identity))return {skipped:1};
  let row=w.db.prepare('SELECT s.* FROM intel_sources s JOIN acquisition_aliases a ON a.source_id=s.id WHERE a.identity IN (?,?) LIMIT 1').get(identity,alias||identity);
  row ||= w.db.prepare('SELECT * FROM intel_sources WHERE acquisition_identity=?').get(identity);
  if(!row && item.sourceKind==='article' && canonical) row=w.db.prepare("SELECT * FROM intel_sources WHERE canonical_url=? AND source_kind<>'comment' AND origin_kind='external' AND acquisition_identity IS NULL ORDER BY created_at LIMIT 1").get(canonical);
  if(row && item.contentStatus==='context_missing' && row.content_status==='full_text' && !row.deleted_at) {
    w.db.prepare('INSERT INTO source_discoveries(source_id,channel_id,discovery_key,metadata_json,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source_id,channel_id,discovery_key) DO UPDATE SET last_seen_at=excluded.last_seen_at').run(row.id,channel.id,'context',encode({contextOnly:true}),at,at);
    return {id:row.id,duplicates:1};
  }
  const id=row?.id||createUlid(), previous=row?JSON.parse(row.data_json):null;
  if(previous?.metadata?.upstreamCommitAt && item.metadata?.upstreamCommitAt && previous.metadata.upstreamCommitAt>item.metadata.upstreamCommitAt) {
    const historical={title:item.title||'',body:String(item.body||item.summary||''),url:item.url||'',author:item.author||'',metadata:item.metadata,readLevel:item.readLevel};
    const digest=contentHash(encode(historical)),versionId=createUlid();
    const inserted=w.db.prepare('INSERT OR IGNORE INTO acquisition_source_versions(id,source_id,content_hash,data_json,observed_at) VALUES(?,?,?,?,?)').run(versionId,id,digest,encode(historical),at).changes;
    if(inserted)for(let start=0,ordinal=0;start<historical.body.length;start+=8000,ordinal++)w.db.prepare('INSERT INTO acquisition_segments(version_id,ordinal,start_offset,end_offset) VALUES(?,?,?,?)').run(versionId,ordinal,start,Math.min(historical.body.length,start+8000));
    return {id,duplicates:1};
  }
  const restricted=channel.platform==='reddit';
  const rights={...item.rights,aiAllowed:restricted?item.rights?.aiAllowed===true&&channel.access_status==='approved':channel.options.aiAllowed===true,exportAllowed:!restricted&&channel.options.exportAllowed===true};
  let body=String(item.body||item.summary||'');
  if(Buffer.byteLength(body)>30*1024*1024)throw acquisitionError('单份原文超过存储预算',{retry:false});
  const full=['original','full_text'].includes(item.readLevel)||item.contentStatus==='full_text';
  // A later summary discovery must not replace an already acquired full text.
  const preserve=previous?.readLevel==='original'&&!full&&row.content_status==='full_text';
  if(preserve)body=previous.body;
  const data={...previous,title:String(item.title||previous?.title||'未命名资料').slice(0,500),body,url:item.url||previous?.url||'',provider:channel.platform||'acquisition',platform:item.platform||channel.platform,platformId:item.platformId||null,publishedAt:item.publishedAt||previous?.publishedAt||null,author:String(item.author||previous?.author||''),readLevel:preserve||full?'original':'summary',contentKind:item.sourceKind,metadata:{...previous?.metadata,...item.metadata},acquisition:true};
  if(item.metadata?.originalPublishedAt!==undefined)data.publishedAt=item.metadata.originalPublishedAt;
  const firsts=[previous?.metadata?.upstreamFirstSeenAt,item.metadata?.upstreamFirstSeenAt].filter(t=>t&&Number.isFinite(Date.parse(t))).sort();
  if(firsts.length)data.metadata.upstreamFirstSeenAt=firsts[0];
  const status=preserve?'full_text':item.contentStatus==='context_missing'?'context_missing':full?'full_text':body.trim()?'summary_only':'metadata';
  Object.assign(data,publisherIdentity(data,[{channelName:channel.name,channelUrl:channel.url,siteUrl:channel.site_url,sourceGroup:channel.source_group}]));
  const contentDigest=contentHash(encode({title:data.title,body:data.body,author:data.author,readLevel:data.readLevel}));
  const parent=placeholder(w,item.parentIdentity,channel),root=item.rootIdentity===identity?id:placeholder(w,item.rootIdentity,channel);
  const expires=restricted?new Date(Date.now()+48*3600000).toISOString():null;
  const own=w.db.prepare('SELECT id FROM drafts WHERE body_markdown=? AND length(body_markdown)>=40 LIMIT 1').get(body);
  const origin=own?'internal':'external';
  if(restricted && previous?.author && !data.author) {
    w.db.prepare("UPDATE acquisition_source_versions SET data_json=json_set(data_json,'$.author','') WHERE source_id=?").run(id);
    w.db.prepare("DELETE FROM acquisition_snapshots WHERE channel_id IN (SELECT id FROM intel_channels WHERE platform='reddit')").run();
  }
  if(!row)w.db.prepare(`INSERT INTO intel_sources(id,fingerprint,data_json,created_at,origin_kind,origin_ref,channel_id,source_kind,parent_item_id,root_item_id,provenance_group_key,canonical_url,publisher_key,content_hash,acquisition_identity,content_status,rights_json,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,contentHash(identity),encode(data),at,origin,own?`draft:${own.id}`:null,channel.id,item.sourceKind||'article',parent,root,root||canonical||identity,canonical,item.metadata?.publisher|| (canonical?new URL(canonical).hostname:channel.platform),contentHash(body),identity,status,encode(rights),expires,at);
  else w.db.prepare(`UPDATE intel_sources SET data_json=?,origin_kind=?,origin_ref=?,source_kind=?,parent_item_id=COALESCE(?,parent_item_id),root_item_id=COALESCE(?,root_item_id),provenance_group_key=?,canonical_url=?,content_hash=?,acquisition_identity=?,content_status=?,rights_json=?,expires_at=?,updated_at=?,deleted_at=NULL WHERE id=?`).run(encode(data),origin,own?`draft:${own.id}`:row.origin_ref,item.sourceKind||row.source_kind,parent,root,root||canonical||identity,canonical,contentHash(body),identity,status,encode(rights),expires,at,id);
  for(const key of new Set([identity,alias].filter(Boolean)))w.db.prepare('INSERT OR IGNORE INTO acquisition_aliases(identity,source_id) VALUES(?,?)').run(key,id);
  let version=w.db.prepare('SELECT id,data_json FROM acquisition_source_versions WHERE source_id=? AND content_hash=?').get(id,contentDigest);
  if(version?.data_json==='{}') {
    w.db.prepare('UPDATE acquisition_source_versions SET data_json=?,observed_at=? WHERE id=?').run(encode(data),at,version.id);
    for(let start=0,ordinal=0;start<body.length;start+=8000,ordinal++)w.db.prepare('INSERT OR IGNORE INTO acquisition_segments(version_id,ordinal,start_offset,end_offset) VALUES(?,?,?,?)').run(version.id,ordinal,start,Math.min(body.length,start+8000));
  }
  const changed=!version||Boolean(row?.deleted_at);
  if(!version){version={id:createUlid()};w.db.prepare('INSERT INTO acquisition_source_versions(id,source_id,content_hash,data_json,observed_at) VALUES(?,?,?,?,?)').run(version.id,id,contentDigest,encode(data),at);
    // Offsets refer to this exact immutable version; no duplicate source/evidence rows.
    for(let start=0,ordinal=0;start<body.length;start+=8000,ordinal++)w.db.prepare('INSERT INTO acquisition_segments(version_id,ordinal,start_offset,end_offset) VALUES(?,?,?,?)').run(version.id,ordinal,start,Math.min(body.length,start+8000));
  }
  w.db.prepare('UPDATE intel_sources SET current_version_id=? WHERE id=?').run(version.id,id);
  const buckets=item.metadata?.sortBuckets||item.metadata?.sort_buckets||[item.metadata?.sortBucket||channel.stream||'feed'];
  for(const bucket of Array.isArray(buckets)?buckets:[buckets])w.db.prepare(`INSERT INTO source_discoveries(source_id,channel_id,discovery_key,metadata_json,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source_id,channel_id,discovery_key) DO UPDATE SET metadata_json=excluded.metadata_json,last_seen_at=excluded.last_seen_at,selected=1`).run(id,channel.id,String(bucket),encode({identity:alias||identity,url:item.url,...item.metadata}),at,at);
  if(item.metadata?.metrics)w.db.prepare('INSERT OR IGNORE INTO acquisition_observations(id,channel_id,source_id,observation_key,data_json,observed_at) VALUES(?,?,?,?,?,?)').run(createUlid(),channel.id,id,identity,encode(item.metadata.metrics),at);
  return {id,new:!row?1:0,updated:row&&changed?1:0,duplicates:row&&!changed?1:0,summary:status==='summary_only'?1:0};
}
export function commitPage(w,channel,page,{job,runId,failBeforeCheckpoint}={}) {
  return w.db.transaction(()=>{
    assertLease(w,job);
    if(job)channel=getChannel(w,channel.id);
    const at=stamp(),stats={found:page.items?.length||0,parsed:0,new:0,updated:0,duplicates:0,summary:0,skipped:0};
    const ids=[];
    for(const item of page.items||[]){
      if(item.deleted===true||item.metadata?.deleted===true){const row=w.db.prepare('SELECT source_id FROM acquisition_aliases WHERE identity=?').get(item.identity);if(row)redactSource(w,row.source_id,'upstream_deleted');continue;}
      const result=upsertItem(w,channel,item,at);for(const key of Object.keys(stats))stats[key]+=Number(result[key]||0);stats.parsed++;if(result.id){ids.push(result.id);
        if(runId&&w.db.pragma('user_version',{simple:true})>=30)w.db.prepare(`INSERT INTO acquisition_run_items(run_id,source_id,stream,outcome,observed_at) VALUES(?,?,?,?,?) ON CONFLICT(run_id,source_id,stream) DO UPDATE SET outcome=CASE WHEN acquisition_run_items.outcome='inserted' THEN 'inserted' WHEN excluded.outcome='updated' THEN 'updated' ELSE acquisition_run_items.outcome END,observed_at=excluded.observed_at`).run(runId,result.id,item.metadata?.stream||channel.stream,result.new?'inserted':result.updated?'updated':'duplicate',at);
        }
    }
    for(const identity of page.removals||[]){
      const key=typeof identity==='string'?identity:identity.identity;
      const row=w.db.prepare('SELECT source_id FROM acquisition_aliases WHERE identity=?').get(key);
      if(row && channel.platform==='reddit')redactSource(w,row.source_id,'upstream_deleted');
      else if(row)w.db.prepare('UPDATE source_discoveries SET selected=0 WHERE source_id=? AND channel_id=?').run(row.source_id,channel.id);
    }
    for(const observation of page.observations||[])w.db.prepare('INSERT OR IGNORE INTO acquisition_observations(id,channel_id,observation_key,data_json,observed_at) VALUES(?,?,?,?,?)').run(createUlid(),channel.id,String(observation.identity||observation.id||contentHash(encode(observation))),encode(observation),at);
    failBeforeCheckpoint?.();
    const previous=checkpointFor(w,channel.id,page.partition||'default');
    const state={...previous,...(page.checkpoint||{}),...(page.state?{upstream:page.state}:{})};
    w.db.prepare('INSERT INTO acquisition_checkpoints(channel_id,partition_key,state_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(channel_id,partition_key) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').run(channel.id,page.partition||'default',encode(state),at);
    for(const snapshot of page.snapshots||[])w.db.prepare('UPDATE acquisition_snapshots SET applied_at=? WHERE id=?').run(at,typeof snapshot==='string'?snapshot:snapshot.id);
    w.db.prepare('UPDATE intel_channels SET last_ingest_at=?,last_changed_at=CASE WHEN ?>0 THEN ? ELSE last_changed_at END,last_stats_json=? WHERE id=?').run(at,stats.new+stats.updated,at,encode(stats),channel.id);
    if(runId)w.db.prepare('UPDATE acquisition_runs SET checkpoint_after_json=?,stats_json=?,coverage_json=?,outcome=? WHERE id=?').run(encode(state),encode(stats),encode(page.coverage||{}),page.outcome||'success',runId);
    return {...stats,ids};
  })();
}

export function redactSource(w,id,reason='retention_expired',{tombstone=true}={}) {
  const row=w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(id);if(!row)return;
  const at=stamp();
  if(tombstone)for(const alias of w.db.prepare('SELECT identity FROM acquisition_aliases WHERE source_id=?').all(id))w.db.prepare('INSERT OR REPLACE INTO acquisition_tombstones(identity,reason,deleted_at) VALUES(?,?,?)').run(alias.identity,reason,at);
  w.db.prepare("UPDATE intel_sources SET data_json=?,content_status=?,deleted_at=?,rights_json='{}',canonical_url='',publisher_key='',origin_ref=NULL WHERE id=?").run(encode({title:'内容已移除',body:'',url:'',author:'',provider:'reddit',readLevel:'summary',acquisition:true}),reason,at,id);
  w.db.prepare("UPDATE acquisition_source_versions SET data_json='{}' WHERE source_id=?").run(id);
  w.db.prepare('DELETE FROM acquisition_segments WHERE version_id IN (SELECT id FROM acquisition_source_versions WHERE source_id=?)').run(id);
  w.db.prepare("UPDATE source_discoveries SET metadata_json='{}' WHERE source_id=?").run(id);
  w.db.prepare("DELETE FROM acquisition_observations WHERE source_id=?").run(id);
  // Restricted content cannot be exported to captures; old derived intelligence still needs scrubbing.
  for(const table of ['intel_cards','intel_briefs','intel_brief_versions']) {
    for(const record of w.db.prepare(`SELECT rowid AS rid,data_json FROM ${table} WHERE data_json LIKE ?`).all(`%${id}%`)) {
      const data=JSON.parse(record.data_json);data.evidence=(data.evidence||[]).filter(e=>e.sourceId!==id);
      for(const field of ['body','summary','technical','claims','title','coreClaim'])if(field in data)data[field]=Array.isArray(data[field])?[]:'引用内容已移除，需重新核查';
      data.editorialState='needs_review';
      w.db.prepare(`UPDATE ${table} SET data_json=? WHERE rowid=?`).run(encode(data),record.rid);
    }
  }
  // A raw response may contain multiple Reddit objects; purge the restricted cache as a unit.
  w.db.prepare("DELETE FROM acquisition_snapshots WHERE channel_id IN (SELECT id FROM intel_channels WHERE platform='reddit')").run();
}
export function cleanupAcquisition(w,{now=new Date(),backup=false}={}) {
  if(w.db.pragma('user_version',{simple:true})<29)return;
  return w.db.transaction(()=>{
    const ids=w.db.prepare(`SELECT id FROM intel_sources WHERE acquisition_identity IS NOT NULL AND deleted_at IS NULL AND (expires_at<=? ${backup?"OR json_extract(data_json,'$.platform')='reddit' OR json_extract(rights_json,'$.exportAllowed') IS NOT 1":''})`).all(now.toISOString());
    for(const {id} of ids)redactSource(w,id,backup?'backup_restricted':'retention_expired',{tombstone:false});
    w.db.prepare('DELETE FROM acquisition_snapshots WHERE expires_at<=?').run(now.toISOString());
    if(backup)w.db.exec('DELETE FROM acquisition_snapshots; DELETE FROM acquisition_locks;');
    return {redacted:ids.length};
  })();
}
export function acquisitionOverview(w) {
  return {channels:w.db.prepare('SELECT * FROM intel_channels ORDER BY source_group,name').all().map(r=>({...channelView(r),lastSuccessAt:r.last_success_at,latencyMs:w.db.pragma('user_version',{simple:true})>=30?(()=>{const x=w.db.prepare('SELECT started_at,finished_at FROM acquisition_runs WHERE channel_id=? AND finished_at IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(r.id);return x?Date.parse(x.finished_at)-Date.parse(x.started_at):null;})():null,healthStatus:w.db.pragma('user_version',{simple:true})>=30?w.db.prepare('SELECT health_status FROM acquisition_runs WHERE channel_id=? ORDER BY created_at DESC LIMIT 1').get(r.id)?.health_status:null})),runs:w.db.prepare('SELECT r.*,j.status AS job_status,j.attempt,j.due_at FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id ORDER BY r.created_at DESC LIMIT 100').all().map(r=>({...r,stats:JSON.parse(r.stats_json),coverage:JSON.parse(r.coverage_json)}))};
}
export function acquisitionSourceDetails(w,id) {
  const row=w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(id);if(!row)throw acquisitionError('资料不存在',{status:404});
  const unavailable=row.deleted_at||(row.expires_at&&Date.parse(row.expires_at)<=Date.now());
  return {bodyDelivery:w.db.prepare("SELECT r.id,r.status,r.error,r.finished_at FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id WHERE r.kind='fulltext' AND json_extract(j.payload_json,'$.sourceId')=? ORDER BY r.created_at DESC LIMIT 1").get(id)||null,source:{...sourceFromRow(row),...publisherIdentity(sourceFromRow(row),w.db.prepare('SELECT c.name AS channelName,c.url AS channelUrl,c.site_url AS siteUrl,c.source_group AS sourceGroup FROM source_discoveries d JOIN intel_channels c ON c.id=d.channel_id WHERE d.source_id=?').all(id)),firstSeenAt:row.created_at,lastSeenAt:row.updated_at,upstreamFirstSeenAt:JSON.parse(row.data_json).metadata?.upstreamFirstSeenAt||null,...(!unavailable && w.db.pragma('user_version',{simple:true})>=32?{processing:processingFor(w,sourceFromRow(row))}:{})},discoveries:unavailable?[]:w.db.prepare('SELECT d.*,c.name,c.source_group AS sourceGroup,c.stream,c.platform FROM source_discoveries d JOIN intel_channels c ON c.id=d.channel_id WHERE source_id=?').all(id),runs:w.db.pragma('user_version',{simple:true})>=30?w.db.prepare('SELECT i.run_id AS runId,r.batch_id AS batchId,i.outcome AS dedupResult,i.stream,i.observed_at AS collectedAt FROM acquisition_run_items i JOIN acquisition_runs r ON r.id=i.run_id WHERE i.source_id=? ORDER BY i.observed_at DESC LIMIT 30').all(id):[],segments:unavailable?[]:w.db.prepare('SELECT * FROM acquisition_segments WHERE version_id=? ORDER BY ordinal').all(row.current_version_id),comments:w.db.prepare("SELECT * FROM intel_sources WHERE root_item_id=? OR parent_item_id=? ORDER BY created_at LIMIT 150").all(row.root_item_id||id,id).map(sourceFromRow)};
}
