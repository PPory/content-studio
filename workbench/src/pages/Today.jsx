import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { actionableProjects, projectOpenTarget, projectsFrom } from "../lib/content-projects.js";
import { CreationDialog, MODES } from "../components/CreationDialog.jsx";
import { ErrorNote, Loading, MenuButton, PageHeader } from "../components/ui.jsx";
import { AUTO_CARDS } from "../lib/views.js";
import { TodayStats } from "./today/TodayStats.jsx";
import { TodayChart } from "./today/TodayChart.jsx";
import { RecentPosts } from "./today/RecentPosts.jsx";
import { IconArrowRight, IconPlus } from "../components/icons.jsx";
// ⚠️ **从 `components/` 引，不是从 `./Content.jsx`。** 页面 import 另一个页面
// 是这个项目明令禁止的——现状原来是破的，这一轮顺手修了。
import { ProjectCard } from "../components/ProjectCard.jsx";

export function Today({ config, status, statusError, statusLoading, onRetryStatus, onGo, onChanged, onSettings }) {
  const workerReady = config?.worker?.configured;
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [creation, setCreation] = useState(null);

  const load = useCallback(() => {
    if (!workerReady) return;
    api.projects().then((data) => { setResult(data); setError(null); }).catch(setError);
  }, [workerReady]);
  useEffect(load, [load, status?.ts]);

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
        desc="先推进一篇，再处理其他。系统状态退到后面，真正等你决定的事情排在前面。"
        aside={
          <>
            {result ? <span className="project-total">{pending ? `${pending} 件事等你` : "今天没有内容待办"}</span> : null}
            {/**
              * ⚠️ **「新建内容」是个下拉，不是直接开弹层。**
              * 点它原来落在创作弹层的「起点选择」那一屏——整屏只干一件事：问你三选一。
              * 下拉在**点之前**就把三条路摊开了，选完直接进对应那一屏，
              * 同一个决定少一次全屏切换。三条起点的真源是 `CreationDialog` 的 `MODES`，
              * **这儿不抄第二份**。
              */}
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
          <p>连接后，这里会把最值得继续的一篇直接放到你面前。</p>
          <button className="btn" onClick={onSettings}>打开设置</button>
        </div>
      ) : null}

      <ErrorNote error={statusError} what="读取流水线状态" onRetry={onRetryStatus} />
      {workerReady && error ? <ErrorNote error={error} what="读取今日内容" onRetry={load} /> : null}
      {workerReady && !result && !error ? <Loading rows={3} /> : null}

      {/**
        * ⚠️ **KPI 那一排在最上面，早于「先做这一件」。**
        * 它回答的是**「我现在处在什么状态」**，而下面那些回答**「接下来做什么」**——
        * 状态在前、动作在后，是因为同一件事该不该做，取决于它前面那几个数。
        * 四个数分属四条不同的链（产出 / 待办 / 库存 / 反馈），见 `TodayStats`。
        */}
      {workerReady ? <TodayStats pending={pending} topStage={actions[0]?.stage || ""} onGo={onGo} /> : null}

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
                * ⚠️ **三张等大，第一张只是描边重一档**（`lead`）。
                * 上一版是「左边一张 278px 的大卡 + 右边三行小条」，两个毛病：
                * 大卡里只有三四行字，**中段大片留白**；而右边那三条只剩标题和一句
                * 「阶段 · 下一步」，同一批数据在一屏上有了两种详略，扫的时候得切换两次读法。
                * 现在三张说同样的话，轻重只靠一道边框。
                */}
              {/**
                * ⚠️ **卡片和图并排，不是上下堆。**
                * 「先做这一件」和「最近产出稳不稳」是**同一个问题的两半**：
                * 该不该现在推这一篇，取决于这个月已经发了几篇。上下堆的话，
                * 得滚一屏才能把两半凑起来——而这一页的全部意义就是一眼看完。
                */}
              <div className="today-split">
                <div className="act-cards">
                  {actions.map((project, i) => (
                    <ProjectCard key={project.id} project={project} lead={i === 0} onOpen={() => open(project)} />
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
              <button className="btn" onClick={() => setCreation("choose")}>开始一篇新的</button>
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
        <section className="today-background" aria-label="后台流水线状态">
          <span>后台</span>
          {/**
            * ⚠️ **这三条从 `views.js` 的 `AUTO_CARDS` 来，不再抄第二份。**
            * 原来是三行硬编码，跳转目标和那份常量**逐字相同**——
            * 而这个项目的事故清一色是「同一件事写在两个地方」：
            * 以后往 `AUTO_CARDS` 里加一档，这儿会安静地少一个，谁也不报错。
            */}
          {AUTO_CARDS.map((card) => (
            <button key={card.key} onClick={() => onGo(card.view, card.state)}>
              {card.label} <b>{status.counts?.[card.key] ?? 0}</b>
            </button>
          ))}
          {statusLoading ? <small>刷新中…</small> : <small>这些由流水线自己处理</small>}
        </section>
      ) : null}

      <CreationDialog
        open={!!creation}
        preset={creation}
        onClose={() => setCreation(null)}
        onCreated={(draft, project) => { onChanged?.(); onGo("project", project?.id || draft.topicId); }}
        onTopicCreated={(topic, project) => { onChanged?.(); onGo("project", project?.id || topic.id); }}
      />
    </>
  );
}
