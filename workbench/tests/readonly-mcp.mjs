import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { refreshSnapshot } from '../server/readonly-mcp/refresh.mjs';
import { ReadonlyService } from '../server/readonly-mcp/service.mjs';
import { redact, LIMITS } from '../server/readonly-mcp/policy.mjs';
import { confined } from '../server/readonly-mcp/files.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xenho-readonly-mcp-'));
const home = path.join(root, 'home'), dataRoot = path.join(root, 'reader');
fs.mkdirSync(dataRoot);
process.env.XENHO_HOME = home;
let workspace, transport, service, client;
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const result = value => JSON.parse(value.content[0].text);
const snapshotPath = path.join(dataRoot, 'snapshot.json');
try {
  workspace = await openWorkspace({ xenhoHome: home });
  const db = workspace.db;
  const now = new Date().toISOString();
  const entity = (id, type, deleted = null) => db.prepare('INSERT INTO entities(id,entity_type,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?)').run(id, type, now, now, deleted);
  entity('capture-1', 'capture');
  db.prepare('INSERT INTO captures(id,title,body_markdown,capture_kind) VALUES(?,?,?,?)').run('capture-1', '真实的测试正文', '苹果研究。api_key=TEST_SECRET_DO_NOT_EXPORT\n邮箱 alice@example.com\nhttps://example.com/source?token=URL_SECRET\n普通文字可读', 'article');
  entity('capture-deleted', 'capture', now);
  db.prepare('INSERT INTO captures(id,title,body_markdown,capture_kind) VALUES(?,?,?,?)').run('capture-deleted', '删除记录', 'DELETED_PRIVATE', 'article');
  entity('personal-private', 'personal_asset');
  db.prepare('INSERT INTO personal_assets(id,kind,title,body,usage,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('personal-private', 'identity', '私密', 'PRIVATE_IDENTITY', 'private', now, now);
  entity('conversation-1', 'conversation');
  db.prepare('INSERT INTO ai_conversations(id,title,record_json) VALUES(?,?,?)').run('conversation-1', '讨论', JSON.stringify({ messages: [{ role: 'user', text: '我们讨论苹果' }, { role: 'assistant', text: '正文回答' }, { role: 'tool', text: 'TOOL_SECRET' }, { role: 'system', text: 'SYSTEM_SECRET' }], apiKey: 'JSON_SECRET', tools: ['TOOL_PAYLOAD'] }));
  db.prepare('INSERT INTO workspace_settings(key,value_json,updated_at) VALUES(?,?,?)').run('private', '{"apiKey":"SETTINGS_SECRET"}', now);
  db.transaction(() => {
    const insert = db.prepare('INSERT INTO books(id,title) VALUES(?,?)');
    for (let i = 0; i < 3001; i++) {
      const id = 'book-' + String(i).padStart(5, '0');
      entity(id, 'book'); insert.run(id, '限额测试');
    }
  })();
  db.pragma('wal_checkpoint(TRUNCATE)');
  const before = digest(workspace.paths.databaseFile);
  const start = Date.now();
  const refreshed = await refreshSnapshot({ home, dataRoot });
  assert(refreshed.datasets >= 24);
  assert(Date.now() - start < 10000);
  assert.equal(digest(workspace.paths.databaseFile), before, 'production database unchanged');
  assert.equal(db.prepare('SELECT body_markdown FROM captures WHERE id=?').get('capture-1').body_markdown.includes('TEST_SECRET'), true);
  const snapshotText = fs.readFileSync(snapshotPath, 'utf8');
  for (const forbidden of ['TEST_SECRET', 'alice@example.com', 'URL_SECRET', 'DELETED_PRIVATE', 'PRIVATE_IDENTITY', 'TOOL_SECRET', 'SYSTEM_SECRET', 'JSON_SECRET', 'TOOL_PAYLOAD', 'SETTINGS_SECRET']) assert(!snapshotText.includes(forbidden), forbidden);
  assert(snapshotText.includes('普通文字可读'));
  assert(snapshotText.includes('正文回答'));
  assert.equal(JSON.parse(snapshotText).datasets.captures.rows.length, 1);
  assert.equal(JSON.parse(snapshotText).datasets.books.rows.length, 3000);
  assert.equal(JSON.parse(snapshotText).datasets.books.limited, true);
  await assert.rejects(refreshSnapshot({ home, dataRoot }), /REFRESH_COOLDOWN/);
  assert(!fs.existsSync(path.join(dataRoot, 'refresh.lock')));
  assert.throws(() => confined(dataRoot, '../home/Workspace/workspace.sqlite'), /UNSAFE_PATH/);
  const link = path.join(dataRoot, 'escape');
  fs.symlinkSync(home, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => confined(dataRoot, 'escape/Workspace/workspace.sqlite'), /UNSAFE_PATH/);
  fs.unlinkSync(link);

  transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('scripts/readonly-mcp.mjs'), 'serve', '--data-root', dataRoot], stderr: 'pipe', env: { SystemRoot: process.env.SystemRoot || '' } });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  client = new Client({ name: 'readonly-acceptance', version: '1.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 3);
  assert(tools.every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint && !t.annotations.openWorldHint));
  const catalog = result(await client.callTool({ name: 'workbench_catalog', arguments: {} }));
  assert.equal(catalog.live, false);
  assert.equal(catalog.datasets.find(d => d.name === 'captures').snapshotRows, 1);
  const codexAudit = path.join(root, 'codex-audit');
  fs.mkdirSync(codexAudit);
  const second = new Client({ name: 'codex-concurrent', version: '1.0' });
  const secondTransport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('scripts/readonly-mcp.mjs'), 'serve', '--data-root', dataRoot, '--audit-root', codexAudit], stderr: 'pipe' });
  try {
    await second.connect(secondTransport);
    const parallelCatalog = result(await second.callTool({ name: 'workbench_catalog', arguments: {} }));
    assert.equal(parallelCatalog.snapshotId, catalog.snapshotId);
    assert.equal((await second.listTools()).tools.length, 3);
    assert(fs.readFileSync(path.join(codexAudit, 'audit.jsonl'), 'utf8').includes('workbench_catalog'));
    assert(!fs.existsSync(path.join(codexAudit, 'snapshot.json')));
    assert.throws(() => new ReadonlyService(dataRoot, codexAudit), /EEXIST/);
    fs.truncateSync(path.join(codexAudit, 'audit.jsonl'), LIMITS.auditBytes);
    await assert.rejects(second.callTool({ name: 'workbench_catalog', arguments: {} }));
    assert.equal(result(await client.callTool({ name: 'workbench_catalog', arguments: {} })).snapshotId, catalog.snapshotId);
  } finally { await second.close(); }

  const found = result(await client.callTool({ name: 'workbench_search', arguments: { query: '苹果', dataset: 'captures' } }));
  assert.equal(found.items[0].id, 'capture-1');
  const fetched = result(await client.callTool({ name: 'workbench_fetch', arguments: { dataset: 'captures', id: 'capture-1' } }));
  assert(fetched.text.includes('普通文字可读'));
  assert(!fetched.text.includes('TEST_SECRET'));
  assert.equal((await client.callTool({ name: 'workbench_fetch', arguments: { dataset: 'captures', id: 'capture-deleted' } })).isError, true);
  for (const args of [{ dataset: 'workspace_settings' }, { limit: 21 }, { query: 'x'.repeat(201) }, { sql: 'DELETE FROM captures' }, { offset: -1 }]) {
    assert.equal((await client.callTool({ name: 'workbench_search', arguments: args })).isError, true, JSON.stringify(args));
  }
  assert.equal((await client.callTool({ name: 'execute_sql', arguments: { sql: 'SELECT * FROM workspace_settings' } })).isError, true);
  await client.close(); client = null; transport = null;
  const oversized = spawn(process.execPath, [path.resolve('scripts/readonly-mcp.mjs'), 'serve', '--data-root', dataRoot], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let oversizedOutput = '';
  oversized.stdout.on('data', bytes => { oversizedOutput += bytes; });
  oversized.stderr.resume();
  const oversizedClosed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { oversized.kill(); reject(new Error('Oversized frame did not close')); }, 5000);
    oversized.once('close', code => { clearTimeout(timer); resolve(code); });
    oversized.once('error', reject);
  });
  oversized.stdin.end('x'.repeat(20000) + '\n');
  assert.equal(await oversizedClosed, 1);
  assert.equal(oversizedOutput, '');
  assert(!stderr.includes('TEST_SECRET'));
  assert.equal(digest(workspace.paths.databaseFile), before);
  const audit = fs.readFileSync(path.join(dataRoot, 'audit.jsonl'), 'utf8');
  assert(audit.includes('workbench_fetch'));
  assert(!audit.includes('苹果') && !audit.includes('TEST_SECRET') && !audit.includes('DELETE'));
  for (const line of audit.trim().split('\n')) JSON.parse(line);
  service = new ReadonlyService(dataRoot);
  for (let i = 0; i < 60; i++) assert(!service.call('workbench_catalog', {}).isError);
  assert.equal(service.call('workbench_catalog', {}).content[0].text, 'RATE_LIMITED');
  service.close(); service = new ReadonlyService(dataRoot);
  const tampered = JSON.parse(snapshotText);
  tampered.datasets.captures.rows[0].apiKey = 'MUST_NOT_RETURN';
  fs.writeFileSync(snapshotPath, JSON.stringify(tampered));
  assert.equal(service.call('workbench_catalog', {}).content[0].text, 'READ_UNAVAILABLE');
  fs.writeFileSync(snapshotPath, snapshotText);
  const snapshot = JSON.parse(snapshotText);
  snapshot.capturedAt = '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
  assert.equal(service.call('workbench_catalog', {}).content[0].text, 'SNAPSHOT_EXPIRED');
  fs.writeFileSync(snapshotPath, snapshotText);
  fs.truncateSync(path.join(dataRoot, 'audit.jsonl'), LIMITS.auditBytes);
  assert.throws(() => service.call('workbench_fetch', { dataset: 'captures', id: 'capture-1', offset: 0 }), /AUDIT_UNAVAILABLE/);
  assert.equal(digest(workspace.paths.databaseFile), before);
  assert(!redact('password: qwerty\nBearer abcdefghi\nsk-abcdefghijklmnopqrstuv').includes('qwerty'));
  console.log('PASS: real stdio MCP, schema rejection, redaction, private/deleted exclusion, audit fail-closed, rate/staleness limits, path escape and unchanged SQLite.');
} finally {
  if (client) await client.close();
  else if (transport) await transport.close();
  service?.close();
  workspace?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
