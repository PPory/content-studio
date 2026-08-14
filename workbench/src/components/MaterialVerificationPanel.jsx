import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Note } from "./ui.jsx";

const NEEDS_CHECK = new Set(["金句/原话", "金句·原话", "数据/事实", "数据·事实"]);

/**
 * 只有逐字引用和数据事实需要人工确认；普通观点、框架、故事的关系字段由流水线维护。
 * 核验说明不能为空，避免把“点一下按钮”误当成真的核验。
 */
export function MaterialVerificationPanel({ item, onVerified }) {
  const raw = item?.raw || {};
  const needsCheck = NEEDS_CHECK.has(raw.type);
  const verified = raw.verificationStatus === "已核验";
  const [note, setNote] = useState(raw.verificationNote || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => setNote(raw.verificationNote || ""), [item?.key, raw.verificationNote]);
  if (!needsCheck) return null;

  async function verify() {
    const explanation = note.trim();
    if (!explanation || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateFields("materials", item.key, {
        verificationStatus: "已核验",
        verificationNote: explanation,
      });
      onVerified?.(explanation);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (verified) {
    return (
      <Note tone="success" title="这条证据已核验">
        {raw.verificationNote || "已确认原文、数字与出处一致。"} 来源关系与关联选题由系统维护，不需要你填写。
      </Note>
    );
  }

  return (
    <section className="verification-panel">
      <div>
        <span className="eyebrow">EVIDENCE CHECK</span>
        <h3>只核对这一条证据</h3>
        <p>普通素材不需要你处理；只有金句和数据必须对照原文或官方来源。来源灵感、关联选题由系统自动维护。</p>
      </div>
      <label className="field">
        <span>核验依据</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="例如：已对照原文第 3 段，措辞一致；数字来自官方 2026 年报告第 12 页。"
          rows={3}
        />
      </label>
      <ErrorNote error={error} what="保存核验结果" />
      <button className="btn btn-primary btn-sm" type="button" onClick={verify} disabled={busy || !note.trim()}>
        {busy ? "保存中…" : "确认无误，标记已核验"}
      </button>
    </section>
  );
}
