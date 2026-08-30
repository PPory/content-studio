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
        desc="单篇文章保持独立；系列教程在这里先搭完整目录，再逐篇进入原有写作、发布和复盘。"
        aside={<>
          {result ? <span className="project-total">{result.total ?? items.length} 个系列</span> : null}
          <button className="icon-btn" onClick={load} disabled={loading} aria-label="刷新系列" title="刷新"><IconRefresh aria-hidden="true" className={loading ? "spinning" : ""} /></button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus aria-hidden="true" />新建系列</button>
        </>}
      />

      <div className="content-kind-switch seg" role="group" aria-label="创作类型">
        <button aria-pressed="false" onClick={() => onGo("content")}>单篇文章</button>
        <button aria-pressed="true">系列教程</button>
      </div>

      {error ? <ErrorNote error={error} what="读取系列教程" onRetry={load} /> : null}
      {loading && !result ? <Loading rows={4} /> : null}
      {result && !items.length ? (
        <Empty icon={IconBook}>还没有系列教程。先建立系列目标和章节目录，暂时不必创建任何文章。</Empty>
      ) : null}
      {items.length ? (
        <section className="series-list" aria-label="系列教程列表">
          {items.map((series) => (
            <button key={series.id} type="button" className="series-row" onClick={() => onGo("series-detail", series.id)}>
              <span className="series-row__main">
                <strong>{series.title}</strong>
                <span>{series.outcome || series.description || "还没有填写系列目标"}</span>
              </span>
              <span className="series-row__progress" aria-label={`已发布 ${series.progress.published} 篇，共 ${series.progress.total} 篇`}>
                <span><i style={{ width: `${series.progress.percent}%` }} /></span>
                <b>{series.progress.published}/{series.progress.total} 已发布</b>
              </span>
              <span className="series-row__meta">{series.progress.writing ? `${series.progress.writing} 篇写作中 · ` : ""}{relTime(series.updatedAt)}</span>
            </button>
          ))}
        </section>
      ) : null}

      <SeriesDialog open={creating} onClose={() => setCreating(false)} onCreated={(series) => { onChanged?.(); onGo("series-detail", series.id); }} />
    </>
  );
}
