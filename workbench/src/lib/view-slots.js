/**
 * 页头插槽。**页名和外壳归 App，动作归页面**——两边都要往同一条 `.view-head` 里写东西。
 *
 * ⚠️ **为什么是 portal 而不是「页面把动作当 prop 传上去」。**
 * 传上去的话，App 得知道每一页都有哪些动作（十几页各不相同），于是每加一颗按钮
 * 就要改两个文件；而这个项目的事故清一色是「同一件事写在两个地方」。
 * 插槽反过来：App 只负责画出那条栏和两个空位，动作仍然写在它属于的那一页里。
 *
 * **三个位置**：页名右边那一格（`lead`）、正中（`center`）、右端（`end`）。
 * `center` 是给「自己接管整条页头」的页用的（现在只有 AI 助手），它绝对定位在正中，
 * 左右放多少东西都推不歪它。
 *
 * 还有第四个：`overlay`——**盖住整个面板（含页头）的一层**，给需要从窗口顶上
 * 一路盖到底的东西用（AI 助手的历史抽屉）。页面自己那一层的顶已经在页头**以下**了，
 * 定位再怎么算也够不到页头。
 * 筛选胶囊不走插槽——它浮在正文里居中（见 `ui.jsx` 的 `FilterHeader`）。
 *
 * 插槽节点走 state 而不是 ref：ref 在提交阶段才拿得到，而消费方在**渲染**阶段就要用它。
 * 回调 ref 里 setState 会在浏览器绘制之前再跑一轮，所以看不到闪。
 */
import { createContext, useContext } from "react";

export const ViewSlots = createContext(null);

export function useViewSlots() {
  return useContext(ViewSlots);
}
