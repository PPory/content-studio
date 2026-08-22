// 全部内容项目的那张表。
//
// ⚠️ **这是「全集」那一侧，所以是条目不是卡片**（判据见 `docs/design-system.md`
// 「什么时候用卡片，什么时候用条目」）。上一版把全集也画成卡片：九个阶段各一条泳道、
// 每条里两列卡，一张卡 218px 高却只装了三四行字——**中段大片留白**，
// 而三个项目就占掉了两屏。
//
// 顶上那三张「需要你处理的」仍然是卡片（`ProjectCard`），因为它们是**要动手的少数**。

import { StatePill, relTime } from "../../components/ui.jsx";
import { IconAlertTriangle, IconChevronRight } from "../../components/icons.jsx";

/**
 * 一行 = 一个项目。
 *
 * 列的顺序是按「扫的时候按什么找」排的：
 * **状态 → 标题 → 平台 → 素材 → 下一步 → 多久没动**。
 * 状态在最左边，因为一列同色的 pill 竖着排下来，哪一档堆了多少一眼就看出来了。
 */
export function ProjectTable({ projects, onOpen }) {
  return (
    <div className="ptable" role="table" aria-label="全部内容项目">
      <div className="ptable__head" role="row">
        <span role="columnheader">阶段</span>
        <span role="columnheader">标题</span>
        <span role="columnheader">平台</span>
        <span role="columnheader">素材</span>
        <span role="columnheader">下一步</span>
        <span role="columnheader">更新</span>
      </div>

      {projects.map((p) => {
        const blockers = Array.isArray(p.blockers) ? p.blockers : [];
        const title = p.title || "未命名内容";
        return (
          <button key={p.id} className="ptable__row" role="row" onClick={() => onOpen(p)}>
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
        );
      })}
    </div>
  );
}
