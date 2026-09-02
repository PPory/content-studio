import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, Note, SearchBox } from "../components/ui.jsx";
import { IngestReview } from "../components/IngestReview.jsx";
import { ScrollToTop } from "../components/ScrollToTop.jsx";

const TYPE_ORDER = ["overview", "topic", "synthesis", "comparison", "concept", "method", "person", "organization", "work", "stance", "source_summary"];

function when(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

export function Entries({ onGo, focusSourceId = "", focusBookId = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [lintBusy, setLintBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = () => api.wiki().then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  // 「来源」页点「影响页面 85」进来时带的书 id。名字从库里查，不塞进 URL。
  const focusBook = useMemo(
    () => (data?.sourceBooks || []).find((book) => book.id === focusBookId) || null,
    [data, focusBookId],
  );
  const scoped = useMemo(() => (data?.pages || [])
    .filter((page) => !focusBookId || (page.sourceBookIds || []).includes(focusBookId)),
  [data, focusBookId]);

  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();
    const pages = scoped.filter((page) => !term
      || `${page.title} ${page.summary}`.toLowerCase().includes(term));
    return TYPE_ORDER.map((type) => ({
      type,
      label: data?.typeLabels?.[type] || type,
      pages: pages.filter((page) => page.pageType === type),
    })).filter((group) => group.pages.length);
  }, [data, query, scoped]);

  const runLint = async () => {
    setLintBusy(true);
    setNotice(null);
    try {
      const result = await api.runKnowledgeLint("network", 1);
      setNotice({
        title: result.queued ? "体检已加入队列" : "体检任务已在队列中",
        detail: "完成后会在这里生成诊断报告，不会自动修改 Wiki。",
      });
    } catch (failure) {
      setError(failure);
    } finally {
      setLintBusy(false);
    }
  };

  if (error) return <ErrorNote error={error} what="Wiki" onRetry={load} />;
  if (!data) return <Loading rows={8} />;

  const { totals, health, log = [] } = data;
  return (
    <div className="view-body wiki-home">
      <header className="wiki-hero">
        <div>
          <p className="wiki-kicker">持续编译的知识</p>
          <h2>我的 Wiki</h2>
          <p>这里不是原文仓库，而是 AI 根据你读过的资料持续维护的当前认识。</p>
        </div>
        <div className="wiki-hero__actions">
          <button type="button" className="btn" onClick={() => onGo?.("sources")}>查看 Raw 来源</button>
          <button type="button" className="btn btn-primary" disabled={lintBusy || !totals.pages} onClick={runLint}>
            {lintBusy ? "正在启动…" : "全库体检"}
          </button>
        </div>
      </header>

      <section className="wiki-pulse" aria-label="Wiki 状态">
        <div><b>{totals.pages}</b><span>个知识页面</span></div>
        <div><b>{totals.sources}</b><span>份来源被引用</span></div>
        <div><b>{totals.links}</b><span>条页面连接</span></div>
        <div className={health.pendingSources ? "is-warn" : ""}><b>{health.pendingSources}</b><span>篇 Raw 尚未编译</span></div>
      </section>

      {notice ? (
        <div className="wiki-notice" role="status" aria-live="polite">
          <Note tone="default" title={notice.title}>{notice.detail}</Note>
        </div>
      ) : null}
      <IngestReview onDone={load} focusSourceId={focusSourceId} />

      {focusBookId ? (
        <div className="wiki-scope" role="status">
          <span>
            只看<b>{focusBook ? `《${focusBook.title}》` : "这份来源"}</b>影响的
            <b> {scoped.length} </b>张页面
          </span>
          <button type="button" className="link-btn" onClick={() => onGo?.("entries")}>看全部 {totals.pages} 张</button>
        </div>
      ) : null}

      <div className="wiki-toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="搜索页面、主题或来源" ariaLabel="搜索 Wiki" />
        <p>
          {health.orphans ? `${health.orphans} 个孤立页面` : "页面连接正常"}
          {health.missingCitations ? ` · ${health.missingCitations} 页缺少来源` : ""}
          {health.staleCitations ? ` · ${health.staleCitations} 页的来源已变化` : ""}
        </p>
      </div>

      {!totals.pages ? (
        <Note>
          还没有 Wiki 页面。先从“来源”选择一份资料开始编译；一次编译会生成来源资料卡，并更新所有相关知识页面。
        </Note>
      ) : (
        <div className="wiki-layout">
          <main className="wiki-index">
            {!groups.length ? (
              <div className="wiki-search-empty">
                {query.trim()
                  ? `没有找到“${query.trim()}”相关的知识页面。`
                  : "这份来源还没有影响任何 Wiki 页面。"}
              </div>
            ) : groups.map((group) => (
              <section key={group.type} className="wiki-section">
                <div className="wiki-section__head">
                  <h3>{group.label}</h3>
                  <span>{group.pages.length}</span>
                </div>
                <div className="wiki-page-list">
                  {group.pages.map((page) => (
                    <button key={page.id} type="button" className="wiki-page-row" onClick={() => onGo?.(`entries/${page.id}`)}>
                      <span className="wiki-page-row__title">{page.title}</span>
                      <span className="wiki-page-row__summary">{page.summary}</span>
                      <span className="wiki-page-row__meta">{page.sourceCount} 个来源 · {page.linkCount} 个连接 · v{page.revision}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </main>

          <aside className="wiki-log">
            <div className="wiki-section__head"><h3>最近演化</h3><span>Log</span></div>
            {log.length ? (
              <ol>
                {log.map((item) => (
                  <li key={item.id}>
                    <time>{when(item.createdAt)}</time>
                    <div><b>{item.title}</b><p>{item.summary}</p></div>
                  </li>
                ))}
              </ol>
            ) : <p className="entry-empty">每次编译、探索归档和体检都会追加在这里。</p>}
          </aside>
        </div>
      )}
      <ScrollToTop label="返回 Wiki 顶部" />
    </div>
  );
}
