import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";
import { useDialog } from "../lib/use-dialog.js";
export function QuickNote({ open, onClose, onSaved }) {
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (!text) return; const warn = (e) => { e.preventDefault(); e.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [text]);
  const ref = useDialog(open, onClose);
  async function save() {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    try { await api.quickNote({ text, ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) }); setText(""); setSourceUrl(""); onSaved?.(); onClose(); }
    catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  if (!open) return null;
  return <div className="modal-backdrop"><section ref={ref} className="quick-note" role="dialog" aria-modal="true" aria-label="记一下"><header><h2>记一下</h2><button className="btn btn-sm" onClick={onClose}>收起</button></header><label>想留下什么<textarea autoFocus aria-label="想留下什么" value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="一句话、一段经历，或刚读到的原文。" /></label><label>来源链接（可选）<input aria-label="来源链接（可选）" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} /></label><ErrorNote error={error} what="保存记录" onRetry={save} /><button className="btn btn-primary" disabled={busy || !text.trim()} onClick={save}>{busy ? "正在保存…" : "保存记录"}</button><small>原话保存在资料库。收起后可继续本次未保存的输入。</small></section></div>;
}
