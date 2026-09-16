import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ASSET_KINDS } from "../lib/personal-assets.js";
import { renderMarkdown } from "../lib/markdown.js";
import { useDialog } from "../lib/use-dialog.js";
import { ErrorNote, PageHeader } from "../components/ui.jsx";
import { NoteComposer } from "../components/NoteComposer.jsx";
import { IconDots, IconX } from "../components/icons.jsx";
import "./notes.css";

const dateLabel = value => new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export function Notes({ onGo, refreshKey, registerNavigationGuard }) {
  const [items, setItems] = useState(null);
  const [tags, setTags] = useState([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState(null);
  const request = useRef(0);
  const dirtyNotes = useRef(new Set());
  const markDirty = useCallback((id, value) => { if (value) dirtyNotes.current.add(id); else dirtyNotes.current.delete(id); }, []);
  useEffect(() => registerNavigationGuard?.(() => dirtyNotes.current.size > 0 && !window.confirm("还有记录未保存，确定离开并放弃输入？")), [registerNavigationGuard]);
  const load = useCallback(async () => {
    const current = ++request.current;
    setError(null);
    try {
      const result = await api.quickNotes();
      if (current !== request.current) return;
      setItems(result.items || []); setTags(result.tags || []);
    } catch (cause) { if (current === request.current) setError(cause); }
  }, []);
  useEffect(() => { load(); return () => { request.current++; }; }, [load, refreshKey]);
  async function create(body) { await api.quickNote(body); setNotice("已保存这条记录"); await load(); }
  async function update(item, body) { await api.saveQuickNote(item.id, { ...body, expectedVersion: item.version }); await load(); }
  async function remove(item) { await api.trashQuickNote(item.id); setNotice("记录已移入回收站"); await load(); }
  const search = query.trim().toLowerCase();
  const filtered = (items || []).filter(item => (!tag || item.tags?.includes(tag)) && (!search || `${item.text} ${(item.tags || []).join(" ")}`.toLowerCase().includes(search)))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const allTags = tags.map(value => typeof value === "string" ? value : value.tag || value.name).filter(Boolean);
  return <div className="notes-page">
    <PageHeader title="记一下" count={items ? `${items.length} 条` : undefined} />
    <div className="notes-stream">
      <div className="notes-intro"><h2>先记下来，慢慢展开。</h2><p>一个念头、一段经历，或今天新发现的事。</p></div>
      <NoteComposer onSave={create} onDirty={value => markDirty("new", value)} />
      <div className="notes-toolbar"><span>{tag ? `#${tag}` : "全部记录"}<small>{filtered.length}</small></span><input className="notes-search" type="search" aria-label="搜索记录" placeholder="搜索记录与标签" value={query} onChange={event => setQuery(event.target.value)} /></div>
      {allTags.length > 0 && <div className="notes-tags" aria-label="按标签筛选"><button className="notes-tag" aria-pressed={!tag} onClick={() => setTag("")}>全部</button>{allTags.map(value => <button className="notes-tag" key={value} aria-pressed={tag === value} onClick={() => setTag(tag === value ? "" : value)}>#{value}</button>)}</div>}
      <ErrorNote error={error} what="读取记录" onRetry={load} />
      <div className="notes-notice" role="status">{notice}</div>
      {!items && !error ? <p className="notes-empty" role="status">正在读取记录…</p> : null}
      {items && filtered.length === 0 && <div className="notes-empty"><h3>{items.length ? "没有找到相关记录" : "把第一个念头留在这里"}</h3><p>{items.length ? "试试其他关键词，或清除标签筛选。" : "不必想好标题，也不用马上把它写成文章。"}</p>{items.length > 0 && <button className="btn btn-sm" onClick={() => { setQuery(""); setTag(""); }}>清除筛选</button>}</div>}
      <div className="notes-list">{filtered.map(item => <NoteCard key={item.id} item={item} onDirty={value => markDirty(item.id, value)} onUpdate={update} onRemove={remove} onInsight={() => setSelected(item)} onTag={setTag} onNotice={setNotice} />)}</div>
    </div>
    {selected && <NoteInsight key={`${selected.id}:${selected.version}`} item={selected} onClose={() => setSelected(null)} onGo={onGo} />}
  </div>;
}

function NoteCard({ item, onUpdate, onRemove, onInsight, onTag, onNotice, onDirty }) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const menu = useRef(null);
  useEffect(() => {
    const close = event => { if (!menu.current?.contains(event.target)) menu.current?.removeAttribute("open"); };
    const escape = event => { if (event.key === "Escape") { menu.current?.removeAttribute("open"); menu.current?.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", close); menu.current?.addEventListener("keydown", escape);
    const current = menu.current;
    return () => { document.removeEventListener("pointerdown", close); current?.removeEventListener("keydown", escape); };
  }, []);
  function closeMenu() { menu.current?.removeAttribute("open"); }
  async function act(action) {
    closeMenu(); setError(null); setBusy(true);
    try { await action(); } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  const long = item.text.length > 360 || item.text.split("\n").length > 7;
  const itemTags = item.tags || [];
  return <article className="note-card" aria-label={`记录 ${dateLabel(item.createdAt)}`}>
    <header className="note-card__header"><div><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time>{item.pinned && <span className="note-card__pin">置顶</span>}</div><div className="note-card__actions"><button type="button" className="btn btn-sm note-insight-trigger" disabled={busy || editing} onClick={onInsight}>✧ AI 洞察</button><details className="note-menu" ref={menu}><summary aria-label="记录操作" title="更多操作"><IconDots aria-hidden="true" /></summary><div className="note-menu__panel"><button disabled={busy} onClick={() => { closeMenu(); setEditing(true); }}>编辑</button><button disabled={busy} onClick={() => act(async () => { await navigator.clipboard.writeText(item.text); onNotice("已复制记录"); })}>复制</button><button disabled={busy} onClick={() => act(() => onUpdate(item, { pinned: !item.pinned }))}>{item.pinned ? "取消置顶" : "置顶"}</button><button disabled={busy} onClick={() => { closeMenu(); onInsight(); }}>AI 洞察</button><hr /><button className="note-menu__danger" disabled={busy} onClick={() => { closeMenu(); setConfirm(true); }}>删除</button></div></details></div></header>
    {editing ? <NoteComposer initial={item} onDirty={onDirty} autoFocus onCancel={() => setEditing(false)} onSave={async body => { await onUpdate(item, body); setEditing(false); }} /> : <><div className={`note-card__body${long && !expanded ? " note-card__body--collapsed" : ""}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} />{(long || itemTags.length > 0) && <footer className="note-card__footer">{long ? <button className="note-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "收起" : "展开全文"}</button> : <span />} {itemTags.length > 0 && <div className="notes-tags note-card__tags">{itemTags.map(value => <button className="notes-tag" key={value} onClick={() => onTag(value)}>#{value}</button>)}</div>}</footer>}</>}
    {confirm && <div className="note-delete-confirm"><p>将这条记录移入回收站？已保存的个人资产仍会保留。</p><button className="btn btn-sm" disabled={busy} onClick={() => setConfirm(false)}>取消</button><button className="btn btn-sm" disabled={busy} onClick={() => act(() => onRemove(item))}>{busy ? "正在删除…" : "确认删除"}</button></div>}
    <ErrorNote error={error} what="操作记录" />
  </article>;
}

function NoteInsight({ item, onClose, onGo }) {
  const [insight, setInsight] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [dirty, setDirty] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const closeState = useRef(null);
  closeState.current = { dirty, saved, busy, onClose };
  const close = useCallback(() => {
    const current = closeState.current;
    if (current.busy && current.dirty) return;
    if (current.dirty && !current.saved && !window.confirm("候选内容尚未保存，确认放弃修改并关闭？")) return;
    current.onClose();
  }, []);
  const ref = useDialog(true, close);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true); setError(null);
    try {
      const result = await api.noteInsights(item.id);
      if (!mounted.current || generation.current !== current) return;
      setInsight(result.insight); setCandidate(result.insight?.assetCandidate || null);
    } catch (cause) { if (mounted.current && generation.current === current) setError(Object.assign(cause, { hint: cause.hint || "请稍后重试，或在设置中检查 AI 服务。原记录已保留。" })); }
    finally { if (mounted.current && generation.current === current) setBusy(false); }
  }, [item.id]);
  // This component only mounts after an explicit click; hovering never requests AI.
  useEffect(() => {
    mounted.current = true; load();
    return () => { mounted.current = false; generation.current++; };
  }, [load]);
  function change(key, value) { setDirty(true); setCandidate(previous => ({ ...previous, [key]: value })); }
  async function save() {
    if (!candidate || busy) return;
    setBusy(true); setError(null);
    try { const result = await api.createPersonalAsset({ ...candidate, confirmed: true }); if (mounted.current) { setSaved(result.item); setDirty(false); } }
    catch (cause) { if (mounted.current) setError(cause); } finally { if (mounted.current) setBusy(false); }
  }
  return <div className="note-insight-backdrop"><aside ref={ref} className="note-insight-panel" role="dialog" aria-modal="true" aria-label="AI 洞察">
    <header className="note-insight-panel__header"><div><span className="note-insight-eyebrow">从记录到创作</span><h2>AI 洞察</h2></div><button type="button" className="btn btn-sm btn-icon note-insight-close" aria-label="关闭" title="关闭" onClick={close}><IconX aria-hidden="true" /></button></header>
    <div className="note-insight-panel__content">
      {busy && !insight && <div className="note-insight-loading" role="status"><span aria-hidden="true">✧</span><div><strong>正在阅读这条记录</strong><p>整理可继续追问的方向…</p></div></div>}
      {!insight && <div className="note-insight-state"><ErrorNote error={error} what="生成洞察" onRetry={load} /></div>}
      <section className="note-insight-source"><div className="note-insight-section-head"><h3>原记录</h3><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></div><blockquote className="note-insight-original">{item.text}</blockquote></section>
      {insight && <><section><h3>值得继续想一想</h3><p className="note-insight-summary">{insight.summary}</p>{insight.questions?.length > 0 && <ul className="note-insight-questions">{insight.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>}</section>{candidate && <section className="note-asset-candidate"><h3>个人资产候选</h3><p className="note-insight-help">核对后再保存；内容仅支持保留原文或逐字摘录，不补写经历。原记录会作为来源保留。</p>{saved ? <div role="status"><p>已保存到个人资产。</p><button className="btn btn-primary" onClick={() => { onClose(); onGo?.("personal-assets", saved.id); }}>查看个人资产</button></div> : <><label>信息类型<select value={candidate.kind} disabled={busy} onChange={event => change("kind", event.target.value)}>{Object.entries(ASSET_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>标题<input value={candidate.title || ""} disabled={busy} onChange={event => change("title", event.target.value)} /></label><label>内容<textarea rows={7} value={candidate.body || ""} disabled={busy} onChange={event => change("body", event.target.value)} /></label><label>发生时间（可选）<input type="date" value={candidate.eventDate || ""} disabled={busy} onChange={event => change("eventDate", event.target.value)} /></label><label>写作时如何使用<select value={candidate.usage || "ask"} disabled={busy} onChange={event => change("usage", event.target.value)}><option value="ask">每次询问</option><option value="private">仅自己保存</option><option value="reference">可以引用</option></select></label><button className="btn btn-primary" disabled={busy || !candidate.title?.trim() || !candidate.body?.trim()} onClick={save}>{busy ? "正在保存…" : "确认并存入个人资产"}</button></>}</section>}</>}
      {insight && <div className="note-insight-state"><ErrorNote error={error} what="保存个人资产" /></div>}
    </div>
  </aside></div>;
}
