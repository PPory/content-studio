import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ASSET_KINDS, ASSET_USAGE } from "../lib/personal-assets.js";
import { ErrorNote } from "./ui.jsx";
import "../pages/personal-assets.css";

export function ProjectPersonalAssets({ projectId, query = "", onGo, onChanged }) {
  const [references, setReferences] = useState([]);
  const [items, setItems] = useState(null);
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [destinations, setDestinations] = useState([]);
  const [selected, setSelected] = useState(null);
  const load = useCallback(async (q = "") => {
    const result = await api.projectPersonalAssets(projectId, q);
    setReferences(result.references || []); setDestinations(result.destinations || []);
    return result;
  }, [projectId]);
  useEffect(() => { let live = true; api.projectPersonalAssets(projectId).then(r => { if (live) { setReferences(r.references || []); setDestinations(r.destinations || []); } }).catch(e => { if (live) setError(e); }); return () => { live = false; }; }, [projectId]);
  async function search(e) {
    e?.preventDefault(); setBusy(true); setError(null);
    try { const r = await load((term.trim() || query).slice(0, 500)); setItems(r.items || []); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function attach() {
    if (!selected || busy) return;
    setBusy(true); setError(null);
    try {
      await api.attachPersonalAsset(projectId, { assetId: selected.id, expectedVersion: selected.version, confirmed: true, destinations });
      await load(); setSelected(null); onChanged?.();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function detach(id) {
    setBusy(true); setError(null);
    try { await api.detachPersonalAsset(projectId, id); await load(); onChanged?.(); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  const attached = new Set(references.map(item => item.id || item.assetId));
  return <section className="personal-reference" aria-label="个人参考">
    <header><h2>个人参考 · {references.length}</h2><button className="btn btn-sm" onClick={() => onGo("personal-assets")}>管理</button></header>
    <p>选择真实背景或经历，供这篇文章的 AI 参考。不会自动改写正文。</p>
    <ul>{references.map(item => <li key={item.id || item.assetId}><strong>{item.title}</strong><p>{item.body}</p><button className="btn btn-sm" disabled={busy} onClick={() => detach(item.id || item.assetId)}>取消引用</button></li>)}</ul>
    <details><summary>从个人资产中选择</summary>
      <form onSubmit={search}><input aria-label="查找个人参考" placeholder="关键词，或按本文内容查找" value={term} onChange={e => setTerm(e.target.value)} /><button className="btn btn-sm" disabled={busy}>{busy ? "查找中…" : "查找"}</button></form>
      {items?.length === 0 ? <p>没有找到可引用的信息。可以换个关键词，或去个人资产补充。</p> : null}
      <ul>{items?.filter(item => !attached.has(item.id)).map(item => <li key={item.id}><strong>{item.title}</strong><p>{ASSET_KINDS[item.kind]} · {ASSET_USAGE[item.usage]}</p><p>{item.body}</p><button className="btn btn-sm" disabled={busy} onClick={() => setSelected(item)}>选择这条</button></li>)}</ul>
    </details>
    {selected ? <div role="group" aria-label="确认引用个人资产"><p>将「{selected.title}」第 {selected.version} 版用于本篇写作，并允许本篇 AI 读取其内容。信息或服务地址更新后需重新选择。已发送给模型的内容无法撤回。</p><p>本篇允许使用的 AI 服务：</p>{destinations.length ? <ul>{destinations.map(address => <li key={address} style={{ overflowWrap: "anywhere" }}>{address}</li>)}</ul> : <p>尚未配置有效的 AI 服务地址，请先在设置中配置。</p>}<div className="personal-reference__actions"><button className="btn btn-sm" disabled={busy} onClick={() => setSelected(null)}>取消</button><button className="btn btn-sm btn-primary" disabled={busy || !destinations.length} onClick={attach}>确认用于本篇</button></div></div> : null}
    <ErrorNote error={error} what="读取个人参考" onRetry={search} />
  </section>;
}
