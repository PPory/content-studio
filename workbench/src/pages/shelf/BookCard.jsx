// 书架墙上的一张书卡。从 `pages/Shelf.jsx` 搬出来，函数体一字未动。
//
// 换封面**只有这张卡角上那一个入口**（`.book-card__coverbtn`）。书详情那一层曾经
// 把整块封面做成换封面的按钮，但那一页最常做的事是读书，误触换来的是一个文件对话框；
// 而且单篇书压根不经过书详情，卡片上这个才是主要入口。

import { useMemo, useState } from "react";
import { Cover } from "../../components/Cover.jsx";
import { IconBookmark, IconChevronRight, IconFileText, IconPhoto, IconTrash } from "../../components/icons.jsx";
import { bookProgress, pct, readingOf } from "../../lib/reading.js";
import { stateTone } from "../../components/ui.jsx";

export function BookCard({ book, tick, onOpen, onTrash, onCover }) {
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

  // 确认态把整张卡换掉，不是在角落加个小按钮：下架一本书连着批注一起走，
  // 这个动作值得占满一张卡的注意力。
  if (confirm) {
    return (
      <div className="book-card book-card--confirm">
        <Cover book={book} size="cover--sm" />
        <div className="book-card__body">
          <strong>下架《{book.name}》？</strong>
          <span className="book-card__author">
            整个目录（正文 + 你写的批注）移到 vault 的 <code>.trash/</code>，
            在 Obsidian 的废纸篓里能找回来。
          </span>
          <div className="row-actions" style={{ marginTop: 8 }}>
            <button
              className="btn btn-sm btn-danger"
              disabled={busy}
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
            <button className="btn btn-sm" disabled={busy} onClick={() => setConfirm(false)}>取消</button>
          </div>
        </div>
      </div>
    );
  }

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
     * 改法和内容工作台那边的 `DocCard` 一致：**外壳退成普通容器，主动作是里面
     * 那个真按钮**（书名 + 元信息那一整块）。整卡点击留着——那是鼠标的便利，
     * 不需要 role 也成立；`.book-card__del` / `__coverbtn` 于是成了它的兄弟而不是子孙。
     */
    <div className="book-card" onClick={onOpen}>
      {onTrash ? (
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
        <button type="button" className="book-card__open" onClick={(e) => (e.stopPropagation(), onOpen())}>
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
