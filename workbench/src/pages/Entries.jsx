// 词条：知识库里被提炼出来的那一层。
//
// ⚠️ **词条不是「又一个笔记列表」。** 它和素材、收藏的区别在于**它会被改写**：
// 新资料进来时事实追加到已有词条上、旧论断被推翻、冲突并排记下来。
// 素材是存进去就不动的碎片，词条是一直在长的东西。列表上那几个数字
//（几条事实 / 几个来源 / 几处冲突）就是在显示「它长到哪一步了」。

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Note } from "../components/ui.jsx";
import { IngestReview } from "../components/IngestReview.jsx";

export function Entries({ onGo }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");

  const load = () => api.entries().then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matched = (data?.entries || []).filter((entry) => (
      !term || `${entry.name} ${entry.definition}`.toLowerCase().includes(term)
    ));
    const byKind = new Map();
    for (const entry of matched) {
      const key = entry.kind || "concept";
      if (!byKind.has(key)) byKind.set(key, []);
      byKind.get(key).push(entry);
    }
    return [...byKind].map(([kind, items]) => ({ kind, label: data?.kindLabels?.[kind] || kind, items }));
  }, [data, query]);

  if (error) return <ErrorNote error={error} what="词条" />;

  const health = data?.health;
  const empty = data && !data.entries.length;

  return (
    <div className="view-body">
      {/* ⚠️ 排在最上面：这一页上唯一**等着你动手**的东西。
          接受之后重新拉词条列表，数字立刻对上——不让用户怀疑「点了到底有没有生效」。 */}
      <IngestReview onDone={load} />
      {/**
        * ⚠️ **空态不写「暂无数据」。** 词条现在是空的，是因为提炼那一步还没跑，
        * 不是因为你没存东西——资料已经在库里了。空态要说清楚这一点，
        * 否则用户会以为自己漏了什么操作。
        */}
      {empty ? (
        <Note title="还没有词条">
          <div style={{ marginTop: 6 }}>
            资料已经在库里了，但还没有被提炼成词条——入库那一步（读资料、提词条、补关系、标矛盾）还没有接上。
          </div>
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-sm" onClick={() => onGo?.("sources")}>先看看有哪些资料</button>
          </div>
        </Note>
      ) : null}

      {health && health.total ? (
        <div className="field" style={{ marginBottom: 12 }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`在 ${health.total} 个词条里找`}
          />
          {/**
            * 孤儿是**查询出来的**（不是巡检），所以这里一直是真值。
            *
            * ⚠️ **已判定的冲突和待判定的候选分开说。** 候选（同词条、不同来源的两条事实）
            * 绝大多数是互补说法而不是矛盾——把它当成「N 处矛盾」报出来，点开全是噪音，
            * 第二次用户就不再点了。所以候选只说「组同题事实待判定」，
            * 而「冲突」这个词只留给真的判过的。
            */}
          <div className="field-hint">
            {health.orphans ? `${health.orphans} 个词条还没有任何关系` : "没有孤立词条"}
            {health.disputed ? ` · ${health.disputed} 条已判定冲突` : ""}
            {health.pendingPairs ? ` · ${health.pendingPairs} 组同题事实待判定` : ""}
          </div>
        </div>
      ) : null}

      {groups.map((group) => (
        <section key={group.kind} style={{ marginBottom: 18 }}>
          <div className="drawer-title" style={{ marginBottom: 8 }}>{group.label}　<span className="tag">{group.items.length}</span></div>
          <div className="opt-list">
            {group.items.map((entry) => (
              <button key={entry.id} type="button" className="opt" onClick={() => onGo?.(`entries/${entry.id}`)}>
                <b>{entry.name}</b>
                <span>{entry.definition}</span>
                <span>
                  {entry.activeFacts} 条事实 · {entry.sourceCount} 个来源 · {entry.relationCount} 条关系
                  {entry.disputedFacts ? ` · ${entry.disputedFacts} 处冲突` : ""}
                  {entry.supersededFacts ? ` · ${entry.supersededFacts} 条已被推翻` : ""}
                  {entry.orphanSince ? " · 还没接上任何词条" : ""}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
