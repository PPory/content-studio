// Reprocess existing local evidence only. No upstream requests or model calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadEnv } from 'vite';
import Database from 'better-sqlite3';
import { resolveWorkspacePaths } from '../server/storage/workspace-paths.mjs';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { processReview, reviewOverview, materialProjection } from '../server/acquisition/review.mjs';

if(!process.argv.includes('--confirmed'))throw Error('Use --confirmed after authorizing local derived-data reprocessing. Original content is retained.');
const env={...loadEnv('development',process.cwd(),''),...process.env},paths=resolveWorkspacePaths({env});
const read=new Database(paths.databaseFile,{readonly:true,fileMustExist:true});
const original=new Map(read.prepare('SELECT id,data_json FROM intel_sources WHERE deleted_at IS NULL').all().map(r=>[r.id,createHash('sha256').update(JSON.parse(r.data_json).body||'').digest('hex')]));
await fs.mkdir(path.join(paths.backupsDir,'Migration-Points'),{recursive:true});
const backup=path.join(paths.backupsDir,'Migration-Points',`before-ai-reading-${Date.now()}.sqlite`);
await read.backup(backup);read.close();const verify=new Database(backup,{readonly:true});assert.equal(verify.pragma('integrity_check',{simple:true}),'ok');verify.close();
await fs.writeFile(backup+'.json',JSON.stringify({sha256:createHash('sha256').update(await fs.readFile(backup)).digest('hex'),at:new Date().toISOString(),purpose:'before local AI reading reprocessing'}));
const w=await openWorkspace({xenhoHome:paths.root});
try{
 const first=await processReview(w,env,{confirmed:true,semantic:false});
 const versions=w.db.prepare('SELECT count(*) n FROM acquisition_source_versions').get().n;
 const second=await processReview(w,env,{confirmed:true,semantic:false});
 assert.equal(w.db.prepare('SELECT count(*) n FROM acquisition_source_versions').get().n,versions);
 assert.equal(second.stats.pending,first.stats.pending);assert.equal(second.stats.clusters,first.stats.clusters);
 for(const [id,digest] of original){const r=w.db.prepare('SELECT data_json FROM intel_sources WHERE id=?').get(id);assert.ok(r);assert.equal(createHash('sha256').update(JSON.parse(r.data_json).body||'').digest('hex'),digest,`original bytes ${id}`);}
 const summarize=s=>({id:s.id,title:s.title,url:s.url,author:s.author,publishedAt:s.publishedAt,upstreamFirstSeenAt:s.upstreamFirstSeenAt,firstSeenAt:s.firstSeenAt,lastSeenAt:s.lastSeenAt,relevance:s.processing.relevance,reason:s.processing.reason,evidence:s.processing.evidence,readability:s.processing.readability,guideKind:s.processing.guideKind,rights:s.rights,discoveries:s.discoveries.map(d=>({channelName:d.channelName,sourceGroup:d.sourceGroup,stream:d.stream,firstSeenAt:d.first_seen_at})),bodyCharacters:Array.from(s.body||'').length});
 const materials=materialProjection(w),scopes={};for(const scope of ['unreviewed','deep','not_ai','needs_context','unreadable']){
  const p=reviewOverview(w,{scope,limit:50}),bySource=new Map(p.clusters.flatMap(c=>c.items.map(s=>[s.id,c])));
  const selected=scope==='deep'?p.clusters.flatMap(c=>c.items):materials.filter(s=>scope==='unreviewed'?s.processing.relevance==='ai_relevant'&&s.processing.readable:scope==='unreadable'?!s.processing.readable:s.processing.relevance===scope);
  scopes[scope]={count:p.total,samples:selected.map(s=>({...summarize(s),clusterId:bySource.get(s.id)?.id||w.db.prepare('SELECT cluster_id FROM acquisition_review_members WHERE source_id=?').get(s.id)?.cluster_id,clusterTitle:bySource.get(s.id)?.title})).sort((a,b)=>Number(b.discoveries.some(d=>d.sourceGroup==='follow_builders'))-Number(a.discoveries.some(d=>d.sourceGroup==='follow_builders'))).slice(0,12)};
 }
 const report={at:new Date().toISOString(),database:paths.databaseFile,recoveryPoint:backup,ruleVersion:first.ruleVersion,stats:second.stats,replayed:first.replayed,modelCalls:first.modelCalls+second.modelCalls,permissionRequired:first.permissionRequired,verified:{originalBodiesUnchanged:original.size,reprocessingDoesNotCreateVersions:true,pendingSurvivesUnchangedSha:true},scopes};
 const output=path.resolve('../output/acquisition/ai-reading-acceptance.json');await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,scopes:Object.fromEntries(Object.entries(scopes).map(([k,v])=>[k,{count:v.count,samples:v.samples.slice(0,3)}])),output},null,2));
}finally{w.close();}
