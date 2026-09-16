import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { workbenchApi } from '../server/vite-plugin-workbench.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'xenho-connections-ui-'));
const shots = process.env.XENHO_SHOTS_DIR || temp;
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [ROOT, 'C:/Users/Lenovo', path.join(process.env.APPDATA || '', 'npm/node_modules')] }));
let server, browser, page, base, failRefresh = false, calls = 0;
const text = '写作工作台需要连接零散想法，保留自己的声音。';
const original = '我正在开发写作工作台。我的表达偏好是保持真实。';
const env = { XENHO_HOME: path.join(temp, 'workspace'), AGENT_LLM_BASE_URL: 'http://127.0.0.1:9/v1', AGENT_INGEST_BASE_URL: 'http://127.0.0.1:9/v1', AGENT_LLM_API_KEY: 'isolated-test', AGENT_LLM_MODEL: 'test-model', NOTE_COMPLETE_JSON: async (_env, input) => {
  calls++;
  if (failRefresh) throw new Error('测试刷新失败');
  const source = JSON.parse(input.user).sources.find(s => s.kind === 'note');
  return { data: { summary: '把灵感之间的联系和来源一起保存，可以更容易继续思考。', questions: ['哪些连接改变了你的判断？'], connections: source ? [{ kind: source.kind, id: source.id, relation: 'complement', noteQuote: '连接零散想法', quote: '保留可核对的原文', explanation: '灵感连接需要可回查的原文支持。', application: '将原文随新想法保存，写作时可以检查判断依据。' }] : [], angles: [{ title: '从记录到写作', thought: '把两个已有观点并排，先解释它们的联系。', nextStep: '选一个真实案例进行比较。' }], assetCandidate: null } };
}, PERSONAL_INTAKE_COMPLETE_JSON: async () => ({ data: { candidates: [{ kind: 'current', title: '开发写作工作台', body: '我正在开发写作工作台。', evidenceQuote: '我正在开发写作工作台。', eventDate: '' }] } }) };
async function request(route, body) {
  const response = await fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); assert(response.ok && result.ok, JSON.stringify(result)); return result;
}
async function screenshot(name) { await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true }); }
try {
  await fs.mkdir(shots, { recursive: true });
  server = await createServer({ root: ROOT, configFile: false, plugins: [react(), workbenchApi(env)], server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const related = (await request('/api/workspace/quick-notes', { text: '写作工作台的连接需要保留可核对的原文。' })).item;
  const note = (await request('/api/workspace/quick-notes', { text, tags: ['创作'] })).item;
  browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 970, height: 698 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/#/notes');
  const card = page.locator(`#note-${note.id}`);
  await card.hover(); assert.equal(calls, 0);
  await card.getByRole('button', { name: '✧ AI 洞察', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 洞察', exact: true });
  await dialog.getByText('灵感连接需要可回查的原文支持。').waitFor();
  assert.equal(calls, 1);
  await dialog.getByText('查看关联依据', { exact: false }).click();
  await dialog.locator('blockquote').filter({ hasText: '保留可核对的原文' }).waitFor();
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await screenshot(`connections-970-${scheme}`);
  }
  await dialog.getByRole('button', { name: '整理成新想法' }).click();
  await dialog.getByLabel('想留下什么').fill('我的新判断：连接想法时保留原文，方便写作时核对。');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await dialog.getByText('新想法已保存为独立记录。').waitFor();
  const thought = (await request('/api/workspace/quick-notes')).items.find(n => n.text.startsWith('我的新判断'));
  assert.equal(thought.origin.parentNoteId, note.id);
  assert.equal((await request(`/api/workspace/quick-notes/${note.id}`)).item.text, text);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await card.hover(); await card.getByRole('button', { name: '✧ AI 洞察', exact: true }).click();
  await dialog.getByText('灵感连接需要可回查的原文支持。').waitFor(); assert.equal(calls, 1);
  failRefresh = true;
  await dialog.getByRole('button', { name: '重新洞察' }).click();
  await dialog.getByText('测试刷新失败').waitFor();
  assert(await dialog.getByText('灵感连接需要可回查的原文支持。').isVisible());
  failRefresh = false;
  await dialog.getByRole('tab', { name: '继续讨论', exact: true }).click();
  await page.locator('.note-discussion .assistant-pane').waitFor();
  await screenshot('note-discussion');
  await dialog.getByRole('tab', { name: '洞察与关联' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('connections-mobile');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.goto(base + `/#/notes/${related.id}`);
  await page.waitForFunction(id => document.activeElement?.id === `note-${id}`, related.id);
  await page.setViewportSize({ width: 1538, height: 698 });
  await page.goto(base + '/#/personal-assets');
  await page.getByRole('button', { name: '整理一段自述' }).click();
  const intake = page.getByRole('dialog', { name: '从自述整理个人资产', exact: true });
  await intake.getByLabel('关于我的自述').fill(original);
  await intake.getByRole('checkbox').check();
  await intake.getByRole('button', { name: '确认发送并整理' }).click();
  await intake.getByLabel('标题', { exact: true }).waitFor();
  assert.equal((await request('/api/workspace/personal-assets')).items.length, 0);
  await intake.getByRole('button', { name: '确认保存 1 条' }).click();
  await intake.waitFor({ state: 'hidden' });
  const asset = (await request('/api/workspace/personal-assets')).items[0];
  assert.equal(asset.body, '我正在开发写作工作台。');
  assert.equal((await request(`/api/workspace/personal-assets/${asset.id}`)).item.intakeSource.sourceText, original);
  await page.locator('.asset-row').first().click();
  const detail = page.getByRole('dialog', { name: '个人资产详情' });
  await detail.getByText('查看自述来源原文', { exact: true }).click();
  await detail.locator('.asset-detail__body').filter({ hasText: original }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS real UI/API: grounded links, save thought, cache, failed refresh retains result, discussion mount, precise navigation, mobile, intake preview and confirmed save');
} catch (error) { if (page) { await screenshot('connections-failure').catch(() => {}); console.log(await page.locator('body').innerText().catch(() => '')); } throw error; }
finally {
  await browser?.close(); await server?.close(); await server?.xenhoClose?.();
  const relative = path.relative(os.tmpdir(), temp); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  await fs.rm(temp, { recursive: true, force: true });
}
