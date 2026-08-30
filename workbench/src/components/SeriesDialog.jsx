import { useEffect, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";
import { IconLoader2, IconX } from "./icons.jsx";

export function SeriesDialog({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ title: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const boxRef = useDialog(open, onClose, { autoFocus: true });

  useEffect(() => {
    if (!open) return;
    setForm({ title: "", description: "" });
    setBusy(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function create() {
    if (!form.title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createSeries(form);
      onCreated(result.series);
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim scrim--center" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="modal series-create" role="dialog" aria-modal="true" aria-label="新建合集" ref={boxRef}>
        <header className="series-create__head">
          <div><span className="eyebrow">COLLECTION</span><h2>新建合集</h2></div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="关闭"><IconX aria-hidden="true" /></button>
        </header>
        <p className="series-create__intro">把同一系列的文章收在一起。写教程或知识库时，合集就是那本书的目录——能排序、能分节、能通读，也能整份导出。</p>
        <div className="series-create__fields">
          <label className="field"><span>合集名称</span><input data-autofocus="" value={form.title} onChange={(event) => change("title", event.target.value)} maxLength="120" placeholder="例如：Claude Code 入门教程" /></label>
          {/* 说明这里就可选，进去之后随时能补——建一个文件夹不该先写一段介绍 */}
          <label className="field"><span>合集说明（可选）</span><textarea value={form.description} onChange={(event) => change("description", event.target.value)} maxLength="2000" placeholder="这个合集收录什么内容" /></label>
        </div>
        <ErrorNote error={error} what="创建合集" />
        <footer className="series-create__foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy || !form.title.trim()}>
            {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}建立合集
          </button>
        </footer>
      </section>
    </div>
  );
}
