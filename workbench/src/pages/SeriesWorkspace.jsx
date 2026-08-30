// 合集详情 = **目录页**，不是表单页。
//
// 上一版进来先占掉一整屏：`COLLECTION` 眉标 + 「合集名称」label + 42px 标题输入框 +
// 一个 150px 高的空 textarea，右上角一颗灰掉的「保存合集」。你要看的「里面有哪几篇」
// 被推到第二屏，而**文件夹不该有保存按钮**。
//
// 现在：标题就地改、失焦即存（和文章工作区一套）；说明没写就是一行「＋ 添加说明」；
// 剩下整页都是目录。目录行给真信息（阶段 / 字数 / 多久没动），能拖着排序，
// 能插分节标题（教程要分「入门 / 进阶 / 参考」），顶上能通读和导出成一份 Markdown。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, downloadSeriesMarkdown } from "../lib/api.js";
import { ErrorNote, Loading, MenuButton, StatePill, Toast, relTime } from "../components/ui.jsx";
import { SeriesPicker } from "../components/SeriesPicker.jsx";
import { SeriesReader } from "./series/SeriesReader.jsx";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconBook,
  IconDots,
  IconDownload,
  IconFileText,
  IconGripVertical,
  IconLink,
  IconLoader2,
  IconPlus,
  IconSeparator,
  IconTrash,
} from "../components/icons.jsx";
import "./series.css";

export function SeriesWorkspace({ seriesId, onGo, onChanged }) {
  const [series, setSeries] = useState(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [writingDescription, setWritingDescription] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [picking, setPicking] = useState(false);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState("");
  const [over, setOver] = useState("");
  /** 就地编辑的那一处：`{ id, field: "heading" | "note", value }`；`id === "new-section"` 是待新建的分节。 */
  const [editing, setEditing] = useState(null);
  const descriptionRef = useRef(null);
  const editRef = useRef(null);

  const accept = useCallback((next) => {
    setSeries(next);
    setTitle(next.title);
    setDescription(next.description);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api.series(seriesId)
      .then((result) => { accept(result.series); setError(null); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [seriesId, accept]);

  useEffect(load, [load]);
  useEffect(() => { if (writingDescription) descriptionRef.current?.focus(); }, [writingDescription]);
  useEffect(() => { if (editing) editRef.current?.focus(); }, [editing?.id, editing?.field]);

  const entries = series?.entries || [];
  const articles = useMemo(() => entries.filter((entry) => entry.kind === "article"), [entries]);

  /** 一次跑一个写操作，回来的合集整个换掉——不在前端拼一份「应该长这样」。 */
  const run = useCallback(async (work, note) => {
    if (busy) return null;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (result?.series) accept(result.series);
      if (note) setToast({ text: note });
      onChanged?.();
      return result;
    } catch (cause) {
      setError(cause);
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, accept, onChanged]);

  /**
   * 标题失焦即存。
   *
   * ⚠️ **没有「保存合集」按钮**：改一个文件夹名字不该产生一次「有未保存改动」的状态。
   * 空标题不提交，直接还原——合集必须有名字，而弹一句错误去骂一个手滑清空的输入框
   * 比默默还原更烦。
   */
  async function commitTitle() {
    const next = title.trim();
    if (!series) return;
    if (!next) { setTitle(series.title); return; }
    if (next === series.title) return;
    await run(() => api.updateSeries(seriesId, { title: next, description: series.description }), "合集名已更新");
  }

  async function commitDescription() {
    if (!series) return;
    const next = description.trim();
    setWritingDescription(false);
    if (next === series.description) return;
    await run(() => api.updateSeries(seriesId, { title: series.title, description: next }), "说明已更新");
  }

  const move = (entryId, direction) => {
    const ids = entries.map((entry) => entry.id);
    const from = ids.indexOf(entryId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    run(() => api.reorderSeriesEntries(seriesId, ids));
  };

  /**
   * 拖到某一行上 = 插到它前面。
   *
   * ⚠️ **松手先本地排好再打服务端**：拖拽的手感要求松手就动。失败时下面的
   * `catch` 会把服务端那份整个换回来，不会留下「界面和库安静地分叉」。
   */
  const drop = (targetId) => {
    setOver("");
    if (!dragging || dragging === targetId) { setDragging(""); return; }
    const ids = entries.map((entry) => entry.id).filter((id) => id !== dragging);
    const at = ids.indexOf(targetId);
    ids.splice(at < 0 ? ids.length : at, 0, dragging);
    setDragging("");
    setSeries((current) => current && { ...current, entries: ids.map((id) => entries.find((entry) => entry.id === id)) });
    run(() => api.reorderSeriesEntries(seriesId, ids)).then((result) => { if (!result) load(); });
  };

  async function createArticle() {
    const profile = await api.writingProfile().then((value) => value.profile).catch(() => ({ platform: "公众号", audience: "" }));
    const result = await run(() => api.createArticleInSeries(seriesId, { platform: profile.platform || "公众号", audience: profile.audience || "" }));
    if (result?.projectId) onGo("project", result.projectId);
  }

  /**
   * 分节标题和条目说明都**就地改**。
   *
   * ⚠️ 不用 `window.prompt`：它是浏览器的模态框，读屏和键盘行为不受本页控制，
   * 样式也和这一页毫无关系；而且它会卡住 Playwright 那条真实流程验收。
   */
  function commitEdit() {
    const draft = editing;
    setEditing(null);
    if (!draft) return;
    const value = draft.value.trim();
    if (draft.id === "new-section") {
      if (value) run(() => api.addSeriesSection(seriesId, value), "已插入分节");
      return;
    }
    const entry = entries.find((item) => item.id === draft.id);
    if (!entry) return;
    if (draft.field === "heading") {
      if (!value || value === entry.heading) return;
      run(() => api.updateSeriesEntry(seriesId, entry.id, { heading: value }), "分节已更名");
      return;
    }
    if (value === (entry.note || "")) return;
    run(() => api.updateSeriesEntry(seriesId, entry.id, { note: value }), value ? "说明已更新" : "说明已清除");
  }

  const removeEntry = (entry) => run(
    () => api.removeSeriesEntry(seriesId, entry.id),
    entry.kind === "section" ? "已删除分节" : "已移出合集，文章仍在全部文章里",
  );

  async function exportMarkdown() {
    setError(null);
    try {
      const out = await downloadSeriesMarkdown(seriesId);
      setToast({ text: `已导出 ${out.name}` });
    } catch (cause) {
      setError(cause);
    }
  }

  if (loading && !series) return <div className="series-load"><Loading rows={5} /></div>;
  if (!series) {
    return (
      <div className="series-load">
        <button className="btn btn-sm" onClick={() => onGo("series")}><IconArrowLeft aria-hidden="true" />返回合集</button>
        <ErrorNote error={error} what="读取合集" onRetry={load} />
      </div>
    );
  }

  return (
    <div className="series-page">
      <header className="series-topbar">
        <button className="project-back" onClick={() => onGo("series")}><IconArrowLeft aria-hidden="true" />合集</button>
        <div className="series-topbar__end">
          {busy ? <span className="project-notice"><IconLoader2 className="spin" aria-hidden="true" />保存中</span> : null}
          <button className="btn" onClick={() => setReading(true)} disabled={!articles.length} title={articles.length ? "按顺序读完整个合集" : "合集还是空的"}>
            <IconBook aria-hidden="true" />通读
          </button>
          <button className="btn" onClick={exportMarkdown} disabled={!articles.length} title={articles.length ? "下载成一份 Markdown" : "合集还是空的"}>
            <IconDownload aria-hidden="true" />导出
          </button>
        </div>
      </header>

      <div className="series-body">
        <section className="series-brief">
          {/* 标题就地改、失焦即存。眉标和「合集名称」label 都删掉了——
              一个 40px 的标题输入框不需要另外两行字来解释它是标题 */}
          <input
            className="series-brief__title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            maxLength="120"
            aria-label="合集名称"
          />
          <p className="series-brief__stat">
            {series.progress.total} 篇
            {series.progress.published ? ` · ${series.progress.published} 篇已发布` : ""}
            {series.progress.recycled ? ` · ${series.progress.recycled} 篇在回收站` : ""}
          </p>

          {/* 说明折叠成一行。没写过的合集不该先看到半屏空 textarea */}
          {writingDescription || description ? (
            <textarea
              ref={descriptionRef}
              className="series-brief__desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={commitDescription}
              maxLength="2000"
              placeholder="这个合集收录什么内容"
              aria-label="合集说明"
            />
          ) : (
            <button type="button" className="series-brief__add" onClick={() => setWritingDescription(true)}>
              <IconPlus aria-hidden="true" stroke={1.9} />添加说明
            </button>
          )}
        </section>

        <section className="series-outline" aria-label="合集目录">
          {entries.map((entry, index) => {
            const isSection = entry.kind === "section";
            const editingThis = editing?.id === entry.id;
            const menu = [
              ...(isSection
                ? [{ key: "rename", title: "改分节标题", icon: IconSeparator, onPick: () => setEditing({ id: entry.id, field: "heading", value: entry.heading }) }]
                : [
                  ...(entry.projectId ? [{ key: "open", title: "打开文章", icon: IconFileText, onPick: () => onGo("project", entry.projectId) }] : []),
                  { key: "note", title: entry.note ? "改这条说明" : "加一条说明", hint: "这篇在这个合集里承担什么", icon: IconPlus, onPick: () => setEditing({ id: entry.id, field: "note", value: entry.note || "" }) },
                ]),
              { key: "up", title: "上移", icon: IconArrowUp, onPick: () => move(entry.id, -1) },
              { key: "down", title: "下移", icon: IconArrowDown, onPick: () => move(entry.id, 1) },
              {
                key: "remove",
                title: isSection ? "删除分节" : "移出合集",
                hint: isSection ? "" : "文章本身不删",
                icon: IconTrash,
                onPick: () => removeEntry(entry),
              },
            ];

            return (
              <div
                key={entry.id}
                className={`series-row${isSection ? " is-section" : ""}${entry.deleted ? " is-gone" : ""}`}
                data-over={over === entry.id ? "" : undefined}
                draggable={!busy}
                onDragStart={() => setDragging(entry.id)}
                onDragEnd={() => { setDragging(""); setOver(""); }}
                onDragOver={(event) => { if (!dragging) return; event.preventDefault(); setOver(entry.id); }}
                onDragLeave={() => setOver((id) => (id === entry.id ? "" : id))}
                onDrop={(event) => { event.preventDefault(); drop(entry.id); }}
              >
                <span className="series-row__grip" aria-hidden="true"><IconGripVertical size={15} stroke={1.6} /></span>

                {isSection ? (
                  editingThis ? (
                    <input
                      ref={editRef}
                      className="series-row__edit is-heading"
                      value={editing.value}
                      onChange={(event) => setEditing((current) => ({ ...current, value: event.target.value }))}
                      onBlur={commitEdit}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") { event.stopPropagation(); setEditing(null); }
                      }}
                      maxLength="120"
                      aria-label="分节标题"
                    />
                  ) : (
                    <h2 className="series-row__section">{entry.heading}</h2>
                  )
                ) : (
                  <>
                    <span className="series-row__no">{String(entry.number).padStart(2, "0")}</span>
                    <span className="series-row__main">
                      {entry.projectId ? (
                        <button type="button" className="series-row__title" onClick={() => onGo("project", entry.projectId)}>{entry.title}</button>
                      ) : (
                        <span className="series-row__title is-plain">{entry.title}</span>
                      )}
                      {/* 说明压在标题下面，不另开一列——大多数行那一格是空的 */}
                      {editingThis ? (
                        <input
                          ref={editRef}
                          className="series-row__edit"
                          value={editing.value}
                          onChange={(event) => setEditing((current) => ({ ...current, value: event.target.value }))}
                          onBlur={commitEdit}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") { event.stopPropagation(); setEditing(null); }
                          }}
                          maxLength="500"
                          placeholder="这篇在这个合集里承担什么（留空即清除）"
                          aria-label="条目说明"
                        />
                      ) : entry.note ? <em>{entry.note}</em> : null}
                    </span>
                    <StatePill state={entry.stage} size="sm" />
                    <span className="series-row__words">{entry.words ? `${entry.words} 字` : "—"}</span>
                    <time className="series-row__time">{relTime(entry.updatedAt)}</time>
                  </>
                )}

                {/* ↑↓ 收进菜单：拖拽是主路径，但 keyboard-only 也要能排序。
                    ⚠️ `mark={null}`——这不是新建菜单，每行挂个 `+` 是在说谎 */}
                <MenuButton
                  className="icon-btn"
                  ariaLabel={`「${isSection ? entry.heading : entry.title}」的操作`}
                  icon={IconDots}
                  items={menu}
                  align="end"
                  mark={null}
                />
              </div>
            );
          })}

          {!entries.length ? (
            <p className="series-outline__empty">这个合集还是空的。把已有文章放进来，或者直接在这里开始写第一篇。</p>
          ) : null}
        </section>

        <div className="series-add">
          {editing?.id === "new-section" ? (
            <input
              ref={editRef}
              className="series-row__edit is-heading series-add__field"
              value={editing.value}
              onChange={(event) => setEditing((current) => ({ ...current, value: event.target.value }))}
              onBlur={commitEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") { event.stopPropagation(); setEditing(null); }
              }}
              maxLength="120"
              placeholder="分节标题，比如「入门」「进阶」「参考」"
              aria-label="新分节标题"
            />
          ) : (
            <>
              <button className="btn" onClick={() => setPicking(true)} disabled={busy}><IconLink aria-hidden="true" />加入已有文章</button>
              <button className="btn" onClick={createArticle} disabled={busy}><IconPlus aria-hidden="true" />在合集中新建</button>
              <button className="btn btn-quiet" onClick={() => setEditing({ id: "new-section", field: "heading", value: "" })} disabled={busy}><IconSeparator aria-hidden="true" />插入分节</button>
            </>
          )}
        </div>

        <ErrorNote error={error} what="更新合集" />
      </div>

      <SeriesPicker
        open={picking}
        mode="articles"
        seriesId={seriesId}
        onClose={() => setPicking(false)}
        onDone={(result) => { accept(result.series); setToast({ text: `已加入 ${result.added} 篇` }); onChanged?.(); }}
      />
      <SeriesReader open={reading} seriesId={seriesId} onClose={() => setReading(false)} onExport={exportMarkdown} onGo={onGo} />
      <Toast text={toast?.text} onClose={() => setToast(null)} />
    </div>
  );
}
