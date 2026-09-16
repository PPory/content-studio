import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ASSET_KINDS, ASSET_USAGE } from "../lib/personal-assets.js";
import { useDialog } from "../lib/use-dialog.js";
import { ErrorNote } from "./ui.jsx";
import { IconX } from "./icons.jsx";

export function PersonalAssetIntake({ onClose, onSaved, onDirty }) {
  const [text, setText] = useState("");
  const [destination, setDestination] = useState(null);
  const [service, setService] = useState(null);
  const [consented, setConsented] = useState(false);
  const [preview, setPreview] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const live = useRef(true);
  const state = useRef(null);
  state.current = { busy, dirty: Boolean(text.trim() || preview), onClose };
  const close = useCallback(() => {
    const current = state.current;
    if (!current.busy && (!current.dirty || window.confirm("这次自述尚未保存，确认放弃并关闭？"))) current.onClose();
  }, []);
  const ref = useDialog(true, close);
  const dirty = Boolean(text.trim() || preview);
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const loadDestination = useCallback(async () => {
    setError(null);
    try { const result = await api.personalAssetIntake(); if (live.current) { setDestination(result.destination); setService(result); } }
    catch (cause) { if (live.current) setError(cause); }
  }, []);
  useEffect(() => { live.current = true; loadDestination(); return () => { live.current = false; }; }, [loadDestination]);
  async function generate(event) {
    event.preventDefault(); if (busy || !consented || !text.trim()) return;
    setBusy(true); setError(null);
    try {
      const result = await api.previewPersonalAssets({ text, destination, confirmed: true });
      if (!live.current) return;
      setPreview(result); setRows(result.candidates.map(candidate => ({ ...candidate, selected: true, action: "create", assetId: "" })));
    } catch (cause) { if (live.current) { setError(cause); if (cause.status === 409) { setConsented(false); loadDestination(); } } } finally { if (live.current) setBusy(false); }
  }
  function change(id, key, value) { setRows(previous => previous.map(row => row.id === id ? { ...row, [key]: value } : row)); }
  async function save() {
    setBusy(true); setError(null);
    try {
      const selections = rows.filter(row => row.selected).map(row => ({ candidateId: row.id, action: row.action, kind: row.kind, title: row.title, body: row.body, usage: row.usage, eventDate: row.eventDate || "", ...(row.action === "update" ? { assetId: row.assetId, expectedVersion: row.duplicates.find(item => item.id === row.assetId)?.version } : {}) }));
      const result = await api.confirmPersonalAssets({ previewId: preview.previewId, selections, confirmed: true });
      if (live.current) onSaved(result.items);
    } catch (cause) { if (live.current) setError(cause); } finally { if (live.current) setBusy(false); }
  }
  const selected = rows.filter(row => row.selected);
  const updateIds = selected.filter(row => row.action === "update").map(row => row.assetId);
  const duplicateUpdates = new Set(updateIds).size !== updateIds.length;
  const invalid = duplicateUpdates || selected.some(row => !row.title.trim() || !row.body.trim() || (row.action === "update" && !row.assetId));
  const destinationText = typeof destination === "string" ? destination : destination?.baseUrl || destination?.url || destination?.endpoint || "";
  return <div className="modal-backdrop"><section ref={ref} className="asset-editor asset-intake" role="dialog" aria-modal="true" aria-labelledby="asset-intake-title"><header><div><h2 id="asset-intake-title">从自述整理个人资产</h2><p className="asset-hint">{preview ? "选择要保留的候选，逐条核对后保存。" : "先自由写一段，AI 帮你拆分成可核对的信息。"}</p></div><button className="icon-btn" disabled={busy} aria-label="关闭自述整理" onClick={close}><IconX size={18} /></button></header>
    {!preview ? <form onSubmit={generate}><label>关于我的自述<textarea data-autofocus rows={10} value={text} maxLength={20000} disabled={busy} placeholder="可以从现在的身份、正在做的事、走过的一段经历说起。不确定的部分也可以照实写。" onChange={event => setText(event.target.value)} /></label><div className="asset-intake__consent"><strong>本次发送内容与去向</strong><p>仅将上方这段自述发送给以下 AI 服务；已有个人资产只在本地匹配，不随自述发送。</p>{destinationText ? <code>{destinationText}</code> : <p>尚未取得 AI 服务地址，请检查配置后重试。</p>}{service?.configured === false && <p>AI 服务尚未配置完整，请先到设置中补充。</p>}{service?.model && <p>模型：{service.model} · {service.local ? "本机服务" : "外部服务"}</p>}<label className="asset-intake__check"><input type="checkbox" checked={consented} disabled={busy || !destinationText || service?.configured === false} onChange={event => setConsented(event.target.checked)} /><span>我同意将这段自述发送到上述服务，仅生成待确认候选。</span></label></div><ErrorNote error={error} what="整理自述" onRetry={!destinationText ? loadDestination : undefined} /><footer><span>候选不会自动写入个人资产。</span><button className="btn btn-primary" disabled={busy || !text.trim() || !consented || !destinationText || service?.configured === false}>{busy ? "正在整理…" : "确认发送并整理"}</button></footer></form> : <><details className="asset-intake__original"><summary>查看本次自述原文</summary><p>{text}</p></details><div className="asset-intake__candidates">{rows.map(row => <IntakeCandidate key={row.id} row={row} busy={busy} onChange={(key, value) => change(row.id, key, value)} />)}</div>{!rows.length && <p className="asset-hint">这段自述暂未提取出可核验的信息。可以补充具体事实后再试。</p>}{duplicateUpdates && <p role="alert" className="asset-hint">同一条已有资产只能被一个候选更新，请调整保存方式或取消其中一条。</p>}<ErrorNote error={error} what="保存整理结果" /><footer><button className="btn" disabled={busy} onClick={() => { if (window.confirm("返回后将丢弃本次候选修改，保留原自述。继续？")) { setPreview(null); setRows([]); setConsented(false); } }}>返回修改自述</button><button className="btn btn-primary" disabled={busy || !selected.length || invalid} onClick={save}>{busy ? "正在保存…" : `确认保存 ${selected.length} 条`}</button></footer></>}
  </section></div>;
}

function IntakeCandidate({ row, busy, onChange }) {
  const duplicate = row.duplicates?.find(item => item.id === row.assetId);
  return <article className="asset-intake__candidate" data-selected={row.selected}><label className="asset-intake__check"><input type="checkbox" checked={row.selected} disabled={busy} onChange={event => onChange("selected", event.target.checked)} /><strong>保留这条信息</strong></label><fieldset disabled={busy || !row.selected}><div className="asset-editor__pair"><label>类型<select value={row.kind} onChange={event => onChange("kind", event.target.value)}>{Object.entries(ASSET_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>写作权限<select value={row.usage} onChange={event => onChange("usage", event.target.value)}>{Object.entries(ASSET_USAGE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><label>标题<input value={row.title} maxLength={200} onChange={event => onChange("title", event.target.value)} /></label><label>内容<textarea rows={4} value={row.body} onChange={event => onChange("body", event.target.value)} /></label><p className="asset-hint">内容须保留为自述中的连续原文；可删减为逐字摘录，不补写事实。</p><label>发生或生效日期<input type="date" value={row.eventDate || ""} onChange={event => onChange("eventDate", event.target.value)} /></label>{row.duplicates?.length > 0 && <div className="asset-intake__duplicate"><strong>本地找到可能相关的已有信息</strong><label>保存方式<select value={row.action === "create" ? "create" : row.assetId} onChange={event => { onChange("action", event.target.value === "create" ? "create" : "update"); onChange("assetId", event.target.value === "create" ? "" : event.target.value); }}><option value="create">仍然新增一条</option>{row.duplicates.map(item => <option key={item.id} value={item.id}>更新：{item.title}</option>)}</select></label>{duplicate && <div className="asset-intake__diff"><div><small>原内容 · 第 {duplicate.version} 版</small><p>{duplicate.body || "原内容未返回，请先在个人资产中核对。"}</p></div><div><small>确认后替换为</small><p>{row.body}</p></div><p className="asset-hint">替换会保留历史版本；已有文章需重新确认才能使用新版。</p></div>}</div>}</fieldset></article>;
}
