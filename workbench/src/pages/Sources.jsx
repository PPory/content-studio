// 资料：知识库里「我已经有什么」的那一半。
//
// ⚠️ **这一页不再复用书架的封面墙。** 封面墙对**书**是对的——你靠封面认书；
// 但课程章节和飞书导出的文档根本没有封面，那面墙上摆的是一排灰底占位框和
// 「加封面」按钮，屏幕上最显眼的东西全是噪音。
//
// 换成表格之后，每一列都在回答一个问题：这是什么、有多少、**读过没有**、
// **有没有被用上**。最后那一列（贡献了几条事实）是知识库特有的：
// 它区分「读过并且沉淀下来了」和「导进来放着」，而这两者在任何文件列表里
// 都长得一模一样。

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Empty, Loading, SearchBox } from "../components/ui.jsx";
import { IconChevronRight, IconSearch } from "../components/icons.jsx";

const KIND_ORDER = ["书籍", "课程", "文档", "文章"];
const KIND_HINT = {
  书籍: "别人写的书",
  课程: "成体系的课，按节读",
  文档: "单篇资料",
  文章: "自己写的",
};

const number = (value) => Number(value || 0).toLocaleString();

/**
 * 提炼进度。**三种状态要分得开**：一份都没读过、读了一部分、全读完了。
 * 只显示百分比的话「0%」和「还没开始」看起来一样，而它们要做的事不同。
 */
function distillState(source) {
  if (!source.documents) return { tone: "idle", label: "空" };
  if (source.failed) return { tone: "warn", label: `${source.failed} 节失败` };
  if (!source.distilled) return { tone: "idle", label: "未提炼" };
  if (source.distilled < source.documents) return { tone: "busy", label: `${source.distilled}/${source.documents} 节` };
  return { tone: "done", label: "已提炼" };
}

export function Sources({ onOpen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const [docs, setDocs] = useState(() => ({}));

  useEffect(() => {
    api.knowledgeSources().then(setData).catch(setError);
  }, []);

  // 章节按需拉。一次把 1389 节全取回来，为的只是「万一你想展开某一本」。
  const toggle = useCallback((source) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(source.id)) next.delete(source.id);
      else {
        next.add(source.id);
        setDocs((loaded) => {
          if (!loaded[source.id]) {
            api.knowledgeSourceDocs(source.id)
              .then((result) => setDocs((cur) => ({ ...cur, [source.id]: result.documents })))
              .catch(() => setDocs((cur) => ({ ...cur, [source.id]: [] })));
          }
          return loaded;
        });
      }
      return next;
    });
  }, []);

  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matched = (data?.sources || []).filter((item) => !term || item.title.toLowerCase().includes(term));
    return KIND_ORDER
      .map((kind) => ({ kind, items: matched.filter((item) => (item.sourceKind || "书籍") === kind) }))
      .filter((group) => group.items.length);
  }, [data, query]);

  if (error) return <ErrorNote error={error} what="资料" />;
  if (!data) return <Loading rows={6} />;

  const totals = data.totals;

  return (
    <div className="view-body">
      <div className="src-top">
        <p className="src-lead">
          {number(totals.sources)} 份资料 · {number(totals.documents)} 节 · {number(totals.chars)} 字
          {totals.citedFacts ? <> · 已支撑 <b>{number(totals.citedFacts)}</b> 条事实</> : null}
        </p>
        <SearchBox value={query} onChange={setQuery} placeholder="搜资料名" ariaLabel="搜索资料" />
      </div>

      {!groups.length ? (
        <Empty icon={IconSearch}>没有匹配「{query}」的资料。</Empty>
      ) : null}

      {groups.map((group) => (
        <section key={group.kind} className="src-group">
          <h3 className="src-group__head">
            {group.kind}
            <span className="src-group__count">{group.items.length}</span>
            <em>{KIND_HINT[group.kind]}</em>
          </h3>

          <div className="src-table" role="table">
            {/* ⚠️ 表头不画底色也不加边框。设计系统那条「不要框里画框」——
                外壳已经是白框，这里再套一层盒子，屏幕上最响的就成了那圈线。 */}
            <div className="src-row src-row--head" role="row">
              <span role="columnheader">名称</span>
              <span role="columnheader">节数</span>
              <span role="columnheader">字数</span>
              <span role="columnheader">提炼</span>
              <span role="columnheader">支撑事实</span>
            </div>

            {group.items.map((source) => {
              const state = distillState(source);
              const expanded = open.has(source.id);
              const chapters = docs[source.id];
              return (
                <div key={source.id} className="src-item">
                  <div className="src-row" role="row">
                    <button
                      type="button"
                      className="src-name"
                      aria-expanded={expanded}
                      onClick={() => toggle(source)}
                      title={expanded ? "收起章节" : "展开章节"}
                    >
                      <IconChevronRight aria-hidden="true" stroke={1.8} data-open={expanded ? "" : undefined} />
                      <span className="clamp">{source.title}</span>
                      {/* 可写性和归类是两件事，所以只在「能改正文」时标出来——
                          默认只读，标注例外比标注常态省一屏的字 */}
                      {source.writable === "资料" ? <em className="src-tag">可改</em> : null}
                    </button>
                    <span className="src-num">{number(source.documents)}</span>
                    <span className="src-num">{number(source.chars)}</span>
                    <span className={`src-state src-state--${state.tone}`}>{state.label}</span>
                    <span className="src-num src-num--strong">{source.citedFacts ? number(source.citedFacts) : "—"}</span>
                  </div>

                  {expanded ? (
                    <div className="src-children">
                      {!chapters ? <Loading rows={2} /> : chapters.length ? chapters.map((doc) => (
                        <div key={doc.id} className="src-row src-row--child" role="row">
                          <button type="button" className="src-name src-name--child" onClick={() => onOpen?.(source, doc)}>
                            <span className="clamp">{doc.title}</span>
                          </button>
                          <span className="src-num" />
                          <span className="src-num">{number(doc.chars)}</span>
                          <span className={`src-state src-state--${doc.ingestStatus === "failed" ? "warn" : doc.ingestStatus ? "done" : "idle"}`}
                            title={doc.ingestError || undefined}>
                            {doc.ingestStatus === "applied" ? "已提炼"
                              : doc.ingestStatus === "proposed" ? "待审阅"
                              : doc.ingestStatus === "empty" ? "无可沉淀"
                              : doc.ingestStatus === "failed" ? "失败"
                              : "未提炼"}
                          </span>
                          <span className="src-num src-num--strong">{doc.citedFacts ? number(doc.citedFacts) : "—"}</span>
                        </div>
                      )) : <p className="src-empty">这份资料没有章节。</p>}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
