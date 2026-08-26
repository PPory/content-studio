/**
 * 弹层的键盘规矩，一处写全。
 *
 * 工作台里现在有六个弹层（入库抽屉、备份面板、全局检索、阅读覆盖层、热点原文、
 * 平台闸门）。它们各自都做过一点点：有的自己监听 Esc，有的自己 focus 一下输入框。
 * **各做各的结果是每个都缺一两条**，而缺的那条是同一类问题：焦点还留在背后那一页上。
 *
 * 具体会怎么坏：打开阅读覆盖层之后按 Tab，焦点会一路走进**背后那一页**——那儿有
 * 卡片上的垃圾桶按钮。屏幕上什么都看不出来（背景被遮住了），而回车就是一次删除。
 * 这不是「无障碍加分项」，是一个用键盘就能误触的危险动作。
 *
 * 五条一起给，缺一条这个 hook 就没意义：
 *   1. 打开时焦点进弹层（优先 `[data-autofocus]`，否则第一个可聚焦元素，都没有就是容器本身）
 *   2. Tab / Shift+Tab 只在弹层内部循环
 *   3. 背景对键盘和读屏都消失（`inert`）
 *   4. Esc 关闭
 *   5. 关闭后焦点回到**打开它的那个按钮**上
 *
 * 用法：`const ref = useDialog(open, onClose)`，把 ref 挂在弹层最外层那个盒子上。
 */

import { useEffect, useRef } from "react";

// 能被 Tab 走到的东西。`[hidden]` 和 `disabled` 的排掉，`tabindex="-1"` 的也排掉
// （那是「能用代码聚焦、但不进 Tab 序列」的标记，比如收起态下的 logo 按钮）。
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const visible = (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;

export function useDialog(open, onClose, { autoFocus = true, modal = true, dismissOnPointerDownOutside = false, outsideIgnore = "" } = {}) {
  const ref = useRef(null);
  // 记下是谁打开的。**在 open 变 true 的那一帧记**，晚一步焦点就已经被移进弹层了。
  const openerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const box = ref.current;
    if (!box) return;
    openerRef.current = document.activeElement;

    /**
     * 背景整块 `inert`：键盘走不进去、读屏读不到、鼠标也点不了。
     *
     * 用 `inert` 而不是自己遍历着改 `tabindex`：后者要记住每个元素原来的值，
     * 而弹层开着的时候背景那一页还在继续渲染（状态轮询、流式输出），改回来时
     * 十有八九对不上。`inert` 是浏览器自己管的，Chrome 102 起就有。
     *
     * **要沿着从弹层到 body 的整条路往上刨兄弟**，不能只看 `document.body.children`：
     * 这个项目的弹层没有一个是 body 的直接子节点（阅读覆盖层长在 `.main` 里面，
     * 抽屉长在 `.app` 里面）。只看 body 那一层的话，过滤完一个都不剩——
     * 代码在跑，效果是零，而且看不出来。
     */
    const off = [];
    if (modal) {
      for (let node = box; node && node !== document.body; node = node.parentElement) {
        for (const sib of node.parentElement?.children || []) {
          if (sib === node || sib.contains(box)) continue;
          off.push([sib, sib.inert]);
          sib.inert = true;
        }
      }
    }

    const items = () => [...box.querySelectorAll(FOCUSABLE)].filter(visible);

    if (autoFocus) {
      // 微任务里做：这一帧 React 可能还没把子节点挂上去
      queueMicrotask(() => {
        const target = box.querySelector("[data-autofocus]") || items()[0] || box;
        if (target === box && !box.hasAttribute("tabindex")) box.setAttribute("tabindex", "-1");
        target.focus?.({ preventScroll: true });
      });
    }

    const onKey = (e) => {
      if (e.key === "Escape") {
        // **不 stopPropagation**：底下的组件（比如下拉菜单）自己在捕获阶段拦 Esc，
        // 它们该先收自己那一层。走到这里说明没人拦，那就是「关掉这个弹层」。
        e.preventDefault();
        onClose?.();
        return;
      }
      if (!modal || e.key !== "Tab") return;
      const list = items();
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      // 焦点已经在弹层外（比如刚被别处的代码抢走）时，Tab 先把它拽回来
      if (!box.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const onPointerDown = (event) => {
      if (!dismissOnPointerDownOutside || box.contains(event.target)) return;
      if (outsideIgnore && event.target.closest?.(outsideIgnore)) return;
      onClose?.();
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      for (const [el, was] of off) el.inert = was;
      // 焦点归位。**要判断那个元素还在不在**：弹层里的动作可能把它删掉了
      // （比如从卡片上打开、在弹层里把这张卡删了），那时候硬 focus 一个游离节点，
      // 焦点会掉回 body，下一次 Tab 从整页开头重来。
      const back = openerRef.current;
      if (back && document.contains(back)) back.focus?.({ preventScroll: true });
    };
  }, [open, onClose, autoFocus, modal, dismissOnPointerDownOutside, outsideIgnore]);

  return ref;
}
