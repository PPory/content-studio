import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ASSET_KINDS } from "../lib/personal-assets.js";
import { renderMarkdown } from "../lib/markdown.js";
import { useDialog } from "../lib/use-dialog.js";
import { ErrorNote, PageHeader, SearchBox } from "../components/ui.jsx";
import { AssistantPane } from "../components/assistant/AssistantPane.jsx";
import { NoteComposer } from "../components/NoteComposer.jsx";
import { IconDots, IconX } from "../components/icons.jsx";
import "./notes.css";

const dateLabel = value => new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export function Notes({ initialId = "", onGo, refreshKey, registerNavigationGuard }) {
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
  useEffect(() => { if (initialId) { setQuery(""); setTag(""); } }, [initialId]);
  useEffect(() => {
    if (!initialId || !items) return;
    const card = document.getElementById(`note-${initialId}`);
    if (card) { card.scrollIntoView({ block: "center" }); card.focus({ preventScroll: true }); }
    else setNotice("这条来源记录已不存在或已移入回收站。");
  }, [initialId, items]);
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
      <div className="notes-toolbar"><span>{tag ? `#${tag}` : "全部记录"}<small>{filtered.length}</small></span><SearchBox ariaLabel="搜索记录" placeholder="搜索记录与标签" value={query} onChange={setQuery} /></div>
      {allTags.length > 0 && <div className="notes-tags" aria-label="按标签筛选"><button className="notes-tag" aria-pressed={!tag} onClick={() => setTag("")}>全部</button>{allTags.map(value => <button className="notes-tag" key={value} aria-pressed={tag === value} onClick={() => setTag(tag === value ? "" : value)}>#{value}</button>)}</div>}
      <ErrorNote error={error} what="读取记录" onRetry={load} />
      <div className="notes-notice" role="status">{notice}</div>
      {!items && !error ? <p className="notes-empty" role="status">正在读取记录…</p> : null}
      {items && filtered.length === 0 && <div className="notes-empty"><h3>{items.length ? "没有找到相关记录" : "把第一个念头留在这里"}</h3><p>{items.length ? "试试其他关键词，或清除标签筛选。" : "不必想好标题，也不用马上把它写成文章。"}</p>{items.length > 0 && <button className="btn btn-sm" onClick={() => { setQuery(""); setTag(""); }}>清除筛选</button>}</div>}
      <div className="notes-list">{filtered.map(item => <NoteCard key={item.id} item={item} onGo={onGo} onDirty={value => markDirty(item.id, value)} onUpdate={update} onRemove={remove} onInsight={() => setSelected(item)} onTag={setTag} onNotice={setNotice} />)}</div>
    </div>
    {selected && <NoteInsight key={`${selected.id}:${selected.version}`} item={selected} onClose={() => setSelected(null)} onGo={onGo} onSaved={load} onDirty={value => markDirty("insight", value)} />}
  </div>;
}

function NoteCard({ item, onGo, onUpdate, onRemove, onInsight, onTag, onNotice, onDirty }) {
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
  return <article id={`note-${item.id}`} tabIndex={-1} className="note-card" aria-label={`记录 ${dateLabel(item.createdAt)}`}>
    <header className="note-card__header"><div><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time>{item.pinned && <span className="note-card__pin">置顶</span>}</div><div className="note-card__actions"><button type="button" className="btn btn-sm note-insight-trigger" disabled={busy || editing} onClick={onInsight}>✧ AI 洞察</button><details className="note-menu" ref={menu}><summary aria-label="记录操作" title="更多操作"><IconDots aria-hidden="true" /></summary><div className="note-menu__panel"><button disabled={busy} onClick={() => { closeMenu(); setEditing(true); }}>编辑</button><button disabled={busy} onClick={() => act(async () => { await navigator.clipboard.writeText(item.text); onNotice("已复制记录"); })}>复制</button><button disabled={busy} onClick={() => act(() => onUpdate(item, { pinned: !item.pinned }))}>{item.pinned ? "取消置顶" : "置顶"}</button><button disabled={busy} onClick={() => { closeMenu(); onInsight(); }}>AI 洞察</button><hr /><button className="note-menu__danger" disabled={busy} onClick={() => { closeMenu(); setConfirm(true); }}>删除</button></div></details></div></header>
    {editing ? <NoteComposer initial={item} onDirty={onDirty} autoFocus onCancel={() => setEditing(false)} onSave={async body => { await onUpdate(item, body); setEditing(false); }} /> : <><div className={`note-card__body${long && !expanded ? " note-card__body--collapsed" : ""}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} />{(long || itemTags.length > 0) && <footer className="note-card__footer">{long ? <button className="note-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "收起" : "展开全文"}</button> : <span />} {itemTags.length > 0 && <div className="notes-tags note-card__tags">{itemTags.map(value => <button className="notes-tag" key={value} onClick={() => onTag(value)}>#{value}</button>)}</div>}</footer>}</>}
    {confirm && <div className="note-delete-confirm"><p>将这条记录移入回收站？已保存的个人资产仍会保留。</p><button className="btn btn-sm" disabled={busy} onClick={() => setConfirm(false)}>取消</button><button className="btn btn-sm" disabled={busy} onClick={() => act(() => onRemove(item))}>{busy ? "正在删除…" : "确认删除"}</button></div>}
    {item.origin && <button className="note-expand" onClick={() => onGo?.("notes", item.origin.parentNoteId)}>来自{item.origin.conversationId ? "讨论" : "洞察"} · 查看原记录</button>}
    <ErrorNote error={error} what="操作记录" />
  </article>;
}

function NoteInsight({ item, onClose, onGo, onSaved, onDirty }) {
  const [insight, setInsight] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState("insight");
  const [thought, setThought] = useState(null);
  const [thoughtDirty, setThoughtDirty] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [chatReady, setChatReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { onDirty?.(dirty || thoughtDirty); return () => onDirty?.(false); }, [dirty, thoughtDirty, onDirty]);
  useEffect(() => {
    let live = true;
    api.assistantConversations(`note:${item.id}`).then(r => {
      if (live) setConversationId(r.conversations?.items?.find(c => !c.archivedAt)?.id || "");
    }).catch(() => {}).finally(() => { if (live) setChatReady(true); });
    return () => { live = false; };
  }, [item.id]);
  const mounted = useRef(false);
  const generation = useRef(0);
  const closeState = useRef(null);
  closeState.current = { dirty: dirty || thoughtDirty, saved: saved && !thoughtDirty, busy, onClose };
  const close = useCallback(() => {
    const current = closeState.current;
    if (current.busy) return false;
    if (current.dirty && !current.saved && !window.confirm("候选内容尚未保存，确认放弃修改并关闭？")) return false;
    current.onClose(); return true;
  }, []);
  const ref = useDialog(true, close);
  const load = useCallback(async (refresh = false) => {
    const current = ++generation.current;
    setBusy(true); setError(null);
    try {
      let result = refresh ? await api.noteInsights(item.id, { refresh: true }) : await api.savedNoteInsights(item.id);
      if (!result.insight) result = await api.noteInsights(item.id);
      if (!mounted.current || generation.current !== current) return;
      setInsight({ ...result.insight, stale: result.stale || result.insight?.stale }); setCandidate(result.insight?.assetCandidate || null);
      setDirty(false); setSaved(null);
    } catch (cause) { if (mounted.current && generation.current === current) setError(Object.assign(cause, { hint: cause.hint || "请稍后重试，或在设置中检查 AI 服务。原记录已保留。" })); }
    finally { if (mounted.current && generation.current === current) setBusy(false); }
  }, [item.id]);
  // This component only mounts after an explicit click; hovering never requests AI.
  useEffect(() => {
    mounted.current = true; load();
    return () => { mounted.current = false; generation.current++; };
  }, [load]);
  function change(key, value) { setDirty(true); setCandidate(previous => ({ ...previous, [key]: value })); }
  function beginThought(text, source = "insight") {
    if (thoughtDirty && !window.confirm("新想法尚未保存，确认替换当前输入？")) return;
    setThought({ text, source, key: Date.now() }); setThoughtDirty(false);
  }
  function refresh() {
    if ((dirty || thoughtDirty) && !window.confirm("重新生成会替换洞察候选，是否放弃尚未保存的修改？")) return;
    setThought(null); setThoughtDirty(false); load(true);
  }
  async function saveThought(body) {
    await api.noteThought(item.id, { ...body, confirmed: true, expectedVersion: item.version, ...(thought?.source !== "discussion" && insight?.id ? { insightId: insight.id } : {}), ...(thought?.source === "discussion" && conversationId ? { conversationId } : {}) });
    setThought(null); setThoughtDirty(false); setMessage("新想法已保存为独立记录。"); await onSaved?.();
  }
  async function save() {
    if (!candidate || busy) return;
    setBusy(true); setError(null);
    try { const result = await api.createPersonalAsset({ ...candidate, confirmed: true }); if (mounted.current) { setSaved(result.item); setDirty(false); } }
    catch (cause) { if (mounted.current) setError(cause); } finally { if (mounted.current) setBusy(false); }
  }
  return <div className="note-insight-backdrop"><aside ref={ref} className="note-insight-panel" role="dialog" aria-modal="true" aria-label="AI 洞察">
    <header className="note-insight-panel__header"><div><span className="note-insight-eyebrow">从记录到创作</span><h2>AI 洞察</h2></div><button type="button" className="btn btn-sm btn-icon note-insight-close" aria-label="关闭" title="关闭" onClick={close}><IconX aria-hidden="true" /></button></header>
    <div className="note-insight-tabs" role="tablist" aria-label="记录探索"><button role="tab" aria-selected={tab === "insight"} onClick={() => setTab("insight")}>洞察与关联</button><button role="tab" aria-selected={tab === "discussion"} onClick={() => setTab("discussion")}>继续讨论</button></div>
    <div className="note-insight-panel__content" hidden={tab !== "insight"}>
      {insight && <section className="note-analysis"><div className="note-insight-section-head"><h3>这条记录值得注意的地方</h3><button className="btn btn-sm" disabled={busy} onClick={refresh}>{busy ? "正在更新…" : "重新洞察"}</button></div><p className="note-insight-summary">{insight.summary}</p>{insight.generatedAt && <p className="note-insight-help">生成于 {dateLabel(insight.generatedAt)} · AI 分析供参考</p>}{insight.stale && <p className="note-insight-help" role="status">原记录或关联来源已变化，以下是旧版洞察。请重新洞察后再保存。</p>}
        <h3>与你已有内容的联系</h3>{insight.connections?.length ? insight.connections.map((link, index) => <article className="note-connection" key={`${link.kind}:${link.id}:${index}`}><div className="note-insight-section-head"><strong>{link.title}</strong><span>{({ support: "支持", complement: "补充", tension: "分歧", transfer: "迁移" })[link.relation] || link.relation}</span></div><p>{link.explanation}</p>{link.application && <p><strong>可以这样用：</strong>{link.application}</p>}<details><summary>查看关联依据 · {link.kind === "wiki" ? "Wiki" : "记一下"}</summary><blockquote><small>本条记录</small>{link.noteQuote}</blockquote><blockquote><small>关联原文</small>{link.quote}</blockquote><button className="btn btn-sm" onClick={() => { if (!close()) return; onGo(link.kind === "wiki" ? "library" : "notes", link.kind === "wiki" ? `wiki:${link.id}` : link.id); }}>打开来源</button></details></article>) : <p className="note-insight-help">本轮没有找到足够相关的笔记或 Wiki，暂不强行建立联系。</p>}
        {insight.angles?.length > 0 && <><h3>可以继续展开的方向</h3>{insight.angles.map((angle, index) => <article className="note-angle" key={index}><strong>{angle.title}</strong><p>{angle.thought}</p><p className="note-insight-help">下一步：{angle.nextStep}</p><button className="btn btn-sm" disabled={insight.stale} onClick={() => { beginThought(`${angle.title}\n\n${angle.thought}\n\n${angle.nextStep}`); }}>整理成新想法</button></article>)}</>}
        {insight.questions?.length > 0 && <details className="note-followup"><summary>再换几个角度想想</summary><ul className="note-insight-questions">{insight.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></details>}
        <div className="note-insight-actions"><button className="btn btn-primary btn-sm" onClick={() => setTab("discussion")}>继续讨论</button><button className="btn btn-sm" onClick={() => { beginThought(""); }} disabled={insight.stale}>记下新想法</button></div>
      </section>}
      {busy && !insight && <div className="note-insight-loading" role="status"><span aria-hidden="true">✧</span><div><strong>正在阅读这条记录</strong><p>整理可继续追问的方向…</p></div></div>}
      {!insight && <div className="note-insight-state"><ErrorNote error={error} what="生成洞察" onRetry={() => load()} /></div>}
      <section className="note-insight-source"><div className="note-insight-section-head"><h3>原记录</h3><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></div><blockquote className="note-insight-original">{item.text}</blockquote></section>
      {insight && <>{candidate && <section className="note-asset-candidate"><h3>个人资产候选</h3><p className="note-insight-help">核对后再保存；内容仅支持保留原文或逐字摘录，不补写经历。原记录会作为来源保留。</p>{saved ? <div role="status"><p>已保存到个人资产。</p><button className="btn btn-primary" onClick={() => { onClose(); onGo?.("personal-assets", saved.id); }}>查看个人资产</button></div> : <><label>信息类型<select value={candidate.kind} disabled={busy} onChange={event => change("kind", event.target.value)}>{Object.entries(ASSET_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>标题<input value={candidate.title || ""} disabled={busy} onChange={event => change("title", event.target.value)} /></label><label>内容<textarea rows={7} value={candidate.body || ""} disabled={busy} onChange={event => change("body", event.target.value)} /></label><label>发生时间（可选）<input type="date" value={candidate.eventDate || ""} disabled={busy} onChange={event => change("eventDate", event.target.value)} /></label><label>写作时如何使用<select value={candidate.usage || "ask"} disabled={busy} onChange={event => change("usage", event.target.value)}><option value="ask">每次询问</option><option value="private">仅自己保存</option><option value="reference">可以引用</option></select></label><button className="btn btn-primary" disabled={busy || !candidate.title?.trim() || !candidate.body?.trim()} onClick={save}>{busy ? "正在保存…" : "确认并存入个人资产"}</button></>}</section>}</>}
      {insight && <div className="note-insight-state"><ErrorNote error={error} what="处理洞察" onRetry={refresh} /></div>}
    </div>
    {tab === "discussion" && <div className="note-discussion">{chatReady ? <AssistantPane embedded scope="global" surface="page" scopeId={`note:${item.id}`} initialConversationId={conversationId} document={{ noteId: item.id, title: item.title }} target={{ kind: "none", editable: false }} onConversationChange={setConversationId} draftStorageKey={`note-discussion:${item.id}`} emptyMessage="聊聊你的判断，或让 AI 解释这些内容如何联系起来。" onExcerpt={text => { beginThought(text, "discussion"); }} /> : <p role="status">正在恢复讨论…</p>}</div>}
    {thought && <div className="note-thought"><div className="note-insight-section-head"><h3>保存前整理一下</h3><span className="note-insight-help">将新建一条记录，保留来源</span></div><NoteComposer key={thought.key} initial={{ text: thought.text }} compact onDirty={setThoughtDirty} onCancel={() => setThought(null)} onSave={saveThought} /></div>}
    {message && <p className="note-insight-message" role="status">{message}</p>}
  </aside></div>;
}
