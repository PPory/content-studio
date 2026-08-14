/**
 * 书的封面。没有封面图时退成「书本图标 + 书名」，而不是留一块空白——
 * 书架是一面封面墙，空白格子会让人以为那本书没加载出来。
 *
 * **住在 components 而不是 `pages/Shelf.jsx`。** 它有两个调用方：书架和总览那格
 * 「接着读」。原来总览是 `import { Cover } from "./Shelf.jsx"` ——一个页面 import
 * 另一个页面，正是本项目那条「共用件放 `components/`，谁也不该 import 另一个页面的
 * 私有件」说的情况。后果不是报错，是**依赖方向反了**：改书架时得先想一下总览会不会跟着坏。
 */

import { api } from "../lib/api.js";
import { IconBook2 } from "./icons.jsx";

export function Cover({ book, size = "" }) {
  return (
    <span className={`cover ${size}`}>
      {book.cover ? (
        <img src={api.imageUrl(book.cover)} alt="" loading="lazy" />
      ) : (
        <span className="cover__fallback">
          <IconBook2 size={size === "cover--sm" ? 22 : 30} stroke={1.3} aria-hidden="true" />
          <small>{book.name}</small>
        </span>
      )}
    </span>
  );
}
