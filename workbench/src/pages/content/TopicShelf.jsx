// 写作列表的「选题」一档（2026-09-24，选题和写作合并）。
//
// 选题是「要动手的少数」，所以是卡片（判据见 `docs/design-system.md`）。一张卡只回答挑题时要看的三件事：
// 从哪来、建议什么时候之前写、还缺什么。「先放着」是正常操作，可以撤销，不算失败。
//
// 两种条目：已经有对应内容的（项目），和还没打开过的旧选题（研究记录 / 历史选题）。
// 后者第一次打开时才补建对应内容（`open-content.js`），不在列表里悄悄批量迁移。
import { RowDelete, relTime } from "../../components/ui.jsx";

const ORIGIN = { intel: "来自情报", bridge: "来自我的知识", seed: "记下的想法", own: "自己的想法", legacy: "以前的选题" };
const WINDOW = { "24h": "建议 24 小时内写", week: "建议本周内写" };

function missingLine(missing = []) {
  if (!missing.length) return <p className="topic-card__ready">手上的材料齐了，可以开写</p>;
  const head = missing.slice(0, 3).join("、");
  return <p className="topic-card__missing"><span>还缺</span>{head}{missing.length > 3 ? ` 等 ${missing.length} 项` : ""}</p>;
}

export function TopicShelf({ items, onOpen, onPark, onRemove }) {
  return <div className="content-card-grid topic-shelf" aria-label="选题">
    {items.map((item) => {
      const origin = item.origin || {};
      return <article className="content-card topic-card" key={item.key} data-topic={item.id}>
        <button className="content-card__open" onClick={() => onOpen(item)} aria-label={`打开选题「${item.title}」`}>
          <span className="content-card__meta">
            <span className="topic-card__origin">{ORIGIN[origin.kind] || ORIGIN.own}{origin.title ? `：${origin.title}` : ""}</span>
            <time>{relTime(item.updatedAt)}</time>
          </span>
          <h2 title={item.title}>{item.title}</h2>
          {origin.window ? <span className={`topic-card__window${origin.window === "24h" ? " is-urgent" : ""}`}>{WINDOW[origin.window]}</span> : null}
          {item.missing ? missingLine(item.missing) : <p className="topic-card__ready">打开后接着整理</p>}
        </button>
        <footer className="content-card__actions">
          {onPark && item.kind === "project" ? <button className="btn btn-sm" onClick={() => onPark(item)}>先放着</button> : null}
          <span className="content-card__remove"><RowDelete onDelete={() => onRemove(item)} label={item.kind === "project" ? "删掉" : "移入回收站"} title={`移入回收站：${item.title}（可以撤销）`} /></span>
        </footer>
      </article>;
    })}
  </div>;
}
