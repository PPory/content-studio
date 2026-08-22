// 书架墙上的一张书卡。从 `pages/Shelf.jsx` 搬出来，函数体一字未动。
//
// 换封面**只有这张卡角上那一个入口**（`.book-card__coverbtn`）。书详情那一层曾经
// 把整块封面做成换封面的按钮，但那一页最常做的事是读书，误触换来的是一个文件对话框；
// 而且单篇书压根不经过书详情，卡片上这个才是主要入口。

import { useMemo, useState } from "react";
import { Cover } from "../../components/Cover.jsx";
import { IconBook2, IconBookmark, IconCheck, IconChevronRight, IconFileText, IconListDetails, IconPhoto, IconTrash, IconX } from "../../components/icons.jsx";
import { bookProgress, pct, readingOf } from "../../lib/reading.js";
import { stateTone } from "../../components/ui.jsx";

export function BookCard({ book, tick, onOpen, onResume, onTrash, onCover }) {
  /**
   * 进度只有在**它指的那份文件还在这本书里**时才作数。
   * 书重新导入过（章节文件名换了）、或者上一版把 notes.md 误当成章节记了进度时，
   * 卡片上会显示「读到「notes」」这种指向不存在东西的行——宁可不显示。
   */
  const saved = useMemo(() => {
    const r = readingOf(book.dir);
    if (!r) return null;
    const known = r.docPath === book.bookPath || book.chapters?.some((c) => c.path === r.docPath);
    return known ? r : null;
  }, [book, tick]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * 封面底边那条线的长度。⚠️ **没读过就是 `null`，不是 0**——
   * 两者在界面上不是同一件事：`null` 整条线都不画（还没开），`0` 会画一条空槽
   * （开了但没进度）。混在一起的话，一面墙上每本书底下都挂着一条空槽，
   * 「哪些动过」这个信息就没了。
   */
  const progress = useMemo(() => {
    if (!saved) return null;
    const v = book.chapterCount > 1 ? bookProgress(book, saved) : saved.progress;
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
  }, [book, saved]);
  const done = progress != null && progress >= 0.995;

  return (
    /**
     * **卡片外壳不是按钮。**
     *
     * 上一版是 `<div role="button" tabIndex={0}>` 里面又套着「下架」和「换封面」两个
     * 真按钮。鼠标上看不出问题（那两个各自 `stopPropagation`），键盘和读屏上是坏的：
     * 一个 button 里嵌 button 属于非法结构，读屏把整张卡念成一个按钮、里面那两个
     * 要么念不出来要么念成同一个东西的一部分，而 Tab 到卡片按空格是「打开」还是
     * 「下架」全看浏览器心情。
     *
     * 改法和内容工作台那边的 `DocRow` 一致：**外壳退成普通容器，主动作是里面
     * 那个真按钮**（书名 + 元信息那一整块）。整卡点击留着——那是鼠标的便利，
     * 不需要 role 也成立；`.book-card__del` / `__coverbtn` 于是成了它的兄弟而不是子孙。
     */
    /* ⚠️ 确认开着时整卡点击要失效：不掐的话，点「取消」旁边一点就把书打开了 */
    <div className="book-card" data-confirm={confirm ? "" : undefined} onClick={confirm ? undefined : onOpen}>
      {/**
        * 下架：**点两下，第二下就在第一下那个位置上。**
        *
        * ⚠️ 试过两版更大的确认，都撤了：
        *   1. 整张卡换成 `grid-column: 1 / -1` 的横条——点一下删除**整面墙当场重排**，
        *      要删的那本从原地消失、变成一条横在中间的长条。
        *   2. 一张盖住整格的确认卡——墙不动了，但封面和书名被整个遮掉，
        *      而你要确认的正是「是不是这一本」。
        * 现在垃圾桶原地展开成两颗按钮，**封面一直看得见**。
        *
        * ⚠️ **那句「正文和批注一起进 .trash/、能找回来」在这儿放不下，是有意省的。**
        * 这个尺寸里要么放不下、要么把封面盖掉（就是上面第 2 版）。三重保护还在：
        * 要点两下、按钮上**写清东西去哪**（不写「确定吗」）、回执 toast 带撤销。
        * 完整那句留在书详情那一层的下架确认里。
        */}
      {onTrash ? (
        confirm ? (
          <span className="book-card__del book-card__del--confirm" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="book-card__del-go"
              disabled={busy}
              title={`《${book.name}》的正文和你写的批注一起移到 vault 的 .trash/，在 Obsidian 的废纸篓里能找回来`}
              onClick={async () => {
                setBusy(true);
                try {
                  await onTrash();
                } finally {
                  setBusy(false);
                  setConfirm(false);
                }
              }}
            >
              {busy ? "处理中…" : "移到废纸篓"}
            </button>
            <button
              type="button"
              className="icon-btn book-card__del-no"
              title="取消"
              aria-label="取消下架"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              <IconX size={13} stroke={2} aria-hidden="true" />
            </button>
          </span>
        ) : (
          <button
            className="icon-btn book-card__del"
            title="下架这本书"
            aria-label={`下架《${book.name}》`}
            onClick={(e) => {
              e.stopPropagation();   // 不然点删除会顺手把书打开
              setConfirm(true);
            }}
          >
            <IconTrash size={14} stroke={1.7} aria-hidden="true" />
          </button>
        )
      ) : null}
      {/**
        * **封面本身是「打开这本书」，换封面是压在角上的一个小按钮。**
        *
        * 上一版把整块封面做成了换封面的按钮：贴完封面之后再点它，弹出来的还是选图片——
        * 而这时候人想做的显然是读书。封面是这张卡上最大的一块，它该指向主动作。
        * 换封面是偶尔一次的事，配一个角标就够；有封面时只在 hover / 聚焦时出现，
        * 没封面时常驻——那正是最需要被看见的时候。
        */}
      <span className="book-card__cover">
        <Cover book={book} />
        {/* 读完那枚勾。**只在真读完时画**——它说的是「这本可以放下了」，
            而一个恒亮的记号什么都不说。 */}
        {done ? (
          <span className="book-card__done" aria-hidden="true">
            <IconCheck size={12} stroke={2.4} />
          </span>
        ) : null}
        {/* 进度线。`aria-hidden`：同样的信息在下面 `__open` 的 aria-label 里有字面版本，
            读屏读一遍就够，画面上这条是给眼睛的。 */}
        {progress != null ? (
          <span className="book-card__prog" aria-hidden="true">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        ) : null}
        {/**
          * ⚠️ **hover 动作：常用动作不该逼人先进详情页。**
          * 多章的书原来点封面只能进书详情，「接着读」得再点一次。现在两条路都在封面上：
          * 左边接着读（有进度才给）、右边进目录。**它们是 `.book-card` 这个 div 的
          * 子孙而不是某个 button 的**——外壳早就退成普通容器了，所以不构成 button 套 button。
          */}
        <span className="book-card__ov">
          {onResume && saved ? (
            <button
              type="button"
              title={`接着读：${saved.title}`}
              aria-label={`接着读《${book.name}》：${saved.title}`}
              onClick={(e) => (e.stopPropagation(), onResume())}
            >
              <IconBook2 size={16} stroke={1.7} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            title={book.chapterCount > 1 ? "查看章节" : "开始读"}
            aria-label={`${book.chapterCount > 1 ? "查看章节" : "开始读"}：《${book.name}》`}
            onClick={(e) => (e.stopPropagation(), onOpen())}
          >
            {book.chapterCount > 1 ? (
              <IconListDetails size={16} stroke={1.7} aria-hidden="true" />
            ) : (
              <IconBook2 size={16} stroke={1.7} aria-hidden="true" />
            )}
          </button>
        </span>
        {onCover ? (
          <button
            type="button"
            className="book-card__coverbtn"
            title={book.cover ? "换一张封面" : "给这本书加封面"}
            aria-label={`${book.cover ? "换封面" : "加封面"}：《${book.name}》`}
            onClick={(e) => {
              e.stopPropagation();   // 不然点它会顺手把书也打开
              onCover();
            }}
          >
            {book.cover ? <IconPhoto size={13} stroke={1.7} aria-hidden="true" /> : "加封面"}
          </button>
        ) : null}
      </span>
      {/**
        * `__body` 是**普通容器**，主动作是里面那个书名按钮。
        *
        * 不把整块 `__body` 做成按钮：卡上已经有自己的按钮（封面角上的换封面、右下角的
        * 下架），button 套 button 是非法结构。整卡点击仍然留着——那是鼠标的便利，
        * 键盘走书名那个按钮。
        */}
      <div className="book-card__body">
        {/* 封面上那条进度线是给眼睛的，读屏得有字面版本——所以进 aria-label */}
        <button
          type="button"
          className="book-card__open"
          aria-label={saved ? `${book.name}，读到「${saved.title}」${pct(progress ?? 0)}` : book.name}
          onClick={(e) => (e.stopPropagation(), onOpen())}
        >
          {book.name}
        </button>
        {/**
          * 作者**只显示，不给改**。曾经能在这儿点一下就地改，撤掉了：`book.md` 的
          * frontmatter 在 Obsidian 里本来就能直接编辑，而这一格挨着「打开这本书」，
          * 一次误触改的是 vault 里的文件。**同一件事有两个入口时，留那个不会误触的。**
          */}
        <span className="book-card__author">{book.author || "作者未记录"}</span>
        <span className="book-card__stats">
          <span>
            <IconFileText size={13} stroke={1.7} aria-hidden="true" />
            {book.chapterCount ? `${book.chapterCount} 章` : "单篇"}
          </span>
          {book.status ? <span className="tag tag--state" data-tone={stateTone(book.status)}>{book.status}</span> : null}
        </span>
        {saved ? (
          <span className="book-card__resume">
            <IconBookmark size={13} stroke={1.7} aria-hidden="true" />
            读到「{saved.title}」{book.chapterCount > 1 ? `· 全书 ${pct(bookProgress(book, saved))}` : pct(saved.progress)}
          </span>
        ) : null}
        <span className="book-card__enter">
          {saved ? "继续阅读" : book.chapterCount > 1 ? "查看章节" : "开始读"}
          <IconChevronRight size={15} stroke={1.8} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
