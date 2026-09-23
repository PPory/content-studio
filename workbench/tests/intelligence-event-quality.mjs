// 情报质量收口（2026-09-24）：归并边界、移出、7 天资格与实质进展时间、内容版本重判、「值得做」两条硬规则。
// 独立的临时 XENHO_HOME；模型全部是模拟的。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { addIntelligenceSource, saveIntelligenceProfile, enqueueIntelligence } from '../server/domain/intelligence.mjs';
import { saveIntelligenceAiConsent } from '../server/domain/intelligence-pool.mjs';
import { executeUnifiedBriefs } from '../server/domain/intelligence-unified.mjs';
import { actionKinds, sameEvent, versionedEntities, properEntities, calibrateWorth, splitEventMembers } from '../server/domain/intelligence-events.mjs';
import { intelligenceFeed } from '../server/domain/intelligence-feed.mjs';

// ── 归并边界：同型号只说明可能相关，动作对得上才是同一件事 ──
const doc = (title, hours = 0) => { const grams = new Set(); const t = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); for (let i = 0; i < t.length - 1; i++) grams.add(t.slice(i, i + 2)); return { title, time: Date.now() - hours * 3600000, versioned: versionedEntities(title), proper: properEntities(title), grams, actions: actionKinds(title) }; };
assert.ok(actionKinds('Anthropic 发布 Claude Opus 5.5').has('release'));
assert.ok(actionKinds('Researchers jailbreak Claude Opus 5.5 in minutes').has('security'));
assert.equal(sameEvent(doc('Anthropic 发布 Claude Opus 5.5：成本更低'), doc('Researchers jailbreak Claude Opus 5.5 in minutes')), false, '发布与越狱漏洞是两件事');
assert.equal(sameEvent(doc('Anthropic 发布 Claude Opus 5.5'), doc('Claude Opus 5.5 降价 40%，API 价格更低')), true, '发布与定价是同一次发布的不同角度');
assert.equal(sameEvent(doc('Anthropic releases Claude Opus 5.5'), doc('Opus 5.5 is great at long refactors')), true, '一方看不出动作、另一方是发布：照常合并');
assert.equal(sameEvent(doc('我用 Opus 5.5 搭建了一个自动写周报的工作流'), doc('Claude Opus 5.5 hands-on: first impressions')), true, '都是实践：合并');
assert.equal(sameEvent(doc('我用 Opus 5.5 搭建了一个自动写周报的工作流'), doc('Opus 5.5 is great at long refactors')), false, '实践和一条看不出动作、标题也不像的：不合');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xenho-intel-quality-'));
let w;
try {
  w = await openWorkspace({ xenhoHome: root });
  const H = 3600000, now = Date.now(), iso = ms => new Date(ms).toISOString();
  const channel = key => w.db.prepare('SELECT * FROM intel_channels WHERE stable_key=?').get(key);
  let n = 0;
  const add = (key, title, { hours = 2, kind = 'article', metadata = {}, body } = {}) => {
    n++;
    const s = addIntelligenceSource(w, { title, body: body || `${title}. Reported details about this AI change.`, url: `https://q${n}.example/story-${n}`, provider: 'web', readLevel: 'summary', publishedAt: iso(now - hours * H) });
    w.db.prepare("UPDATE intel_sources SET channel_id=?,acquisition_identity=?,rights_json=?,origin_kind='external',source_kind=?,content_status='summary_only',content_hash=?,data_json=json_set(data_json,'$.metadata',json(?)) WHERE id=?")
      .run(channel(key).id, `q:${n}`, JSON.stringify({ aiAllowed: true, exportAllowed: false }), kind, `hash-${n}`, JSON.stringify(metadata), s.id);
    return s;
  };
  saveIntelligenceAiConsent(w, { publicSources: true, reddit: false });
  const release = add('aihot.selected', 'Anthropic 发布 Claude Opus 5.5：成本更低', { hours: 3 });
  const releaseEn = add('t2.the_verge_ai', 'Anthropic releases Claude Opus 5.5 with lower prices', { hours: 2 });
  const jailbreak = add('t2.techcrunch_ai', 'Researchers jailbreak Claude Opus 5.5 in minutes', { hours: 1 });
  const fiveDays = add('t2.the_decoder', 'Mistral 推出 Devstral 3 编程模型', { hours: 24 * 5 });
  const profile = saveIntelligenceProfile(w, { name: '质量测试', query: 'AI', providers: ['collected'], output: 'briefs' });

  let calls = 0, lastEvents = [], development = 'more_coverage';
  const judge = { completeJson: async (_env, input) => {
    const d = JSON.parse(input.user);
    calls++; lastEvents = d.events;
    return { data: { events: d.events.map(e => ({ id: e.id, keep: true, kind: 'event', title: `中文：${e.items[0].title.slice(0, 24)}`, summary: '概要。', whyItMatters: '意义',
      mergeInto: null, development: e.previous ? development : null, developmentNote: e.previous && development === 'new_facts' ? '这次新增的是官方定价细节' : '',
      creation: { value: 'high', window: '24h', angle: '角度', reason: '理由' } })) } };
  } };
  const update = () => executeUnifiedBriefs(w, {}, enqueueIntelligence(w, profile.id).id, judge);
  const feed = () => intelligenceFeed(w);
  const cardWith = id => feed().briefs.find(b => b.event?.members?.some(m => m.sourceId === id));
  await update();

  // 发布与越狱各自一张卡，互相列为相关事件。
  const releaseCard = cardWith(release.id), jailCard = cardWith(jailbreak.id);
  assert.ok(releaseCard && jailCard && releaseCard.id !== jailCard.id, '同型号的发布和越狱不合并');
  assert.ok(releaseCard.event.members.some(m => m.sourceId === releaseEn.id), '同一次发布的中英文报道仍合并');
  assert.ok(releaseCard.event.related.some(r => r.storyKey === jailCard.storyKey), '同一型号的其它事件列为相关');

  // 7 天资格：第 5 天首次出现的资料也建成事件并参与判断。
  const devstral = cardWith(fiveDays.id);
  assert.ok(devstral, '第 5 天首次出现的资料能建成事件');
  assert.ok(Date.parse(devstral.primaryDate) < now - 4 * 24 * H, '卡片日期是它自己的时间，不冒充新事件');
  assert.ok(feed().recommendationIds.indexOf(devstral.id) > feed().recommendationIds.indexOf(releaseCard.id), '近 72 小时的排在前面');

  // 「值得做」两条硬规则：单来源降为「中」；最多 5 个。
  const single = feed().briefs.find(b => b.id === devstral.id);
  assert.equal(single.event.creation.value, 'medium'); assert.equal(single.event.creation.demoted, 'single_source'); assert.equal(single.event.creation.modelValue, 'high');
  assert.equal(feed().briefs.find(b => b.id === releaseCard.id).event.creation.value, 'high', '多来源的「高」保留');
  // 造 7 个多来源的「高」：只留热度最高的 5 个。
  const fake = [];
  for (let i = 0; i < 7; i++) {
    const data = { storyKey: `fake-${i}`, title: `假事件 ${i}`, summary: '', evidence: [], editorialState: 'ready', depth: 'headline', event: { kind: 'event', heat: 10 + i, sourceCount: 3, discussionCount: 0, latestAt: iso(now - H), progressAt: iso(now - H), members: [], creation: { value: 'high', window: 'week', angle: '', reason: '' } } };
    w.db.prepare("INSERT INTO intel_briefs(id,story_key,run_id,data_json,version,edition_date,created_at,updated_at,editorial_state,freshness_kind) VALUES(?,?,?,?,1,'2026-09-24',?,?,'ready','recent_event')").run(`fake-${i}`, `event:fake-${i}`, releaseCard.runId, JSON.stringify(data), iso(now), iso(now));
    fake.push(`fake-${i}`);
  }
  calibrateWorth(w, { now });
  const highs = feed().briefs.filter(b => b.event?.creation?.value === 'high');
  assert.equal(highs.length, 5, '热点页上同时最多 5 个「值得做」');
  assert.ok(highs.every(b => (b.event.heat || 0) >= 12), '保留热度最高的');
  assert.equal(feed().briefs.find(b => b.id === 'fake-0').event.creation.demoted, 'cap');
  for (const id of fake) w.db.prepare('DELETE FROM intel_briefs WHERE id=?').run(id);
  calibrateWorth(w, { now });
  assert.equal(feed().briefs.find(b => b.id === releaseCard.id).event.creation.value, 'high', '名额空出来后恢复模型原本的判断');

  // 缓存：成员和内容都没变不重判；同一条来源内容变了会重判。
  const before = calls;
  await update(); assert.equal(calls, before, '没变化不调用模型');
  w.db.prepare("UPDATE intel_sources SET content_hash='hash-changed' WHERE id=?").run(releaseEn.id);
  await update(); assert.equal(calls, before + 1, '来源内容版本变了要重判');
  assert.ok(!lastEvents.some(e => e.previous), '成员没变的重判不算「新资料」');

  // 实质进展：只是更多报道不前移时间；新事实前移并写「这次新增的是」。
  const progressBefore = cardWith(release.id).event.progressAt;
  add('t2.wired_ai', 'Claude Opus 5.5 发布，Anthropic 同步更新文档', { hours: 0.5 });
  development = 'more_coverage';
  await update();
  assert.ok(lastEvents.some(e => e.previous?.title), '成员变了时把上一版交给模型对照');
  assert.equal(cardWith(release.id).event.progressAt, progressBefore, '只是更多报道：时间不前移');
  assert.match(cardWith(release.id).changeNote, /新增 \d+ 份报道/);
  add('t2.the_decoder', 'Opus 5.5 发布后公布企业版定价', { hours: 0.2 });
  development = 'new_facts';
  await update();
  const progressed = cardWith(release.id);
  assert.ok(Date.parse(progressed.event.progressAt) > Date.parse(progressBefore), '新事实：时间前移');
  assert.equal(progressed.changeNote, '这次新增的是官方定价细节');
  assert.equal(progressed.primaryDate, progressed.event.progressAt, '卡片日期用实质进展时间');

  // 移出：原卡立即去掉，本地和模型都不会合回去。
  const target = cardWith(release.id);
  assert.throws(() => splitEventMembers(w, target.id, target.event.members.filter(m => m.kind !== 'comment').map(m => m.sourceId)), e => e.status === 409, '不能把来源全部移走');
  const moved = splitEventMembers(w, target.id, [releaseEn.id]);
  assert.deepEqual(moved.moved, [releaseEn.id]);
  assert.ok(!feed().briefs.find(b => b.id === target.id).event.members.some(m => m.sourceId === releaseEn.id), '原卡立即去掉');
  // 模型想把它合回去也不行。
  const mergeBack = { completeJson: async (env, input) => { const r = await judge.completeJson(env, input); const d = JSON.parse(input.user); const splitKey = d.events.find(e => e.items.some(i => i.title.includes('releases Claude Opus 5.5')))?.id; const mainKey = target.storyKey; for (const e of r.data.events) if (e.id === splitKey) e.mergeInto = mainKey; return r; } };
  await executeUnifiedBriefs(w, {}, enqueueIntelligence(w, profile.id).id, mergeBack);
  const split = cardWith(releaseEn.id);
  assert.ok(split && split.id !== target.id, '移出的来源单独成卡，模型的 mergeInto 不能合回去');
  assert.ok(!cardWith(release.id).event.members.some(m => m.sourceId === releaseEn.id), '本地归并也不会把它并回去');
  assert.deepEqual(w.db.pragma('foreign_key_check'), []);
  console.log('intelligence-event-quality: merge boundaries, related events, 7-day eligibility, worth-doing rules, content-version rejudge, progress time, split passed');
} finally {
  w?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
