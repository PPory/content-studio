import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { CONTENT_SHELVES, byTopicUrgency, contentShelf, projectOpenTarget, projectsFrom } from "../lib/content-projects.js";
import { openResearchContent, researchProjectId } from "../lib/open-content.js";
import { TopicShelf } from "./content/TopicShelf.jsx";
import { NewContentButton } from "../components/NewContentButton.jsx";
import { Empty, ErrorNote, LayoutToggle, Loading, PageHeader, Toast } from "../components/ui.jsx";
import { useUndoToast } from "../lib/use-undo-toast.js";
import { IconFileText, IconRefresh } from "../components/icons.jsx";
import { ProjectTable } from "./content/ProjectTable.jsx";
import { SeriesPicker } from "../components/SeriesPicker.jsx";
import "./series.css";
import { useLayoutMode } from "../lib/use-layout-mode.js";
import { ProjectCards } from "./content/ProjectCards.jsx";
import "./content/content-views.css";

export function Content({ workerReady, onGo, onChanged, onSettings }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useUndoToast();
  // 没选过时：有正在写的就先看「在写」，否则看「选题」。
  const [stage, setStage] = useState(() => { try { return sessionStorage.getItem("content-shelf") || ""; } catch { return ""; } });
  const [researches, setResearches] = useState([]);
  // 「来自我的知识」：最近一次扫描找到、还没加入的「知识 × 读者问题」。只读缓存，重新扫描才调模型。
  const [found, setFound] = useState([]), [scanning, setScanning] = useState(false);
  const [layout, setLayout] = useLayoutMode("content", "list");
  // 选题一档单独记：它默认是卡片（要动手的少数），切成列表也不影响「在写」那边。
  const [topicLayout, setTopicLayout] = useLayoutMode("content-topics", "card");
  /** 正在给哪一篇挑合集。归类要在**看得见这篇文章的地方**做，不是进合集再搜一遍。 */
  const [filing, setFiling] = useState(null);

  const load = useCallback(() => {
    if (!workerReady) return;
    setLoading(true);
    // 还没有对应内容的旧选题也列在「选题」里；读不到不挡住写作列表。
    api.researches().then((data) => setResearches(data.researches || [])).catch(() => setResearches([]));
    Promise.all([api.contentDiscovery().catch(() => null), api.intelligenceDirections().catch(() => ({ directions: [] }))]).then(([scan, saved]) => {
      const taken = new Set((saved?.directions || []).filter((d) => d.researchId).map((d) => d.id));
      setFound((scan?.scan?.connections || []).filter((c) => c.directionId && !taken.has(c.directionId)).slice(0, 4));
    });
    api.projects()
      .then((data) => { setResult(data); setError(null); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [workerReady]);

  useEffect(load, [load]);

  const projects = useMemo(() => projectsFrom(result), [result]);
  const grouped = useMemo(() => {
    const out = Object.fromEntries(CONTENT_SHELVES.map((key) => [key, []]));
    for (const project of projects) out[contentShelf(project)].push(project);
    return out;
  }, [projects]);
  const topics = useMemo(() => [
    ...[...grouped["选题"]].sort(byTopicUrgency).map((project) => ({
      key: `p:${project.id}`, kind: "project", id: project.id, updatedAt: project.updatedAt,
      title: (project.title && project.title !== "未命名" ? project.title : project.plan?.thought?.trim()) || "未命名选题",
      origin: project.plan?.origin || null, missing: project.plan?.missing || [], stage: project.plan?.stage || null,
    })),
    ...researches.filter((item) => !item.projectId && !item.contentRestricted).map((item) => ({
      key: `r:${item.id}`, kind: "research", id: item.id, updatedAt: item.updatedAt, title: item.question || item.title || "未命名选题",
      origin: item.legacyTopic ? { kind: item.legacyTopic.kind === "bridge" ? "bridge" : "legacy" } : item.intelligenceIntents?.length ? { kind: "intel", title: item.intelligenceIntents.at(-1).brief?.title || "" } : { kind: "own" },
      missing: null, stage: { key: "new", label: "还没选角度" },
    })),
  ], [grouped, researches]);
  const counts = { ...Object.fromEntries(CONTENT_SHELVES.map((key) => [key, grouped[key].length])), 选题: topics.length };
  const shelf = CONTENT_SHELVES.includes(stage) ? stage : (counts["在写"] ? "在写" : "选题");
  const chooseShelf = (key) => { setStage(key); try { sessionStorage.setItem("content-shelf", key); } catch {} };
  const shown = useMemo(() => [...(grouped[shelf] || [])].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))), [grouped, shelf]);
  const openTopic = async (item) => {
    if (item.kind === "project") return onGo("project", item.id);
    try { await openResearchContent(onGo, item.id); } catch (e) { setError(e); }
  };
  const addFound = async (c) => {
    try { const { projectId } = await api.directionToContent(c.directionId); onChanged?.(); onGo("project", projectId); } catch (e) { setError(e); }
  };
  const rescan = async () => {
    setScanning(true);
    const before = new Set(found.map((c) => c.directionId));
    try {
      const r = await api.scanContentDiscovery({ force: true });
      const fresh = (r?.scan?.connections || []).filter((c) => c.directionId && !before.has(c.directionId)).length;
      // 扫完要说结果：找到几个新的；一个也没有时说清缺什么，而不是让列表静悄悄地没变。
      setToast(fresh ? { text: `找到 ${fresh} 个新选题`, detail: "在「来自我的知识」里，点「加入选题」就能开始。" }
        : { text: "这次没有找到新的选题", detail: r?.scan?.nothingFoundReason || "多记几篇 Wiki、收一些读者原话之后再扫。" });
      await load();
    } catch (e) { setError(e); } finally { setScanning(false); }
  };
  /** 先放着：整篇停下，稿子和构思都在；回执上的「撤销」就是「接着做」。 */
  const park = async (item) => {
    try {
      // 还没建成内容的旧选题：先补建（服务端幂等），再搁置——和别的选题一样能先放着。
      const projectId = item.kind === "project" ? item.id : await researchProjectId(item.id);
      await api.transitionProject(projectId, "park");
      setToast({ text: `「${item.title}」先放着了`, detail: "在「先放着」里，随时可以接着做。", undo: async () => { await api.transitionProject(projectId, "resume"); setToast(null); onChanged?.(); load(); } });
      onChanged?.(); await load();
    } catch (e) { setError(e); }
  };
  const removeTopic = async (item) => {
    if (item.kind === "project") return remove({ id: item.id, title: item.title });
    try {
      await api.trashResearch(item.id);
      setToast({ text: `「${item.title}」已移入回收站`, undo: async () => { await api.restoreResearch(item.id); setToast(null); load(); } });
      await load();
    } catch (e) { setError(e); }
  };
  const open = (project) => {
    const target = projectOpenTarget(project);
    if (!target) return;
    onGo(target.view, target.id);
  };

  /**
   * 删掉一个项目会移入本地回收站，并带上所属稿件。
   *
   * ⚠️ **回执要说清删掉了几篇**，不能只说「已删除」——你以为删的是一个壳，
   * 而它可能带走了三篇写过的稿。
   *
   * ⚠️ **而且要给回头路。** 界面上没有回收站页面，所以「点错了怎么办」的唯一
   * 答案就是这条回执上的「撤销」——它走 `/projects/:id/restore`，稿子一起回来。
   *
   * 「正在删」的忙态和防重入归 `RowDelete` 自己管（它 await 这个函数），
   * 所以这一层不再留 `removing`——同一件事两处各记一份，迟早有一处忘了改。
   */
  const remove = useCallback(async (p) => {
    try {
      const r = await api.removeProject(p.id);
      setToast({
        text: `「${p.title || "未命名内容"}」已移入回收站`,
        detail: r.deleted ? `连同 ${r.deleted} 篇稿子。` : undefined,
        undo: async () => { await api.restoreProject(p.id); setToast(null); onChanged?.(); load(); },
      });
      onChanged?.();
      await load();
    } catch (e) {
      setError(e);
    }
  }, [load, onChanged, setToast]);

  return (
    <>
      <PageHeader
        title="内容"
        aside={
          <>
            {result ? <span className="project-total">{result.total ?? projects.length} 篇内容</span> : null}
            <button className="icon-btn" onClick={load} disabled={loading || !workerReady} aria-label="刷新内容项目" title="刷新">
              <IconRefresh aria-hidden="true" className={loading ? "spinning" : ""} />
            </button>
            {/* 四处共用一颗（`components/NewContentButton.jsx`），别在这儿再拼一份菜单 */}
            {/* 新建内容的另一种起点：从自己的知识和读者问题里找题（原「从已有知识探索选题」）。 */}
            {workerReady ? <NewContentButton onGo={onGo} onChanged={onChanged} /> : null}
          </>
        }
      />

      {!workerReady ? (
        <div className="project-setup">
          <strong>本地工作区暂时不可用</strong>
          <p>请检查工作区设置后重试。</p>
          <button className="btn" onClick={onSettings}>打开设置</button>
        </div>
      ) : null}

      {error ? (
        <div className="project-error">
          <ErrorNote error={error} what="读取内容项目" onRetry={load} />
          <div className="project-error__legacy">
            <span>兼容期仍可继续使用现有内容。</span>
            <button className="btn btn-sm" onClick={() => onGo("topics", "待写")}>打开旧版选题</button>
            <button className="btn btn-sm" onClick={() => onGo("drafts", "写作中")}>打开稿件库</button>
          </div>
        </div>
      ) : null}

      {loading && !result ? <Loading rows={4} /> : null}

      {result ? (
        <>
          {/* ⚠️ 「更多」那个折叠撤了：里面三条（合集 / 找灵感 / 查看发布数据）
              都是**会换整页的去处**，而三个去处都在侧栏里。导航不待在正文的折叠里
              （判据同 `Series.jsx` 撤掉的那颗「全部文章 / 合集」）。 */}
          <div className="list-bar content-view-toolbar">
            <div className="chips chips-sm" aria-label="内容状态">
              {CONTENT_SHELVES.map((key) => <button key={key} className="chip" aria-pressed={shelf === key} onClick={() => chooseShelf(key)}>{key}{counts[key] ? ` ${counts[key]}` : ""}</button>)}
            </div>
            {/* 选题默认卡片（要动手的少数），也能切成列表；和「在写」各记各的。 */}
            {shelf === "选题" ? <LayoutToggle value={topicLayout} onChange={setTopicLayout} /> : <LayoutToggle value={layout} onChange={setLayout} />}
          </div>
          {!projects.length && !topics.length ? (
            /* ⚠️ **首启空态要带一颗能点的**：只有一句灰字的话「下一步点哪儿」
               还是留给用户猜。和下面那个「这一档空着」的筛选空态不是一回事。 */
            <Empty
              icon={IconFileText}
              action={workerReady ? <NewContentButton label="写第一篇" className="btn btn-sm" onGo={onGo} onChanged={onChanged} /> : null}
            >
              写下第一句话就可以开始，不必先定选题或填写计划。
            </Empty>
          ) : shelf === "选题" ? (
            topics.length || found.length
              ? <TopicShelf items={topics} found={found} scanning={scanning} layout={topicLayout} onOpen={openTopic} onPark={park} onRemove={removeTopic} onAddFound={addFound} onScan={rescan} onBuild={() => onGo("bridge", "manual")} />
              : <Empty icon={IconFileText}>还没有选题。在情报里点「加入选题」，或者新建一篇、从我的知识里找。</Empty>
          ) : shown.length ? (
            layout === "card"
              ? <ProjectCards projects={shown} onOpen={open} onRemove={remove} onFile={setFiling} />
              : <ProjectTable projects={shown} onOpen={open} onRemove={remove} onFile={setFiling} />
          ) : (
            <Empty icon={IconFileText}>{shelf === "在写" ? "没有正在写的内容。从「选题」里挑一篇开写，或者新建一篇。" : shelf === "已发布" ? "发布后的作品会留在这里。" : "先放着的内容会留在这里，随时可以接着做。"}</Empty>
          )}
        </>
      ) : null}

      <SeriesPicker
        open={Boolean(filing)}
        mode="series"
        project={filing}
        onClose={() => setFiling(null)}
        onDone={(result) => {
          // 服务端回的那份整个换掉，不在前端拼一份「应该长这样」
          if (result?.project) setResult((cur) => cur && { ...cur, projects: cur.projects.map((p) => (p.id === result.project.id ? result.project : p)) });
          setToast({ text: result?.project?.collections?.length ? `已放进 ${result.project.collections.length} 个合集` : "已移出全部合集" });
          onChanged?.();
        }}
      />
      <Toast text={toast?.text} detail={toast?.detail} onUndo={toast?.undo} onClose={() => setToast(null)} />
    </>
  );
}
