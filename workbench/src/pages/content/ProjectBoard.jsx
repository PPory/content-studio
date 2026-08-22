// 内容项目看板：阶段成列，拖一张卡过去就是推进阶段。
//
// ⚠️ **合法的推进只有四条，不是「任意阶段到任意阶段」**（真源在
// `worker/src/lib/content-project.js` 的命令白名单 + `nextDraftWorkflow` 状态机）：
//
//   start-writing      策划中 → 写作中
//   finish-writing     写作中 → 待发布   ⚠️ 正文为空时 Worker 会拒（409）
//   return-writing     待发布 → 写作中
//   abandon            前两态 → 已搁置
//
// ⚠️ **「待诊断」那一档整个撤了**：它在 Worker 里没有任何实现，
// 全部含义是"发出去前你自己再读一遍"。原来的 `submit-diagnosis` + `approve-diagnosis`
// 合并成了 `finish-writing`。
//
// **所以拖起来的那一刻就要把放不下的列标出来**，不能让人拖过去再吃一个 409——
// 一个「看起来能放、放下去报错」的目标，比一个明确说「这儿不行」的灰列糟得多。
//
// ⚠️ **类名用 `kanban-*` 不用 `board-*`**：`.board` 已经被热点页的榜单占了，
// 撞名的话热点页会莫名其妙跟着变（CLAUDE.md 里记着这条）。

import { useState } from "react";
import { StatePill, relTime } from "../../components/ui.jsx";
import { IconAlertTriangle } from "../../components/icons.jsx";
import { PROJECT_STAGE_META } from "../../lib/content-projects.js";

/**
 * 从 `from` 拖到 `to` 该发哪条命令；不合法返回 `""`。
 *
 * ⚠️ **这张表是 Worker 那份状态机的镜像，不是第二份判据。**
 * 它存在的唯一理由是**在拖起来之前就知道哪些列能放**——服务端仍然会拒，
 * 这里只是别让用户白拖一次。改 Worker 的白名单时必须回头改这儿，
 * 漏改的表现是「界面允许拖、放下去报 409」，而那看起来像后端坏了。
 */
export const TRANSITIONS = {
  "策划中→写作中": "start-writing",
  "写作中→待发布": "finish-writing",
  "待发布→写作中": "return-writing",
  "写作中→已搁置": "abandon",
  "待发布→已搁置": "abandon",
};

export const commandFor = (from, to) => (from === to ? "" : TRANSITIONS[`${from}→${to}`] || "");

export function ProjectBoard({ stages, grouped, onOpen, onMove, busy }) {
  const [dragging, setDragging] = useState(null);   // 正在拖的那个 project
  const [over, setOver] = useState("");             // 悬在哪一列上

  return (
    <div className="kanban" aria-label="内容项目看板">
      {stages.map((stage) => {
        const meta = PROJECT_STAGE_META[stage];
        const items = grouped[stage] || [];
        // 拖起来之后：这一列能不能放
        const droppable = dragging ? !!commandFor(dragging.stage, stage) : null;
        return (
          <section
            key={stage}
            className="kanban-col"
            aria-label={stage}
            data-drop={droppable === true && over === stage ? "" : undefined}
            data-dead={droppable === false ? "" : undefined}
            onDragOver={(e) => {
              if (!droppable) return;
              e.preventDefault();       // 不 preventDefault 的话浏览器根本不认这是放置目标
              setOver(stage);
            }}
            onDragLeave={() => setOver((s) => (s === stage ? "" : s))}
            onDrop={(e) => {
              e.preventDefault();
              const cmd = dragging && commandFor(dragging.stage, stage);
              setOver("");
              if (cmd) onMove(dragging, cmd, stage);
              setDragging(null);
            }}
          >
            <div className="kanban-col__head">
              <span className="kanban-col__name">{meta?.label || stage}</span>
              <span className="kanban-col__count">{items.length}</span>
            </div>

            <div className="kanban-col__body">
              {items.map((p) => {
                const blockers = Array.isArray(p.blockers) ? p.blockers : [];
                const title = p.title || "未命名内容";
                return (
                  <article
                    key={p.id}
                    className="kanban-card"
                    draggable={!busy}
                    onDragStart={() => setDragging(p)}
                    onDragEnd={() => (setDragging(null), setOver(""))}
                    onClick={() => onOpen(p)}
                  >
                    <div className="kanban-card__top">
                      <StatePill state={p.stage} />
                      <time>{relTime(p.updatedAt)}</time>
                    </div>
                    <h3 title={title}>{title}</h3>
                    {/* ⚠️ **看板卡片要有摘要**，否则它就只是「竖着排的标题列表」，换视图没意义 */}
                    <p className="kanban-card__note">{p.stageReason || p.nextAction || ""}</p>
                    {blockers.length ? (
                      <div className="kanban-card__warn">
                        <IconAlertTriangle size={12} stroke={1.9} aria-hidden="true" />
                        {blockers[0]}
                      </div>
                    ) : null}
                  </article>
                );
              })}

              {/* ⚠️ **空列也要说话**：拖动时说「能不能放这儿」，平时说「这一档是空的」 */}
              {!items.length ? (
                <p className="kanban-col__empty">
                  {dragging ? (droppable ? "放这儿" : "这一步不能从当前阶段直接过来") : "这一档还是空的"}
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
