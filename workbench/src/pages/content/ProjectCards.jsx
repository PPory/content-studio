import { RowDelete, StatePill, relTime } from "../../components/ui.jsx";
import { IconAlertTriangle, IconFolder } from "../../components/icons.jsx";

/** 同一份内容、同一组操作；卡片只改变阅读布局。 */
export function ProjectCards({ projects, onOpen, onRemove, onFile }) {
  return <div className="content-card-grid" aria-label="全部内容项目">
    {projects.map((project) => {
      const title = project.title || "未命名内容";
      const collections = project.collections || [];
      const blocker = project.blockers?.[0];
      return <article className="content-card" key={project.id}>
        <button className="content-card__open" onClick={() => onOpen(project)} aria-label={`打开「${title}」`}>
          <span className="content-card__meta"><StatePill state={project.stage} /><time>{relTime(project.updatedAt)}</time></span>
          <h2 title={title}>{title}</h2>
          {blocker ? <span className="content-card__blocker"><IconAlertTriangle size={13} aria-hidden="true" />{blocker}</span> : null}
          <span className="content-card__details">
            {project.brief?.platform ? <span>{project.brief.platform}</span> : null}
            {project.materials?.length ? <span>{project.materials.length} 份素材</span> : null}
            {collections.length ? <span className="content-card__collections" title={collections.map(item => item.title).join(" · ")}><IconFolder size={13} aria-hidden="true" />{collections.map(item => item.title).join(" · ")}</span> : null}
          </span>
        </button>
        <footer className="content-card__actions">
          <button className="btn btn-sm content-card__file" onClick={() => onFile(project)} aria-label={`把「${title}」放进合集`}><IconFolder size={14} aria-hidden="true" />{collections.length ? "管理合集" : "放进合集"}</button>
          <span className="content-card__remove"><RowDelete onDelete={() => onRemove(project)} label="删掉整篇" title={`删除「${title}」——连同它底下的稿子一起移入回收站，可恢复`} /></span>
        </footer>
      </article>;
    })}
  </div>;
}
