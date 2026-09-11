// 全部内容项目的那张表。
//
// ⚠️ **这是「全集」那一侧，所以是条目不是卡片**（判据见 `docs/design-system.md`
// 「什么时候用卡片，什么时候用条目」）。上一版把全集也画成卡片：九个阶段各一条泳道、
// 每条里两列卡，一张卡 218px 高却只装了三四行字——**中段大片留白**，
// 而三个项目就占掉了两屏。
//
// 顶上那三张「需要你处理的」仍然是卡片（`ProjectCard`），因为它们是**要动手的少数**。

import { useState } from "react";
import { RowDelete, StatePill, relTime } from "../../components/ui.jsx";
import { IconAlertTriangle, IconArrowRight, IconFolder } from "../../components/icons.jsx";

/**
 * 一行 = 一个项目。
 *
 * 列的顺序是按「扫的时候按什么找」排的：
 * **状态 → 标题 →〔平台〕→〔素材〕→ 多久没动**（方括号那两列按需出现，见下）。
 * 状态在最左边，因为一列 pill 竖着排下来，哪一档堆了多少一眼就看出来了。
 *
 * ⚠️ **「下一步」那一列撤了，别加回来。** 它逐行写着「写完了，去发布」——
 * 六行里五行一个字都不差，因为它和最左边那颗状态 pill 是同一个事实的两种说法。
 * 现在它只在**指到这一行时**出现，占的是「更新」那一格（见下面的 `.ptable__tail`）：
 * 那时候它才是有用的，因为你正要点下去，而它说的就是点下去要干的事。
 *
 * ⚠️ **一整列的值全都一样就整列不画**（现在的「平台」：六行全是「公众号」；
 * 「素材」：一行都没挂过）。一列相同的值携带的信息是零，但它照样吃掉横向空间、
 * 把标题挤窄。这条对**每一列**成立，不是只对当初写它的那一列。
 */
export function ProjectTable({ projects, onOpen, onRemove, onFile }) {
  // 正在等第二下确认的那一行。**一次只有一行**：留着多行确认态，
  // 你会分不清刚才点的是哪一行。这个 id 只用来把那一行钉住
  //（`data-confirm`），确认本身的状态在 `RowDelete` 自己身上。
  const [confirming, setConfirming] = useState("");

  /**
   * ⚠️ **数的是「填了的那些里有几种」，空值不算一种。**
   *
   * 第一版把空串也算一个取值，于是「五行公众号 + 一行没填」是 2 种、列就画出来了——
   * 屏幕上是一列五个「公众号」加一个「—」。那一列真正说出口的只有「有一篇还没定平台」，
   * 而为这一句话要横着占掉 88px、每一行都白留一格。
   * 这一列存在的理由是**分辨东西发去哪儿**；填了的全发同一个地方，它就没在分辨任何东西。
   * 「还没定」那件事有它自己该待的地方（行里的阻塞那一行），不需要一整列来说。
   */
  const showPlatform = new Set(projects.map((p) => (p.brief?.platform || "").trim()).filter(Boolean)).size > 1;

  /**
   * ⚠️ **同一条判据对每一列都成立，不是只对「平台」那一列。**
   *
   * 「素材」以前是无条件画的，于是在真实数据下它是**一整列 `—`**：56px 宽、
   * 一个表头、每行一格，说出口的信息量是零。判据和上面那一句是同一句话——
   * 一列没有在分辨任何东西，就不画它（`docs/design-system.md`
   * 「一整列的值全都相同就不画那一列」）。
   *
   * 计数列的「空」是 0，而 0 按下面那条规则显示成 `—`；所以这里问的是
   * **有没有任何一行真的挂过素材**。挂过的行数多少不重要，一行都没有就整列撤掉。
   */
  const showMaterials = projects.some((p) => (p.materials?.length || 0) > 0);

  /**
   * 列宽只写这一处。
   *
   * ⚠️ **以前表头和行各写一份 `grid-template-columns`，而且必须一字不差。**
   * 那是这张表出过两次列错位的原因（`.ptable__head` 上面那段注释记着一次，
   * `.doc-rows__head` 那次一模一样）。改成一个自定义属性挂在容器上、
   * 两边都 `var(--ptable-cols)` 之后，**结构上就不可能只改一处**。
   */
  const cols = ["92px", "minmax(0, 1fr)", showPlatform ? "88px" : "", showMaterials ? "56px" : "", "150px"]
    .filter(Boolean)
    .join(" ");

  /**
   * ↑ / ↓ 在行之间移动焦点；Enter 打开由行本身是 `<button>` 天然提供。
   *
   * ⚠️ **焦点不在行上时直接放行**（`at < 0`）：那时候焦点可能在删除钮、归类钮，
   * 或者根本不在这张表里，而 ↑↓ 在那些地方的本职是滚页面。抢过来就是
   * 「按方向键页面不动了」，比没有键盘支持更糟。
   * 到头也放行——最后一行再按 ↓ 应该继续滚页面，不是原地卡住。
   */
  const onKeyDown = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(event.currentTarget.querySelectorAll(".ptable__row"));
    const at = rows.indexOf(document.activeElement);
    if (at < 0) return;
    const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div
      className="ptable"
      role="table"
      aria-label="全部内容项目"
      style={{ "--ptable-cols": cols }}
      onKeyDown={onKeyDown}
    >
      {/**
        * ⚠️ **表头的网格包在一层里，末尾留出删除按钮那一格。**
        * 行被 `.ptable__line` 包了一层（删除是它的兄弟），行的网格只占
        * 去掉按钮之后的宽度——表头不跟着包一层的话，两边列宽差一截（实测 36px）。
        */}
      <div className="ptable__head" role="row">
        <div className="ptable__headgrid">
          <span role="columnheader">阶段</span>
          <span role="columnheader">标题</span>
          {showPlatform ? <span role="columnheader">平台</span> : null}
          {showMaterials ? <span role="columnheader">素材</span> : null}
          <span role="columnheader">更新</span>
        </div>
        {onFile ? <span aria-hidden="true" /> : null}
        {onRemove ? <span aria-hidden="true" /> : null}
      </div>

      {projects.map((p) => {
        const blockers = Array.isArray(p.blockers) ? p.blockers : [];
        const title = p.title || "未命名内容";
        return (
          <div className="ptable__line" key={p.id} data-confirm={confirming === p.id ? "" : undefined}>
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
              {/**
                * 所属合集**压在标题下面，不另开一列**（和 blocker 同一处理）：
                * 给它一列的话，还没归类的行那一格是空的——一整列的空白只为少数行服务。
                * 有它才能一眼看出哪些文章还散着。
                */}
              {(p.collections || []).length ? (
                <em className="ptable__series">
                  <IconFolder size={12} stroke={1.8} aria-hidden="true" />
                  {p.collections.map((item) => item.title).join(" · ")}
                </em>
              ) : null}
            </span>

            {/* 平台取简报里那个**主平台**，不是变体清单——一行表格要的是「发去哪儿」 */}
            {showPlatform ? <span className="ptable__dim" role="cell">{p.brief?.platform || "—"}</span> : null}

            {/* ⚠️ 0 写成「—」不写「0」：一列 0 在扫视时和真实数字一样重，而它什么都不说 */}
            {showMaterials ? <span className="ptable__dim" role="cell">{p.materials?.length || "—"}</span> : null}

            {/**
              * 最后一格：平时是「多久没动」，指到这一行（hover / 键盘 focus）时换成下一步。
              *
              * ⚠️ **这是换文案，不是加一颗按钮。** 行本身就是 `<button>`，点它干的就是
              * 这件事；再放一颗真按钮既是 button 套 button（非法结构，这张表上面
              * 已经为此把删除和归类挪成兄弟节点了），又会让一行里出现两个点击目标。
              *
              * ⚠️ **下一步那句给 `aria-hidden`，时间留在无障碍树里。** 时间是「更新」
              * 那一列的值，读屏要拿到；而下一步只是在**说这一行点下去会发生什么**，
              * 而那件事已经由行的可访问名（标题）+ 它是个按钮表达了，读两遍反而绕。
              */}
            {/* ⚠️ 行尾那枚 `›` 撤了：它平时藏着、hover 才出现，而 hover 时这一格已经换成
                「写完了，去发布 →」——一句话加一个箭头，比一枚没有宾语的角括号说得清楚得多 */}
            <span className="ptable__tail" role="cell">
              <time>{relTime(p.updatedAt)}</time>
              <em className="ptable__next" aria-hidden="true">
                {p.nextAction || "打开这一篇"}
                <IconArrowRight size={14} stroke={1.8} />
              </em>
            </span>
          </button>

          {/**
            * 归类。和删除一样是行的兄弟节点（行本身是 `<button>`）。
            * ⚠️ **这是「合集不方便」的主要修复**：上一版要归类一篇文章，得先进合集、
            * 点「添加已有文章」、再搜标题。现在在你看得到这篇文章的地方就能归。
            */}
          {onFile ? (
            <button
              className="ptable__file"
              onClick={() => onFile(p)}
              aria-label={`把「${title}」放进合集`}
              title={p.collections?.length ? `已在 ${p.collections.length} 个合集里，点这里改` : "放进合集"}
              data-on={p.collections?.length ? "" : undefined}
            >
              <IconFolder size={14} stroke={1.7} aria-hidden="true" />
            </button>
          ) : null}

          {/**
            * ⚠️ **删除是行的兄弟节点，不在行里面**——行本身是个 `<button>`，
            * button 套 button 是非法结构。
            *
            * 两步确认走共用的 `RowDelete`（`components/ui.jsx`），**这一页原来是第五份
            * 手写实现**：写法各不相同，而其中没有一份带防连点——垃圾桶点下去之后，
            * 确认钮就长在它原来的位置上，手快连点两下就是删掉。换成共用那颗之后拿到
            * 三件事：320ms 的闸、排在右边的「取消」、以及「改一处四处都跟着变」。
            *
            * ⚠️ **第二下的按钮上写的是删的是什么**（「删掉整篇」），不是「确定吗」。
            * 这一下会**连级删掉这个项目底下所有稿子**（`drafts.topic_id` 是 CASCADE），
            * 软删除、可恢复——而「可恢复」那条路是回执上那颗「撤销」（`Content.jsx`）。
            */}
          {onRemove ? (
            <span className="ptable__acts">
              <RowDelete
                onDelete={() => onRemove(p)}
                label="删掉整篇"
                title={`删除「${title}」——连同它底下的稿子一起移入回收站，可恢复`}
                onOpenChange={(open) => setConfirming(open ? p.id : "")}
              />
            </span>
          ) : null}
          </div>
        );
      })}
    </div>
  );
}
