import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { ReadonlyService } from './service.mjs';
import { rootPath } from './files.mjs';
import { LIMITS } from './policy.mjs';

export class LiveReadonlyService extends ReadonlyService {
  constructor(home, auditRoot) {
    const validatedHome = rootPath(home);
    super(auditRoot, auditRoot);
    this.home = validatedHome;
    this.live = true;
    this.busy = false;
  }
  close() { this.worker?.kill(); super.close(); }
  async call(tool, args) {
    const request = randomUUID();
    this.audit({ event: 'request', request, tool, mode: 'live', argsHash: createHash('sha256').update(JSON.stringify(args)).digest('hex') });
    let acquired = false;
    try {
      if (Date.now() - this.window >= 60000) { this.window = Date.now(); this.calls = 0; }
      if (++this.calls > LIMITS.callsPerMinute) throw new Error('RATE_LIMITED');
      if (this.busy) throw new Error('QUERY_BUSY');
      this.busy = true; acquired = true;
      const worker = fork(new URL('./live-worker.mjs', import.meta.url), [this.home, JSON.stringify({tool,args})], { execArgv: ['--max-old-space-size=128'], env: { SystemRoot: process.env.SystemRoot || '' }, stdio: ['ignore','ignore','ignore','ipc'], windowsHide: true });
      this.worker = worker;
      const value = await new Promise((resolve,reject) => {
        let settled = false;
        const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
        const timer = setTimeout(() => { worker.kill(); finish(new Error('QUERY_TIMEOUT')); }, LIMITS.refreshMs);
        worker.once('message', m => finish(m.error ? new Error(m.error) : null, m.value));
        worker.once('error', () => finish(new Error('READ_UNAVAILABLE')));
        worker.once('exit', () => finish(new Error('READ_UNAVAILABLE')));
      });
      this.audit({ event: 'result', request, tool, mode: 'live', status: 'ok', bytes: Buffer.byteLength(JSON.stringify(value)), queriedAt: value.queriedAt });
      return { content: [{type:'text',text:JSON.stringify(value)}], structuredContent: value };
    } catch (error) {
      const code = ['NOT_FOUND','QUERY_TIMEOUT','QUERY_BUSY','RATE_LIMITED'].includes(error.message) ? error.message : 'READ_UNAVAILABLE';
      this.audit({ event: 'result', request, tool, mode: 'live', status: code });
      return { isError: true, content: [{type:'text',text:code}] };
    } finally {
      if (acquired) {
        const worker = this.worker;
        if (worker && worker.exitCode === null && worker.signalCode === null) {
          await new Promise(resolve => { worker.once('close', resolve); worker.kill(); });
        }
        this.worker = null; this.busy = false;
      }
    }
  }
}