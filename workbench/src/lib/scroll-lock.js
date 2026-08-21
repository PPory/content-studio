/**
 * 锁住覆盖层背后那一层的滚动。
 *
 * ⚠️ **这件事以前是 `document.body.style.overflow = "hidden"`，容器结构改版之后那样写不再成立。**
 * 现在 `.app` 是 `height:100vh; overflow:hidden`，**body 根本不滚了**，滚的是正文面板 `.main`。
 * 继续锁 body 等于什么都没锁：鼠标停在覆盖层里不滚动的那部分（顶栏、动作条）时，
 * 滚轮会穿过去把背后的 `.main` 滚走——关掉覆盖层才发现自己不在原来的位置了。
 * 这正是 `docs/design-system.md` 里「要消灭的是滚了也没反应的那条」的反面。
 *
 * 落地是给 `<html>` 挂一个属性，由 CSS 一处决定「锁住的时候谁不滚」
 * （`styles.css` 的 `html[data-scroll-lock] .main`）。**判据只写一处**：
 * 以后正文面板换个类名、或者再多一层滚动区，改 CSS 那一行就够了，
 * 不用回头找每一个开覆盖层的组件。
 *
 * **计数而不是布尔**：覆盖层可以叠（阅读区里再开一个弹层），
 * 用布尔的话内层一关就把外层的锁一起解开了。
 */
let depth = 0;

export function lockScroll() {
  depth += 1;
  if (depth === 1) document.documentElement.setAttribute("data-scroll-lock", "");
  return unlockScroll;
}

export function unlockScroll() {
  depth = Math.max(0, depth - 1);
  if (depth === 0) document.documentElement.removeAttribute("data-scroll-lock");
}
