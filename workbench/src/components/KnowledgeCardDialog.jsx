import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { useDialog } from "../lib/use-dialog.js";
import { ErrorNote, Note } from "./ui.jsx";
import { IconArchive, IconX } from "./icons.jsx";

const FIELDS = [
  ["conclusion", "一句话结论", true],
  ["explanation", "核心解释"],
  ["evidence", "原文证据"],
  ["boundaries", "适用边界"],
  ["questions", "反例或待验证问题"],
  ["personalUnderstanding", "我的理解"],
];

export function KnowledgeCardDialog({ open, onClose, messages, source }) {
  const [card, setCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const previousSignature = useRef("");
  const signature = useMemo(() => JSON.stringify((messages || []).map((m) => [m.role, m.text])), [messages]);
  const boxRef = useDialog(open, onClose);

  useEffect(() => {
    if (!open || card || busy || error) return;
    setBusy(true);
    setError(null);
    api.previewKnowledgeCard({ source, messages: (messages || []).map((m) => ({ role: m.role === "agent" ? "assistant" : m.role, content: m.text })) })
      .then((result) => { setCard(result.card); previousSignature.current = signature; })
      .catch(setError)
      .finally(() => setBusy(false));
  }, [open, card, busy, error, messages, source, signature]);

  useEffect(() => {
    if (!open && previousSignature.current && previousSignature.current !== signature) {
      setCard(null); setSaved(null); setError(null);
    }
  }, [open, signature]);

  if (!open) return null;
  const patch = (key, value) => setCard((current) => ({
    ...current,
    [key]: value,
    ...(key === "evidence" ? { evidenceStatus: String(value || "").trim() ? "有原文支撑" : "待验证" } : {}),
  }));

  async function save() {
    if (!card?.title?.trim() || saving) return;
    setSaving(true); setError(null);
    try { setSaved((await api.saveKnowledgeCard(card)).card); }
    catch (e) { setError(e); }
    finally { setSaving(false); }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="drawer drawer--wide" ref={boxRef} role="dialog" aria-modal="true" aria-label="知识卡片预览">
        <div className="drawer-head">
          <div><span className="eyebrow">KNOWLEDGE CARD</span><div className="drawer-title">沉淀知识卡片</div></div>
          <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭"><IconX /></button>
        </div>
        {busy ? <Note title="正在生成预览">确认前不会写入知识库。</Note> : null}
        {card ? <>
          <div className="field"><label>标题</label><input data-autofocus="" value={card.title || ""} onChange={(e) => patch("title", e.target.value)} /></div>
          {FIELDS.map(([key, label, short]) => <div className="field" key={key}><label>{label}</label>{short
            ? <input value={card[key] || ""} onChange={(e) => patch(key, e.target.value)} />
            : <textarea value={card[key] || ""} onChange={(e) => patch(key, e.target.value)} />}</div>)}
          <div className="field"><label>标签</label><input value={(card.tags || []).join("、")} onChange={(e) => patch("tags", e.target.value.split(/[、,，]/).map((v) => v.trim()).filter(Boolean))} /></div>
          <Note tone={card.evidenceStatus === "待验证" ? "warning" : "success"} title={`证据状态：${card.evidenceStatus}`}>
            {card.evidenceStatus === "待验证" ? "没有可核对的原文证据，AI 回复没有被当作事实来源。" : "已保留当前文档或选区作为证据来源。"}
          </Note>
        </> : null}
        <ErrorNote error={error} what={saving ? "保存知识卡" : "生成知识卡预览"} />
        {error && !card ? <button className="btn btn-sm" onClick={() => setError(null)}>重新生成预览</button> : null}
        {saved ? <Note tone="success" title="知识卡已保存">{saved.path}</Note> : null}
        <div className="drawer-foot">
          <button className="btn" onClick={onClose}>关闭</button>
          <button className="btn btn-primary" onClick={save} disabled={!card?.title?.trim() || busy || saving || !!saved}><IconArchive />{saving ? "保存中…" : saved ? "已保存" : "确认保存"}</button>
        </div>
      </section>
    </div>
  );
}
