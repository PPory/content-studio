const steps = [
  { key: "待处理", number: "01", label: "待处理来源", hint: "需要判断是否值得留下" },
  { key: "已收纳", number: "02", label: "已收纳", hint: "来源已保存，等待后续使用" },
  { key: "可用素材", number: "03", label: "可用素材", hint: "可以带进下一篇内容" },
  { key: "已使用", number: "04", label: "已进入项目", hint: "已经形成选题或稿件关系" },
];

export function MaterialFlow({ counts = {}, active = "", onPick }) {
  return (
    <section className="material-flow" aria-label="来源到内容项目的素材链路">
      <div className="material-flow__intro">
        <span className="eyebrow">SOURCE CHAIN</span>
        <h2>一条素材，只沿一条链往前走</h2>
        <p>来源先收住，判断后拆成可复用素材；进入项目后，去向会一直留在这里。</p>
      </div>
      <ol className="material-flow__steps">
        {steps.map((step) => (
          <li key={step.key}>
            <button type="button" aria-pressed={active === step.key} onClick={() => onPick(active === step.key ? "" : step.key)}>
              <span className="material-flow__number">{step.number}</span>
              <strong>{step.label}</strong>
              <b>{Number(counts[step.key] || 0)}</b>
              <small>{step.hint}</small>
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="material-flow__check"
        aria-pressed={active === "需核验"}
        onClick={() => onPick(active === "需核验" ? "" : "需核验")}
      >
        <span>证据闸门</span>
        <strong>{Number(counts.需核验 || 0)} 条待核验</strong>
        <small>金句与数据核对来源后才能进入成稿</small>
      </button>
    </section>
  );
}
