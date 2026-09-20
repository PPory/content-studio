export const ACQUISITION_WINDOW_HOURS = 24;
export const PROVIDER_WINDOW_HOURS = 30;

const iso = (value, label) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${label} 不是有效时间`);
  return date.toISOString();
};

export function acquisitionWindow({ mode = 'sync', now = new Date(), windowStart, windowEnd } = {}) {
  const end = iso(windowEnd || now, '采集窗口结束时间');
  const start = iso(windowStart || new Date(Date.parse(end) - ACQUISITION_WINDOW_HOURS * 3_600_000), '采集窗口开始时间');
  if (Date.parse(start) >= Date.parse(end)) throw new TypeError('采集窗口开始时间必须早于结束时间');
  return Object.freeze({
    mode,
    windowStart: start,
    windowEnd: end,
    providerWindowStart: new Date(Date.parse(end) - PROVIDER_WINDOW_HOURS * 3_600_000).toISOString(),
    hardGate: ['sync', 'validate'].includes(mode),
  });
}

export function acquisitionTimestamp(item = {}) {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const candidates = [
    ['publishedAt', item.publishedAt],
    ['createdAt', item.createdAt],
    ['date_posted', item.date_posted],
    ['creation_date', item.creation_date],
    ['generatedAt', metadata.generatedAt],
    ['upstreamCommitAt', metadata.upstreamCommitAt],
  ];
  for (const [field, value] of candidates) {
    if (value === null || value === undefined || value === '') continue;
    const time = Date.parse(value);
    if (Number.isFinite(time)) return { field, value: new Date(time).toISOString(), time };
  }
  return null;
}

export function gateAcquisitionItems(items = [], window, { limit = Infinity } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!window?.hardGate) return {
    items: list,
    stats: { fetched: list.length, inWindow: list.length, outsideWindow: 0, unknownTimestamp: 0, limited: 0 },
    byStream: streamCounts(list, { fetched: true, inWindow: true }),
  };
  const start = Date.parse(window.windowStart), end = Date.parse(window.windowEnd);
  const accepted = [], byStream = {}, stats = { fetched: list.length, inWindow: 0, outsideWindow: 0, unknownTimestamp: 0, limited: 0 };
  for (const item of list) {
    const key = item?.metadata?.stream || 'default';
    byStream[key] ||= { fetched: 0, inWindow: 0, outsideWindow: 0, unknownTimestamp: 0, limited: 0 };
    byStream[key].fetched++;
    const timestamp = acquisitionTimestamp(item);
    if (!timestamp) { stats.unknownTimestamp++; byStream[key].unknownTimestamp++; continue; }
    if (timestamp.time < start || timestamp.time > end) { stats.outsideWindow++; byStream[key].outsideWindow++; continue; }
    stats.inWindow++; byStream[key].inWindow++;
    if (accepted.length >= limit) { stats.limited++; byStream[key].limited++; continue; }
    accepted.push({ ...item, publishedAt: item.publishedAt || timestamp.value, metadata: { ...(item.metadata || {}), acquisitionTimeField: timestamp.field } });
  }
  return { items: accepted, stats, byStream };
}

function streamCounts(items, flags) {
  const result = {};
  for (const item of items) {
    const key = item?.metadata?.stream || 'default';
    result[key] ||= { fetched: 0, inWindow: 0, outsideWindow: 0, unknownTimestamp: 0, limited: 0 };
    for (const [name, enabled] of Object.entries(flags)) if (enabled) result[key][name]++;
  }
  return result;
}

export function mergeAcquisitionStats(target, values = {}) {
  for (const key of ['fetched', 'inWindow', 'outsideWindow', 'unknownTimestamp', 'limited', 'inserted', 'updated', 'duplicate', 'failed']) {
    target[key] = Number(target[key] || 0) + Number(values[key] || 0);
  }
  return target;
}

export function channelItemLimit(channel = {}) {
  if (channel.source_group === 't2_media') return Math.max(1, Number(channel.options?.maxInWindow || 20));
  if (channel.platform === 'github') return Math.max(1, Number(channel.options?.maxPerTopic || 15));
  if (channel.platform === 'hacker_news') return Math.max(1, Number(channel.options?.maxPerChannel || 60));
  if (channel.platform === 'stackoverflow') return Math.max(1, Number(channel.options?.maxPerChannel || 30));
  if (channel.platform === 'devto') return Math.max(1, Number(channel.options?.maxPerChannel || 30));
  return Infinity;
}

export function batchPlatformLimit(channel = {}) {
  if (channel.platform === 'github' || channel.platform === 'hacker_news') return Math.max(1, Number(channel.options?.maxPerBatch || 60));
  if (channel.platform === 'stackoverflow' || channel.platform === 'devto') return Math.max(1, Number(channel.options?.maxPerBatch || 30));
  if (channel.platform === 'reddit') return Math.max(1, Number(channel.options?.maxPostsPerBatch || 80));
  return Infinity;
}
