import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { quickNote } from '../server/domain/research.mjs';
import { saveNote, savePersonalAsset, trashNote } from '../server/domain/personal-assets.mjs';
import { generateNoteInsight } from '../server/domain/note-insights.mjs';
import { configureAssistantWorkspace, runAssistantTurn } from '../server/agent-runtime/assistant-runner.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xenho-note-discussion-'));
const w = await openWorkspace({ xenhoHome: root });
const env = { AGENT_LLM_BASE_URL: 'https://test.invalid/v1', AGENT_LLM_MODEL: 'test-model' };
try {
  configureAssistantWorkspace(w);
  let note = quickNote(w, { text: '写作工作台应该帮助连接零散想法。' });
  const related = quickNote(w, { text: '写作工作台需要保留来源。SOURCE_731' });
  savePersonalAsset(w, null, { kind: 'identity', title: '私密信息', body: 'PRIVATE_731', usage: 'private', confirmed: true });
  await generateNoteInsight({ NOTE_COMPLETE_JSON: async () => ({ data: { summary: '把连接与来源结合起来。', questions: [], connections: [{ kind: 'note', id: related.id, noteQuote: '写作工作台', quote: 'SOURCE_731', relation: 'complement', explanation: '来源可以支持连接的核验', application: '把来源随想法保存' }], angles: [] } }) }, w, note.id);
  let conversationId = '', last, count = 0;
  async function turn() {
    const result = await runAssistantTurn(env, { scopeId: `note:${note.id}`, conversationId, message: '这些想法怎么联系？', mode: 'general' }, { createRun: async input => {
      last = input;
      const id = `test-${++count}`;
      input.onSession?.({ abort: async () => {}, dispose() {} }, { sessionId: id, sessionFile: '' });
      return { result: { finalResponse: '这是待核对的新角度。' }, piSessionId: id, piSessionFile: '', permissionMode: 'daily' };
    } });
    conversationId = result.conversation.id;
    return result;
  }
  await turn();
  assert(last.prompt.includes(note.text)); assert(last.prompt.includes('SOURCE_731'));
  assert(!last.prompt.includes('PRIVATE_731'));
  await turn(); assert(last.sessionId, 'unchanged evidence resumes the model session');
  trashNote(w, related.id);
  const afterDelete = await turn();
  assert.equal(last.sessionId, ''); assert(!last.prompt.includes('SOURCE_731'));
  assert(afterDelete.conversation.messages.length >= 6, 'visible conversation remains available');
  note = saveNote(w, note.id, { text: '新的写作判断。', expectedVersion: note.version });
  await turn(); assert.equal(last.sessionId, ''); assert(last.prompt.includes(note.text));
  trashNote(w, note.id);
  await assert.rejects(turn, /不存在|删除/);
  console.log('PASS note-scoped discussion, continuity, source invalidation, private data isolation, deleted note');
} finally {
  w.close();
  const relative = path.relative(os.tmpdir(), root);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  await fs.rm(root, { recursive: true, force: true });
}
