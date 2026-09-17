import { parseArgs } from 'node:util';

// Explicit host-owned paths only. Do not retain tunnel or application credentials.
for (const key of Object.keys(process.env)) {
  if (!['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'].includes(key.toUpperCase())) delete process.env[key];
}
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { home: { type: 'string' }, 'data-root': { type: 'string' }, 'audit-root': { type: 'string' } } });
  if (positionals.length !== 1 || !values['data-root']) throw new Error('USAGE');
  if (positionals[0] === 'refresh' && values.home && !values['audit-root']) {
    const { refreshSnapshot } = await import('../server/readonly-mcp/refresh.mjs');
    console.log(JSON.stringify(await refreshSnapshot({ home: values.home, dataRoot: values['data-root'] })));
  } else if (positionals[0] === 'serve' && !values.home) {
    const { serve } = await import('../server/readonly-mcp/server.mjs');
    await serve(values['data-root'], values['audit-root']);
  } else throw new Error('USAGE');
} catch (error) {
  const safe = ['USAGE', 'INVALID_ROOT', 'UNSAFE_PATH', 'SEPARATE_DATA_ROOT_REQUIRED', 'REFRESH_COOLDOWN', 'COLLECTION_TIMEOUT', 'COLLECTION_FAILED', 'SNAPSHOT_CAPACITY'];
  const code = safe.includes(error.message) ? error.message : ['EACCES', 'EPERM', 'EXDEV', 'EEXIST', 'ENOENT'].includes(error.code) ? error.code : 'UNAVAILABLE';
  console.error('只读 MCP 未启动或刷新失败（' + code + '）。检查参数、路径权限、刷新间隔和快照状态；未输出内部错误或业务数据。');
  process.exitCode = 1;
}
