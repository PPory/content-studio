import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { documentVersion } from "../lib/document-version.js";
import { useAssistantSummonTarget } from "../lib/assistant-summoner.js";
import { AssistantPane } from "./assistant/AssistantPane.jsx";
import { ProjectContextPanel } from "./ProjectContextPanel.jsx";
import { ProjectReportReview } from "./ProjectReportReview.jsx";
import { IconChevronDown, IconLayoutSidebarRight, IconX } from "./icons.jsx";

export function ProjectAssistantRail({ scopeId, document, materials = [], profile, selection, onInsert, onRevision, onReveal, reviewingCandidate = false, children }) {
  const [runs, setRuns] = useState([]);
  const [reportError, setReportError] = useState(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [openedByKeyboard, setOpenedByKeyboard] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [reviewRun, setReviewRun] = useState(null);
  const railRef = useRef(null);
  const contextTriggerRef = useRef(null);

  const focusAssistant = useCallback(() => {
    setCollapsed(false);
    requestAnimationFrame(() => requestAnimationFrame(() => railRef.current?.querySelector(".assistant-composer textarea")?.focus({ preventScroll: true })));
  }, []);
  useAssistantSummonTarget("project", focusAssistant);

  const loadRuns = async () => {
    try { setRuns((await api.expertRuns(scopeId)).runs || []); setReportError(null); }
    catch (error) { setReportError(error); }
  };
  useEffect(() => { loadRuns(); }, [scopeId]);
  useEffect(() => {
    if (!runs.some((item) => ["queued", "running"].includes(item.status))) return undefined;
    const timer = setInterval(loadRuns, 1_200);
    return () => clearInterval(timer);
  }, [runs, scopeId]);

  const startRun = async (kind, force = false) => {
    setReportError(null);
    try {
      const result = await api.startExpertRun({ kind, scopeId, document, documentVersion: documentVersion(document), force });
      setRuns((current) => [result.run, ...current.filter((item) => item.id !== result.run.id)]);
    } catch (error) { setReportError(error); }
  };
  const retry = async (run) => {
    setReviewRun(null);
    await startRun(run.kind, true);
  };
  const closeContext = useCallback((restoreFocus = false) => {
    setContextOpen(false);
    if (restoreFocus) requestAnimationFrame(() => contextTriggerRef.current?.focus({ preventScroll: true }));
  }, []);
  const visibleMaterials = useMemo(() => materials.slice(0, 10), [materials]);
  const reviewOpen = Boolean(reviewRun || reviewingCandidate);

  const context = <div className="project-assistant__context-anchor">
    <button
      ref={contextTriggerRef}
      className="project-assistant__context-trigger"
      type="button"
      aria-expanded={contextOpen}
      onClick={(event) => {
        if (contextOpen) closeContext(false);
        else { setOpenedByKeyboard(event.detail === 0); setContextOpen(true); setMaterialsOpen(false); }
      }}
    >
      <span><b>当前稿件</b><small>· {materials.length ? `已用素材 ${materials.length}` : "暂无素材"}</small></span><IconChevronDown aria-hidden="true" />
    </button>
    <ProjectContextPanel
      open={contextOpen}
      openedByKeyboard={openedByKeyboard}
      document={document}
      materials={visibleMaterials}
      totalMaterials={materials.length}
      runs={runs}
      onClose={closeContext}
      onRun={startRun}
      onOpenReport={(run) => { setReviewRun(run); closeContext(false); }}
      onOpenMaterials={() => { setMaterialsOpen(true); setContextOpen(false); }}
    />
    {materialsOpen ? <section className="project-materials-popover" aria-label="项目素材">
      <header><strong>项目素材</strong><button type="button" onClick={() => { setMaterialsOpen(false); contextTriggerRef.current?.focus(); }} aria-label="关闭项目素材"><IconX aria-hidden="true" /></button></header>
      <div>{children}</div>
    </section> : null}
    {reportError ? <div className="assistant-error project-assistant__report-error" role="alert"><span><b>{reportError.message}</b>{reportError.hint ? <small>{reportError.hint}</small> : null}</span></div> : null}
  </div>;

  return <>
    <aside className="project-rail project-assistant" data-collapsed={collapsed ? "true" : undefined} data-reviewing={reviewOpen ? "true" : undefined} aria-hidden={reviewOpen || undefined} aria-label="项目 AI 与资料" ref={railRef}>
      {collapsed ? <button className="project-assistant__reopen" type="button" onClick={() => { setCollapsed(false); requestAnimationFrame(() => railRef.current?.querySelector(".assistant-composer textarea")?.focus()); }} aria-label="展开协作区" title="展开协作区"><IconLayoutSidebarRight aria-hidden="true" /><span>协作</span></button> : <AssistantPane
        scope="project"
        surface="rail"
        target={{ kind: "draft", editable: true, selection, actions: { insert: onInsert, revise: onRevision } }}
        scopeId={scopeId}
        document={document}
        materials={materials}
        profile={profile}
        projectContext={context}
        onCollapse={() => { setContextOpen(false); setMaterialsOpen(false); setCollapsed(true); }}
      />}
    </aside>
    {reviewRun ? <ProjectReportReview
      run={reviewRun}
      document={document}
      onClose={() => setReviewRun(null)}
      onRetry={retry}
      onGenerateCandidate={(finding, block) => {
        onRevision?.({ mode: "rewrite", label: "按报告生成候选", instruction: finding.direction || finding.suggestion || finding.risk || finding.gap || findingTitle(finding), selection: { from: block.from, to: block.to, text: document.body.slice(block.from, block.to), targetKind: block.text.length > 800 ? "section" : "paragraph" } });
        setReviewRun(null);
      }}
      onReveal={(block) => { onReveal?.({ text: block.text.replace(/^#{1,6}\s*/, ""), nonce: Date.now() }); setReviewRun(null); }}
      onVerify={() => { window.location.hash = "#/materials/需核验"; }}
    /> : null}
  </>;
}

function findingTitle(item) {
  return item.finding || item.quote || item.need || "报告发现";
}
