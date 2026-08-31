import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssistantSummonTarget } from "../lib/assistant-summoner.js";
import { AssistantPane } from "./assistant/AssistantPane.jsx";
import { AssistantOrb } from "./assistant/AssistantOrb.jsx";
import { ProjectContextPanel } from "./ProjectContextPanel.jsx";
import { IconChevronDown, IconFileText, IconLayoutSidebarRight, IconX } from "./icons.jsx";

export function ProjectAssistantRail({ scopeId, document, materials = [], profile, target, handoffRequest = null, reviewingCandidate = false, children }) {
  const [contextOpen, setContextOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [openedByKeyboard, setOpenedByKeyboard] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const railRef = useRef(null);
  const contextTriggerRef = useRef(null);

  const focusAssistant = useCallback(() => {
    setCollapsed(false);
    requestAnimationFrame(() => requestAnimationFrame(() => railRef.current?.querySelector(".assistant-composer textarea")?.focus({ preventScroll: true })));
  }, []);
  useAssistantSummonTarget("project", focusAssistant);

  const closeContext = useCallback((restoreFocus = false) => {
    setContextOpen(false);
    if (restoreFocus) requestAnimationFrame(() => contextTriggerRef.current?.focus({ preventScroll: true }));
  }, []);
  /**
   * 点空白就收起。**每一个点开的浮层都要遵守这条**，否则用户得记住哪个能点外面关、
   * 哪个必须回去点原来那颗按钮——记不住的结果是每次都先试一下。
   *
   * ⚠️ 判据是「点的地方在不在这个锚点里」，不是「在不在面板里」：
   * 触发器自己也在锚点里，把它排除掉，它的 toggle 才有机会正常收起面板——
   * 否则 pointerdown 先关一次、紧接着 click 又开一次，看着就是「点它关不掉」。
   */
  useEffect(() => {
    if (!contextOpen && !materialsOpen) return undefined;
    const close = (event) => {
      if (event.target.closest?.(".project-assistant__context-anchor")) return;
      setContextOpen(false);
      setMaterialsOpen(false);
    };
    const key = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMaterialsOpen(false);
      if (contextOpen) closeContext(true);
    };
    window.document.addEventListener("pointerdown", close);
    window.document.addEventListener("keydown", key, true);
    return () => {
      window.document.removeEventListener("pointerdown", close);
      window.document.removeEventListener("keydown", key, true);
    };
  }, [contextOpen, materialsOpen, closeContext]);
  const visibleMaterials = useMemo(() => materials.slice(0, 10), [materials]);
  const reviewOpen = Boolean(reviewingCandidate);

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
      {/**
        * ⚠️ **写这一篇的名字，不是写「当前稿件」。**
        *
        * 「当前稿件」是个**分类名**——它对任何一篇都成立，所以看了等于没看。
        * 这颗芯片要回答的是「AI 这一轮读的是哪一篇」，能回答这个问题的只有标题。
        * 上一版还挂着「已用素材 N / 暂无素材」：素材清单在面板里就有，
        * 而「暂无素材」在这儿是一句每次打开都在提醒你少干了件事的废话。
        */}
      <IconFileText aria-hidden="true" />
      <span><b>{document?.title?.trim() || "未命名稿件"}</b></span><IconChevronDown aria-hidden="true" />
    </button>
    <ProjectContextPanel
      open={contextOpen}
      openedByKeyboard={openedByKeyboard}
      document={document}
      materials={visibleMaterials}
      totalMaterials={materials.length}
      onClose={closeContext}
      onOpenMaterials={() => { setMaterialsOpen(true); setContextOpen(false); }}
    />
    {materialsOpen ? <section className="project-materials-popover" aria-label="项目素材">
      <header><strong>项目素材</strong><button type="button" onClick={() => { setMaterialsOpen(false); contextTriggerRef.current?.focus(); }} aria-label="关闭项目素材"><IconX aria-hidden="true" /></button></header>
      <div>{children}</div>
    </section> : null}
  </div>;

  return <>
    <aside className="project-rail project-assistant" data-collapsed={collapsed ? "true" : undefined} data-reviewing={reviewOpen ? "true" : undefined} aria-hidden={reviewOpen || undefined} aria-label="项目 AI 与资料" ref={railRef}>
      {/**
        * ⚠️ **收起就是整列消失，没有一条竖着写「协作」的 44px 窄条。**
        *
        * 那条窄条要用竖排中文（每个字一行）才塞得下，读起来别扭，而且它占着一列的位置
        * 却只提供一个动作——等于用 44px 换一颗按钮。
        *
        * 重新打开走**和其他页面完全一样的路**：顶栏那颗 AI 键 / `Ctrl+I`。
        * 召唤器在项目页本来就会 `setCollapsed(false)` 再聚焦输入框（见 `focusAssistant`），
        * 所以这里不需要第二个入口。
        */}
      {/**
        * ⚠️ **收起之后那片区域必须留一个标记。**
        *
        * 这一列收起就是整列消失（上面那段注释说了为什么不留 44px 竖条），
        * 而消失之后那儿什么都没有——想让它回来只能抬头去顶栏那颗 AI 键。
        * 浮标让「收起」和「展开」成为**同一处的两个状态**。
        *
        * 它不是第二个入口：栏开着时不画，顶栏那颗键和 `Ctrl+I` 一个都没动，
        * 走的也是同一个 `focusAssistant`。
        */}
      {collapsed ? null : <AssistantPane
        scope="project"
        surface="rail"
        target={target}
        scopeId={scopeId}
        document={document}
        materials={materials}
        profile={profile}
        projectContext={context}
        handoffRequest={handoffRequest}
        onCollapse={() => { setContextOpen(false); setMaterialsOpen(false); setCollapsed(true); }}
      />}
    </aside>
    {/**
      * ⚠️ **浮标在 `<aside>` 外面。** 那个 `<aside>` 收起时是 `display: none`，
      * 挂在里面等于画了个看不见的东西——而且这类错不报错，只是「按钮没出现」。
      */}
    {collapsed && !reviewOpen ? <AssistantOrb label="聊聊这篇稿件" onOpen={focusAssistant} /> : null}
  </>;
}
