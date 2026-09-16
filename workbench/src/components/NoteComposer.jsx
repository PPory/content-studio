import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";
import { IconPhoto, IconLink } from "./icons.jsx";
import "../pages/notes.css";

export function NoteComposer({ initial = {}, onSave, onCancel, autoFocus = false, compact = false, onDirty }) {
  const [text, setText] = useState(initial.text || "");
  const [tags, setTags] = useState((initial.tags || []).join(" "));
  const [sourceUrl, setSourceUrl] = useState(initial.sourceUrl || "");
  const [details, setDetails] = useState(Boolean(initial.sourceUrl));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInput = useRef(null);
  const editor = useRef(null);
  const dirty = text !== (initial.text || "") || tags !== (initial.tags || []).join(" ") || sourceUrl !== (initial.sourceUrl || "");
  const dirtyCallback = useRef(onDirty);
  dirtyCallback.current = onDirty;
  useEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);
  useEffect(() => () => dirtyCallback.current?.(false), []);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(event) {
    event?.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true); setError(null);
    try {
      await onSave({ text: text.trim(), tags: [...new Set(tags.split(/[\s,，#]+/u).filter(Boolean))], sourceUrl: sourceUrl.trim() });
      setText(""); setTags(""); setSourceUrl("");
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  async function upload(event) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const result = await api.uploadMedia(file);
      setText(value => `${value}${value ? "\n\n" : ""}![图片](${result.path})`);
      editor.current?.focus();
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  return <form className={`note-composer${compact ? " note-composer--compact" : ""}`} onSubmit={save}>
    <textarea data-autofocus ref={editor} autoFocus={autoFocus} aria-label="想留下什么" placeholder="现在的想法是……" rows={compact ? 6 : 3} value={text} disabled={busy} onChange={event => setText(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") save(event); }} />
    <div className="note-composer__tags"><span aria-hidden="true">#</span><input aria-label="记录标签" placeholder="添加标签，以空格分隔" value={tags} disabled={busy} onChange={event => setTags(event.target.value)} /></div>
    {details && <label className="note-composer__source">来源链接（可选）<input type="url" value={sourceUrl} disabled={busy} onChange={event => setSourceUrl(event.target.value)} /></label>}
    <div className="note-composer__footer"><div className="note-composer__tools"><button type="button" className="note-composer__tool" disabled={busy} onClick={() => fileInput.current?.click()}><IconPhoto size={16} aria-hidden="true" />图片</button><button type="button" className="note-composer__tool" aria-expanded={details} onClick={() => setDetails(value => !value)}><IconLink size={16} aria-hidden="true" />来源</button><input ref={fileInput} type="file" accept="image/*" hidden onChange={upload} /></div><div className="note-composer__tools">{onCancel && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { if (!dirty || window.confirm("放弃尚未保存的修改？")) onCancel(); }}>取消</button>}<button className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>{busy ? "正在保存…" : initial.id ? "保存修改" : "保存记录"}</button></div></div>
    <ErrorNote error={error} what="保存记录" />
  </form>;
}
