// 在工作台里读一条热点的原文，不用先跳出去。
//
// **左右栏各给一半，不是照搬阅读区的三栏。** 判断标准是「这一栏在这儿有没有落点」：
//
//   左栏（目录）  有。抓回来的文章动辄几千上万字（The Verge 那条 15000 字），
//                 没有目录就只能一路滚。纯导航，零副作用。
//   右栏「理解」  有。热点里英文原文占一半，**翻译和解释在这儿几乎是刚需**。
//                 它只是把选中的文字发给 API，不需要这篇文章在 vault 里。
//   右栏「标记」  **没有**。这篇文章不在 vault 里：没有 notes.md 可写，
//                 也没有 .highlights.md 可锚。画一个永远空的页签比不画更糟。
//   右栏「对话」  **没有**。那条通道的价值是「能读你整个 vault」，而这篇不在 vault 里；
//                 真要深聊，正确的顺序是先存素材、进了流水线再聊。
//
// 抓不到是常态（站点挡爬虫、正文要 JS 渲染）。那时候要说人话、并且把原链接给回去——
// 一个只会说「失败」的阅读器比没有更糟。

import { useCallback, useEffect, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { api } from "../lib/api.js";
import { useAiRuns } from "../lib/use-ai-runs.js";
import { Reader } from "./Reader.jsx";
import { SideRail } from "./SideRail.jsx";
import { ErrorNote, Loading } from "./ui.jsx";
import { lockScroll } from "../lib/scroll-lock.js";
import {
  IconArchive,
  IconArrowLeft,
  IconArrowUpRight,
  IconBulb,
  IconCopy,
  IconLanguage,
  IconLayoutSidebar,
  IconLayoutSidebarRight,
  IconLink,
  IconX,
} from "./icons.jsx";

/**
 * 划词动作：问 AI 的四个 + 带走的两个。**没有高亮和批注**——它们要往 vault 里写，
 * 而这篇文章不在 vault 里。给一个点了报错的按钮，不如不给。
 */
const ACTIONS = [
  { key: "解释", label: "解释", hint: "这段在说什么", icon: IconBulb, group: 1 },
  { key: "translate", label: "翻译", hint: "翻成中文（DeepL）——热点里英文原文占一半", icon: IconLanguage, group: 1 },
  { key: "intake", label: "存素材", hint: "存成可复用的素材卡", icon: IconArchive, group: 2 },
  { key: "copy", label: "复制", hint: "拷进剪贴板", icon: IconCopy, group: 2 },
];

export function ArticleOverlay({ item, onClose, onIntake, onToast }) {
  const [state, setState] = useState({ loading: true });
  const [outline, setOutline] = useState([]);
  const [rails, setRails] = useState({ left: true, right: false });
  const [railMode, setRailMode] = useState("ai");
  const [quote, setQuote] = useState("");

  const title = state.article?.title || item.title;
  const { ai, runAi, translate, stopAi } = useAiRuns({
    title,
    // 一划词就把右栏打开：在这儿点「解释」的人显然是想马上看到结果
    onStart: useCallback((text) => {
      setQuote(text);
      setRailMode("ai");
      setRails((r) => ({ ...r, right: true }));
    }, []),
  });

  useEffect(() => {
    let dead = false;
    setState({ loading: true });
    setOutline([]);
    api
      .readArticle(item.link)
      .then((r) => !dead && setState({ article: r.article }))
      .catch((e) => !dead && setState({ error: e }));
    return () => {
      dead = true;
    };
  }, [item.link]);

  // Esc、焦点陷阱、背景 inert、关闭后焦点归位都在 useDialog 里。
  // 这里只剩「锁住下面那层的滚动」——不锁的话窗口右边挂着一条滚了也没反应的滚动条。
  // 锁的是正文面板不是 body（容器结构改版之后 body 不滚了），判据在 lib/scroll-lock.js。
  const boxRef = useDialog(true, onClose, { autoFocus: false });
  useEffect(() => lockScroll(), []);

  const intake = useCallback(
    (content) => onIntake({ content, source: `${item.title} · ${item.link}` }),
    [item, onIntake]
  );

  const onSelect = useCallback(
    ({ action, text, context }) => {
      if (action === "intake") {
        intake(text);
      } else if (action === "translate") {
        translate(text);
      } else if (action === "copy") {
        navigator.clipboard?.writeText(text).then(
          () => onToast?.("复制好了"),
          () => onToast?.("复制失败，手动选中拷一下吧")
        );
      } else {
        runAi(action, text, context);
      }
    },
    [intake, translate, runAi, onToast]
  );

  const a = state.article;
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="reader-overlay" ref={boxRef} role="dialog" aria-modal="true" aria-label={item.title}>
      <header className="reader-overlay__bar">
        <button className="btn btn-sm" onClick={onClose}>
          <IconArrowLeft aria-hidden="true" stroke={1.8} />
          返回热点
        </button>
        <span className="reader-overlay__crumb">
          热点 <span aria-hidden="true">/</span> {a?.siteName || hostOf(item.link)}
          {a?.words ? ` / ${a.words} 字` : ""}
        </span>
        {/* 原网页的入口一直留着：提取出来的正文不一定完整，图表和交互都在原页面上 */}
        <a className="btn btn-sm" href={item.link} target="_blank" rel="noreferrer">
          <IconArrowUpRight aria-hidden="true" stroke={1.8} />
          原网页
        </a>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => intake([item.title, item.link, item.summary].filter(Boolean).join("\n"))}
        >
          <IconArchive aria-hidden="true" stroke={1.8} />
          存进灵感库
        </button>
        {outline.length ? (
          <button
            className="icon-btn"
            onClick={() => setRails((r) => ({ ...r, left: !r.left }))}
            aria-pressed={!rails.left}
            title={rails.left ? "收起目录" : "展开目录"}
            aria-label={rails.left ? "收起目录" : "展开目录"}
          >
            <IconLayoutSidebar aria-hidden="true" stroke={1.7} />
          </button>
        ) : null}
        <button
          className="icon-btn"
          onClick={() => setRails((r) => ({ ...r, right: !r.right }))}
          aria-pressed={rails.right}
          title={rails.right ? "收起 AI 面板" : "展开 AI 面板"}
          aria-label={rails.right ? "收起 AI 面板" : "展开 AI 面板"}
        >
          <IconLayoutSidebarRight aria-hidden="true" stroke={1.7} />
        </button>
        <button className="icon-btn" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
          <IconX aria-hidden="true" stroke={1.8} />
        </button>
      </header>

      <div className="reader-overlay__body">
        {/* 目录只在真有小标题时才占一栏：一条只有一项的目录不是目录 */}
        {rails.left && outline.length ? (
          <aside className="doc-rail">
            <div className="doc-rail__block">
              <h2 className="doc-rail__title">{title}</h2>
              <p className="doc-rail__meta">
                <span className="doc-rail__path">{a?.siteName || hostOf(item.link)}</span>
              </p>
              {a?.words ? (
                <p className="doc-rail__stats">
                  <span>{a.words.toLocaleString("zh-CN")} 字</span>
                  <span>约 {Math.max(1, Math.round(a.words / 400))} 分钟读完</span>
                </p>
              ) : null}
            </div>
            <nav className="doc-rail__toc" aria-label="本文目录">
              <span className="doc-rail__label">ON THIS PAGE</span>
              {outline.map((h) => (
                <button key={h.id} type="button" className={`doc-rail__item doc-rail__item--l${h.level}`} onClick={() => jump(h.id)}>
                  {h.text}
                </button>
              ))}
            </nav>
          </aside>
        ) : null}

        <div className="ws-main">
          {state.loading ? (
            <div className="reader">
              <Loading rows={6} />
              <p className="page-sub">正在把原文抓下来读成正文——挡爬虫或者要 JS 渲染的站点会失败，那时候点右上角「原网页」。</p>
            </div>
          ) : state.error ? (
            <div className="reader">
              <ErrorNote error={state.error} what="读取原文" />
              <div className="row-actions" style={{ marginTop: 12 }}>
                <a className="btn btn-primary" href={item.link} target="_blank" rel="noreferrer">
                  <IconArrowUpRight aria-hidden="true" stroke={1.8} />
                  去原网页看
                </a>
              </div>
            </div>
          ) : (
            <Reader
              title={title}
              content={a.markdown}
              format="markdown"
              actions={ACTIONS}
              onSelect={onSelect}
              onOutline={setOutline}
            >
              <div className="doc-meta">
                {[["来源", a.siteName], ["作者", a.byline]].filter(([, v]) => v).map(([k, v]) => (
                  <span key={k} className="doc-meta__item">
                    <b>{k}</b>
                    <span>{v}</span>
                  </span>
                ))}
                <a className="doc-meta__link" href={item.link} target="_blank" rel="noreferrer">
                  <IconLink size={13} stroke={1.7} aria-hidden="true" />
                  原文
                  <IconArrowUpRight size={12} stroke={1.9} aria-hidden="true" />
                </a>
              </div>
              <p className="page-sub" style={{ margin: "0 0 4px" }}>
                正文是从原网页提取的（可能漏掉图表和交互）。划一段能存素材，也能让 AI 解释或翻译。
              </p>
            </Reader>
          )}
        </div>

        {/* 右栏只给「理解」：这篇不在 vault 里，「标记」没有落点、「对话」翻不到它 */}
        {rails.right && a ? (
          <SideRail
            tabs={["ai"]}
            saveLabel="存素材"
            railActions={["intake", "copy"]}
            mode={railMode}
            onMode={setRailMode}
            onCollapse={() => setRails((r) => ({ ...r, right: false }))}
            quote={quote}
            ai={ai}
            onRunAi={(mode, text) => (mode === "翻译" ? translate(text) : runAi(mode, text))}
            onStopAi={stopAi}
            // 这篇不在 vault 里，「存为笔记」没有落点——改成存素材（它有落点：流水线）
            onSaveAiAsNote={(r) => r?.text && intake(`${r.mode}：${quote}\n\n${r.text}`)}
            onRailSelect={({ action, text }) =>
              action === "copy"
                ? navigator.clipboard?.writeText(text).then(() => onToast?.("复制好了"))
                : intake(text)
            }
          />
        ) : null}
      </div>
    </div>
  );
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "原文";
  }
};
