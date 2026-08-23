// 列表里的一行。**从卡片墙改过来的**（原 `DocCard` / `.wall-card`）。
//
// ⚠️ **为什么不再是卡片。**
// 卡片是给**有封面图**的东西用的（书架用对了）。选题、稿件、素材是「标题 + 摘要」的
// 纯文字条目，包一层带边框的盒子只多了两件事：一圈用不上的边框，和一次把摘要切成三行的
// 宽度损失。同一屏 1440×800 下卡片墙显示 5 条，行显示 14 条，**而字号一个都没缩小**——
// 省下来的全是盒子和留白。
//
// ⚠️ **但摘要必须留着。** `docs/design-system.md` 那条「没有摘要的卡片和一行标题的列表
// 没区别」在这儿同样成立，所以行是**两行高**的：标题一行、摘要一行。省掉摘要就等于把
// 浏览层降级成一份目录，而浏览层存在的全部理由是「一眼扫十几条」。
//
// **对齐不再需要靠补丁**：卡片时代要给标题钉死两行、给空副标题也渲染一个占位，
// 才能让一排卡的摘要落在同一高度（冒烟测试量过三张卡的像素差）。行天然就是对齐的，
// 那两个补丁跟着卡片一起撤了。
//
// **外壳不是按钮**：主动作是 `.doc-row__open`，删除是它的兄弟——button 套 button 是非法结构。

import { useState } from "react";
import { relTime, stateIcon, stateTone } from "../../components/ui.jsx";
import { IconArrowUpRight, IconFileText, IconTrash } from "../../components/icons.jsx";
import { useConfirmGuard } from "../../lib/use-confirm-guard.js";

/**
 * 规格 vs 标签。**「3,180 字」「12 分钟」这类不是标签，是规格**——
 * 它们和 `sub`（优先级、覆盖周期）回答同一个问题「这份东西是什么规模」，
 * 所以跟 `sub` 一起走摘要行的引子，不挤右侧那一簇。
 * ⚠️ 上一版把它们混在 tags 里、而右侧只显示 `tags[0]`，于是**洞察卡的篇幅整个消失了**
 *（冒烟测试抓到的第二处丢失）。判据只写这一处。
 */
export const isSpec = (t) => /(?:字|分钟|条|篇)$/.test(String(t || "").trim());

export function DocRow({ item, onOpen, onDelete, removeLabel, onOpenSource }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // 挡住一次物理双击直接删掉——为什么需要它、320ms 是怎么来的，见 hook 里的注释
  const armed = useConfirmGuard(confirm);
  const StateIcon = stateIcon(item.badge || "");
  const specs = [item.sub, ...(item.tags || []).filter(isSpec)].filter(Boolean);
  const labels = (item.tags || []).filter((t) => !isSpec(t));

  return (
    <article className="doc-row" data-confirm={confirm ? "" : undefined}>
      <button className="doc-row__open" onClick={onOpen} aria-label={`打开：${item.title}`}>
        {/* 状态先于标题。**形状是主编码、颜色是副的**（见 ui.jsx 的 stateTone）：
            一屏十几行时，"在哪一步" 要能不读字就扫出来。没有状态的源不画这一格，
            但格子留着——不留的话有状态和没状态的行标题起点差 22px，一列就成了锯齿。 */}
        <span className="doc-row__state" title={item.badge || ""}>
          {item.badge ? <StateIcon aria-hidden="true" size={15} stroke={1.8} data-tone={stateTone(item.badge)} /> : null}
        </span>

        <span className="doc-row__main">
          <span className="doc-row__title" title={item.title}>{item.title}</span>
          {/* 第二行：出了问题就只说问题（盖掉摘要），否则「规格 · 摘要」。
              不论走哪一支都**只占一行**——行高不定的话一列长短不齐，而这一列的价值就在于齐。 */}
          {item.warning ? (
            <span className="doc-row__excerpt doc-row__excerpt--warn" role="alert">{item.warning.title}</span>
          ) : (
            /* ⚠️ **`sub` 和 `preview` 都要出现，`sub` 在前当引子。**
               上一版写成 `preview || sub`，于是**两者都有的源里 sub 被吃掉了**——
               洞察卡的「覆盖周期 · 篇幅」就是这么消失的（冒烟测试抓到了）。
               它们回答的不是同一个问题：sub 是「这份东西的规格」，preview 是「它说了什么」，
               一行里放得下就都放。 */
            <span className="doc-row__excerpt">
              {/* ⚠️ **分隔点写在 JSX 里，不用 `:not(:last-child)::after`。**
                  摘要是**文本节点**不是元素，所以引子永远匹配 `:last-child`，
                  那条 CSS 一次都没生效过——屏幕上是「公众号公开写作是一种…」连在一起。
                  条件在数据里，就在数据里判。 */}
              {specs.length ? (
                <span className="doc-row__lead">
                  {specs.join(" · ")}
                  {item.preview ? <i aria-hidden="true">·</i> : null}
                </span>
              ) : null}
              {item.preview || ""}
            </span>
          )}
        </span>

        {/**
          * ⚠️ **这几格「没内容也要占位」**，和左边那枚状态图标是同一条理由：
          * 不占的话，没有去向的那几行会把类别挪进去向那一列，同一列的东西在每行
          * 落在不同的横坐标——一列扫下去是锯齿。**哪几列存在**由 `DocList`
          * 按整份列表算一次（`data-cols`），所以没有去向的源不会白占一列。
          */}
        <span className="doc-row__meta">
          <span className="doc-row__trace">{item.trace || ""}</span>
          {/* ⚠️ 色调跟着 `kindTone` 走，**判据在适配器里**（`material-workspace.js` 的
              `KIND_TONES`，和 `KIND_LABELS` 挨着）——这一层不认识「收藏 / 灵感 / 素材」。
              没给色调的源退回没有底色的 `.tag`，不硬给一个颜色。 */}
          <span className="doc-row__kind">
            {item.kindLabel ? (
              item.kindTone
                ? <span className="pill tag--kind" data-tone={item.kindTone}>{item.kindLabel}</span>
                : <span className="tag tag--kind">{item.kindLabel}</span>
            ) : null}
          </span>
          {/* 标签只留一个：右侧这几列是定宽的，铺四个会把时间挤出可视区。
              全部标签在打开之后的元信息行里 */}
          <span className="doc-row__tag">{labels.length ? <span className="tag">{labels[0]}</span> : null}</span>
          <time className="doc-row__time">{item.time ? relTime(item.time) : ""}</time>
        </span>
      </button>

      <div className="doc-row__acts">
        {/**
          * ⚠️ **「打开来源」这一格没有链接也要占位。**
          * 有没有外链是**逐条不同**的，不占的话有链接的行整块元信息被往左推 26px——
          * 右边那几列刚排齐，又被这一颗按钮重新推成锯齿。
          *
          * 删除那颗不用占位：它有没有由**源**决定（`source.remove`），
          * 一份列表里要么每行都有、要么每行都没有，不会把某几行推歪。
          */}
        {/**
          * ⚠️ **「看原文」和「打开来源」是两回事，别合成一颗。**
          * 前者跳回**库里那条灵感**（这条素材是从它里面拆出来的）；
          * 后者打开**站外的那个网址**。一条素材可以两者都有、也可以只有一个。
          */}
        <span className="doc-row__srcslot">
          {item.sourceOpen && onOpenSource ? (
            <button
              type="button"
              className="icon-btn doc-row__src"
              onClick={() => onOpenSource(item.sourceOpen)}
              title="看它是从哪一篇里拆出来的"
              aria-label="看原文"
            >
              <IconFileText aria-hidden="true" size={15} stroke={1.7} />
            </button>
          ) : null}
        </span>
        <span className="doc-row__srcslot">
          {item.raw?.link ? (
            <a className="icon-btn doc-row__src" href={item.raw.link} target="_blank" rel="noreferrer" title="打开来源" aria-label="打开来源">
              <IconArrowUpRight aria-hidden="true" size={15} stroke={1.7} />
            </a>
          ) : null}
        </span>
        {onDelete ? (
          confirm ? (
            /**
             * ⚠️ **「取消」排在最右**，也就是行里最靠手的那个落点——让最熟的位置落在安全的那颗上。
             * 确认态整行不再 hover 才显形（`data-confirm`），否则鼠标一挪走按钮就没了。
             */
            <>
              <button
                className="btn btn-sm btn-danger"
                disabled={busy}
                onClick={async () => {
                  // ⚠️ **挡住连点。** 见 `armed` 的注释——这不是防抖，是防误删。
                  if (!armed.current) return;
                  setBusy(true);
                  try {
                    await onDelete();
                  } finally {
                    setBusy(false);
                    setConfirm(false);
                  }
                }}
              >
                {busy ? "删除中…" : removeLabel || "确认删除"}
              </button>
              {/* 反悔的路必须一直在。少了它，点错第一下就只剩「删」和「离开这一页」两条路 */}
              <button className="btn btn-sm" disabled={busy} onClick={() => setConfirm(false)}>取消</button>
            </>
          ) : (
            <button className="icon-btn doc-row__del" onClick={() => setConfirm(true)} title={removeLabel || "删除"} aria-label="删除">
              <IconTrash aria-hidden="true" size={15} stroke={1.7} />
            </button>
          )
        ) : null}
      </div>
    </article>
  );
}
