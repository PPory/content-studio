// 书详情：封面 + 元信息 + 「我在这本书里留下了什么」+ 章节目录。
//
// 它是书架三层动线（封面墙 → 书详情 → 阅读区）的中间那层：一本书有几十份文档，
// 必须有个地方让你挑章节。单篇书跳过这一层。
//
// ⚠️ **这一页的主角会变，判据是「这本书里有没有标记」**（`hasMarks`）：
//
//   - **没有标记**（还没读过）→ 章节目录占满整栏。这时候章节就是这本书的全部内容。
//   - **有标记**（读过了）→ 标记占主栏，章节退到右边那条 300px 上。
//
// 理由是**这一页被打开的原因变了**：第一次打开是「从哪儿开始读」，此后每一次
// 都是「我上次划的那句在哪」。一列文件名摆在最显眼的位置，等于让这一页永远停在
// 第一次打开时的样子；而给一本还没读过的书画一个空的「我的标记」大栏，
// 是把版面让给了一句「这里什么都没有」。**版面跟着内容走，不跟着页面名字走。**
// 和「只在真有两组以上时才分组」「没有书签时整块不出现」是同一条判据。

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import { Cover } from "../../components/Cover.jsx";
import { Empty, ErrorNote, Loading, MetaItem, SearchBox, Select } from "../../components/ui.jsx";
import { BookMarks } from "./BookMarks.jsx";
import {
  IconArrowLeft,
  IconBook2,
  IconBookmark,
  IconChevronRight,
  IconFileText,
  IconSearch,
  IconTrash,
} from "../../components/icons.jsx";
import { bookmarksOf, pct, readingOf } from "../../lib/reading.js";

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

export function BookDetail({ book, entries, onBack, onOpen, onTrash, onKind, onIntake }) {
  const saved = readingOf(book.dir);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState(null);   // null = 没在搜，[] = 搜了没结果
  const [marks, setMarks] = useState(null); // null = 还在读
  const [marksError, setMarksError] = useState(null);
  const bookmarks = bookmarksOf(book.dir);

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

  /**
   * 读这本书的标记。⚠️ **读失败不能把章节目录一起带走**——那是这一页的退路，
   * 而标记读不出来是个能说清楚的意外（文件被改名、权限）。所以失败时照实说一句，
   * 版面退回「章节占满」那一种，人还能接着读书。
   */
  useEffect(() => {
    let dead = false;
    setMarks(null);
    setMarksError(null);
    api
      .bookMarks(book.dir)
      .then((r) => !dead && setMarks(r))
      .catch((e) => {
        if (dead) return;
        setMarksError(e);
        setMarks({ chapters: [], total: 0 });
      });
    return () => {
      dead = true;
    };
  }, [book.dir]);

  // 右栏每一章后面那颗点：这一章里有几条标记。**没有的不画点**，不画一个恒空的位置
  const markCount = useMemo(() => {
    const m = new Map();
    for (const ch of marks?.chapters || []) if (ch.path) m.set(ch.path, ch.items.length);
    return m;
  }, [marks]);

  const resumeEntry = saved && entries.find((e) => e.path === saved.docPath);
  const first = entries[0];
  const multi = entries.length > 1;
  const hasMarks = Boolean(marks?.total);
  const jump = (path) => onOpen(entries.find((e) => e.path === path) || entries[0]);

  // 书签就是「等会儿回这儿」，所以它跟着章节走——章节在哪一栏它就在哪一栏。
  // 没有书签时整块不出现：空的收藏夹只是噪音。
  const bookmarkBlock = bookmarks.length ? (
    <div className="bookmarks">
      <span className="rail-label">
        <IconBookmark size={12} stroke={1.8} aria-hidden="true" />
        书签 {bookmarks.length}
      </span>
      <div className="row-actions">
        {bookmarks.map((b) => (
          <button key={b.docPath} className="btn btn-sm" onClick={() => jump(b.docPath)}>
            {b.title}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  /**
   * 章节列表。同一批 DOM 两种密度，靠 `rail` 一个参数切——**不写第二套章节行**
   * （和侧栏收起态同一条：写两套的话，改一次章节行要改两处）。
   * 右栏那条 300px 装不下「阅读 ›」那一列，所以它换成一颗「这章有几条标记」的记号；
   * 而那正是在标记主导的版面上，你扫这一列时真正想知道的事。
   */
  const chapterList = (rail) => (
    <div className="chapter-list" data-rail={rail ? "" : undefined}>
      {entries.map((e) => {
        const n = markCount.get(e.path) || 0;
        return (
          <button
            key={e.path}
            className="chapter-row"
            aria-current={saved?.docPath === e.path}
            onClick={() => onOpen(e, { resume: saved?.docPath === e.path })}
          >
            <span className="chapter-row__num">{String(e.order).padStart(2, "0")}</span>
            <span className="chapter-row__title">{e.title}</span>
            {rail ? (
              n ? (
                <span className="chapter-row__marks" title={`这一章有 ${n} 条标记`}>{n}</span>
              ) : null
            ) : (
              <span className="chapter-row__go">
                {saved?.docPath === e.path ? `${pct(saved.progress)} · 继续` : "阅读"}
                <IconChevronRight size={15} stroke={1.8} aria-hidden="true" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  // 搜到的直接列命中句：只给章节名的话，还得一章章点进去找
  const searchResults = hits?.length ? (
    <div className="booksearch">
      {hits.map((r) =>
        r.hits.map((h, i) => (
          <button key={`${r.path}-${i}`} className="booksearch__hit" onClick={() => jump(r.path)}>
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
  );

  /**
   * ⚠️ **不给这几块配英文眉标。** 试过 `MY MARKS` / `TABLE OF CONTENTS` / `SEARCH`，
   * 全是正下方那个中文标题的英文转写——设计系统里早就否决过这种眉标：
   * 正下方就是同一个词，占的却是整块的第一行。
   */
  const head = hits
    ? { title: "搜索结果", count: `${hits.length} 章命中` }
    : hasMarks
      ? { title: "我的标记", count: `${marks.total} 条 · 按章排` }
      : { title: "章节目录", count: `${entries.length} 章` };

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
          {/* 原来这儿有一行 `CURRENT BOOK`。你是点着一本书的封面进来的，
              用不着再有一行英文说「这是当前这本书」——同一条否决理由。 */}
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

      {multi ? (
        <section className="panel-block">
          <div className="panel-head">
            <div className="panel-head__main">
              <h2>
                {head.title}
                <span className="panel-head__count">{head.count}</span>
              </h2>
            </div>
            <div className="panel-head__aside">
              <SearchBox value={q} onChange={setQ} placeholder="在这本书里搜一句话" />
            </div>
          </div>

          <ErrorNote error={marksError} what="读取这本书的标记" />

          {/**
            * ⚠️ **拿不准主角是谁之前不画。** 标记读回来才知道这一页该长成哪一种，
            * 先按其中一种画出来、几十毫秒后再换一种，用户看到的是版面自己跳了一下。
            * 骨架屏在这儿是**便宜的**：本地读文件，而且这一跳是没法靠 CSS 抹平的。
            */}
          {marks === null ? (
            <Loading rows={3} />
          ) : hits ? (
            searchResults
          ) : hasMarks ? (
            <div className="shelf-cols">
              <div>
                <BookMarks
                  chapters={marks.chapters}
                  bookName={book.name}
                  onJump={jump}
                  onIntake={onIntake}
                />
              </div>
              <aside className="ch-rail">
                <div className="ch-rail__head">
                  <h3>章节</h3>
                  <em>{entries.length}</em>
                </div>
                {bookmarkBlock}
                {chapterList(true)}
              </aside>
            </div>
          ) : (
            /**
              * ⚠️ **没有标记时什么都不说。** 这儿试过在章节目录底下挂一句
              * 「读的时候划一句就能标记」的引导——它会出现在**每一本还没读过的书**上，
              * 而且一直挂着。`每个都说的话等于没说`：那句引导真正该出现的地方是
              * 划词工具条本身，它已经在正文里等着了。
              */
            <>
              {bookmarkBlock}
              {chapterList(false)}
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
