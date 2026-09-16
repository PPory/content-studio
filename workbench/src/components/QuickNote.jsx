import { useState } from "react";
import { api } from "../lib/api.js";
import { useDialog } from "../lib/use-dialog.js";
import { NoteComposer } from "./NoteComposer.jsx";

export function QuickNote({ open, onClose, onSaved, onBrowse }) {
  const [revision, setRevision] = useState(0);
  const ref = useDialog(open, onClose);
  async function save(body) {
    await api.quickNote(body);
    setRevision(value => value + 1);
    onSaved?.(); onClose();
  }
  // Keep the composer mounted while tucked away so an unfinished note survives.
  return <div className="modal-backdrop" hidden={!open} style={!open ? { display: "none" } : undefined}><section ref={ref} className="quick-note" role="dialog" aria-modal="true" aria-label="记一下"><header><h2>记一下</h2><button className="btn btn-sm" onClick={onClose}>收起</button></header><NoteComposer key={revision} compact onSave={save} /><footer className="quick-note__footer"><small>收起后保留本次输入。Ctrl / ⌘ + Enter 保存。</small>{onBrowse && <button className="btn btn-sm" onClick={onBrowse}>全部记录</button>}</footer></section></div>;
}
