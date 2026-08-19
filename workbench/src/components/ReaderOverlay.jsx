// 精读层：整屏覆盖层，不是常驻的第三栏。
//
// 覆盖层能吃满宽度（左栏 + 正文 760 + 批注台 348 都不挤），关掉之后底下那层的滚动位置
// 还在原处。三栏各司其职：**左栏是「我在哪」**（文档信息 + 目录 / 章节），中间是正文，
// 右栏是「我要做什么」。顶部那条进度线是长文的必需品——中文长稿滚起来没有页码，
// 不知道还剩多少会让人不想往下读。
//
// 这个文件被内容工作台和书架共用。**差异全部走 props**，不要在里面 if 源的 key：
// 加第三个调用方时才不会变成一坨条件分支。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { useConfirmGuard } from "../lib/use-confirm-guard.js";
import { Reader } from "./Reader.jsx";
import { SideRail } from "./SideRail.jsx";
import { ReadingPrefs, loadPrefs, prefsToStyle } from "./ReadingPrefs.jsx";
import { MarkdownEditor } from "./MarkdownEditor.jsx";
import { WritingAssist } from "./WritingAssist.jsx";
import { ErrorNote, Loading, MetaItem, Select, relTime } from "./ui.jsx";
import { readStats } from "../lib/reading.js";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowUpRight,
  IconBookmark,
  IconLink,
  IconBookmarkFilled,
  IconBrandWechat,
  IconLayoutSidebar,
  IconLayoutSidebarRight,
  IconChevronRight,
  IconFileText,
  IconPencil,
  IconPhoto,
  IconTrash,
  IconX,
} from "./icons.jsx";

const RAILS_KEY = "workbench:reader-rails:v1";

function loadRails() {
  try {
    const r = JSON.parse(localStorage.getItem(RAILS_KEY) || "null");
    return { left: r?.left !== false, right: r?.right !== false };
  } catch {
    return { left: true, right: true };
  }
}

export function ReaderOverlay({
  source,
  item,
  doc,
  loading,
  error,
  onClose,
  onSelect,
  onSaved,
  onStatus,          // (next) => Promise，改状态。调用方可以在这里拦一道（选题要先选平台）
  onCover,
  onTypeset,
  onDelete,
  outline,
  onOutline,
  rail,
  nav,               // 可选：{ label, items:[{key,title,order}], activeKey, onPick } 书的章节目录
  backLabel,         // 返回按钮上写什么。默认「返回列表」
  baseDir = "",      // 正文里相对图片路径的基准目录
  initialScroll = 0, // 回到上次读到的位置
  onProgress,        // ({ progress, scrollTop }) => void，书架用它记进度
  extra,             // 正文动作条**上方**再挂一块（素材的核验面板、选题的「去看成稿」）
  actionsExtra,      // 正文动作条**里面**再加个按钮（稿件的「记录发布」）
  cover,             // 可选：封面图地址（书架来源才有）
  highlights,        // 可选：[{ text, color }]，画在正文里
  actions,           // 可选：这个源支持哪些划词动作（流水线源没有高亮）
  bookmarked,        // 可选：这一篇被收藏了没
  onBookmark,        // 可选：收藏 / 取消收藏
  onCaptureExperience, // 可选：把缺失经历补进素材库
}) {
  const [progress, setProgress] = useState(0);
  /**
   * 两侧栏都能收起。**读长文时正文该能吃满屏**——左栏是导航、右栏是工具，
   * 真正沉进去读的时候两样都不需要。记进 localStorage：这是「我习惯怎么读」，
   * 不是这一篇的属性，换一篇不该重来一遍。
   */
  const [rails, setRails] = useState(loadRails);
  const toggleRail = useCallback((side) => {
    setRails((r) => {
      const next = { ...r, [side]: !r[side] };
      try {
        localStorage.setItem(RAILS_KEY, JSON.stringify(next));
      } catch {
        /* 隐私模式下写不了，不影响读 */
      }
      return next;
    });
  }, []);
  // 排版偏好只影响三个 CSS 变量，不进正文组件的 props——不然改一次字号就重渲染一次正文，
  // 浏览器选区会被抹掉（Reader.jsx 里那个踩过的坑）。
  const [prefs, setPrefs] = useState(loadPrefs);
  const scrollRef = useRef(null);
  const restoredFor = useRef("");

  const onScroll = useCallback(
    (e) => {
      const el = e.currentTarget;
      const max = el.scrollHeight - el.clientHeight;
      const p = max > 0 ? Math.min(1, el.scrollTop / max) : 0;
      setProgress(p);
      onProgress?.({ progress: p, scrollTop: el.scrollTop });
    },
    [onProgress]
  );

  // 换文档时进度归零，否则上一篇读到 80% 会让新的一篇一进来就显示读了 80%。
  // 有上次位置就恢复过去——但**必须等正文渲染完**，否则滚动容器还是空的，scrollTo 打空。
  useEffect(() => {
    setProgress(0);
    if (!doc) return;
    if (restoredFor.current === item.key) return;
    restoredFor.current = item.key;
    const el = scrollRef.current;
    if (!el) return;
    const target = initialScroll > 0 ? initialScroll : 0;
    requestAnimationFrame(() => {
      el.scrollTo({ top: target });
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? Math.min(1, target / max) : 0);
    });
  }, [item.key, doc, initialScroll]);

  /**
   * 阅读区开着的时候**锁住下面那一层的滚动**。
   *
   * 覆盖层是 `position: fixed; inset: 0`，底下的列表页并没有消失——它照样能滚，
   * 于是窗口右边挂着一条**滚了也什么都不会动**的滚动条。屏幕上同时四条滚动条
   * （页面 / 左栏 / 正文 / 右栏），其中一条是纯噪音。
   *
   * 恢复的是 `overflow` 而不是写死 `""`：别的地方（弹窗）也可能锁过，无脑清空会把它解开。
   */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /**
   * 焦点陷阱 + 背景 inert + 关掉之后焦点回到打开它的那张卡上。
   *
   * **Esc 不交给它**：退一层这件事在页面那边（`Studio` / `Shelf`），而且那儿有一条
   * 这里没有的规则——**正在输入框里打字时 Esc 不退出**（写批注写到一半按 Esc
   * 把整个阅读区关掉，写的东西就没了）。两处都管的话，那条规则会被这里绕过去。
   *
   * 焦点陷阱本身在这一层尤其要紧：不做的话，Tab 会一路走进**背后那一页**的卡片，
   * 那儿每张卡右下角都有个垃圾桶。屏幕上什么都看不出来（背景被盖住了），
   * 而回车就是一次删除。
   */
  const boxRef = useDialog(true, undefined, { autoFocus: false });

  // 字数 / 预计读完。口径在 lib/reading.js 的 readStats 里，洞察卡片用的是同一个——
  // 各写一份的话，同一篇文档在卡片上和阅读区里会显示两个不同的字数。
  const stats = useMemo(() => readStats(doc?.content), [doc?.content]);

  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const navIndex = nav ? nav.items.findIndex((c) => c.key === nav.activeKey) : -1;

  return (
    <div className="reader-overlay" ref={boxRef} role="dialog" aria-modal="true" aria-label={item.title} style={prefsToStyle(prefs)}>
      <header className="reader-overlay__bar">
        <button className="btn btn-sm" onClick={onClose}>
          <IconArrowLeft aria-hidden="true" stroke={1.8} />
          {backLabel || (nav ? "返回目录" : "返回列表")}
        </button>
        <span className="reader-overlay__crumb">
          {source.label} <span aria-hidden="true">/</span> {item.crumb || item.badge || item.sub || "文档"}
        </span>
        {onBookmark ? (
          <button
            className="icon-btn"
            onClick={onBookmark}
            aria-pressed={!!bookmarked}
            title={bookmarked ? "取消收藏这一篇" : "收藏这一篇"}
            aria-label={bookmarked ? "取消收藏" : "收藏"}
          >
            {bookmarked ? <IconBookmarkFilled aria-hidden="true" /> : <IconBookmark aria-hidden="true" stroke={1.8} />}
          </button>
        ) : null}
        <ReadingPrefs value={prefs} onChange={setPrefs} />
        {/* 两侧栏的开关放顶栏：收起之后那一侧就没有可点的地方了，开关必须在外面 */}
        <button
          className="icon-btn"
          onClick={() => toggleRail("left")}
          aria-pressed={!rails.left}
          title={rails.left ? "收起目录" : "展开目录"}
          aria-label={rails.left ? "收起目录" : "展开目录"}
        >
          <IconLayoutSidebar aria-hidden="true" stroke={1.7} />
        </button>
        <button
          className="icon-btn"
          onClick={() => toggleRail("right")}
          aria-pressed={!rails.right}
          title={rails.right ? "收起批注台" : "展开批注台"}
          aria-label={rails.right ? "收起批注台" : "展开批注台"}
        >
          <IconLayoutSidebarRight aria-hidden="true" stroke={1.7} />
        </button>
        {/* **快捷键写进 title，不写进名字。** 原来是 `aria-label="关闭 Esc"`，
            读屏念出来就是「关闭 Esc 按钮」——那不是这颗按钮叫什么。
            而且这一颗当时还没有 title，鼠标悬停什么都不显示，两头都缺一块。 */}
        <button className="icon-btn" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
          <IconX aria-hidden="true" stroke={1.8} />
        </button>
        <div className="reader-overlay__progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      </header>

      <div className="reader-overlay__body">
        {/* 左栏回答一个问题：**我在读什么、读到哪儿**。
            上一版这里堆的是「选题 / 待写 / 公众号 / X」四个芯片加一行机读时间戳——
            那几个标签顶栏面包屑和正文的元信息行里都已经有了，第三遍出现只是噪音，
            而机读时间戳没人会看。现在只留标题、来路和目录。 */}
        {rails.left ? (
        <aside className="doc-rail">
          <div className="doc-rail__block">
            {/* 封面：读书时它是最快的「我在读哪本」——比书名更快，因为你先认得出那张图 */}
            {cover ? <img className="doc-rail__cover" src={cover} alt="" loading="lazy" /> : null}
            <h2 className="doc-rail__title">{doc?.title || item.title}</h2>
            {docPath(item) || item.time ? (
              <p className="doc-rail__meta">
                {/* 只显示对人有意义的来路。库里那行的 key 是个 UUID / ULID，铺出来纯属噪音。 */}
                {docPath(item) ? <span className="doc-rail__path">{docPath(item)}</span> : null}
                {item.time ? <time>{relTime(item.time)}</time> : null}
              </p>
            ) : null}
            {/**
              * 字数和预计读完。**这一行是用来补那个洞的，但补的东西必须是真有用的。**
              *
              * 左栏原来只有标题和来路，一篇没有小标题的稿子（成稿几乎都是）进来之后，
              * 底下就是两百多像素的空白。而写稿的人恰好一直在问「这篇够不够长」——
              * 公众号深度长文和 X 短帖差一个数量级，字数是当场就要的判断依据。
              */}
            {stats ? (
              <p className="doc-rail__stats">
                <span>{stats.words.toLocaleString("zh-CN")} 字</span>
                <span>约 {stats.minutes} 分钟读完</span>
              </p>
            ) : null}
          </div>

          {/* 章节目录（书）。整本书的导航要一直在手边，滚到第 40 章还能一键跳回第 3 章 */}
          {nav?.items?.length ? (
            <nav className="doc-rail__toc doc-rail__toc--nav" aria-label={nav.label || "章节"}>
              <span className="doc-rail__label">{nav.label || "CHAPTERS"}</span>
              {nav.items.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="doc-rail__item"
                  aria-current={c.key === nav.activeKey}
                  onClick={() => nav.onPick(c)}
                >
                  <span className="doc-rail__num">{String(c.order).padStart(2, "0")}</span>
                  {/* 标题必须自己是一个块级盒子：`text-overflow` 作用在**有 overflow 的那个盒子**上，
                      裸文本节点直接挂在 flex 容器里的话，长章名会被硬切掉、连省略号都没有 */}
                  <span className="doc-rail__name">{c.title}</span>
                </button>
              ))}
            </nav>
          ) : null}

          {outline.length ? (
            <nav className="doc-rail__toc" aria-label="本文目录">
              <span className="doc-rail__label">ON THIS PAGE</span>
              {outline.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={`doc-rail__item doc-rail__item--l${h.level}`}
                  onClick={() => jump(h.id)}
                >
                  {h.text}
                </button>
              ))}
            </nav>
          ) : null}
        </aside>
        ) : null}

        <div className="ws-main" ref={scrollRef} onScroll={onScroll}>
          {loading ? (
            <Loading rows={6} />
          ) : error ? (
            <ErrorNote error={error} what="加载文档" />
          ) : doc ? (
            <>
              <DocView
                source={source}
                item={item}
                doc={doc}
                baseDir={baseDir}
                highlights={highlights}
                actions={actions}
                onSelect={onSelect}
                onSaved={onSaved}
                onStatus={onStatus}
                onCover={onCover}
                onTypeset={onTypeset}
                onDelete={onDelete}
                onOutline={onOutline}
                extra={extra}
                actionsExtra={actionsExtra}
                onCaptureExperience={onCaptureExperience}
              />
              {/* 读完一章要能直接进下一章。翻页放正文末尾，不放顶部——
                  读到底的时候手在这儿，回头找按钮就是多一次打断。 */}
              {nav && navIndex >= 0 ? (
                <div className="chapter-turn">
                  <button
                    className="btn btn-sm"
                    disabled={navIndex <= 0}
                    onClick={() => nav.onPick(nav.items[navIndex - 1])}
                  >
                    <IconArrowLeft aria-hidden="true" stroke={1.7} />
                    上一章
                  </button>
                  <span className="chapter-turn__pos">
                    {navIndex + 1} / {nav.items.length}
                  </span>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={navIndex >= nav.items.length - 1}
                    onClick={() => nav.onPick(nav.items[navIndex + 1])}
                  >
                    下一章
                    <IconChevronRight aria-hidden="true" stroke={1.7} />
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        {doc && rails.right ? <SideRail {...rail} onCollapse={() => toggleRail("right")} /> : null}
      </div>
    </div>
  );
}

// 工作台在 vault 里的那一级。**这一段在每一篇文档的路径里都一模一样**，
// 所以左栏那行来路要把它掐掉——和「信源芯片上不写『已刷新』」是同一条规则：
// 每个都说的话等于没说，而它占掉的是一行里最值钱的开头 8 个字。
// 写死字面量：这里做的是显示层的裁剪，不该因为 import 了常量就跟着布局变量走。
const WB_PREFIX = "99 - 个人工作台/";

// 左栏那行「这东西哪来的」。vault 条目给文件路径，流水线条目给出处或链接——
// 它的 key 是个 UUID，铺出来纯属噪音。
export function docPath(item) {
  const p = item.raw?.docPath || item.raw?.bookPath || item.raw?.path || item.raw?.source || item.raw?.link || "";
  return p.startsWith(WB_PREFIX) ? p.slice(WB_PREFIX.length) : p;
}

// 正文：读模式 / 编辑模式。编辑是整篇 Markdown 改一遍再整体存回去——
// 块级编辑要维护块 id 映射和并发，复杂度高一个量级，而这里的场景就是「改一遍稿子」。
function DocView({ source, item, doc, baseDir, highlights, actions, onSelect, onSaved, onStatus, onCover, onTypeset, onDelete, onOutline, extra, actionsExtra, onCaptureExperience }) {
  const [copied, setCopied] = useState(false);
  /**
   * 真实性告警**默认收着**。它是「待确认项」不是「错误」：一篇 2000 字的稿子，
   * 打开第一屏该是正文，不该是一张红卡片加两条句子摘录。而且它常常只是
   * 「这事真发生过，只是还没录成素材」——为这个把正文顶下去，代价不对等。
   */
  const [flagOpen, setFlagOpen] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [insertRequest, setInsertRequest] = useState(null);
  const writingCursor = useRef(0);
  const armedDel = useConfirmGuard(confirmDel);

  useEffect(() => {
    setFlagOpen(false);   // 上一篇展开过告警，换一篇不该跟着展开
  }, [item.key]);

  /**
   * `revealAt` 是可选的「进去之后跳到哪一段」。
   *
   * ⚠️ **`nonce` 用递增计数不用 `Date.now()`**：同一段连点两次也该再跳一次，
   * 而两次点击落在同一毫秒里是完全可能的——那时候第二下看着就是没反应。
   */
  function startEdit(revealAt = "") {
    setDraft(doc.markdown ?? doc.content ?? "");
    setTitle(doc.title);
    setError(null);
    setSaved(false);
    setInsertRequest(null);
    setEditing(true);
    setReveal(revealAt ? (cur) => ({ text: revealAt, nonce: (cur?.nonce || 0) + 1 }) : null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // stamp 是打开这份文档时拿到的版本号。vault 源用它做乐观锁——这些 md 同时
      // 在 Obsidian 里开着，对不上就 409（流水线源没有这个字段，传过去也无害）
      const result = await source.save(item, { title, markdown: draft, stamp: doc.stamp });
      onSaved({ title, markdown: draft, updatedAt: result?.updatedAt });
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(next) {
    setBusy(true);
    setError(null);
    try {
      await onStatus(next);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    // 挡住一次物理双击直接删掉。这一处此刻「碰巧安全」——「删除」按钮带文字、比较宽，
    // 点完之后指针正好落在「取消」上；但那是宽度的巧合，改一次文案就会翻。
    // 规则和卡片那边共用同一份实现，见 `lib/use-confirm-guard.js`。
    if (!armedDel.current) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(item);
    } catch (e) {
      setError(e);
      setBusy(false);
      setConfirmDel(false);
    }
  }

  if (editing) {
    // 编辑器上的字**全由源来说**。写死一个库名的话，书架改的明明是 vault 里的一份 md，
    // 界面却一路说着「保存到流水线」——那是句假话，而且会让人以为书被同步进库里了。
    const ed = source.edit || { target: "流水线", save: "保存", hint: "" };
    return (
      <div className="ws-edit">
        <span className="eyebrow">EDITING · 写回 {ed.target}</span>
        {/* 标题能不能改由源决定：vault 里的标题就是文件名，而文件名同时是阅读进度、
            高亮伴生文件和 Obsidian 双链的锚点，不是「顺手改一下」的东西。
            所以那儿只读地显示一行，不给一个改了却不生效的输入框。 */}
        {doc.editTitle === false ? (
          <div className="edit-title edit-title--fixed" title="文件名就是标题，要改名去 Obsidian">
            {title}
          </div>
        ) : (
          <input className="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        )}
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          ariaLabel="正文（Markdown）"
          revealText={reveal}
          insertRequest={insertRequest}
          onCursorChange={(position) => { writingCursor.current = position; }}
          onInsertHandled={(id) => setInsertRequest((current) => current?.id === id ? null : current)}
          toolbarExtra={(
            <WritingAssist
              title={title}
              body={draft}
              platform={doc.meta?.平台 || doc.meta?.适配平台 || item.raw?.platform || ""}
              getCursor={() => writingCursor.current}
              onInsert={(text, meta) => setInsertRequest({ id: `writing-${Date.now()}`, text, spacing: "exact", ai: meta?.ai, kind: meta?.kind })}
            />
          )}
        />
        <ErrorNote error={error} what="保存" />
        {/* 动作条固定在底部，和右栏批注台那套是同一条规则：按钮永远在同一个位置，
            肌肉记忆才立得住。长文编辑时尤其要紧——不然存一次要先滚到底。 */}
        <div className="ws-edit__foot">
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            {busy ? "保存中…" : ed.save}
          </button>
          <button className="btn btn-sm" onClick={() => setEditing(false)} disabled={busy}>取消</button>
          <span className="page-sub" style={{ margin: 0 }}>{ed.hint}</span>
        </div>
      </div>
    );
  }

  return (
    <Reader
      title={doc.title}
      content={doc.content}
      format={doc.format}
      baseDir={baseDir}
      highlights={highlights}
      actions={actions}
      onSelect={onSelect}
      onOutline={onOutline}
    >
      <div className="doc-meta">
        {source.states?.length && doc.status && onStatus ? (
          <Select
            value={doc.status}
            options={source.states}
            disabled={busy}
            onChange={changeStatus}
            title="改状态会直接写回流水线"
            ariaLabel="改状态"
          />
        ) : null}
        {/**
          * 真实性告警在状态行里只是**一枚可点的标记**，正文之上不再摆红卡片。
          *
          * 它背后是一道会真的拦住保存的闸门（Worker 的 `assertGroundedPersonalNarrative`），
          * 所以不能不画；但它报的是「这几句还没找到对应的个人经历素材」，多数时候的解法是
          * 补一条素材而不是改文章——**这是待办，不是错误**，红色警报的分量给重了。
          */}
        {doc.warning ? (
          <button
            type="button"
            className="doc-flag"
            aria-expanded={flagOpen}
            onClick={() => setFlagOpen((v) => !v)}
            title={doc.warning.title}
          >
            <IconAlertTriangle size={13} stroke={1.9} aria-hidden="true" />
            {doc.warning.issues?.length ? `${doc.warning.issues.length} 处待核实经历` : doc.warning.title}
            <IconChevronRight size={12} stroke={1.9} aria-hidden="true" className="doc-flag__caret" />
          </button>
        ) : null}
        {/**
          * 元信息是**「字段名 + 值」的两段式，不是一排灰药丸**。
          *
          * 药丸那版有三个毛病：字段名和值挤在一个方框里分不出主次；每个都套一层灰底，
          * 五六项排开就是一条杂色带；而「目标读者」这种长值在固定宽度的药丸里只能被切成
          * 「25-35岁知识工作者、内容消费重度用…」——最该看的信息恰好被切没了。
          * 现在字段名是小号等宽灰字（退到背景里），值是正常字色，长值直接换行。
          */}
        {metaFields(doc.meta).map(([k, text]) => (
          <MetaItem key={k} name={k} value={text} />
        ))}
        {/* 链接**不单独占一行**：它是「这条从哪来的」的一部分，跟在来源后面就够了。
            铺成一整行的话，一条几十字的 URL 会比正文标题还显眼，而它本来只是个跳板。 */}
        {metaLink(doc.meta) ? (
          <a className="doc-meta__link" href={metaLink(doc.meta)} target="_blank" rel="noreferrer" title={metaLink(doc.meta)}>
            {/* 前面也给一个图标：这一行别的项都是「图标 + 名字 + 值」，
                只有它是光秃秃两个字，扫过去会像掉队的一个 */}
            <IconLink size={13} stroke={1.7} aria-hidden="true" />
            原文
            <IconArrowUpRight size={12} stroke={1.9} aria-hidden="true" />
          </a>
        ) : null}
      </div>

      {/**
        * 展开之后**一段一个出路对**，不是一个列表配两个笼统的按钮。
        *
        * 这里的「一段」是 Worker 那边合并过的：连着的几句属于同一个场景，算一条
        *（`findSpecificPersonalClaims`）。拆成几条的话，补录时只填其中一句，
        * 剩下的照样够不着依据——补了还在报，看着像修不好。
        *
        * 两个动作对应这段话仅有的两种归宿：**是真事就录成素材**（原句预填好，闸门随即认它）、
        * **不是就去改**（进编辑器并跳到那一段）。原来那版底下只有一个笼统的「去正文里改」，
        * 进去之后光标停在开头，被点名的那句在两千字里的哪儿还得自己找。
        */}
      {doc.warning && flagOpen ? (
        <div className="doc-flag__panel">
          <p className="doc-flag__lead">{doc.warning.detail}</p>
          <ul className="doc-flag__list">
            {(doc.warning.issues || []).map((issue) => (
              <li key={issue}>
                <span className="doc-flag__quote">{issue}</span>
                <span className="doc-flag__acts">
                  {onCaptureExperience ? (
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => onCaptureExperience(issue)}
                      title="把这段话存成「个人经历」素材，闸门就认它了"
                    >
                      这是真事，录进素材
                    </button>
                  ) : null}
                  {doc.editable ? (
                    <button
                      className="btn btn-sm btn-quiet"
                      type="button"
                      onClick={() => startEdit(issue)}
                      title="进编辑器并跳到这一段"
                    >
                      去这儿改
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {extra}

      {/* 一个动作都没有时**整条不画**。藏书是只读的，这一条会退化成一条光秃秃的分隔线
          加一片空白——看着像有什么东西没加载出来。 */}
      {doc.editable || onTypeset || onCover || actionsExtra || onDelete || saved ? (
      <div className="doc-actions">
        {doc.editable ? (
          <button className="btn btn-sm" onClick={startEdit}>
            <IconPencil aria-hidden="true" stroke={1.7} />
            编辑
          </button>
        ) : null}

        {/* 成稿之后的两步：配封面、去排版。工具都是工作区里已有的项目，这里只是把它们接上。
            **没传处理函数就不画**——书架用同一个阅读区，但「给一本书配封面」是句废话。 */}
        {onTypeset ? (
          <button
            className="btn btn-sm"
            onClick={() => {
              onTypeset();
              setCopied(true);
            }}
            title="正文复制到剪贴板，并跳到排版页"
          >
            <IconBrandWechat aria-hidden="true" stroke={1.7} />
            {copied ? "已复制，去排版" : "去排版"}
          </button>
        ) : null}
        {onCover ? (
          <button className="btn btn-sm" onClick={onCover} title="用 xenho-cover skill 生成封面提示词">
            <IconPhoto aria-hidden="true" stroke={1.7} />
            配封面
          </button>
        ) : null}

        {actionsExtra}

        {saved ? <span className="tag">已保存</span> : null}

        {/* 删除永远排在最右、离编辑最远，而且要点两下。
            第二下的按钮上直接写清楚东西去哪了，不写「确定吗」这种没有信息量的话。 */}
        {onDelete ? (
          <span className="doc-actions__end">
            {confirmDel ? (
              <>
                <button className="btn btn-sm btn-danger" onClick={remove} disabled={busy}>
                  {busy ? "删除中…" : source.removeLabel || "确认删除"}
                </button>
                <button className="btn btn-sm" onClick={() => setConfirmDel(false)} disabled={busy}>取消</button>
              </>
            ) : (
              <button className="btn btn-sm btn-quiet" onClick={() => setConfirmDel(true)} title={source.removeLabel}>
                <IconTrash aria-hidden="true" stroke={1.7} />
                删除
              </button>
            )}
          </span>
        ) : null}
      </div>
      ) : null}
      <ErrorNote error={error} what="操作" />
    </Reader>
  );
}

/** 选题成稿之后，稿子在稿件库的哪几行。挂在正文动作条上方。 */
/**
 * 元信息里哪些是「字段」、哪个是「链接」。
 *
 * 链接单拎出来是因为**它该长得像个按钮，不该长得像一段值**：URL 又长又没法读，
 * 铺在元信息行里会比标题还显眼，而人对它唯一的动作就是点一下跳过去。
 */
const isUrl = (v) => /^https?:\/\//i.test(String(v).trim());

// 字段名 → 图标的映射在 ui.jsx（`fieldIcon`）：书详情那一行元信息也用同一套，
// 各画各的话同一个界面里就有了两套元信息语言。

// 长十六进制串是机器字段（洞察报告的 frontmatter 里有三个 sha256），对读的人零价值，
// 而它们**每个都占满一整行**，把真正的元信息挤到下面去。铺出来的元信息行是这一页
// 「这份东西是什么」的答案，不是文件属性的转储。要溯源的话工件里一直有。
const isMachineValue = (v) => /^[0-9a-f]{32,}$/i.test(String(v).trim());

function metaFields(meta) {
  return Object.entries(meta || {})
    .filter(([, v]) => v && String(v).length && !isUrl(v) && !isMachineValue(v))
    .map(([k, v]) => [k, Array.isArray(v) ? v.join("、") : String(v)]);
}

function metaLink(meta) {
  const hit = Object.entries(meta || {}).find(([, v]) => isUrl(v));
  return hit ? String(hit[1]).trim() : "";
}

export function DraftLinks({ drafts, onOpen }) {
  const list = useMemo(() => drafts || [], [drafts]);
  if (!list.length) return null;
  /**
   * **压成一行，不占一个带解释的引用框。**
   *
   * 原来这里是「小标题 + 两行说明 + 一排按钮」的一整块，杵在标题和正文之间。
   * 但那两行说明讲的是**设计决策**（为什么稿子只存稿件库），用户第一次看完就懂了，
   * 之后每打开一条选题都要再看一遍——**解释是一次性的，占位却是永久的**。
   * 说明挪进 title，界面上只留指路牌本身：它才是每次都要用的东西。
   */
  return (
    <div className="draft-links" title="稿子只存在稿件库，一个平台一篇；选题这边只留指路牌——同一份内容存两处，迟早会出现两个版本谁也说不清哪个是准的">
      <span className="draft-links__label">
        <IconFileText size={13} stroke={1.7} aria-hidden="true" />
        成稿去向
      </span>
      {list.map((d) => (
        <button key={d.id} className="draft-links__go" onClick={() => onOpen(d)}>
          {d.platform || "未标平台"}
          <em>{d.status || "待修改"}</em>
        </button>
      ))}
    </div>
  );
}
