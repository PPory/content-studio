// 「记下实测」（2026-09-24）：把自己的使用体验存成经历类个人资产，并经确认挂到这篇内容上。
//
// ⚠️ 为什么不写进构思笔记：笔记不算事实依据，起稿时的真实性闸门只认挂在这篇上的「经历」类个人资产，
// 没有它，AI 写不出第一人称的体验（`personalAssetEvidence`）。挂上就等于允许这篇的 AI 读取，
// 所以要像「个人参考」那里一样先说清会发到哪个 AI 服务、发出去不能撤回，再由你确认。
import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";

export function ExperienceNote({ projectId, topic = "", onDone, onCancel }) {
  const [title, setTitle] = useState(() => `实测：${topic}`.slice(0, 60));
  const [body, setBody] = useState("");
  const [destinations, setDestinations] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { api.projectPersonalAssets(projectId).then((r) => setDestinations(r.destinations || [])).catch(() => setDestinations([])); }, [projectId]);

  async function save(useInThisPiece) {
    if (!title.trim() || !body.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const { item } = await api.createPersonalAsset({ kind: "experience", title: title.trim(), body: body.trim(), usage: "reference", confirmed: true });
      if (useInThisPiece) await api.attachPersonalAsset(projectId, { assetId: item.id, expectedVersion: item.version, confirmed: true, destinations });
      onDone?.({ attached: useInThisPiece });
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  const canUse = destinations?.length > 0;
  return <div className="experience-note" role="group" aria-label="记下实测">
    <label>标题<input aria-label="实测标题" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
    <label>你实际做了什么、看到了什么<textarea aria-label="实测内容" rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="例如：用它跑了一周自己的脚本，账单从 X 降到 Y；遇到的坑是……" /></label>
    <p className="experience-note__hint">
      {canUse
        ? <>会存进「个人资产 · 经历故事」，并允许这篇的 AI 读取它（发送到 {destinations.join("、")}）。已发送给模型的内容无法撤回。</>
        : destinations === null ? "正在读取 AI 服务设置…" : "还没配置 AI 服务：先存进个人资产，配置后在「资料 → 个人参考」里选用。"}
    </p>
    <ErrorNote error={error} what="保存实测" />
    <div className="experience-note__acts">
      {canUse ? <button type="button" className="btn btn-sm btn-primary" disabled={busy || !title.trim() || !body.trim()} onClick={() => save(true)}>{busy ? "正在保存…" : "保存并用于这篇"}</button> : null}
      <button type="button" className={`btn btn-sm${canUse ? "" : " btn-primary"}`} disabled={busy || !title.trim() || !body.trim() || destinations === null} onClick={() => save(false)}>只存进个人资产</button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={onCancel}>取消</button>
    </div>
  </div>;
}
