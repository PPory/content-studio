// Only the temporary database is opened writable. Production files are read-only fingerprints.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { resolveWorkspacePaths } from '../server/storage/workspace-paths.mjs';
import { WORKSPACE_MIGRATIONS, WORKSPACE_SCHEMA_VERSION } from '../server/storage/migrations.mjs';
import { getChannel } from '../server/acquisition/store.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xenho-acquisition-migration-'));
const priorHome = process.env.XENHO_HOME;
const production = resolveWorkspacePaths({ xenhoHome: priorHome || undefined });
async function fingerprint(file) { try { return hash(await fs.readFile(file)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
const protectedFiles = [production.databaseFile, production.databaseFile + '-wal', production.manifestFile];
const beforeProduction = await Promise.all(protectedFiles.map(fingerprint));
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const tableCounts = db => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name}) => [name, db.prepare(`SELECT count(*) n FROM ${quote(name)}`).get().n]));
let w, backup;
try {
 process.env.XENHO_HOME = root;
 w = await openWorkspace({ xenhoHome: root, migrations: WORKSPACE_MIGRATIONS.filter(m => m.version <= 28) });
 assert.equal(w.db.pragma('user_version', { simple: true }), 28);
 const body = 'Existing source bytes must survive the acquisition migration without losing references.';
 w.db.prepare("INSERT INTO intel_sources(id,fingerprint,data_json,created_at,origin_kind,source_kind,content_hash) VALUES(?,?,?,?,?,?,?)").run('migration-source-preserved', 'migration-fingerprint', JSON.stringify({ title: 'V2 source', body, url: 'https://example.org/original', provider: 'web', readLevel: 'original' }), new Date().toISOString(), 'external', 'article', hash(body));
 w.db.prepare("UPDATE intel_channels SET enabled=0 WHERE id='channel-importai'").run();
 const beforeSource = w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get('migration-source-preserved');
 const beforeChannel = w.db.prepare("SELECT * FROM intel_channels WHERE id='channel-importai'").get(); assert.ok(beforeChannel);
 const beforeCounts = tableCounts(w.db), beforeManifest = await fs.readFile(w.paths.manifestFile);
 const backupsDir = path.join(w.paths.backupsDir, 'Migration-Points');
 assert.equal((await fs.readdir(backupsDir).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e))).length, 0);
 const databaseFile = w.paths.databaseFile; assert.ok(path.relative(root, databaseFile).startsWith('Workspace'));
 w.close(); w = await openWorkspace({ xenhoHome: root });
 assert.equal(w.db.pragma('user_version', { simple: true }), WORKSPACE_SCHEMA_VERSION);
 const files = await fs.readdir(backupsDir), snapshots = files.filter(f => f.endsWith('.sqlite')); assert.equal(snapshots.length, 1);
 const recoveryFile = path.join(backupsDir, snapshots[0]), manifest = JSON.parse(await fs.readFile(recoveryFile + '.json', 'utf8'));
 assert.equal(manifest.fromVersion, 28); assert.equal(manifest.toVersion, 29); assert.equal(manifest.integrity, 'ok');
 assert.equal(manifest.sha256, hash(await fs.readFile(recoveryFile)));
 backup = new Database(recoveryFile, { readonly: true, fileMustExist: true });
 assert.equal(backup.pragma('user_version', { simple: true }), 28); assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok'); assert.deepEqual(backup.pragma('foreign_key_check'), []);
 assert.deepEqual(tableCounts(backup), beforeCounts, 'every pre-migration table count must match the recovery point');
 assert.deepEqual(backup.prepare('SELECT * FROM intel_sources WHERE id=?').get(beforeSource.id), beforeSource);
 assert.deepEqual(backup.prepare('SELECT * FROM intel_channels WHERE id=?').get(beforeChannel.id), beforeChannel);
 const migrated = w.db.prepare('SELECT * FROM intel_sources WHERE id=?').get(beforeSource.id);
 assert.equal(migrated.id, beforeSource.id); assert.equal(migrated.data_json, beforeSource.data_json); assert.equal(migrated.fingerprint, beforeSource.fingerprint);
 const migratedChannel = getChannel(w, 't2.import_ai'); assert.equal(migratedChannel.id, beforeChannel.id); assert.equal(migratedChannel.user_disabled, 1); assert.equal(migratedChannel.enabled, false); assert.equal(migratedChannel.url, 'https://jack-clark.net/feed/', 'only the known obsolete built-in URL is migrated; recovery retains the exact prior URL');
 assert.deepEqual(await fs.readFile(w.paths.manifestFile), beforeManifest);
 for (const [table, n] of Object.entries(beforeCounts)) if (table !== 'intel_channels' && table !== 'schema_migrations') assert.equal(w.db.prepare(`SELECT count(*) n FROM ${quote(table)}`).get().n, n, `unexpected count change: ${table}`);
 assert.deepEqual(w.db.pragma('foreign_key_check'), []);
 backup.close(); backup = null; w.close(); w = await openWorkspace({ xenhoHome: root });
 assert.equal((await fs.readdir(backupsDir)).filter(f => f.endsWith('.sqlite')).length, 1, 'reopening v29 must not create another migration point');
 assert.deepEqual(await Promise.all(protectedFiles.map(fingerprint)), beforeProduction, 'production files changed during isolated test; investigate concurrent writers');
 console.log('acquisition migration passed: v28 recovery hash/integrity/all-table reconciliation, v29 IDs/disabled state, production read-only fingerprints unchanged');
} finally {
 backup?.close(); w?.close();
 if (priorHome === undefined) delete process.env.XENHO_HOME; else process.env.XENHO_HOME = priorHome;
 await fs.rm(root, { recursive: true, force: true });
}
