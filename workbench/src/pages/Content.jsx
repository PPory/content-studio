import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { actionableProjects, groupProjects, PROJECT_STAGES, PROJECT_STAGE_META, projectOpenTarget, projectsFrom } from "../lib/content-projects.js";
import { CreationDialog, MODES } from "../components/CreationDialog.jsx";
import { Empty, ErrorNote, Loading, PageHeader, relTime , MenuButton} from "../components/ui.jsx";
import { IconFileText, IconLayoutGrid, IconLayoutKanban, IconPlus, IconRefresh } from "../components/icons.jsx";
import { ProjectCard } from "../components/ProjectCard.jsx";
import { ProjectTable } from "./content/ProjectTable.jsx";
import { ProjectBoard } from "./content/ProjectBoard.jsx";

export function Content({ workerReady, onGo, onChanged, onSettings }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [creation, setCreation] = useState(null);
  const [layout, setLayout] = useState("list");
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState(null);

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
  /** 筛了阶段就只看那一档，否则全量。表格是「全集」那一侧，不分组。 */
  const shown = useMemo(() => (stage ? grouped[stage] || [] : projects), [stage, grouped, projects]);
  /** 顶上那三张：和今日页同一个优先级（需处理 → 待发布 → 写作中 → 待复盘 → 策划中） */
  const attention = useMemo(() => actionableProjects(projects, 3), [projects]);
  /**
   * 看板列。⚠️ **只画能落脚的那几档**：九个阶段全铺出来的话，一屏横着排九列，
   * 而 `已完成` / `生成中` 这两档要么是终点、要么是流水线自己在跑，拖不进去也拖不出来。
   * `已搁置` 留着——它是 `abandon` 的落点，真掉进去的项目得看得见。
   */
  const boardStages = ["策划中", "写作中", "待发布", "已搁置"];

  /**
   * 拖一张卡到另一列 = 推进阶段。
   *
   * ⚠️ **先本地挪，失败再挪回来**（乐观更新）：这条链路要打一次 Worker，
   * 而拖拽的手感要求松手就动——转半秒圈再跳的话，人会以为没拖成功又拖一次。
   * ⚠️ **失败必须把卡挪回原位并说出来**，不能只把错误吞掉：
   * 卡留在新列上而库里还是旧状态，是「界面和数据安静地分叉」，
   * 而这个项目里那种错一次都没被及时发现过。
   */
  const move = useCallback(async (project, command, toStage) => {
    setMoving(true);
    setMoveError(null);
    const before = project.stage;
    setResult((r) => r && { ...r, projects: r.projects.map((p) => (p.id === project.id ? { ...p, stage: toStage } : p)) });
    try {
      const r = await api.transitionProject(project.id, command);
      // 拿服务端回的那份**整个换掉**，不在前端拼一份「应该长这样」——
      // 推进会连带改 nextAction / blockers / masterDraft，前端算不出来
      if (r?.project) setResult((cur) => cur && { ...cur, projects: cur.projects.map((p) => (p.id === project.id ? r.project : p)) });
      else load();
      onChanged?.();
    } catch (e) {
      setResult((cur) => cur && { ...cur, projects: cur.projects.map((p) => (p.id === project.id ? { ...p, stage: before } : p)) });
      setMoveError(e);
    } finally {
      setMoving(false);
    }
  }, [load, onChanged]);
  const open = (project) => {
    const target = projectOpenTarget(project);
    if (!target) return;
    onGo(target.view, target.id);
  };

  return (
    <>
      <PageHeader
        title="内容"
        desc="不再在选题库和稿件库之间来回找。这里按一篇内容真正走到哪一步，把下一步摆在最前面。"
        aside={
          <>
            {result ? <span className="project-total">{result.total ?? projects.length} 个内容项目</span> : null}
            <button className="icon-btn" onClick={load} disabled={loading || !workerReady} aria-label="刷新内容项目" title="刷新">
              <IconRefresh aria-hidden="true" className={loading ? "spinning" : ""} />
            </button>
            {workerReady ? (
              <MenuButton
                label="新建内容"
                icon={IconPlus}
                items={MODES.map((m) => ({ key: m.key, icon: m.icon, title: m.title, hint: m.hint, onPick: () => setCreation(m.key) }))}
              />
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
            <button className="btn btn-sm" onClick={() => onGo("drafts", "写作中")}>打开稿件库</button>
          </div>
        </div>
      ) : null}

      {loading && !result ? <Loading rows={4} /> : null}

      {result ? (
        <>
          {/**
            * 顶上「需要你处理的」：**最多三张卡**。
            * 判据和今日页那三张同一条——卡片给「要动手的少数」，全集走下面那张表。
            * ⚠️ **筛了阶段就不画**：筛选之后「需要你处理的」和下面的表是同一批东西，
            * 上下两遍说同一件事。
            */}
          {!stage && attention.length ? (
            <section className="project-attention">
              <h2 className="section-label">需要你处理的</h2>
              <div className="act-cards">
                {attention.map((p) => (
                  <ProjectCard key={p.id} project={p} onOpen={() => open(p)} />
                ))}
              </div>
            </section>
          ) : null}

          {/* 筛选条 + 视图切换并排一行（和选题库、稿件库那条 `.list-bar` 一套语汇） */}
          <div className="list-bar">
            <div className="chips chips-sm" aria-label="按阶段筛选">
              <button className="chip" aria-pressed={!stage} onClick={() => setStage("")}>全部 {projects.length}</button>
              {PROJECT_STAGES.filter((key) => (result.counts?.[key] ?? grouped[key].length) > 0 || stage === key).map((key) => (
                <button key={key} className="chip" aria-pressed={stage === key} onClick={() => setStage(stage === key ? "" : key)}>
                  {PROJECT_STAGE_META[key].label} {result.counts?.[key] ?? grouped[key].length}
                </button>
              ))}
            </div>
            <div className="list-tools">
              <div className="seg" role="group" aria-label="视图">
                <button aria-pressed={layout === "board"} onClick={() => setLayout("board")} title="看板：拖一张卡就是推进阶段">
                  <IconLayoutKanban aria-hidden="true" stroke={1.7} />看板
                </button>
                <button aria-pressed={layout === "list"} onClick={() => setLayout("list")} title="列表：一屏扫完全部">
                  <IconLayoutGrid aria-hidden="true" stroke={1.7} />列表
                </button>
              </div>
            </div>
          </div>

          <ErrorNote error={moveError} what="推进阶段" />

          {!projects.length ? (
            <Empty icon={IconFileText}>
              还没有内容项目。新建一篇，或者先去素材里整理一个想法。
            </Empty>
          ) : layout === "board" ? (
            <ProjectBoard
              stages={boardStages}
              grouped={grouped}
              onOpen={open}
              onMove={move}
              busy={moving}
            />
          ) : shown.length ? (
            <ProjectTable projects={shown} onOpen={open} />
          ) : (
            <Empty icon={IconFileText}>这一阶段目前没有内容。</Empty>
          )}
        </>
      ) : null}

      <CreationDialog
        open={!!creation}
        preset={creation}
        onClose={() => setCreation(null)}
        onCreated={(draft, project) => {
          onChanged?.();
          onGo("project", project?.id || draft.topicId);
        }}
        onTopicCreated={(topic, project) => {
          onChanged?.();
          onGo("project", project?.id || topic.id);
        }}
      />
    </>
  );
}
