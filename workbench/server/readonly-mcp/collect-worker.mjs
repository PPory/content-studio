import Database from 'better-sqlite3';
import { DATASETS, LIMITS, POLICY_VERSION, projectRow } from './policy.mjs';
import { rootPath, confined } from './files.mjs';
import { resolveWorkspacePaths } from '../storage/workspace-paths.mjs';
import path from 'node:path';
import os from 'node:os';

let db;
try {
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  const root = rootPath(process.argv[2]);
  const paths = resolveWorkspacePaths({ xenhoHome: root });
  const relative = path.relative(root, paths.databaseFile);
  for (const suffix of ['', '-wal', '-shm', '-journal']) confined(root, relative + suffix, { optional: suffix !== '' });
  db = new Database(paths.databaseFile, { readonly: true, fileMustExist: true, timeout: 0 });
  db.pragma('query_only = ON');
  db.pragma('trusted_schema = OFF');
  db.pragma('cache_size = -1024');
  // Never migrate, checkpoint, change journal mode, or run an integrity scan.
  if (db.pragma('journal_mode', { simple: true }) !== 'wal') throw new Error('WAL_REQUIRED');
  const snapshot = db.transaction(() => {
    const datasets = {};
    let total = 0, bytes = 0;
    for (const [name, policy] of Object.entries(DATASETS)) {
      const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name);
      if (!table || /^CREATE VIRTUAL/i.test(table.sql)) { datasets[name] = { rows: [], available: false, limited: false }; continue; }
      const actual = new Set(db.pragma('table_info("' + name + '")').map(c => c.name));
      const fields = policy.columns.filter(c => actual.has(c));
      const key = policy.key || 'id';
      if (!fields.includes(key)) throw new Error('SCHEMA_MISMATCH');
      const select = fields.map(c => 'CASE WHEN typeof(t."' + c + '")=\'text\' THEN substr(t."' + c + '",1,' + (LIMITS.text + 1) + ') ELSE t."' + c + '" END AS "' + c + '"');
      if (key !== 'id') select.push('t."' + key + '" AS id');
      if (policy.entity) select.push('e.created_at', 'e.updated_at');
      const rows = [];
      let limited = false;
      const join = policy.entity ? ' JOIN entities e ON e.id=t."' + key + '"' : '';
      const where = [policy.entity ? 'e.deleted_at IS NULL' : '1=1', policy.extra ? '(' + policy.extra + ')' : '1=1'].join(' AND ');
      const sql = 'SELECT ' + select.join(',') + ' FROM "' + name + '" t' + join + ' WHERE ' + where + ' ORDER BY t."' + key + '" LIMIT ?';
      for (const row of db.prepare(sql).iterate(LIMITS.perDataset + 1)) {
        if (rows.length === LIMITS.perDataset) { limited = true; break; }
        if (++total > LIMITS.rows) throw new Error('SNAPSHOT_CAPACITY');
        const projected = projectRow(row);
        bytes += Buffer.byteLength(JSON.stringify(projected));
        if (bytes > LIMITS.bytes - 65536) throw new Error('SNAPSHOT_CAPACITY');
        rows.push(projected);
      }
      datasets[name] = { rows, available: true, limited, omittedFields: policy.columns.filter(c => !actual.has(c)) };
    }
    return { policyVersion: POLICY_VERSION, capturedAt: new Date().toISOString(), datasets };
  })();
  db.close(); db = null;
  process.send({ snapshot });
} catch { process.send({ error: 'COLLECTION_FAILED' }); }
finally { db?.close(); }
