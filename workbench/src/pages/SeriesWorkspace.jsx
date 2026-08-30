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

const emptyChapter = { title: "", summary: "" };

export function SeriesWorkspace({ seriesId, onGo, onChanged }) {
  const [series, setSeries] = useState(null);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", audience: "", outcome: "" });
  const [chapterForm, setChapterForm] = useState(emptyChapter);
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");

  const accept = useCallback((next) => {
    setSeries(next);
    setForm({ title: next.title, description: next.description, audience: next.audience, outcome: next.outcome });
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

  const dirty = series && ["title", "description", "audience", "outcome"].some((key) => form[key] !== series[key]);

  async function saveSeries() {
    if (!dirty || busy || !form.title.trim()) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await api.updateSeries(seriesId, form);
      accept(result.series);
      setNotice("系列总纲已保存");
      onChanged?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function addChapter() {
    if (!chapterForm.title.trim() || busy) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await api.addSeriesChapter(seriesId, chapterForm);
      accept(result.series);
      setChapterForm(emptyChapter);
      setAdding(false);
      setNotice("章节已加入目录，还没有创建文章");
      onChanged?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function moveChapter(chapterId, direction) {
    if (busy) return;
    const ids = series.chapters.map((chapter) => chapter.id);
    const from = ids.indexOf(chapterId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await api.reorderSeriesChapters(seriesId, ids);
      accept(result.series);
      setNotice("章节顺序已更新");
      onChanged?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function startChapter(chapter) {
    if (busy) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const profile = await api.writingProfile().then((value) => value.profile).catch(() => ({ platform: "公众号" }));
      const result = await api.startSeriesChapter(seriesId, chapter.id, profile.platform || "公众号");
      onChanged?.();
      onGo("project", result.projectId);
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  }

  async function linkProject(chapter, projectId) {
    if (busy) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await api.linkSeriesChapter(seriesId, chapter.id, projectId);
      accept(result.series);
      setLinking(null);
      setNotice("已有文章已加入这个章节");
      onChanged?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !series) return <div className="series-workspace-load"><Loading rows={5} /></div>;
  if (!series) return <div className="series-workspace-load"><button className="btn btn-sm" onClick={() => onGo("series")}><IconArrowLeft aria-hidden="true" />返回系列</button><ErrorNote error={error} what="读取系列教程" onRetry={load} /></div>;

  return (
    <div className="series-workspace">
      <header className="series-bar">
        <button className="project-back" onClick={() => onGo("series")}><IconArrowLeft aria-hidden="true" />系列</button>
        <span className="series-bar__progress">已发布 {series.progress.published}/{series.progress.total}</span>
        <span className="series-bar__line" aria-hidden="true"><i style={{ width: `${series.progress.percent}%` }} /></span>
        <div className="series-bar__end">
          {notice ? <span className="project-notice">{notice}</span> : null}
          <button className="btn" onClick={saveSeries} disabled={!dirty || busy || !form.title.trim()}>{busy && dirty ? <IconLoader2 className="spin" aria-hidden="true" /> : null}保存总纲</button>
        </div>
      </header>

      <div className="series-workspace__body">
        <section className="series-brief" aria-label="系列总纲">
          <span className="eyebrow">SERIES BRIEF</span>
          <label className="series-title-field"><span>系列名称</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} maxLength="120" /></label>
          <div className="series-brief__grid">
            <label className="field"><span>目标读者</span><input value={form.audience} onChange={(event) => setForm((current) => ({ ...current, audience: event.target.value }))} maxLength="200" placeholder="这套教程写给谁" /></label>
            <label className="field"><span>完成后能做到什么</span><textarea value={form.outcome} onChange={(event) => setForm((current) => ({ ...current, outcome: event.target.value }))} maxLength="500" placeholder="读完整套之后获得的结果" /></label>
            <label className="field series-brief__wide"><span>范围与说明</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength="2000" placeholder="这套教程包含什么，不包含什么" /></label>
          </div>
        </section>

        <section className="series-outline" aria-labelledby="series-outline-title">
          <div className="series-section-head">
            <div><span className="eyebrow">OUTLINE</span><h2 id="series-outline-title">章节目录</h2></div>
            <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={adding || busy}><IconPlus aria-hidden="true" />添加章节</button>
          </div>
          <p className="series-outline__hint">先把逻辑顺序排清楚。只有点“开始写”或关联已有文章后，章节才会成为单篇内容项目。</p>

          <div className="series-chapters">
            {series.chapters.map((chapter, index) => (
              <article className="series-chapter" key={chapter.id}>
                <span className="series-chapter__number">{String(index + 1).padStart(2, "0")}</span>
                <div className="series-chapter__body">
                  <div className="series-chapter__title"><strong>{chapter.title}</strong><span data-stage={chapter.stage}>{chapter.stage}</span></div>
                  {chapter.summary ? <p>{chapter.summary}</p> : null}
                  {chapter.projectId && chapter.projectTitle !== chapter.title ? <small>文章标题：{chapter.projectTitle}</small> : null}
                </div>
                <div className="series-chapter__order" aria-label={`调整“${chapter.title}”的顺序`}>
                  <button className="icon-btn" onClick={() => moveChapter(chapter.id, -1)} disabled={busy || index === 0} aria-label="上移"><IconArrowUp aria-hidden="true" /></button>
                  <button className="icon-btn" onClick={() => moveChapter(chapter.id, 1)} disabled={busy || index === series.chapters.length - 1} aria-label="下移"><IconArrowDown aria-hidden="true" /></button>
                </div>
                <div className="series-chapter__actions">
                  {chapter.projectId ? (
                    <button className="btn btn-sm" onClick={() => onGo("project", chapter.projectId)}><IconFileText aria-hidden="true" />打开文章</button>
                  ) : chapter.linkedProjectId ? (
                    <button className="btn btn-sm" disabled><IconFileText aria-hidden="true" />文章在回收站</button>
                  ) : <>
                    <button className="btn btn-sm" onClick={() => setLinking(chapter)} disabled={busy}><IconLink aria-hidden="true" />关联已有文章</button>
                    <button className="btn btn-sm btn-primary" onClick={() => startChapter(chapter)} disabled={busy}>{busy ? null : <IconPlus aria-hidden="true" />}开始写</button>
                  </>}
                </div>
              </article>
            ))}

            {adding ? (
              <div className="series-chapter-add">
                <label className="field"><span>章节标题</span><input data-autofocus="" value={chapterForm.title} onChange={(event) => setChapterForm((current) => ({ ...current, title: event.target.value }))} maxLength="120" placeholder="这一篇解决什么问题" /></label>
                <label className="field"><span>章节作用（可选）</span><textarea value={chapterForm.summary} onChange={(event) => setChapterForm((current) => ({ ...current, summary: event.target.value }))} maxLength="500" placeholder="它与前后章节怎样衔接" /></label>
                <footer><button className="btn btn-sm" onClick={() => { setAdding(false); setChapterForm(emptyChapter); }} disabled={busy}>取消</button><button className="btn btn-sm btn-primary" onClick={addChapter} disabled={busy || !chapterForm.title.trim()}>{busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}加入目录</button></footer>
              </div>
            ) : null}

            {!series.chapters.length && !adding ? <div className="series-outline__empty">目录还是空的。先添加章节，只规划标题也可以。</div> : null}
          </div>
        </section>
        <ErrorNote error={error} what="更新系列教程" />
      </div>

      <ProjectLinkDialog open={Boolean(linking)} chapter={linking} projects={projects} busy={busy} onClose={() => setLinking(null)} onLink={(projectId) => linkProject(linking, projectId)} />
    </div>
  );
}

function ProjectLinkDialog({ open, chapter, projects, busy, onClose, onLink }) {
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
      <section className="modal series-link" role="dialog" aria-modal="true" aria-label="关联已有文章" ref={boxRef}>
        <header className="series-create__head"><div><span className="eyebrow">LINK ARTICLE</span><h2>关联到“{chapter.title}”</h2></div><button className="icon-btn" onClick={onClose} disabled={busy} aria-label="关闭"><IconX aria-hidden="true" /></button></header>
        <label className="field"><span>搜索文章</span><input data-autofocus="" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入标题或核心观点" /></label>
        <div className="series-link__list">
          {available.map((project) => <button key={project.id} type="button" onClick={() => onLink(project.id)} disabled={busy}><span><strong>{project.title}</strong><small>{project.brief?.viewpoint || "没有填写核心观点"}</small></span><em>{project.stage}</em></button>)}
          {!available.length ? <p>没有可关联的文章。已经属于其他系列的文章不会出现在这里。</p> : null}
        </div>
      </section>
    </div>
  );
}
