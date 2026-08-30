import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Empty, ErrorNote, Loading, PageHeader, relTime } from "../components/ui.jsx";
import { IconBook, IconPlus, IconRefresh } from "../components/icons.jsx";
import { SeriesDialog } from "../components/SeriesDialog.jsx";
import "./series.css";

export function Series({ onGo, onChanged }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.seriesList().then((data) => { setResult(data); setError(null); }).catch(setError).finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);
  const items = result?.series || [];

  return (
    <>
      <PageHeader
        title="创作"
        desc="像文件夹一样整理文章。合集只负责归类，文章仍然沿用原来的写作、发布和复盘。"
        aside={<>
          {result ? <span className="project-total">{result.total ?? items.length} 个合集</span> : null}
          <button className="icon-btn" onClick={load} disabled={loading} aria-label="刷新合集" title="刷新"><IconRefresh aria-hidden="true" className={loading ? "spinning" : ""} /></button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus aria-hidden="true" />新建合集</button>
        </>}
      />

      <div className="content-kind-switch seg" role="group" aria-label="创作类型">
        <button aria-pressed="false" onClick={() => onGo("content")}>全部文章</button>
        <button aria-pressed="true">合集</button>
      </div>

      {error ? <ErrorNote error={error} what="读取合集" onRetry={load} /> : null}
      {loading && !result ? <Loading rows={4} /> : null}
      {result && !items.length ? (
        <Empty icon={IconBook}>还没有合集。可以先建一个文件夹，再把已有文章放进去。</Empty>
      ) : null}
      {items.length ? (
        <section className="series-list" aria-label="合集列表">
          {items.map((series) => (
            <button key={series.id} type="button" className="series-row" onClick={() => onGo("series-detail", series.id)}>
              <span className="series-row__main">
                <strong>{series.title}</strong>
                <span>{series.description || "还没有填写合集说明"}</span>
              </span>
              <span className="series-row__count">{series.progress.total} 篇文章</span>
              <span className="series-row__meta">{series.progress.writing ? `${series.progress.writing} 篇写作中 · ` : ""}{relTime(series.updatedAt)}</span>
            </button>
          ))}
        </section>
      ) : null}

      <SeriesDialog open={creating} onClose={() => setCreating(false)} onCreated={(series) => { onChanged?.(); onGo("series-detail", series.id); }} />
    </>
  );
}
