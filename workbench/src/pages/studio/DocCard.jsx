// 卡片墙上的一张卡。从 `pages/Studio.jsx` 搬出来，函数体一字未动。
//
// **卡片外壳不是按钮**：主动作是里面那个 `.wall-card__open`，删除是它的兄弟而不是子孙
// （button 里套 button 是非法结构）。卡片内部要行行对齐——标题恒占两行、副标题
// 没内容也渲染、标签 `margin-top: auto`，冒烟测试量三张卡同一行的像素差 ≤1px。

import { useState } from "react";
import { relTime } from "../../components/ui.jsx";
import { IconArrowUpRight, IconTrash } from "../../components/icons.jsx";
import { useConfirmGuard } from "../../lib/use-confirm-guard.js";

export function DocCard({ item, onOpen, onDelete, removeLabel }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // 挡住一次物理双击直接删掉——为什么需要它、320ms 是怎么来的，见 hook 里的注释
  const armed = useConfirmGuard(confirm);

  return (
    <article className="wall-card">
      <button className="wall-card__open" onClick={onOpen} aria-label={`打开：${item.title}`}>
        <div className="wall-card__top">
          <span className="wall-card__signals">
            {item.kindLabel ? <span className="tag tag--kind">{item.kindLabel}</span> : null}
            {item.badge ? <span className="tag tag--state">{item.badge}</span> : null}
          </span>
          <time>{item.time ? relTime(item.time) : ""}</time>
        </div>
        {/* 标题恒占两行（CSS 里 clamp + min-height），所以完整标题挂在 title 上 */}
        <h3 title={item.title}>{item.title}</h3>
        {/* 这一行**没有内容也要渲染**：不渲染的话，有副标题的卡和没有的卡，
            下面的摘要会差一行高度，整排卡片就对不齐了 */}
        <div className="wall-card__sub">{item.sub || ""}</div>
        {item.preview ? <p className="wall-card__note">{item.preview}</p> : null}
        {item.warning ? (
          <p className="wall-card__warning" role="alert">
            <strong>{item.warning.title}</strong>
          </p>
        ) : null}
        {item.trace ? <div className="wall-card__trace">{item.trace}</div> : null}
        {item.tags?.length ? (
          <div className="wall-card__tags">
            {item.tags.slice(0, 4).map((t) => (
              <span key={t} className="tag">{t}</span>
            ))}
          </div>
        ) : null}
      </button>
      <div className="wall-card__foot">
        {item.raw?.link ? (
          <a className="btn btn-sm" href={item.raw.link} target="_blank" rel="noreferrer">
            <IconArrowUpRight aria-hidden="true" stroke={1.7} />
            来源
          </a>
        ) : (
          <span className="wall-card__origin">{item.raw?.source || ""}</span>
        )}
        {/* 删除按钮平时是灰的、hover 才显形，要点两下。第二下写清楚东西去哪了 */}
        {onDelete ? (
          confirm ? (
            /**
             * ⚠️ **确认态的两颗按钮要裹成一组。** `.wall-card__foot` 是
             * `justify-content: space-between`，正常态靠垃圾桶上的 `margin-left: auto`
             * 把「垃圾桶 + 打开」聚到右边；确认态多出一个按钮之后，三个子元素被均匀撑开，
             * **两颗按钮一个飘在中间、一个贴着右缘**，看着不像一组选择题，像两个不相干的控件。
             *
             * **「取消」排在最右**，也就是「打开」原来的位置：那是手最熟的落点，
             * 让它落在安全的那颗上。
             */
            <div className="wall-card__confirm">
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
            </div>
          ) : (
            <button className="icon-btn wall-card__del" onClick={() => setConfirm(true)} title={removeLabel || "删除"} aria-label="删除">
              <IconTrash aria-hidden="true" size={15} stroke={1.7} />
            </button>
          )
        ) : null}
        {confirm ? null : <button className="btn btn-sm" onClick={onOpen}>打开</button>}
      </div>
    </article>
  );
}
