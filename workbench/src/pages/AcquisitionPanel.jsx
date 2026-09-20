import { useCallback, useEffect, useState } from 'react';
import { ErrorNote, Loading } from '../components/ui.jsx';
import { useDialog } from '../lib/use-dialog.js';

const GROUPS = { aihot: 'AIHOT', t2_media: 'T2 媒体', community: '社区', follow_builders: 'Follow Builders', legacy: '其他与旧信源' };
const STATUS = { OK:'OK', NO_NEW_ITEMS:'NO_NEW_ITEMS', AUTH_BLOCKED:'AUTH_BLOCKED', PAID_ACCESS_BLOCKED:'PAID_ACCESS_BLOCKED', RATE_LIMITED:'RATE_LIMITED', TIMEOUT:'TIMEOUT', PARSE_FAILED:'PARSE_FAILED', SOURCE_UNAVAILABLE:'SOURCE_UNAVAILABLE', STALE_UPSTREAM:'STALE_UPSTREAM', public_feed: '公开订阅', approved: '访问已批准', needs_approval_and_credentials: '需要批准和凭据', retry: '等待重试',  never: '尚未运行', pending: '等待处理', queued: '等待处理', running: '采集中', success: '已完成', done: '已完成', partial: '部分完成', no_new: '本次无新增', no_change: '上游未变化', failed: '失败', cancelled: '已取消', blocked: '暂不可采集', paused: '已暂停', verified: '入口已验证', valid: '入口已验证', unverified: '入口待验证', needs_validation: '入口待验证', needs_credentials: '需要配置凭据', needs_approval: '需要访问批准', ready: '可采集', allowed: '访问已允许', not_required: '公开访问', denied: '未获访问许可', unavailable: '入口不可用', upstream_partial: '上游部分失败', upstream_failed: '上游失败', awaiting_upstream: '等待上游发布', rate_limited: '等待限流恢复', history_gap: '历史覆盖有缺口' };
const label = value => STATUS[value] || value || '尚未核对';
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '暂无';
const object = value => value && typeof value === 'object' ? value : {};
async function request(url, body) {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || result.message || `请求失败（${response.status}）`);
  return result;
}
function Stats({ value }) {
  const raw = object(value), modern=raw.fetched!==undefined,stats = modern?raw:{...raw,fetched:raw.found,inserted:raw.new,duplicate:raw.duplicates}, names = modern ? { fetched:'抓取',inWindow:'窗内',outsideWindow:'窗外',unknownTimestamp:'时间未知',inserted:'新增',updated:'更新',duplicate:'重复',failed:'失败' } : { found:'发现',new:'新增',updated:'更新',duplicates:'重复',failed:'失败',summary:'仅摘要' };
  const present = Object.entries(names).filter(([key]) => stats[key] !== undefined);
  return present.length ? <p className="intel-v2-hint">{present.map(([key,name]) => `${name} ${stats[key]}`).join(' · ')}</p> : null;
}
function Coverage({ value }) {
  const coverage = object(value), gaps = coverage.gaps || coverage.missingDates || coverage.awaitingUpstream;
  const streams = object(coverage.streams);
  return <div className="acquisition-coverage">
    {coverage.window?.start && <p>采集窗口：{time(coverage.window.start)} → {time(coverage.window.end)}</p>}
    {coverage.hasMore && <p>还有未处理的历史或分页，已保留续采位置。</p>}
    {coverage.coverageStart && <p>本次覆盖起点：{time(coverage.coverageStart)}</p>}
    {gaps && <p className="intel-channel-error">覆盖缺口／待上游：{Array.isArray(gaps) ? gaps.map(v => typeof v === 'object' ? v.date || v.reason || JSON.stringify(v) : String(v)).join('、') : typeof gaps === 'boolean' ? '尚未发布完整内容' : typeof gaps === 'object' ? JSON.stringify(gaps) : String(gaps)}</p>}
    {coverage.boundary && <p>{coverage.boundary}</p>}
    {coverage.reason && <p>{coverage.reason}</p>}
    {Object.entries(streams).map(([name,stream]) => <p key={name}>{name} · {label(stream.status)}{stream.generatedAt ? ` · 上游更新 ${time(stream.generatedAt)}` : ''}{stream.errors?.length ? ` · ${stream.errors.map(e => typeof e === 'string' ? e : e.message || JSON.stringify(e)).join('；')}` : ''}</p>)}
  </div>;
}
function PermissionDialog({ choice, busy, error, onClose, onConfirm }) {
  const close = useCallback(() => { if (!busy) onClose(); }, [busy,onClose]);
  const ref = useDialog(true, close), ai = choice.action === 'allow_ai', fulltext = choice.action === 'allow_fulltext';
  return <div className="scrim scrim--center"><section ref={ref} role="dialog" aria-modal="true" aria-label={ai ? '确认允许 AI 处理' : fulltext ? '确认读取公开原文' : '确认允许导出'} className="acquisition-confirm">
    <h2>{ai ? '允许 AI 处理这条来源？' : fulltext ? '允许补全公开原文？' : '允许导出这条来源？'}</h2><p><strong>{choice.channel.name}</strong></p>
    <p>{ai ? '确认后，该来源的正文和评论可被发送给你配置的外部模型，用于情报解读与选题。请先确认你拥有相应处理权限。' : fulltext ? '确认后，采集器可访问条目所链接的公开网页并保存原文。遇到登录、付费墙或访问限制时会停止，不会绕过限制。' : '确认后，这条来源的资料可以进入工作台导出文件。请先确认来源的使用许可允许这一用途；这不会自动发布内容。'}</p>
    <ErrorNote error={error} what="更新使用权限"/>
    <div className="intel-v2-actions"><button className="btn" onClick={close} disabled={busy} data-autofocus>取消</button><button className="btn btn-primary" onClick={onConfirm} disabled={busy}>{busy ? '正在保存…' : ai ? '确认允许 AI 处理' : fulltext ? '确认读取公开原文' : '确认允许导出'}</button></div>
  </section></div>;
}
function ConfigureDialog({ choice, busy, error, onClose, onConfirm }) {
  const [endpoint,setEndpoint] = useState(choice.channel.endpoint || choice.channel.url || choice.channel.options?.candidateEndpoint || '');
  const close = useCallback(() => { if (!busy) onClose(); }, [busy,onClose]);
  const ref = useDialog(true, close);
  return <div className="scrim scrim--center"><form ref={ref} role="dialog" aria-modal="true" aria-label="修改采集入口" className="acquisition-confirm intel-v2-form" onSubmit={event=>{event.preventDefault();onConfirm(endpoint.trim());}}>
    <h2>修改采集入口</h2><p><strong>{choice.channel.name}</strong></p>
    <p>填写订阅或查询接口的完整公开网址。保存后需要重新验证；原始来源清单、来源身份和已收资料都会保留。</p>
    <label>完整公开网址<input type="url" pattern="https?://.+" required maxLength={4000} value={endpoint} onChange={event=>setEndpoint(event.target.value)} disabled={busy} data-autofocus placeholder="https://example.com/feed.xml"/></label>
    <ErrorNote error={error} what="修改采集入口"/>
    <div className="intel-v2-actions"><button type="button" className="btn" onClick={close} disabled={busy}>取消</button><button type="submit" className="btn btn-primary" disabled={busy || !endpoint.trim()}>{busy ? '正在保存…' : '保存入口'}</button></div>
  </form></div>;
}
export function AcquisitionPanel() {
  const [data,setData] = useState(null), [error,setError] = useState(null), [busy,setBusy] = useState(''), [choice,setChoice] = useState(null), [notice,setNotice] = useState(''), [search,setSearch] = useState('');
  const load = useCallback(async () => { try { setData(await request('/api/workspace/acquisition')); setError(null); } catch (e) { setError(e); } }, []);
  useEffect(() => { void load(); }, [load]);
  const active = data?.runs?.some(r => ['queued','running','pending','retry'].includes(r.job_status || r.status));
  useEffect(() => { if (!active) return; const timer = setInterval(() => { void load(); }, 5000); return () => clearInterval(timer); }, [active,load]);
  async function act(channel, action, fields = {}) {
    setBusy(channel.id); setError(null); setNotice('');
    try { await request(`/api/workspace/acquisition/channels/${encodeURIComponent(channel.id)}/action`, { action, confirmed: true, ...fields }); setChoice(null); setNotice(['validate','sync','backfill'].includes(action) ? '已安排任务，完成情况见采集记录。' : action==='configure' ? '入口已更新，等待重新验证；尚未确认可用。' : '来源设置已更新。'); await load(); }
    catch (e) { setError(e); } finally { setBusy(''); }
  }
  async function cancel(run) {
    setBusy(run.id); try { await request(`/api/workspace/acquisition/runs/${encodeURIComponent(run.id)}/cancel`, { confirmed: true }); setNotice('已请求取消，已保存的资料会保留。'); await load(); } catch (e) { setError(e); } finally { setBusy(''); }
  }
  const channels = data?.channels || [], runs = data?.runs || [];
  const filtered = channels.filter(c => `${c.name} ${c.platform || ''} ${GROUPS[c.source_group] || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="acquisition-panel" aria-label="情报采集来源">
    <div className="intel-v2-toolbar"><h2>采集来源</h2><div className="intel-v2-actions"><button className="btn btn-sm" onClick={load} disabled={Boolean(busy)}>刷新状态</button></div></div>
    <p className="intel-v2-hint">采集先保存资料，解读另外运行。入口验证通过不代表已经取得全文；缺少权限的来源仍保留在这里。</p>
    <ErrorNote error={!choice ? error : null} what="读取采集状态" onRetry={load}/>{notice && <p role="status" className="intel-v2-hint">{notice}</p>}
    {!data && !error ? <Loading rows={4}/> : data && <>
      <label className="acquisition-search">查找来源<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="来源、平台或分组"/></label>
      <p className="intel-v2-hint">{channels.length} 个采集入口 · {channels.filter(c=>c.enabled).length} 个实际启用</p>
      {!filtered.length && <p>没有匹配的来源。</p>}
      {Object.entries(GROUPS).map(([group,title]) => { const rows=filtered.filter(c=>(c.source_group || 'legacy')===group); return rows.length ? <section key={group} className="acquisition-group" aria-label={title}><h3>{title}<span>{rows.length}</span></h3><div className="intel-v2-list">{rows.map(channel => <article key={channel.id} data-channel-id={channel.id}>
        <header><h2>{channel.name}</h2><span className="intel-v2-state">{label(channel.access_status)} · {channel.validation_status==='pending' ? '入口待验证' : label(channel.validation_status)}</span></header>
        <p className="acquisition-status">{channel.healthStatus || channel.health_status || "尚未检查"}</p><p className="intel-v2-hint">目标：{channel.desiredEnabled ?? channel.desired_enabled ? '启用' : '暂停'} · 实际：{channel.enabled ? '已启用' : '未启用'}{channel.platform ? ` · ${channel.platform}` : ''}</p>
        <dl className="acquisition-times"><div><dt>最近检查</dt><dd>{time(channel.lastAttemptAt || channel.last_attempt_at)}</dd></div><div><dt>最后成功</dt><dd>{time(channel.lastSuccessAt || channel.last_success_at || channel.last_ingest_at)}</dd></div><div><dt>上游变化</dt><dd>{time(channel.last_changed_at)}</dd></div><div><dt>下次运行</dt><dd>{channel.enabled ? time(channel.next_due_at) : '暂停中'}</dd></div></dl>
        <Stats value={channel.lastStats}/>{(channel.latencyMs ?? channel.latency_ms)!=null && <p className="intel-v2-hint">延迟 {channel.latencyMs ?? channel.latency_ms} ms</p>}{channel.source_group==='follow_builders' && <details className="acquisition-permissions"><summary>三个内容流与上游状态</summary>{Object.entries({'feed-x.json':'X 动态','feed-blogs.json':'博客全文','feed-podcasts.json':'播客转录','state-feed.json':'上游去重状态'}).map(([file,name])=>{const stream=(runs.find(r=>r.channel_id===channel.id&&r.coverage?.streams)?.coverage?.streams || {})[file];return <p className="intel-v2-hint" key={file}>{name} · {stream ? label(stream.status) : '尚未同步'}{stream?.generatedAt ? ` · 上游更新 ${time(stream.generatedAt)}` : ''}{stream?.errors?.length ? ` · ${stream.errors.map(e=>typeof e==='string'?e:e.message||JSON.stringify(e)).join('；')}` : ''}</p>;})}</details>}{(channel.last_error || channel.lastError) && <p className="intel-channel-error">{channel.last_error || channel.lastError}</p>}
        <div className="intel-v2-actions"><button className="btn btn-sm" disabled={Boolean(busy)} onClick={()=>act(channel,'validate')}>验证入口</button><button className="btn btn-sm" disabled={Boolean(busy)} onClick={()=>act(channel,'sync')}>同步最近 24 小时</button><button className="text-action" disabled={Boolean(busy)} onClick={()=>act(channel,'backfill')}>历史补采</button>{channel.adapter==='community' && channel.platform!=='reddit' && !(channel.platform==='github' && /\/search\//.test(channel.endpoint || channel.url || '')) && <button className="text-action" disabled={Boolean(busy)} onClick={()=>{setError(null);setChoice({channel,action:'configure'});}}>修改入口</button>}<button className="text-action" disabled={Boolean(busy)} onClick={()=>act(channel,channel.desiredEnabled ?? channel.desired_enabled ? 'pause' : 'enable')}>{channel.desiredEnabled ?? channel.desired_enabled ? '暂停采集' : '申请启用'}</button></div>
        <details className="acquisition-permissions"><summary>资料使用权限</summary>{channel.platform==='reddit' && <p className="intel-v2-hint">Reddit 的访问及 AI 用途必须在本机配置中提供实际批准范围，不能通过通用开关授权。导出保持关闭。</p>}<p className="intel-v2-hint">{channel.options?.aiAllowed || channel.rights?.aiAllowed ? '已允许 AI 处理' : '外部 AI 处理尚未授权'} · {channel.options?.exportAllowed || channel.rights?.exportAllowed ? '已允许导出' : '导出尚未授权'}</p><div className="intel-v2-actions"><button className="text-action" disabled={Boolean(busy) || channel.platform==='reddit' || channel.options?.aiAllowed || channel.rights?.aiAllowed} onClick={()=>{setError(null);setChoice({channel,action:'allow_ai'});}}>允许 AI 处理</button>{channel.platform !== 'reddit' && <><button className="text-action" disabled={Boolean(busy) || channel.options?.fulltextAllowed} onClick={()=>{setError(null);setChoice({channel,action:'allow_fulltext'});}}>允许补全公开原文</button><button className="text-action" disabled={Boolean(busy) || channel.options?.exportAllowed || channel.rights?.exportAllowed} onClick={()=>{setError(null);setChoice({channel,action:'allow_export'});}}>允许导出</button></>}</div></details>
      </article>)}</div></section> : null; })}
      <section className="acquisition-runs" aria-label="采集记录"><h2>采集记录</h2>{!runs.length ? <p className="intel-v2-hint">尚无采集记录。验证入口后可以同步一次。</p> : runs.map(run=><details key={run.id} data-run-id={run.id}><summary><strong>{channels.find(c=>c.id===run.channel_id)?.name || run.channel_id}</strong><span>{label(run.outcome || run.status)}{run.job_status && run.job_status!==run.status ? ` · ${label(run.job_status)}` : ''}</span></summary><Stats value={run.stats}/>{run.error && <p className="intel-channel-error">{run.error}</p>}<Coverage value={run.coverage}/>{['queued','running','pending','retry'].includes(run.job_status || run.status) && <button className="btn btn-sm" disabled={Boolean(busy)} onClick={()=>cancel(run)}>取消本次采集</button>}</details>)}</section>
    </>}
    {choice?.action==='configure' ? <ConfigureDialog choice={choice} busy={Boolean(busy)} error={error} onClose={()=>setChoice(null)} onConfirm={endpoint=>act(choice.channel,'configure',{endpoint})}/> : choice && <PermissionDialog choice={choice} busy={Boolean(busy)} error={error} onClose={()=>setChoice(null)} onConfirm={()=>act(choice.channel,choice.action)}/>}
  </section>;
}
