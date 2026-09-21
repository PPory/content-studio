import { useState } from "react";

/** Same sources, two reading panes; selecting an item never changes business state. */
export function IntelligenceReader({ items, label, title, meta, render, selectedKey, onSelect, itemKey = item => item.id }) {
  const [localKey, setLocalKey] = useState("");
  const key = selectedKey === undefined ? localKey : selectedKey;
  const selected = items.find(item => itemKey(item) === key);
  const active = selected || items[0];
  const choose = value => { if (selectedKey === undefined) setLocalKey(value); onSelect?.(value); };
  if (!active) return null;
  return <div className={`intel-reader ${selected ? "has-selection" : ""}`}>
    <aside className="intel-reader-index" aria-label={label}>
      <div className="intel-reader-index-head"><span>{label}</span><span>{items.length}</span></div>
      {items.map(item => <button type="button" className="intel-reader-item" key={itemKey(item)}
        aria-pressed={itemKey(item) === itemKey(active)} onClick={() => choose(itemKey(item))}>
        <strong>{title(item)}</strong><span>{meta?.(item)}</span>
      </button>)}
    </aside>
    <section className="intel-reader-document" aria-label="阅读内容">
      <button type="button" className="btn intel-reader-back" onClick={() => choose("")}>← 返回列表</button>
      <div key={itemKey(active)}>{render(active)}</div>
    </section>
  </div>;
}
