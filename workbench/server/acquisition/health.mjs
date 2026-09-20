export function errorStatus(error) {
 const message=String(error?.message||error||'');
 if(error?.status===429||/限流|HTTP 429|rate.limit|预算已用完/i.test(message))return 'RATE_LIMITED';
 if(/PAID_ACCESS_BLOCKED/i.test(message))return 'PAID_ACCESS_BLOCKED';
 if(error?.blocked||[401,403].includes(error?.status)||/OAuth|approval|批准|AUTH_BLOCKED|HTTP 40[13]/i.test(message))return 'AUTH_BLOCKED';
 if(/timeout|timed.out|超时|aborted/i.test(message))return 'TIMEOUT';
 if(/parse|invalid_schema|JSON|XML|RSS|structure|malformed|cursor|watermark|解析/i.test(message)||error?.code==='invalid_schema')return 'PARSE_FAILED';
 return 'SOURCE_UNAVAILABLE';
}
export function successStatus(stats,coverage={}) {
 if(coverage.gap||coverage.awaitingUpstream===true||coverage.streams&&Object.values(coverage.streams).some(s=>s.errors?.length))return 'STALE_UPSTREAM';
 return stats.inserted||stats.new||stats.updated?'OK':'NO_NEW_ITEMS';
}
