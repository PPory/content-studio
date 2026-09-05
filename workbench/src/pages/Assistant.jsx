import { api } from "../lib/api.js";
import { ErrorNote } from "../components/ui.jsx";
// 独立的 AI 助手页（`#/assistant`）：一个不绑定某篇文章的思考空间。
//
// ⚠️ **这一页没有外壳，它自己就是那一页。**
// 上一版在 `.main` 里面又套了一张 `.assistant-page__canvas`（白圆角卡片 + 投影，
// 外面还铺了一层渐变底），而 `.main` 本来就是浮在应用底色上的那块面板——
// **白框套白框**，和设计系统里「`.panel-block` 不是框」「一屏一层容器」是同一条。
//
// ⚠️ **也没有页头。** 页名在顶栏面包屑里已经写过一次（「AI助手」），
// 正文区再来一个 `<h1>AI 助手</h1>` 是同一个词一屏说两遍；
// 那个 `XENHO AI` 眉标更是设计系统点名否决过的那一种（标题的英文转写、全大写、宽字距）。
// 那句「一个不绑定某篇文章的思考空间…」跟着撤了——空态里那两行说的是同一件事，
// 而空态那两行才真的在回答「现在该干嘛」。

import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantPane } from "../components/assistant/AssistantPane.jsx";
import { useAssistantSummonTarget } from "../lib/assistant-summoner.js";
import { useViewSlots } from "../lib/view-slots.js";

export function Assistant({ conversationId, onConversationChange, onGo }) {
  const pageRef = useRef(null);
  const [activeConversationId, setActiveConversationId] = useState(conversationId);
  useEffect(() => { setActiveConversationId(conversationId); }, [conversationId]);
  const [thought, setThought] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const requestKey = useRef("");
  const origin = useRef("");
  async function prepare() {
    setBusy(true); setError(null);
    try {
      const { conversation } = await api.assistantConversation("global:assistant", activeConversationId);
      const notes = (conversation?.messages || []).filter((item) => item.role === "user").map((item) => typeof item.content === "string" ? item.content : item.text || "").join("\n\n");
      origin.current = conversation?.id || activeConversationId;
      requestKey.current = crypto.randomUUID();
      setThought(notes.slice(-20000));
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  async function develop() {
    setBusy(true); setError(null);
    try {
      const result = await api.createExploration({ requestKey: requestKey.current, thought, discovery: { research: { scopeId: "global:assistant", conversationId: origin.current } } });
      onGo?.("project", result.projectId);
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  /**
   * ⚠️ **这一页不画自己的 header，它把左右两段交给外壳的页头。**
   * 各画一条的话屏幕上就是两条 40px 的横栏叠着——上一版顶栏时代的老毛病换了个位置。
   */
  const slots = useViewSlots();
  const focusAssistant = useCallback(() => pageRef.current?.querySelector(".assistant-composer textarea")?.focus({ preventScroll: true }), []);
  useAssistantSummonTarget("global-page", focusAssistant);
  return (
    <section className="assistant-page" ref={pageRef}>
      <div className="research-start" style={{ padding: "12px 20px", borderBottom: "1px solid var(--line)" }}>
        <button type="button" className="btn btn-sm" disabled={busy || !activeConversationId} onClick={prepare}>从这次研究发展成一篇</button>
        {thought !== null ? <div className="project-notebook"><label>带入创作的想法<textarea aria-label="带入创作的想法" rows={4} value={thought} maxLength={20000} onChange={(event) => setThought(event.target.value)} /></label><p>这里只带入你最近写下的话（最多两万字），请整理要保留的部分。AI 回答不作为事实依据。</p><button type="button" className="btn btn-sm" disabled={busy} onClick={develop}>保存并进入创作</button><button type="button" className="btn btn-sm" onClick={() => setThought(null)}>继续研究</button></div> : null}
        <ErrorNote error={error} what="发展成内容" />
      </div>
      <AssistantPane
        scope="global"
        surface="page"
        target={{ kind: "none", editable: false }}
        scopeId="global:assistant"
        document={{}}
        initialConversationId={conversationId}
        onConversationChange={(id) => { setActiveConversationId(id); onConversationChange?.(id); }}
        draftStorageKey="workbench:quick-assistant-draft:v1"
        headerSlots={slots}
      />
    </section>
  );
}
