// 热点事件雷达（2026-09-23）：本地归并、热度、批量判断与缓存、写卡与用户状态、按需深读。
// 独立的临时 XENHO_HOME；模型全部是模拟的。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { addIntelligenceSource, saveIntelligenceProfile, enqueueIntelligence } from '../server/domain/intelligence.mjs';
import { saveIntelligenceAiConsent } from '../server/domain/intelligence-pool.mjs';
import { executeUnifiedBriefs } from '../server/domain/intelligence-unified.mjs';
import { versionedEntities } from '../server/domain/intelligence-events.mjs';
import { intelligenceFeed, feedbackIntelligenceBrief, intelligenceBrief, rankOpportunities } from '../server/domain/intelligence-feed.mjs';
import { setCreatorPlatforms } from '../server/domain/intelligence-pool.mjs';
import { requestDeepen, executeDeepen, deepenState } from '../server/domain/intelligence-deepen.mjs';
import { createIntelligenceTopicIntent } from '../server/domain/intelligence-topic-intents.mjs';

// ── 实体 ──
assert.ok(versionedEntities('Anthropic 发布 Claude Opus 5.5：成本更低').has('opus5.5'));
assert.ok(versionedEntities('Opus 5.5发布：沟通更好').has('opus5.5'), '中英文、有无品牌前缀都能对上');
assert.ok(versionedEntities('OpenAI 发布 GPT-6 Sol 和 GPT-6 Luna').has('gpt6sol'));
assert.ok(!versionedEntities('OpenAI 发布 GPT-6 Astra').has('gpt6sol'), '不同型号不共享实体');
assert.equal(versionedEntities('AI trends in 2026').size, 0, '年份不是型号');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xenho-intel-events-'));
let w;
try {
  w = await openWorkspace({ xenhoHome: root });
  const H = 3600000, now = Date.now(), iso = ms => new Date(ms).toISOString();
  const channel = key => w.db.prepare('SELECT * FROM intel_channels WHERE stable_key=?').get(key);
  let n = 0;
  const add = (key, title, { hours = 2, kind = 'article', metadata = {}, body, root: rootId } = {}) => {
    n++;
    const ch = channel(key);
    const s = addIntelligenceSource(w, { title, body: body || `${title}. Reported details about this AI release and its pricing.`, url: `https://pub${n}.example/story-${n}`, provider: 'web', readLevel: 'summary', publishedAt: iso(now - hours * H) });
    w.db.prepare("UPDATE intel_sources SET channel_id=?,acquisition_identity=?,rights_json=?,origin_kind='external',source_kind=?,content_status='summary_only',root_item_id=?,parent_item_id=?,data_json=json_set(data_json,'$.metadata',json(?)) WHERE id=?")
      .run(ch.id, `test:${n}`, JSON.stringify({ aiAllowed: true, exportAllowed: false }), kind, rootId || null, rootId || null, JSON.stringify(metadata), s.id);
    return s;
  };
  saveIntelligenceAiConsent(w, { publicSources: true, reddit: true });
  const hot = add('aihot.hot_topics', 'Opus 5.5发布：沟通更好、每token价格更低', { hours: 3, kind: 'external_digest', metadata: { stream: 'hot', observation: { id: 'story-opus', rank: 1, sourceCount: 23, signalCount: 16, source: { name: 'X：Claude' } } } });
  const opusCn = add('aihot.selected', 'Anthropic 发布 Claude Opus 5.5：成本比 Opus 5 低 40%', { hours: 2 });
  const opusEn = add('t2.the_verge_ai', 'Anthropic releases Claude Opus 5.5 with lower prices', { hours: 1 });
  const redditPost = add('community.reddit.claudeai', 'Opus 5.5 is great at long refactors', { hours: 1, kind: 'post', metadata: { score: 250, numComments: 80 } });
  const redditComment = add('community.reddit.claudeai', 'Reddit comment', { hours: 0.5, kind: 'comment', body: 'Agreed, the refactor quality with this model is much better than before.', root: redditPost.id });
  const sol = add('aihot.selected', 'OpenAI 发布 GPT-6 Sol 和 GPT-6 Luna，API 价格减半', { hours: 5 });
  const luna = add('t2.techcrunch_ai', 'GPT-6 Luna rolls out to free ChatGPT users', { hours: 4 });
  const astra = add('aihot.selected', 'OpenAI 发布 GPT-6 Astra 基准测试', { hours: 60 });
  const oldAstra = add('aihot.selected', 'OpenAI GPT-6 Astra system card', { hours: 24 * 20 });
  const hn = add('community.hacker_news.best', 'Show HN: A local memory layer for coding agents', { hours: 2, kind: 'post' });
  const ipad = add('t2.the_verge_ai', 'Apple unveils new iPad colors for spring', { hours: 2, body: 'Apple unveiled new colors for the iPad lineup, available in stores next week.' });
  const daily = add('aihot.dailies', 'AI 日报 2026-09-23：Opus 5.5、GPT-6 Sol', { hours: 1, kind: 'external_digest', metadata: { stream: 'daily' } });
  const rabbitA = add('t2.the_decoder', 'Rabbit 停产硬件转做软件', { hours: 6 });
  const rabbitB = add('t2.wired_ai', '兔子公司宣布新的智能体系统', { hours: 5 });

  const profile = saveIntelligenceProfile(w, { name: '事件测试', query: 'AI', providers: ['collected'], output: 'briefs' });
  let judgeCalls = 0, lastJudged = [];
  const judge = { completeJson: async (_env, input) => {
    const d = JSON.parse(input.user);
    if (d.step !== 'event-judge') throw Error('unexpected model task ' + d.step);
    judgeCalls++; lastJudged = d.events;
    const idOf = t => d.events.find(e => e.items.some(i => i.title.includes(t)))?.id;
    return { data: { events: d.events.map(e => {
      const title = e.items[0].title;
      const hotOne = e.items.some(i => /Opus 5\.5|GPT-6 Sol/.test(i.title));
      return { id: e.id, keep: !title.includes('iPad'), kind: e.kindHint, title: `中文：${title.slice(0, 30)}`, summary: '两句概要。只写输入里的事实。', whyItMatters: '对选型有影响', mergeInto: title.includes('兔子公司') ? idOf('Rabbit') : null,
        creation: { value: hotOne ? 'high' : /Rabbit|兔子/.test(title) ? 'low' : 'medium', window: hotOne ? '24h' : 'week', zhGap: 'large', handsOn: 'available', reason: '理由', formats: [{ platform: 'x', form: '快评线程', angle: '一句角度' }, { platform: 'xhs', form: '教程', angle: '不在主战场' }, { platform: 'wechat', form: '深度解读', angle: '讲清成本变化' }] } };
    }) } };
  } };
  const run = enqueueIntelligence(w, profile.id);
  const result = await executeUnifiedBriefs(w, {}, run.id, judge);
  assert.notEqual(result.status, 'queued', '一次跑完，不分轮等待');
  assert.equal(judgeCalls, 1, '所有事件一次批量判断');
  assert.ok(!lastJudged.some(e => e.items.some(i => i.title.includes('AI 日报'))), '日报汇编不当成事件');

  const feed = () => intelligenceFeed(w);
  const cardWith = id => feed().briefs.find(b => b.event?.members?.some(m => m.sourceId === id));
  const opus = cardWith(opusEn.id);
  assert.ok(opus, 'Opus 5.5 事件出卡');
  for (const id of [hot.id, opusCn.id, redditPost.id, redditComment.id]) assert.ok(opus.event.members.some(m => m.sourceId === id), '同一事件的报道、帖子和评论归到一张卡');
  assert.equal(opus.event.sourceCount, 23, '沿用 AIhot 聚合的来源数');
  assert.ok(opus.event.discussionCount >= 2);
  assert.equal(opus.depth, 'headline'); assert.equal(opus.editorialState, 'ready');
  assert.ok(opus.evidence.every(e => e.headline), '热点卡引文来自来源原文');
  const solCard = cardWith(sol.id);
  assert.ok(solCard && solCard.event.members.some(m => m.sourceId === luna.id), 'GPT-6 Sol 与 Luna 的报道合并');
  const astraCard = cardWith(astra.id);
  assert.ok(astraCard && astraCard.id !== solCard.id, '相隔两天以上的不同型号不合并');
  assert.equal(cardWith(oldAstra.id), undefined, '20 天前的资料不出卡');
  assert.equal(cardWith(ipad.id), undefined, '模型判为无关的不出卡'); assert.equal(cardWith(daily.id), undefined);
  assert.equal(cardWith(hn.id)?.event.kind, 'discussion', '没有对应新闻的社区帖子成为社区热议');
  const rabbit = cardWith(rabbitA.id);
  assert.ok(rabbit && rabbit.event.members.some(m => m.sourceId === rabbitB.id), '模型指出的漏合并生效');
  assert.equal(feed().briefs.filter(b => b.event?.members?.some(m => m.sourceId === rabbitB.id)).length, 1);
  assert.equal(feed().recommendationIds[0], opus.id, '最热的事件排在最前');
  // ── 创作判断：白名单过滤、只在主战场里给做法；「今天值得做」排除低价值 ──
  assert.equal(opus.event.creation.value, 'high');
  assert.deepEqual(opus.event.creation.formats.map(f => f.platform), ['x', 'wechat'], '不在主战场的平台被过滤');
  assert.ok(judge && lastJudged.length && JSON.parse(JSON.stringify(lastJudged[0])).zhSources !== undefined, '判断输入带中文来源数');
  const opportunities = feed().opportunityIds;
  assert.equal(opportunities[0] === opus.id || opportunities[0] === solCard.id, true, '高价值、抢时效的事件排在前面');
  assert.ok(!opportunities.includes(rabbit.id), '低价值事件不进今天值得做');
  assert.deepEqual(rankOpportunities(feed().briefs, { platform: 'video' }), [], '按平台筛选：没有适合视频的做法');

  // ── 重跑：成员不变不重判、不重复出卡；主战场改变后重判一次 ──
  const count = feed().briefs.length, callsBefore = judgeCalls;
  await executeUnifiedBriefs(w, {}, enqueueIntelligence(w, profile.id).id, judge);
  assert.equal(judgeCalls, callsBefore, '成员不变的事件用缓存，不再调用模型');
  assert.equal(feed().briefs.length, count);
  setCreatorPlatforms(w, ['wechat', 'x', 'xhs']);
  await executeUnifiedBriefs(w, {}, enqueueIntelligence(w, profile.id).id, judge);
  assert.equal(judgeCalls, callsBefore + 1, '主战场变了重判一次');
  assert.ok(intelligenceBrief(w, opus.id).event.creation.formats.some(f => f.platform === 'xhs'));
  await executeUnifiedBriefs(w, {}, enqueueIntelligence(w, profile.id).id, judge);
  assert.equal(judgeCalls, callsBefore + 1, '之后照常用缓存');
  setCreatorPlatforms(w, ['wechat', 'x', 'video']);
  await executeUnifiedBriefs(w, {}, enqueueIntelligence(w, profile.id).id, judge);

  // ── 新成员：同一张卡更新，收藏和已读保留 ──
  feedbackIntelligenceBrief(w, opus.id, { saved: true, read: true });
  const opusNew = add('t2.the_decoder', 'Claude Opus 5.5 tops coding benchmarks', { hours: 0.2 });
  await executeUnifiedBriefs(w, {}, enqueueIntelligence(w, profile.id).id, judge);
  const grown = intelligenceBrief(w, opus.id);
  assert.ok(grown.event.members.some(m => m.sourceId === opusNew.id));
  assert.ok(grown.version > opus.version); assert.equal(grown.saved, true); assert.equal(grown.read, true, '事件长大不算没读过');
  assert.equal(feed().briefs.length, count, '新成员不产生新卡');

  // ── 加入选题：热点卡的来源只挂链接 ──
  const topic = createIntelligenceTopicIntent(w, { operationId: 'event-topic', briefIds: [opus.id], confirmed: true });
  assert.ok(topic.research.id);
  // 按做法加入：记下平台、形式、角度和截止时间；重试复用，换做法另建。
  const asX = { platform: 'x', form: '快评线程', angle: '讲清 Opus 5.5 贵在哪便宜在哪', window: '24h' };
  const xTopic = createIntelligenceTopicIntent(w, { operationId: 'event-x', briefIds: [opus.id], confirmed: true, creation: asX });
  const intent = JSON.parse(w.db.prepare('SELECT data_json FROM intelligence_topic_intents WHERE operation_id=?').get('event-x').data_json);
  assert.equal(intent.creation.platform, 'x'); assert.ok(Date.parse(intent.creation.deadline) - Date.now() < 86400000 + 60000, '抢时效截止时间是一天内');
  assert.equal(xTopic.research.question, asX.angle, '选题问题默认用做法的角度');
  assert.equal(createIntelligenceTopicIntent(w, { operationId: 'event-x', briefIds: [opus.id], confirmed: true, creation: asX }).reused, true, '重试复用');
  const wechat = createIntelligenceTopicIntent(w, { operationId: 'event-wechat', briefIds: [opus.id], confirmed: true, creation: { platform: 'wechat', form: '深度解读', angle: '成本账', window: 'week' } });
  assert.notEqual(wechat.research.id, xTopic.research.id, '换一个做法另建选题');
  assert.throws(() => createIntelligenceTopicIntent(w, { operationId: 'bad', briefIds: [opus.id], confirmed: true, creation: { platform: 'tiktok', form: 'x' } }), e => e.status === 400);

  // ── 按需深读 ──
  const deepen = requestDeepen(w, opus.id);
  assert.equal(deepen.status, 'queued');
  assert.equal(requestDeepen(w, opus.id).status, 'queued', '生成中不重复排队');
  const body = s => w.db.prepare('SELECT json_extract(data_json,\'$.body\') b FROM intel_sources WHERE id=?').get(s.id).b;
  const composeDeps = (bad = false) => ({ completeJson: async (_env, input) => {
    const d = JSON.parse(input.user);
    if (d.step === 'compose') return { data: { briefs: [{ groupKey: d.groups[0].key, storyKey: 'model-tries-new-key', title: 'Anthropic 发布 Claude Opus 5.5', summary: bad ? '价格下降 99%。' : '多家媒体报道新模型，成本比上一代低 40%。', reason: '影响选型', body: '目前只取得摘要：多家媒体报道了发布。', confidence: 'watch', kind: 'update', evidence: [{ sourceId: opusEn.id, quote: body(opusEn).slice(0, 60) }, { sourceId: opusCn.id, quote: body(opusCn).slice(0, 20) }], whyItMatters: '影响选型', audienceTakeaway: '先看官方说明', uncertainties: ['只取得摘要'], suggestedUses: ['对比成本'], claims: [{ text: '媒体报道新模型发布', kind: 'author_report', attribution: '媒体', evidenceIds: ['e1'], limitations: ['仅摘要'] }] }] } };
    if (d.step === 'scope-review') return { data: { reviews: d.candidates.map(c => ({ index: c.index, verdict: 'supported', claims: [{ id: 'c1', verdict: 'supported' }] })) } };
    throw Error('unexpected ' + d.step);
  } });
  let step = await executeDeepen(w, {}, { briefId: opus.id, runId: deepen.runId, sequence: 0 }, composeDeps());
  assert.equal(step.deferred, true, '先补全文');
  assert.ok(w.db.prepare("SELECT count(*) n FROM acquisition_runs WHERE kind='fulltext'").get().n > 0);
  w.db.prepare("UPDATE local_jobs SET status='failed' WHERE kind='acquisition.fulltext'").run();
  step = await executeDeepen(w, {}, { briefId: opus.id, runId: deepen.runId, sequence: 1 }, composeDeps());
  assert.equal(step.saved, true);
  const deep = intelligenceBrief(w, opus.id);
  assert.ok(!body(opusCn).slice(0, 20).includes('40%') && body(opusCn).includes('40%'), '夹具：40% 只在来源全文里');
  assert.equal(deep.depth, 'deep', '数字在所引来源全文里即可通过'); assert.equal(deep.editorialState, 'ready'); assert.ok(deep.event?.members?.length, '深读保留事件信息');
  assert.equal(deep.storyKey, opus.storyKey, '深读不换 storyKey');
  assert.equal(deepenState(w, opus.id).status, 'done');
  assert.equal(requestDeepen(w, opus.id).status, 'done', '生成过就不再花钱');
  // 校验不过：保留热点层并记录原因
  const failing = requestDeepen(w, solCard.id);
  w.db.prepare("UPDATE local_jobs SET status='failed' WHERE kind='acquisition.fulltext'").run();
  await executeDeepen(w, {}, { briefId: solCard.id, runId: failing.runId, sequence: 0 }, composeDeps(true));
  w.db.prepare("UPDATE local_jobs SET status='failed' WHERE kind='acquisition.fulltext'").run();
  await executeDeepen(w, {}, { briefId: solCard.id, runId: failing.runId, sequence: 1 }, composeDeps(true));
  assert.equal(deepenState(w, solCard.id).status, 'failed');
  assert.ok(deepenState(w, solCard.id).error, '失败原因可见');
  assert.equal(intelligenceBrief(w, solCard.id).depth, 'headline', '失败时保留热点层');
  assert.deepEqual(w.db.pragma('foreign_key_check'), []);
  console.log('intelligence-events: entity matching, AIhot seeds, same-event merge, stale/irrelevant/digest exclusion, discussion cards, model merges, judge cache, stable cards with user state, topic handoff, on-demand deep read and failure fallback passed');
} finally {
  w?.close();
  await fs.rm(root, { recursive: true, force: true });
}
