import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading } from "../components/ui.jsx";
import { IconArrowLeft, IconChevronRight } from "../components/icons.jsx";
import { renderMarkdown } from "../lib/markdown.js";

function dateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function EntryDetail({ entryId, onBack, onGo, onOpenSource }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    setData(null);
    setError(null);
    api.wikiPage(entryId).then(setData).catch(setError);
  }, [entryId]);
  const html = useMemo(() => renderMarkdown(data?.page?.bodyMarkdown || ""), [data?.page?.bodyMarkdown]);

  if (error) return <ErrorNote error={error} what="Wiki 页面" />;
  if (!data) return <Loading rows={8} />;
  const { page, sources = [], links = { outgoing: [], incoming: [] }, revisions = [], typeLabels = {} } = data;

  return (
    <div className="view-body wiki-article">
      <button type="button" className="btn btn-sm entry-back" onClick={onBack}>
        <IconArrowLeft aria-hidden="true" stroke={1.8} />返回 Wiki
      </button>

      <header className="wiki-article__head">
        <p>{typeLabels[page.pageType] || page.pageType}</p>
        <h2>{page.title}</h2>
        <div><span>版本 {page.revision}</span><span>{sources.length} 个来源</span><span>{links.outgoing.length + links.incoming.length} 个连接</span><time>{dateTime(page.updatedAt)}</time></div>
        <blockquote>{page.summary}</blockquote>
      </header>

      <div className="wiki-article__layout">
        <article className="wiki-article__body prose" dangerouslySetInnerHTML={{ __html: html }} />
        <aside className="wiki-article__rail">
          <section>
            <h3>连接</h3>
            {[...links.outgoing.map((item) => ({ ...item, direction: "out" })),
              ...links.incoming.map((item) => ({ ...item, direction: "in" }))].map((item) => (
              <button key={`${item.direction}-${item.id}-${item.relation}`} type="button" onClick={() => onGo?.(`entries/${item.id}`)}>
                <small>{item.direction === "out" ? item.relation : `被关联 · ${item.relation}`}</small>
                <b>{item.title}</b>
                {item.why ? <span>{item.why}</span> : null}
                <IconChevronRight aria-hidden="true" />
              </button>
            ))}
            {!links.outgoing.length && !links.incoming.length ? <p>这个页面还没有接入知识网络。</p> : null}
          </section>

          <section>
            <h3>依据</h3>
            {sources.map((source, index) => (
              <details key={`${source.sourceId}-${index}`}>
                <summary>{source.locator || source.sourceTitle || "本地来源"}</summary>
                {source.contribution ? <p>{source.contribution}</p> : null}
                {source.quote ? <blockquote>{source.quote}</blockquote> : <p>历史迁移记录没有逐字摘录。</p>}
                <button type="button" className="fact__src" disabled={!source.sourceBookId}
                  onClick={() => onOpenSource?.({ sourceId: source.sourceId, sourceQuote: source.quote, sourceBookId: source.sourceBookId })}>
                  {source.sourceBookId ? "打开并定位到 Raw" : "没有可打开的原文落点"}
                </button>
              </details>
            ))}
          </section>

          <section>
            <h3>演化</h3>
            <ol className="wiki-revisions">
              {revisions.map((revision) => (
                <li key={revision.id}><b>v{revision.revision} · {revision.changeTitle}</b><span>{revision.reason || revision.changeSummary}</span><time>{dateTime(revision.createdAt)}</time></li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
