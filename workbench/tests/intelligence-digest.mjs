// 速览（2026-09-24）：AIhot 精选 / Follow Builders 按天列出、标出已进热点的；Follow Builders 中文摘要；
// 采集资料加入选题时只挂链接。独立的临时 XENHO_HOME；模型全部是模拟的。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { addIntelligenceSource, saveIntelligenceProfile, enqueueIntelligence, linkIntelligenceSource } from '../server/domain/intelligence.mjs';
import { saveIntelligenceAiConsent } from '../server/domain/intelligence-pool.mjs';
import { executeUnifiedBriefs } from '../server/domain/intelligence-unified.mjs';
import { intelligenceDigest } from '../server/domain/intelligence-digest.mjs';
import { intelligenceFeed } from '../server/domain/intelligence-feed.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xenho-intel-digest-'));
let w;
try {
  w = await openWorkspace({ xenhoHome: root });
  const H = 3600000, now = Date.now(), iso = ms => new Date(ms).toISOString();
  const channel = key => w.db.prepare('SELECT * FROM intel_channels WHERE stable_key=?').get(key);
  let n = 0;
  const add = (key, title, { hours = 2, kind = 'article', author = '', body, aiAllowed = true } = {}) => {
    n++;
    const s = addIntelligenceSource(w, { title, body: body || `${title}. Details about this AI change.`, url: `https://d${n}.example/item-${n}`, provider: 'web', readLevel: 'summary', publishedAt: iso(now - hours * H), author });
    w.db.prepare("UPDATE intel_sources SET channel_id=?,acquisition_identity=?,rights_json=?,origin_kind='external',source_kind=?,content_status='summary_only',content_hash=? WHERE id=?")
      .run(channel(key).id, `d:${n}`, JSON.stringify({ aiAllowed, exportAllowed: false }), kind, `h-${n}`, s.id);
    return s;
  };
  saveIntelligenceAiConsent(w, { publicSources: true, reddit: false });
  const hotA = add('aihot.selected', 'Anthropic 发布 Claude Opus 5.5：成本更低', { hours: 3 });
  add('t2.the_verge_ai', 'Anthropic releases Claude Opus 5.5 with lower prices', { hours: 2 });
  const quiet = add('aihot.selected', 'Claude Code 澄清 Cloud sessions 按订阅计费', { hours: 30 });
  const tweet = add('follow_builders.bundle', 'I spend ~2 hours a day building side projects with agents', { hours: 5, kind: 'post', author: 'nikunj' });
  const podcast = add('follow_builders.bundle', 'When AI Improves Itself | Richard Socher', { hours: 28, kind: 'podcast_transcript', author: 'The MAD Podcast' });
  const noAi = add('follow_builders.bundle', 'Personal agents are the ultimate interface', { hours: 4, kind: 'post', author: 'levie', aiAllowed: false });
  const profile = saveIntelligenceProfile(w, { name: '速览测试', query: 'AI', providers: ['collected'], output: 'briefs' });

  let summaryCalls = 0, summaryFails = false, lastSummaryIds = [];
  const deps = { completeJson: async (_env, input) => {
    const d = JSON.parse(input.user);
    if (d.step === 'builder-summary') {
      summaryCalls++; lastSummaryIds = d.items.map(i => i.id);
      if (summaryFails) throw Object.assign(new Error('模型暂时不可用'), { status: 503 });
      return { data: { items: d.items.map(i => ({ id: i.id, zh: `中文摘要：${i.author} 说的事` })) } };
    }
    return { data: { events: d.events.map(e => ({ id: e.id, keep: !e.items[0].title.includes('Cloud sessions') && !e.items[0].title.includes('side projects'), kind: e.kindHint, title: `中文：${e.items[0].title.slice(0, 20)}`, summary: '概要', whyItMatters: '意义', creation: { value: 'medium', window: 'week', angle: '角度', reason: '理由' } })) } };
  } };
  const update = () => executeUnifiedBriefs(w, {}, enqueueIntelligence(w, profile.id).id, deps);

  // 摘要失败不影响更新；没有 AI 许可的不发给模型。
  summaryFails = true;
  const first = await update();
  assert.notEqual(first.status, 'failed', '摘要失败不影响这次更新');
  assert.ok(!lastSummaryIds.includes(noAi.id), '没有 AI 许可的条目不发给模型');
  assert.equal(intelligenceDigest(w, { kind: 'builders' }).days.flatMap(d => d.items).find(i => i.id === tweet.id).zh, '', '没摘要时先显示原文');
  summaryFails = false;
  await update();
  assert.equal(summaryCalls, 2, '上次失败没有缓存，这次重新做');
  await update();
  assert.equal(summaryCalls, 2, '内容不变不再调用');

  // AIhot 精选：按天分组，已进热点的指向那张卡。
  const selected = intelligenceDigest(w, { kind: 'selected' });
  assert.deepEqual(selected.days.map(d => d.day), [...new Set(selected.days.map(d => d.day))].sort().reverse(), '按天分组，新的在前');
  const items = selected.days.flatMap(d => d.items);
  const hotItem = items.find(i => i.id === hotA.id), quietItem = items.find(i => i.id === quiet.id);
  const card = intelligenceFeed(w).briefs.find(b => b.event?.members?.some(m => m.sourceId === hotA.id));
  assert.equal(hotItem.hot?.briefId, card.id, '已进热点的指向那张卡');
  assert.equal(quietItem.hot, null, '没进热点的标为 null');
  assert.ok(quietItem.summary.length > 0);
  assert.equal(selected.inHot, 1);
  // 被合并掉的别名卡不算「在热点里」。
  const other = w.db.prepare("SELECT id FROM intel_briefs WHERE id<>? AND story_key LIKE 'event:%' LIMIT 1").get(card.id);
  if (other) {
    w.db.prepare('INSERT INTO intel_brief_aliases(alias_id,canonical_id,created_at) VALUES(?,?,?)').run(card.id, other.id, iso(now));
    assert.equal(intelligenceDigest(w, { kind: 'selected' }).days.flatMap(d => d.items).find(i => i.id === hotA.id).hot, null, '别名卡不算');
    w.db.prepare('DELETE FROM intel_brief_aliases WHERE alias_id=?').run(card.id);
  }

  // Follow Builders：作者、类型、中文摘要。
  const builders = intelligenceDigest(w, { kind: 'builders' }).days.flatMap(d => d.items);
  const t = builders.find(i => i.id === tweet.id), p = builders.find(i => i.id === podcast.id);
  assert.equal(t.author, 'nikunj'); assert.equal(t.kind, 'post'); assert.equal(t.zh, '中文摘要：nikunj 说的事');
  assert.equal(p.kind, 'podcast');
  assert.throws(() => intelligenceDigest(w, { kind: 'dailies' }), e => e.status === 400, '不放 AIhot 日报');

  // 加入选题：采集资料没有导出许可，只挂标题和原文链接，不复制正文，也不记到资料上。
  const research = linkIntelligenceSource(w, quiet.id, { question: 'Cloud sessions 怎么计费', confirmed: true });
  const ref = w.db.prepare("SELECT entity_id id FROM research_references WHERE research_id=? AND kind='capture'").get(research.id);
  assert.ok(ref, '选题里挂上了这条资料');
  const capture = w.db.prepare('SELECT title,body_markdown,source_url FROM captures WHERE id=?').get(ref.id);
  assert.equal(capture.body_markdown, '', '不复制正文'); assert.match(capture.source_url, /^https:\/\//, '挂的是原文链接');
  assert.equal(w.db.prepare('SELECT capture_id FROM intel_sources WHERE id=?').get(quiet.id).capture_id, null, '只挂链接的不记为已复制');
  assert.equal(linkIntelligenceSource(w, quiet.id, { question: 'Cloud sessions 怎么计费', confirmed: true }).id, research.id, '同一个问题再点一次不重复建选题');
  assert.equal(linkIntelligenceSource(w, quiet.id, { researchId: research.id, confirmed: true }).references.length, 1, '同一个选题不重复挂链接');
  assert.deepEqual(w.db.pragma('foreign_key_check'), []);
  console.log('intelligence-digest: day groups, hot links (aliases excluded), builder summaries (cache, failure, AI permission), link-only topic handoff passed');
} finally {
  w?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
