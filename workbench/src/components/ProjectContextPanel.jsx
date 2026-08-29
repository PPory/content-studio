import { useEffect, useRef } from "react";
import { IconCheck, IconDatabase, IconFileText, IconX } from "./icons.jsx";

const NEEDS_VERIFICATION = new Set(["数据/事实", "金句/原话"]);

function isPending(material) {
  if (!NEEDS_VERIFICATION.has(material.type)) return false;
  return material.verificationStatus !== "已核验";
}

/**
 * 「当前上下文」只回答一个问题：**这一轮 AI 会读到什么。**
 *
 * ⚠️ 这里以前还挂着「项目检查」——三个按需跑的专家检查。它们和这块面板不是一件事：
 * 面板说的是「已经带上了什么」，检查是「去做一件新的事」，两者塞在一个抽屉里，
 * 用户每次想确认上下文都要先跳过三颗执行按钮。检查现在从输入框的 `@` 里调用
 * （`@审稿顾问` / `@素材顾问` / `@事实核查`），跟其他专家同一个入口。
 */
export function ProjectContextPanel({ open, openedByKeyboard, document, materials, totalMaterials = materials.length, onClose, onOpenMaterials }) {
  const panelRef = useRef(null);
  useEffect(() => {
    if (open && openedByKeyboard) requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
  }, [open, openedByKeyboard]);
  // ⚠️ Esc 和「点空白收起」都归 `ProjectAssistantRail` 统一处理——
  // 那儿还有一个素材浮层，两个浮层各自装一套关闭逻辑迟早会有一个漏掉。
  if (!open) return null;
  return <section ref={panelRef} className="project-context-panel" tabIndex="-1" aria-label="当前 AI 上下文">
    <header><div><small>当前上下文</small><strong>{document.title || "未命名稿件"}</strong></div><button type="button" onClick={() => onClose(true)} aria-label="关闭上下文"><IconX aria-hidden="true" /></button></header>
    <div className="project-context-panel__document"><IconFileText aria-hidden="true" /><span><b>当前主稿</b><small>标题、正文与当前选区</small></span><IconCheck aria-label="已附带" /></div>
    <section className="project-context-panel__materials">
      <div><span>已使用素材</span><b>{materials.length}</b></div>
      <div className="project-context-panel__list">
        {materials.length ? materials.map((item) => <button type="button" key={item.id} className="project-context-material">
          <IconDatabase aria-hidden="true" /><span><b>{item.title || item.name || "未命名素材"}</b><small>{item.type || "项目素材"}</small></span>{isPending(item) ? <em>待核验</em> : <IconCheck className="project-context-material__verified" aria-label="已核验或无需核验" />}
        </button>) : <p className="project-context-panel__empty"><b>还没有使用素材</b><small>需要时再从项目素材中添加。</small></p>}
      </div>
    </section>
    <footer><span>只附带你明确选择的项目内容</span><button type="button" onClick={onOpenMaterials}>查看全部素材{totalMaterials ? `（${totalMaterials}）` : ""}</button></footer>
  </section>;
}
