// 全部内容项目的那张表。
//
// ⚠️ **这是「全集」那一侧，所以是条目不是卡片**（判据见 `docs/design-system.md`
// 「什么时候用卡片，什么时候用条目」）。上一版把全集也画成卡片：九个阶段各一条泳道、
// 每条里两列卡，一张卡 218px 高却只装了三四行字——**中段大片留白**，
// 而三个项目就占掉了两屏。
//
// 顶上那三张「需要你处理的」仍然是卡片（`ProjectCard`），因为它们是**要动手的少数**。

import { useState } from "react";
import { StatePill, relTime } from "../../components/ui.jsx";
import { IconAlertTriangle, IconChevronRight, IconLoader2, IconTrash } from "../../components/icons.jsx";

/**
 * 一行 = 一个项目。
 *
 * 列的顺序是按「扫的时候按什么找」排的：
 * **状态 → 标题 → 平台 → 素材 → 下一步 → 多久没动**。
 * 状态在最左边，因为一列同色的 pill 竖着排下来，哪一档堆了多少一眼就看出来了。
 */
export function ProjectTable({ projects, onOpen, onRemove, removing = "" }) {
  // 正在等第二下确认的那一行。**一次只有一行**：留着多行确认态，
  // 你会分不清刚才点的是哪一行
  const [confirming, setConfirming] = useState("");
  return (
    <div className="ptable" role="table" aria-label="全部内容项目">
      {/**
        * ⚠️ **表头的网格包在一层里，末尾留出删除按钮那一格。**
        * 行被 `.ptable__line` 包了一层（删除是它的兄弟），行的网格只占
        * 去掉按钮之后的宽度——表头不跟着包一层的话，两边列宽差一截（实测 36px）。
        */}
      <div className="ptable__head" role="row">
        <div className="ptable__headgrid">
          <span role="columnheader">阶段</span>
          <span role="columnheader">标题</span>
          <span role="columnheader">平台</span>
          <span role="columnheader">素材</span>
          <span role="columnheader">下一步</span>
          <span role="columnheader">更新</span>
        </div>
        {onRemove ? <span aria-hidden="true" /> : null}
      </div>

      {projects.map((p) => {
        const blockers = Array.isArray(p.blockers) ? p.blockers : [];
        const title = p.title || "未命名内容";
        const asking = confirming === p.id;
        return (
          <div className="ptable__line" key={p.id}>
          <button className="ptable__row" role="row" onClick={() => onOpen(p)}>
            <span role="cell"><StatePill state={p.stage} /></span>

            <span className="ptable__title" role="cell">
              <b title={title}>{title}</b>
              {/**
                * ⚠️ **阻塞压在标题下面，不另开一列。**
                * 给它一列的话，绝大多数行那一格是空的——一整列的空白只为少数几行服务。
                * 而 `stageReason` 不显示：它解释的是「为什么在这一阶段」，
                * 那是**卡片**要回答的；一行表格要回答的是「它卡住了没有」。
                */}
              {blockers.length ? (
                <em className="ptable__blocker">
                  <IconAlertTriangle size={12} stroke={1.9} aria-hidden="true" />
                  {blockers[0]}
                </em>
              ) : null}
            </span>

            {/* 平台取简报里那个**主平台**，不是变体清单——一行表格要的是「发去哪儿」 */}
            <span className="ptable__dim" role="cell">{p.brief?.platform || "—"}</span>

            {/* ⚠️ 0 写成「—」不写「0」：一列 0 在扫视时和真实数字一样重，而它什么都不说 */}
            <span className="ptable__dim" role="cell">{p.materials?.length || "—"}</span>

            <span className="ptable__next" role="cell">{p.nextAction || "检查项目状态"}</span>

            <span className="ptable__dim" role="cell">
              <time>{relTime(p.updatedAt)}</time>
              <IconChevronRight size={14} stroke={1.8} aria-hidden="true" />
            </span>
          </button>

          {/**
            * ⚠️ **删除是行的兄弟节点，不在行里面**——行本身是个 `<button>`，
            * button 套 button 是非法结构。
            *
            * ⚠️ **点两下，而且第二下的按钮上要写清删的是什么。**
            * 这一下会**连级删掉这个项目底下所有稿子**（`drafts.topic_id` 是 CASCADE），
            * 而且**软删除、可从本地回收站恢复**。写「确定吗」是没用的——要写「删掉这一篇」。
            */}
          {onRemove ? (
            asking ? (
              <button
                className="ptable__del is-armed"
                onClick={() => { setConfirming(""); onRemove(p); }}
                disabled={removing === p.id}
                title="连同它底下的稿子一起移入本地回收站，可恢复"
              >
                {removing === p.id ? <IconLoader2 size={13} className="spin" aria-hidden="true" /> : null}
                删掉整篇
              </button>
            ) : (
              <button
                className="ptable__del"
                onClick={() => setConfirming(p.id)}
                onBlur={() => setConfirming((v) => (v === p.id ? "" : v))}
                aria-label={`删除「${title}」`}
                title="删除这个项目"
              >
                <IconTrash size={14} stroke={1.7} aria-hidden="true" />
              </button>
            )
          ) : null}
          </div>
        );
      })}
    </div>
  );
}
