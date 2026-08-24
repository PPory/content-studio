import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";
import { IconCheck, IconLoader2 } from "./icons.jsx";

export function SettingsWritingProfile({ onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ audience: "", platform: "公众号", styleId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setError(null);
    return api.writingProfile()
      .then((next) => {
        setData(next);
        setForm(next.profile);
      })
      .catch(setError);
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => data && ["audience", "platform", "styleId"]
    .some((key) => String(form[key] || "") !== String(data.profile?.[key] || "")), [data, form]);
  const enabledStyles = (data?.styles || []).filter((item) => item.enabled);
  const enabledExperts = (data?.experts || []).filter((item) => item.enabled);

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
        <button className="btn btn-primary" onClick={save} disabled={!dirty || busy}>
          {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}{dirty ? "保存我的创作" : "已经是最新"}
        </button>
      </div>
    </div>
  );
}
