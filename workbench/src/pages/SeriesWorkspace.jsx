import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { useDialog } from "../lib/use-dialog.js";
import { ErrorNote, Loading } from "../components/ui.jsx";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconFileText,
  IconLink,
  IconLoader2,
  IconPlus,
  IconX,
} from "../components/icons.jsx";
import "./series.css";

export function SeriesWorkspace({ seriesId, onGo, onChanged }) {
  const [series, setSeries] = useState(null);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ title: "", description: "" });
  const [linking, setLinking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");

  const accept = useCallback((next) => {
    setSeries(next);
    setForm({ title: next.title, description: next.description });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.series(seriesId), api.projects()])
      .then(([seriesResult, projectsResult]) => {
        accept(seriesResult.series);
        setProjects(projectsResult.projects || []);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [seriesId, accept]);

  useEffect(load, [load]);

  const dirty = series && (form.title !== series.title || form.description !== series.description);

  async function saveCollection() {
    if (!dirty || busy || !form.title.trim()) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await api.updateSeries(seriesId, {
        ...form,
        audience: series.audience || "",
        outcome: series.outcome || "",
      });
      accept(result.series);
      setNotice("合集信息已保存");
      onChanged?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function moveItem(itemId, direction) {
    if (busy) return;
    const ids = series.chapters.map((item) => item.id);
    const from = ids.indexOf(itemId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await api.reorderSeriesChapters(seriesId, ids);
      accept(result.series);
      setNotice("文章顺序已更新");
      onChanged?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function addProject(projectId) {
    if (busy || !linking) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const result = linking.id
        ? await api.linkSeriesChapter(seriesId, linking.id, projectId)
        : await api.addProjectToSeries(seriesId, projectId);
      accept(result.series);
      setProjects((current) => current.map((project) => project.id === projectId ? { ...project, series: { id: seriesId } } : project));
      setLinking(null);
      setNotice("文章已加入合集");
      onChanged?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    if (busy) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const profile = await api.writingProfile().then((value) => value.profile).catch(() => ({ platform: "公众号", audience: "" }));
      const result = await api.createProjectInSeries(seriesId, {
        platform: profile.platform || "公众号",
        audience: profile.audience || "",
      });
      onChanged?.();
      onGo("project", result.projectId);
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  }

  async function removeItem(item) {
    if (busy || !window.confirm(`把“${item.projectTitle || item.title}”移出这个合集？文章本身不会删除。`)) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await api.removeSeriesChapter(seriesId, item.id);
      accept(result.series);
      setProjects((current) => current.map((project) => project.id === item.projectId ? { ...project, series: null } : project));
      setNotice("已移出合集，文章仍保留在全部文章中");
      onChanged?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !series) return <div className="series-workspace-load"><Loading rows={5} /></div>;
  if (!series) return <div className="series-workspace-load"><button className="btn btn-sm" onClick={() => onGo("series")}><IconArrowLeft aria-hidden="true" />返回合集</button><ErrorNote error={error} what="读取合集" onRetry={load} /></div>;

  return (
    <div className="series-workspace">
      <header className="series-bar">
        <button className="project-back" onClick={() => onGo("series")}><IconArrowLeft aria-hidden="true" />合集</button>
        <span className="series-bar__progress">{series.chapters.length} 篇文章</span>
        <div className="series-bar__end">
          {notice ? <span className="project-notice">{notice}</span> : null}
          <button className="btn" onClick={saveCollection} disabled={!dirty || busy || !form.title.trim()}>{busy && dirty ? <IconLoader2 className="spin" aria-hidden="true" /> : null}保存合集</button>
        </div>
      </header>

      <div className="series-workspace__body">
        <section className="series-brief" aria-label="合集信息">
          <span className="eyebrow">COLLECTION</span>
          <label className="series-title-field"><span>合集名称</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} maxLength="120" /></label>
          <label className="field series-brief__description"><span>合集说明</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength="2000" placeholder="这个合集收录什么内容" /></label>
        </section>

        <section className="series-outline" aria-labelledby="collection-items-title">
          <div className="series-section-head">
            <div><span className="eyebrow">ARTICLES</span><h2 id="collection-items-title">合集文章</h2></div>
            <div className="series-section-actions">
              <button className="btn" onClick={() => setLinking({ id: "", title: "" })} disabled={busy}><IconLink aria-hidden="true" />添加已有文章</button>
              <button className="btn btn-primary" onClick={createProject} disabled={busy}>{busy ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconPlus aria-hidden="true" />}在合集中新建</button>
            </div>
          </div>
          <p className="series-outline__hint">合集只负责归类。打开文章后，仍然按原来的方式写作、发布和复盘。</p>

          <div className="series-chapters">
            {series.chapters.map((item, index) => {
              const title = item.projectTitle || item.title;
              return (
                <article className="series-chapter" key={item.id}>
                  <span className="series-chapter__number">{String(index + 1).padStart(2, "0")}</span>
                  <div className="series-chapter__body">
                    <div className="series-chapter__title"><strong>{title}</strong><span data-stage={item.stage}>{item.stage}</span></div>
                    {item.summary ? <p>{item.summary}</p> : null}
                  </div>
                  <div className="series-chapter__order" aria-label={`调整“${title}”的顺序`}>
                    <button className="icon-btn" onClick={() => moveItem(item.id, -1)} disabled={busy || index === 0} aria-label="上移"><IconArrowUp aria-hidden="true" /></button>
                    <button className="icon-btn" onClick={() => moveItem(item.id, 1)} disabled={busy || index === series.chapters.length - 1} aria-label="下移"><IconArrowDown aria-hidden="true" /></button>
                  </div>
                  <div className="series-chapter__actions">
                    {item.projectId ? <button className="btn btn-sm" onClick={() => onGo("project", item.projectId)}><IconFileText aria-hidden="true" />打开文章</button>
                      : item.linkedProjectId ? <button className="btn btn-sm" disabled><IconFileText aria-hidden="true" />文章在回收站</button>
                        : <button className="btn btn-sm" onClick={() => setLinking(item)} disabled={busy}><IconLink aria-hidden="true" />选择文章</button>}
                    <button className="btn btn-sm series-chapter__remove" onClick={() => removeItem(item)} disabled={busy}>移出合集</button>
                  </div>
                </article>
              );
            })}
            {!series.chapters.length ? <div className="series-outline__empty">这个合集还是空的。添加已有文章，或者直接新建一篇。</div> : null}
          </div>
        </section>
        <ErrorNote error={error} what="更新合集" />
      </div>

      <ProjectLinkDialog open={Boolean(linking)} item={linking} projects={projects} busy={busy} onClose={() => setLinking(null)} onLink={addProject} />
    </div>
  );
}

function ProjectLinkDialog({ open, item, projects, busy, onClose, onLink }) {
  const [query, setQuery] = useState("");
  const boxRef = useDialog(open, onClose, { autoFocus: true });
  useEffect(() => { if (open) setQuery(""); }, [open]);
  const available = useMemo(() => {
    const term = query.trim().toLowerCase();
    return projects.filter((project) => !project.series && (!term || `${project.title}\n${project.brief?.viewpoint || ""}`.toLowerCase().includes(term)));
  }, [projects, query]);
  if (!open) return null;
  return (
    <div className="scrim scrim--center" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="modal series-link" role="dialog" aria-modal="true" aria-label="添加文章到合集" ref={boxRef}>
        <header className="series-create__head"><div><span className="eyebrow">ADD ARTICLE</span><h2>{item?.id ? `为“${item.title}”选择文章` : "添加文章到合集"}</h2></div><button className="icon-btn" onClick={onClose} disabled={busy} aria-label="关闭"><IconX aria-hidden="true" /></button></header>
        <label className="field"><span>搜索文章</span><input data-autofocus="" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入标题或核心观点" /></label>
        <div className="series-link__list">
          {available.map((project) => <button key={project.id} type="button" onClick={() => onLink(project.id)} disabled={busy}><span><strong>{project.title}</strong><small>{project.brief?.viewpoint || "没有填写核心观点"}</small></span><em>{project.stage}</em></button>)}
          {!available.length ? <p>没有可添加的文章。已经属于其他合集的文章不会出现在这里。</p> : null}
        </div>
      </section>
    </div>
  );
}
