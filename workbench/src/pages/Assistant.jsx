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

import { AssistantPane } from "../components/assistant/AssistantPane.jsx";

export function Assistant() {
  return (
    <section className="assistant-page">
      <AssistantPane
        scope="global"
        surface="page"
        target={{ kind: "none", editable: false }}
        scopeId="global:assistant"
        document={{}}
      />
    </section>
  );
}
