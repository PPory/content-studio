import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ASSET_KINDS, ASSET_USAGE, assetDate } from "../lib/personal-assets.js";
import { ErrorNote, SearchBox } from "../components/ui.jsx";
import { useDialog } from "../lib/use-dialog.js";
import { IconPlus, IconSparkles, IconX, IconArrowUpRight } from "../components/icons.jsx";
import { PersonalAssetIntake } from "../components/PersonalAssetIntake.jsx";
import "./personal-assets.css";

const blank = () => ({ kind: "identity", title: "", body: "", eventDate: "", usage: "ask" });

function AssetEditor({ asset, onClose, onSaved, onDirty }) {
  const [form, setForm] = useState(() => asset || blank());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const closeState = useRef(null);
  closeState.current = { busy, dirty, onClose };
  const close = useCallback(() => {
    const current = closeState.current;
    if (!current.busy && (!current.dirty || window.confirm("放弃本次尚未保存的修改？"))) current.onClose();
  }, []);
  const ref = useDialog(true, close);
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = e => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const field = key => ({ value: form[key] || "", onChange: e => { setDirty(true); setForm(f => ({ ...f, [key]: e.target.value })); } });
  async function save(e) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try {
      const body = { kind: form.kind, title: form.title.trim(), body: form.body.trim(), eventDate: form.eventDate || "", usage: form.usage, confirmed: true,
        ...(asset?.id ? { expectedVersion: asset.version } : {}) };
      const result = asset?.id ? await api.savePersonalAsset(asset.id, body) : await api.createPersonalAsset(body);
      onSaved(result.item);
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><section className="asset-editor" ref={ref} role="dialog" aria-modal="true" aria-labelledby="asset-editor-title">
    <header><h2 id="asset-editor-title">{asset?.id ? "编辑个人资产" : "添加个人资产"}</h2><button className="icon-btn" aria-label="关闭个人资产编辑" onClick={close} disabled={busy}><IconX size={18} /></button></header>
    <form onSubmit={save}>
      <div className="asset-editor__pair"><label>信息类型<select {...field("kind")}>{Object.entries(ASSET_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>发生或生效日期<input type="date" {...field("eventDate")} /></label></div>
      <label>标题<input required maxLength={200} placeholder="例如：我为什么开始做内容创作" {...field("title")} /></label>
      <label>具体内容<textarea required rows={8} maxLength={20000} placeholder="写下真实情况、做过的事，以及当时的想法。可以随时更新。" {...field("body")} /></label>
      <label>写作引用权限<select {...field("usage")}>{Object.entries(ASSET_USAGE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <p className="asset-hint">{form.usage === "private" ? "仅保存在个人资产中，不进入文章引用或写作 AI。" : form.usage === "ask" ? "每篇文章选择使用时，都需要你明确确认；信息更新后需重新确认。" : "可在写作中查找；只有选入文章后才交给该篇的 AI 参考。"}</p>
      <ErrorNote error={error} what="保存个人资产" />
      <footer><span>确认内容真实后保存，修改会保留历史。</span><button className="btn btn-primary" disabled={busy || !form.title.trim() || !form.body.trim()}>{busy ? "正在保存…" : "确认并保存"}</button></footer>
    </form>
  </section></div>;
}

function AssetDetail({ id, onClose, onEdit, onRemoved, onGo }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ref = useDialog(true, onClose);
  useEffect(() => {
    let live = true;
    api.personalAsset(id).then(r => { if (live) setData(r); }).catch(e => { if (live) setError(e); });
    return () => { live = false; };
  }, [id]);
  async function remove() {
    setBusy(true); setError(null);
    try { await api.trashPersonalAsset(id); onRemoved(); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  const item = data?.item;
  return <div className="modal-backdrop"><section ref={ref} className="asset-editor asset-detail" role="dialog" aria-modal="true" aria-label="个人资产详情">
    <header><h2>{item?.title || "个人资产"}</h2><button className="icon-btn" aria-label="关闭个人资产详情" disabled={busy} onClick={onClose}><IconX size={18} /></button></header>
    <ErrorNote error={error} what="读取个人资产" />
    {!data && !error ? <p role="status">正在读取…</p> : null}
    {item ? <><p className="asset-meta">{ASSET_KINDS[item.kind]} · {ASSET_USAGE[item.usage]} · 第 {item.version} 版</p><p className="asset-detail__body">{item.body}</p><p className="asset-meta">{item.eventDate ? `发生或生效于 ${item.eventDate} · ` : ""}更新于 {assetDate(item.updatedAt)}</p>
      {item.sourceNoteId ? <button className="btn btn-sm" onClick={() => { onClose(); onGo("notes", item.sourceNoteId); }}>来源：随手记录 · 第 {item.sourceVersion} 版 <IconArrowUpRight size={14} /></button> : null}
      {item.sourceSnapshot ? <details className="asset-history"><summary>查看来源原文 · 第 {item.sourceVersion} 版</summary><p className="asset-detail__body">{item.sourceSnapshot}</p></details> : null}
      {item.intakeSource ? <details className="asset-history"><summary>查看自述来源原文</summary><p className="asset-detail__body">{item.intakeSource.sourceText}</p>{item.intakeSource.evidenceQuote ? <><h3>本条依据</h3><p className="asset-detail__body">{item.intakeSource.evidenceQuote}</p></> : null}</details> : null}
      <details className="asset-history"><summary>修改历史</summary>{(data.versions || []).map(version => <article key={version.version}><h3>第 {version.version} 版 · {assetDate(version.createdAt || version.updatedAt)}</h3><strong>{version.title}</strong><p>{version.body}</p></article>)}{!data.versions?.length ? <p>还没有历史修改。</p> : null}</details>
      <footer><button className="btn" onClick={() => setDeleting(true)} disabled={busy}>删除</button><button className="btn btn-primary" onClick={() => onEdit(item)}>编辑信息</button></footer>
      {deleting ? <div className="asset-delete" role="alert"><p>删除后将不再用于后续写作参考。已写入文章的文字不会自动删除。</p><button className="btn" onClick={() => setDeleting(false)} disabled={busy}>取消</button><button className="btn" disabled={busy} onClick={remove}>{busy ? "正在删除…" : "确认删除"}</button></div> : null}
    </> : null}
  </section></div>;
}

export function PersonalAssets({ initialId = "", onGo, registerNavigationGuard }) {
  const [items, setItems] = useState(null);
  const [query, setQuery] = useState("");
  const [intake, setIntake] = useState(false);
  const [kind, setKind] = useState("");
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(initialId);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const request = useRef(0);
  const editingDirty = useRef(false);
  const onDirty = useCallback(value => { editingDirty.current = value; }, []);
  useEffect(() => registerNavigationGuard?.(() => editingDirty.current && !window.confirm("个人资产还有修改未保存，确定离开？")), [registerNavigationGuard]);
  const closeEditor = useCallback(() => setEditing(null), []);
  const closeDetail = useCallback(() => setDetail(""), []);
  useEffect(() => setDetail(initialId), [initialId]);
  useEffect(() => {
    const token = ++request.current; setError(null);
    const timer = setTimeout(() => api.personalAssets().then(r => { if (request.current === token) setItems(r.items); }).catch(e => { if (request.current === token) setError(e); }), 150);
    return () => { clearTimeout(timer); request.current++; };
  }, [revision]);
  const visibleItems = items?.filter(item => (!kind || item.kind === kind) && (!query.trim() || `${item.title} ${item.body}`.toLowerCase().includes(query.trim().toLowerCase())));
  const latest = items?.length ? items.reduce((date, item) => item.updatedAt > date ? item.updatedAt : date, "") : "";
  return <div className="personal-assets">
    <header className="asset-page-head"><div><h1>个人资产</h1><p>关于你是谁、正在做什么，以及亲自走过的路。</p></div><div className="asset-page-actions"><button className="btn" onClick={() => { setNotice(""); setEditing(blank()); }}><IconPlus size={16} />手动添加</button><button className="btn btn-primary" onClick={() => setIntake(true)}><IconSparkles size={16} />整理一段自述</button></div></header>
    <section className="asset-overview" aria-label="已确认个人资产概览"><div className="asset-overview__summary"><strong>{items?.length ?? "—"}</strong><span>条已确认信息</span><small>{latest ? `最近更新 ${assetDate(latest)}` : "从真实的自我介绍开始积累"}</small></div><div className="asset-overview__kinds">{Object.entries(ASSET_KINDS).map(([key, label]) => <button key={key} aria-pressed={kind === key} onClick={() => setKind(kind === key ? "" : key)}><span>{label}</span><strong>{items ? items.filter(item => item.kind === key).length : "—"}</strong></button>)}</div></section>
    <div className="asset-tools"><div className="asset-tabs" aria-label="个人资产类型"><button aria-pressed={!kind} onClick={() => setKind("")}>全部</button>{Object.entries(ASSET_KINDS).map(([key, label]) => <button key={key} aria-pressed={kind === key} onClick={() => setKind(key)}>{label}</button>)}</div><SearchBox value={query} onChange={setQuery} placeholder="搜索个人资产" /></div>
    <ErrorNote error={error} what="读取个人资产" onRetry={() => setRevision(v => v + 1)} />
    {notice ? <p className="asset-notice" role="status">{notice}</p> : null}
    {!items && !error ? <p role="status">正在读取…</p> : null}
    {visibleItems?.length === 0 ? <div className="asset-empty"><h2>{query || kind ? "没有找到相关信息" : "从一段真实的自我介绍开始"}</h2><p>{query || kind ? "试试其他关键词，或查看全部类型。" : "身份、近况、经历与表达偏好，可以分条保存，慢慢补充。写作时再选择需要的内容。"}</p>{!query && !kind ? <button className="btn" onClick={() => setEditing(blank())}>写下第一条</button> : null}</div> : null}
    <div className="asset-list">{visibleItems?.map(item => <button key={item.id} className="asset-row" onClick={() => setDetail(item.id)}><span className="asset-row__kind">{ASSET_KINDS[item.kind]}</span><span className="asset-row__content"><strong>{item.title}</strong><span>{item.body}</span></span><span className="asset-row__meta"><span>{ASSET_USAGE[item.usage]}</span><time>{assetDate(item.updatedAt)}</time></span><IconArrowUpRight size={16} /></button>)}</div>
    {intake ? <PersonalAssetIntake onDirty={onDirty} onClose={() => setIntake(false)} onSaved={saved => { setIntake(false); setRevision(v => v + 1); setNotice(`已确认保存 ${saved.length} 条个人资产。`); }} /> : null}
    {editing ? <AssetEditor key={editing.id || "new"} asset={editing} onDirty={onDirty} onClose={closeEditor} onSaved={() => { setEditing(null); setRevision(v => v + 1); setNotice("个人资产已保存。"); }} /> : null}
    {detail && !editing ? <AssetDetail key={detail} id={detail} onClose={closeDetail} onGo={onGo} onEdit={item => { setDetail(""); setEditing(item); }} onRemoved={() => { setDetail(""); setRevision(v => v + 1); setNotice("已删除，后续写作不再引用。"); }} /> : null}
  </div>;
}
