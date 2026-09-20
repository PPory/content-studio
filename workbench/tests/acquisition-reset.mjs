import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { resolveWorkspacePaths } from '../server/storage/workspace-paths.mjs';
import { getChannel, commitPage } from '../server/acquisition/store.mjs';
import { enqueueAcquisition } from '../server/acquisition/runner.mjs';
import {
  inspectAcquisitionBaseline,
  resetAcquisitionBaseline,
  createAcquisitionRecoveryPoint,
} from '../server/acquisition/baseline-reset.mjs';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'acquisition-reset-'));
const paths = resolveWorkspacePaths({ xenhoHome: home });
const at = '2026-09-20T00:00:00.000Z';
let workspace;
try {
  workspace = await openWorkspace({ xenhoHome: home });
  const db = workspace.db;
  const channel = getChannel(workspace, 't2.the_decoder');
  const saved = commitPage(workspace, channel, {
    items: [{
      identity: 'reset:source',
      title: 'Acquisition source',
      url: 'https://example.org/reset-source',
      body: 'Source text',
      publishedAt: at,
      sourceKind: 'article',
      platform: 'web',
      rights: { aiAllowed: true, exportAllowed: true },
      metadata: {},
    }],
    checkpoint: {},
    coverage: {},
    outcome: 'success',
  });
  const sourceId = saved.ids[0];
  db.prepare('INSERT INTO intel_sources(id,fingerprint,data_json,created_at) VALUES(?,?,?,?)').run('manual-source','manual-source',JSON.stringify({ title: 'Manual source' }),at);

  db.prepare('INSERT INTO entities(id,entity_type,created_at,updated_at) VALUES(?,?,?,?)').run('capture-user','capture',at,at);
  db.prepare('INSERT INTO captures(id,capture_kind,title,body_markdown,source_url,status,reaction) VALUES(?,?,?,?,?,?,?)').run('capture-user','thought','User capture','Must survive','','accepted','');
  db.prepare('INSERT INTO entities(id,entity_type,created_at,updated_at) VALUES(?,?,?,?)').run('project-user','project',at,at);
  db.prepare('INSERT INTO projects(id,title,brief_markdown,viewpoint,audience,primary_platform,priority,status) VALUES(?,?,?,?,?,?,?,?)').run('project-user','User project','Do not delete','','','','中','active');

  db.prepare('INSERT INTO intel_profiles(id,config_json,created_at,updated_at) VALUES(?,?,?,?)').run('profile-reset','{}',at,at);
  db.prepare('INSERT INTO intel_runs(id,profile_id,config_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('intel-run-reset','profile-reset','{}','completed',at,at);
  const evidence = JSON.stringify({ evidence: [{ sourceId, quote: 'Source text' }] });
  db.prepare('INSERT INTO intel_briefs(id,story_key,run_id,data_json,saved,edition_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('brief-auto','story-auto','intel-run-reset',evidence,0,'2026-09-20',at,at);
  db.prepare('INSERT INTO intel_briefs(id,story_key,run_id,data_json,saved,edition_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('brief-saved','story-saved','intel-run-reset',evidence,1,'2026-09-20',at,at);
  db.prepare('INSERT INTO intel_brief_versions(brief_id,version,run_id,data_json,created_at) VALUES(?,?,?,?,?)').run('brief-auto',1,'intel-run-reset',evidence,at);
  db.prepare('INSERT INTO intel_brief_versions(brief_id,version,run_id,data_json,created_at) VALUES(?,?,?,?,?)').run('brief-saved',1,'intel-run-reset',evidence,at);
  db.prepare('INSERT INTO intel_cards(id,profile_id,fingerprint,run_id,data_json,status,created_at,updated_at,brief_id) VALUES(?,?,?,?,?,?,?,?,?)').run('card-saved','profile-reset','card-reset','intel-run-reset',JSON.stringify({ evidence: [{ sourceId }], briefIds: ['brief-auto'] }),'saved',at,at,'brief-auto');
  db.prepare('INSERT INTO intel_reports(id,fingerprint,data_json,created_at) VALUES(?,?,?,?)').run('report-saved','report-reset',evidence,at);

  db.prepare('INSERT INTO entities(id,entity_type,created_at,updated_at) VALUES(?,?,?,?)').run('wiki-reset','wiki_page',at,at);
  db.prepare('INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,current_revision,schema_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('wiki-reset','Reset page','topic','','Body',1,db.prepare('SELECT max(version) version FROM wiki_schema_versions').get().version,at,at);
  db.prepare('INSERT INTO entities(id,entity_type,created_at,updated_at) VALUES(?,?,?,?)').run('problem-reset','audience_problem',at,at);
  db.prepare('INSERT INTO audience_problems(id,statement,summary,source_kind,source_ref,pattern,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('problem-reset','A grounded audience problem','', 'hotspot',sourceId,'trend','active',at,at);
  db.prepare('INSERT INTO audience_problem_sources(problem_id,source_kind,source_id,evidence_text,observed_at) VALUES(?,?,?,?,?)').run('problem-reset','hotspot',sourceId,'Grounded evidence',at);
  db.prepare('INSERT INTO entities(id,entity_type,created_at,updated_at) VALUES(?,?,?,?)').run('opportunity-reset','content_opportunity',at,at);
  db.prepare('INSERT INTO content_opportunities(id,wiki_page_id,audience_problem_id,core_claim,knowledge_explanation,cognitive_gap,dominant_action,fit,fit_reason,construction_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('opportunity-reset','wiki-reset','problem-reset','Claim','Explanation','Gap','knowledge','strong','Reason','{}','active',at,at);

  const beforeChanges = db.totalChanges;
  const dryRun = inspectAcquisitionBaseline(db);
  assert.equal(db.totalChanges, beforeChanges, 'dry-run inspection must be read-only');
  assert.equal(dryRun.acquisition.sources, 1);
  assert.equal(dryRun.derivatives.autoBriefsToDelete, 1);
  assert.equal(dryRun.derivatives.savedBriefsToPreserve, 1);
  assert.equal(dryRun.derivatives.cardsToPreserve, 1);
  assert.equal(dryRun.derivatives.opportunitiesToPreserve, 1);
  assert.equal(dryRun.userAssets.captures, 1);
  assert.equal(dryRun.userAssets.projects, 1);

  const acquisitionRun = enqueueAcquisition(workspace, channel.id, { slot: 'reset-active-job' });
  assert.throws(() => resetAcquisitionBaseline(workspace), /仍有 1 个 acquisition 任务/);
  db.prepare("UPDATE local_jobs SET status='done' WHERE id=?").run(acquisitionRun.job_id);
  db.prepare("UPDATE acquisition_runs SET status='completed' WHERE id=?").run(acquisitionRun.id);
  workspace.close();
  workspace = null;

  const backup = await createAcquisitionRecoveryPoint(paths, { now: new Date(at) });
  assert.equal(backup.integrity, 'ok');
  assert.equal(backup.sha256, crypto.createHash('sha256').update(await fs.readFile(backup.file)).digest('hex'));
  assert.equal(backup.tableCounts.captures, 1);
  assert.equal(backup.tableCounts.projects, 1);

  workspace = await openWorkspace({ xenhoHome: home });
  const result = resetAcquisitionBaseline(workspace);
  assert.equal(result.deleted.acquisitionSources, 1);
  assert.equal(result.deleted.autoBriefs, 1);
  assert.equal(result.preserved.savedBriefs, 1);
  assert.equal(workspace.db.prepare('SELECT count(*) n FROM intel_sources WHERE acquisition_identity IS NOT NULL').get().n, 0);
  assert.equal(workspace.db.prepare("SELECT count(*) n FROM intel_sources WHERE id='manual-source'").get().n, 1);
  assert.equal(workspace.db.prepare("SELECT count(*) n FROM intel_briefs WHERE id='brief-auto'").get().n, 0);
  const preservedBrief = workspace.db.prepare("SELECT data_json,editorial_state FROM intel_briefs WHERE id='brief-saved'").get();
  assert.equal(preservedBrief.editorial_state, 'needs_review');
  assert.deepEqual(JSON.parse(preservedBrief.data_json).evidence, []);
  const card = workspace.db.prepare("SELECT data_json,brief_id,readiness FROM intel_cards WHERE id='card-saved'").get();
  assert.equal(card.brief_id, null);
  assert.equal(card.readiness, 'untriaged');
  assert.deepEqual(JSON.parse(card.data_json).evidence, []);
  assert.equal(JSON.parse(workspace.db.prepare("SELECT data_json FROM intel_reports WHERE id='report-saved'").get().data_json).editorialState, 'needs_review');
  const opportunity = workspace.db.prepare("SELECT planning_json,readiness FROM content_opportunities WHERE id='opportunity-reset'").get();
  assert.equal(opportunity.readiness, 'untriaged');
 assert.equal(JSON.parse(opportunity.planning_json).editorialState, 'needs_review');
  const problem = workspace.db.prepare("SELECT source_kind,source_ref,summary FROM audience_problems WHERE id='problem-reset'").get();
  assert.equal(problem.source_kind, 'manual');
  assert.equal(problem.source_ref, 'source baseline reset');
  assert(problem.summary.includes('needs review'));
  assert.equal(workspace.db.prepare("SELECT body_markdown FROM captures WHERE id='capture-user'").get().body_markdown, 'Must survive');
  assert.equal(workspace.db.prepare("SELECT brief_markdown FROM projects WHERE id='project-user'").get().brief_markdown, 'Do not delete');
  assert.equal(workspace.db.prepare("SELECT count(*) n FROM local_jobs WHERE kind LIKE 'acquisition.%'").get().n, 0);
  assert.equal(workspace.db.prepare('SELECT count(*) n FROM acquisition_runs').get().n, 0);
  assert.deepEqual(workspace.db.pragma('foreign_key_check'), []);
} finally {
  workspace?.close();
  await fs.rm(home, { recursive: true, force: true });
}

console.log('acquisition baseline reset passed: read-only dry-run, active-job refusal, verified raw backup, scoped deletion and derivative preservation');
