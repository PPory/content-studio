import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";
import { IconArrowBackUp, IconCheck, IconLoader2 } from "./icons.jsx";

export function SettingsWritingProfile({ onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ audience: "", platform: "公众号", styleId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [activeStyleId, setActiveStyleId] = useState("");
  const [stylePrompt, setStylePrompt] = useState("");
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleSaved, setStyleSaved] = useState(false);
  const [samples, setSamples] = useState([]);
  const [selectedSamples, setSelectedSamples] = useState([]);
  const [calibration, setCalibration] = useState(null);

  const load = useCallback(() => {
    setError(null);
    return api.writingProfile()
      .then((next) => {
        setData(next);
        setForm(next.profile);
        const selected = (next.styles || []).find((item) => item.id === (next.profile?.styleId || "")) || (next.styles || [])[0];
        setActiveStyleId(selected?.id || "");
        setStylePrompt(selected?.instructions || "");
      })
      .catch(setError);
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => data && ["audience", "platform", "styleId"]
    .some((key) => String(form[key] || "") !== String(data.profile?.[key] || "")), [data, form]);
  const enabledStyles = (data?.styles || []).filter((item) => item.enabled);
  const enabledExperts = (data?.experts || []).filter((item) => item.enabled);
  const activeStyle = enabledStyles.find((item) => item.id === activeStyleId);

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await api.saveWritingProfile(form);
      setData(next);
      setForm(next.profile);
      setSaved(true);
      onSaved?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  function chooseStyle(id) {
    const next = enabledStyles.find((item) => item.id === id);
    setActiveStyleId(id);
    setStylePrompt(next?.instructions || "");
    setStyleSaved(false);
  }

  async function saveStylePrompt(instructions = stylePrompt) {
    if (!activeStyleId || !String(instructions).trim() || styleBusy) return;
    setStyleBusy(true);
    setError(null);
    try {
      const next = await api.saveWritingStyle({ id: activeStyleId, instructions });
      setData(next);
      const style = (next.styles || []).find((item) => item.id === activeStyleId);
      setStylePrompt(style?.instructions || String(instructions).trim());
      setStyleSaved(true);
      onSaved?.();
    } catch (cause) { setError(cause); }
    finally { setStyleBusy(false); }
  }

  async function loadSamples() {
    setError(null);
    try {
      const response = await api.list("drafts", { pageSize: 60 });
      setSamples((response.items || []).filter((item) => item.id && item.title));
    } catch (cause) { setError(cause); }
  }

  async function calibrate() {
    if (selectedSamples.length < 3 || selectedSamples.length > 5 || styleBusy) return;
    setStyleBusy(true);
    setCalibration({ status: "loading", stageLabel: "读取旧文样本" });
    setError(null);
    try {
      const pages = await Promise.all(selectedSamples.map((id) => api.page(id, "drafts")));
      const bodies = pages.map((page, index) => {
        const item = page.page || page.item || page;
        const text = item.content || item.markdown || item.body || item.note || "";
        const title = item.title || samples.find((sample) => sample.id === selectedSamples[index])?.title || `样本 ${index + 1}`;
        return `# ${title}\n\n${text}`;
      }).filter((text) => text.trim().length > 20);
      if (bodies.length < 3) throw new Error("至少需要 3 篇有正文的旧文");
      let run = (await api.startExpertRun({ kind: "style-calibration", scopeId: "writing-style-calibration", document: { title: "我的写作风格样本", body: bodies.join("\n\n---\n\n"), audience: form.audience, platform: form.platform } })).run;
      setCalibration(run);
      while (["queued", "running"].includes(run.status)) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        run = (await api.expertRun(run.id)).run;
        setCalibration(run);
      }
    } catch (cause) {
      setCalibration({ status: "failed", error: cause.message, hint: cause.hint });
    } finally { setStyleBusy(false); }
  }

  async function adoptCalibration() {
    const instructions = calibration?.report?.instructions;
    if (!instructions || styleBusy) return;
    setStyleBusy(true);
    setError(null);
    try {
      const next = await api.saveWritingStyle({ id: "my-style", instructions });
      setData(next);
      setActiveStyleId("my-style");
      setStylePrompt(instructions);
      setStyleSaved(true);
    } catch (cause) { setError(cause); }
    finally { setStyleBusy(false); }
  }

  if (!data && !error) return <p className="field-hint">读取中…</p>;

  return (
    <div className="writing-profile-settings">
      <ErrorNote error={error} what="读取我的创作" onRetry={load} />

      <label className="profile-field">
        <span>固定目标读者</span>
        <input
          value={form.audience || ""}
          maxLength={80}
          placeholder="例如：想把 AI 真正用进工作流的独立创作者"
          onChange={(event) => { setSaved(false); setForm((old) => ({ ...old, audience: event.target.value })); }}
        />
        <small>以后新建内容会自动带上；老项目和已经写下的正文不会被改动。</small>
      </label>

      <section className="profile-style-editor" aria-label="风格提示词设置">
        <header><div><b>风格提示词</b><small>编辑器只负责调用；提示词统一在这里修改和保存。</small></div></header>
        <label className="profile-field">
          <span>选择要维护的风格</span>
          <select value={activeStyleId} onChange={(event) => chooseStyle(event.target.value)}>
            {enabledStyles.map((style) => <option key={style.id} value={style.id}>{style.name}{style.customized ? " · 已修改" : ""}</option>)}
          </select>
        </label>
        {activeStyle ? <label className="profile-field">
          <span>实际发送给 AI 的提示词</span>
          <textarea rows={8} maxLength={6000} value={stylePrompt} onChange={(event) => { setStylePrompt(event.target.value); setStyleSaved(false); }} />
          <small>{activeStyle.description}</small>
          <div className="profile-inline-actions">
            <button onClick={() => setStylePrompt(activeStyle.defaultInstructions || activeStyle.instructions)} disabled={stylePrompt === (activeStyle.defaultInstructions || activeStyle.instructions)}>恢复内置版本</button>
            <button className="btn btn-primary" onClick={() => saveStylePrompt()} disabled={!stylePrompt.trim() || stylePrompt === activeStyle.instructions || styleBusy}>{styleBusy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}{styleSaved ? "已保存" : "保存提示词"}</button>
          </div>
        </label> : null}
      </section>

      <section className="profile-calibration" aria-label="从旧文校准风格">
        <header><div><b>从 3—5 篇旧文生成 / 校准风格</b><small>风格顾问会从六个维度提炼画像，先预览，确认后才保存。</small></div><button onClick={loadSamples}>{samples.length ? "刷新旧文" : "选择旧文"}</button></header>
        {samples.length ? <div className="profile-samples">{samples.map((sample) => {
          const checked = selectedSamples.includes(sample.id);
          return <label key={sample.id} data-on={checked}><input type="checkbox" checked={checked} disabled={!checked && selectedSamples.length >= 5} onChange={() => setSelectedSamples((old) => checked ? old.filter((id) => id !== sample.id) : [...old, sample.id])} /><span>{sample.title}</span><small>{sample.status || sample.platform || "旧稿"}</small></label>;
        })}</div> : <p>从稿件库选择你真正满意、能代表自己的旧文；不要混入只为临时交付而写的稿子。</p>}
        {samples.length ? <div className="profile-inline-actions"><span>已选 {selectedSamples.length} 篇{selectedSamples.length < 3 ? "，还需至少 3 篇" : selectedSamples.length > 5 ? "，最多 5 篇" : "，可以开始"}</span><button className="btn btn-primary" onClick={calibrate} disabled={selectedSamples.length < 3 || selectedSamples.length > 5 || styleBusy}>生成 / 校准</button></div> : null}
        {calibration ? <div className="profile-calibration__result" data-status={calibration.status}>
          {calibration.status === "done" ? <><b>{calibration.report?.name || "我的风格"}</b><p>{calibration.report?.summary}</p><dl>{Object.entries(calibration.report?.dimensions || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><button className="btn btn-primary" onClick={adoptCalibration} disabled={styleBusy}>确认并保存为“我的风格”</button></> : calibration.status === "failed" ? <><b>{calibration.error}</b><small>{calibration.hint}</small></> : <p><IconLoader2 className="spin" aria-hidden="true" />{calibration.stageLabel || "风格顾问正在分析样本"}</p>}
        </div> : null}
      </section>

      <label className="profile-field">
        <span>常用首发平台</span>
        <select
          value={form.platform || "公众号"}
          onChange={(event) => { setSaved(false); setForm((old) => ({ ...old, platform: event.target.value })); }}
        >
          {(data?.platforms || []).map((platform) => <option key={platform}>{platform}</option>)}
        </select>
        <small>点“新建内容”或“写这个”时直接进入编辑器；发布前仍能增加其他平台版本。</small>
      </label>

      <label className="profile-field">
        <span>默认写作风格</span>
        <select
          value={form.styleId || ""}
          onChange={(event) => { setSaved(false); setForm((old) => ({ ...old, styleId: event.target.value })); }}
        >
          <option value="">保持我原本的语气</option>
          {enabledStyles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
        </select>
        <small>AI 协作会默认遵守这个风格；当前文章仍可保持原本语气，正文也只在你确认后插入。</small>
      </label>

      <section className="profile-experts" aria-label="专家能力出现位置">
        <div><b>专家能力如何出现</b><span>{enabledExperts.length} 项</span></div>
        <p>它们不是一个统一下拉框，而是在对应任务里直接工作：找题时定方向，写作时推动，成稿后再查素材、审稿和核查。</p>
        {enabledExperts.length ? (
          <div className="profile-experts__list">
            {enabledExperts.map((expert) => (
              <article key={expert.id}>
                <strong>{expert.name}<small>{expert.scene}</small></strong>
                <span>{expert.description}</span>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <div className="profile-source">
        <span>工作台内置能力</span>
        <code>{enabledExperts.length} 位专家 · {enabledStyles.length} 种风格</code>
        <small>{data?.hint}</small>
      </div>

      <div className="profile-save">
        {saved ? <span><IconCheck aria-hidden="true" />已保存，下一篇开始生效</span> : <span />}
        {/* ⚠️ **是「撤销改动」不是「恢复默认」**：这几项没有出厂默认值，
            能「恢复」的只有「我改之前是什么样」。见 SettingsOverlay 里同名那颗。 */}
        {dirty ? (
          <button className="btn" onClick={() => { setSaved(false); setForm({ audience: data.audience || "", platform: data.platform || "公众号", styleId: data.styleId || "" }); }} disabled={busy} title="把这一段改的放回保存前的样子">
            <IconArrowBackUp size={14} stroke={1.8} aria-hidden="true" />
            撤销改动
          </button>
        ) : null}
        <button className="btn btn-primary" onClick={save} disabled={!dirty || busy}>
          {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}{dirty ? "保存我的创作" : "已经是最新"}
        </button>
      </div>
    </div>
  );
}
