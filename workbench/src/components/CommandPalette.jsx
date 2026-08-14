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
import { setOpenTarget } from "../lib/open-target.js";
import { bookProgress, pct, recentReadings, resumeEntry } from "../lib/reading.js";
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
} from "./icons.jsx";

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

export function CommandPalette({ open, onClose, onGo, vaultName }) {
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
  const rows = useMemo(() => {
    if (q.trim()) return (data?.results || []).map((r) => ({ kind: "result", ...r }));
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
    return out;
  }, [q, data, resume]);

  /**
   * 打开一条结果。**目标是「那一条」，不是「那一条所在的那一页」**——
   * 搜到之后还要自己在列表里再找一遍的话，检索就只做了一半。
   *
   * 三条去处，按「这东西在工作台里有没有落点」分：
 *  - 有页面也有条目（灵感库/素材库/选题库/稿件库/洞察）→ 跳过去 **并且直接打开正文**
   *    （`setOpenTarget` 放一张一次性的交接条，目标页列表加载完就消费掉）
   *  - 有页面但按整体定位（书、已发布作品）→ 跳过去，那一页自己会落到位
   *  - **工作台里压根没有它的页面**（归档、网页批注）→ 用 `obsidian://` 在 Obsidian
   *    里打开那个文件。这比画一行点了没反应的结果强，也比硬造一个只读页诚实。
   */
  const run = useCallback(
    (row) => {
      if (!row) return;
      if (row.kind === "query") {
        setQ(row.title);
        inputRef.current?.focus();
        return;
      }
      noteQuery(q);
      const go = row.go || {};
      if (go.view) {
        if (go.open) setOpenTarget(go.view, go.open);
        onGo(go.view, go.state);
        onClose();
        return;
      }
      if (go.vaultPath && vaultName) {
        window.open(
          `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(go.vaultPath.replace(/\.md$/i, ""))}`,
          "_blank",
          "noopener,noreferrer"
        );
        onClose();
        return;
      }
      if (row.url) window.open(row.url, "_blank", "noopener,noreferrer");
    },
    [onGo, onClose, q, vaultName]
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
  const groups = term
    ? [{ label: data ? `${data.total} 条结果${data.total > rows.length ? `（显示前 ${rows.length} 条）` : ""}` : "搜索中…", from: 0, to: rows.length }]
    : groupsOfResume(resume);

  return (
    <div className="scrim scrim--top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" ref={boxRef} role="dialog" aria-modal="true" aria-label="全局检索">
        <div className="cmdk__input">
          <IconSearch size={17} stroke={1.8} aria-hidden="true" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          placeholder="搜书、灵感库、素材库、选题库、稿件库、洞察、已发布作品…"
            aria-label="搜索"
          />
          {busy ? <span className="cmdk__busy">搜索中…</span> : null}
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
                        {row.state ? <span className="tag tag--state">{row.state}</span> : null}
                        {/* 只有「会在 Obsidian 里打开」需要提前说：那是离开工作台的动作，
                            其余的都留在工作台里，说了反而是噪音 */}
                        {row.go?.vaultPath ? <span className="cmdk__type">在 Obsidian 打开</span> : null}
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
  return out;
}
