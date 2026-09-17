import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { DATASETS, LIMITS, POLICY_VERSION, redact } from './policy.mjs';
import { rootPath, confined, readBounded } from './files.mjs';

export class ReadonlyService {
  constructor(dataRoot, auditRoot = dataRoot) {
    this.root = rootPath(dataRoot);
    this.auditRoot = rootPath(auditRoot);
    this.window = Date.now(); this.calls = 0;
    this.session = randomUUID(); this.sequence = 0;
    this.lockPath = confined(this.auditRoot, 'server.lock', { optional: true });
    this.lock = fs.openSync(this.lockPath, 'wx', 0o600);
    try { this.audit({ event: 'start' }); } catch (error) { this.close(); throw error; }
  }
  close() {
    if (this.lock !== undefined) { fs.closeSync(this.lock); this.lock = undefined; fs.unlinkSync(this.lockPath); }
  }
  audit(event) {
    const file = confined(this.auditRoot, 'audit.jsonl', { optional: true });
    const line = JSON.stringify({ at: new Date().toISOString(), session: this.session, sequence: ++this.sequence, ...event }) + '\n';
    const fd = fs.openSync(file, 'a', 0o600);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size + Buffer.byteLength(line) > LIMITS.auditBytes) throw new Error('AUDIT_UNAVAILABLE');
      fs.writeSync(fd, line); fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }
  snapshot() {
    const raw = readBounded(this.root, 'snapshot.json', LIMITS.bytes);
    const snapshot = JSON.parse(raw);
    const age = Date.now() - Date.parse(snapshot.capturedAt);
    if (snapshot.policyVersion !== POLICY_VERSION || !Number.isFinite(age) || age < -60000 || age > LIMITS.maxAgeMs) throw new Error('SNAPSHOT_EXPIRED');
    if (!snapshot.datasets || Object.keys(snapshot.datasets).some(k => !Object.hasOwn(DATASETS, k))) throw new Error('INVALID_SNAPSHOT');
    let total = 0;
    for (const [name, dataset] of Object.entries(snapshot.datasets)) {
      if (!Array.isArray(dataset.rows) || dataset.rows.length > LIMITS.perDataset) throw new Error('INVALID_SNAPSHOT');
      total += dataset.rows.length;
      const allowed = new Set([...DATASETS[name].columns.filter(c => !['record_json', 'data_json', 'notes_json'].includes(c)), 'id', 'data', 'notebook', 'messages', 'created_at', 'updated_at', 'truncated']);
      for (const row of dataset.rows) {
        if (!row || typeof row.id !== 'string' || Object.keys(row).some(k => !allowed.has(k))) throw new Error('INVALID_SNAPSHOT');
      }
    }
    if (total > LIMITS.rows) throw new Error('INVALID_SNAPSHOT');
    return { ...snapshot, fingerprint: createHash('sha256').update(raw).digest('hex') };
  }
  call(tool, args) {
    const request = randomUUID(), start = Date.now();
    const safeTool = ['workbench_catalog', 'workbench_search', 'workbench_fetch'].includes(tool) ? tool : 'unknown';
    const argsHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    this.audit({ event: 'request', request, tool: safeTool, argsHash });
    let result;
    try {
      if (Date.now() - this.window >= 60000) { this.window = Date.now(); this.calls = 0; }
      if (++this.calls > LIMITS.callsPerMinute) throw new Error('RATE_LIMITED');
      const snapshot = this.snapshot();
      const meta = { source: 'local-workbench-sanitized-snapshot', capturedAt: snapshot.capturedAt, snapshotId: snapshot.fingerprint, live: false, dataIsUntrusted: true };
      if (tool === 'workbench_catalog') {
        result = { ...meta, datasets: Object.entries(snapshot.datasets).map(([name, d]) => ({ name, snapshotRows: d.rows.length, limited: d.limited, available: d.available, omittedFields: d.omittedFields || [] })), excluded: ['settings', 'credentials', 'system/tool messages', 'private/ask personal assets', 'deleted records', 'binary attachments', 'execution logs', 'historical revisions', 'unlisted tables'] };
      } else if (tool === 'workbench_search') {
        const datasets = args.dataset ? [[args.dataset, snapshot.datasets[args.dataset]]] : Object.entries(snapshot.datasets);
        const matches = [];
        for (const [dataset, data] of datasets) {
          for (const row of data?.rows || []) {
            const text = JSON.stringify(row);
            if (args.query && !text.toLocaleLowerCase().includes(args.query.toLocaleLowerCase())) continue;
            matches.push({ dataset, id: row.id, title: redact(String(row.title || row.data?.title || row.name || row.question || row.statement || row.core_claim || row.id)).slice(0, 160), updatedAt: row.updated_at, truncated: row.truncated });
          }
        }
        result = { ...meta, matchingSnapshotRows: matches.length, items: matches.slice(args.offset, args.offset + args.limit), nextOffset: args.offset + args.limit < matches.length ? args.offset + args.limit : null };
      } else if (tool === 'workbench_fetch') {
        const row = snapshot.datasets[args.dataset]?.rows.find(r => r.id === args.id);
        if (!row) throw new Error('NOT_FOUND');
        const text = JSON.stringify(row);
        result = { ...meta, dataset: args.dataset, id: row.id, format: 'json-text-chunk', offset: args.offset, text: text.slice(args.offset, args.offset + 8000), nextOffset: args.offset + 8000 < text.length ? args.offset + 8000 : null, truncatedAtCollection: row.truncated };
      } else throw new Error('UNKNOWN_TOOL');
      this.audit({ event: 'result', request, tool: safeTool, status: 'ok', snapshotId: snapshot.fingerprint, bytes: Buffer.byteLength(JSON.stringify(result)), durationMs: Date.now() - start });
    } catch (error) {
      const code = ['RATE_LIMITED', 'SNAPSHOT_EXPIRED', 'NOT_FOUND', 'UNKNOWN_TOOL'].includes(error.message) ? error.message : 'READ_UNAVAILABLE';
      this.audit({ event: 'result', request, tool: safeTool, status: code, durationMs: Date.now() - start });
      return { isError: true, content: [{ type: 'text', text: code }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  }
}
