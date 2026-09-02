/**
 * 全局检索 + 继续上次工作（Ctrl/⌘ + K）。
 *
 * **「继续上次工作」不是另一个页面，就是这个面板的空态。** 单独做一个大页面的话，
 * 它会是那种「装修完就再没人去过」的房间——而这个面板每天都要开，把「上次干到哪」
 * 放在它一打开就看见的地方，才真的会被用到。
 *
 * 三段，从上到下就是「我要干什么」的三种答案：
 *   打字前 → 接着上次（最近打开 / 最近在读 / 最近搜过）
 *   打字后 → 搜索结果
 *   两者都是**可以直接执行的**：回车就跳到那条自己的位置，不是跳到它所在模块的首页。
 *
 * 键盘是这个面板的主界面：↑↓ 选、Enter 走、Esc 关。鼠标也能用，但不该需要用。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { api } from "../lib/api.js";
import { recentOpened, recentQueries, noteQuery } from "../lib/recent.js";
import { normalizeMaterialOpen, setOpenTarget } from "../lib/open-target.js";
import { bookProgress, pct, recentReadings, resumeEntry } from "../lib/reading.js";
import { stateTone } from "./ui.jsx";
import {
  IconBook2,
  IconBulb,
  IconClock,
  IconFileText,
  IconHistory,
  IconSearch,
  IconSparkles,
  IconStack2,
  IconChartLine,
  IconClipboardList,
  IconX,
} from "./icons.jsx";
import { useClearDissolve } from "../lib/use-clear-dissolve.js";
import "./clear-dissolve.css";

// 结果类型 → 图标。认不出的回落到文件图标——**宁可给个通用的，
// 也不要一行有图标一行没有**（和元信息那套字段图标同一条规矩）。
const TYPE_ICONS = {
  book: IconBook2,
  insight: IconSparkles,
  archive: IconFileText,
  webnote: IconFileText,
  inbox: IconBulb,
  materials: IconStack2,
  topics: IconClipboardList,
  drafts: IconFileText,
  post: IconChartLine,
  reading: IconBook2,
  recent: IconHistory,
};

const DEBOUNCE = 180; // 中文输入法一个词要敲好几下，太短会把没打完的拼音也搜一遍

export function CommandPalette({ open, onClose, onGo, onCaptureVoice }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [resume, setResume] = useState({ opened: [], reading: [], queries: [] });
  const inputRef = useRef(null);
  // 焦点陷阱 + 背景 inert + 关闭后焦点归位。**Esc 不交给它**：这个面板的 Esc
  // 和上下键、回车在同一个监听里，拆开两处只会让「按了没反应」多一个可能的出处。
  const boxRef = useDialog(open, undefined, { autoFocus: false });
  const listRef = useRef(null);
  /**
   * 清空时字升起来散掉（transitions.dev / Input clear with dissolve）。
   * 这一处是它最该在的地方：面板里一颗 `×` 换掉的是**整份检索结果**。
   */
  const { wrapRef: clearWrapRef, clear: clearQuery } = useClearDissolve(() => setQ(""));

  // 打开时重置。**不保留上次的查询词**：这个面板的常见用法是「想到什么搜什么」，
  // 留着上次的词等于每次都要先按一遍退格。上次搜过什么在下面的列表里能点回来。
  useEffect(() => {
    if (!open) return;
    setQ("");
    setData(null);
    setError(null);
    setCursor(0);
    setResume({
      opened: recentOpened(6),
      reading: [],
      queries: recentQueries(),
    });
    api
      .books()
      .then((r) => {
        const items = recentReadings(r.books || [], 2)
          .map((x) => ({ ...x, entry: resumeEntry(x.book, x.reading) }))
          .filter((x) => x.entry);
        setResume((s) => ({ ...s, reading: items }));
      })
      .catch(() => {});
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  // 搜索。**只发最后一次**：中文输入过程中每个按键都发一次请求的话，
  // 回来的顺序不保证，界面会闪回更早的那次结果。
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 1) {
      setData(null);
      setBusy(false);
      return;
    }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      api
        .search(term)
        .then((r) => {
          if (!alive) return;
          setData(r);
          setError(null);
          setCursor(0);
        })
        .catch((e) => alive && setError(e))
        .finally(() => alive && setBusy(false));
    }, DEBOUNCE);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open]);

  /**
   * 把「结果」和「接着上次」摊成同一个扁平数组，键盘才有一条连续的线可以走。
   * 分组标题不进这个数组——上下键跳过标题是应该的，选中一个标题什么也做不了。
   */
  /**
   * 「记一个用户问题」这一行。
   *
   * ⚠️ **它排在最后，不排第一。** 排第一意味着打完字按回车就变成「新建」而不是
   * 「打开搜到的第一条」——这个面板每天开几十次，把 Enter 的落点换掉的代价
   * 远大于少按一次方向键。放在结果末尾还正好对上真实动作：搜了一圈没有，
   * 所以它是新的。
   */
  const captureRow = (term) => ({
    kind: "capture",
    type: "inbox",
    typeLabel: "记下来",
    id: "capture:voice",
    title: term ? `记成用户原话：${term}` : "记录一段用户原话",
    snippet: "粘群聊、评论、私信或访谈原话。不用先想它是什么问题，提炼交给系统。",
    term,
  });

  const rows = useMemo(() => {
    if (q.trim()) return [...(data?.results || []).map((r) => ({ kind: "result", ...r })), captureRow(q.trim())];
    const out = [];
    for (const x of resume.reading) {
      out.push({
        kind: "reading",
        type: "reading",
        typeLabel: "接着读",
        id: `reading:${x.book.dir}`,
        title: x.book.name,
        source: `读到「${x.entry.title}」`,
        snippet: `全书 ${pct(bookProgress(x.book, x.reading))}`,
        go: { view: "shelf", state: x.book.dir },
      });
    }
    for (const x of resume.opened) out.push({ kind: "recent", ...x, typeLabel: x.typeLabel || "最近打开" });
    for (const s of resume.queries) out.push({ kind: "query", id: `q:${s}`, type: "recent", typeLabel: "搜过", title: s });
    out.push(captureRow(""));
    out.push(
      {
        kind: "legacy-route",
        type: "topics",
        typeLabel: "兼容入口",
        id: "route:ideas",
        title: "找题（旧版）",
        go: { view: "ideas", state: "" },
      },
      {
        kind: "legacy-route",
        type: "inbox",
        typeLabel: "兼容入口",
        id: "route:seeds",
        title: "选题 / 种子（旧版）",
        go: { view: "seeds", state: "" },
      },
    );
    return out;
  }, [q, data, resume]);

  /**
   * 打开一条结果。**目标是「那一条」，不是「那一条所在的那一页」**——
   * 搜到之后还要自己在列表里再找一遍的话，检索就只做了一半。
   *
   * 两条去处，按结果类型分：
   *  - 有页面也有条目（灵感库/素材库/选题库/稿件库/洞察）→ 跳过去 **并且直接打开正文**
   *    （`setOpenTarget` 放一张一次性的交接条，目标页列表加载完就消费掉）
   *  - 有页面但按整体定位（书、已发布作品）→ 跳过去，那一页自己会落到位
   */
  const run = useCallback(
    (row) => {
      if (!row) return;
      if (row.kind === "query") {
        setQ(row.title);
        inputRef.current?.focus();
        return;
      }
      if (row.kind === "capture") {
        /**
         * ⚠️ **这里原来直接建了一条 `origin=observed` 的用户问题，
         * 并且把用户刚打的那行字同时当成「问题」和「逐字证据」。**
         * 那条证据除了把 statement 复制一遍什么也没说明——真实库里那条唯一的
         * 「观察」就是这么来的。观察和推断一旦混在一个字段里，后面所有
         * 「有多少人真的这样问过」的判断都不再可信。
         *
         * 现在这一行只负责把**原话**收进不可变证据层，问题由 AI 之后从原话里读，
         * 而且读出来的仍然只是候选。
         */
        onCaptureVoice?.(row.term || "");
        onClose();
        return;
      }
      noteQuery(q);
      const go = row.go || {};
      if (go.view) {
        const material = normalizeMaterialOpen(go.view, go.open);
        if (material) {
          setOpenTarget(material.targetView, material.key);
          onGo(material.view, "");
        } else {
          if (go.open) setOpenTarget(go.view, go.open);
          onGo(go.view, go.state);
        }
        onClose();
        return;
      }
      if (row.url) window.open(row.url, "_blank", "noopener,noreferrer");
    },
    [onGo, onClose, onCaptureVoice, q]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") return onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => {
          const n = rows.length;
          if (!n) return 0;
          return (c + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        run(rows[cursor]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rows, cursor, run, onClose]);

  // 键盘走到看不见的地方时把它滚进来。不做的话按几下下箭头，高亮就消失在列表下面了
  useEffect(() => {
    listRef.current?.querySelector('[data-at="1"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor, rows]);

  if (!open) return null;

  const term = q.trim();
  // 有查询词时最后一行是「记下来」，不算进结果计数里。
  const resultCount = term ? Math.max(0, rows.length - 1) : rows.length;
  const groups = (term
    ? [
      {
        // ⚠️ 用**实际拿到几条**判断有没有结果，不用 data.total——有的来源不回这个字段，
        // 那时候标题会变成「undefined 条结果」。
        label: !data
          ? "搜索中…"
          : resultCount === 0
            ? `没找到「${term}」`
            : `${data.total ?? resultCount} 条结果${data.total > resultCount ? `（显示前 ${resultCount} 条）` : ""}`,
        from: 0,
        to: resultCount,
      },
      { label: "记下来", from: resultCount, to: rows.length },
    ]
    : groupsOfResume(resume)).filter((group) => group.to > group.from || group.label.startsWith("没找到") || group.label === "搜索中…");

  return (
    <div className="scrim scrim--top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" ref={boxRef} role="dialog" aria-modal="true" aria-label="全局检索">
        {/* ⚠️ **这儿多了一颗 `×`。** 原来只有 Esc，而 Esc 在这一层是「关掉整个面板」——
            想换个词重搜的人只能全选再删。清空和关闭是两件事，得有两个记号。 */}
        <div className="cmdk__input t-clear" ref={clearWrapRef}>
          <IconSearch size={17} stroke={1.8} aria-hidden="true" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          placeholder="搜书、素材、选题、稿件、洞察、已发布作品…"
            aria-label="搜索"
          />
          {busy ? <span className="cmdk__busy">搜索中…</span> : null}
          {q ? (
            <button
              type="button"
              className="search-box__clear"
              title="清空"
              aria-label="清空搜索"
              onClick={() => { clearQuery(q); inputRef.current?.focus(); }}
            >
              <IconX size={13} stroke={2} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {error ? (
          <div className="cmdk__note">
            检索失败：{error.message}
            {error.hint ? <div className="field-hint">{error.hint}</div> : null}
          </div>
        ) : null}

        <div className="cmdk__list" ref={listRef}>
          {!rows.length ? (
            <div className="cmdk__note">
              {term
                ? busy
                  ? "搜索中…"
                  : "没找到。换个词试试——检索匹配的是标题和正文，词与词之间是「都要有」。"
                : "还没有可以接着的东西。读一本书、打开一条素材，下次这里就能一键回去。"}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="cmdk__group">
                <div className="cmdk__group-label">{g.label}</div>
                {rows.slice(g.from, g.to).map((row, i) => {
                  const at = g.from + i;
                  const Icon = TYPE_ICONS[row.type] || IconFileText;
                  return (
                    <button
                      key={row.id}
                      className="cmdk__row"
                      data-at={at === cursor ? 1 : 0}
                      aria-current={at === cursor}
                      onMouseEnter={() => setCursor(at)}
                      onClick={() => run(row)}
                    >
                      <Icon size={16} stroke={1.7} aria-hidden="true" />
                      <span className="cmdk__body">
                        <span className="cmdk__title">{row.title}</span>
                        {row.snippet ? <span className="cmdk__snippet">{row.snippet}</span> : null}
                      </span>
                      <span className="cmdk__side">
                        {row.state ? <span className="tag tag--state" data-tone={stateTone(row.state)}>{row.state}</span> : null}
                        <span className="cmdk__type">{row.typeLabel}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* 底部这一行是**唯一常驻的快捷键提示**：这个面板本身就是靠键盘用的，
            而其余地方的快捷键提示都留在 title 里（只有第一天有用的东西不该常驻）。 */}
        <div className="cmdk__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选
          </span>
          <span>
            <kbd>Enter</kbd> 打开
          </span>
          <span>
            <kbd>Esc</kbd> 关闭
          </span>
          {data?.sources?.some((s) => !s.ok) ? (
            <span className="cmdk__degraded" title={data.sources.filter((s) => !s.ok).map((s) => `${s.key}：${s.error}`).join("；")}>
              有 {data.sources.filter((s) => !s.ok).length} 个来源没搜到
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 空态的分组边界。列表本身是扁平的（键盘要一条连续的线），标题只是插在中间的标签。 */
function groupsOfResume(resume) {
  const out = [];
  let at = 0;
  const push = (label, n) => {
    if (!n) return;
    out.push({ label, from: at, to: at + n });
    at += n;
  };
  push("接着读", resume.reading.length);
  push("最近打开", resume.opened.length);
  push("最近搜过", resume.queries.length);
  push("记下来", 1);
  push("旧入口", 2);
  return out;
}
