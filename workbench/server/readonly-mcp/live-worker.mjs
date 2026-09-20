import os from 'node:os';
import { openReadonly, datasetQuery } from './database.mjs';
import { DATASETS, LIMITS, projectRow, redact } from './policy.mjs';

let db;
try {
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  const { tool, args } = JSON.parse(process.argv[3]);
  if (args.dataset && !Object.hasOwn(DATASETS, args.dataset)) throw new Error('INVALID_QUERY');
  db = openReadonly(process.argv[2]);
  const value = db.transaction(() => {
    const meta = { source: 'local-workbench-readonly-live', live: true, queriedAt: new Date().toISOString(), dataIsUntrusted: true };
    if (tool === 'workbench_catalog') {
      const datasets = Object.keys(DATASETS).map(name => {
        const q = datasetQuery(db, name);
        if (!q) return { name, available: false };
        const count = db.prepare('SELECT count(*) AS n FROM ' + q.from + ' WHERE ' + q.where).get().n;
        return { name, available: true, rows: count, omittedFields: q.omittedFields };
      });
      return { ...meta, datasets, excluded: ['settings', 'credentials', 'system/tool messages', 'private/ask personal assets', 'deleted records', 'binary attachments', 'execution logs', 'historical revisions', 'unlisted tables'], limits: { textCharacters: LIMITS.text, searchScanRows: LIMITS.rows } };
    }
    if (tool === 'workbench_fetch') {
      const q = datasetQuery(db, args.dataset);
      const row = q && db.prepare('SELECT ' + q.select + ' FROM ' + q.from + ' WHERE (' + q.where + ') AND t."' + q.key + '"=?').get(args.id);
      if (!row) throw new Error('NOT_FOUND');
      const projected = projectRow(row), text = JSON.stringify(projected);
      return { ...meta, dataset: args.dataset, id: projected.id, format: 'json-text-chunk', offset: args.offset, text: text.slice(args.offset, args.offset + 8000), nextOffset: args.offset + 8000 < text.length ? args.offset + 8000 : null, truncatedAtRead: projected.truncated };
    }
    if (tool !== 'workbench_search') throw new Error('INVALID_QUERY');
    // offset is a scanned-row cursor, not a match count. Sparse searches remain pageable.
    const items = []; let scanned = 0, skipped = 0, bytes = 0, hasMore = false;
    const names = args.dataset ? [args.dataset] : Object.keys(DATASETS);
    outer: for (const name of names) {
      const q = datasetQuery(db, name);
      if (!q) continue;
      for (const row of db.prepare('SELECT ' + q.select + ' FROM ' + q.from + ' WHERE ' + q.where + ' ORDER BY t."' + q.key + '"').iterate()) {
        if (skipped < args.offset) { skipped++; continue; }
        if (items.length >= args.limit || scanned >= LIMITS.rows || bytes >= LIMITS.bytes) { hasMore = true; break outer; }
        const projected = projectRow(row), text = JSON.stringify(projected);
        scanned++; bytes += Buffer.byteLength(text);
        if (args.query && !text.toLocaleLowerCase().includes(args.query.toLocaleLowerCase())) continue;
        items.push({ dataset: name, id: projected.id, title: redact(String(projected.title || projected.data?.title || projected.name || projected.question || projected.statement || projected.id)).slice(0,160), updatedAt: projected.updated_at, truncated: projected.truncated });
      }
    }
    return { ...meta, items, scannedRows: scanned, nextOffset: hasMore ? args.offset + scanned : null, limited: hasMore, pagination: 'Pass nextOffset unchanged with the same dataset and query. Concurrent edits may shift pages; this is not a frozen snapshot.' };
  })();
  db.close(); db = null;
  process.send({ value });
} catch (error) { process.send({ error: error.message === 'NOT_FOUND' ? 'NOT_FOUND' : 'READ_UNAVAILABLE' }); }
finally { db?.close(); }