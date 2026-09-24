// 选题到初稿（2026-09-24）：角度（Wiki 原话逐字核对、经历闸门、缓存）→ 选定写回构思 → 两种结构 + 三个标题 →
// 初稿（正文空时写入、已有正文只给候选、【待补】保留）；加入选题自动排队深读；「来自我的知识」一步建成内容。
// 独立的临时 XENHO_HOME，模型全部模拟。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { saveIntelligenceProfile, enqueueIntelligence, addIntelligenceSource } from '../server/domain/intelligence.mjs';
import { saveIntelligenceBriefs } from '../server/domain/intelligence-feed.mjs';
import { createIntelligenceTopicIntent } from '../server/domain/intelligence-topic-intents.mjs';
import { researchReference } from '../server/domain/research.mjs';
import { getProjectNotebook, saveProjectNotebook } from '../server/domain/project-notebook.mjs';
import { deepenState } from '../server/domain/intelligence-deepen.mjs';
import { planView, proposeAngles, chooseAngle, proposeStructures, chooseStructure, writeDraft } from '../server/domain/content-plan-ai.mjs';
import { projectPlanSummary } from '../server/domain/content-plan.mjs';
import { writeDiscoveryCache } from '../server/domain/content-discovery.mjs';
import { directionKey, directionToContent } from '../server/domain/intelligence-directions.mjs';
import { openItems } from '../src/lib/content-checklist.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xenho-content-plan-'));
let w;
try {
  w = await openWorkspace({ xenhoHome: root });
  const wikiId = 'wiki-core-experience', at = new Date().toISOString();
  w.repository.createEntity({ id: wikiId, type: 'wiki_page' });
  w.db.prepare("INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,current_revision,schema_version,created_at,updated_at) VALUES(?,?,'concept',?,?,1,1,?,?)")
    .run(wikiId, '核心体验', '用户买的是体验', '# 核心体验\n\n受众购买的是买到更省力、更可靠的质量，以及未来多次使用的确定性。', at, at);

  const p = saveIntelligenceProfile(w, { name: '选题流程', query: 'AI', providers: ['web'], output: 'briefs' }), run = enqueueIntelligence(w, p.id);
  const quote = 'GPT-6 Sol halves the API price.';
  const source = addIntelligenceSource(w, { title: 'GPT-6 Sol', body: `${quote} Caching controls are stricter.`, url: 'https://example.com/sol', provider: 'web', readLevel: 'original' }, run.id);
  const brief = saveIntelligenceBriefs(w, run.id, [{ storyKey: 'sol', title: 'OpenAI 发布 GPT-6 Sol', summary: 'API 价格减半。', whyItMatters: '调用成本变了。', reason: '成本', body: '价格减半。', confidence: 'watch', kind: 'practice', evidence: [{ sourceId: source.id, quote }], uncertainties: ['幻觉率只有官方数据'], claims: [] }]).saved[0];
  const added = createIntelligenceTopicIntent(w, { operationId: '5d0c1a52-3f0e-4d6b-9a57-2b1d6c0e9f21', briefIds: [brief.id], confirmed: true, creation: { angle: 'Sol 降价之后', window: 'week', needs: ['官方价格表'] } });
  const projectId = added.projectId;
  assert.equal(deepenState(w, brief.id)?.status, 'queued', '加入选题时自动排队深读');
  researchReference(w, added.research.id, { kind: 'wiki', id: wikiId });

  // 读懂：来自情报。
  const env = {};
  let calls = 0;
  const answers = { angles: null, structures: null, draft: null };
  env.CONTENT_PLAN_COMPLETE_JSON = async (_env, input) => { calls++; if (/写作角度/.test(input.system)) return { data: answers.angles, model: 'mock' }; if (/两种可以照着写的文章结构/.test(input.system)) return { data: answers.structures, model: 'mock' }; throw new Error('unexpected call'); };
  env.CONTENT_PROJECT_COMPLETE_JSON = async (_env, input) => { calls++; assert.match(input.user, /小标题用文章自己的说法/, '初稿要求小标题用文章自己的说法'); return { data: answers.draft, model: 'mock' }; };
  const view0 = planView(w, env, projectId);
  assert.equal(view0.read.kind, 'intel'); assert.equal(view0.read.brief.title, 'OpenAI 发布 GPT-6 Sol');
  assert.ok(view0.wiki.some((x) => x.id === wikiId), '研究里挂的 Wiki 进入这篇的知识');

  // 角度：原话逐字的保留 Wiki 连接，不逐字的去掉连接但保留角度；没有经历时「讲经历」补上 exp 缺口；编了作者经历的角度丢掉。
  answers.angles = { angles: [
    { how: 'knowledge', title: '模型没变聪明，为什么说是大更新', was: '新模型等于更聪明', is: '卖点换成了可预期', audience: '选模型的人', gain: '看懂厂商在卖什么', wiki: { id: wikiId, quote: '买到更省力、更可靠的质量，以及未来多次使用的确定性', how: '用买手机看续航打比方' }, gaps: [{ label: '一个真实账单例子', why: '要有一笔账', kind: 'find', where: ['OpenAI 定价页'] }] },
    { how: 'judgment', title: '降价一半不等于成本减半', was: '价格减半成本就减半', is: '成本看缓存和返工', audience: '用 API 的人', gain: '会算真实成本', wiki: { id: wikiId, quote: '这句话笔记里没有', how: 'x' }, gaps: [] },
    { how: 'experience', title: '换成 Sol 跑三天', was: '不知道换不换', is: '我上周尝试了用 Sol 跑脚本，账单少一半', audience: '开发者', gain: '换不换的判断', wiki: null, gaps: [] },
  ] };
  let view = await proposeAngles(env, w, { projectId });
  const angles = view.plan.angles.items;
  assert.equal(calls, 1);
  assert.equal(angles.length, 2, '编造作者经历的角度被丢掉');
  assert.equal(angles[0].wiki.quote, '买到更省力、更可靠的质量，以及未来多次使用的确定性');
  assert.equal(angles[1].wiki, null, '原话对不上就去掉 Wiki 连接');
  answers.angles.angles[2].is = '用自己的工作流跑一遍看账单';
  view = await proposeAngles(env, w, { projectId, force: true });
  const exp = view.plan.angles.items.find((a) => a.how === 'experience');
  assert.ok(exp.gaps.some((g) => g.kind === 'exp'), '没有经历时讲经历的角度必须带 exp 缺口');
  assert.equal(calls, 2);
  await proposeAngles(env, w, { projectId });
  assert.equal(calls, 2, '资料没变不再调用模型');

  // 选定角度：写回构思，find 缺口追加进清单，已有清单不覆盖。
  const before = getProjectNotebook(w, projectId).questions;
  chooseAngle(w, projectId, { angleId: 'a1' });
  const nb = getProjectNotebook(w, projectId);
  assert.match(nb.thought, /模型没变聪明/); assert.equal(nb.audience, '选模型的人'); assert.equal(nb.intent, '看懂厂商在卖什么');
  assert.ok(nb.questions.startsWith(before.trim()), '已有清单不覆盖');
  assert.ok(openItems(nb.questions).includes('一个真实账单例子'));
  assert.equal(nb.plan.chosenAngle.id, 'a1');
  assert.equal(projectPlanSummary(w, projectId).stage.key, 'angle');

  // 结构：两种 + 三个标题；认不出的材料引用丢掉，不让整份结构失败。
  answers.structures = { structures: [
    { name: '现象 → 误解 → 解释 → 怎么选', fit: '知识型', sections: [{ heading: '开头：一次不变聪明的更新', purpose: '抛出问题', uses: ['nope'] }, { heading: '其实：卖点换了', purpose: '讲价格和缓存', uses: [] }] },
    { name: '一个问题讲透', fit: '抢时效', sections: [{ heading: '结论', purpose: '一句话结论', uses: [] }] },
  ], titles: [{ text: '模型没变聪明，为什么说是大更新？', why: '问题式' }, { text: '降价一半', why: '判断' }, { text: '跑分不涨', why: '反差' }] };
  view = await proposeStructures(env, w, { projectId });
  assert.equal(view.plan.structures.items.length, 2); assert.equal(view.plan.structures.titles.length, 3);
  chooseStructure(w, projectId, { structure: 0, title: 0 });
  assert.throws(() => chooseStructure(w, projectId, { structure: 5, title: 0 }), (e) => e.status === 409);

  // 初稿：正文空着时直接写进主稿，【待补】保留；再写一次（正文已有字）只给候选，不动正文。
  answers.draft = { title: '模型没变聪明，为什么说是大更新？', body_markdown: '## 跑分没动，价格砍了一半\n\n价格减半。\n\n## 对你来说该看什么\n\n【待补：一个真实账单例子】', note: '' };
  const first = await writeDraft(env, w, { projectId });
  assert.equal(first.written, true); assert.equal(first.gaps, 1);
  const master = () => w.db.prepare('SELECT d.body_markdown body FROM drafts d JOIN project_primary_drafts p ON p.draft_id=d.id AND p.project_id=?').get(projectId).body;
  assert.match(master(), /【待补：一个真实账单例子】/);
  assert.equal(projectPlanSummary(w, projectId).stage.key, 'draft');
  const second = await writeDraft(env, w, { projectId });
  assert.equal(second.written, false); assert.ok(second.candidate.body.includes('跑分没动'));
  assert.match(master(), /【待补/, '已有正文不被覆盖');

  // 换了角度，旧结构作废。
  chooseAngle(w, projectId, { own: '我自己的一个角度' });
  assert.equal(getProjectNotebook(w, projectId).plan.structures, null);

  // 「来自我的知识」：扫描找到的连接一步建成内容，读懂那一步是知识型。
  const connection = { problem: { statement: '写到一半就卡住，是不是没天赋？', origin: 'hypothesis', evidence: [] }, knowledgeExplanation: '大脑把生理唤醒误读成我不行。', coreClaim: '卡住不是没天赋', cognitiveGap: '以为卡住就是没天赋', fitReason: '符合议程', knowledgeAnchors: [{ wikiPageId: wikiId, title: '核心体验', reason: '示例' }], basis: [], evidenceGaps: [] };
  writeDiscoveryCache(w, { scannedAt: at, connections: [connection], fingerprint: 'x' });
  const made = directionToContent(w, directionKey(connection));
  assert.equal(directionToContent(w, directionKey(connection)).projectId, made.projectId, '重复加入是同一篇');
  const kv = planView(w, env, made.projectId);
  assert.equal(kv.read.kind, 'bridge'); assert.equal(kv.read.hypothesis, true); assert.equal(kv.read.core, '卡住不是没天赋');
  assert.equal(projectPlanSummary(w, made.projectId).origin.kind, 'bridge');
  assert.deepEqual(w.db.pragma('foreign_key_check'), []);
  console.log('content-plan-ai: auto deepen, read (intel/bridge), angles (verbatim wiki, experience gate, cache), choose angle, structures + titles, draft (write when empty, candidate otherwise, 待补 kept), knowledge → content passed');
} finally {
  w?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
