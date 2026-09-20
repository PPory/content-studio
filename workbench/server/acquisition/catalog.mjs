import fs from 'node:fs';
import { contentHash } from '../domain/intelligence-quality.mjs';

export const acquisitionManifest = JSON.parse(fs.readFileSync(new URL('../../config/acquisition-v3/source-manifest.json', import.meta.url), 'utf8'));
export const acquisitionInventory = JSON.parse(fs.readFileSync(new URL('../../config/acquisition-v3/source-inventory.original.json', import.meta.url), 'utf8'));

// This is a catalog compiler, not an assertion that any endpoint is usable.
export function acquisitionCatalog(manifest = acquisitionManifest) {
  const rows = [];
  const add = (key, name, group, platform, stream, endpoint, options, poll = 3600, desired = true) => rows.push({
    key, name, group, platform, stream, endpoint: endpoint || '', options, poll, desired,
    adapter: group === 'aihot' ? 'aihot' : group === 'follow_builders' ? 'follow_builders' : platform === 'reddit' ? 'reddit' : 'community',
  });
  for (const group of manifest.groups) {
    if (group.key === 'aihot') for (const s of group.streams) add(`aihot.${s.key}`, `AIHOT · ${{selected:'精选',hot_topics:'热点',dailies:'日报'}[s.key]}`, group.key, 'aihot', ({hot_topics:'hot',dailies:'daily'})[s.key] || s.key, group.baseUrl + (s.snapshotPath || s.path || s.indexPath), {...s,baseUrl:group.baseUrl}, s.pollIntervalSeconds || 3600);
    if (group.key === 't2_media') for (const s of group.sources) add(s.stableKey, s.name, group.key, 'web', 'feed', s.candidateEndpoint, s, s.pollIntervalSeconds);
    if (group.key === 'follow_builders') add('follow_builders.bundle', group.name, group.key, 'follow_builders', 'bundle', `https://api.github.com/repos/${group.repository}/commits/${group.trackingRef}`, {...group,repo:group.repository,ref:group.trackingRef}, 3600);
    if (group.key !== 'community') continue;
    for (const p of group.platforms) {
      const base = (key, name, endpoint, extra = {}, desired = true) => add(`community.${p.key}.${key}`, name, group.key, p.key, key, endpoint, {...p,...extra}, p.pollIntervalSeconds, desired);
      if (p.key === 'hacker_news') {
        for (const f of p.feeds) base(f.key, `Hacker News · ${f.key}`, f.candidateEndpoint, f);
        for (const f of p.disabledCandidates) base(f.key, f.name, f.candidateEndpoint, f, false);
      }
      if (p.key === 'reddit') for (const s of p.sources) base(s.name.toLowerCase(), `Reddit · r/${s.name}`, `https://oauth.reddit.com/r/${s.name}/new`, {...s,subreddit:s.name});
      if (p.key === 'github') for (const topic of p.topics) base(topic, `GitHub · ${topic}`, `https://api.github.com/search/repositories?q=topic:${topic}&sort=updated`, {topic});
      if (p.key === 'arxiv') for (const c of p.categories) base(c.key, `arXiv · ${c.key}`, c.candidateEndpoint, {category:c.key});
      if (p.key === 'stackoverflow') for (const tag of p.tags) for (const sort of p.sorts) base(`${tag}.${sort}`, `Stack Overflow · ${tag} / ${sort}`, p.candidateEndpointTemplate.replace('{tag}',tag).replace('{sort}',sort), {tag,sort});
      if (p.key === 'devto') {
        for (const tag of p.tags) base(tag, `Dev.to · ${tag}`, p.candidateEndpointTemplate.replace('{tag}',tag), {tag});
        for (const tag of p.optionalTagsRequiringVerification) base(tag, `Dev.to · ${tag}（候选）`, p.candidateEndpointTemplate.replace('{tag}',tag), {tag}, false);
        base('all', 'Dev.to · 全站（候选）', p.fullSiteFeed.candidateEndpoint, {}, false);
      }
    }
  }
  return rows;
}

export function ensureAcquisitionCatalog(w) {
  const at = new Date().toISOString();
  w.db.transaction(() => {
    // Existing choices win. New entries require a successful validation run before activation.
    for (const c of acquisitionCatalog()) {
      if (w.db.prepare('SELECT id FROM intel_channels WHERE stable_key=?').get(c.key)) continue;
      const existing = c.endpoint && w.db.prepare('SELECT * FROM intel_channels WHERE url=? AND stable_key IS NULL').get(c.endpoint);
      // Import AI moved hosts; retain the channel ID, custom addresses and disabled choice; replace only the obsolete default URL.
      const alias = existing || (c.key === 't2.import_ai' ? w.db.prepare("SELECT * FROM intel_channels WHERE id='channel-importai' AND stable_key IS NULL").get() : null);
      const id = alias?.id || `acq-${contentHash(c.key).slice(0,20)}`;
      if (!alias) w.db.prepare(`INSERT INTO intel_channels(id,name,url,site_url,format,category,publisher_key,enabled,builtin,health,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,1,'never',?,?)`).run(id,c.name,c.endpoint,c.endpoint ? new URL(c.endpoint).origin : '', 'rss',c.group==='community'?'questions':'practice', c.platform, at, at);
      w.db.prepare(`UPDATE intel_channels SET stable_key=?,source_group=?,platform=?,stream=?,adapter=?,options_json=?,desired_enabled=?,user_disabled=?,validation_status='pending',access_status=?,poll_seconds=?,enabled=0 WHERE id=?`).run(c.key,c.group,c.platform,c.stream,c.adapter,JSON.stringify({...c.options,candidateEndpoint:c.endpoint,legacyAlias:Boolean(alias)}),Number(alias ? Boolean(alias.enabled) : c.desired),Number(alias && !alias.enabled),c.platform==='reddit'?'needs_approval_and_credentials':'public_feed',c.poll,id);
      if(c.key==='t2.import_ai' && alias?.url==='https://importai.substack.com/feed')w.db.prepare('UPDATE intel_channels SET url=?,site_url=? WHERE id=?').run(c.endpoint,new URL(c.endpoint).origin,id);
      const row = w.db.prepare('SELECT * FROM intel_channels WHERE id=?').get(id);
      w.db.prepare('UPDATE intel_channels SET baseline_json=? WHERE id=?').run(JSON.stringify(baseline(row)),id);
    }
    // Non-overlapping old channels stay in the catalog and preserve their choices.
    for (const row of w.db.prepare("SELECT * FROM intel_channels WHERE stable_key IS NULL").all()) {
      const adapter = row.format === 'manual' ? 'manual' : 'community';
      w.db.prepare("UPDATE intel_channels SET stable_key=?,adapter=?,platform='web',stream='feed',desired_enabled=enabled,user_disabled=CASE WHEN enabled=0 THEN 1 ELSE 0 END,validation_status='pending',access_status='public_feed',options_json=? WHERE id=?").run(`legacy.${row.id}`,adapter,JSON.stringify({format:row.format}),row.id);
      w.db.prepare('UPDATE intel_channels SET baseline_json=? WHERE id=?').run(JSON.stringify(baseline(w.db.prepare('SELECT * FROM intel_channels WHERE id=?').get(row.id))),row.id);
    }
  })();
}
export function baseline(row) { return {name:row.name,url:row.url,format:row.format,category:row.category,desired_enabled:row.desired_enabled,user_disabled:row.user_disabled,options_json:row.options_json}; }
export function channelView(row) {
  if (!row) return null;
  return {...row, options:JSON.parse(row.options_json), endpoint:row.url, desiredEnabled:Boolean(row.desired_enabled), enabled:Boolean(row.enabled), lastStats:JSON.parse(row.last_stats_json), sourceGroup:row.source_group, stableKey:row.stable_key};
}
