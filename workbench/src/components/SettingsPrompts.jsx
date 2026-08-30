import { IconHistory, IconShieldCheck } from "./icons.jsx";

const dig = (obj, key) => key.split(".").reduce((value, part) => (value == null ? value : value[part]), obj);

export function LocalPrompts({ data, draft, onChange, guard }) {
  if (!data) return <div className="field-hint">读取中…</div>;
  const valueOf = (key) => draft[key] ?? dig(data.values, key) ?? "";
  return (
    <>
      {data.fields.map((field) => (
        <div className="set-field" key={field.key}>
          <label className="set-field__label" htmlFor={`p-${field.key}`}>
            {field.label}
            <button
              type="button"
              className="set-field__reset"
              onClick={() => onChange(field.key, dig(data.defaults, field.key) || "")}
              title="换回工作台默认写法；仍需点击保存"
            >
              <IconHistory size={13} stroke={1.7} aria-hidden="true" />
              恢复默认
            </button>
          </label>
          <textarea
            id={`p-${field.key}`}
            className="set-field__input set-field__area"
            rows={field.rows || 6}
            spellCheck={false}
            value={valueOf(field.key)}
            onChange={(event) => onChange(field.key, event.target.value)}
          />
          {field.hint ? <div className="field-hint">{field.hint}</div> : null}
          {field.why ? (
            <details className="set-why">
              <summary>为什么</summary>
              <p>{field.why}</p>
            </details>
          ) : null}
          {field.guard ? (
            <div className="set-guard">
              <IconShieldCheck size={15} stroke={1.7} aria-hidden="true" />
              <div>
                <b>安全约束会自动附加，不能在这里修改：</b>
                <p>{guard || field.guard}</p>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}
