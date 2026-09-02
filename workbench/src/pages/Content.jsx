import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { byActionPriority, groupProjects, PROJECT_STAGES, PROJECT_STAGE_META, projectOpenTarget, projectsFrom } from "../lib/content-projects.js";
import { NewContentButton } from "../components/NewContentButton.jsx";
import { Empty, ErrorNote, Loading, PageHeader, Toast } from "../components/ui.jsx";
import { IconFileText, IconLayoutGrid, IconLayoutKanban, IconRefresh } from "../components/icons.jsx";
import { ProjectTable } from "./content/ProjectTable.jsx";
import { ProjectBoard } from "./content/ProjectBoard.jsx";
import { SeriesPicker } from "../components/SeriesPicker.jsx";
import "./series.css";

export function Content({ workerReady, onGo, onChanged, onSettings }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState("");
  const [toast, setToast] = useState(null);
  const [stage, setStage] = useState("");
  const [layout, setLayout] = useState("list");
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState(null);
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

  /**
   * Esc 清掉阶段筛选。
   *
   * ⚠️ **筛着的时候才挂监听**，没筛就整个不注册：Esc 是全局最忙的一颗键
   *（关弹窗、关命令面板、清搜索框），多挂一个「什么都不做」的监听器只会让
   * 以后排查「Esc 被谁吃了」时多一个嫌疑人。
   *
   * ⚠️ **三道闸**：弹窗开着时不管（合集选择器自己要用 Esc 关）、
   * 已经被别人处理过的不管（`defaultPrevented`）、焦点在输入类控件里的不管
   *（那儿的 Esc 归清空输入，见 `SearchBox`）。
   */
  useEffect(() => {
    if (!stage || filing) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const el = event.target;
      if (el instanceof HTMLElement && (el.closest("input, textarea, [contenteditable]") || el.closest("dialog"))) return;
      setStage("");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stage, filing]);

  const projects = useMemo(() => projectsFrom(result), [result]);
  const grouped = useMemo(() => groupProjects(projects), [projects]);
  /**
   * 筛了阶段就只看那一档，否则全量。表格是「全集」那一侧，不分组。
   *
   * ⚠️ **排序走 `byActionPriority`，第一行就是最该动的那一篇。**
   * 上一版靠顶上另开三张「需要你处理的」卡来回答这个问题，而那三张卡就是这张表的
   * 第 2/3/4 行——同一批东西在一屏上画了两遍，还各带一套视觉语汇。
   * 把优先级放进排序之后，「先做哪一件」是表本身的第一行，不需要第二个表面。
   */
  const shown = useMemo(
    () => [...(stage ? grouped[stage] || [] : projects)].sort(byActionPriority),
    [stage, grouped, projects],
  );
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

  /**
   * 删掉一个项目会移入本地回收站，并带上所属稿件。
   *
   * ⚠️ **回执要说清删掉了几篇**，不能只说「已删除」——你以为删的是一个壳，
   * 而它可能带走了三篇写过的稿。
   */
  const remove = useCallback(async (p) => {
    if (removing) return;
    setRemoving(p.id);
    try {
      const r = await api.removeProject(p.id);
      setToast({
        text: r.deleted ? `已移入回收站，连同 ${r.deleted} 篇稿子` : "已移入回收站",
      });
      onChanged?.();
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setRemoving("");
    }
  }, [removing, load, onChanged]);

  return (
    <>
      {/**
        * ⚠️ **不传 `desc`。** 页名在外壳页头里已经写着「内容 / 创作」，而那句
        * 「这里按一篇内容真正走到哪一步…」是说给第一次来的人听的，却每天都占着
        * 第一屏最上面一行、把真正的内容往下推。**这一页要解释自己的时候只有一个：
        * 空的时候**——所以那句话搬进了下面的 `Empty`。
        */}
      <PageHeader
        title="创作"
        aside={
          <>
            {result ? <span className="project-total">{result.total ?? projects.length} 个内容项目</span> : null}
            <button className="icon-btn" onClick={load} disabled={loading || !workerReady} aria-label="刷新内容项目" title="刷新">
              <IconRefresh aria-hidden="true" className={loading ? "spinning" : ""} />
            </button>
            {/* 四处共用一颗（`components/NewContentButton.jsx`），别在这儿再拼一份菜单 */}
            {workerReady ? <NewContentButton onGo={onGo} onChanged={onChanged} /> : null}
          </>
        }
      />

      {/**
        * ⚠️ **「全部文章 / 合集」那条切换搬去侧栏了**（`App.jsx` 的 `NAV`，内容底下第三项）。
        * 它是**导航**——两边是两个页面、两套 URL——却长成一排筛选芯片，
        * 而它正下方就是真的筛选芯片：一屏上下两条一模一样的控件，一条换页、一条筛当前页。
        * 换页的东西归侧栏，页内只留筛当前页的那一条。
        */}
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
            * ⚠️ **顶上那组「需要你处理的」卡撤了，别加回来。**
            *
            * 它是三张 `ProjectCard`，取的是 `actionableProjects(projects, 3)`——
            * 而下面那张表**同一批数据一条不落地又画了一遍**，于是屏幕上第 2/3/4 行
            * 和顶上三张卡说的是同一件事，还各带一套视觉语汇（卡片一套、行一套）。
            * 更糟的是卡上那条进度全是 50%：它按 `stage index / 7` 算，
            * 等于把卡上那颗状态 pill 已经说过的阶段换个形状再说一遍。
            *
            * 「先做哪一件」现在由**排序**回答（`byActionPriority`，见上面的 `shown`）：
            * 表的第一行就是它，不需要第二个表面。
            */}

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
            /* ⚠️ 这一页唯一解释自己的地方。页头那句说明撤了，理由写在 `PageHeader` 上面 */
            <Empty icon={IconFileText}>
              这里按一篇内容真正走到哪一步排，最该推进的排在最前面。
              还没有内容项目——新建一篇，或者先去素材里整理一个想法。
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
            <ProjectTable projects={shown} onOpen={open} onRemove={remove} onFile={setFiling} removing={removing} />
          ) : (
            <Empty icon={IconFileText}>这一阶段目前没有内容。</Empty>
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
      <Toast text={toast?.text} onClose={() => setToast(null)} />
    </>
  );
}
