import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { groupProjects, PROJECT_STAGES, PROJECT_STAGE_META, projectOpenTarget, projectsFrom } from "../lib/content-projects.js";
import { setOpenTarget } from "../lib/open-target.js";
import { CreationDialog } from "../components/CreationDialog.jsx";
import { Empty, ErrorNote, Loading, PageHeader, relTime } from "../components/ui.jsx";
import { IconArrowRight, IconFileText, IconPlus, IconRefresh } from "../components/icons.jsx";

export function Content({ workerReady, onGo, onChanged, onSettings }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [creation, setCreation] = useState(null);

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
  const grouped = useMemo(() => groupProjects(projects), [projects]);
  const visibleStages = stage ? [stage] : PROJECT_STAGES.filter((key) => grouped[key].length);
  const open = (project) => {
    const target = projectOpenTarget(project);
    if (!target) return;
    setOpenTarget(target.view, target.id);
    onGo(target.view, "");
  };

  return (
    <>
      <PageHeader
        eyebrow="CONTENT DESK"
        title="内容"
        desc="不再在选题库和稿件库之间来回找。这里按一篇内容真正走到哪一步，把下一步摆在最前面。"
        aside={
          <>
            {result ? <span className="project-total">{result.total ?? projects.length} 个内容项目</span> : null}
            <button className="icon-btn" onClick={load} disabled={loading || !workerReady} aria-label="刷新内容项目" title="刷新">
              <IconRefresh aria-hidden="true" className={loading ? "spinning" : ""} />
            </button>
            {workerReady ? (
              <button className="btn btn-primary" onClick={() => setCreation("choose")}>
                <IconPlus aria-hidden="true" stroke={2} />新建内容
              </button>
            ) : null}
          </>
        }
      />

      {!workerReady ? (
        <div className="project-setup">
          <strong>先连接内容流水线</strong>
          <p>内容项目由现有选题、稿件和发布记录聚合，不会在本机另存一份。</p>
          <button className="btn" onClick={onSettings}>打开设置</button>
        </div>
      ) : null}

      {error ? (
        <div className="project-error">
          <ErrorNote error={error} what="读取内容项目" onRetry={load} />
          <div className="project-error__legacy">
            <span>兼容期仍可继续使用现有内容。</span>
            <button className="btn btn-sm" onClick={() => onGo("topics", "待写")}>打开旧版选题</button>
            <button className="btn btn-sm" onClick={() => onGo("drafts", "待修改")}>打开旧版稿件</button>
          </div>
        </div>
      ) : null}

      {loading && !result ? <Loading rows={4} /> : null}

      {result ? (
        <>
          <div className="project-stage-filter" aria-label="按阶段筛选">
            <button aria-pressed={!stage} onClick={() => setStage("")}>
              <span>全部</span><b>{projects.length}</b>
            </button>
            {PROJECT_STAGES.map((key) => (
              <button key={key} aria-pressed={stage === key} onClick={() => setStage(stage === key ? "" : key)}>
                <span>{PROJECT_STAGE_META[key].label}</span><b>{result.counts?.[key] ?? grouped[key].length}</b>
              </button>
            ))}
          </div>

          {!projects.length ? (
            <Empty icon={IconFileText}>
              还没有内容项目。新建一篇，或者先去素材里整理一个想法。
            </Empty>
          ) : visibleStages.length ? (
            <div className="project-lanes">
              {visibleStages.map((key) => (
                <ProjectLane key={key} stage={key} projects={grouped[key]} onOpen={open} />
              ))}
            </div>
          ) : (
            <Empty icon={IconFileText}>这一阶段目前没有内容。</Empty>
          )}
        </>
      ) : null}

      <CreationDialog
        open={!!creation}
        preset={creation}
        onClose={() => setCreation(null)}
        onCreated={(draft) => {
          setOpenTarget("drafts", draft.id);
          onChanged?.();
          onGo("drafts", "");
        }}
        onTopicCreated={(topic) => {
          setOpenTarget("topics", topic.id);
          onChanged?.();
          onGo("topics", "");
        }}
      />
    </>
  );
}

function ProjectLane({ stage, projects, onOpen }) {
  const meta = PROJECT_STAGE_META[stage];
  return (
    <section className="project-lane" data-stage={stage}>
      <div className="project-lane__head">
        <span className="project-lane__index">{meta.index}</span>
        <div>
          <h2>{stage}</h2>
          <p>{meta.hint}</p>
        </div>
        <span className="project-lane__count">{projects.length}</span>
      </div>
      <div className="project-lane__cards">
        {projects.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => onOpen(project)} />)}
      </div>
    </section>
  );
}

export function ProjectCard({ project, onOpen, compact = false }) {
  const canOpen = !!projectOpenTarget(project);
  const blockers = Array.isArray(project.blockers) ? project.blockers : [];
  return (
    <article className={`project-card${compact ? " project-card--compact" : ""}`} data-stage={project.stage}>
      <div className="project-card__top">
        <span className="project-card__stage">{project.stage}</span>
        <time>{relTime(project.updatedAt)}</time>
      </div>
      <h3>{project.title || "未命名内容"}</h3>
      {project.stageReason ? <p className="project-card__reason">{project.stageReason}</p> : null}
      {blockers.length ? (
        <div className="project-card__blocker" role="status">{blockers[0]}</div>
      ) : null}
      <div className="project-card__next">
        <span><small>下一步</small>{project.nextAction || "检查项目状态"}</span>
        <button className="project-card__go" onClick={onOpen} disabled={!canOpen} aria-label={`打开：${project.title || "未命名内容"}`}>
          <IconArrowRight aria-hidden="true" stroke={1.8} />
        </button>
      </div>
    </article>
  );
}
