// 合集列表。
//
// ⚠️ **卡片不是随手选的，是判据选的**（`docs/design-system.md`「内容密度」）：
// 合集是个位数、每张承载一个明确对象、而且卡上要装**里面有哪几篇**的预览。
// 上一版把它画成「灰底上一张白卡、白卡里两条稀薄的行」——既是框里画框，
// 又因为一行只有名字和「0 篇文章」，你得挨个点进去才知道哪个是哪个。
//
// 删除放在卡上而不是详情页：删一个建错名字的空合集不该先进去一趟。
// 两步确认，第二步写清删的是什么（学 `ProjectTable` 那颗）。

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Empty, ErrorNote, Loading, PageHeader, Toast, relTime } from "../components/ui.jsx";
import { IconBook, IconLoader2, IconPlus, IconRefresh, IconTrash } from "../components/icons.jsx";
import { SeriesDialog } from "../components/SeriesDialog.jsx";
import "./series.css";

export function Series({ onGo, onChanged }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState("");
  const [removing, setRemoving] = useState("");
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.seriesList().then((data) => { setResult(data); setError(null); }).catch(setError).finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);
  const items = result?.series || [];

  const remove = async (series) => {
    if (removing) return;
    setConfirming("");
    setRemoving(series.id);
    try {
      const out = await api.removeSeries(series.id);
      setToast({ text: out.preservedProjects ? `已删除合集，${out.preservedProjects} 篇文章保留在全部文章里` : "已删除合集" });
      onChanged?.();
      load();
    } catch (cause) {
      setError(cause);
    } finally {
      setRemoving("");
    }
  };

  return (
    <>
      <PageHeader
        title="创作"
        desc="合集把同一系列的文章收在一起——写教程或知识库时，它就是那本书的目录。"
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
      {loading && !result ? <Loading rows={3} /> : null}
      {result && !items.length ? (
        <Empty icon={IconBook}>还没有合集。建一个，再把已有文章放进去——或者直接在合集里开始写第一篇。</Empty>
      ) : null}

      {items.length ? (
        <section className="series-grid" aria-label="合集列表">
          {items.map((series) => (
            <article className="series-card" key={series.id}>
              <button type="button" className="series-card__open" onClick={() => onGo("series-detail", series.id)}>
                <h3>{series.title}</h3>
                {series.description ? <p className="series-card__desc">{series.description}</p> : null}
                {/* 卡上要能看见里面装了什么。没有预览的话一屏名字看不出该点哪个 */}
                {series.preview.length ? (
                  <ol className="series-card__preview">
                    {series.preview.map((title, index) => <li key={`${series.id}-${index}`}>{title}</li>)}
                    {series.progress.total > series.preview.length ? <li className="is-more">还有 {series.progress.total - series.preview.length} 篇</li> : null}
                  </ol>
                ) : <p className="series-card__empty">还是空的</p>}
                <footer>
                  <span>{series.progress.total} 篇</span>
                  {series.progress.published ? <span>{series.progress.published} 篇已发布</span> : null}
                  <time>{relTime(series.updatedAt)}</time>
                </footer>
              </button>

              {/**
                * ⚠️ 两步删除，第二步写清删的是**合集本身**。
                * 「确定吗」在这里没用——用户真正怕的是「里面那几篇会不会一起没」。
                */}
              {confirming === series.id ? (
                <button
                  className="series-card__del is-armed"
                  onClick={() => remove(series)}
                  onBlur={() => setConfirming((v) => (v === series.id ? "" : v))}
                  disabled={removing === series.id}
                  title="只删合集本身，里面的文章都留在全部文章里；合集可从回收站恢复"
                >
                  {removing === series.id ? <IconLoader2 size={13} className="spin" aria-hidden="true" /> : null}
                  只删合集，留下文章
                </button>
              ) : (
                <button
                  className="series-card__del"
                  onClick={() => setConfirming(series.id)}
                  onBlur={() => setConfirming((v) => (v === series.id ? "" : v))}
                  aria-label={`删除合集「${series.title}」`}
                  title="删除这个合集"
                >
                  <IconTrash size={14} stroke={1.7} aria-hidden="true" />
                </button>
              )}
            </article>
          ))}
        </section>
      ) : null}

      <SeriesDialog open={creating} onClose={() => setCreating(false)} onCreated={(series) => { onChanged?.(); onGo("series-detail", series.id); }} />
      <Toast text={toast?.text} onClose={() => setToast(null)} />
    </>
  );
}
