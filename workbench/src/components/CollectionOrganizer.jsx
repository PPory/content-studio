import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { useDialog } from "../lib/use-dialog.js";
import { ErrorNote, Note } from "./ui.jsx";
import { IconSparkles, IconX } from "./icons.jsx";

const ACTIONS = [
  ["keep", "保留收藏"], ["archive", "归档"], ["idea", "转为灵感"], ["material", "提取素材"],
];
const MATERIAL_TYPES = ["核心观点", "金句/原话", "数据/事实", "案例/故事", "框架/模型", "反直觉点", "个人经历", "延展问题"];
const MAX_MATERIAL_DRAFTS = 6;

function materialDraftsOf(item) {
  if (Array.isArray(item.materialDrafts) && item.materialDrafts.length) return item.materialDrafts;
  if (item.materialDraft) return [{ key: "material-1", ...item.materialDraft }];
  return [{ key: "material-1", title: item.title || "", type: "核心观点", content: "", sourceUrl: "", tags: [] }];
}

export function CollectionOrganizer({ open, items = [], onClose, onDone }) {
  const pending = useMemo(() => (items.length === 1 ? items : items.filter((item) => item.raw?.reviewStatus === "pending")).slice(0, 20), [items]);
  const [selected, setSelected] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const boxRef = useDialog(open, onClose);

  useEffect(() => {
    if (!open) return;
    setSelected(pending.map((item) => item.key));
    setSuggestions([]); setError(null); setResults(null);
  }, [open, pending]);

  if (!open) return null;
  const update = (id, fields) => setSuggestions((all) => all.map((item) => item.id === id ? { ...item, ...fields } : item));
  const changeAction = (item, action) => update(item.id, {
    action,
    ...(action === "material" ? { materialDrafts: materialDraftsOf(item) } : {}),
  });
  const updateMaterial = (item, index, fields) => update(item.id, {
    materialDrafts: materialDraftsOf(item).map((draft, i) => i === index ? { ...draft, ...fields } : draft),
  });
  const addMaterial = (item) => {
    const drafts = materialDraftsOf(item);
    if (drafts.length >= MAX_MATERIAL_DRAFTS) return;
    const number = drafts.length + 1;
    update(item.id, { materialDrafts: [...drafts, { key: `material-${number}`, title: "", type: "核心观点", content: "", sourceUrl: "", tags: [] }] });
  };
  const removeMaterial = (item, index) => update(item.id, {
    materialDrafts: materialDraftsOf(item).filter((_, i) => i !== index),
  });

  async function preview() {
    if (!selected.length || busy) return;
    setBusy(true); setError(null);
    try { setSuggestions((await api.previewCollectionOrganize(selected)).suggestions || []); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!suggestions.length || busy) return;
    setBusy(true); setError(null);
    try {
      const out = await api.applyCollectionOrganize(suggestions.filter((item) => selected.includes(item.id)));
      setResults(out.results || []);
      onDone?.(out);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="drawer drawer--wide" ref={boxRef} role="dialog" aria-modal="true" aria-label="整理 Inbox">
        <div className="drawer-head"><div><span className="eyebrow">INBOX</span><div className="drawer-title">整理 Inbox</div></div><button className="icon-btn" onClick={onClose} aria-label="关闭"><IconX /></button></div>
        {!suggestions.length ? <>
          <p className="field-hint">默认选中本页待整理内容，最多 20 条。AI 只生成建议，不会立即写入。</p>
          <div className="organize-picks">
            {pending.map((item) => <label className="check-row" key={item.key}><input type="checkbox" checked={selected.includes(item.key)} onChange={(e) => setSelected((all) => e.target.checked ? [...all, item.key] : all.filter((id) => id !== item.key))} /><span><b>{item.title}</b><small>{item.preview || item.sub}</small></span></label>)}
          </div>
          {!pending.length ? <Note title="本页没有待整理内容">切换到“待整理”或先收藏一些内容。</Note> : null}
        </> : <div className="organize-preview">
          {suggestions.map((item) => <article className="organize-item" key={item.id}>
            <div className="field"><label>动作</label><select value={item.action} onChange={(e) => changeAction(item, e.target.value)}>{ACTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
            <div className="field"><label>标题</label><input value={item.title || ""} onChange={(e) => update(item.id, { title: e.target.value })} /></div>
            <div className="field"><label>标签</label><input value={(item.tags || []).join("、")} onChange={(e) => update(item.id, { tags: e.target.value.split(/[、,，]/).map((v) => v.trim()).filter(Boolean).slice(0, 6) })} /></div>
            <p className="field-hint">{item.reason}</p>
            {item.action === "material" ? <>
              <div className="row-actions">
                <b>素材草稿（{materialDraftsOf(item).length} 张）</b>
                <button className="btn btn-sm" type="button" disabled={materialDraftsOf(item).length >= MAX_MATERIAL_DRAFTS} onClick={() => addMaterial(item)}>＋ 添加一张</button>
              </div>
              <p className="field-hint">长内容会按独立价值点拆成多张，最多 6 张；确认前可以增删和修改。</p>
              {materialDraftsOf(item).map((draft, index) => <section className="organize-item" key={draft.key || index}>
                <div className="row-actions"><b>素材 {index + 1}</b>{materialDraftsOf(item).length > 1 ? <button className="btn btn-sm btn-quiet" type="button" onClick={() => removeMaterial(item, index)}>移除</button> : null}</div>
                <div className="field"><label>素材标题</label><input value={draft.title || ""} onChange={(e) => updateMaterial(item, index, { title: e.target.value })} /></div>
                <div className="field"><label>素材类型</label><select value={draft.type || "核心观点"} onChange={(e) => updateMaterial(item, index, { type: e.target.value })}>{MATERIAL_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></div>
                <div className="field"><label>素材正文</label><textarea value={draft.content || ""} onChange={(e) => updateMaterial(item, index, { content: e.target.value })} /></div>
                <div className="field"><label>素材标签</label><input value={(draft.tags || []).join("、")} onChange={(e) => updateMaterial(item, index, { tags: e.target.value.split(/[、,，]/).map((v) => v.trim()).filter(Boolean).slice(0, 6) })} /></div>
              </section>)}
            </> : null}
          </article>)}
        </div>}
        <ErrorNote error={error} what="整理 Inbox" />
        {results ? <Note tone={results.every((r) => r.ok) ? "success" : "warning"} title={`已执行 ${results.filter((r) => r.ok).length} 条，失败 ${results.filter((r) => !r.ok).length} 条`}>
          {results.filter((r) => !r.ok).map((r) => `${r.id}：${r.error}`).join("；") || "所有选中动作均已完成。"}
        </Note> : null}
        <div className="drawer-foot"><button className="btn" onClick={onClose}>{results ? "完成" : "取消"}</button>{!results ? <button className="btn btn-primary" disabled={busy || (!suggestions.length && !selected.length)} onClick={suggestions.length ? apply : preview}><IconSparkles />{busy ? "处理中…" : suggestions.length ? "确认执行" : "生成整理建议"}</button> : null}</div>
      </section>
    </div>
  );
}

export function CollectionActions({ item, updatedAt, onChanged, onExtract }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const apply = async (action) => {
    setBusy(action); setError(null);
    try {
      const result = await api.applyCollectionOrganize([{ id: item.key, action, title: item.title, updatedAt: updatedAt || item.raw.editedAt }]);
      const one = result.results?.[0];
      if (!one?.ok) throw new Error(one?.error || "操作失败");
      onChanged?.(result);
    } catch (e) { setError(e); }
    finally { setBusy(""); }
  };
  const retry = async () => { setBusy("retry"); setError(null); try { await api.retryCollectionSnapshot(item.key); onChanged?.(); } catch (e) { setError(e); } finally { setBusy(""); } };
  return <section className="detail-extra"><div className="row-actions">
    {item.raw.reviewStatus === "pending" ? <button className="btn btn-sm" disabled={!!busy} onClick={() => apply("keep")}>保留收藏</button> : null}
    <button className="btn btn-sm" disabled={!!busy || item.raw.processingMode === "triage"} onClick={() => apply("idea")}>转为灵感</button>
    <button className="btn btn-sm" disabled={!!busy} onClick={() => onExtract?.(item)}>提取素材</button>
    {item.raw.reviewStatus !== "archived" ? <button className="btn btn-sm" disabled={!!busy} onClick={() => apply("archive")}>归档</button> : null}
    {item.raw.snapshotStatus === "failed" ? <button className="btn btn-sm" disabled={!!busy} onClick={retry}>重试抓取</button> : null}
  </div><ErrorNote error={error} what="处理收藏" /></section>;
}
