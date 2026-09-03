import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { actionableProjects, projectOpenTarget, projectsFrom } from "../lib/content-projects.js";
import { NewContentButton } from "../components/NewContentButton.jsx";
import { ErrorNote, Loading, PageHeader } from "../components/ui.jsx";
import { LaneBoard } from "./today/LaneBoard.jsx";
import { TodayChart } from "./today/TodayChart.jsx";
import { RecentPosts } from "./today/RecentPosts.jsx";
import { IconArrowRight } from "../components/icons.jsx";
// ⚠️ **从 `components/` 引，不是从 `./Content.jsx`。** 页面 import 另一个页面
// 是这个项目明令禁止的——现状原来是破的，这一轮顺手修了。
import { ProjectCard } from "../components/ProjectCard.jsx";

export function Today({ status, statusError, statusLoading, onRetryStatus, onGo, onChanged }) {
  const localReady = true;
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  /** 四条链的值班台。它和项目各自独立取——一条挂了不该把另一条也拖黑。 */
  const [lanes, setLanes] = useState(null);

  const load = useCallback(() => {
    api.projects().then((data) => { setResult(data); setError(null); }).catch(setError);
  }, []);
  useEffect(load, [load, status?.ts]);
  useEffect(() => { api.lanes().then(setLanes).catch(() => setLanes(null)); }, [status?.ts]);

  const projects = useMemo(() => projectsFrom(result), [result]);
  const allActions = useMemo(() => actionableProjects(projects, projects.length), [projects]);
  /**
   * ⚠️ **顶上最多三张，多的收进一句「还有 N 篇」。**
   * 卡片是给「要动手的少数」的（判据见 design-system「什么时候用卡片」）；
   * 没有上限的话它就退化成第二个卡片墙，而全集本来就在「内容」那一页。
   */
  const actions = allActions.slice(0, 3);
  const pending = allActions.length;
  const overflow = Math.max(0, pending - actions.length);
  const open = (project) => {
    const target = projectOpenTarget(project);
    if (!target) return;
    onGo(target.view, target.id);
  };

  return (
    <>
      <PageHeader
        title="今天"
        aside={
          <>
            {/* ⚠️ 这个数按**四条链**报，不再只报内容项目。
                下面第一块就是四条链，右上角却只说内容那一条，两个数会互相拆台。 */}
            {lanes ? (
              <span className="project-total">
                {lanes.busy ? `${lanes.busy} 条链有事` : "四条链现在都没事"}
              </span>
            ) : null}
            {/**
              * ⚠️ **四个页面共用同一颗 `NewContentButton`。**
              * 这儿原来是 `MODES.map(...)` + 一份 `onCreated` 跳转，
              * 而内容页 / 素材工作台 / 旧总览各有逐行相同的一份——
              * 改一条起点的走法要改四处，漏掉一处不报错。
              */}
            <NewContentButton onGo={onGo} onChanged={onChanged} />
          </>
        }
      />

      <ErrorNote error={statusError} what="读取本地工作区状态" onRetry={onRetryStatus} />
      {error ? <ErrorNote error={error} what="读取今日内容" onRetry={load} /> : null}
      {!result && !error ? <Loading rows={3} /> : null}

      {/**
        * ⚠️ **KPI 那一排在最上面，早于「先做这一件」。**
        * 它回答的是**「我现在处在什么状态」**，而下面那些回答**「接下来做什么」**——
        * 状态在前、动作在后，是因为同一件事该不该做，取决于它前面那几个数。
        * 四个数分属四条不同的链（产出 / 待办 / 库存 / 反馈），见 `TodayStats`。
        */}
      {/**
        * ⚠️ **这四张卡取代了原来那排 KPI 卡**（本月发布 / 等你动手 / 可用素材 / 粉丝）。
        * 那四个数本来就分属四条链——`TodayStats` 的注释自己写着这件事——
        * 但它们给的是**不动的数字**：「等你动手 6 件」看完之后，你还得自己想
        * 「那我现在点哪儿」。而值班台每一格自己就带着数字和下一步，
        * 状态和动作在卡内是并排的。同一批东西显示两遍，是让人读两次再自己合并。
        */}
      <LaneBoard data={lanes} onGo={onGo} />

      {result ? (
        <section className="today-focus">
          <div className="today-focus__head">
            {/* ⚠️ 区块标题**一行就够**。上一版是「眉标 + 21px 大标题」两行，
                而它上面已经有一排数字卡、下面就是卡片——中间夹两行标题是在
                替一屏最不需要解释的东西占地方 */}
            <h2 className="section-label">{actions.length ? "先做这一件" : "今天可以从容一点"}</h2>
            <button className="today-focus__all" onClick={() => onGo("content")}>
              查看全部内容 <IconArrowRight aria-hidden="true" />
            </button>
          </div>
          {actions.length ? (
            <>
              {/**
                * ⚠️ **三张一模一样，第一张不描边。**
                * 上一版是「左边一张 278px 的大卡 + 右边三行小条」，两个毛病：
                * 大卡里只有三四行字，**中段大片留白**；而右边那三条只剩标题和一句
                * 「阶段 · 下一步」，同一批数据在一屏上有了两种详略，扫的时候得切换两次读法。
                *
                * 后来给第一张加过一道重边框，也撤了：卡片本来就按优先级排序，
                * 第一张就在第一个位置、上面顶着「先做这一件」——**边框是同一件事说第三遍**，
                * 而它是这一屏里最重的一道线，看着像那张卡被选中了。
                */}
              {/**
                * ⚠️ **卡片和图并排，不是上下堆。**
                * 「先做这一件」和「最近产出稳不稳」是**同一个问题的两半**：
                * 该不该现在推这一篇，取决于这个月已经发了几篇。上下堆的话，
                * 得滚一屏才能把两半凑起来——而这一页的全部意义就是一眼看完。
                */}
              <div className="today-split">
                <div className="act-cards">
                  {actions.map((project) => (
                    <ProjectCard key={project.id} project={project} onOpen={() => open(project)} />
                  ))}
                </div>
                <TodayChart onGo={onGo} />
              </div>
              {/* 超出的收成一句，**点得动**——否则「还有 N 篇」是个说了不算的数字 */}
              {overflow ? (
                <button className="today-more" onClick={() => onGo("content")}>
                  还有 {overflow} 篇在排队
                  <IconArrowRight aria-hidden="true" stroke={1.8} />
                </button>
              ) : null}
            </>
          ) : (
            <div className="today-clear">
              <p>没有正在推进或等待复盘的内容。</p>
              <NewContentButton onGo={onGo} onChanged={onChanged} label="开始一篇新的" className="btn" />
            </div>
          )}
        </section>
      ) : null}

      {/**
        * ⚠️ **这儿原来是「我的清单」，撤了，换成「最近发了什么」。**
        * 这一页的上半部已经全是待办（等你动手 5 件 + 先做这一件三张卡），
        * 手写清单是**第三份待办**——一屏里同一件事说三遍。
        * 换成已经发生的事，四个数字说「现在什么状态」、图说「最近趋势」、
        * 表说「具体是哪几条」，三层各答一问。
        * 清单本身没删，`components/DayPlan.jsx` 还在，旧总览页仍然用它。
        */}
      <RecentPosts onGo={onGo} />

      {status ? (
        <section className="today-background" aria-label="本地工作区状态">
          <span>本地工作区</span>
          <button onClick={() => onGo("content")}>内容项目 <b>{status.counts?.projects ?? 0}</b></button>
          <button onClick={() => onGo("materials")}>素材 <b>{status.counts?.materials ?? 0}</b></button>
          {statusLoading ? <small>刷新中…</small> : <small>SQLite 已连接</small>}
        </section>
      ) : null}

    </>
  );
}
