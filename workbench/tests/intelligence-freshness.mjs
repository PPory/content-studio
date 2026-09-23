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
import { rankIntelligenceBriefs, briefRecency, saveIntelligenceBriefs, scheduleIntelligenceAutoUpdate, saveIntelligenceSettings, scheduleRedditArrival, intelligenceIntake } from '../server/domain/intelligence-feed.mjs';
import { reconcileUnifiedSources, executeUnifiedBriefs, unifiedAcquisitionPending } from '../server/domain/intelligence-unified.mjs';
import { saveStep } from '../server/domain/intelligence.mjs';
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

  // ── 统一整理：池外、过期、评论上下文；不再逐份调用模型，一次批量判断 ──
  const outside = acquired(arxiv, 'arxiv-paper', iso(now - DAY));
  const staleMedia = acquired(media, 'stale-media', iso(now - 9 * DAY));
  for (let i = 0; i < 30; i++) acquired(media, `media-${i}`, iso(now - (i + 2) * 3600000));
  saveIntelligenceAiConsent(w, { publicSources: true, reddit: true });
  const profile = saveIntelligenceProfile(w, { name: '新鲜度测试', query: 'AI', providers: ['collected'], output: 'briefs' });
  const run = enqueueIntelligence(w, profile.id);
  let judgeCalls = 0, perSource = 0;
  const deps = { completeJson: async (_env, input) => {
    const d = JSON.parse(input.user);
    if (d.material) { perSource++; throw Error('热点流程不应逐份调用模型'); }
    if (d.step === 'event-judge') { judgeCalls++; return { data: { events: d.events.map(e => ({ id: e.id, keep: true, kind: e.kindHint, title: '一个 AI 事件', summary: '概要。', whyItMatters: '意义' })) } }; }
    throw Error('unexpected model task ' + d.step);
  } };
  const result = await executeUnifiedBriefs(w, {}, run.id, deps);
  assert.notEqual(result.status, 'queued', '一次跑完，不分轮等待');
  assert.equal(perSource, 0, '不再逐份做语义判断'); assert.equal(judgeCalls, 1, '一次批量判断');
  const status = id => w.db.prepare('SELECT status FROM intel_unified_sources WHERE source_id=?').get(id)?.status;
  assert.equal(status(outside.id), 'out_of_scope'); assert.equal(status(staleMedia.id), 'stale'); assert.equal(status(old.id), 'stale');
  assert.equal(status(comment), 'context', 'Reddit 评论挂到帖子上，不单独判断');
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
  // Reddit 排在队尾：任务串行执行，它不能堵住其它信源。
  const order = w.db.prepare('SELECT c.platform FROM acquisition_runs r JOIN intel_channels c ON c.id=r.channel_id WHERE r.batch_id=? ORDER BY r.rowid').all(batch.id).map(r => r.platform);
  assert.ok(order.includes('reddit') && order.slice(order.indexOf('reddit')).every(p => p === 'reddit'), 'Reddit 排在批次最后');
  // 整理只等快的信源：其它都完成、只剩 Reddit 时不再等待；进度能说出「只剩 Reddit」。
  const waitRun = enqueueIntelligence(w, profile.id);
  saveStep(w, waitRun.id, 'acquire', 'running', { batchId: batch.id });
  assert.equal(unifiedAcquisitionPending(w, waitRun.id), true, '其它信源没采完时要等');
  const progressBefore = intelligenceIntake(w).progress;
  assert.ok(progressBefore.total > progressBefore.finished && !progressBefore.redditOnly);
  w.db.prepare("UPDATE local_jobs SET status='done' WHERE id IN (SELECT r.job_id FROM acquisition_runs r JOIN intel_channels c ON c.id=r.channel_id WHERE r.batch_id=? AND c.platform<>'reddit')").run(batch.id);
  assert.equal(unifiedAcquisitionPending(w, waitRun.id), false, '只剩 Reddit 时不等它');
  assert.equal(intelligenceIntake(w).progress.redditOnly, true);
  // Reddit 采完后自动补整理一轮，只一次。
  w.db.prepare("UPDATE local_jobs SET status='done' WHERE status IN ('queued','retry','running')").run();
  w.db.prepare("UPDATE intel_runs SET status='done',updated_at=?").run(iso(now - 3600000));
  w.db.prepare("UPDATE acquisition_runs SET status='completed',finished_at=? WHERE id=(SELECT r.id FROM acquisition_runs r JOIN intel_channels c ON c.id=r.channel_id WHERE r.batch_id=? AND c.platform='reddit' LIMIT 1)").run(iso(now), batch.id);
  const arrival = scheduleRedditArrival(w);
  assert.ok(arrival?.id, 'Reddit 到了之后补整理');
  assert.equal(w.db.prepare("SELECT count(*) n FROM acquisition_batches WHERE started_at>?").get(iso(now + 1000)).n, 0, '补整理不重新采集');
  w.db.prepare("UPDATE intel_runs SET status='done'").run();
  assert.equal(scheduleRedditArrival(w), null, '同一批 Reddit 只补一次');

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

  console.log('intelligence-freshness: 7-day gate, bands, diversity, deep reads last, consent + full update, Reddit rights, pool/stale/context without per-source model calls, edition date, retention, catch-up windows, auto update and Reddit last / not awaited / arrival refresh passed');
} finally {
  w?.close();
  await fs.rm(root, { recursive: true, force: true });
}
