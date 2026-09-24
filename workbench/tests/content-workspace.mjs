// 一篇内容一个工作区（2026-09-24）：情报加入选题就建内容并预填构思；旧选题第一次打开补建内容；
// 列表卡片的来源 / 建议时效 / 还缺什么；清单读写。独立的临时 XENHO_HOME，不调模型。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { saveIntelligenceProfile, enqueueIntelligence, addIntelligenceSource } from '../server/domain/intelligence.mjs';
import { saveIntelligenceBriefs } from '../server/domain/intelligence-feed.mjs';
import { createIntelligenceTopicIntent } from '../server/domain/intelligence-topic-intents.mjs';
import { createResearch, getResearch, ensureResearchProject, ensureProjectResearch, recentWork } from '../server/domain/research.mjs';
import { getProjectNotebook } from '../server/domain/project-notebook.mjs';
import { projectPlanSummary, EXPERIENCE_ITEM } from '../server/domain/content-plan.mjs';
import { savePersonalAsset, referencePersonalAsset } from '../server/domain/personal-assets.mjs';
import { projectDto } from '../server/workspace/workspace-view.mjs';
import { parseChecklist, setItemDone, removeItem, renameItem, appendItems, checklistFromLines, openItems } from '../src/lib/content-checklist.js';

// 清单：清单以外的文字原样保留，勾选、改名、删除只动那一行。
const text = '用户问题：怎样确认 AI 完成了任务？\n- [ ] 官方价格表\n- [x] 第三方评测\n补充说明';
assert.deepEqual(parseChecklist(text).items.map(i => [i.text, i.done]), [['官方价格表', false], ['第三方评测', true]]);
assert.equal(parseChecklist(text).other, '用户问题：怎样确认 AI 完成了任务？\n补充说明');
assert.equal(setItemDone(text, 0, true), text.replace('- [ ] 官方价格表', '- [x] 官方价格表'));
assert.equal(removeItem(text, 1), '用户问题：怎样确认 AI 完成了任务？\n- [ ] 官方价格表\n补充说明');
assert.equal(renameItem(text, 0, '官方价格页'), text.replace('官方价格表', '官方价格页'));
assert.equal(appendItems(text, ['官方价格表', ' 新的一项 ', '']), `${text}\n- [ ] 新的一项`, '同名不重复加');
assert.equal(checklistFromLines('- 第一条\n\n* 第二条\n第三条'), '- [ ] 第一条\n- [ ] 第二条\n- [ ] 第三条');
assert.deepEqual(openItems(text), ['官方价格表']);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xenho-content-workspace-'));
let w;
try {
  w = await openWorkspace({ xenhoHome: root });

  // 旧选题第一次打开：补建内容，构思按研究预填，原研究不改；重复调用是同一篇。
  const old = createResearch(w, { question: '为什么 harness 比大模型更重要', notes: '我的旧笔记', openQuestions: '- 找一个真实例子\n需要对比数据' });
  const before = getResearch(w, old.id);
  const first = ensureResearchProject(w, old.id);
  assert.equal(first.created, true);
  assert.deepEqual(ensureResearchProject(w, old.id), { projectId: first.projectId, created: false });
  const nb = getProjectNotebook(w, first.projectId);
  assert.equal(nb.thought, '为什么 harness 比大模型更重要');
  assert.equal(nb.evidenceNotes, '我的旧笔记');
  assert.equal(nb.questions, '- [ ] 找一个真实例子\n- [ ] 需要对比数据');
  const after = getResearch(w, old.id);
  assert.equal(after.version, before.version); assert.equal(after.notes, before.notes); assert.equal(after.openQuestions, before.openQuestions);
  assert.equal(after.projects[0].id, first.projectId);
  // 内容 → 研究：已有就返回，没有就补一条。
  assert.deepEqual(ensureProjectResearch(w, first.projectId), { researchId: old.id, created: false });
  const bare = w.domain.createProject({ title: '直接新建的一篇', confirmed: true, actor: 'user' });
  const made = ensureProjectResearch(w, bare);
  assert.equal(made.created, true); assert.equal(getResearch(w, made.researchId).question, '直接新建的一篇');
  assert.equal(ensureProjectResearch(w, bare).researchId, made.researchId);

  // 情报加入选题：建出内容，构思预填切入方向、读者价值、待补项；重试不重复建；加入已有选题追加清单。
  const p = saveIntelligenceProfile(w, { name: '内容工作区', query: 'AI', providers: ['web'], output: 'briefs' }), run = enqueueIntelligence(w, p.id);
  const quote = 'GPT-6 Sol halves the API price.';
  const source = addIntelligenceSource(w, { title: 'GPT-6 Sol', body: `${quote} Caching controls are stricter.`, url: 'https://example.com/sol', provider: 'web', readLevel: 'original' }, run.id);
  const brief = saveIntelligenceBriefs(w, run.id, [{ storyKey: 'sol', title: 'OpenAI 发布 GPT-6 Sol', summary: 'API 价格减半。', whyItMatters: '调用成本变了。', reason: '成本', body: '价格减半。', confidence: 'watch', kind: 'practice', evidence: [{ sourceId: source.id, quote }], uncertainties: ['幻觉率只有官方数据'], claims: [] }]).saved[0];
  const input = { operationId: '7f0c1a52-3f0e-4d6b-9a57-2b1d6c0e9f11', briefIds: [brief.id], confirmed: true, creation: { angle: '讲清 GPT-6 Sol 降价后的成本账', window: '24h', readerValue: '帮读者估算调用成本', needs: ['官方价格表'] } };
  const added = createIntelligenceTopicIntent(w, input);
  assert.ok(added.projectId);
  assert.equal(createIntelligenceTopicIntent(w, input).projectId, added.projectId, '重试不重复建');
  const plan = getProjectNotebook(w, added.projectId);
  assert.equal(plan.thought, '讲清 GPT-6 Sol 降价后的成本账');
  assert.equal(plan.intent, '帮读者估算调用成本');
  assert.deepEqual(openItems(plan.questions), ['官方价格表', '幻觉率只有官方数据']);
  const more = createIntelligenceTopicIntent(w, { ...input, operationId: '1b7a1c52-3f0e-4d6b-9a57-2b1d6c0e9f12', researchId: added.research.id, creation: { ...input.creation, needs: ['第三方实测'] } });
  assert.equal(more.projectId, added.projectId, '加入已有选题落在同一篇');
  assert.deepEqual(openItems(getProjectNotebook(w, added.projectId).questions), ['官方价格表', '幻觉率只有官方数据', '第三方实测'], '追加、不覆盖');

  // 列表卡片的摘要：来源、建议时效、还缺什么；挂上经历类个人资产后「你的实测」这一项消失。
  const summary = projectPlanSummary(w, added.projectId);
  assert.equal(summary.origin.kind, 'intel'); assert.equal(summary.origin.title, 'OpenAI 发布 GPT-6 Sol'); assert.equal(summary.origin.window, '24h');
  assert.deepEqual(summary.missing, [EXPERIENCE_ITEM, '官方价格表', '幻觉率只有官方数据', '第三方实测']);
  assert.equal(projectPlanSummary(w, added.projectId, { now: Date.now() + 2 * 86400000 }).origin.window, null, '过了建议时效不再显示');
  const asset = savePersonalAsset(w, null, { kind: 'experience', title: '我试了 Sol', body: '用 Sol 跑了一周脚本，账单少了一半。', usage: 'reference', confirmed: true });
  referencePersonalAsset(w, added.projectId, { assetId: asset.id, expectedVersion: asset.version, confirmed: true });
  assert.equal(projectPlanSummary(w, added.projectId).experience, true);
  assert.ok(!projectPlanSummary(w, added.projectId).missing.includes(EXPERIENCE_ITEM));
  assert.equal(projectPlanSummary(w, first.projectId).origin.kind, 'own');
  assert.equal(projectDto(w, added.projectId).plan.origin.kind, 'intel', '项目详情带上摘要');
  assert.equal(getResearch(w, added.research.id).intelligenceIntents[0].brief.whyItMatters, '调用成本变了。');

  // 首页「接着做」：已有对应内容的选题不再单列一行。
  assert.ok(!recentWork(w).some(x => x.id === old.id));
  assert.deepEqual(w.db.pragma('foreign_key_check'), []);
  console.log('content-workspace: checklist, research → content (prefill, idempotent, untouched research), content → research, intel add creates and appends, plan summary (origin, window, missing, experience), home dedupe passed');
} finally {
  w?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
