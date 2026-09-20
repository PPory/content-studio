import { openReadonly, datasetQuery } from './database.mjs';
import { DATASETS, LIMITS, POLICY_VERSION, projectRow } from './policy.mjs';
import os from 'node:os';

let db;
try {
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  db = openReadonly(process.argv[2]);
  const snapshot = db.transaction(() => {
    const datasets = {};
    let total = 0, bytes = 0;
    for (const [name, policy] of Object.entries(DATASETS)) {
      const query = datasetQuery(db, name);
      if (!query) { datasets[name] = { rows: [], available: false, limited: false }; continue; }
      const rows = [];
      let limited = false;
      const sql = 'SELECT ' + query.select + ' FROM ' + query.from + ' WHERE ' + query.where + ' ORDER BY t."' + query.key + '" LIMIT ?';
      for (const row of db.prepare(sql).iterate(LIMITS.perDataset + 1)) {
        if (rows.length === LIMITS.perDataset) { limited = true; break; }
        if (++total > LIMITS.rows) throw new Error('SNAPSHOT_CAPACITY');
        const projected = projectRow(row);
        bytes += Buffer.byteLength(JSON.stringify(projected));
        if (bytes > LIMITS.bytes - 65536) throw new Error('SNAPSHOT_CAPACITY');
        rows.push(projected);
      }
      datasets[name] = { rows, available: true, limited, omittedFields: query.omittedFields };
    }
    return { policyVersion: POLICY_VERSION, capturedAt: new Date().toISOString(), datasets };
  })();
  db.close(); db = null;
  process.send({ snapshot });
} catch { process.send({ error: 'COLLECTION_FAILED' }); }
finally { db?.close(); }
