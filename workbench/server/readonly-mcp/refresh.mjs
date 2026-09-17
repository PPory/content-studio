import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rootPath, confined } from './files.mjs';
import { LIMITS } from './policy.mjs';

export async function refreshSnapshot({ home, dataRoot }) {
  const source = rootPath(home), destination = rootPath(dataRoot);
  if (source === destination || !path.relative(source, destination).startsWith('..') && !path.isAbsolute(path.relative(source, destination))) throw new Error('SEPARATE_DATA_ROOT_REQUIRED');
  const lockFile = confined(destination, 'refresh.lock', { optional: true });
  const lock = fs.openSync(lockFile, 'wx', 0o600);
  let worker, temp;
  try {
    const snapshotFile = confined(destination, 'snapshot.json', { optional: true });
    if (fs.existsSync(snapshotFile) && Date.now() - fs.statSync(snapshotFile).mtimeMs < LIMITS.cooldownMs) throw new Error('REFRESH_COOLDOWN');
    worker = fork(new URL('./collect-worker.mjs', import.meta.url), [source], { execArgv: ['--max-old-space-size=128'], env: { SystemRoot: process.env.SystemRoot || '' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    const snapshot = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('COLLECTION_TIMEOUT')), LIMITS.refreshMs);
      const finish = (error, result) => { clearTimeout(timer); error ? reject(error) : resolve(result); };
      worker.once('message', message => finish(message.error ? new Error(message.error) : null, message.snapshot));
      worker.once('error', () => finish(new Error('COLLECTION_FAILED')));
      worker.once('exit', code => { if (code !== 0) finish(new Error('COLLECTION_FAILED')); });
    });
    worker.kill('SIGKILL'); worker = null;
    const output = JSON.stringify(snapshot);
    if (Buffer.byteLength(output) > LIMITS.bytes) throw new Error('SNAPSHOT_CAPACITY');
    temp = confined(destination, `snapshot-${randomUUID()}.tmp`, { optional: true });
    fs.writeFileSync(temp, output, { flag: 'wx', mode: 0o600 });
    confined(destination, 'snapshot.json', { optional: true });
    fs.renameSync(temp, snapshotFile); temp = null;
    return { capturedAt: snapshot.capturedAt, datasets: Object.keys(snapshot.datasets).length };
  } finally {
    if (worker) { const exited = new Promise(resolve => worker.once('close', resolve)); worker.kill('SIGKILL'); await exited; }
    if (temp) fs.unlinkSync(temp);
    fs.closeSync(lock); fs.unlinkSync(lockFile);
  }
}
