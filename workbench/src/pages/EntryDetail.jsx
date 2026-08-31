// 一个词条。
//
// ⚠️ **这一页要显示的不是「一条笔记的内容」，是「这个说法立在什么上面」。**
// 所以每条事实旁边永远挂着它的来源，点得开；被推翻的旧论断不删也不藏；
// 互相冲突的两条并排放。一个知识库和一堆笔记的差别就在这儿——
// 笔记只告诉你现在写着什么，词条还告诉你**它为什么是这样、以前是什么样**。

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading } from "../components/ui.jsx";
import { IconArrowLeft, IconChevronRight } from "../components/icons.jsx";

const STATUS_ORDER = { disputed: 0, active: 1, superseded: 2 };

export function EntryDetail({ entryId, onBack, onGo, onOpenSource }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api.entry(entryId).then(setData).catch(setError);
  }, [entryId]);

  if (error) return <ErrorNote error={error} what="词条" />;
  if (!data) return <Loading rows={6} />;

  const { entry, facts, neighbors, kindLabels, relationLabels } = data;
  const sorted = [...facts].sort((left, right) => (STATUS_ORDER[left.status] ?? 3) - (STATUS_ORDER[right.status] ?? 3));
  const disputed = sorted.filter((fact) => fact.status === "disputed");
  const active = sorted.filter((fact) => fact.status === "active");
  const superseded = sorted.filter((fact) => fact.status === "superseded");
  const sources = new Set(facts.map((fact) => fact.sourceId));

  const factLine = (fact) => (
    <li key={fact.id} className="fact">
      <p className="fact__text">{fact.statement}</p>
      <button type="button" className="fact__src" onClick={() => onOpenSource?.(fact.sourceId)} title="打开来源">
        {fact.sourceTitle || "未记录来源"}
      </button>
    </li>
  );

  return (
    <div className="view-body entry-page">
      <button type="button" className="btn btn-sm entry-back" onClick={onBack}>
        <IconArrowLeft aria-hidden="true" stroke={1.8} />返回词条
      </button>

      <header className="entry-head">
        <h2>{entry.name}</h2>
        <span className="entry-kind">{kindLabels?.[entry.kind] || entry.kind}</span>
      </header>
      <p className="entry-def">{entry.definition}</p>
      <p className="entry-meta">
        {active.length} 条事实 · {sources.size} 个来源
        {disputed.length ? <> · <b>{disputed.length} 条有冲突</b></> : null}
        {superseded.length ? ` · ${superseded.length} 条已被推翻` : ""}
      </p>

      {/* ⚠️ **冲突排在最前面，而且不折叠。** 它是这个词条上最需要你处理的东西；
          藏进「更多」里等于当它不存在，而那正是知识库慢慢烂掉的方式。 */}
      {disputed.length ? (
        <section className="entry-block">
          <h3 className="entry-block__head entry-block__head--warn">有冲突的说法</h3>
          <p className="entry-block__lead">两条都来自你的资料、互相打架。留着它们，比挑一条留下更诚实——认知变化本身常常就是选题。</p>
          <ul className="facts">{disputed.map(factLine)}</ul>
        </section>
      ) : null}

      <section className="entry-block">
        <h3 className="entry-block__head">事实</h3>
        {active.length ? <ul className="facts">{active.map(factLine)}</ul>
          : <p className="entry-empty">还没有事实。词条只有定义时，写作时引用不了它。</p>}
      </section>

      {superseded.length ? (
        <section className="entry-block">
          <h3 className="entry-block__head entry-block__head--muted">已被推翻</h3>
          <ul className="facts facts--muted">{superseded.map(factLine)}</ul>
        </section>
      ) : null}

      <section className="entry-block">
        <h3 className="entry-block__head">关系</h3>
        {neighbors.outgoing.length || neighbors.incoming.length ? (
          <ul className="rels">
            {neighbors.outgoing.map((item) => (
              <li key={`out-${item.id}-${item.relationType}`}>
                <em>{relationLabels?.[item.relationType] || item.relationType}</em>
                <IconChevronRight aria-hidden="true" stroke={1.8} />
                <button type="button" onClick={() => onGo?.(`entries/${item.id}`)}>{item.name}</button>
              </li>
            ))}
            {/* 反向链接不存表，是索引上的一次查询——所以它和正向永远不会不同步 */}
            {neighbors.incoming.map((item) => (
              <li key={`in-${item.id}-${item.relationType}`} className="rels__in">
                <button type="button" onClick={() => onGo?.(`entries/${item.id}`)}>{item.name}</button>
                <IconChevronRight aria-hidden="true" stroke={1.8} />
                <em>{relationLabels?.[item.relationType] || item.relationType}　本词条</em>
              </li>
            ))}
          </ul>
        ) : <p className="entry-empty">还没有接上任何词条。孤立的词条写作时几乎不会被想起来。</p>}
      </section>
    </div>
  );
}
