import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { atomicWrite } from '../lib/safe-write.mjs';

const quote=name=>'"'+String(name).replaceAll('"','""')+'"';
const exists=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const count=(db,table,where='1=1',...args)=>exists(db,table)?db.prepare(`SELECT count(*) n FROM ${quote(table)} WHERE ${where}`).get(...args).n:0;
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const userTables=['projects','drafts','project_notebooks','wiki_pages','captures','seeds','materials','personal_assets','researches','books','book_documents','book_marks','knowledge_items','content_series','entity_text','ai_conversations','ai_messages','audience_raw_sources'];

function ids(db){return new Set(db.prepare('SELECT id FROM intel_sources WHERE acquisition_identity IS NOT NULL').all().map(row=>row.id));}
function evidenceIds(data){return (Array.isArray(data?.evidence)?data.evidence:[]).map(item=>item?.sourceId).filter(Boolean);}
function protectedBrief(db,row){return Boolean(row.saved||row.helpful||count(db,'intel_brief_researches','brief_id=?',row.id)||count(db,'intel_feedback','brief_id=? AND value=1',row.id));}
function briefPlan(db,sourceIds){
  const deleted=[],preserved=[];
  for(const row of db.prepare('SELECT * FROM intel_briefs').all()){
    const refs=evidenceIds(parse(row.data_json)),affected=refs.some(id=>sourceIds.has(id));if(!affected)continue;
    if(refs.length&&refs.every(id=>sourceIds.has(id))&&!protectedBrief(db,row))deleted.push(row.id);else preserved.push(row.id);
  }
  return {deleted,preserved};
}
function affectedJsonRows(db,table,sourceIds){
  if(!exists(db,table))return [];
  return db.prepare(`SELECT rowid AS rid,* FROM ${quote(table)}`).all().filter(row=>{const text=row.data_json||'';for(const id of sourceIds)if(text.includes(id))return true;return false;});
}
function scrub(value,sourceIds,note='source baseline reset'){
  const data=structuredClone(value&&typeof value==='object'?value:{});
  if(Array.isArray(data.evidence))data.evidence=data.evidence.filter(item=>!sourceIds.has(item?.sourceId));
  for(const key of ['sourceIds','sources'])if(Array.isArray(data[key]))data[key]=data[key].filter(item=>!sourceIds.has(typeof item==='string'?item:item?.id));
  data.editorialState='needs_review';data.resetNote=note;
  return data;
}

export function inspectAcquisitionBaseline(db){
  if(!db?.open)throw new TypeError('数据库未打开');
  const sourceIds=ids(db),briefs=briefPlan(db,sourceIds);
  const affectedProblems=exists(db,'audience_problem_sources')?db.prepare(`SELECT DISTINCT problem_id FROM audience_problem_sources WHERE source_id IN (SELECT id FROM intel_sources WHERE acquisition_identity IS NOT NULL)`).all().map(row=>row.problem_id):[];
  const opportunities=affectedProblems.length&&exists(db,'content_opportunities')?db.prepare(`SELECT count(*) n FROM content_opportunities WHERE audience_problem_id IN (${affectedProblems.map(()=>'?').join(',')})`).get(...affectedProblems).n:0;
  const activeJobs=count(db,'local_jobs',"kind LIKE 'acquisition.%' AND status IN ('queued','retry','running')");
  const acquisition={sources:sourceIds.size,batches:count(db,'acquisition_batches'),runs:count(db,'acquisition_runs'),runItems:count(db,'acquisition_run_items'),checkpoints:count(db,'acquisition_checkpoints'),snapshots:count(db,'acquisition_snapshots'),sourceVersions:count(db,'acquisition_source_versions'),segments:count(db,'acquisition_segments'),discoveries:count(db,'source_discoveries'),aliases:count(db,'acquisition_aliases'),observations:count(db,'acquisition_observations'),tombstones:count(db,'acquisition_tombstones'),locks:count(db,'acquisition_locks'),networkBudget:count(db,'acquisition_network_budget'),jobs:count(db,'local_jobs',"kind LIKE 'acquisition.%'"),activeJobs};
  return {dryRun:true,generatedAt:new Date().toISOString(),acquisition,derivatives:{autoBriefsToDelete:briefs.deleted.length,savedBriefsToPreserve:briefs.preserved.length,cardsToPreserve:affectedJsonRows(db,'intel_cards',sourceIds).length,reportsToPreserve:affectedJsonRows(db,'intel_reports',sourceIds).length,opportunitiesToPreserve:opportunities,affectedAudienceProblems:affectedProblems.length},userAssets:Object.fromEntries(userTables.map(table=>[table,count(db,table)])),policy:{sourceScope:'intel_sources.acquisition_identity IS NOT NULL',ambiguousDerivatives:'preserve_and_mark_needs_review',foreignKeys:'remain_enabled'}};
}

function assertKnownSourceReferences(db){
  const known=new Set(['intel_sources','intel_run_sources','intel_clusters','intel_cluster_members','acquisition_source_versions','source_discoveries','acquisition_aliases','acquisition_observations','acquisition_run_items']);
  const unknown=[];
  for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())for(const fk of db.pragma(`foreign_key_list(${quote(name)})`))if(fk.table==='intel_sources'&&!known.has(name))unknown.push(`${name}.${fk.from}`);
  if(unknown.length)throw new Error(`发现未审计的 intel_sources 外键，拒绝 reset：${unknown.join(', ')}`);
}

export function resetAcquisitionBaseline(workspace){
  const db=workspace?.db;if(!db?.open)throw new TypeError('工作区未打开');assertKnownSourceReferences(db);
  const before=inspectAcquisitionBaseline(db);if(before.acquisition.activeJobs)throw new Error(`仍有 ${before.acquisition.activeJobs} 个 acquisition 任务在运行或排队，拒绝 reset`);
  const sourceIds=ids(db),briefs=briefPlan(db,sourceIds),beforeUsers=before.userAssets;
  const result=db.transaction(()=>{
    for(const id of briefs.preserved){const row=db.prepare('SELECT data_json FROM intel_briefs WHERE id=?').get(id);db.prepare('UPDATE intel_briefs SET data_json=?,editorial_state=? WHERE id=?').run(JSON.stringify(scrub(parse(row.data_json),sourceIds)),'needs_review',id);for(const version of db.prepare('SELECT rowid AS rid,data_json FROM intel_brief_versions WHERE brief_id=?').all(id))db.prepare('UPDATE intel_brief_versions SET data_json=? WHERE rowid=?').run(JSON.stringify(scrub(parse(version.data_json),sourceIds)),version.rid);}
    for(const table of ['intel_cards','intel_reports'])for(const row of affectedJsonRows(db,table,sourceIds)){const data=scrub(parse(row.data_json),sourceIds);if(table==='intel_cards'){data.briefIds=(data.briefIds||[]).filter(id=>!briefs.deleted.includes(id));db.prepare('UPDATE intel_cards SET data_json=?,readiness=? WHERE rowid=?').run(JSON.stringify(data),'untriaged',row.rid);}else db.prepare('UPDATE intel_reports SET data_json=? WHERE rowid=?').run(JSON.stringify(data),row.rid);}
    if(briefs.deleted.length){const marks=briefs.deleted.map(()=>'?').join(',');db.prepare(`UPDATE intel_cards SET brief_id=NULL WHERE brief_id IN (${marks})`).run(...briefs.deleted);db.prepare(`DELETE FROM intel_feedback WHERE brief_id IN (${marks})`).run(...briefs.deleted);db.prepare(`DELETE FROM intel_brief_researches WHERE brief_id IN (${marks})`).run(...briefs.deleted);db.prepare(`DELETE FROM intel_brief_versions WHERE brief_id IN (${marks})`).run(...briefs.deleted);db.prepare(`DELETE FROM intel_briefs WHERE id IN (${marks})`).run(...briefs.deleted);}
    if(sourceIds.size){
      db.exec('CREATE TEMP TABLE IF NOT EXISTS baseline_reset_sources(id TEXT PRIMARY KEY); DELETE FROM baseline_reset_sources;');const insert=db.prepare('INSERT INTO baseline_reset_sources(id) VALUES(?)');for(const id of sourceIds)insert.run(id);
      if(exists(db,'audience_problem_sources'))db.exec('CREATE TEMP TABLE IF NOT EXISTS baseline_reset_problems(id TEXT PRIMARY KEY); DELETE FROM baseline_reset_problems; INSERT OR IGNORE INTO baseline_reset_problems SELECT problem_id FROM audience_problem_sources WHERE source_id IN (SELECT id FROM baseline_reset_sources);');
     if(exists(db,'content_opportunities'))db.prepare("UPDATE content_opportunities SET planning_json=json_set(planning_json,'$.editorialState','needs_review','$.resetNote','source baseline reset'),readiness='untriaged' WHERE audience_problem_id IN (SELECT id FROM audience_problems WHERE source_ref IN (SELECT id FROM baseline_reset_sources)) OR audience_problem_id IN (SELECT id FROM baseline_reset_problems)").run();
     if(exists(db,'audience_problem_sources'))db.prepare("DELETE FROM audience_problem_sources WHERE source_id IN (SELECT id FROM baseline_reset_sources)").run();
      if(exists(db,'audience_problems'))db.prepare("UPDATE audience_problems SET source_kind='manual',source_ref='source baseline reset',summary=CASE WHEN instr(summary,'source baseline reset')>0 THEN summary ELSE trim(summary || char(10) || char(10) || 'source baseline reset: source evidence removed; needs review') END WHERE id IN (SELECT id FROM baseline_reset_problems) OR source_ref IN (SELECT id FROM baseline_reset_sources)").run();
      db.prepare('DELETE FROM acquisition_run_items WHERE source_id IN (SELECT id FROM baseline_reset_sources)').run();
      db.prepare('DELETE FROM acquisition_segments WHERE version_id IN (SELECT id FROM acquisition_source_versions WHERE source_id IN (SELECT id FROM baseline_reset_sources))').run();
      db.prepare('DELETE FROM acquisition_source_versions WHERE source_id IN (SELECT id FROM baseline_reset_sources)').run();
      db.prepare('DELETE FROM source_discoveries WHERE source_id IN (SELECT id FROM baseline_reset_sources)').run();
      db.prepare('DELETE FROM acquisition_aliases WHERE source_id IN (SELECT id FROM baseline_reset_sources)').run();
      db.prepare('DELETE FROM acquisition_observations WHERE source_id IN (SELECT id FROM baseline_reset_sources)').run();
      db.prepare('DELETE FROM intel_cluster_members WHERE source_id IN (SELECT id FROM baseline_reset_sources)').run();
      db.prepare('UPDATE intel_clusters SET primary_source_id=NULL WHERE primary_source_id IN (SELECT id FROM baseline_reset_sources)').run();
      db.prepare('DELETE FROM intel_run_sources WHERE source_id IN (SELECT id FROM baseline_reset_sources)').run();
      db.prepare('UPDATE intel_sources SET revision_of_id=NULL WHERE revision_of_id IN (SELECT id FROM baseline_reset_sources)').run();
      db.prepare('DELETE FROM intel_sources WHERE id IN (SELECT id FROM baseline_reset_sources)').run();
      if(exists(db,'audience_problem_sources'))db.exec('DROP TABLE baseline_reset_problems');
      db.exec('DROP TABLE baseline_reset_sources');
    }
    const jobIds=exists(db,'acquisition_runs')?db.prepare('SELECT job_id id FROM acquisition_runs').all().map(row=>row.id):[];
    db.exec('DELETE FROM acquisition_run_items; DELETE FROM acquisition_segments; DELETE FROM acquisition_source_versions; DELETE FROM source_discoveries; DELETE FROM acquisition_aliases; DELETE FROM acquisition_observations; DELETE FROM acquisition_snapshots; DELETE FROM acquisition_checkpoints; DELETE FROM acquisition_tombstones; DELETE FROM acquisition_locks; DELETE FROM acquisition_network_budget; DELETE FROM acquisition_runs; DELETE FROM acquisition_batches;');
    const allJobs=new Set([...jobIds,...db.prepare("SELECT id FROM local_jobs WHERE kind LIKE 'acquisition.%'").all().map(row=>row.id)]);if(allJobs.size){const marks=[...allJobs].map(()=>'?').join(',');db.prepare(`DELETE FROM local_job_runs WHERE job_id IN (${marks})`).run(...allJobs);db.prepare(`DELETE FROM local_jobs WHERE id IN (${marks})`).run(...allJobs);}
    db.prepare("UPDATE intel_channels SET last_ingest_at=NULL,last_changed_at=NULL,last_stats_json='{}',next_due_at=NULL,last_item_count=0,last_error='' WHERE adapter NOT IN ('','manual')").run();
    db.prepare('DELETE FROM intel_clusters WHERE primary_source_id IS NULL AND id NOT IN (SELECT DISTINCT cluster_id FROM intel_briefs WHERE cluster_id IS NOT NULL) AND id NOT IN (SELECT DISTINCT cluster_id FROM intel_cards WHERE cluster_id IS NOT NULL)').run();
    const fk=db.pragma('foreign_key_check');if(fk.length)throw new Error(`reset 后外键校验失败：${JSON.stringify(fk.slice(0,5))}`);
    return {briefsDeleted:briefs.deleted.length,briefsPreserved:briefs.preserved.length};
  })();
  const after=inspectAcquisitionBaseline(db),afterUsers=after.userAssets;
  for(const table of userTables)if(beforeUsers[table]!==afterUsers[table])throw new Error(`用户资产数量发生变化：${table}`);
  return {before,after,deleted:{acquisitionSources:before.acquisition.sources,runs:before.acquisition.runs,snapshots:before.acquisition.snapshots,autoBriefs:result.briefsDeleted},preserved:{savedBriefs:result.briefsPreserved,userAssets:afterUsers,cards:before.derivatives.cardsToPreserve,opportunities:before.derivatives.opportunitiesToPreserve}};
}

export async function createAcquisitionRecoveryPoint(paths,{now=new Date()}={}){
  const directory=path.join(paths.backupsDir,'Baseline-Reset');await fs.mkdir(directory,{recursive:true});const token=crypto.randomBytes(4).toString('hex'),file=path.join(directory,`before-acquisition-baseline-${now.toISOString().replace(/[:.]/g,'-')}-${token}.sqlite`);
  const source=new Database(paths.databaseFile,{readonly:true,fileMustExist:true});const sourceCounts=Object.fromEntries(source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({name})=>[name,count(source,name)]));const version=source.pragma('user_version',{simple:true});try{await source.backup(file);}finally{source.close();}
  const restored=new Database(file,{readonly:true,fileMustExist:true});try{if(restored.pragma('integrity_check',{simple:true})!=='ok'||restored.pragma('foreign_key_check').length)throw new Error('baseline reset 恢复点校验失败');for(const [table,total] of Object.entries(sourceCounts))if(count(restored,table)!==total)throw new Error(`恢复点数量不一致：${table}`);}finally{restored.close();}
  const bytes=await fs.readFile(file),manifest={kind:'acquisition-baseline-reset',file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,schemaVersion:version,tableCounts:sourceCounts,integrity:'ok',verifiedAt:new Date().toISOString()};await atomicWrite(file+'.json',`${JSON.stringify(manifest,null,2)}\n`);return manifest;
}

export async function writeBaselineResetReport(paths,name,report){const directory=path.join(paths.backupsDir,'Baseline-Reset');await fs.mkdir(directory,{recursive:true});const file=path.join(directory,name);await atomicWrite(file,`${JSON.stringify(report,null,2)}\n`);return file;}
