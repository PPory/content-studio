import { useEffect, useState } from "react";
import { assistantReferenceDocument } from "../lib/assistant-summoner.js";
import { useDialog } from "../lib/use-dialog.js";
import { AssistantPane } from "./assistant/AssistantPane.jsx";
import { IconSparkles, IconX } from "./icons.jsx";
import "./quick-assistant.css";

export function QuickAssistant({ open, context, conversationId, onConversationChange, onClose, onContinue }) {
  const [contextAttached, setContextAttached] = useState(true);
  /**
   * ⚠️ **不再「点外面就关」。**
   *
   * 浮层时代那条是对的：一块盖在正文上的卡片，用户点它旁边就是想回到正文。
   * 但它现在是并排的一列——**点正文正是它存在的意义**（一边看一边问），
   * 关掉反而是最不该发生的事。关闭只走三个明确入口：× 、Esc、顶栏那颗召唤键。
   *
   * `modal: false` 也保留：这一列不给正文加 inert，两边都要能操作。
   */
  const dialogRef = useDialog(open, onClose, { modal: false });

  useEffect(() => setContextAttached(true), [context?.pageType, context?.object?.id]);

  // 一列布局里没有「退出动画」这回事——它不是浮上来的，是让位出来的。
  if (!open) return null;
  const attachedObject = contextAttached ? context?.object : null;

  return (
    <aside
      className="quick-assistant"
      data-open="true"
      ref={dialogRef}
      role="complementary"
      aria-label="AI 助手"
    >
      {/**
        * ⚠️ **浮层没有自己的 header，只有 pane 那一条。**
        *
        * 上一版是三条共 124px：①标题 +「快速提问」副标题；②当前位置 + 是否附带；
        * ③ pane 自己的操作行。合并到两条之后仍然不对——第二条只剩三颗图标
        * 悬在一片空白上，既没有边界也没有底色，看着像忘了做完。
        *
        * 现在身份和「这轮带了什么」作为 `headerLead` 交给 pane，
        * 和历史 / 新对话 / 展开 / 关闭排在同一行：**一条 header，一件事一个位置。**
        * 「快速提问」副标题撤了（标题的同义反复）；「当前位置：」四个字也撤了
        * （芯片摆在这个位置本身就是在说位置）。
        */}
      <div className="quick-assistant__body">
        <AssistantPane
          scope="global"
          surface="overlay"
          target={{ kind: "none", editable: false }}
          scopeId="global:assistant"
          document={assistantReferenceDocument(context, contextAttached)}
          initialConversationId={conversationId}
          onConversationChange={onConversationChange}
          draftStorageKey="workbench:quick-assistant-draft:v1"
          onContinue={onContinue}
          onClose={onClose}
          /**
           * ⚠️ **没带上内容就什么都不画。**
           *
           * 上一版无论如何都留一颗芯片：带上了写「热点 · Uber…」，没带上写
           * 「未附带页面内容」甚至「未附带页面上下文」。后者是**一句报告"什么都没发生"的话**，
           * 而它常驻在整个浮层最显眼的一行上——绝大多数页面本来就没有可带的对象，
           * 于是这条头栏日常显示的就是一句「无」。
           *
           * 现在：真带上了才画芯片（并且带一颗 ✕ 可以摘掉）；没带上就只剩身份。
           * 「这一轮读到了什么」在没有的时候，最诚实的表达是**不占位置**。
           */
          headerLead={<>
            <span className="quick-assistant__mark"><IconSparkles aria-hidden="true" /></span>
            <strong className="quick-assistant__title">AI 助手</strong>
            {contextAttached && attachedObject ? (
              <span className="quick-assistant__chip">
                <b>{context?.label || "工作台"}</b>
                <small>{attachedObject.title || attachedObject.id}</small>
                <button type="button" onClick={() => setContextAttached(false)} aria-label="移除当前页面上下文" title="移除当前页面上下文"><IconX aria-hidden="true" /></button>
              </span>
            ) : null}
          </>}
        />
      </div>
    </aside>
  );
}
