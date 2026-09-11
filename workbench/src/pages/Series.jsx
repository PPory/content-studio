// 合集列表。
//
// ⚠️ **卡片不是随手选的，是判据选的**（`docs/design-system.md`「内容密度」）：
// 合集是个位数、每张承载一个明确对象、而且卡上要装**里面有哪几篇**的预览。
// 上一版把它画成「灰底上一张白卡、白卡里两条稀薄的行」——既是框里画框，
// 又因为一行只有名字和「0 篇文章」，你得挨个点进去才知道哪个是哪个。
//
// 卡片 / 列表两种摆法都留着，是因为这一页的任务会变：合集少的时候要认出
//「哪个装了什么」（预览），合集多起来之后要横着比「哪个最久没动」（列表）。
// 判据见 `lib/use-layout-mode.js`。
//
// 删除放在卡上而不是详情页：删一个建错名字的空合集不该先进去一趟。
// 两步确认走共用的 `RowDelete`，第二步写清删的是什么。

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Empty, ErrorNote, LayoutToggle, Loading, PageHeader, RowDelete, Toast, relTime } from "../components/ui.jsx";
import { IconBook, IconPlus, IconRefresh } from "../components/icons.jsx";
import { SeriesDialog } from "../components/SeriesDialog.jsx";
import { useLayoutMode } from "../lib/use-layout-mode.js";
import { useUndoToast } from "../lib/use-undo-toast.js";
import "./series.css";

export function Series({ onGo, onChanged }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  // 确认态让那一张卡／那一行钉住，不再靠 hover 显形
  const [confirmRow, setConfirmRow] = useState("");
  const [toast, setToast] = useUndoToast();
  const [layout, setLayout] = useLayoutMode("series");

  const load = useCallback(() => {
    setLoading(true);
    api.seriesList().then((data) => { setResult(data); setError(null); }).catch(setError).finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);
  const items = result?.series || [];

  /**
   * 移入回收站。**只删合集这个壳**，里面的文章一篇不动——用户怕的从来不是
   * 合集本身，是「那几篇会不会跟着没」，所以回执要把这句说完。
   * 撤销走 `/series/:id/restore`：合集本身也是软删除，一步能走回来。
   */
  const remove = async (series) => {
    try {
      const out = await api.removeSeries(series.id);
      setToast({
        text: `合集「${series.title}」已移入回收站`,
        detail: out.preservedProjects ? `${out.preservedProjects} 篇文章保留在全部文章里。` : "里面还是空的。",
        undo: async () => { await api.restoreSeries(series.id); setToast(null); onChanged?.(); load(); },
      });
      onChanged?.();
      load();
    } catch (cause) {
      setError(cause);
    }
  };

  const del = (series) => (
    <RowDelete
      onDelete={() => remove(series)}
      label="只删合集，留下文章"
      title={`删除合集「${series.title}」——里面的文章都留在全部文章里`}
      onOpenChange={(open) => setConfirmRow(open ? series.id : "")}
    />
  );

  return (
    <>
      <PageHeader
        title="合集"
        aside={<>
          {result ? <span className="project-total">{result.total ?? items.length} 个合集</span> : null}
          <button className="icon-btn" onClick={load} disabled={loading} aria-label="刷新合集" title="刷新"><IconRefresh aria-hidden="true" className={loading ? "spinning" : ""} /></button>
          <LayoutToggle value={layout} onChange={setLayout} />
          <button className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus aria-hidden="true" />新建合集</button>
        </>}
      />

      {error ? <ErrorNote error={error} what="读取合集" onRetry={load} /> : null}
      {loading && !result ? <Loading rows={3} /> : null}
      {/* 说明句只在这儿出现：第一次来的人需要「合集是什么」，第一百次不需要 */}
      {result && !items.length ? (
        <Empty
          icon={IconBook}
          action={<button type="button" className="btn btn-sm" onClick={() => setCreating(true)}>新建合集</button>}
        >
          合集把同一系列的文章收在一起——写教程或知识库时，它就是那本书的目录。
          建一个，再把已有文章放进去，或者直接在合集里开始写第一篇。
        </Empty>
      ) : null}

      {items.length && layout === "list" ? (
        <section className="rows series-list" aria-label="合集列表">
          {items.map((series) => (
            <div className="row" key={series.id} data-confirm={confirmRow === series.id ? "" : undefined}>
              <div className="row-head">
                <button type="button" className="row-title series-list__open" aria-label={`打开合集：${series.title}`} onClick={() => onGo("series-detail", series.id)}>{series.title}</button>
                <span className="row-meta">
                  <span>{series.progress.total} 篇{series.progress.published ? ` · ${series.progress.published} 篇已发布` : ""}</span>
                  <time>{relTime(series.updatedAt)}</time>
                </span>
                <span className="series-list__acts">{del(series)}</span>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {items.length && layout !== "list" ? (
        <section className="series-grid" aria-label="合集列表">
          {items.map((series) => (
            <article className="series-card" key={series.id} data-confirm={confirmRow === series.id ? "" : undefined}>
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
              <span className="series-card__acts">{del(series)}</span>
            </article>
          ))}
        </section>
      ) : null}

      <SeriesDialog open={creating} onClose={() => setCreating(false)} onCreated={(series) => { onChanged?.(); onGo("series-detail", series.id); }} />
      <Toast text={toast?.text} detail={toast?.detail} onUndo={toast?.undo} onClose={() => setToast(null)} />
    </>
  );
}
