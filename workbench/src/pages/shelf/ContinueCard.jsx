// 书架顶部那张「继续阅读」。
//
// 从 `pages/Shelf.jsx` 搬出来的，函数体一字未动——那个文件里
// `Shelf` 一个函数就有 596 行，展示件和编排混在一起，改哪儿都要先翻半天。

import { useMemo } from "react";
import { Cover } from "../../components/Cover.jsx";
import { IconArrowRight } from "../../components/icons.jsx";
import { bookProgress, latestReading, pct, resumeEntry } from "../../lib/reading.js";

// 顶部那张「继续阅读」。书架上最有用的一个按钮：绝大多数时候，打开书架就是想接着读。
export function ContinueCard({ books, tick, onResume }) {
  const latest = useMemo(() => latestReading(books), [books, tick]);
  if (!latest) return null;
  const { book, reading } = latest;
  const entry = resumeEntry(book, reading);
  if (!entry) return null;

  return (
    <button className="continue" onClick={() => onResume(book, entry)}>
      <Cover book={book} size="cover--sm" />
      <span className="continue__body">
        <span className="eyebrow">CURRENTLY READING</span>
        <strong>{book.name}</strong>
        <span className="continue__where">
          上次读到「{entry.title}」· 本章 {pct(reading.progress)}
          {book.chapterCount > 1 ? ` · 全书 ${pct(bookProgress(book, reading))}` : ""}
        </span>
        {/* 进度条画的是**整本**：本章百分之多少已经写在上面那行了，
            两个地方显示同一个数字等于白占一条 */}
        <span className="continue__bar" aria-hidden="true">
          <span style={{ width: pct(bookProgress(book, reading)) }} />
        </span>
      </span>
      <span className="continue__go">
        回到上次位置
        <IconArrowRight size={16} stroke={1.8} aria-hidden="true" />
      </span>
    </button>
  );
}
