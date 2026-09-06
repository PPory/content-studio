import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { NewContentButton } from "../components/NewContentButton.jsx";
import { ErrorNote, Loading } from "../components/ui.jsx";
import "./workspace-home.css";
import { useDialog } from "../lib/use-dialog.js";

function Items({ items, onGo, empty }) {
  return items.length ? <div className="overview-items">{items.map(item => <button key={`${item.kind}:${item.id}`} onClick={() => onGo(item.route?.view || (item.kind === "research" ? "research" : "project"), item.route?.state || item.id)}><span><strong>{item.title || item.question || "未命名"}</strong><small>{item.excerpt?.replace(/[#*`]/g, "").slice(0, 90) || (item.kind === "research" ? "继续思考这个问题" : "回到上次的位置")}</small></span><em>{item.kind === "research" ? "讨论中" : item.kind === "project" ? "文章" : item.kind === "wiki" ? "Wiki" : "阅读"}</em></button>)}</div> : <p className="overview-empty">{empty}</p>;
}
export function Today({ onGo, onChanged, onForceGo = onGo, registerNavigationGuard }) {
  const [pending, setPending] = useState(null);
  const leaveDialog = useDialog(Boolean(pending), () => setPending(null));
  const [items, setItems] = useState(null), [activity, setActivity] = useState({ opened: [], reading: [] }), [wiki, setWiki] = useState([]);
  const [error, setError] = useState(null), [text, setText] = useState(""), [saved, setSaved] = useState(null), [connections, setConnections] = useState(null), [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState("");
  const load = useCallback(async () => {
    const results = await Promise.allSettled([api.recentWork(), api.workspaceActivity(), api.library("", "wiki")]);
    if (results[0].status === "fulfilled") setItems(results[0].value.items || []);
    if (results[1].status === "fulfilled") setActivity(results[1].value);
    if (results[2].status === "fulfilled") setWiki(results[2].value.items || []);
    setError(results.find(r => r.status === "rejected")?.reason || null);
  }, []);
  useEffect(() => { load(); window.addEventListener("focus", load); return () => window.removeEventListener("focus", load); }, [load]);
  useEffect(() => { const warn = e => { if (text.trim()) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [text]);
  useEffect(() => registerNavigationGuard?.(next => { if (!text.trim()) return false; setPending(next); return true; }), [text, registerNavigationGuard]);
  async function capture(e) {
    e.preventDefault(); if (!text.trim() || busy) return;
    setBusy(true); setError(null); const value = text;
    try {
      const { item } = await api.quickNote({ text: value }); setSaved({ ...item, original: value }); setText(""); setExpanded(false); setConnections(null); setStatus("已留下，正在查找相关 Wiki…");
      try { const result = await api.wikiConnections(value.slice(0, 500)); setConnections(result.items || []); setStatus(result.items?.length ? "已留下" : "已留下，暂未找到相关 Wiki"); } catch { setStatus("想法已保存，暂时无法查找 Wiki 关联"); }
      await load(); onChanged?.(); return true;
    } catch (e) { setError(e); return false; } finally { setBusy(false); }
  }
  async function develop(wikiItem) {
    if (!saved || busy) return; setBusy(true); setError(null);
    try {
      // Keep a created topic on retry if linking fails; never create duplicate topics.
      const id = saved.researchId || (await api.createResearch({ question: saved.original.slice(0, 300), notes: saved.original })).research.id;
      setSaved(prev => ({ ...prev, researchId: id }));
      await api.researchReference(id, { kind: "capture", id: saved.id });
      if (wikiItem) await api.researchReference(id, { kind: "wiki", id: wikiItem.id });
      onGo("research", id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function openRecent(view, id) {
    if (view !== "project") return onGo(view, id);
    try {
      const { researches } = await api.projectResearches(id);
      const topic = researches?.[0];
      if (!topic) return onGo(view, id);
      const key = `xenho:research-position:${topic.id}`;
      let previous = {};
      try { previous = JSON.parse(localStorage.getItem(key) || "{}"); } catch {}
      try { localStorage.setItem(key, JSON.stringify({ ...previous, tab: "article", projectId: id })); } catch {}
      onGo("research", topic.id);
    } catch (e) { setError(e); }
  }
  const active = (items || []).filter(item => !item.hidden);
  return <section className="workspace-overview">
    <header className="overview-heading"><div><small>我的工作台</small><h1>从一个问题，开始今天</h1><p>继续思考，也给新冒出来的想法留个位置。</p></div><NewContentButton label="直接写文章" onGo={onGo} onChanged={onChanged} /></header>
    <form className="overview-panel overview-capture" onSubmit={capture}><label htmlFor="home-thought">有什么想记下来的？</label><textarea id="home-thought" aria-label="记下灵感" value={text} onChange={e => setText(e.target.value)} placeholder="一个想法、疑问，或者想继续研究的话题…" maxLength={100000} /><div className="overview-capture-footer"><span role="status">{status || "先记录，不用起标题或分类。"}{connections?.length ? <button type="button" className="btn btn-sm" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>发现 {connections.length} 条 Wiki 关联 ↗</button> : null}</span><button className="btn btn-primary" disabled={busy || !text.trim()}>留下这条想法</button></div>
    {saved ? <div className="overview-saved"><span>{saved.title}</span><button type="button" className="btn btn-sm" disabled={busy} onClick={() => develop()}>围绕这个想法讨论 →</button></div> : null}
    {expanded ? <div className="overview-connections"><p>这些是知识连接线索，深入讨论时再核对。</p>{connections.map(item => <article key={item.id}><h3>{item.title}</h3><p>{item.reason || item.excerpt}</p><div className="row-actions"><button type="button" className="btn btn-sm" onClick={() => onGo("library", `wiki:${item.id}`)}>阅读 Wiki</button><button type="button" className="btn btn-sm" disabled={busy} onClick={() => develop(item)}>带着这个角度讨论</button></div></article>)}</div> : null}</form>
    <ErrorNote error={error} what="读取工作台" onRetry={load} />{items === null && !error ? <Loading rows={3} /> : null}
    <div className="overview-columns"><div className="overview-stack">
    <section className="overview-panel"><header><h2>正在展开的选题</h2><button className="btn btn-sm" onClick={() => onGo("research")}>全部选题 →</button></header><Items items={active.filter(i => i.kind === "research").slice(0, 4)} onGo={openRecent} empty="留下一句疑问，就可以开始讨论。不必马上写成文章。" /></section>
    <section className="overview-panel"><header><h2>文章</h2><button className="btn btn-sm" onClick={() => onGo("content")}>全部文章 →</button></header><Items items={active.filter(i => i.kind === "project").slice(0, 4)} onGo={openRecent} empty="准备好表达时，直接写，或从选题的笔记开始。" /></section>
    <section className="overview-panel"><header><h2>最近打开</h2></header><Items items={(activity.opened || []).slice(0, 5)} onGo={openRecent} empty="打开选题、文章或资料后，会在这里留下入口。" /></section></div>
    <div className="overview-stack"><section className="overview-panel"><header><h2>最近阅读</h2><button className="btn btn-sm" onClick={() => onGo("library")}>全部 →</button></header><Items items={(activity.reading || []).slice(0, 4)} onGo={openRecent} empty="阅读过的资料会出现在这里，方便接着读。" /></section>
    <section className="overview-panel"><header><h2>阅读与 Wiki</h2><button className="btn btn-sm" onClick={() => onGo("library")}>浏览 →</button></header><Items items={wiki.slice(0, 3).map(item => ({ ...item, route: { view: "library", state: `wiki:${item.id}` } }))} onGo={openRecent} empty="读原文，留下理解；有新问题时，再让知识连接起来。" /><button className="btn btn-sm" onClick={() => onGo("entries")}>管理 Wiki</button></section></div></div>
    {pending ? <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="home-leave-title" ref={leaveDialog}><h2 id="home-leave-title">这条想法还没有保存</h2><p>先留下它，下次可以在阅读与 Wiki 中找回。</p><div className="row-actions"><button className="btn" disabled={busy} onClick={() => setPending(null)}>继续记录</button><button className="btn btn-primary" disabled={busy} onClick={async () => { if (await capture({ preventDefault() {} })) onForceGo(pending.view, pending.state); }}>保存并离开</button></div><ErrorNote error={error} what="保存想法" /></section></div> : null}
  </section>;
}
