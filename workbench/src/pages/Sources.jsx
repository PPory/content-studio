// 资料：知识库里「我已经有什么」的那一半。
//
// ⚠️ **这一页不再复用书架的封面墙。** 封面墙对**书**是对的——你靠封面认书；
// 但课程章节和飞书导出的文档根本没有封面，那面墙上摆的是一排灰底占位框和
// 「加封面」按钮，屏幕上最显眼的东西全是噪音。
//
// 换成表格之后，每一列都在回答一个问题：这是什么、有多少、**读过没有**、
// **有没有被用上**。最后那一列（影响了几张 Wiki 页面）是知识库特有的：
// 它区分「读过并且沉淀下来了」和「导进来放着」，而这两者在任何文件列表里
// 都长得一模一样。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Empty, Loading, SearchBox } from "../components/ui.jsx";
import { IconChevronRight, IconSearch } from "../components/icons.jsx";

const KIND_ORDER = ["书籍", "课程", "文档", "文章"];
const KIND_HINT = {
  书籍: "别人写的书",
  课程: "成体系的课，按节读",
  文档: "单篇资料",
  文章: "自己写的历史文章与已发布版本",
};

const FILTERS = [
  ["all", "全部"],
  ["undistilled", "未编译"],
  ["queued", "排队中"],
  ["proposed", "待审阅"],
  ["failed", "失败"],
];

const number = (value) => Number(value || 0).toLocaleString();

/**
 * 编译进度。**三种状态要分得开**：一份都没读过、读了一部分、全读完了。
 * 只显示百分比的话「0%」和「还没开始」看起来一样，而它们要做的事不同。
 */
function distillState(source) {
  if (!source.documents) return { tone: "idle", label: "空" };
  if (source.failed) return { tone: "warn", label: `${source.failed} 节失败` };
  if (source.proposed) return { tone: "busy", label: `${source.proposed} 节待审阅` };
  if (source.queued) return { tone: "busy", label: `${source.queued} 节排队中` };
  if (source.rejected) return { tone: "idle", label: `${source.rejected} 节已拒绝` };
  if (!source.distilled) return { tone: "idle", label: "未编译" };
  if (source.distilled < source.documents) return { tone: "busy", label: `${source.distilled}/${source.documents} 节` };
  return { tone: "done", label: "已编译" };
}

function matchesFilter(source, filter) {
  if (filter === "undistilled") return source.distilled < source.documents && !source.queued && !source.proposed;
  if (filter === "queued") return source.queued > 0;
  if (filter === "proposed") return source.proposed > 0;
  if (filter === "failed") return source.failed > 0;
  return true;
}

function GroupSelectAll({ kind, items, selected, onToggle }) {
  const input = useRef(null);
  const selectedCount = items.reduce((count, item) => count + Number(selected.has(item.id)), 0);
  const checked = items.length > 0 && selectedCount === items.length;
  useEffect(() => {
    if (input.current) input.current.indeterminate = selectedCount > 0 && !checked;
  }, [checked, selectedCount]);
  return (
    <input
      ref={input}
      type="checkbox"
      aria-label={`全选${kind}`}
      checked={checked}
      onChange={() => onToggle(items, !checked)}
    />
  );
}
export function Sources({ onOpen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(() => new Set());
  const [docs, setDocs] = useState(() => ({}));
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importForm, setImportForm] = useState({
    file: null, name: "", author: "本人", sourceKind: "文章", platform: "", publishedAt: "", sourceUrl: "", distill: true,
  });

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      const result = await api.knowledgeSources();
      setData(result);
      if (!silent) setError(null);
      return result;
    } catch (failure) {
      if (!silent) setError(failure);
      return null;
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadDocuments = useCallback(async (sourceId) => {
    try {
      const result = await api.knowledgeSourceDocs(sourceId);
      setDocs((current) => ({ ...current, [sourceId]: { items: result.documents, error: null } }));
    } catch (failure) {
      setDocs((current) => ({ ...current, [sourceId]: { items: [], error: failure } }));
    }
  }, []);

  // 章节按需拉。一次把 1389 节全取回来，为的只是「万一你想展开某一本」。
  const toggle = useCallback((source) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(source.id)) next.delete(source.id);
      else {
        next.add(source.id);
        setDocs((loaded) => {
          if (!loaded[source.id]) {
            loadDocuments(source.id);
            return { ...loaded, [source.id]: { items: null, error: null } };
          }
          return loaded;
        });
      }
      return next;
    });
  }, [loadDocuments]);

  const hasQueued = (data?.sources || []).some((source) => source.queued > 0);
  useEffect(() => {
    if (!hasQueued) return undefined;
    const poll = () => {
      load({ silent: true });
      for (const sourceId of open) loadDocuments(sourceId);
    };
    const timer = window.setInterval(poll, 2_000);
    return () => window.clearInterval(timer);
  }, [hasQueued, load, loadDocuments, open]);

  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matched = (data?.sources || []).filter((item) => matchesFilter(item, filter)
      && (!term || `${item.title} ${item.author || ""} ${item.platform || ""}`.toLowerCase().includes(term)));
    return KIND_ORDER
      .map((kind) => ({ kind, items: matched.filter((item) => (item.sourceKind || "书籍") === kind) }))
      .filter((group) => group.items.length);
  }, [data, query, filter]);

  const selectedSources = (data?.sources || []).filter((source) => selected.has(source.id));
  const selectedChars = selectedSources.reduce((sum, source) => sum + source.chars, 0);
  const toggleSelected = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleGroup = (items, checked) => setSelected((current) => {
    const next = new Set(current);
    for (const item of items) {
      if (checked) next.add(item.id); else next.delete(item.id);
    }
    return next;
  });

  const queue = async ({ bookIds = [], documentIds = [], retry = false, key = "batch" }) => {
    setBusy(key); setNotice("");
    try {
      const result = await api.queueKnowledgeIngest({ bookIds, documentIds, retry });
      setNotice(result.queued
        ? `已排队 ${result.queued} 节（约 ${number(result.chars)} 字）${result.capped ? "；单批最多 20 节，其余请下一批继续" : ""}`
        : `没有重复排队；已跳过 ${result.skipped} 节`);
      setSelected(new Set());
      await load();
      await Promise.all([...open].map((sourceId) => loadDocuments(sourceId)));
    } catch (failure) { setError(failure); }
    finally { setBusy(""); }
  };

  const submitImport = async (event) => {
    event.preventDefault();
    if (!importForm.file) return;
    setBusy("import"); setError(null);
    try {
      const result = await api.importBook(importForm.file, importForm.name, {
        sourceKind: importForm.sourceKind, kind: "藏书", author: importForm.author, platform: importForm.platform,
        publishedAt: importForm.publishedAt ? new Date(importForm.publishedAt).toISOString() : "",
        sourceUrl: importForm.sourceUrl, userAuthored: importForm.sourceKind === "文章", distill: importForm.distill,
      });
      setNotice(`已导入「${result.book.title}」${result.queuedForDistill ? `，并排队编译 ${result.queuedForDistill} 节` : ""}`);
      setShowImport(false);
      setImportForm({ file: null, name: "", author: "本人", sourceKind: "文章", platform: "", publishedAt: "", sourceUrl: "", distill: true });
      await load();
    } catch (failure) { setError(failure); }
    finally { setBusy(""); }
  };

  if (error && !data) return <ErrorNote error={error} what="资料" onRetry={load} />;
  if (!data) return <Loading rows={6} />;

  const totals = data.totals;

  return (
    <div className="view-body">
      <div className="src-top">
        <div>
          <p className="src-lead">
            {number(totals.sources)} 份资料 · {number(totals.documents)} 节 · {number(totals.chars)} 字
            {totals.citedPages ? <> · 已影响 <b>{number(totals.citedPages)}</b> 张 Wiki 页面</> : null}
          </p>
          <p className="field-hint">编译会阅读全文并对照现有 Wiki；每批最多 20 节，先生成多页变更集，确认后才写入。</p>
        </div>
        <div className="row-actions">
          <button type="button" className="btn btn-sm" onClick={() => setShowImport((value) => !value)}>导入旧文章 / 资料</button>
          <SearchBox value={query} onChange={setQuery} placeholder="搜名称、作者或平台" ariaLabel="搜索资料" />
        </div>
      </div>

      {showImport ? (
        <form className="src-import" onSubmit={submitImport}>
          <div className="drawer-title">导入一份可追溯来源</div>
          <label className="field"><span>文件</span><input type="file" accept=".md,.markdown,.txt,.pdf,.epub" required onChange={(event) => setImportForm((form) => ({ ...form, file: event.target.files?.[0] || null }))} /></label>
          <label className="field"><span>显示名称</span><input value={importForm.name} onChange={(event) => setImportForm((form) => ({ ...form, name: event.target.value }))} placeholder="留空则使用文件名" /></label>
          <label className="field"><span>来源类型</span><select value={importForm.sourceKind} onChange={(event) => setImportForm((form) => ({ ...form, sourceKind: event.target.value }))}><option>文章</option><option>文档</option><option>课程</option><option>书籍</option></select></label>
          <label className="field"><span>作者</span><input value={importForm.author} onChange={(event) => setImportForm((form) => ({ ...form, author: event.target.value }))} /></label>
          <label className="field"><span>平台</span><input value={importForm.platform} onChange={(event) => setImportForm((form) => ({ ...form, platform: event.target.value }))} placeholder="公众号 / 知乎 / 小红书…" /></label>
          <label className="field"><span>发布时间</span><input type="datetime-local" value={importForm.publishedAt} onChange={(event) => setImportForm((form) => ({ ...form, publishedAt: event.target.value }))} /></label>
          <label className="field src-import__wide"><span>原文链接</span><input type="url" value={importForm.sourceUrl} onChange={(event) => setImportForm((form) => ({ ...form, sourceUrl: event.target.value }))} placeholder="可选；用于去重和回溯" /></label>
          <label className="src-import__check"><input type="checkbox" checked={importForm.distill} onChange={(event) => setImportForm((form) => ({ ...form, distill: event.target.checked }))} />导入后立即排队编译</label>
          <div className="row-actions"><button className="btn btn-primary btn-sm" type="submit" disabled={busy === "import" || !importForm.file}>{busy === "import" ? "导入中…" : "确认导入"}</button><button className="btn btn-sm" type="button" onClick={() => setShowImport(false)}>取消</button></div>
        </form>
      ) : null}

      <div className="src-controls">
        <div className="segmented" aria-label="筛选编译状态">{FILTERS.map(([value, label]) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>
        <div className="row-actions">
          {selected.size ? <span className="field-hint">已选 {selected.size} 份 · 约 {number(selectedChars)} 字</span> : null}
          <button type="button" className="btn btn-primary btn-sm" disabled={!selected.size || !!busy} onClick={() => queue({ bookIds: [...selected] })}>{busy === "batch" ? "排队中…" : "编译所选"}</button>
        </div>
      </div>
      {notice ? <p className="src-notice" role="status">{notice}</p> : null}
      {error ? <ErrorNote error={error} what="来源操作" onRetry={() => setError(null)} /> : null}

      {!groups.length ? (
        <Empty icon={IconSearch}>没有匹配「{query}」的资料。</Empty>
      ) : null}

      {groups.map((group) => (
        <section key={group.kind} className="src-group">
          <h3 className="src-group__head">
            {group.kind}
            <span className="src-group__count">{group.items.length}</span>
            <em>{KIND_HINT[group.kind]}</em>
          </h3>

          <div className="src-table src-table--select" role="table">
            {/* ⚠️ 表头不画底色也不加边框。设计系统那条「不要框里画框」——
                外壳已经是白框，这里再套一层盒子，屏幕上最响的就成了那圈线。 */}
            <div className="src-row src-row--head" role="row">
              <span role="columnheader"><GroupSelectAll kind={group.kind} items={group.items} selected={selected} onToggle={toggleGroup} /></span>
              <span role="columnheader">名称</span>
              <span role="columnheader">节数</span>
              <span role="columnheader">字数</span>
              <span role="columnheader">Wiki 编译</span>
              <span role="columnheader">影响页面</span>
            </div>

            {group.items.map((source) => {
              const state = distillState(source);
              const expanded = open.has(source.id);
              const loaded = docs[source.id];
              return (
                <div key={source.id} className="src-item">
                  <div className="src-row" role="row">
                    <span><input type="checkbox" aria-label={`选择 ${source.title}`} checked={selected.has(source.id)} onChange={() => toggleSelected(source.id)} /></span>
                    <button
                      type="button"
                      className="src-name"
                      aria-expanded={expanded}
                      onClick={() => toggle(source)}
                      title={expanded ? "收起章节" : "展开章节"}
                    >
                      <IconChevronRight aria-hidden="true" stroke={1.8} data-open={expanded ? "" : undefined} />
                      <span className="clamp">{source.title}</span>
                      {/* 可写性和归类是两件事，所以只在「能改正文」时标出来——
                          默认只读，标注例外比标注常态省一屏的字 */}
                      {source.writable === "资料" ? <em className="src-tag">可改</em> : null}
                    </button>
                    <span className="src-num">{number(source.documents)}</span>
                    <span className="src-num">{number(source.chars)}</span>
                    <span className={`src-state src-state--${state.tone}`}>{state.label}</span>
                    <span className="src-num src-num--strong">{source.citedPages ? number(source.citedPages) : "—"}</span>
                  </div>

                  {expanded ? (
                    <div className="src-children">
                      {!loaded || loaded.items === null ? <Loading rows={2} /> : loaded.error ? <ErrorNote error={loaded.error} what="章节" /> : loaded.items.length ? loaded.items.map((doc) => (
                        <div key={doc.id} className="src-row src-row--child" role="row">
                          <span />
                          <button type="button" className="src-name src-name--child" onClick={() => onOpen?.(source, doc)}>
                            <span className="clamp">{doc.title}</span>
                          </button>
                          <span className="src-num" />
                          <span className="src-num">{number(doc.chars)}</span>
                          <span className="src-doc-action">
                            <span className={`src-state src-state--${doc.ingestStatus === "failed" ? "warn" : ["queued", "proposed"].includes(doc.ingestStatus) ? "busy" : doc.ingestStatus === "applied" ? "done" : "idle"}`} title={doc.ingestError || undefined}>
                              {doc.ingestStatus === "applied" ? "已编译"
                                : doc.ingestStatus === "queued" ? "排队中"
                                : doc.ingestStatus === "proposed" ? "待审阅"
                                : doc.ingestStatus === "empty" ? "无可沉淀"
                                : doc.ingestStatus === "rejected" ? "已拒绝"
                                : doc.ingestStatus === "failed" ? "失败"
                                : "未编译"}
                            </span>
                            {["", "failed", "rejected"].includes(doc.ingestStatus) ? <button type="button" className="link-btn" disabled={!!busy} onClick={() => queue({ documentIds: [doc.id], retry: doc.ingestStatus !== "", key: doc.id })}>{busy === doc.id ? "排队…" : doc.ingestStatus ? "重试" : "编译"}</button> : null}
                          </span>
                          <span className="src-num src-num--strong">{doc.citedPages ? number(doc.citedPages) : "—"}</span>
                        </div>
                      )) : <p className="src-empty">这份资料没有章节。</p>}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
