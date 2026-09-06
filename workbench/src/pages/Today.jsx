import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { NewContentButton } from "../components/NewContentButton.jsx";
import { ErrorNote, Loading } from "../components/ui.jsx";
export function Today({ onGo, onChanged, onQuickNote }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [hidden, setHidden] = useState(false);
  const load = useCallback(() => api.recentWork().then((r) => { setItems(r.items || []); setError(null); }).catch(setError), []);
  useEffect(() => { load(); window.addEventListener("focus", load); return () => window.removeEventListener("focus", load); }, [load]);
  async function update(item, patch) { try { await api.workState(item.kind, item.id, patch); await load(); } catch (e) { setError(e); } }
  const shown = (items || []).filter((item) => Boolean(item.hidden) === hidden);
  return <section className="continue-home"><header className="task-page-head"><div><h1>接着做</h1><p>上次的研究和写作，都在这里。</p></div><div className="row-actions"><button className="btn" onClick={onQuickNote}>记一下</button><NewContentButton label="写一篇" onGo={onGo} onChanged={onChanged} /></div></header><ErrorNote error={error} what="读取最近工作" onRetry={load} />{items === null && !error ? <Loading rows={3} /> : null}<div className="work-list">{shown.map((item) => <article key={`${item.kind}:${item.id}`}><button className="work-list__open" onClick={() => onGo(item.kind === "research" ? "research" : "project", item.id)}><small>{item.kind === "research" ? "研究" : "内容"}{item.pinned ? " · 已置顶" : ""}</small><h2>{item.title || item.question || "未命名"}</h2>{item.excerpt ? <p>{item.excerpt}</p> : null}<small>{item.updatedAt ? new Date(item.updatedAt).toLocaleString("zh-CN") : ""}</small></button><div className="work-list__actions"><button className="btn btn-sm" onClick={() => update(item, { pinned: !item.pinned })}>{item.pinned ? "取消置顶" : "置顶"}</button><button className="btn btn-sm" onClick={() => update(item, { hidden: !item.hidden })}>{item.hidden ? "放回最近" : "暂时收起"}</button></div></article>)}</div>{items !== null && !shown.length ? <div className="task-empty"><h2>{hidden ? "没有收起的工作" : "从你手头的事情开始"}</h2><p>可以直接写一篇，也可以先记下来，或研究一个还没想明白的问题。</p><button className="btn" onClick={() => onGo("research")}>开始研究</button></div> : null}<button className="btn btn-sm" onClick={() => setHidden(!hidden)}>{hidden ? "返回最近工作" : "查看暂时收起的工作"}</button></section>;
}
