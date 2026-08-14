// 书详情：封面 + 元信息 + 章节目录。从 `pages/Shelf.jsx` 搬出来，函数体一字未动。
//
// 它是书架三层动线（封面墙 → 书详情 → 阅读区）的中间那层：一本书有几十份文档，
// 必须有个地方让你挑章节。单篇书跳过这一层。

import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { Cover } from "../../components/Cover.jsx";
import { Empty, MetaItem, Select } from "../../components/ui.jsx";
import {
  IconArrowLeft,
  IconBook2,
  IconBookmark,
  IconChevronRight,
  IconFileText,
  IconSearch,
  IconTrash,
} from "../../components/icons.jsx";
import { bookmarksOf, pct, readingOf, resumeEntry } from "../../lib/reading.js";

// 书详情：封面 + 元信息 + 章节目录。单文件书没有目录，直接一个「开始读」。
/**
 * 类型的记号**靠形状区分，不靠颜色**（和状态图标同一条规矩）：
 * 一张纸 = 自己攒的资料，一本书 = 别人写的书。
 *
 * 必须传 `renderIcon`——`Select` 默认那枚是**状态**图标，给「藏书」配一个
 * 「虚线圈 = 等我动手」纯属答非所问。
 */
const KIND_ICONS = { 资料: IconFileText, 藏书: IconBook2 };
const kindIcon = (k) => {
  const I = KIND_ICONS[k] || IconBook2;
  return <I size={15} stroke={1.8} aria-hidden="true" />;
};

export function BookDetail({ book, entries, onBack, onOpen, onTrash, onKind }) {
  const saved = readingOf(book.dir);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState(null);   // null = 没在搜，[] = 搜了没结果
  const marks = bookmarksOf(book.dir);

  // 搜索去服务端读文件，所以要防抖——每敲一个字打一次请求会把几十个文件反复读一遍。
  // 两个字以下不搜：中文单字命中率太高，出来的全是噪音。
  useEffect(() => {
    const key = q.trim();
    if (key.length < 2) return setHits(null);
    let dead = false;
    const t = setTimeout(() => {
      api
        .searchBook(book.dir, key)
        .then((r) => !dead && setHits(r.results))
        .catch(() => !dead && setHits([]));
    }, 260);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [q, book.dir]);
  const resumeEntry = saved && entries.find((e) => e.path === saved.docPath);
  const first = entries[0];

  return (
    <>
      <button className="btn btn-sm" onClick={onBack} style={{ marginBottom: 14 }}>
        <IconArrowLeft aria-hidden="true" stroke={1.8} />
        返回书架
      </button>

      <section className="book-hero">
        {/* 这儿的封面**不是换封面的按钮**：整块封面点下去弹文件选择器，而这一页最常做的事
            是读书，一次误触换来的是一个文件对话框。换封面的入口在书架卡片的角标上——
            那也是主要入口（单篇书压根不经过这一层）。 */}
        <Cover book={book} />
        <div className="book-hero__body">
          <span className="eyebrow">CURRENT BOOK</span>
          <h1>{book.name}</h1>
          {/**
            * 元信息和动作**贴着封面底边**，不跟着书名长短上下浮动。
            *
            * 书名有一行的也有三行的（中文书名动辄二十几个字），跟在标题后面排的话，
            * 「继续读」这个每次都要点的按钮就会在每本书里落在不同高度——而这一层的
            * 用处只有一个：接着读。它该永远在同一个位置等你。
            *
            * 元信息走**和阅读区同一套** `.doc-meta`（`MetaItem` 在 ui.jsx）。
            * 上一版是一排等宽大写的小药丸，两个毛病：等宽包里没有中文字形，「在读」
            * 直接掉进系统回退，字重字宽和整页所有字都对不上；而「作者」自己还另占一行、
            * 没有字段名也没有图标——同一屏里于是有了两种「元信息长什么样」。
            */}
          <div className="book-hero__foot">
            <div className="doc-meta">
              {/* 类型排在最前面，和阅读区那一行的状态下拉同一个位置：
                  它是这一行里唯一能点的东西，位置固定人才不用每次找 */}
              {onKind ? (
                <Select
                  value={book.kind || "资料"}
                  options={["资料", "藏书"]}
                  onChange={onKind}
                  renderIcon={kindIcon}
                  ariaLabel="改这本书的类型"
                  title="资料是自己攒的，正文可以边读边改；藏书是别人写的，正文只读——改了它，从书里摘的引用就不可信了"
                />
              ) : null}
              <MetaItem name="作者" value={book.author || "未记录"} />
              <MetaItem name="章节" value={book.chapterCount ? `${book.chapterCount} 章` : "单篇"} />
              <MetaItem name="状态" value={book.status} />
              <MetaItem name="导入" value={book.importedAt} />
              <MetaItem name="标签" value={book.tags?.length ? book.tags.join("、") : ""} />
            </div>
            <div className="row-actions">
              <button
                className="btn btn-primary"
                onClick={() => onOpen(resumeEntry || first, { resume: !!resumeEntry })}
                disabled={!first}
              >
                <IconBook2 aria-hidden="true" stroke={1.8} />
                {resumeEntry ? `继续读「${resumeEntry.title}」· ${pct(saved.progress)}` : "从头开始读"}
              </button>
              {/* 下架排在最右、离「开始读」最远，而且要点两下 */}
              {onTrash ? (
                confirm ? (
                  <>
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await onTrash();
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {busy ? "处理中…" : "移到 vault 的废纸篓"}
                    </button>
                    <button className="btn btn-sm" disabled={busy} onClick={() => setConfirm(false)}>取消</button>
                  </>
                ) : (
                  <button className="btn btn-sm btn-quiet" onClick={() => setConfirm(true)}>
                    <IconTrash aria-hidden="true" stroke={1.7} />
                    下架
                  </button>
                )
              ) : null}
            </div>
          </div>
          {/* 这里原来有一行「正文在 书架/xxx/，批注写进 notes.md」。删掉的理由：
              路径就是上面那个大标题（书名 = 目录名），等于把标题又说了一遍，而这本书的
              书名有二十几个字，那一行自己就要占两行；批注去哪则在**真正要写批注的时候**
              由阅读区的 annotateLabel 如实说明——说明该出现在动作旁边，不是提前打招呼。 */}
        </div>
      </section>

      {entries.length > 1 ? (
        <section className="panel-block">
          <div className="panel-head">
            <div className="panel-head__main">
              <span className="eyebrow">TABLE OF CONTENTS</span>
              <h2>
                {hits ? "搜索结果" : "章节目录"}
                <span className="panel-head__count">{hits ? `${hits.length} 章命中` : `${entries.length} 章`}</span>
              </h2>
            </div>
            <div className="panel-head__aside">
              <label className="search-box">
                <IconSearch aria-hidden="true" stroke={1.7} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="在这本书里搜一句话"
                  onKeyDown={(e) => e.key === "Escape" && setQ("")}
                />
              </label>
            </div>
          </div>

          {/* 搜到的直接列命中句：只给章节名的话，还得一章章点进去找 */}
          {hits ? (
            hits.length ? (
              <div className="booksearch">
                {hits.map((r) =>
                  r.hits.map((h, i) => (
                    <button
                      key={`${r.path}-${i}`}
                      className="booksearch__hit"
                      onClick={() => onOpen(entries.find((e) => e.path === r.path) || entries[0])}
                    >
                      <span className="booksearch__where">
                        <b>{r.title}</b>
                        <IconChevronRight size={13} stroke={1.8} aria-hidden="true" />
                      </span>
                      <span className="booksearch__line">
                        {h.text.slice(0, h.at)}
                        <mark>{h.text.slice(h.at, h.at + h.len)}</mark>
                        {h.text.slice(h.at + h.len)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <Empty icon={IconSearch}>这本书里没有「{q}」</Empty>
            )
          ) : (
          <>
          {/* 书签就是「等会儿回这儿」，所以它该在**挑章节的地方**露面，不是另开一页。
              没有书签时整块不出现——空的收藏夹只是噪音。 */}
          {marks.length ? (
            <div className="bookmarks">
              <span className="rail-label">
                <IconBookmark size={12} stroke={1.8} aria-hidden="true" />
                书签 {marks.length}
              </span>
              <div className="row-actions">
                {marks.map((b) => (
                  <button
                    key={b.docPath}
                    className="btn btn-sm"
                    onClick={() => onOpen(entries.find((e) => e.path === b.docPath) || entries[0])}
                  >
                    {b.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="chapter-list">
            {entries.map((e) => (
              <button
                key={e.path}
                className="chapter-row"
                aria-current={saved?.docPath === e.path}
                onClick={() => onOpen(e, { resume: saved?.docPath === e.path })}
              >
                <span className="chapter-row__num">{String(e.order).padStart(2, "0")}</span>
                <span className="chapter-row__title">{e.title}</span>
                <span className="chapter-row__go">
                  {saved?.docPath === e.path ? `${pct(saved.progress)} · 继续` : "阅读"}
                  <IconChevronRight size={15} stroke={1.8} aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
          </>
          )}
        </section>
      ) : null}
    </>
  );
}
