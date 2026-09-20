import { sourceFromRow } from '../domain/intelligence-quality.mjs';

export function sourcePermission(source, purpose='ai') {
  if(!source?.acquisition)return true;
  if(source.deletedAt||(source.expiresAt&&Date.parse(source.expiresAt)<=Date.now()))return false;
  return source.rights?.[purpose==='export'?'exportAllowed':'aiAllowed']===true;
}
export function assertSourcePermission(source,purpose='export') {
  if(!sourcePermission(source,purpose))throw Object.assign(new Error(purpose==='export'?'这份资料仅限本地阅读，尚未获准复制到研究或导出':'这份资料尚未获准发送给外部模型'),{status:403});
}
export function collectedForAnalysis(w,{provider,limit=40}={}) {
  return w.db.prepare("SELECT * FROM intel_sources WHERE deleted_at IS NULL ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 500").all().map(sourceFromRow).filter(s=>sourcePermission(s,'ai')&&s.body?.trim()&&(provider==='aihot'?s.provider==='aihot':provider==='reddit'?s.platform==='reddit':provider==='x'?s.platform==='x':true)).slice(0,limit);
}
export function localAiHot(w,{forAi=false}={}) {
  if(!w?.db?.open)return {ok:false,error:'本地情报尚未就绪，请启动采集 worker',items:[]};
  const channel=w.db.prepare("SELECT * FROM intel_channels WHERE stable_key='aihot.hot_topics'").get();
  const rows=w.db.prepare("SELECT o.* FROM acquisition_observations o JOIN intel_channels c ON c.id=o.channel_id WHERE c.platform='aihot' ORDER BY o.observed_at DESC LIMIT 100").all();
  const seen=new Set(),items=[];
  for(const row of rows) {
    if(seen.has(row.observation_key))continue;seen.add(row.observation_key);
    const o=JSON.parse(row.data_json),data=o.data||o;
    items.push({id:row.observation_key,title:data.title||'',summary:data.story?.digest?.summary||data.summary||'',link:data.links?.original||data.links?.aihot||'',at:data.latestAt||row.observed_at,source:data.source?.name||'AIHOT',selected:false});
  }
  if(forAi&&channel&&JSON.parse(channel.options_json).aiAllowed!==true)return {ok:false,error:'AIHOT 采集资料尚未获准发送给外部模型',items:[]};
  return {ok:items.length>0,error:items.length?'':'本地暂无热点，请在信源管理中同步 AIHOT',items,fetchedAt:channel?.last_ingest_at||null};
}

// Read-only projection: expired evidence must not remain visible in derived text.
export function visibleDerived(w, data) {
  const ids = new Set((data.evidence || []).map(e => e.sourceId).filter(Boolean));
  const unavailable = [...ids].some(id => {
    const row = w.db.prepare('SELECT acquisition_identity,deleted_at,expires_at FROM intel_sources WHERE id=?').get(id);
    return row?.acquisition_identity && (row.deleted_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now()));
  });
  if (!unavailable && !Object.values(data).includes('引用内容已移除，需重新核查')) return data;
  const hidden = { ...data, evidence: [], editorialState: 'needs_review' };
  const retained = new Set(['id','storyKey','briefIds','versions','coverage','evidence','editorialState','confidence','freshnessKind','publishedAt','createdAt','updatedAt']);
  for (const key of Object.keys(hidden)) {
    if (!retained.has(key)) hidden[key] = Array.isArray(hidden[key]) ? [] : hidden[key] !== null && typeof hidden[key] === 'object' ? {} : typeof hidden[key] === 'string' ? '引用内容已过期或移除，需重新核查' : hidden[key];
  }
  return hidden;
}
