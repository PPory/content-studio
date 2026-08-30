// 通读：把整个合集按顺序拼成一条连续正文。
//
// 这是「写教程知识库」真正要的那一下——**检查前后接不接得上**。分开一篇篇点开看，
// 你永远发现不了第三篇和第四篇讲了同一件事，或者第二篇用了一个还没解释过的词。
//
// ⚠️ **没写正文的文章要留在这里**，标成「这篇还没有正文」。静默跳过的话，
// 通读读起来是连贯的，而实际上中间缺了一节——那正是它该帮你发现的东西。

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import { useDialog } from "../../lib/use-dialog.js";
import { renderMarkdown } from "../../lib/markdown.js";
import { ErrorNote, Loading } from "../../components/ui.jsx";
import { IconDownload, IconFileText, IconX } from "../../components/icons.jsx";

export function SeriesReader({ open, seriesId, onClose, onExport, onGo }) {
  const [read, setRead] = useState(null);
  const [error, setError] = useState(null);
  const boxRef = useDialog(open, onClose);

  useEffect(() => {
    if (!open) return;
    setRead(null);
    setError(null);
    api.seriesRead(seriesId).then((result) => setRead(result.read)).catch(setError);
  }, [open, seriesId]);

  const rendered = useMemo(
    () => (read?.sections || []).map((section) => (section.kind === "article" && section.body ? renderMarkdown(section.body) : "")),
    [read],
  );

  if (!open) return null;

  const articles = (read?.sections || []).filter((section) => section.kind === "article");
  const words = articles.reduce((sum, section) => sum + (section.words || 0), 0);

  return (
    <div className="scrim series-read" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="series-read__sheet" role="dialog" aria-modal="true" aria-label={`通读「${read?.title || "合集"}」`} ref={boxRef}>
        <header className="series-read__bar">
          <div>
            <strong>{read?.title || "通读"}</strong>
            {read ? <span>{articles.length} 篇 · 约 {words} 字</span> : null}
          </div>
          <div className="series-read__tools">
            <button className="btn btn-sm" onClick={onExport} disabled={!read}><IconDownload aria-hidden="true" />导出 Markdown</button>
            <button className="icon-btn" onClick={onClose} aria-label="关闭通读"><IconX aria-hidden="true" /></button>
          </div>
        </header>

        <div className="series-read__body">
          {error ? <ErrorNote error={error} what="读取合集正文" /> : null}
          {!read && !error ? <Loading rows={6} /> : null}

          {read ? (
            <article className="series-read__doc">
              <h1>{read.title}</h1>
              {read.description ? <p className="series-read__lede">{read.description}</p> : null}

              {read.sections.map((section, index) => {
                if (section.kind === "section") return <h2 key={`section-${index}`} className="series-read__part">{section.heading}</h2>;
                return (
                  <section key={`article-${index}`} className="series-read__article">
                    <h3>
                      {section.title}
                      {section.projectId ? (
                        <button type="button" className="series-read__jump" onClick={() => { onClose(); onGo("project", section.projectId); }}>
                          <IconFileText aria-hidden="true" stroke={1.7} />去编辑
                        </button>
                      ) : null}
                    </h3>
                    {section.note ? <p className="series-read__note">{section.note}</p> : null}
                    {section.deleted ? <p className="series-read__hole">这篇文章已移入回收站。</p>
                      : section.body ? <div className="prose" dangerouslySetInnerHTML={{ __html: rendered[index] }} />
                        : <p className="series-read__hole">这篇还没有正文。</p>}
                  </section>
                );
              })}

              {!read.sections.length ? <p className="series-read__hole">这个合集还是空的。</p> : null}
            </article>
          ) : null}
        </div>
      </section>
    </div>
  );
}
