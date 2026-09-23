// 情报池：哪些信源的资料有资格变成情报卡，以及用户对「发给模型整理」的一次性授权。
// 只依赖数据库，不引用 feed / unified / runner，免得在这几个模块之间再绕出循环引用。

export const RECOMMEND_WINDOW_MS = 7 * 86400000;
/** 采集覆盖的最远回溯：与推荐窗口一致，旧于此的资料不会进推荐，补采也没有意义。 */
export const MAX_BACKFILL_MS = RECOMMEND_WINDOW_MS;
export const AUTO_UPDATE_INTERVAL_MS = 6 * 3600000;
/** Reddit 走按条计费的 Bright Data：一天最多跑一次，规模按 2026-09-23 决策精简。 */
export const REDDIT_MIN_INTERVAL_MS = 20 * 3600000;
export const REDDIT_DAILY_LIMITS = Object.freeze({ postsPerSubreddit: 15, deepThreadsPerRun: 3, commentsPerThread: 20 });

// arXiv、GitHub、dev.to、Stack Overflow 仍可在原始资料里检索，但不进情报推荐：
// 一天上千篇论文会挤掉模型预算，也不是用户定义的四类信源。
const POOL_GROUPS = ['aihot', 'follow_builders', 't2_media'];
const POOL_COMMUNITY = ['hacker_news', 'reddit'];
export const poolChannelSql = (alias = '') => { const p = alias ? `${alias}.` : ''; return `(${p}source_group IN ('aihot','follow_builders','t2_media') OR (${p}source_group='community' AND ${p}platform IN ('hacker_news','reddit')))`; };
export const POOL_CHANNEL_SQL = poolChannelSql();

export function inIntelligencePool(channel) {
  if (!channel) return false;
  const group = channel.source_group ?? channel.sourceGroup;
  return POOL_GROUPS.includes(group) || (group === 'community' && POOL_COMMUNITY.includes(channel.platform));
}

const stateTable = w => Boolean(w.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='intel_unified_state'").get());
const readState = (w, key) => { if (!stateTable(w)) return null; const row = w.db.prepare('SELECT value FROM intel_unified_state WHERE key=?').get(key); if (!row) return null; try { return JSON.parse(row.value); } catch { return null; } };
const writeState = (w, key, value) => w.db.prepare('INSERT INTO intel_unified_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));

/** 一次性授权。没有记录 = 从未授权；新采集的资料按频道默认不能发给模型。 */
export function intelligenceAiConsent(w) {
  const value = readState(w, 'ai-consent');
  return { publicSources: value?.publicSources === true, reddit: value?.reddit === true, at: value?.at || null };
}
/** 创作主战场：创作判断只在这些平台里给做法建议。默认公众号/贴图、X 中文号、抖音/视频号（2026-09-23）。 */
export const CREATOR_PLATFORMS = Object.freeze({ wechat: '公众号/贴图', x: 'X 中文号', video: '抖音/视频号', xhs: '小红书' });
export function creatorPlatforms(w) { const value = readState(w, 'creator-platforms'); const list = Array.isArray(value?.platforms) ? value.platforms.filter(p => p in CREATOR_PLATFORMS) : []; return list.length ? list : ['wechat', 'x', 'video']; }
export function setCreatorPlatforms(w, platforms) { const list = [...new Set((platforms || []).filter(p => p in CREATOR_PLATFORMS))]; if (!list.length) throw Object.assign(new Error('至少选择一个创作平台'), { status: 400 }); writeState(w, 'creator-platforms', { platforms: list }); return list; }
export function intelligenceAutoUpdate(w) { return readState(w, 'auto-update')?.enabled !== false; }
export function setIntelligenceAutoUpdate(w, enabled) { writeState(w, 'auto-update', { enabled: enabled === true }); return enabled === true; }

/**
 * 写入授权并落到频道和资料上。
 * 放开只回填最近 7 天的资料：更早的不会进推荐，没必要把几千条积压一并送去模型。
 * 收回则覆盖该频道的全部资料——撤权必须完整。
 */
export function saveIntelligenceAiConsent(w, { publicSources, reddit }, { now = new Date() } = {}) {
  const next = { publicSources: publicSources === true, reddit: reddit === true, at: now.toISOString() };
  const cutoff = new Date(now.getTime() - RECOMMEND_WINDOW_MS).toISOString();
  w.db.transaction(() => {
    writeState(w, 'ai-consent', next);
    for (const channel of w.db.prepare(`SELECT id,platform,options_json FROM intel_channels WHERE ${POOL_CHANNEL_SQL}`).all()) {
      const allowed = channel.platform === 'reddit' ? next.reddit : next.publicSources;
      // Reddit 的授权由 runner 在每次采集时读取，不写进通用的 aiAllowed 开关。
      if (channel.platform !== 'reddit') w.db.prepare('UPDATE intel_channels SET options_json=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(channel.options_json || '{}'), aiAllowed: allowed }), channel.id);
      // Reddit 另有「采集已批准」的前提，由 store 在入库时判断；这里只回填已经合法入库的资料。
      const scope = allowed ? " AND COALESCE(json_extract(data_json,'$.publishedAt'),created_at)>=?" : '';
      w.db.prepare(`UPDATE intel_sources SET rights_json=json_set(COALESCE(NULLIF(rights_json,''),'{}'),'$.aiAllowed',json(?)) WHERE channel_id=? AND deleted_at IS NULL AND acquisition_identity IS NOT NULL${scope}`)
        .run(allowed ? 'true' : 'false', channel.id, ...(allowed ? [cutoff] : []));
    }
  })();
  return next;
}

/** 资料的发布时间是否落在推荐窗口里。发布时间未知不算新；Follow Builders 深读按首次出现时间算。 */
export function sourceIsFresh(source, { now = Date.now() } = {}) {
  const at = typeof now === 'number' ? now : Date.parse(now);
  const inWindow = value => { const t = Date.parse(value || ''); return Number.isFinite(t) && t >= at - RECOMMEND_WINDOW_MS && t <= at + 3600000; };
  if (inWindow(source?.publishedAt)) return true;
  return source?.metadata?.readingScope === 'deep' && inWindow(source.metadata.upstreamFirstSeenAt);
}
