// 2026-09-23 情报「新资料进卡片」：7 天新鲜度、情报池、一次性授权、预算、补采窗口、Reddit 额度与保留期。
// 全部在系统临时目录的独立 XENHO_HOME 里跑；模型和 Bright Data 都是模拟的。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { getChannel, commitPage, redactSource } from '../server/acquisition/store.mjs';
import { startAcquisitionBatch } from '../server/acquisition/batches.mjs';
import { enqueueAcquisition } from '../server/acquisition/runner.mjs';
import { trigger, BrightDataError } from '../server/acquisition/providers/brightdata.mjs';
import { errorStatus } from '../server/acquisition/health.mjs';
import { visibleDerived } from '../server/acquisition/compatibility.mjs';
import { intelligenceAiConsent, saveIntelligenceAiConsent, sourceIsFresh, inIntelligencePool, RECOMMEND_WINDOW_MS } from '../server/domain/intelligence-pool.mjs';
import { rankIntelligenceBriefs, briefRecency, saveIntelligenceBriefs, scheduleIntelligenceAutoUpdate, saveIntelligenceSettings } from '../server/domain/intelligence-feed.mjs';
import { reconcileUnifiedSources, executeUnifiedBriefs, UNIFIED_BUDGET } from '../server/domain/intelligence-unified.mjs';
import { saveIntelligenceProfile, enqueueIntelligence, addIntelligenceSource } from '../server/domain/intelligence.mjs';

const DAY = 86400000, NOW = Date.parse('2026-09-23T04:00:00.000Z');
const iso = ms => new Date(ms).toISOString();

// ── 推荐排序（纯函数，固定时钟）────────────────────────────────
{
  const brief = (id, ageDays, patch = {}) => ({ id, editorialState: 'ready', dismissed: false, read: false, kind: 'update', storyKey: id, recencyAt: ageDays === null ? null : iso(NOW - ageDays * DAY), updatedAt: iso(NOW), quality: { independentEvidenceCount: 1 }, suggestedUses: [], sourceMeta: [{ originKind: 'external', publisherKey: `pub-${id}` }], sourceGroups: ['t2_media'], ...patch });
  const fresh = ids => rankIntelligenceBriefs(ids, null, 100, { fresh: true, now: NOW });
  const list = [brief('six-days', 6), brief('eight-days', 8), brief('unknown', null), brief('future', -1)];
  assert.deepEqual(fresh(list), ['six-days'], '只推荐 7 天内、发布时间已知、不在未来的卡');
  assert.deepEqual(rankIntelligenceBriefs([brief('six-days', 6)], null, 100, { fresh: true, now: NOW + 2 * DAY }), [], '卡片自然过期后退出推荐，不需要重新调用模型');
  const banded = [brief('old-strong', 5, { quality: { independentEvidenceCount: 5 }, suggestedUses: ['a', 'b', 'c'] }), brief('today-weak', 0.2)];
  assert.deepEqual(fresh(banded), ['today-weak', 'old-strong'], '先按时效分档，档内才看证据');
  const samePublisher = Array.from({ length: 10 }, (_, i) => brief(`same-${i}`, 0.1 + i * 0.01, { sourceMeta: [{ originKind: 'external', publisherKey: 'one.example' }], sourceGroups: [`g${i}`] }));
  const others = Array.from({ length: 8 }, (_, i) => brief(`other-${i}`, 2, { sourceGroups: [`h${i}`] }));
  const ranked = fresh([...samePublisher, ...others]);
  assert.equal(ranked.length, 18, '多样性只调整顺序，不丢卡');
  assert.equal(ranked.slice(0, 8).filter(id => id.startsWith('same-')).length, 2, '超过 8 张时同一发布方在首批仍最多 2 张');
  const groups = Array.from({ length: 6 }, (_, i) => brief(`reddit-${i}`, 0.1, { sourceGroups: ['community'] })).concat(Array.from({ length: 5 }, (_, i) => brief(`media-${i}`, 1, { sourceGroups: ['t2_media'] })), Array.from({ length: 5 }, (_, i) => brief(`aihot-${i}`, 1.5, { sourceGroups: ['aihot'] })));
  assert.equal(fresh(groups).slice(0, 8).filter(id => id.startsWith('reddit-')).length, 3, '有其他类别可选时，首批同一信源类别最多 3 张');
  assert.equal(fresh(groups.slice(0, 11)).slice(0, 8).length, 8, '其他类别不够时由超额的补满，不空位');

  const recency = briefRecency([
    { sourceKind: 'post', contentKind: 'post', publishedAt: iso(NOW - 20 * DAY) },
    { sourceKind: 'comment', contentKind: 'comment', publishedAt: iso(NOW - DAY) },
  ]);
  assert.equal(recency.primaryDate, iso(NOW - 20 * DAY), '新评论不给旧帖子重新计时');
  const deep = briefRecency([{ sourceKind: 'article', publishedAt: iso(NOW - 40 * DAY), readingScope: 'deep', upstreamFirstSeenAt: iso(NOW - DAY) }]);
  assert.equal(deep.primaryDate, iso(NOW - 40 * DAY), '深读显示原文日期');
  assert.equal(deep.recencyAt, iso(NOW - DAY), '深读按首次出现时间进推荐');
  assert.equal(deep.deepRead, true);
  assert.deepEqual(fresh([brief('deep-read', 0.1, { deepRead: true }), brief('news', 5)]), ['news', 'deep-read'], '深读排在所有新闻之后');

  assert.equal(sourceIsFresh({ publishedAt: iso(NOW - 3 * DAY) }, { now: NOW }), true);
  assert.equal(sourceIsFresh({ publishedAt: iso(NOW - 8 * DAY) }, { now: NOW }), false);
  assert.equal(sourceIsFresh({ publishedAt: null }, { now: NOW }), false, '发布时间未知不算新');
  assert.equal(inIntelligencePool({ source_group: 'community', platform: 'arxiv' }), false);
  assert.equal(inIntelligencePool({ source_group: 'community', platform: 'hacker_news' }), true);
}

// ── Bright Data 额度用尽 ─────────────────────────────────────
{
  const error = await trigger('key', 'dataset', [{ url: 'https://www.reddit.com/r/test/' }], { fetchImpl: async () => new Response('Insufficient balance', { status: 402 }) }).catch(e => e);
  assert.ok(error instanceof BrightDataError);
  assert.equal(error.code, 'quota_exhausted'); assert.equal(error.retry, false); assert.notEqual(error.blocked, true, '额度不足不是凭据问题，不能把频道标成 blocked');
  assert.equal(errorStatus(error), 'QUOTA_EXHAUSTED');
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xenho-intel-freshness-'));
let w;
try {
  w = await openWorkspace({ xenhoHome: root });
  const now = Date.now();
  const channelRow = key => w.db.prepare('SELECT * FROM intel_channels WHERE stable_key=?').get(key);
  const arxiv = w.db.prepare("SELECT * FROM intel_channels WHERE platform='arxiv' LIMIT 1").get();
  const reddit = channelRow('community.reddit.localllama'), media = channelRow('t2.the_decoder');
  assert.ok(arxiv && reddit && media, 'catalog channels exist');

  // ── 一次性授权：只回填 7 天内资料，撤权覆盖全部；Reddit 不写通用 aiAllowed ──
  const acquired = (channel, identity, publishedAt, patch = {}) => {
    const source = addIntelligenceSource(w, { title: `LLM agent report ${identity}`, body: `The language model agent report ${identity} describes a measured evaluation with limited scope.`, url: `https://news.example/${identity}`, provider: 'web', readLevel: 'original', publishedAt, ...patch });
    w.db.prepare("UPDATE intel_sources SET channel_id=?,acquisition_identity=?,rights_json=?,origin_kind='external' WHERE id=?").run(channel.id, identity, JSON.stringify({ aiAllowed: false, exportAllowed: false }), source.id);
    return source;
  };
  const recent = acquired(media, 'recent', iso(now - DAY)), old = acquired(media, 'old', iso(now - 10 * DAY));
  assert.equal(intelligenceAiConsent(w).publicSources, false, '默认未授权');
  saveIntelligenceAiConsent(w, { publicSources: true, reddit: false });
  const rights = id => JSON.parse(w.db.prepare('SELECT rights_json FROM intel_sources WHERE id=?').get(id).rights_json);
  assert.equal(rights(recent.id).aiAllowed, true); assert.equal(rights(old.id).aiAllowed, false, '授权不回填 7 天前的积压');
  assert.equal(JSON.parse(channelRow('t2.the_decoder').options_json).aiAllowed, true, '之后入库的资料跟随频道授权');
  assert.notEqual(JSON.parse(channelRow('community.reddit.localllama').options_json).aiAllowed, true, 'Reddit 不写通用 aiAllowed');
  saveIntelligenceAiConsent(w, { publicSources: false, reddit: false });
  assert.equal(rights(recent.id).aiAllowed, false, '撤回授权必须完整');
  saveIntelligenceAiConsent(w, { publicSources: true, reddit: true });

  // ── Reddit 入库：只有授权 + 已批准付费采集才允许交给模型；导出始终禁止 ──
  const redditChannel = (consent) => { const c = getChannel(w, 'community.reddit.localllama'); c.access_status = 'approved'; c.options = { ...c.options, aiAllowed: true, redditAiConsent: consent }; return c; };
  const redditItem = (identity, patch = {}) => ({ identity, title: 'Local agents on small GPUs', url: `https://www.reddit.com/r/LocalLLaMA/comments/${identity}/x/`, body: 'Running a local LLM agent on a small GPU needs careful quantization; I measured latency across three setups.', summary: '', sourceKind: 'post', platform: 'reddit', readLevel: 'original', contentStatus: 'full_text', publishedAt: iso(now - 3600000), rights: { aiAllowed: false, exportAllowed: false }, metadata: {}, ...patch });
  const page = items => ({ items, checkpoint: {}, partition: 'default', outcome: 'success', coverage: {} });
  const noConsent = commitPage(w, redditChannel(false), page([redditItem('t3_noconsent')])).ids[0];
  assert.equal(rights(noConsent).aiAllowed, false, '通用 aiAllowed 不能放开 Reddit');
  const post = commitPage(w, redditChannel(true), page([redditItem('t3_post')])).ids[0];
  assert.equal(rights(post).aiAllowed, true); assert.equal(rights(post).exportAllowed, false);
  const comment = commitPage(w, redditChannel(true), page([redditItem('t1_comment', { sourceKind: 'comment', title: 'Reddit comment', body: 'In my test the 4-bit agent was twice as fast but missed tool calls more often than the 8-bit one.' })])).ids[0];
  w.db.prepare('UPDATE intel_sources SET root_item_id=?,parent_item_id=? WHERE id=?').run(post, post, comment);

  // ── 统一整理：池外、过期、评论上下文、预算与配额 ──
  const outside = acquired(arxiv, 'arxiv-paper', iso(now - DAY));
  const staleMedia = acquired(media, 'stale-media', iso(now - 9 * DAY));
  saveIntelligenceAiConsent(w, { publicSources: true, reddit: true });
  const quota = UNIFIED_BUDGET.quota.t2_media;
  for (let i = 0; i < quota + 5; i++) acquired(media, `media-${i}`, iso(now - (i + 2) * 3600000));
  saveIntelligenceAiConsent(w, { publicSources: true, reddit: true });
  const profile = saveIntelligenceProfile(w, { name: '新鲜度测试', query: 'AI', providers: ['collected'], output: 'briefs' });
  const run = enqueueIntelligence(w, profile.id);
  const classified = [], composeSources = [];
  const deps = { completeJson: async (_env, input) => {
    const d = JSON.parse(input.user);
    if (d.material) { classified.push(d.material); const quote = d.material.match(/The language model agent report[^.]+\.|Running a local LLM agent[^;]+/)[0]; return { data: { relevance: 'ai_relevant', reason: '讨论模型智能体', evidence: [quote], title: '模型智能体评测', guideClaims: [{ text: '作者报告评测', quotes: [quote] }], topic: 'AI', uncertainties: [] } }; }
    if (d.step === 'organize') { composeSources.push(...d.sources.map(s => s.id)); return { data: { groups: [] } }; }
    throw Error('unexpected model task');
  } };
  let result = await executeUnifiedBriefs(w, {}, run.id, deps);
  for (let guard = 0; result.status === 'queued' && guard < 30; guard++) result = await executeUnifiedBriefs(w, {}, run.id, deps);
  assert.notEqual(result.status, 'queued', '预算用完后本次更新结束，不空转');
  const status = id => w.db.prepare('SELECT status FROM intel_unified_sources WHERE source_id=?').get(id)?.status;
  assert.equal(status(outside.id), 'out_of_scope'); assert.equal(status(staleMedia.id), 'stale'); assert.equal(status(old.id), 'stale');
  assert.equal(status(comment), 'context', 'Reddit 评论不单独做语义判断');
  assert.ok(!classified.some(m => m.includes('twice as fast')), '评论没有单独花模型调用');
  const mediaCalls = classified.filter(m => /agent report (media-\d+|recent) /.test(m)).length;
  assert.equal(mediaCalls, quota, `T2 媒体每次更新最多 ${quota} 次语义判断`);
  assert.ok(classified.length <= UNIFIED_BUDGET.semantic);
  assert.equal(w.db.prepare("SELECT count(*) n FROM intel_unified_sources WHERE status='semantic_pending'").get().n, 6, '超出配额的资料留到下次（31 份 T2 资料，本次整理 25 份）');
  assert.ok(composeSources.includes(post) && composeSources.includes(comment), '主帖进卡片生成时带上评论作为上下文');
  reconcileUnifiedSources(w);
  assert.equal(status(outside.id), 'out_of_scope', '重复对账保持稳定');

  // ── 期次日期：更新已有卡不改成当天 ──
  const quote = 'The language model agent report recent describes a measured evaluation with limited scope.';
  w.db.prepare('INSERT OR IGNORE INTO intel_run_sources(run_id,source_id) VALUES(?,?)').run(run.id, recent.id);
  const make = (patch = {}) => ({ storyKey: 'edition-check', title: '一次有限范围的智能体评测', summary: '作者报告了有限范围的评测。', reason: '判断评测可信度', body: '作者报告有限范围的评测，结果不能推广。', confidence: 'watch', kind: 'practice', evidence: [{ sourceId: recent.id, quote }], whyItMatters: '评测范围决定结论边界', audienceTakeaway: '先看评测范围', uncertainties: ['样本有限'], suggestedUses: ['核对评测范围'], claims: [{ text: '作者报告有限范围评测', kind: 'author_report', attribution: '作者', evidenceIds: ['e1'], limitations: ['有限范围'] }], ...patch });
  const first = saveIntelligenceBriefs(w, run.id, [make()]).saved[0];
  w.db.prepare("UPDATE intel_briefs SET edition_date='2026-09-01' WHERE id=?").run(first.id);
  const updated = saveIntelligenceBriefs(w, run.id, [make()], [], null, [{ index: 0, verdict: 'supported', claims: [{ id: 'c1', verdict: 'supported' }] }]).saved[0];
  assert.equal(updated.id, first.id); assert.ok(updated.version > first.version);
  assert.equal(w.db.prepare('SELECT edition_date FROM intel_briefs WHERE id=?').get(first.id).edition_date, '2026-09-01', '更新不改写期次日期');

  // ── Reddit 保留期到期：卡片保留摘要、短引文和链接；撤权仍遮罩 ──
  const longQuote = 'Running a local LLM agent on a small GPU needs careful quantization';
  const briefData = { title: '小显卡上的本地智能体', summary: '作者比较了三种量化设置。', body: '正文', evidence: [{ sourceId: post, quote: longQuote + ' '.repeat(10) + 'x'.repeat(300) }] };
  w.db.prepare("INSERT INTO intel_briefs(id,story_key,run_id,data_json,version,edition_date,created_at,updated_at) VALUES('retire-brief','retire',?,?,1,'2026-09-23',?,?)").run(run.id, JSON.stringify(briefData), iso(now), iso(now));
  redactSource(w, post, 'retention_expired', { tombstone: false });
  const kept = JSON.parse(w.db.prepare("SELECT data_json FROM intel_briefs WHERE id='retire-brief'").get().data_json);
  assert.equal(kept.summary, briefData.summary, '保留期到期不抹掉卡片摘要');
  assert.ok(kept.evidence[0].quote.length <= 200 && kept.evidence[0].sourceRetired === true && kept.evidence[0].url.includes('reddit.com'));
  assert.notEqual(visibleDerived(w, kept).contentRestricted, true, '到期不是撤权');
  assert.ok(JSON.parse(w.db.prepare('SELECT data_json FROM intel_sources WHERE id=?').get(post).data_json).publishedAt, '清除原文后仍保留发布时间');
  assert.ok(!JSON.stringify(w.db.prepare('SELECT data_json FROM intel_sources WHERE id=?').get(post)).includes('careful quantization'), '原文已清除');
  w.db.prepare("UPDATE intel_sources SET rights_json=? WHERE id=?").run(JSON.stringify({ aiAllowed: false }), recent.id);
  assert.equal(visibleDerived(w, { title: 'x', summary: 'y', evidence: [{ sourceId: recent.id, quote }] }).contentRestricted, true, '撤回 AI 许可仍遮罩');

  // ── 补采窗口与 Reddit 一天一次 ──
  const finishRun = (channel, windowEnd, startedAt = iso(now - DAY)) => {
    const r = enqueueAcquisition(w, channel.id, { trigger: 'test', slot: `test:${channel.id}:${windowEnd}` });
    w.db.prepare("UPDATE acquisition_runs SET status='completed',window_end_at=?,started_at=?,finished_at=? WHERE id=?").run(windowEnd, startedAt, startedAt, r.id);
    w.db.prepare("UPDATE local_jobs SET status='done' WHERE id=?").run(r.job_id);
  };
  const decoder = channelRow('t2.the_decoder'), verge = channelRow('t2.the_verge_ai');
  finishRun(decoder, iso(now - 3 * DAY));
  finishRun(verge, iso(now - 30 * DAY));
  finishRun(reddit, iso(now - 3600000), iso(now - 3600000));
  w.db.prepare("UPDATE intel_channels SET desired_enabled=1,user_disabled=0 WHERE platform='reddit'").run();
  const batch = startAcquisitionBatch(w, { confirmed: true });
  const startOf = id => w.db.prepare('SELECT window_start_at FROM acquisition_runs WHERE batch_id=? AND channel_id=?').get(batch.id, id)?.window_start_at;
  const end = Date.parse(w.db.prepare('SELECT window_end_at FROM acquisition_batches WHERE id=?').get(batch.id).window_end_at);
  assert.equal(startOf(decoder.id), iso(now - 3 * DAY - 2 * 3600000), '从上次成功覆盖处接着采，留 2 小时重叠');
  assert.equal(Date.parse(startOf(verge.id)), end - RECOMMEND_WINDOW_MS, '最多回溯 7 天');
  assert.equal(startOf(reddit.id), undefined, 'Reddit 20 小时内不重复采集');
  assert.ok(startOf(channelRow('community.reddit.machinelearning').id), '其他 Reddit 社区照常');
  assert.equal(startOf(arxiv.id), undefined, 'arXiv 不再随更新情报采集');

  // ── 自动更新：授权后才生效，6 小时内不重复 ──
  assert.equal(scheduleIntelligenceAutoUpdate(w, { now: new Date() }), null, '已有进行中的批次时不重复触发');
  w.db.prepare("UPDATE local_jobs SET status='done' WHERE status IN ('queued','retry','running')").run();
  w.db.prepare("UPDATE intel_runs SET status='done'").run();
  w.db.prepare('UPDATE acquisition_batches SET started_at=?').run(iso(now - 7 * 3600000));
  saveIntelligenceSettings(w, { autoUpdate: false });
  assert.equal(scheduleIntelligenceAutoUpdate(w, { now: new Date() }), null, '关闭自动更新后不触发');
  saveIntelligenceSettings(w, { autoUpdate: true });
  const auto = scheduleIntelligenceAutoUpdate(w, { now: new Date() });
  assert.ok(auto?.id, '超过 6 小时自动更新一次');
  assert.equal(w.db.prepare('SELECT trigger_kind FROM acquisition_batches ORDER BY started_at DESC LIMIT 1').get().trigger_kind, 'schedule');
  saveIntelligenceAiConsent(w, { publicSources: false, reddit: false });
  w.db.prepare("UPDATE intel_runs SET status='done'").run();
  w.db.prepare('UPDATE acquisition_batches SET started_at=?').run(iso(now - 7 * 3600000));
  assert.equal(scheduleIntelligenceAutoUpdate(w, { now: new Date() }), null, '未授权时不自动更新');

  // ── 授权触发完整更新（含采集）──
  w.db.prepare("UPDATE intel_runs SET status='done'").run();
  w.db.prepare("UPDATE local_jobs SET status='done' WHERE status IN ('queued','retry','running')").run();
  const batchesBefore = w.db.prepare('SELECT count(*) n FROM acquisition_batches').get().n;
  assert.ok(saveIntelligenceSettings(w, { publicSources: true }).run?.id, '授权后立即更新');
  assert.equal(w.db.prepare('SELECT count(*) n FROM acquisition_batches').get().n, batchesBefore + 1, '授权后的更新包含采集');
  w.db.prepare("UPDATE intel_runs SET status='done'").run();
  w.db.prepare("UPDATE local_jobs SET status='done' WHERE status IN ('queued','retry','running')").run();

  // ── 摘要资料：先补全文，补不到用摘要成卡并标注；一次更新只分一次组 ──
  w.db.prepare("UPDATE intel_unified_sources SET status='done'").run();
  const summarySource = (channel, identity, body, patch = {}) => {
    const source = acquired(channel, identity, iso(now - 2 * 3600000), { body, readLevel: 'summary', url: `https://${identity}.example/story`, ...patch });
    w.db.prepare("UPDATE intel_sources SET content_status='summary_only',rights_json=? WHERE id=?").run(JSON.stringify({ aiAllowed: true, exportAllowed: false }), source.id);
    return source;
  };
  const gptA = summarySource(media, 'gpt6-a', 'OpenAI released GPT-6 Sol and GPT-6 Luna with API prices about half of GPT-5.6.');
  const gptB = summarySource(channelRow('t2.the_verge_ai'), 'gpt6-b', 'GPT-6 Luna is rolling out to desktop apps and free users, according to OpenAI.');
  const hn = channelRow('community.hacker_news.best');
  const hnPost = summarySource(hn, 'hn-thread', 'Discussion thread about GPT-6 pricing on Hacker News.');
  w.db.prepare("UPDATE intel_sources SET source_kind='post' WHERE id=?").run(hnPost.id);
  reconcileUnifiedSources(w);
  for (const s of [gptA, gptB, hnPost]) w.db.prepare("UPDATE intel_unified_sources SET status='processing',attempts=0 WHERE source_id=?").run(s.id);
  const summaryRun = enqueueIntelligence(w, profile.id);
  const organized = [];
  const summaryDeps = { completeJson: async (_env, input) => {
    const d = JSON.parse(input.user);
    if (d.step === 'organize') { organized.push(d.sources.map(s => s.id)); return { data: { groups: [{ key: 'gpt6-launch', focus: 'GPT-6 发布', connection: '两家媒体报道同一次发布', relationship: 'same_event', sourceIds: [gptA.id, gptB.id] }] } }; }
    if (d.step === 'compose') return { data: { briefs: [{ groupKey: 'gpt6-launch', storyKey: 'gpt6-launch', title: 'OpenAI 发布 GPT-6 Sol 与 Luna', summary: '两份报道摘要称新模型价格约为上一代一半。', reason: '判断是否切换模型', body: '目前只取得摘要：OpenAI 发布了两款新模型。', confidence: 'watch', kind: 'update', evidence: [{ sourceId: gptA.id, quote: 'OpenAI released GPT-6 Sol and GPT-6 Luna' }, { sourceId: gptB.id, quote: 'GPT-6 Luna is rolling out to desktop apps' }], whyItMatters: '价格变化影响选型', audienceTakeaway: '先看官方价格表', uncertainties: ['只取得摘要'], suggestedUses: ['对比现有模型成本'], claims: [{ text: 'OpenAI 发布两款新模型', kind: 'author_report', attribution: '媒体报道', evidenceIds: ['e1', 'e2'], limitations: ['仅摘要'] }] }] } };
    if (d.step === 'scope-review') return { data: { reviews: d.candidates.map(c => ({ index: c.index, verdict: 'supported', claims: [{ id: 'c1', verdict: 'supported' }] })) } };
    throw Error('unexpected model task ' + (d.step || 'material'));
  } };
  let summaryResult = await executeUnifiedBriefs(w, {}, summaryRun.id, summaryDeps);
  assert.equal(summaryResult.status, 'queued', '先等补全文');
  const fulltextFor = id => w.db.prepare("SELECT count(*) n FROM acquisition_runs r JOIN local_jobs j ON j.id=r.job_id WHERE r.kind='fulltext' AND json_extract(j.payload_json,'$.sourceId')=?").get(id).n;
  assert.equal(fulltextFor(gptA.id), 1); assert.equal(fulltextFor(gptB.id), 1);
  assert.equal(fulltextFor(hnPost.id), 0, 'HN 讨论帖不抓全文');
  assert.equal(organized.length, 0, '补全文期间不生成卡片');
  summaryResult = await executeUnifiedBriefs(w, {}, summaryRun.id, summaryDeps);
  assert.equal(summaryResult.status, 'queued', '补全文任务没结束就继续等');
  w.db.prepare("UPDATE local_jobs SET status='failed' WHERE id IN (SELECT job_id FROM acquisition_runs WHERE kind='fulltext')").run();
  summaryResult = await executeUnifiedBriefs(w, {}, summaryRun.id, summaryDeps);
  assert.notEqual(summaryResult.status, 'queued');
  assert.equal(fulltextFor(gptA.id), 1, '每份资料只尝试一次补全文');
  assert.equal(organized.length, 1, '一次更新只分一次组');
  assert.deepEqual(new Set(organized[0]), new Set([gptA.id, gptB.id, hnPost.id]), '预算内的资料一起交给模型分组');
  const summaryCard = w.db.prepare("SELECT data_json,editorial_state FROM intel_briefs WHERE story_key IS NOT NULL AND json_extract(data_json,'$.storyKey')='gpt6-launch'").get();
  assert.ok(summaryCard, '补不到全文的摘要资料也能成卡');
  assert.equal(JSON.parse(summaryCard.data_json).readScope, 'summary', '所有引文来自摘要的卡如实标注');
  const status2 = id => w.db.prepare('SELECT status FROM intel_unified_sources WHERE source_id=?').get(id)?.status;
  assert.equal(status2(hnPost.id), 'filtered', '模型没分进任何组的资料不再重试');

  console.log('intelligence-freshness: 7-day gate, bands, diversity, deep reads last, consent + full update, Reddit rights, pool/stale/context, budget, edition date, retention, catch-up windows, auto update, fulltext once, summary cards and single grouping passed');
} finally {
  w?.close();
  await fs.rm(root, { recursive: true, force: true });
}
