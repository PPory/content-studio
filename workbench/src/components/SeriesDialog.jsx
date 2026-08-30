import { useEffect, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";
import { IconLoader2, IconX } from "./icons.jsx";

export function SeriesDialog({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ title: "", audience: "", outcome: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const boxRef = useDialog(open, onClose, { autoFocus: true });

  useEffect(() => {
    if (!open) return;
    setForm({ title: "", audience: "", outcome: "", description: "" });
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
      <section className="modal series-create" role="dialog" aria-modal="true" aria-label="新建系列教程" ref={boxRef}>
        <header className="series-create__head">
          <div><span className="eyebrow">SERIES</span><h2>新建系列教程</h2></div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="关闭"><IconX aria-hidden="true" /></button>
        </header>
        <p className="series-create__intro">先定下读者最终能学会什么，再拆章节。章节可以只列计划，准备写时才会进入文章列表。</p>
        <div className="series-create__fields">
          <label className="field"><span>系列名称</span><input data-autofocus="" value={form.title} onChange={(event) => change("title", event.target.value)} maxLength="120" placeholder="例如：从零搭建个人知识库" /></label>
          <label className="field"><span>写给谁（可选）</span><input value={form.audience} onChange={(event) => change("audience", event.target.value)} maxLength="200" placeholder="读者现在处于什么阶段" /></label>
          <label className="field"><span>完成后能做到什么（可选）</span><textarea value={form.outcome} onChange={(event) => change("outcome", event.target.value)} maxLength="500" placeholder="用一个可验证的结果描述" /></label>
          <label className="field"><span>系列说明（可选）</span><textarea value={form.description} onChange={(event) => change("description", event.target.value)} maxLength="2000" placeholder="范围、边界或为什么要写这套教程" /></label>
        </div>
        <ErrorNote error={error} what="创建系列" />
        <footer className="series-create__foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy || !form.title.trim()}>
            {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}建立系列
          </button>
        </footer>
      </section>
    </div>
  );
}
