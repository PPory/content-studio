// 书架：三层动线，和流水线那几个库不是一回事，所以不复用 Studio。
//
//   **书架**    封面墙。一本书一张封面 + 作者 + 章数 + 上次读到哪。顶部一张「继续阅读」。
//   **书详情**  封面 + 元信息 + 章节目录。这一层回答「这本书有什么、我该从哪儿接着读」。
//   **阅读区**  正文 + 左栏章节导航 + 顶部进度条 + 右栏批注台（共用 ReaderOverlay）。
//
// 为什么书要多这一层而流水线的库不用：一条素材就是一份文档，点开就该看正文；
// 一本书是几十份文档，中间必须有个地方让你挑章节。少了这一层，点开一本书只能
// 从第一章开始读，读到第 30 章想回头查第 5 章就没路了。
//
// 参考 person_dashboard 的书架：封面墙、CURRENTLY READING、章节目录带序号、
// 每章读到百分之多少。它那套的核心不是好看，是**让你能随时接着上次读**。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SHELF } from "../lib/sources.js";
import { api } from "../lib/api.js";
import { noteOpened } from "../lib/recent.js";
import { takeOpenTarget } from "../lib/open-target.js";
import { useAiRuns } from "../lib/use-ai-runs.js";
import { ReaderOverlay } from "../components/ReaderOverlay.jsx";
// 展示件搬进 pages/shelf/。**页面只留组合和状态边界**——
// 这一个文件原来 1200 行、其中 `Shelf` 一个函数就占 596 行。
import { ContinueCard } from "./shelf/ContinueCard.jsx";
import { RecentMarks } from "./shelf/RecentMarks.jsx";
import { BookCard } from "./shelf/BookCard.jsx";
import { BookDetail } from "./shelf/BookDetail.jsx";
import { ShelfActions } from "./shelf/ShelfActions.jsx";
import { ErrorNote, Empty, Loading, Note, PageHeader, SearchBox, Toast } from "../components/ui.jsx";
import { bookProgress, bookmarksOf, contextOf, isBookmarked, latestReading, pct, readingOf, resumeEntry, saveReading, toggleBookmark } from "../lib/reading.js";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBook2,
  IconBookmark,
  IconBooks,
  IconChevronRight,
  IconFileImport,
  IconFileText,
  IconPhoto,
  IconPlus,
  IconTrash,
} from "../components/icons.jsx";

const KIND_HINTS = {
  书籍: "别人写的书",
  课程: "成体系的课，按节读",
  文档: "单篇资料",
  文章: "自己写的",
};

/**
 * 书架 / 资料。**同一个阅读器，两个入口**——差别只在放哪一类来源进来。
 *
 * ⚠️ `sourceKinds` 是**知识库的归类**（书籍 / 课程 / 文档 / 文章），
 * 和每本书那个「藏书 / 资料」不是一回事：后者管正文能不能改（引用可信度），
 * 一门课同样是只读的。两个维度正交，不要合并。
 */
export function Shelf({ onIntake, state = "", sourceKinds = null, catalogOnly = false }) {
  const [list, setList] = useState(null);
  const [listError, setListError] = useState(null);
  const [query, setQuery] = useState("");
  const [book, setBook] = useState(null);      // 打开的那本（书详情层）
  const [reading, setReading] = useState(null); // { item, initialScroll } 阅读层
  const [doc, setDoc] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState(null);
  const [progressTick, setProgressTick] = useState(0); // 进度变了要重画卡片上的「上次读到」
  const [toast, setToast] = useState(null);   // { text, undo? }

  const [coverFor, setCoverFor] = useState(null);   // 正在给哪本换封面
  const coverRef = useRef(null);
  const [highlights, setHighlights] = useState([]);
  const [marked, setMarked] = useState(0);   // 书签变了要重画顶栏那颗星
  const [railMode, setRailMode] = useState("notes");
  const [outline, setOutline] = useState([]);
  const [quote, setQuote] = useState("");
  const [assistantPrompt, setAssistantPrompt] = useState(null);
  const [assistantHandoff, setAssistantHandoff] = useState(null);
  const askAssistant = useCallback((text) => {
    setAssistantPrompt({ id: `reader-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`, text });
  }, []);
  const resumedRef = useRef(false);   // `#/shelf/resume` 只认一次，见下面那个 effect
  /**
   * 从别处深链进来时，「返回」该回到**来的地方**，不是书架。
   *
   * ⚠️ 从词条详情点「打开来源」进来，按钮却写「返回书架」——而这份资料是「文档」
   * 不是「书籍」，书架列表里**根本没有它**。点回去落在一个不含它的列表上，
   * 比不给返回按钮更让人困惑。
   */
  const [returnTo, setReturnTo] = useState(null);   // { label, hash }

  // 划词 AI 那一套（攒结果、中止、翻译）三处共用一个 hook，见 lib/use-ai-runs.js
  const { ai, runAi, translate, stopAi, resetAi } = useAiRuns({
    title: reading?.item.title || "",
    onStart: useCallback((text) => {
      setQuote(text);
      setRailMode("ai");
    }, []),
  });

  const reload = useCallback(() => {
    setList(null);
    setListError(null);
    SHELF.list().then(setList).catch(setListError);
  }, []);

  useEffect(reload, [reload]);

  /**
   * 改一本书的类型（资料 / 藏书）。
   *
   * 就地改两处状态而不是整表重拉：`reload()` 会把 list 先设成 null，
   * 界面闪一下骨架屏——而这只是翻了一个字段。
   */
  const changeKind = useCallback(async (b, kind) => {
    try {
      await api.setBookKind(b.dir, kind);
      setBook((cur) => (cur && cur.dir === b.dir ? { ...cur, kind } : cur));
      setList((cur) =>
        cur
          ? { ...cur, items: cur.items.map((it) => (it.key === b.dir ? { ...it, raw: { ...it.raw, kind } } : it)) }
          : cur
      );
      setToast({ text: kind === "资料" ? `《${b.name}》改成资料，正文可以改了` : `《${b.name}》改成藏书，正文只读` });
    } catch (e) {
      setToast({ text: `改类型失败：${e.message}` });
    }
  }, []);

  const books = useMemo(() => {
    const all = (list?.items || []).map((it) => it.raw);
    // 归类缺省当「书籍」：0007 之前导进来的书没有这一列，不该因此从书架上消失。
    const items = sourceKinds ? all.filter((b) => sourceKinds.includes(b.sourceKind || "书籍")) : all;
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((b) => [b.name, b.author, ...(b.tags || [])].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [list, query, sourceKinds]);

  // 一本书的「文档」列表：多章书是各章，单文件书就 book.md 一份
  const docsOf = useCallback(
    (b) =>
      b.chapters?.length
        ? b.chapters.map((c) => ({ key: c.path, title: c.title, order: c.order, path: c.path }))
        : [{ key: b.bookPath, title: b.name, order: 1, path: b.bookPath }],
    []
  );

  const openDoc = useCallback(
    (b, entry, { resume = false, detail = true, evidenceQuote = "" } = {}) => {
      const saved = readingOf(b.dir);
      const item = {
        key: `${b.dir}::${entry.path}`,
        title: entry.title,
        crumb: b.name,
        badge: b.status,
        tags: b.tags,
        time: null,
        meta: { 作者: b.author, 状态: b.status },
        raw: { ...b, docPath: entry.path },
      };
      setBook(b);
      // 「最近打开」记的是**这一章**，不是这本书：回来时该落在你上次读的那一章上
      noteOpened({
        id: `book:${b.dir}::${entry.path}`,
        type: "book",
        typeLabel: "书",
        title: entry.title === b.name ? b.name : `${b.name} · ${entry.title}`,
        source: b.author || "",
        // 带上章节路径：书架那个 effect 会用它直接开那一章，
        // 不带的话点回去只是「按进度继续读」，而你要回的是刚看的这一章
        go: { view: "shelf", state: b.dir, open: entry.path },
      });
      setReading({
        item,
        entry,
        detail,   // 关掉阅读区之后退回哪一层：书详情，还是直接回书架
        initialScroll: resume && saved?.docPath === entry.path ? saved.scrollTop : 0,
        evidenceQuote,
      });
      setDoc(null);
      setOutline([]);
      setDocError(null);
      setDocLoading(true);
      resetAi();
      setRailMode("notes");
      setAssistantPrompt(null);
      SHELF.load(item).then(setDoc).catch(setDocError).finally(() => setDocLoading(false));
      // 高亮跟着这一章走。取不到就是没有，不该让整页报错
      const hp = SHELF.highlightPath(item);
      setHighlights([]);
      if (hp) api.highlights(hp).then((r) => setHighlights(r.highlights)).catch(() => setHighlights([]));
    },
    [resetAi]
  );

  /**
   * 从「最近标注」那一条跳到它所在的正文。
   *
   * ⚠️ **跳不过去就什么都不做，不要退而求其次打开这本书的第一章。**
   * 那种兜底看起来友好，实际是把「我要看这句话在哪」变成了「莫名其妙打开了另一章」——
   * 而用户不会知道发生了什么。跳不了的情况本来就只有一种（批注定位不到章节），
   * 而那种条目在界面上已经标着「未定位」了，点不动是**说得通**的。
   */
  const openDocByPath = useCallback(
    (mark) => {
      if (!mark?.bookDir || !mark?.path) return;
      const b = (list?.items || []).map((it) => it.raw).find((x) => x.dir === mark.bookDir);
      if (!b) return;
      const entry = docsOf(b).find((d) => d.path === mark.path);
      if (!entry) return;
      openDoc(b, entry, { resume: false, detail: false });
    },
    [list, docsOf, openDoc]
  );

  /**
   * 带着落点进书架：总览那格「接着读」直接进正文，而不是把人丢在书架列表上再点一次。
   *
   * 两种落点：`#/shelf/resume` 是「最近读的那本」；`#/shelf/<book.dir>` 是**指定的某一本**
   * ——总览那格现在列两本，只有第一本点得对是最没道理的坏交互。dir 里有斜杠，
   * 但 `go()` 会 `encodeURIComponent`、`readHash()` 先切段再解码，正好还原。
   *
   * **只认一次**（`resumedRef`）：书列表会因为回写进度、换封面而重新加载，每次都重开
   * 阅读区的话，关掉它会立刻又被弹回来。开完把地址换回 `#/shelf`，用 `replaceState`
   * 而不是改 `location.hash`——后者会触发 hashchange 再走一轮路由。
   */
  useEffect(() => {
    if (!state || resumedRef.current || !list) return;
    resumedRef.current = true;
    window.history.replaceState(null, "", "#/shelf");
    const all = (list.items || []).map((it) => it.raw);
    const target =
      state === "resume"
        ? latestReading(all)
        : (() => {
            const book = all.find((b) => b.dir === state);
            const r = book && readingOf(book.dir);
            return r ? { book, reading: r } : null;
          })();
    /**
     * 全局检索搜到的是**某一章**时，交接条上带着那一章的 vault 路径——
     * 直接开那一章，而不是把人扔在书详情上从五十九章里再找一遍。
     * 找不到（书重新导入过、章节文件换了名字）就退回「按进度继续读」，
     * 不是弹一个空的阅读区。
     */
    // 和 `shelf` 那张交接条同源：谁把人送过来，谁顺手写下「返回哪儿」。
    const back = takeOpenTarget("shelf-return");
    if (back) { const [label, hash] = back.split("|"); setReturnTo({ label, hash }); }
    const want = takeOpenTarget("shelf");
    if (want) {
      const path = typeof want === "string" ? want : want.path;
      const book = all.find((b) => b.dir === state) || target?.book;
      const chapter = book && docsOf(book).find((c) => c.path === path);
      if (book && chapter) return openDoc(book, chapter, { detail: book.chapterCount > 1, evidenceQuote: typeof want === "object" ? want.quote : "" });
    }
    const entry = target && resumeEntry(target.book, target.reading);
    if (entry) openDoc(target.book, entry, { resume: true, detail: target.book.chapterCount > 1 });
  }, [state, list, openDoc, docsOf]);

  const closeDoc = useCallback(() => {
    resetAi();
    setAssistantPrompt(null);
    // 单篇书是从书架直接打开的，没经过书详情那一层，关掉当然要回书架
    if (reading && !reading.detail) setBook(null);
    setReading(null);
    setDoc(null);
    setProgressTick((n) => n + 1);
  }, [reading, resetAi]);

  // 下架一本书：整个目录移进 vault 的 .trash/，不是删掉——里面有你自己写的批注
  const trash = useCallback(
    async (b) => {
      const moved = await api.trashBook(b.dir);
      setBook(null);
      // 回执上带撤销：点错一下的成本应该是再点一下，不是打开 Obsidian 翻废纸篓
      setToast({
        text: `《${b.name}》已下架，已移入当前本地工作区回收站`,
        undo: async () => {
          await api.restoreBook(moved.from, moved.to);
          setToast(null);
          reload();
        },
      });
      reload();
    },
    [reload]
  );

  // 带撤销的多留一会儿：8 秒是「读完一句话再决定」需要的时间，2 秒只够看见有东西闪过
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // 进度：滚一下就记一次会把 localStorage 写爆，节流到 1 秒
  const lastSave = useRef(0);
  const onProgress = useCallback(
    ({ progress, scrollTop }) => {
      if (!reading || !book) return;
      const now = Date.now();
      if (now - lastSave.current < 1000) return;
      lastSave.current = now;
      saveReading(book.dir, { docPath: reading.entry.path, title: reading.entry.title, scrollTop, progress });
    },
    [reading, book]
  );

  // ---- 批注 / AI（和内容工作台同一套，差异全在 SHELF 适配器里） ----

  // 划词 AI 那一套（攒结果、中止、翻译）三处共用一个 hook，见 lib/use-ai-runs.js

  const saveNote = useCallback(
    async ({ quote: q, body }) => {
      const r = await SHELF.annotate(reading.item, { quote: q, body });
      setDoc((d) => (d ? { ...d, notes: r.notes ?? d.notes, noteItems: r.noteItems ?? d.noteItems } : d));
      setRailMode("notes");
    },
    [reading]
  );

  /**
   * 改一条 / 删一条批注。**批注写下之后必须能改能删**——写错一个字就只能去 Obsidian
   * 翻文件改，这在自己的工作台里说不过去。落地仍是整份重写那个 notes.md（服务端做），
   * 带时间戳做乐观锁：文件在 Obsidian 里被动过就 409，宁可让人刷新也不硬覆盖。
   */
  const noteFile = reading ? SHELF.notePath(reading.item) : "";
  const editNote = useCallback(
    async (note, body) => {
      const r = await api.editNote(noteFile, note.index, note.stamp, body);
      setDoc((d) => (d ? { ...d, notes: r.notes, noteItems: r.noteItems } : d));
    },
    [noteFile]
  );
  const deleteNote = useCallback(
    async (note) => {
      const r = await api.removeNote(noteFile, note.index, note.stamp);
      setDoc((d) => (d ? { ...d, notes: r.notes, noteItems: r.noteItems } : d));
      setToast({ text: "这条批注已经从 notes.md 里去掉了" });
    },
    [noteFile]
  );

  /**
   * 划一句就标上 / 取消。**再划同一句就是取消**——不另做一个「删除高亮」的入口，
   * 那会让人先想「我现在是要标还是要删」。同一个动作按内容切换状态，符合直觉。
   */
  const toggleHighlight = useCallback(
    async (text) => {
      const path = SHELF.highlightPath(reading?.item);
      if (!path) return;
      const norm = text.replace(/\s+/g, " ").trim();
      const exists = highlights.some((h) => h.text === norm);
      const r = await api.markHighlight(path, exists ? null : { text: norm }, exists ? { text: norm } : null);
      setHighlights(r.highlights);
    },
    [reading, highlights]
  );


  // 划一段直接扔进对话，不用自己再复制粘贴一遍
  const askAboutSelection = useCallback(
    (text) => {
      setRailMode("chat");
      askAssistant(`就这一段说说你的看法：\n\n> ${text.slice(0, 1200)}`);
    },
    [askAssistant]
  );

  /**
   * 在右栏里划词（AI 的回答、对话、批注上）。三个去处，和正文那八个不是一套：
   * 解释/展开/反驳在 AI 自己的输出上再来一遍是套娃，高亮更没有落点（这段不在书里）。
   */
  const onRailSelect = useCallback(
    ({ action, text }) => {
      if (action === "intake") {
        onIntake({ content: text, source: `《${book?.name}》${reading?.entry.title || ""}`.trim() });
      } else if (action === "note") {
        saveNote({ quote: "", body: text }).then(() => setToast({ text: "已写进 notes.md" }));
      } else if (action === "copy") {
        navigator.clipboard?.writeText(text).then(
          () => setToast({ text: "复制好了" }),
          () => setToast({ text: "复制失败，手动选中拷一下吧" })
        );
      }
    },
    [book, reading, onIntake, saveNote]
  );

  const onSelect = useCallback(
    ({ action, text, context }) => {
      if (action === "annotate") {
        setQuote(text);
        setRailMode("annotate");
      } else if (action === "highlight") {
        toggleHighlight(text);
      } else if (action === "translate") {
        translate(text);
      } else if (action === "chat") {
        askAboutSelection(text);
      } else if (action === "intake") {
        onIntake({ content: text, source: `《${book?.name}》${reading?.entry.title || ""}`.trim() });
      } else {
        runAi(action, text, context);
      }
    },
    [book, reading, onIntake, runAi, toggleHighlight, translate, askAboutSelection]
  );



  // Esc：阅读区 → 书详情 → 书架，一层一层退
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (reading) closeDoc();
      else if (book) setBook(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reading, book, closeDoc]);

  const entries = book ? docsOf(book) : [];

  /**
   * ⚠️ **藏书和资料分成两组，因为它们的「正文能不能改」是相反的**（`bookKind`）。
   * 混在同一面墙上时，这个差别只藏在一行小字的「单篇 / 59 章」里——
   * 而它决定的是「点进去之后能不能编辑正文」，是这本书最要紧的一条属性。
   *
   * ⚠️ **只有一组时不画分组标题**：全是藏书的书架上挂一个「藏书 7 本」的标题，
   * 等于把「这些都是藏书」这句废话摆在最显眼的地方。和分组色带那条同一个判据。
   */
  const groups = useMemo(() => {
    // 「资料」那一栏里混着课程、文档和自己写的，它们的差别是**这是什么**，
    // 不是「能不能改」——那一栏按归类分组才读得懂。
    if (sourceKinds && sourceKinds.length > 1) {
      const byKind = sourceKinds
        .map((kind) => ({ key: kind, label: kind, hint: KIND_HINTS[kind] || "", items: books.filter((b) => (b.sourceKind || "书籍") === kind) }))
        .filter((group) => group.items.length);
      return byKind.length > 1 ? byKind : [{ key: "all", label: "", hint: "", items: books }];
    }
    const shelf = books.filter((b) => b.kind !== "资料");
    const own = books.filter((b) => b.kind === "资料");
    if (!shelf.length || !own.length) return [{ key: "all", label: "", hint: "", items: books }];
    return [
      { key: "shelf", label: "藏书", hint: "别人写的，正文只读", items: shelf },
      { key: "own", label: "资料", hint: "自己攒的，正文能改", items: own },
    ];
  }, [books, sourceKinds]);

  return (
    <>
      {book && !reading ? (
        <BookDetail
          book={book}
          entries={entries}
          onBack={() => setBook(null)}
          onOpen={(entry, opts) => openDoc(book, entry, opts)}
          onTrash={() => trash(book)}
          onKind={(kind) => changeKind(book, kind)}
          // 标记上那颗「摘成素材」——高亮本来就是「这句值得留下」，
          // 从这一页直接入库，省掉「重新打开那一章、再划一遍同一句」那一趟
          onIntake={onIntake}
        />
      ) : (
        <>
          {/* ⚠️ **这一页只有一个标题。** 原来是页头写「书架」、正文顶上那个框里
              再写一遍「SHELF / 在架上 16 本」——同一件事一屏说两遍，而 `SHELF`
              正是设计系统里否决过的那种眉标（标题的英文转写）。本数挂在页标题旁边。 */}
          <PageHeader
            title="书架"
            count={list ? `${books.length} 本` : ""}
            /* ⚠️ **不写那段说明。** 原文是「导入 Markdown / EPUB / PDF，拆成章节读；
               划词能批注、能问 AI、能摘成素材。正文和批注都在当前本地工作区。」——
               三句话说的全是**这一页的功能清单**，而屏幕上已经有一墙封面、
               一个「＋」格和一条搜索框在说同样的事。
               功能说明不是页面的第一行内容；真要提示的地方是那些功能自己所在的位置。 */
            /**
             * ⚠️ **页头右上角只有搜索框。**
             * 它筛的就是标题旁边那「16 本」，语义正好。加书的两颗按钮**搬去了墙尾那个
             * `＋` 格**——加书这件事发生在书堆的尽头，那儿正是「这儿还能再放一本」的
             * 位置；而它们连同那行「支持 .md / .txt / …」的说明挤在页头里，把这一行
             * 撑到换行，搜索框反而被顶下去了。
             */
            aside={
              <SearchBox value={query} onChange={setQuery} placeholder="搜书名、作者、标签" />
            }
          />

          <section className="panel-block">
            <ErrorNote error={listError} what="加载书架" />

            {!list && !listError ? (
              <Loading rows={3} />
            ) : list?.exists === false ? (
              <Note title="书架目录还没建">
                <p style={{ margin: "6px 0" }}>
                  <IconBooks aria-hidden="true" size={15} stroke={1.7} style={{ verticalAlign: "-3px", marginRight: 6 }} />
                  书架保存在当前本地工作区，一本书对应一份可检索的本地记录。
                  导入一本书会自动把它建出来。
                </p>
                {/* 这一刻墙还不存在，`＋` 格无处可放，所以用按钮形态 */}
                <ShelfActions onDone={reload} variant="buttons" />
              </Note>
            ) : books.length ? (
              <>
                {/**
                  * 顶部两栏是**上次的落点**（左：读到哪儿；右：写过什么），
                  * 底下是通栏的书单。
                  *
                  * ⚠️ **「最近标注」原来竖在书单右边**，把封面墙挤成窄栏、自己也被压成
                  * 一条细长的引文，两边都没落到好。它和「正在阅读」本来就是同一类东西，
                  * 并排放在书单上方，书单才吃得满整个宽度——而书单是这一页的主体。
                  * 两栏任何一栏空掉时整块不画，剩下的那栏自己铺满（`auto-fit`）。
                  */}
                <div className="shelf-top">
                  <ContinueCard
                    books={books}
                    tick={progressTick}
                    onResume={(b, entry) => openDoc(b, entry, { resume: true, detail: b.chapterCount > 1 })}
                  />
                  <RecentMarks onOpen={(m) => openDocByPath(m)} bookDirs={sourceKinds ? books.map((b) => b.dir) : null} hideWhenEmpty={catalogOnly} />
                </div>
                {/**
                  * ⚠️ **标注放书架不放书详情**：放详情页意味着你得先想起「是哪本书」
                  * 才能看到自己写过什么，而标记是**跨书**的——「我最近在想什么」
                  * 根本不按书分。书详情那一栏仍然留着，那儿回答的是
                  * 「这一本里我留下了什么」，两者不重复。
                  */}
                <div className="shelf-wall">
                    {groups.map((g, gi) => (
                      <div key={g.key}>
                        {g.label ? (
                          <div className="shelf-group">
                            <h3>{g.label}</h3>
                            <em>{g.items.length} 本 · {g.hint}</em>
                          </div>
                        ) : null}
                        <div className="bookshelf">
                          {g.items.map((b) => (
                            <BookCard
                              key={b.dir}
                              book={b}
                              tick={progressTick}
                              onCover={() => {
                                setCoverFor(b);
                                coverRef.current?.click();
                              }}
                              // 单篇书没有目录可挑，中间那一层就是一次白点的鼠标——直接进正文
                              onOpen={() =>
                                b.chapterCount > 1
                                  ? setBook(b)
                                  : openDoc(b, docsOf(b)[0], { resume: true, detail: false })
                              }
                              // 封面上那颗「接着读」：多章的书原来必须先进书详情才能接着读
                              onResume={() => openDoc(b, docsOf(b)[0], { resume: true, detail: false })}
                              onTrash={() => trash(b)}
                            />
                          ))}
                          {/**
                            * ⚠️ **`＋` 只在最后一组的末尾出现一次。**
                            * 每组一个的话，位置本身在暗示一个它保证不了的去处——
                            * 一本书落在「藏书」还是「资料」由 `类型` 决定（epub 一定是藏书），
                            * 不由你点了哪个组的 `＋` 决定。理由写在 `ShelfActions.jsx` 开头。
                            */}
                          {gi === groups.length - 1 ? <ShelfActions onDone={reload} /> : null}
                        </div>
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <Empty icon={IconBooks}>{query ? `没有匹配「${query}」的书` : "书架还是空的，先导入一本"}</Empty>
            )}
          </section>
        </>
      )}

      {reading ? (
        <ReaderOverlay
          source={SHELF}
          item={reading.item}
          doc={doc}
          loading={docLoading}
          error={docError}
          baseDir={book?.dir}
          initialScroll={reading.initialScroll}
          evidenceQuote={reading.evidenceQuote}
          onProgress={onProgress}
          backLabel={returnTo?.label || (entries.length > 1 ? "返回目录" : "返回书架")}
          cover={book?.cover ? api.imageUrl(book.cover) : ""}
          highlights={highlights}
          bookmarked={isBookmarked(reading.entry.path)}
          onBookmark={() => {
            toggleBookmark(book.dir, reading.entry.path, reading.entry.title);
            setMarked((n) => n + 1);
          }}
          onClose={() => {
            if (returnTo?.hash) { const target = returnTo.hash; setReturnTo(null); closeDoc(); window.location.hash = target; return; }
            closeDoc();
          }}
          onSelect={onSelect}
          onSaved={() => {
            // 存完重新读一遍这份文档：正文、stamp（下一次保存的乐观锁）和批注要一起对上。
            // 本地文件读一遍是毫秒级的，比在前端拼一份「应该长这样」的 doc 可靠。
            SHELF.load(reading.item).then(setDoc).catch(setDocError);
          }}
          outline={outline}
          onOutline={setOutline}
          nav={
            entries.length > 1
              ? {
                  label: "CHAPTERS",
                  items: entries,
                  activeKey: reading.entry.path,
                  onPick: (entry) => openDoc(book, entry),
                }
              : null
          }
          rail={{
            mode: railMode,
            onMode: setRailMode,
            annotateLabel: SHELF.annotateLabel,
            notes: doc?.notes,
            highlights: highlights.map((h) => ({
              ...h,
              // 点清单里的一条就滚到正文里那一处
              onJump: () => {
                const el = [...document.querySelectorAll(".prose mark[data-hl]")]
                  .find((m) => m.textContent.trim() === h.text);
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
              },
            })),
            onRemoveHighlight: (h) => toggleHighlight(h.text),
            quote,
            onSaveNote: saveNote,
            // 批注可改可删（vault 里的一份 Markdown，整份重写）
            noteItems: doc?.noteItems,
            onEditNote: editNote,
            onDeleteNote: deleteNote,
            // 在右栏里划词：AI 答出来的东西里最常有的就是能直接用的句子
            onRailSelect: onRailSelect,
            ai,
            // 存哪一段是分开的决定，所以传的是「那一条结果」而不是「当前这条」
            onSaveAiAsNote: async (r) => r?.text && saveNote({ quote: ai?.quote, body: `**AI ${r.mode}**\n\n${r.text}` }),
            onStopAi: stopAi,
            onRunAi: (mode, text) => runAi(mode, text, contextOf(doc?.content, text)),
            assistantScopeId: `reader:shelf:${reading?.entry?.path || "document"}`,
            assistantDocument: { ...doc, path: reading?.entry?.path || "" },
            assistantSelection: quote ? { text: quote } : null,
            assistantPrompt,
            assistantHandoff,
            // 回答卡的「对话」：把那一问原样送进右栏助手真的跑一遍
            onDiscuss: (payload) => setAssistantHandoff({ id: `discuss-${payload.id}`, prompt: payload.prompt, answer: payload.answer }),
            knowledgeSource: {
              kind: "document",
              ref: reading?.entry?.path || "",
              url: "",
              title: doc?.title || reading?.entry?.title || reading?.book?.name || "",
              selection: quote || "",
              text: doc?.content || "",
            },
          }}
        />
      ) : null}

      {/* 换封面的文件选择器只有一个，挂在页面上；点哪本书就先记下是哪本。
          每张卡各挂一个 input 的话，一屏几十本就是几十个隐藏节点。 */}
      <input
        ref={coverRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || !coverFor) return;
          try {
            await api.setCover(coverFor.dir, f);
            reload();
            setToast({ text: `《${coverFor.name}》的封面换好了` });
          } catch (err) {
            setToast({ text: `换封面失败：${err.message}` });
          } finally {
            setCoverFor(null);
          }
        }}
      />

      <Toast text={toast?.text} onUndo={toast?.undo} onClose={() => setToast(null)} />
    </>
  );
}
