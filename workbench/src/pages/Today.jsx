import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { actionableProjects, projectOpenTarget, projectsFrom } from "../lib/content-projects.js";
import { setOpenTarget } from "../lib/open-target.js";
import { CreationDialog } from "../components/CreationDialog.jsx";
import { ErrorNote, Loading, PageHeader } from "../components/ui.jsx";
import { IconArrowRight, IconPlus } from "../components/icons.jsx";
import { DayPlan, usePlan } from "./Overview.jsx";
import { ProjectCard } from "./Content.jsx";

export function Today({ config, status, statusError, statusLoading, onRetryStatus, onGo, onChanged, onSettings }) {
  const workerReady = config?.worker?.configured;
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [creation, setCreation] = useState(null);
  const plan = usePlan(config?.vault?.configured);

  const load = useCallback(() => {
    if (!workerReady) return;
    api.projects().then((data) => { setResult(data); setError(null); }).catch(setError);
  }, [workerReady]);
  useEffect(load, [load, status?.ts]);

  const projects = useMemo(() => projectsFrom(result), [result]);
  const allActions = useMemo(() => actionableProjects(projects, projects.length), [projects]);
  const actions = allActions.slice(0, 4);
  const focus = actions[0];
  const rest = actions.slice(1);
  const pending = allActions.length;
  const open = (project) => {
    const target = projectOpenTarget(project);
    if (!target) return;
    setOpenTarget(target.view, target.id);
    onGo(target.view, "");
  };

  return (
    <>
      <PageHeader
        eyebrow="TODAY"
        title="今天"
        desc="先推进一篇，再处理其他。系统状态退到后面，真正等你决定的事情排在前面。"
        aside={
          <>
            {result ? <span className="project-total">{pending ? `${pending} 件事等你` : "今天没有内容待办"}</span> : null}
            {workerReady ? <button className="btn btn-primary" onClick={() => setCreation("choose")}><IconPlus aria-hidden="true" />新建内容</button> : null}
          </>
        }
      />

      {!workerReady ? (
        <div className="project-setup">
          <strong>先连接内容流水线</strong>
          <p>连接后，这里会把最值得继续的一篇直接放到你面前。</p>
          <button className="btn" onClick={onSettings}>打开设置</button>
        </div>
      ) : null}

      <ErrorNote error={statusError} what="读取流水线状态" onRetry={onRetryStatus} />
      {workerReady && error ? <ErrorNote error={error} what="读取今日内容" onRetry={load} /> : null}
      {workerReady && !result && !error ? <Loading rows={3} /> : null}

      {result ? (
        <section className="today-focus">
          <div className="today-focus__head">
            <div><span className="eyebrow">先做这一件</span><h2>{focus ? "接着推进" : "今天可以从容一点"}</h2></div>
            <button className="today-focus__all" onClick={() => onGo("content")}>
              查看全部内容 <IconArrowRight aria-hidden="true" />
            </button>
          </div>
          {focus ? (
            <div className="today-focus__grid">
              <ProjectCard project={focus} onOpen={() => open(focus)} />
              <div className="today-queue">
                <span className="eyebrow">接下来</span>
                {rest.length ? rest.map((project, index) => (
                  <button key={project.id} className="today-queue__row" onClick={() => open(project)}>
                    <span className="today-queue__num">0{index + 2}</span>
                    <span><b>{project.title || "未命名内容"}</b><small>{project.stage} · {project.nextAction}</small></span>
                    <IconArrowRight aria-hidden="true" />
                  </button>
                )) : <p className="today-queue__empty">没有其他内容在催你。把这一篇往前推一步就够了。</p>}
              </div>
            </div>
          ) : (
            <div className="today-clear">
              <p>没有正在推进或等待复盘的内容。</p>
              <button className="btn" onClick={() => setCreation("choose")}>开始一篇新的</button>
            </div>
          )}
        </section>
      ) : null}

      <DayPlan plan={plan} />

      {status ? (
        <section className="today-background" aria-label="后台流水线状态">
          <span>后台</span>
          <button onClick={() => onGo("inbox", "待初筛")}>待初筛 <b>{status.counts?.待初筛 ?? 0}</b></button>
          <button onClick={() => onGo("inbox", "待选题")}>待整理 <b>{status.counts?.待整理 ?? 0}</b></button>
          <button onClick={() => onGo("topics", "撰写中")}>生成中 <b>{status.counts?.选题撰写中 ?? 0}</b></button>
          {statusLoading ? <small>刷新中…</small> : <small>这些由流水线自己处理</small>}
        </section>
      ) : null}

      <CreationDialog
        open={!!creation}
        preset={creation}
        onClose={() => setCreation(null)}
        onCreated={(draft) => { setOpenTarget("drafts", draft.id); onChanged?.(); onGo("drafts", ""); }}
        onTopicCreated={(topic) => { setOpenTarget("topics", topic.id); onChanged?.(); onGo("topics", ""); }}
      />
    </>
  );
}
