// 写作列表的「选题」一档（2026-09-24）：按来源分三列——来自情报 / 来自我的知识 / 我的想法。
//
// 一张卡只回答挑题时要看的三件事：从哪来、建议什么时候之前写、走到哪一步了（还没选角度 / 角度 · 还缺 N 项 / 初稿已写）。
// 「来自我的知识」一列下面还有 AI 最近一次扫描找到、还没加入的「知识 × 读者问题」，一键加入就建成这篇内容；
// 列头「重新扫描」「自己搭一个」。原来单独的「从我的知识里找」页面不再作为入口（选题方法见 docs/工作流.md）。
import { RowDelete, relTime } from "../../components/ui.jsx";

const WINDOW = { "24h": "建议 24 小时内写", week: "建议本周内写" };
const COLUMNS = [
  ["intel", "来自情报", "外面发生了什么"],
  ["bridge", "来自我的知识", "我搞懂了什么 × 读者在问什么"],
  ["own", "我的想法", "随手记下的"],
];
const columnOf = (item) => item.origin?.kind === "intel" ? "intel" : item.origin?.kind === "bridge" ? "bridge" : "own";

function TopicCard({ item, onOpen, onPark, onRemove }) {
  const o = item.origin || {};
  return <article className="topic-card" data-topic={item.id}>
    <button className="topic-card__open" onClick={() => onOpen(item)} aria-label={`打开选题「${item.title}」`}>
      <span className="topic-card__meta">
        {o.window ? <span className={o.window === "24h" ? "is-urgent" : ""}>{WINDOW[o.window]}</span> : null}
        {o.kind === "legacy" ? <span>以前的选题</span> : null}
        <time>{relTime(item.updatedAt)}</time>
      </span>
      <h3>{item.title}</h3>
      {o.title && o.title !== item.title ? <span className="topic-card__from">{o.title}</span> : null}
      <span className={`topic-card__stage is-${item.stage?.key || "new"}`}>{item.stage?.label || "打开后接着整理"}</span>
    </button>
    <footer className="topic-card__acts">
      {onPark && item.kind === "project" ? <button className="text-action" onClick={() => onPark(item)}>先放着</button> : <span />}
      <RowDelete onDelete={() => onRemove(item)} label={item.kind === "project" ? "删掉" : "移入回收站"} title={`移入回收站：${item.title}（可以撤销）`} />
    </footer>
  </article>;
}

export function TopicShelf({ items, found = [], scanning = false, onOpen, onPark, onRemove, onAddFound, onScan, onBuild }) {
  return <div className="topic-shelf" aria-label="选题">
    {COLUMNS.map(([key, name, hint]) => {
      const list = items.filter((item) => columnOf(item) === key);
      return <section key={key} className="topic-col" aria-label={name}>
        <header className="topic-col__head">
          <h2>{name}</h2><small>{hint}</small>
          {key === "bridge" ? <span className="topic-col__acts"><button className="text-action" disabled={scanning} onClick={onScan}>{scanning ? "正在扫描…" : "重新扫描"}</button><button className="text-action" onClick={onBuild}>自己搭一个</button></span> : null}
        </header>
        {list.map((item) => <TopicCard key={item.key} item={item} onOpen={onOpen} onPark={onPark} onRemove={onRemove} />)}
        {key === "bridge" && found.length ? <div className="topic-found">
          <h3>AI 从你的知识里找到的</h3>
          {found.map((c) => <article key={c.directionId} className="topic-found__item">
            <p className="topic-found__q">{c.problem?.statement || c.coreClaim}</p>
            {c.knowledgeAnchors?.length ? <p className="topic-found__k">知识：{c.knowledgeAnchors.map((a) => a.title).filter(Boolean).join("、")}</p> : null}
            <button className="text-action" onClick={() => onAddFound(c)}>加入选题</button>
          </article>)}
        </div> : null}
        {!list.length && !(key === "bridge" && found.length) ? <p className="topic-col__empty">{key === "intel" ? "在情报里点「加入选题」，会出现在这里。" : key === "bridge" ? "点「重新扫描」，从你的 Wiki 和读者问题里找题。" : "新建一篇、或在「记一下」里记下的想法。"}</p> : null}
      </section>;
    })}
  </div>;
}
