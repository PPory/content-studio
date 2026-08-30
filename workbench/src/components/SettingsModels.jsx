/**
 * 设置面板里的「各环节模型」。
 *
 * **和「工作台提示词」不是一类，所以自己带保存按钮**：这一段写的是 Worker 的 D1，
 * 而底部那条动作条写的是本机 `.env`。跟着它一起存的话，「写入 workbench/.env」
 * 这句话就成了假的——面板管的东西不都住在同一个地方，那就分开说清楚。
 *
 * 和「流水线提示词」也不一样：那边改完要 `wrangler deploy`，**这边改完立刻生效**
 * （Worker 每次调用现读一次库）。这条差别必须写在界面上，否则用户会按提示词那段的经验
 * 去部署一次——白跑一趟还以为是自己没弄对。
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Note, Select } from "./ui.jsx";
import { IconArrowBackUp, IconCheck, IconLoader2, IconRefresh, IconSparkles } from "./icons.jsx";

// 「跟随默认」在下拉里是一个真选项：它和「选了某个模型」是两回事，
// 而空字符串在下拉里显示成空白行，看着像坏了
const FOLLOW = "跟随默认";

export function ModelSettings() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(0);

  const load = useCallback(() => {
    api.models()
      .then((d) => { setData(d); setDraft({}); setError(null); })
      .catch(setError);
  }, []);
  useEffect(load, [load]);

  if (error && !data) return <ErrorNote error={error} what="模型设置" />;
  if (!data) return <div className="field-hint">读取中…</div>;

  const valueOf = (key) => draft[key] ?? data.values?.[key] ?? "";
  const dirty = Object.keys(draft).filter((k) => (draft[k] || "") !== (data.values?.[k] || ""));
  // 代理给不出清单时退回自由输入——**不挡着用**，只是少了防打错那层
  const options = data.available?.length ? [FOLLOW, ...data.available] : null;

  async function save() {
    if (!dirty.length || saving) return;
    setSaving(true); setError(null);
    try {
      const values = {};
      for (const key of dirty) values[key] = draft[key] || "";
      const result = await api.saveModels(values);
      setData((d) => ({ ...d, values: result.values || {} }));
      setDraft({});
      setSaved(Date.now());
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="set-models">
      {/* 中性提示：`default` 不带图标。这里说的是「默认值是什么」，不是「当心」——
          用 warn 的话那枚感叹号会把一句陈述读成一条警告 */}
      <Note tone="default">
        默认模型是 <b>{data.fallback || "（Worker 里没配 LLM_MODEL）"}</b>，
        没单独指定的环节都用它。<b>改完立刻生效</b>，不用部署——Worker 每次调用现读一次。
      </Note>

      {data.available?.length ? null : (
        <p className="field-hint">
          没能从 LLM 代理取到可用模型清单（<code>GET {"{LLM_BASE_URL}"}/models</code>），下面改成手填。
          <b>模型名打错不会在这儿报错</b>，会等到下一次跑那个环节时才失败，填完自己核一遍。
        </p>
      )}

      {data.tasks.map((task) => (
        <div className="set-field set-models__row" key={task.key}>
          <div className="set-models__copy">
            <span className="set-field__label">{task.label}</span>
            <small className="field-hint">{task.hint}</small>
          </div>
          {options ? (
            <Select
              value={valueOf(task.key) || FOLLOW}
              options={options}
              onChange={(v) => setDraft((d) => ({ ...d, [task.key]: v === FOLLOW ? "" : v }))}
              ariaLabel={`${task.label}用哪个模型`}
              title={`${task.label}用哪个模型`}
              renderIcon={(item) => (item === FOLLOW ? <IconRefresh size={15} stroke={1.8} aria-hidden="true" /> : <IconSparkles size={15} stroke={1.8} aria-hidden="true" />)}
            />
          ) : (
            <input
              value={valueOf(task.key)}
              onChange={(e) => setDraft((d) => ({ ...d, [task.key]: e.target.value }))}
              placeholder={data.fallback || "模型名"}
              aria-label={`${task.label}用哪个模型`}
            />
          )}
        </div>
      ))}

      <ErrorNote error={error} what="模型设置" />

      <div className="set-models__foot">
        {saved && !dirty.length ? <span className="field-hint"><IconCheck size={14} stroke={2} aria-hidden="true" />已保存，下一次调用就按新的走</span> : null}
        {/* ⚠️ **是「撤销改动」不是「恢复默认」**：这几项没有出厂默认值，
            能「恢复」的只有「我改之前是什么样」。见 SettingsOverlay 里同名那颗。 */}
        {dirty.length ? (
          <button className="btn btn-sm" onClick={() => setDraft({})} disabled={saving} title="把这一段改的放回保存前的样子">
            <IconArrowBackUp size={14} stroke={1.8} aria-hidden="true" />
            撤销改动
          </button>
        ) : null}
        <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty.length || saving}>
          {saving ? <IconLoader2 className="spin" aria-hidden="true" /> : null}
          {dirty.length ? `保存这 ${dirty.length} 项` : "没有改动"}
        </button>
      </div>
    </div>
  );
}
