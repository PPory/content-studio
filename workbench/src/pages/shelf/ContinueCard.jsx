// 书架顶部那张「继续阅读」。
//
// 从 `pages/Shelf.jsx` 搬出来的，函数体一字未动——那个文件里
// `Shelf` 一个函数就有 596 行，展示件和编排混在一起，改哪儿都要先翻半天。

import { useMemo } from "react";
import { Cover } from "../../components/Cover.jsx";
import { IconArrowRight } from "../../components/icons.jsx";
import { bookProgress, pct, recentReadings, resumeEntry } from "../../lib/reading.js";

/**
 * 书架顶部左栏「正在阅读」。绝大多数时候，打开书架就是想接着读。
 *
 * ⚠️ **列两条，不是一条。** 同时读两本是常态（一本正经书 + 一本随手翻的），
 * 只给最近那一条的话，另一本每次都要去墙上找。
 * **有几本给几本，不凑数**（`recentReadings` 那条注释）：只读过一本就只显示一本，
 * 剩下的空着——拿书架上没动过的书填那块空白，等于把「你正在读这些」
 * 变成「书架上有这些」，而后者下面那面墙自己就是。
 *
 * ⚠️ **进度指的那份文件可能已经不在这本书里了**（书重新导入过、章节改了名），
 * `resumeEntry` 那时返回 null，这一条**整条不画**——宁可少一条，
 * 也不给一个点了打不开的入口。
 */
export function ContinueCard({ books, tick, onResume }) {
  const rows = useMemo(
    () =>
      recentReadings(books, 2)
        .map(({ book, reading }) => ({ book, reading, entry: resumeEntry(book, reading) }))
        .filter((r) => r.entry),
    [books, tick]
  );
  if (!rows.length) return null;

  return (
    <section className="shelf-top__col">
      <h3 className="shelf-top__label">正在阅读</h3>
      {rows.map(({ book, reading, entry }) => (
      /**
       * ⚠️ **标题在卡片外面**，和右栏「最近标注」用同一套 `.shelf-top__label`——
       * 两栏的标题因此落在同一条基线上。原来那句 `CURRENTLY READING` 是**标题的英文
       * 转写**，还长在卡片里面：设计系统里早就否决过这种眉标（正下方就是同一个词）。
       * **整块不画时标题跟着一起不画**，所以标题属于这个组件、不属于调用方。
       */
      <button key={book.dir} className="continue" onClick={() => onResume(book, entry)}>
      <Cover book={book} size="cover--sm" />
      <span className="continue__body">
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
      ))}
    </section>
  );
}
