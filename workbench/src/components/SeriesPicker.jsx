// 归类选择器。**一颗，两个方向。**
//
// 合集的「不方便」主要不是页面难看，是**只有一条路能进去**：先进合集，再点
// 「添加已有文章」，再搜。所以归类这件事要在三个地方都能做，而那三处必须是
// 同一颗控件：
//
//   1. 文章列表的行菜单 → 给这篇文章挑合集（`mode="series"`）
//   2. 文章工作区页头     → 同上
//   3. 合集目录页         → 给这个合集挑文章（`mode="articles"`）
//
// ⚠️ **已归属的条目要列出来并说明原因，不能过滤掉。** 旧版的
// `ProjectLinkDialog` 直接把已属于其他合集的文章从列表里删掉，于是你看到的是
// 「没有可添加的文章」——一句既不解释也无法执行的话。现在一篇文章可以进多个
// 合集，唯一该禁用的只有「已经在这个合集里」。

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { useDialog } from "../lib/use-dialog.js";
import { ErrorNote, Loading } from "./ui.jsx";
import { IconLoader2, IconPlus, IconSearch, IconX } from "./icons.jsx";

export function SeriesPicker({ open, mode, seriesId, project, onClose, onDone }) {
  const [options, setOptions] = useState(null);
  const [picked, setPicked] = useState([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const boxRef = useDialog(open, onClose, { autoFocus: true });

  const load = () => {
    setOptions(null);
    const request = mode === "series"
      ? api.seriesList().then((data) => (data.series || []).map((item) => ({
        id: item.id,
        title: item.title,
        sub: item.description || `${item.progress.total} 篇文章`,
      })))
      : Promise.all([api.projects(), api.series(seriesId)]).then(([projects, series]) => {
        const inside = new Set((series.series.entries || []).filter((entry) => entry.kind === "article").map((entry) => entry.projectId));
        return (projects.projects || []).map((item) => ({
          id: item.id,
          title: item.title || "未命名内容",
          sub: item.brief?.viewpoint || item.stage,
          // 唯一的禁用理由，而且写出来
          disabled: inside.has(item.id) ? "已在这个合集里" : "",
        }));
      });
    request.then(setOptions).catch(setError);
  };

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
    setBusy(false);
    setPicked(mode === "series" ? (project?.collections || []).map((item) => item.id) : []);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, seriesId, project?.id]);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!options) return [];
    if (!term) return options;
    return options.filter((item) => `${item.title}\n${item.sub || ""}`.toLowerCase().includes(term));
  }, [options, query]);

  // 搜不到就地建一个合集：找不到东西时给的是下一步，不是一句「无结果」
  const canCreate = mode === "series"
    && query.trim().length > 0
    && !(options || []).some((item) => item.title.trim() === query.trim());

  if (!open) return null;

  const toggle = (id) => setPicked((all) => (all.includes(id) ? all.filter((item) => item !== id) : [...all, id]));

  async function createSeries() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const result = await api.createSeries({ title: query.trim() });
      setOptions((all) => [{ id: result.series.id, title: result.series.title, sub: "0 篇文章" }, ...(all || [])]);
      setPicked((all) => [...all, result.series.id]);
      setQuery("");
    } catch (cause) {
      setError(cause);
    } finally {
      setCreating(false);
    }
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = mode === "series"
        ? await api.setProjectSeries(project.id, picked)
        : await api.addSeriesArticles(seriesId, picked);
      onDone?.(result);
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  const heading = mode === "series" ? "把这篇文章放进合集" : "把文章放进这个合集";
  const changed = mode === "series"
    ? picked.slice().sort().join() !== (project?.collections || []).map((item) => item.id).sort().join()
    : picked.length > 0;

  return (
    <div className="scrim scrim--center" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="modal picker" role="dialog" aria-modal="true" aria-label={heading} ref={boxRef}>
        <header className="picker__head">
          <h2>{heading}</h2>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="关闭"><IconX aria-hidden="true" /></button>
        </header>

        <div className="picker__search">
          <IconSearch aria-hidden="true" stroke={1.8} />
          <input
            data-autofocus=""
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === "series" ? "搜索合集，或输入新名字" : "搜索标题或核心观点"}
            aria-label="搜索"
          />
        </div>

        {!options ? <div className="picker__load"><Loading rows={4} /></div> : (
          <div className="picker__list" role="group" aria-label={heading}>
            {shown.map((item) => (
              <label className={`picker__row${item.disabled ? " is-off" : ""}`} key={item.id}>
                <input
                  type="checkbox"
                  checked={picked.includes(item.id)}
                  disabled={Boolean(item.disabled) || busy}
                  onChange={() => toggle(item.id)}
                />
                {/* ⚠️ 勾选态**只由复选框表达**。右端再挂一个 ✓ 是同一件事说两遍，
                    而且它和「已在这个合集里」那条禁用态在视觉上会混成一个意思。 */}
                <span>
                  <b>{item.title}</b>
                  <small>{item.disabled || item.sub}</small>
                </span>
              </label>
            ))}
            {canCreate ? (
              <button type="button" className="picker__create" onClick={createSeries} disabled={creating}>
                {creating ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconPlus aria-hidden="true" stroke={1.9} />}
                新建合集「{query.trim()}」
              </button>
            ) : null}
            {!shown.length && !canCreate ? (
              <p className="picker__empty">
                {mode === "series" ? "还没有合集。输入一个名字就能新建。" : "没有可放进来的文章。先去创作里新建一篇。"}
              </p>
            ) : null}
          </div>
        )}

        <ErrorNote error={error} what={mode === "series" ? "修改归属" : "加入合集"} />

        <footer className="picker__foot">
          {/* 变了几处直接说出来，不让用户自己数勾了几个 */}
          <span>{mode === "series" ? `已选 ${picked.length} 个合集` : `已选 ${picked.length} 篇`}</span>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy || !changed}>
            {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}确认
          </button>
        </footer>
      </section>
    </div>
  );
}
