import Database from 'better-sqlite3';
import { DATASETS, LIMITS } from './policy.mjs';
import { rootPath, confined } from './files.mjs';
import { resolveWorkspacePaths } from '../storage/workspace-paths.mjs';
import path from 'node:path';

export function openReadonly(home) {
  const root = rootPath(home);
  const paths = resolveWorkspacePaths({ xenhoHome: root });
  const relative = path.relative(root, paths.databaseFile);
  for (const suffix of ['', '-wal', '-shm', '-journal']) confined(root, relative + suffix, { optional: suffix !== '' });
  const db = new Database(paths.databaseFile, { readonly: true, fileMustExist: true, timeout: 0 });
  try {
    db.pragma('query_only = ON');
    db.pragma('trusted_schema = OFF');
    db.pragma('cache_size = -1024');
    // Never migrate, checkpoint, change journal mode, or run an integrity scan.
    if (db.pragma('journal_mode', { simple: true }) !== 'wal') throw new Error('WAL_REQUIRED');
    return db;
  } catch (error) { db.close(); throw error; }
}

export function datasetQuery(db, name) {
  const policy = DATASETS[name];
  if (!policy) throw new Error('UNKNOWN_DATASET');
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!table || /^CREATE VIRTUAL/i.test(table.sql)) return null;
  const actual = new Set(db.pragma('table_info("' + name + '")').map(c => c.name));
  const fields = policy.columns.filter(c => actual.has(c));
  const key = policy.key || 'id';
  if (!fields.includes(key)) throw new Error('SCHEMA_MISMATCH');
  const select = fields.map(c => 'CASE WHEN typeof(t."' + c + '")=\'text\' THEN substr(t."' + c + '",1,' + (LIMITS.text + 1) + ') ELSE t."' + c + '" END AS "' + c + '"');
  if (key !== 'id') select.push('t."' + key + '" AS id');
  if (policy.entity) select.push('e.created_at', 'e.updated_at');
  const join = policy.entity ? ' JOIN entities e ON e.id=t."' + key + '"' : '';
  const acquisitionPolicy = db.pragma('user_version', {simple:true}) >= 29 && ['intel_sources','intel_briefs','intel_cards','intel_reports'].includes(name) ? (name === 'intel_sources' ? "(t.acquisition_identity IS NULL OR (json_extract(t.rights_json,'$.exportAllowed')=1 AND json_extract(t.rights_json,'$.aiAllowed')=1 AND t.deleted_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))" : "NOT EXISTS (SELECT 1 FROM json_tree(t.data_json) j JOIN intel_sources s ON s.id=j.value WHERE s.acquisition_identity IS NOT NULL AND (json_extract(s.rights_json,'$.exportAllowed') IS NOT 1 OR json_extract(s.rights_json,'$.aiAllowed') IS NOT 1 OR s.deleted_at IS NOT NULL OR s.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))") : '1=1';
  const where = [acquisitionPolicy, policy.entity ? 'e.deleted_at IS NULL' : '1=1', policy.extra ? '(' + policy.extra + ')' : '1=1'].join(' AND ');
  return { select: select.join(','), from: '"' + name + '" t' + join, where, key, omittedFields: policy.columns.filter(c => !actual.has(c)) };
}
