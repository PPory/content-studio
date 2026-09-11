import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { projectOpenTarget, projectsFrom } from "../lib/content-projects.js";
import { NewContentButton } from "../components/NewContentButton.jsx";
import { Empty, ErrorNote, Loading, PageHeader, Toast } from "../components/ui.jsx";
import { useUndoToast } from "../lib/use-undo-toast.js";
import { IconFileText, IconRefresh } from "../components/icons.jsx";
import { ProjectTable } from "./content/ProjectTable.jsx";
import { SeriesPicker } from "../components/SeriesPicker.jsx";
import "./series.css";

export function Content({ workerReady, onGo, onChanged, onSettings }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useUndoToast();
  const [stage, setStage] = useState("进行中");
  /** 正在给哪一篇挑合集。归类要在**看得见这篇文章的地方**做，不是进合集再搜一遍。 */
  const [filing, setFiling] = useState(null);

  const load = useCallback(() => {
    if (!workerReady) return;
    setLoading(true);
    api.projects()
      .then((data) => { setResult(data); setError(null); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [workerReady]);

  useEffect(load, [load]);

  const projects = useMemo(() => projectsFrom(result), [result]);
  const grouped = useMemo(() => ({
    "进行中": projects.filter((project) => !["待复盘", "已完成", "已搁置"].includes(project.stage)),
    "已发布": projects.filter((project) => ["待复盘", "已完成"].includes(project.stage)),
    "归档": projects.filter((project) => project.stage === "已搁置"),
  }), [projects]);
  const shown = useMemo(() => [...grouped[stage]].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))), [grouped, stage]);
  const open = (project) => {
    const target = projectOpenTarget(project);
    if (!target) return;
    onGo(target.view, target.id);
  };

  /**
   * 删掉一个项目会移入本地回收站，并带上所属稿件。
   *
   * ⚠️ **回执要说清删掉了几篇**，不能只说「已删除」——你以为删的是一个壳，
   * 而它可能带走了三篇写过的稿。
   *
   * ⚠️ **而且要给回头路。** 界面上没有回收站页面，所以「点错了怎么办」的唯一
   * 答案就是这条回执上的「撤销」——它走 `/projects/:id/restore`，稿子一起回来。
   *
   * 「正在删」的忙态和防重入归 `RowDelete` 自己管（它 await 这个函数），
   * 所以这一层不再留 `removing`——同一件事两处各记一份，迟早有一处忘了改。
   */
  const remove = useCallback(async (p) => {
    try {
      const r = await api.removeProject(p.id);
      setToast({
        text: `「${p.title || "未命名内容"}」已移入回收站`,
        detail: r.deleted ? `连同 ${r.deleted} 篇稿子。` : undefined,
        undo: async () => { await api.restoreProject(p.id); setToast(null); onChanged?.(); load(); },
      });
      onChanged?.();
      await load();
    } catch (e) {
      setError(e);
    }
  }, [load, onChanged, setToast]);

  return (
    <>
      <PageHeader
        title="内容"
        aside={
          <>
            {result ? <span className="project-total">{result.total ?? projects.length} 篇内容</span> : null}
            <button className="icon-btn" onClick={load} disabled={loading || !workerReady} aria-label="刷新内容项目" title="刷新">
              <IconRefresh aria-hidden="true" className={loading ? "spinning" : ""} />
            </button>
            {/* 四处共用一颗（`components/NewContentButton.jsx`），别在这儿再拼一份菜单 */}
            {workerReady ? <NewContentButton onGo={onGo} onChanged={onChanged} /> : null}
          </>
        }
      />

      {!workerReady ? (
        <div className="project-setup">
          <strong>本地工作区暂时不可用</strong>
          <p>请检查工作区设置后重试。</p>
          <button className="btn" onClick={onSettings}>打开设置</button>
        </div>
      ) : null}

      {error ? (
        <div className="project-error">
          <ErrorNote error={error} what="读取内容项目" onRetry={load} />
          <div className="project-error__legacy">
            <span>兼容期仍可继续使用现有内容。</span>
            <button className="btn btn-sm" onClick={() => onGo("topics", "待写")}>打开旧版选题</button>
            <button className="btn btn-sm" onClick={() => onGo("drafts", "写作中")}>打开稿件库</button>
          </div>
        </div>
      ) : null}

      {loading && !result ? <Loading rows={4} /> : null}

      {result ? (
        <>
          {/* ⚠️ 「更多」那个折叠撤了：里面三条（合集 / 找灵感 / 查看发布数据）
              都是**会换整页的去处**，而三个去处都在侧栏里。导航不待在正文的折叠里
              （判据同 `Series.jsx` 撤掉的那颗「全部文章 / 合集」）。 */}
          <div className="list-bar">
            <div className="chips chips-sm" aria-label="内容状态">
              {["进行中", "已发布", "归档"].map((key) => <button key={key} className="chip" aria-pressed={stage === key} onClick={() => setStage(key)}>{key}{grouped[key].length ? ` ${grouped[key].length}` : ""}</button>)}
            </div>
          </div>
          {!projects.length ? (
            /* ⚠️ **首启空态要带一颗能点的**：只有一句灰字的话「下一步点哪儿」
               还是留给用户猜。和下面那个「这一档空着」的筛选空态不是一回事。 */
            <Empty
              icon={IconFileText}
              action={workerReady ? <NewContentButton label="写第一篇" className="btn btn-sm" onGo={onGo} onChanged={onChanged} /> : null}
            >
              写下第一句话就可以开始，不必先定选题或填写计划。
            </Empty>
          ) : shown.length ? (
            <ProjectTable projects={shown} onOpen={open} onRemove={remove} onFile={setFiling} />
          ) : (
            <Empty icon={IconFileText}>{stage === "进行中" ? "没有正在写的内容，可以开始新的一篇。" : stage === "已发布" ? "发布后的作品会留在这里。" : "暂时搁置的内容会留在这里，随时可以继续。"}</Empty>
          )}
        </>
      ) : null}

      <SeriesPicker
        open={Boolean(filing)}
        mode="series"
        project={filing}
        onClose={() => setFiling(null)}
        onDone={(result) => {
          // 服务端回的那份整个换掉，不在前端拼一份「应该长这样」
          if (result?.project) setResult((cur) => cur && { ...cur, projects: cur.projects.map((p) => (p.id === result.project.id ? result.project : p)) });
          setToast({ text: result?.project?.collections?.length ? `已放进 ${result.project.collections.length} 个合集` : "已移出全部合集" });
          onChanged?.();
        }}
      />
      <Toast text={toast?.text} detail={toast?.detail} onUndo={toast?.undo} onClose={() => setToast(null)} />
    </>
  );
}
