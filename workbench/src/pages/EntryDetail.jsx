import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading } from "../components/ui.jsx";
import { IconArrowLeft, IconChevronRight, IconTrash, IconX } from "../components/icons.jsx";
import { renderMarkdown } from "../lib/markdown.js";
import { useDialog } from "../lib/use-dialog.js";
import { ScrollToTop } from "../components/ScrollToTop.jsx";

function dateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function EntryDetail({ entryId, onBack, onGo, onOpenSource, onBridge }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteDialogRef = useDialog(confirmDelete, () => setConfirmDelete(false));
  useEffect(() => {
    setData(null);
    setError(null);
    api.wikiPage(entryId).then(setData).catch(setError);
  }, [entryId]);
  const html = useMemo(() => renderMarkdown(data?.page?.bodyMarkdown || ""), [data?.page?.bodyMarkdown]);

  if (error) return <ErrorNote error={error} what="Wiki 页面" />;
  if (!data) return <Loading rows={8} />;
  const { page, sources = [], links = { outgoing: [], incoming: [] }, revisions = [], typeLabels = {} } = data;

  async function trashPage() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await api.trashWikiPage(page.id);
      setConfirmDelete(false);
      onBack?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="view-body wiki-article">
      <div className="wiki-article__actions">
        <button type="button" className="btn btn-sm entry-back" onClick={onBack}>
        <button type="button" className="btn btn-sm" onClick={() => onBridge?.(page.id)}>
          看看它能解决哪些用户问题
        </button>
          <IconArrowLeft aria-hidden="true" stroke={1.8} />返回 Wiki
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirmDelete(true)}>
          <IconTrash aria-hidden="true" stroke={1.8} />删除页面
        </button>
      </div>

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
      {confirmDelete ? (
        <div className="scrim scrim--center" onMouseDown={(event) => event.target === event.currentTarget && setConfirmDelete(false)}>
          <section className="modal wiki-delete-dialog" ref={deleteDialogRef} role="dialog" aria-modal="true" aria-labelledby="wiki-delete-title">
            <header className="modal__head">
              <div><span className="eyebrow">WIKI</span><h2 id="wiki-delete-title">删除「{page.title}」？</h2></div>
              <button type="button" className="icon-btn" onClick={() => setConfirmDelete(false)} aria-label="关闭"><IconX aria-hidden="true" /></button>
            </header>
            <p className="modal__lead">页面会从 Wiki 和知识检索中隐藏；历史版本、来源依据和关系记录会保留，之后仍可恢复。</p>
            <footer className="modal__foot">
              <span className="modal__hint">Raw 来源不会被删除。</span>
              <div className="row-actions">
                <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>取消</button>
                <button type="button" className="btn btn-sm btn-danger" onClick={trashPage} disabled={deleting}>{deleting ? "正在移入…" : "移入回收站"}</button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
      <ScrollToTop label="返回 Wiki 页面顶部" />
    </div>
  );
}
