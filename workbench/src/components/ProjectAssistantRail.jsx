import { useCallback, useEffect, useRef, useState } from "react";
import { useAssistantSummonTarget } from "../lib/assistant-summoner.js";
import { AssistantPane } from "./assistant/AssistantPane.jsx";
import { ProjectContextPanel } from "./ProjectContextPanel.jsx";
import { IconChevronDown, IconFileText, IconX } from "./icons.jsx";

// One optional companion to the document. Hidden panels stay mounted to preserve
// unsaved notebook input and the current conversation when changing tools.
// `notebook` 为空时不显示「构思」工具（工作区在构思视图时，构思就在中间）；`openRequest` 让外面点「补资料」时直接打开对应工具。
export function ProjectAssistantRail({ scopeId, document, materials = [], profile, target, handoffRequest = null, reviewingCandidate = false, recall = null, notebook = null, openRequest = null, tools: only = null, children }) {
  const [active, setActive] = useState(null);
  const [assistantOpened, setAssistantOpened] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [openedByKeyboard, setOpenedByKeyboard] = useState(false);
  const railRef = useRef(null);
  const triggers = useRef({});
  const contextTriggerRef = useRef(null);
  const openTool = useCallback((tool) => {
    setActive(tool);
    setContextOpen(false);
    if (tool === "协作") setAssistantOpened(true);
  }, []);
  const focusAssistant = useCallback(() => {
    openTool("协作");
    requestAnimationFrame(() => requestAnimationFrame(() => railRef.current?.querySelector(".assistant-composer textarea")?.focus({ preventScroll: true })));
  }, [openTool]);
  useAssistantSummonTarget("project", focusAssistant);
  useEffect(() => { if (handoffRequest?.id) focusAssistant(); }, [handoffRequest?.id, focusAssistant]);
  useEffect(() => { if (openRequest?.tool) openTool(openRequest.tool); }, [openRequest?.id]);
  useEffect(() => { if (!notebook && active === "构思") setActive(null); }, [notebook, active]);
  const close = useCallback(() => {
    const current = active;
    setActive(null);
    setContextOpen(false);
    requestAnimationFrame(() => triggers.current[current]?.focus({ preventScroll: true }));
  }, [active]);
  useEffect(() => {
    if (!active) return undefined;
    const escape = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.target.closest?.('[role="dialog"], dialog')) return;
      if (contextOpen) { setContextOpen(false); contextTriggerRef.current?.focus(); }
      else close();
    };
    window.document.addEventListener("keydown", escape);
    return () => window.document.removeEventListener("keydown", escape);
  }, [active, contextOpen, close]);
  const context = <div className="project-assistant__context-anchor">
    <button ref={contextTriggerRef} className="project-assistant__context-trigger" type="button" aria-expanded={contextOpen}
      onClick={(event) => { setOpenedByKeyboard(event.detail === 0); setContextOpen(!contextOpen); }}>
      <IconFileText aria-hidden="true" /><span><b>{document?.title?.trim() || "未命名稿件"}</b></span><IconChevronDown aria-hidden="true" />
    </button>
    <ProjectContextPanel open={contextOpen} openedByKeyboard={openedByKeyboard} document={document}
      materials={materials.slice(0, 10)} totalMaterials={materials.length}
      onClose={(restore) => { setContextOpen(false); if (restore) contextTriggerRef.current?.focus(); }}
      onOpenMaterials={() => openTool("资料")} />
  </div>;
  return <>
    <nav className="writing-tools" aria-label="写作辅助" hidden={reviewingCandidate || only?.length === 1}>
      {(only || (notebook ? ["构思", "资料", "协作"] : ["资料", "协作"])).map((tool) => <button key={tool} type="button" className="btn btn-sm"
        ref={(element) => { triggers.current[tool] = element; }} aria-pressed={active === tool} aria-controls={`writing-panel-${tool}`}
        onClick={() => active === tool ? close() : openTool(tool)}>{tool}</button>)}
    </nav>
    <aside className="project-rail project-assistant writing-companion" data-collapsed={!active ? "true" : undefined}
      data-reviewing={reviewingCandidate ? "true" : undefined} aria-hidden={reviewingCandidate || !active || undefined} aria-label="写作辅助区" ref={railRef}>
      {/* 只有「协作」一个工具时，对话面板自己有标题和收起按钮，这一行就是重复的。 */}
      <header className="writing-companion__head" hidden={only?.length === 1}><strong>{active}</strong><button type="button" className="icon-btn" onClick={close} aria-label="关闭写作辅助"><IconX aria-hidden="true" /></button></header>
      <section id="writing-panel-构思" className="writing-companion__scroll" aria-label="构思" hidden={active !== "构思"}>{notebook}</section>
      <section id="writing-panel-资料" className="writing-companion__scroll" aria-label="项目素材" hidden={active !== "资料"}>{children}{active === "资料" ? recall : null}</section>
      <section id="writing-panel-协作" className="writing-companion__chat" aria-label="协作" hidden={active !== "协作"}>
        {assistantOpened ? <AssistantPane scope="project" surface="rail" target={target} scopeId={scopeId} document={document}
          materials={materials} profile={profile} projectContext={context} handoffRequest={handoffRequest} onCollapse={close} /> : null}
      </section>
    </aside>
  </>;
}
