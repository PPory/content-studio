const hostname = value => { try { return new URL(value).hostname.replace(/^www\./,''); } catch { return ''; } };
const useful = value => typeof value==='string' && value.trim() && !/^(web|feed|rss|community|acquisition|follow_builders)$/i.test(value.trim());
// Discovery services are not publishers. A direct subscription name is evidence
// only when its domain matches the original URL. Otherwise show the actual host.
export function publisherIdentity(source, discoveries=[]) {
 const host=hostname(source.url);
 const direct=discoveries.find(d=>host && [hostname(d.channelUrl).replace(/^feeds\./,''),hostname(d.siteUrl).replace(/^feeds\./,'')].includes(host) && d.sourceGroup!=='follow_builders');
 const provided=[source.publisher,source.metadata?.publisher, /podcast/.test(source.sourceKind||source.contentKind||'')?source.metadata?.publisherKey:null].find(useful);
 const publisher=(provided&&provided!==host?provided:null) || (source.platform==='x'&&source.author?`X · @${source.author.replace(/^@/,'')}`:direct?.channelName || direct?.name || host || '发布者未提供');
 return {publisher,publisherBasis:provided?'source':direct?'direct_subscription':source.platform==='x'&&source.author?'author_account':host?'original_url':'unknown',channelName:discoveries[0]?.channelName || discoveries[0]?.name || ''};
}
